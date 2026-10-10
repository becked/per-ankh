// Self-service video/stream channels + the public recent-videos read.
//
// Self CRUD lives under /v1/auth/channels (session-scoped, mirroring
// /v1/auth/settings): a user pastes a channel URL, the Worker detects the
// platform and resolves it to a native id (cloud/src/video/), then stores it
// in user_video_channels. The public read GET /v1/users/:id/videos merges each
// linked channel's recent uploads (KV-cached, stale-while-revalidate) for the
// profile "Videos" tab.
//
// The owner-featured set (/v1/auth/featured-videos, user_featured_videos) is
// also here: a user's own pick of their uploads, pinned to the front of that
// same read. It lives in this module rather than beside the site-admin set
// (cloud/src/featured.ts) because both ends of the write are here — it is
// validated against this module's channel feeds, and the only read that
// renders it is this module's public profile read.
//
// Multi-platform by construction — every platform-specific concern is behind
// the provider registry; YouTube ships first, Twitch et al. register a
// provider with no change here.

import * as v from "valibot";
import { buildAvatarUrl } from "./auth";
import { displayNameSql } from "./identity";
import { logError } from "./log";
import { AddChannelSchema } from "./schemas/channel";
import { FeatureMyVideoSchema } from "./schemas/featured";
import { sessionFromRequest, type SessionEnv } from "./session";
import {
	cloudCorsHeaders,
	errorResponse,
	jsonResponse,
	parseJsonBody,
} from "./util";
import { getRecentVideosCached } from "./video/cache";
import {
	providerForPlatform,
	providerForUrl,
	supportedPlatforms,
} from "./video/registry";
import {
	byPublishedDesc,
	ChannelResolutionError,
	type Video,
	type VideoEnv,
	type VideoPlatform,
} from "./video/types";
import type { QueryableD1 } from "./d1";

export interface ChannelsEnv extends SessionEnv, VideoEnv {
	SHARE_DB: QueryableD1;
	ALLOWED_ORIGINS: string;
}

// Cap on merged videos returned for a profile — a couple of channels' worth of
// recent uploads is plenty for the tab.
const MAX_MERGED_VIDEOS = 24;

// The public, user-set fields of a channel. channel_id is native/opaque and
// safe to expose (it's already in the public channel URL).
interface ChannelRow {
	platform: string;
	channel_url: string;
	channel_id: string;
}

// GET /v1/auth/channels — the signed-in user's own linked channels.
export async function handleListMyChannels(
	request: Request,
	env: ChannelsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	}

	const rows = await env.SHARE_DB.prepare(
		`SELECT platform, channel_url, channel_id
		 FROM user_video_channels WHERE user_id = ? ORDER BY platform`,
	)
		.bind(session.data.user_id)
		.all<ChannelRow>();

	return jsonResponse({ channels: rows.results ?? [] }, 200, cors);
}

// POST /v1/auth/channels — add or replace the signed-in user's channel for the
// platform the pasted URL belongs to. Resolves the URL to a native id before
// storing; one channel per platform (upsert on the (user_id, platform) PK).
export async function handleAddChannel(
	request: Request,
	env: ChannelsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	}

	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		return errorResponse("Invalid JSON body", 400, cors, "INVALID_JSON");
	}
	const validation = v.safeParse(AddChannelSchema, parsed);
	if (!validation.success) {
		return errorResponse(
			`Invalid body: ${validation.issues[0]?.message ?? "unknown"}`,
			400,
			cors,
			"INVALID_BODY",
		);
	}
	const { url } = validation.output;

	const provider = providerForUrl(url);
	if (!provider) {
		return errorResponse(
			`That platform isn't supported yet. Supported: ${supportedPlatforms().join(", ")}.`,
			422,
			cors,
			"UNSUPPORTED_PLATFORM",
		);
	}

	let identity;
	try {
		identity = await provider.resolve(url, env);
	} catch (err) {
		if (err instanceof ChannelResolutionError) {
			return errorResponse(err.message, err.httpStatus, cors, err.code);
		}
		logError("channel_resolve_error", err, { platform: provider.platform });
		return errorResponse(
			"Couldn't add that channel right now. Please try again later.",
			502,
			cors,
			"RESOLVE_ERROR",
		);
	}

	await env.SHARE_DB.prepare(
		`INSERT INTO user_video_channels (user_id, platform, channel_url, channel_id)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id, platform) DO UPDATE SET
		   channel_url = excluded.channel_url,
		   channel_id  = excluded.channel_id,
		   updated_at  = datetime('now')`,
	)
		.bind(
			session.data.user_id,
			identity.platform,
			identity.channel_url,
			identity.channel_id,
		)
		.run();

	return jsonResponse(
		{
			channel: {
				platform: identity.platform,
				channel_url: identity.channel_url,
				channel_id: identity.channel_id,
			},
		},
		200,
		cors,
	);
}

