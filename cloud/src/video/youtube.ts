// YouTube video provider.
//
// Resolution is the "hybrid" strategy: a `…/channel/UC…` URL carries the
// native id directly (no API call), while an @handle or legacy /user/ name is
// resolved to its UC… id via one YouTube Data API call (1 quota unit). Recent
// videos are then pulled from the free, unauthenticated per-channel Atom feed
// (`/feeds/videos.xml?channel_id=UC…`) — so the recurring hot path needs no
// key and costs no quota; only the one-time resolve does.

import { logError } from "../log";
import {
	ChannelResolutionError,
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

async function fetchYouTubeRecent(
	channelId: string,
	_env: VideoEnv,
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
	return parseYouTubeFeed(xml).slice(0, MAX_VIDEOS);
}

// Recent uploads for a playlist, from the same free, unauthenticated Atom feed
// as the channel path — `?playlist_id=…` instead of `?channel_id=…` — so no key
// and no quota. Uncached (the cache layer wraps this via getVideosCached).
// Returns [] for a missing/private playlist (404); THROWS on a transient
// upstream failure so the cache keeps serving a prior good result. Exported for
// the tournament videos read.
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
	// happen to sit first. Mirrors the home feed's ordering (mergeCreatorFeed);
	// ISO timestamps sort lexically and entries missing a date fall to the end.
	return parseYouTubePlaylistFeed(xml)
		.sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
		.slice(0, MAX_VIDEOS);
}

export const youtubeProvider: VideoProvider = {
	platform: "youtube",
	matches: (rawUrl) => parseYouTubeChannelUrl(rawUrl) !== null,
	resolve: resolveYouTube,
	fetchRecent: fetchYouTubeRecent,
};
