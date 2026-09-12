// YouTube video provider.
//
// Resolution is the "hybrid" strategy: a `…/channel/UC…` URL carries the
// native id directly (no API call), while an @handle or legacy /user/ name is
// resolved to its UC… id via one YouTube Data API call (1 quota unit). Recent
// videos are then pulled from the free, unauthenticated per-channel Atom feed
// (`/feeds/videos.xml?channel_id=UC…`).
//
// The feed alone misdates live content, so a keyed build spends one more quota
// unit per refresh correcting it (see fetchVideoFacts). The hot path still
// works without a key — it just falls back to the feed's own dates.

import { logError, logWarn } from "../log";
import {
	byPublishedDesc,
	ChannelResolutionError,
	UncacheableVideos,
	type ChannelIdentity,
	type PlaylistVideo,
	type Video,
	type VideoEnv,
	type VideoProvider,
} from "./types";

const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
// UC + 22 url-safe base64 chars — the canonical channel id shape.
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
// A playlist id: a 2-char kind prefix (PL/UU/FL/OL/…) + base64url body. Bounded
// rather than pinned to one kind so real ids of every length are accepted while
// the length cap keeps a stray query value from being treated as one.
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{12,64}$/;
// Most recent uploads to surface on the profile tab.
const MAX_VIDEOS = 12;
// Upper bound on how many videos a tournament playlist enumerates via the Data
// API. The RSS feed only exposes the ~15 most recent, so the full-playlist path
// (fetchYouTubePlaylistVideosViaApi) pages through playlistItems.list instead;
// this caps the paging at MAX_PLAYLIST_VIDEOS / 50 = 10 requests (10 quota
// units) and bounds the payload the Videos tab ships to the browser to search
// over. Tournament playlists run to the low hundreds, so this is headroom, not
// a routine ceiling — a playlist that exceeds it is logged, never silently cut.
const MAX_PLAYLIST_VIDEOS = 500;
// playlistItems.list returns at most 50 items per page.
const PLAYLIST_PAGE_SIZE = 50;
// videos.list accepts up to 50 ids per call and costs one quota unit per call
// regardless of how many are asked for, so broadcast-start enrichment is a
// single request per channel refresh (MAX_VIDEOS is 12) and ceil(n / 50) for a
// full playlist.
const VIDEOS_LIST_BATCH = 50;

type ParsedYouTube =
	| { kind: "id"; channelId: string }
	| { kind: "handle"; handle: string } // @handle, without the leading @
	| { kind: "user"; username: string } // legacy /user/NAME
	| { kind: "custom"; name: string }; // /c/NAME — not cheaply resolvable

function safeDecode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

// Parse a user-entered YouTube channel URL (or bare @handle) into a
// discriminated identity. Returns null when it isn't a recognizable YouTube
// channel reference. Pure — no network; exported for unit tests.
export function parseYouTubeChannelUrl(raw: string): ParsedYouTube | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	// Bare "@handle" (no host) — the most common thing a user will paste.
	if (trimmed.startsWith("@")) {
		const handle = trimmed.slice(1);
		return handle ? { kind: "handle", handle: safeDecode(handle) } : null;
	}

	let url: URL;
	try {
		// Tolerate a missing scheme ("youtube.com/@x") by defaulting to https.
		url = new URL(
			/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
		);
	} catch {
		return null;
	}
	if (!YT_HOSTS.has(url.hostname.toLowerCase())) return null;

	const segs = url.pathname.split("/").filter(Boolean);
	if (segs.length === 0) return null;
	const first = segs[0];

	if (first.startsWith("@")) {
		const handle = first.slice(1);
		return handle ? { kind: "handle", handle: safeDecode(handle) } : null;
	}
	if (first === "channel") {
		const id = segs[1] ?? "";
		return CHANNEL_ID_RE.test(id) ? { kind: "id", channelId: id } : null;
	}
	if (first === "user") {
		const username = segs[1] ?? "";
		return username ? { kind: "user", username: safeDecode(username) } : null;
	}
	if (first === "c") {
		const name = segs[1] ?? "";
		return name ? { kind: "custom", name: safeDecode(name) } : null;
	}
	return null;
}