// DELETE /v1/auth/channels/:platform — remove the signed-in user's channel for
// a platform. Idempotent: deleting an absent channel still succeeds.
export async function handleDeleteChannel(
	platform: string,
	request: Request,
	env: ChannelsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	}

	await env.SHARE_DB.prepare(
		"DELETE FROM user_video_channels WHERE user_id = ? AND platform = ?",
	)
		.bind(session.data.user_id, platform)
		.run();

	return jsonResponse({ ok: true }, 200, cors);
}

// --- Attributed video reads ------------------------------------------------
//
// Both public reads below are the same thing at two widths: linked channels
// joined to their owner, each channel's recent uploads fetched (KV-cached,
// SWR) and tagged with that owner. One profile's channels for the Videos tab,
// every creator's for the home strip.
//
// Every video carries its uploader even where the surface won't render the
// credit, because attribution has to survive being copied off the card: the
// admin featured set snapshots exactly the fields the card it was starred from
// was holding (see cloud/src/featured.ts), so a feed that omits the uploader
// produces a permanently unattributed featured row.
//
// Attribution is applied AFTER the cache, so the cached per-channel lists stay
// identity-free and a rename needs no eviction.

// A video attributed to the Per-Ankh user whose linked channel published it,
// so a surface can credit the uploader and link to their profile.
export interface CreatorVideo extends Video {
	user_id: string;
	display_name: string;
	// Null for a user who has no slug; their profile link falls back to the
	// /users/<user_id> permalink.
	slug: string | null;
	avatar_url: string;
}

// One linked channel joined to its owner — the SELECT both reads run, and the
// row it lands in. Callers append their own WHERE (one profile) or none (every
// creator). The join is inner: user_video_channels.user_id is an ON DELETE
// CASCADE foreign key, so a channel row without its user is not a state that
// exists.
const CHANNELS_WITH_OWNER_SQL = `SELECT c.user_id, c.platform, c.channel_id,
        ${displayNameSql("u")} AS display_name,
        u.slug, u.discord_id, u.avatar_hash
 FROM user_video_channels c
 JOIN users u ON u.user_id = c.user_id`;

interface ChannelWithOwner {
	user_id: string;
	platform: string;
	channel_id: string;
	display_name: string;
	slug: string | null;
	discord_id: string;
	avatar_hash: string | null;
}

// One channel's recent uploads, each tagged with the creator who owns it.
function attributedChannelVideos(
	env: ChannelsEnv,
	ctx: ExecutionContext,
	channel: ChannelWithOwner,
): Promise<CreatorVideo[]> {
	const provider = providerForPlatform(channel.platform);
	// A stored platform with no registered provider (e.g. one removed in a
	// later release) simply contributes nothing.
	if (!provider) return Promise.resolve([]);
	const author = {
		user_id: channel.user_id,
		display_name: channel.display_name,
		slug: channel.slug,
		avatar_url: buildAvatarUrl(channel.discord_id, channel.avatar_hash),
	};
	return getRecentVideosCached(env, provider, channel.channel_id, ctx).then(
		(videos) => videos.map((video) => ({ ...video, ...author })),
	);
}

// One profile's uploads across every channel its owner has linked, each tagged
// with that owner. Two callers: the public read below, and the feature write
// further down — which validates against exactly the feed the tab renders, so
// any video a user can see a pin on is one they can pin. Unsorted and uncapped;
// both callers impose their own.
async function userChannelVideos(
	env: ChannelsEnv,
	ctx: ExecutionContext,
	userId: string,
): Promise<CreatorVideo[]> {
	const rows = await env.SHARE_DB.prepare(
		`${CHANNELS_WITH_OWNER_SQL} WHERE c.user_id = ?`,
	)
		.bind(userId)
		.all<ChannelWithOwner>();

	const perChannel = await Promise.all(
		(rows.results ?? []).map((c) => attributedChannelVideos(env, ctx, c)),
	);
	return perChannel.flat();
}

// One row of the owner-featured read: the stored snapshot (migration 0050),
// plus the owner's live identity from the join. The same split the admin set
// makes — the platform's fields are frozen, identity is not — with no
// attribution to discriminate, because here the owner IS the uploader.
interface UserFeaturedVideoRow {
	platform: VideoPlatform;
	video_id: string;
	url: string;
	title: string;
	thumbnail_url: string | null;
	published_at: string;
	user_id: string;
	display_name: string;
	slug: string | null;
	discord_id: string;
	avatar_hash: string | null;
}

// One user's featured videos, newest first — the read behind both the public
// profile read and the owner's own list, so the snapshot columns and the
// identity join can't drift apart between them.
//
// The join is inner for the same reason CHANNELS_WITH_OWNER_SQL's is:
// user_featured_videos.user_id is an ON DELETE CASCADE foreign key, so a row
// without its user is not a state that exists.
async function selectUserFeaturedVideos(
	db: QueryableD1,
	userId: string,
): Promise<CreatorVideo[]> {
	const rows = await db
		.prepare(
			`SELECT f.platform, f.video_id, f.url, f.title, f.thumbnail_url,
			        f.published_at, f.user_id,
			        ${displayNameSql("u")} AS display_name,
			        u.slug, u.discord_id, u.avatar_hash
			 FROM user_featured_videos f
			 JOIN users u ON u.user_id = f.user_id
			 WHERE f.user_id = ?
			 ORDER BY f.published_at DESC`,
		)
		.bind(userId)
		.all<UserFeaturedVideoRow>();

	return (rows.results ?? []).map((row): CreatorVideo => ({
		id: row.video_id,
		title: row.title,
		url: row.url,
		thumbnail_url: row.thumbnail_url,
		published_at: row.published_at,
		platform: row.platform,
		// The table has no duration column, so this is null for every
		// featured video rather than merely unknown for some — the same gap
		// the admin snapshots carry (attributeFeaturedVideo in
		// cloud/src/featured.ts). Typed as CreatorVideo rather than left
		// inferred so the next field added to Video fails here instead of
		// silently shipping a featured card that is missing it.
		duration_seconds: null,
		user_id: row.user_id,
		display_name: row.display_name,
		slug: row.slug,
		avatar_url: buildAvatarUrl(row.discord_id, row.avatar_hash),
	}));
}

// The identity of a video wherever it is keyed — the (platform, video_id) pair
// the caches, the stored rows' primary keys and the frontend's list keys all
// use.
function videoKey(video: Video): string {
	return `${video.platform}:${video.id}`;
}

// The Videos tab's order: the owner's featured videos first, then the rest of
// the live feed, each half newest-first. Pure, so the ordering has a unit test
// rather than only an integration one.
//
// Server-side, unlike the home strip's own featuredFirst (src/routes/+page.ts),
// which runs in the page load against a set the layout fetches for admins
// only. This order is part of what the public read answers, so an anonymous
// visitor sees the owner's picks at the top of the tab.
//
// The snapshots are what render, not the feed's own copies of them: a featured
// video outlives the ~15-entry feed it came from, so the snapshot is the entry
// that is always there — and dropping the feed copy is also what keeps one
// video from rendering twice and crashing the tab's keyed {#each} with
// each_key_duplicate.
export function featuredFirst(
	featured: CreatorVideo[],
	feed: CreatorVideo[],
): CreatorVideo[] {
	const keys = new Set(featured.map(videoKey));
	return [
		...[...featured].sort(byPublishedDesc),
		...feed.filter((v) => !keys.has(videoKey(v))),
	];
}