// Parse an admin-entered YouTube playlist reference into its list id. Accepts a
// full playlist or watch URL carrying `?list=…` (the paste-friendly form) or a
// bare playlist id — mirroring how parseYouTubeChannelUrl also takes a bare
// @handle. Returns null when it isn't a recognizable YouTube playlist. Pure — no
// network; exported for unit tests and reused by the schema's validation check
// so "accepted on save" and "fetchable on read" can't drift.
export function parseYouTubePlaylistUrl(
	raw: string,
): { playlistId: string } | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	// A bare id (no URL punctuation) — e.g. "PLabc…". Accepted like a bare handle.
	if (!/[/.:?]/.test(trimmed)) {
		return PLAYLIST_ID_RE.test(trimmed) ? { playlistId: trimmed } : null;
	}

	let url: URL;
	try {
		// Tolerate a missing scheme ("youtube.com/playlist?list=…").
		url = new URL(
			/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
		);
	} catch {
		return null;
	}
	if (!YT_HOSTS.has(url.hostname.toLowerCase())) return null;
	const list = url.searchParams.get("list");
	return list && PLAYLIST_ID_RE.test(list) ? { playlistId: list } : null;
}

async function resolveYouTube(
	rawUrl: string,
	env: VideoEnv,
): Promise<ChannelIdentity> {
	const parsed = parseYouTubeChannelUrl(rawUrl);
	if (!parsed) {
		throw new ChannelResolutionError(
			"That doesn't look like a YouTube channel URL. Paste your channel link or @handle.",
			"INVALID_URL",
			400,
		);
	}

	// Direct id — no API call, works even without a key.
	if (parsed.kind === "id") {
		return {
			platform: "youtube",
			channel_id: parsed.channelId,
			channel_url: `https://www.youtube.com/channel/${parsed.channelId}`,
		};
	}

	// Custom /c/ URLs have no cheap Data API resolution param — steer the user
	// to a form we can resolve rather than reaching for a 100-unit search call.
	if (parsed.kind === "custom") {
		throw new ChannelResolutionError(
			"Custom /c/ URLs can't be resolved automatically — use your @handle or your …/channel/UC… URL.",
			"UNRESOLVABLE_CUSTOM_URL",
			422,
		);
	}

	// handle | user → one Data API lookup. This is the only place the key is
	// needed; without it we can still accept the …/channel/UC… form above.
	if (!env.YOUTUBE_API_KEY) {
		throw new ChannelResolutionError(
			"Channel resolution is temporarily unavailable — paste your …/channel/UC… URL instead, or try again later.",
			"RESOLVE_UNAVAILABLE",
			503,
		);
	}
	const param =
		parsed.kind === "handle"
			? `forHandle=@${encodeURIComponent(parsed.handle)}`
			: `forUsername=${encodeURIComponent(parsed.username)}`;
	const apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&${param}&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`;

	const res = await fetch(apiUrl);
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		logError("youtube_channel_resolve_failed", null, {
			yt_status: res.status,
			yt_detail: detail.slice(0, 500),
		});
		throw new ChannelResolutionError(
			"Couldn't resolve that channel right now. Please try again later.",
			"RESOLVE_FAILED",
			502,
		);
	}
	const data = (await res.json()) as { items?: { id?: string }[] };
	const id = data.items?.[0]?.id;
	if (!id || !CHANNEL_ID_RE.test(id)) {
		throw new ChannelResolutionError(
			"No YouTube channel found for that handle.",
			"CHANNEL_NOT_FOUND",
			422,
		);
	}
	return {
		platform: "youtube",
		channel_id: id,
		// Keep the handle in the stored URL when we have it (nicer to display
		// and edit); fall back to the canonical /channel/ form.
		channel_url:
			parsed.kind === "handle"
				? `https://www.youtube.com/@${parsed.handle}`
				: `https://www.youtube.com/channel/${id}`,
	};
}