// GET /v1/users/:user_id/videos — public. The user's featured videos first
// (see featuredFirst), then recent uploads across their linked channels (each
// KV-cached, SWR). No auth: channels are user-published, the featured set is
// the owner's own curation, and both are the same for every viewer. The
// uploader on each video is the profile's own owner — the display name and
// avatar this page's header already serves publicly — so the tab renders the
// cards with the credit suppressed rather than repeating it once per card.
export async function handleUserVideos(
	userId: string,
	request: Request,
	env: ChannelsEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const [featured, feed] = await Promise.all([
		selectUserFeaturedVideos(env.SHARE_DB, userId),
		userChannelVideos(env, ctx, userId),
	]);

	// The cap applies after the promotion, so featuring costs the tab nothing
	// but reorders it. The featured set is uncapped by design (migration 0050),
	// which means a user who features more than this fills the tab with their
	// own picks — their call, and the same trade the home strip makes.
	const videos = featuredFirst(
		featured,
		// Newest first across all platforms.
		feed.sort(byPublishedDesc),
	).slice(0, MAX_MERGED_VIDEOS);

	return jsonResponse({ videos }, 200, cors);
}

// --- Owner-featured writes -------------------------------------------------
//
// A user's own pick of their uploads, pinned to the front of the read above.
// The user-scoped twin of the site-admin featured set (cloud/src/featured.ts),
// session-scoped like /v1/auth/channels, and stored as a snapshot for the same
// reason that set is: the video a creator wants at the top of their tab is the
// one that ages out of the ~15-entry feed first (migration 0050).

// GET /v1/auth/featured-videos — the signed-in user's own featured set, newest
// first. What the pin on a card reads its state from, and what the account
// page's Featured tab manages; the public copy of the same rows is already at
// the front of their profile's Videos tab.
export async function handleListMyFeaturedVideos(
	request: Request,
	env: ChannelsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	}

	return jsonResponse(
		{
			videos: await selectUserFeaturedVideos(
				env.SHARE_DB,
				session.data.user_id,
			),
		},
		200,
		cors,
	);
}

// POST /v1/auth/featured-videos — feature one of the signed-in user's own
// videos, named by platform + id.
//
// The snapshot is taken from the user's own channel feeds, never from the
// body: the row renders on a public profile under the owner's name, so the
// title, URL and thumbnail have to come from the platform rather than from
// whoever is holding the session. That is also what makes "their own upload"
// true of every row in the table — a video in nobody's linked channel but
// theirs can't be featured, so the identity the read joins is the uploader's.
// The admin write can accept a snapshot body (cloud/src/featured.ts) because
// its caller is trusted; this one can't.
//
// Upserts on (user_id, platform, video_id), like that write: re-featuring a
// video already in the set refreshes its snapshot (a re-titled video, a rotated
// thumbnail) rather than failing, which also makes the pin safe to press twice.
export async function handleFeatureMyVideo(
	request: Request,
	env: ChannelsEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	}

	const parsed = await parseJsonBody(request, FeatureMyVideoSchema, cors);
	if (!parsed.ok) return parsed.response;
	const { platform, video_id } = parsed.body;

	const feed = await userChannelVideos(env, ctx, session.data.user_id);
	const video = feed.find((v) => v.platform === platform && v.id === video_id);
	if (!video) {
		return errorResponse(
			"That video isn't one of your channels' uploads.",
			400,
			cors,
			"VIDEO_NOT_IN_CHANNELS",
		);
	}

	await env.SHARE_DB.prepare(
		`INSERT INTO user_featured_videos (
		   user_id, platform, video_id, url, title, thumbnail_url, published_at
		 ) VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, platform, video_id) DO UPDATE SET
		   url           = excluded.url,
		   title         = excluded.title,
		   thumbnail_url = excluded.thumbnail_url,
		   published_at  = excluded.published_at,
		   featured_at   = datetime('now')`,
	)
		.bind(
			session.data.user_id,
			video.platform,
			video.id,
			video.url,
			video.title,
			video.thumbnail_url,
			video.published_at,
		)
		.run();

	return jsonResponse({ ok: true }, 200, cors);
}

// DELETE /v1/auth/featured-videos/:platform/:video_id — unfeature. Idempotent,
// mirroring handleDeleteChannel and the admin unfeature: the pin on a card and
// the Featured tab's Remove can both reach a row, and neither should have to
// know which got there first.
export async function handleUnfeatureMyVideo(
	platform: string,
	videoId: string,
	request: Request,
	env: ChannelsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	}

	await env.SHARE_DB.prepare(
		`DELETE FROM user_featured_videos
		 WHERE user_id = ? AND platform = ? AND video_id = ?`,
	)
		.bind(session.data.user_id, platform, videoId)
		.run();

	return jsonResponse({ ok: true }, 200, cors);
}