// Turn a numeric character-reference code point into its character, leaving
// the original entity text untouched when it's outside the Unicode range.
// String.fromCodePoint throws RangeError on such values; without this guard a
// single bogus entity (e.g. "&#9999999999;") in one title would throw all the
// way out of parseYouTubeFeed and blank the channel's entire video list.
function fromCodePointSafe(cp: number, original: string): string {
	return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff
		? String.fromCodePoint(cp)
		: original;
}

// Decode the XML entities that appear in feed text (titles). &amp; is decoded
// last so an escaped entity like "&amp;lt;" doesn't get double-decoded into
// "<". Exported for unit tests.
export function decodeXmlEntities(s: string): string {
	return s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#x([0-9a-fA-F]+);/g, (m, h: string) =>
			fromCodePointSafe(parseInt(h, 16), m),
		)
		.replace(/&#(\d+);/g, (m, n: string) => fromCodePointSafe(Number(n), m))
		.replace(/&amp;/g, "&");
}

function matchTag(entry: string, tag: string): string | null {
	const m = entry.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
	return m ? m[1] : null;
}

// Iterate the inner text of each <entry> in a feed. Shared by the channel and
// playlist parsers so the entry extraction lives in one place.
function* feedEntries(xml: string): Generator<string> {
	const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
	let m: RegExpExecArray | null;
	while ((m = entryRe.exec(xml)) !== null) yield m[1];
}

// Normalize one <entry> into a Video, or null when it has no video id.
function videoFromEntry(entry: string): Video | null {
	const id = matchTag(entry, "yt:videoId");
	if (!id) return null;
	return {
		id,
		// The feed says nothing about length; videos.list fills this in later
		// where a key allows it (see withVideoFacts).
		duration_seconds: null,
		title: decodeXmlEntities(matchTag(entry, "title") ?? ""),
		url: `https://www.youtube.com/watch?v=${id}`,
		thumbnail_url:
			entry.match(/<media:thumbnail\b[^>]*\burl="([^"]+)"/)?.[1] ?? null,
		published_at: matchTag(entry, "published") ?? "",
		platform: "youtube",
	};
}

// Parse a YouTube channel Atom feed into normalized Video[]. Pure — regex over
// the well-defined feed structure (Workers have no XML DOM parser). Entries
// missing a video id are skipped. Exported for unit tests.
export function parseYouTubeFeed(xml: string): Video[] {
	const videos: Video[] = [];
	for (const entry of feedEntries(xml)) {
		const video = videoFromEntry(entry);
		if (video) videos.push(video);
	}
	return videos;
}

// Parse a YouTube playlist Atom feed. Same as parseYouTubeFeed but also captures
// each entry's uploading channel (id + name) — a playlist can mix channels, so
// this is what lets the tournament videos read attribute each video. Exported
// for unit tests.
export function parseYouTubePlaylistFeed(xml: string): PlaylistVideo[] {
	const videos: PlaylistVideo[] = [];
	for (const entry of feedEntries(xml)) {
		const video = videoFromEntry(entry);
		if (!video) continue;
		// Author name is nested in <author><name>…</name>; scope the match to the
		// entry's <author> block so it can't pick up any other <name>.
		const authorBlock = entry.match(/<author>([\s\S]*?)<\/author>/)?.[1] ?? "";
		videos.push({
			...video,
			uploader_channel_id: matchTag(entry, "yt:channelId"),
			uploader_name:
				decodeXmlEntities(matchTag(authorBlock, "name") ?? "") || null,
		});
	}
	return videos;
}

// ─── Broadcast dates ─────────────────────────────────────────────────
//
// A tournament cast is streamed live, and for live content the feed's
// <published> is when the *VOD* was published — which lands hours after the
// broadcast ended, routinely in the next calendar day. Observed on six casts
// from one channel: +4h to +15h, and 5 of 6 crossed a day boundary. Because the
// VOD instant is later than the air time, dating a cast by it renders the cast
// as more recent than it is ("20 hours ago" for a stream that aired 38 hours
// earlier), which is both wrong and contradicts what YouTube itself shows
// ("Streamed live on Jul 30").
//
// The Atom feed carries nothing about the broadcast — <published> and <updated>
// are its only timestamps, and <updated> tracks view-count churn, so it is
// further from the air time, not closer. videos.list is the only supported
// source, hence the one extra quota unit.

// The videos.list response (only the fields we read).
interface VideosListResponse {
	items?: {
		id?: string;
		liveStreamingDetails?: { actualStartTime?: string };
		contentDetails?: { duration?: string };
	}[];
}

// What videos.list can tell us about one video beyond what the feed already
// said. Both fields are optional and independently absent: an ordinary upload
// has no liveStreamingDetails, and a broadcast still running reports no usable
// contentDetails.duration.
export interface VideoFacts {
	/** When the broadcast actually started, for live content only. */
	started_at?: string;
	/** Runtime in seconds. */
	duration_seconds?: number;
}

// YouTube states durations as ISO 8601 (`PT1H23M45S`, `PT58M`, `P1DT2H`).
// Returns null for the zero-length `P0D` a still-running broadcast reports, so
// a caller can tell "not known yet" from "known to be nothing". Pure —
// exported for unit tests.
export function parseIsoDuration(iso: string | undefined): number | null {
	if (!iso) return null;
	const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
	if (!m) {
		// A shape we don't recognise would otherwise vanish into the same null as
		// "still running", so if YouTube ever changes the format every runtime
		// disappears with no signal. Log it; the module reports its other upstream
		// trouble the same way.
		logWarn("youtube_duration_unparsed", { duration: iso.slice(0, 32) });
		return null;
	}
	const [, d, h, min, sec] = m;
	const total =
		Number(d ?? 0) * 86400 +
		Number(h ?? 0) * 3600 +
		Number(min ?? 0) * 60 +
		Number(sec ?? 0);
	return total > 0 ? total : null;
}

// Map video id → whatever videos.list could tell us about it. An id is present
// if it yielded EITHER an air time or a runtime, so an ordinary upload (no
// liveStreamingDetails at all) is in the map for its duration alone, while a
// broadcast scheduled but never aired — liveStreamingDetails without
// actualStartTime, and no duration yet — is absent. Absence therefore means
// "nothing to apply", not "not a broadcast". Pure — exported for unit tests.
export function parseVideosListPage(data: unknown): Map<string, VideoFacts> {
	const page = (data ?? {}) as VideosListResponse;
	const facts = new Map<string, VideoFacts>();
	for (const item of page.items ?? []) {
		if (!item.id) continue;
		const started_at = item.liveStreamingDetails?.actualStartTime;
		const duration_seconds = parseIsoDuration(item.contentDetails?.duration);
		// An item that told us nothing stays out of the map, so absence keeps
		// meaning "nothing to apply" for every consumer.
		if (started_at === undefined && duration_seconds === null) continue;
		facts.set(item.id, {
			...(started_at !== undefined ? { started_at } : {}),
			...(duration_seconds !== null ? { duration_seconds } : {}),
		});
	}
	return facts;
}

// Fold videos.list facts onto the feed's videos: re-date live broadcasts to
// when they aired, and attach runtimes. A video with no entry keeps its feed
// date and its null duration. Pure — exported for unit tests.
export function applyVideoFacts<T extends Video>(
	videos: T[],
	facts: Map<string, VideoFacts>,
): T[] {
	return videos.map((v) => {
		const f = facts.get(v.id);
		if (!f) return v;
		return {
			...v,
			...(f.started_at != null ? { published_at: f.started_at } : {}),
			...(f.duration_seconds != null
				? { duration_seconds: f.duration_seconds }
				: {}),
		};
	});
}