// --- Cross-creator home feed ---------------------------------------------
//
// The home page shows the newest Old World uploads ACROSS every user's linked
// channels (multiple per creator allowed), merged newest-first and capped to
// fill a two-row strip. Channels are linked wholesale, so the uploads they
// return cover whatever else their owner posts — mergeCreatorFeed narrows them
// to Old World by title.
//
// Channel MEMBERSHIP is read from D1 on every request (mirroring the
// per-profile read above), so adding or removing a channel is reflected
// immediately — there is no aggregate cache to invalidate. Only the expensive
// part — each channel's recent uploads — is cached: getRecentVideosCached
// serves per-channel videos from KV (SWR, 1h soft / 24h hard), so a home
// request fans out a D1 join plus a handful of mostly-warm KV reads, never a
// live YouTube fetch per channel. A short edge cache on the response (see
// handleCreatorVideos) sheds repeated origin hits without holding stale
// membership.

// Display cap — the home strip's twelve cards. The strip merges this feed with
// the tournament-playlist one (GET /v1/tournament-videos, capped to match), so
// all three caps — both feeds' and the page's VIDEO_STRIP_SIZE — move together.
const MAX_CREATOR_FEED_VIDEOS = 12;

// The home strip is an Old World feed, not a general creator feed: a linked
// channel usually covers several games, so an upload only belongs here if it
// names Old World in its title. Deliberately a strict case-insensitive
// substring rather than a looser alias match ("OW", event names): what reaches
// the home page stays predictable, at the cost of dropping Old World content
// that never spells the game out. A creator's own profile Videos tab is
// unfiltered — this applies to the cross-creator feed only.
function titlesOldWorld(video: Video): boolean {
	return video.title.toLowerCase().includes("old world");
}

// Merge per-channel lists (each already attributed to its creator) into the
// home feed: Old World uploads only, newest-first across all creators, capped.
// The filter runs before the cap — filtering downstream (in the component, or
// after this slice) would let a creator's unrelated uploads consume the strip's
// slots and then vanish, leaving it half-empty. Pure — the DB query and
// per-channel fetch live in buildCreatorFeed.
export function mergeCreatorFeed(
	perChannel: CreatorVideo[][],
	cap = MAX_CREATOR_FEED_VIDEOS,
): CreatorVideo[] {
	return perChannel
		.flat()
		.filter(titlesOldWorld)
		.sort(byPublishedDesc)
		.slice(0, cap);
}

// Assemble the feed: every linked channel joined to its owner, each channel's
// recent uploads (per-channel KV cache, SWR) tagged with the creator, then
// merged/capped. Runs on the request path (see handleCreatorVideos).
async function buildCreatorFeed(
	env: ChannelsEnv,
	ctx: ExecutionContext,
): Promise<CreatorVideo[]> {
	const rows = await env.SHARE_DB.prepare(
		CHANNELS_WITH_OWNER_SQL,
	).all<ChannelWithOwner>();

	const perChannel = await Promise.all(
		(rows.results ?? []).map((c) => attributedChannelVideos(env, ctx, c)),
	);

	return mergeCreatorFeed(perChannel);
}

// GET /v1/creator-videos — public. The cross-creator home feed (see above).
// No auth, no PII: same public, user-published videos for every viewer.
export async function handleCreatorVideos(
	request: Request,
	env: ChannelsEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	// Best-effort, mirroring the home load's own .catch(() => []): a D1 hiccup
	// returns an empty strip rather than 500-ing the page. Per-channel fetches
	// already swallow their own upstream failures to [] (getRecentVideosCached).
	let videos: CreatorVideo[] = [];
	try {
		videos = await buildCreatorFeed(env, ctx);
	} catch (e) {
		logError("creator_feed_fetch_failed", e);
	}
	// Edge-cache 60s (s-maxage) so repeated home hits don't re-run the join +
	// KV fan-out at the origin. No browser cache (max-age=0): a viewer who just
	// added or removed a channel sees it on reload rather than waiting out a
	// browser TTL — the freshness this rework is for. Vary: Origin because the
	// CORS headers are origin-specific and the response is shared-cacheable.
	return new Response(JSON.stringify({ videos }), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=0, s-maxage=60",
			...cors,
			Vary: "Origin",
		},
	});
}