// Broadcast start instants for `ids`, via videos.list, batched at
// VIDEOS_LIST_BATCH. `degraded` is true when any batch failed, so its videos
// still carry the feed's VOD dates.
//
// NEVER throws, unlike the feed fetches around it. Enrichment improves a date we
// already have; it is not a precondition for having one. A quota-exhausted or
// failing videos.list therefore degrades that batch to its feed <published> —
// exactly the pre-enrichment behavior — rather than discarding a feed we already
// fetched successfully. Each batch is independent, so one bad page doesn't cost
// the others. What the caller must not do is let a degraded result be cached;
// that is what `degraded` is for.
async function fetchVideoFacts(
	ids: string[],
	apiKey: string,
): Promise<{ facts: Map<string, VideoFacts>; degraded: boolean }> {
	const facts = new Map<string, VideoFacts>();
	let degraded = false;
	for (let i = 0; i < ids.length; i += VIDEOS_LIST_BATCH) {
		const url = new URL("https://www.googleapis.com/youtube/v3/videos");
		url.searchParams.set("part", "liveStreamingDetails,contentDetails");
		url.searchParams.set("id", ids.slice(i, i + VIDEOS_LIST_BATCH).join(","));
		url.searchParams.set("key", apiKey);
		try {
			const res = await fetch(url);
			if (!res.ok) {
				const detail = await res.text().catch(() => "");
				logError("youtube_videos_list_failed", null, {
					yt_status: res.status,
					yt_detail: detail.slice(0, 500),
				});
				degraded = true;
				continue;
			}
			for (const [id, f] of parseVideosListPage(await res.json())) {
				facts.set(id, f);
			}
		} catch (e) {
			logError("youtube_videos_list_failed", e);
			degraded = true;
		}
	}
	return { facts, degraded };
}

// Correct the feed's dates for live content, where a key allows it. Without one
// every date stands as the feed gave it — the channel path stays usable with no
// credentials (see the module header), and that is not a degraded result but
// the documented keyless behavior, so `degraded` stays false.
//
// Callers must re-sort afterwards — moving a broadcast back to its air time can
// push it past a video published after it — and must throw UncacheableVideos
// with the finished list when `degraded`, once the rest of their pipeline has
// run.
async function withVideoFacts<T extends Video>(
	videos: T[],
	apiKey: string | undefined,
): Promise<{ videos: T[]; degraded: boolean }> {
	if (!apiKey || videos.length === 0) return { videos, degraded: false };
	// Distinct ids only — a playlist may list one video twice (see dedupeById),
	// and a repeat would otherwise burn a slot in the 50-id batch.
	const ids = [...new Set(videos.map((v) => v.id))];
	const { facts, degraded } = await fetchVideoFacts(ids, apiKey);
	return { videos: applyVideoFacts(videos, facts), degraded };
}

async function fetchYouTubeRecent(
	channelId: string,
	env: VideoEnv,
): Promise<Video[]> {
	const res = await fetch(
		`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
	);
	if (!res.ok) {
		// A deleted/renamed channel returns 404 — a real "no videos" state, not
		// a transient error, so don't throw (caching [] is correct here).
		if (res.status === 404) return [];
		throw new Error(`youtube feed responded ${res.status}`);
	}
	const xml = await res.text();
	// The cap runs on the feed's own order, so the feed's dates still decide
	// which entries we keep: enrichment only ever moves a broadcast earlier, so
	// one of the ~3 entries past the cap can be newer than a kept broadcast and
	// go unsurfaced anyway. Then re-sort — that same shift can move a broadcast
	// past a video published after it.
	const { videos, degraded } = await withVideoFacts(
		parseYouTubeFeed(xml).slice(0, MAX_VIDEOS),
		env.YOUTUBE_API_KEY,
	);
	const recent = videos.sort(byPublishedDesc);
	// Enrichment failed: these are the feed's VOD dates, i.e. the bug. Serve
	// them, but keep them out of the cache.
	if (degraded) throw new UncacheableVideos(recent);
	return recent;
}

// A YouTube playlist can list the same video in more than one slot — a curator
// re-adds a match recording, so it appears twice. Collapse to one entry per
// video id, keeping the first occurrence. Applied before the cap so a duplicate
// doesn't burn a slot, and so the tournament Videos read never emits two entries
// with the same platform+id — which the page's keyed {#each} rejects with
// each_key_duplicate. Order-preserving.
//
// Exported for the cross-tournament home feed, which merges several playlists
// and so has the same collapse to make across them (mergeTournamentFeed).
export function dedupeById<T extends { id: string }>(videos: T[]): T[] {
	const seen = new Set<string>();
	return videos.filter((v) => {
		if (seen.has(v.id)) return false;
		seen.add(v.id);
		return true;
	});
}

// Recent uploads for a playlist, from the same free, unauthenticated Atom feed
// as the channel path — `?playlist_id=…` instead of `?channel_id=…` — so no key
// and no quota. Uncached (the cache layer wraps this via getVideosCached).
// Returns [] for a missing/private playlist (404); THROWS on a transient
// upstream failure so the cache keeps serving a prior good result. Exported for
// the tournament videos read.
//
// Live content keeps the feed's VOD date here: correcting it needs videos.list,
// and this path only runs when there is no key to call it with — a keyed
// deployment takes fetchYouTubePlaylistVideosViaApi instead.
export async function fetchYouTubePlaylistVideos(
	playlistId: string,
): Promise<PlaylistVideo[]> {
	const res = await fetch(
		`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`,
	);
	if (!res.ok) {
		if (res.status === 404) return [];
		throw new Error(`youtube playlist feed responded ${res.status}`);
	}
	const xml = await res.text();
	// A playlist feed comes back in playlist order, which isn't necessarily
	// chronological (a curated or append-ordered playlist won't be) — so sort
	// newest-first before capping, both to honor the "newest first" contract the
	// Videos tab documents and so the cap keeps the newest entries, not whichever
	// happen to sit first. Mirrors the home feed's ordering (mergeCreatorFeed).
	return dedupeById(parseYouTubePlaylistFeed(xml).sort(byPublishedDesc)).slice(
		0,
		MAX_VIDEOS,
	);
}

// One item as returned by playlistItems.list (only the fields we read).
interface PlaylistItemsResponse {
	nextPageToken?: string;
	items?: {
		snippet?: {
			title?: string;
			resourceId?: { videoId?: string };
			thumbnails?: Record<string, { url?: string } | undefined>;
			videoOwnerChannelId?: string;
			videoOwnerChannelTitle?: string;
		};
		contentDetails?: { videoId?: string; videoPublishedAt?: string };
	}[];
}

// Normalize one playlistItems entry into a PlaylistVideo, or null when it isn't
// a watchable video. A private/deleted/region-blocked entry keeps its playlist
// slot but drops contentDetails.videoPublishedAt (and its owner/thumbnails), so
// that field is both the "is this real" signal and the true publish instant we
// sort by — mirroring the RSS path's <published>. Uploader channel id/name feed
// the same attribution as parseYouTubePlaylistFeed.
function playlistItemToVideo(
	item: NonNullable<PlaylistItemsResponse["items"]>[number],
): PlaylistVideo | null {
	const snippet = item.snippet;
	const id = item.contentDetails?.videoId ?? snippet?.resourceId?.videoId;
	const published_at = item.contentDetails?.videoPublishedAt;
	if (!id || !snippet || !published_at) return null;
	const thumbs = snippet.thumbnails ?? {};
	return {
		id,
		// playlistItems.list carries no duration; the videos.list pass adds it.
		duration_seconds: null,
		title: snippet.title ?? "",
		url: `https://www.youtube.com/watch?v=${id}`,
		thumbnail_url:
			thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null,
		published_at,
		platform: "youtube",
		uploader_channel_id: snippet.videoOwnerChannelId ?? null,
		uploader_name: snippet.videoOwnerChannelTitle ?? null,
	};
}

// Parse one playlistItems.list page into its videos plus the token for the next
// page (null when this is the last). Pure — exported for unit tests.
export function parsePlaylistItemsPage(data: unknown): {
	videos: PlaylistVideo[];
	nextPageToken: string | null;
} {
	const page = (data ?? {}) as PlaylistItemsResponse;
	const videos: PlaylistVideo[] = [];
	for (const item of page.items ?? []) {
		const video = playlistItemToVideo(item);
		if (video) videos.push(video);
	}
	return { videos, nextPageToken: page.nextPageToken ?? null };
}

// Every video in a playlist, via the YouTube Data API (playlistItems.list) —
// the full-playlist source behind the tournament Videos tab's search. Unlike the
// free Atom feed (fetchYouTubePlaylistVideos), which only ever returns the ~15
// most recent entries, this pages through the whole playlist, so it needs the
// Data API key and spends quota (1 unit/page, plus one per 50 videos for the
// broadcast-start pass). Uncached (getVideosCached wraps it). Returns [] for a
// missing/private playlist (404); THROWS on a transient upstream failure so the
// cache keeps serving a prior good result, and throws UncacheableVideos when
// only the broadcast-start pass failed. Sorted newest-first and capped like the
// RSS path, for the same reasons.
export async function fetchYouTubePlaylistVideosViaApi(
	playlistId: string,
	apiKey: string,
): Promise<PlaylistVideo[]> {
	const all: PlaylistVideo[] = [];
	const maxPages = MAX_PLAYLIST_VIDEOS / PLAYLIST_PAGE_SIZE;
	let pageToken: string | null = null;
	let pages = 0;
	do {
		const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
		url.searchParams.set("part", "snippet,contentDetails");
		url.searchParams.set("playlistId", playlistId);
		url.searchParams.set("maxResults", String(PLAYLIST_PAGE_SIZE));
		url.searchParams.set("key", apiKey);
		if (pageToken) url.searchParams.set("pageToken", pageToken);
		const res = await fetch(url);
		if (!res.ok) {
			// A missing/deleted playlist is a real "no videos" state, not a transient
			// error — cache [] rather than throwing (mirrors the RSS 404 handling).
			if (res.status === 404) return [];
			const detail = await res.text().catch(() => "");
			logError("youtube_playlist_api_failed", null, {
				yt_status: res.status,
				yt_detail: detail.slice(0, 500),
			});
			throw new Error(`youtube playlistItems responded ${res.status}`);
		}
		const { videos, nextPageToken } = parsePlaylistItemsPage(await res.json());
		all.push(...videos);
		pageToken = nextPageToken;
		pages++;
	} while (pageToken && pages < maxPages);
	// Stopped with a page token still in hand ⇒ the playlist is longer than the
	// cap; record what we dropped rather than silently truncating.
	if (pageToken) {
		logWarn("youtube_playlist_capped", {
			playlist_id: playlistId,
			kept: all.length,
			cap: MAX_PLAYLIST_VIDEOS,
		});
	}
	// Enrich before sorting so the order reflects when casts aired, not when
	// their VODs went public — two casts from one evening can otherwise land in
	// the order their VODs were published the next day.
	const { videos, degraded } = await withVideoFacts(all, apiKey);
	const listed = dedupeById(videos.sort(byPublishedDesc)).slice(
		0,
		MAX_PLAYLIST_VIDEOS,
	);
	// Enrichment failed: these are the feed's VOD dates, i.e. the bug. Serve
	// them, but keep them out of the cache.
	if (degraded) throw new UncacheableVideos(listed);
	return listed;
}

export const youtubeProvider: VideoProvider = {
	platform: "youtube",
	matches: (rawUrl) => parseYouTubeChannelUrl(rawUrl) !== null,
	resolve: resolveYouTube,
	fetchRecent: fetchYouTubeRecent,
};
