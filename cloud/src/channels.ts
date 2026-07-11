// Self-service video/stream channels + the public recent-videos read.
//
// Self CRUD lives under /v1/auth/channels (session-scoped, mirroring
// /v1/auth/settings): a user pastes a channel URL, the Worker detects the
// platform and resolves it to a native id (cloud/src/video/), then stores it
// in user_video_channels. The public read GET /v1/users/:id/videos merges each
// linked channel's recent uploads (KV-cached, stale-while-revalidate) for the
// profile "Videos" tab.
//
// Multi-platform by construction — every platform-specific concern is behind
// the provider registry; YouTube ships first, Twitch et al. register a
// provider with no change here.

import * as v from "valibot";
import { buildAvatarUrl } from "./auth";
import { displayNameSql } from "./identity";
import { logError } from "./log";
import { AddChannelSchema } from "./schemas/channel";
import { sessionFromRequest, type SessionEnv } from "./session";
import { cloudCorsHeaders, errorResponse, jsonResponse } from "./util";
import { getRecentVideosCached } from "./video/cache";
import {
	providerForPlatform,
	providerForUrl,
	supportedPlatforms,
} from "./video/registry";
import {
	ChannelResolutionError,
	type Video,
	type VideoEnv,
} from "./video/types";

export interface ChannelsEnv extends SessionEnv, VideoEnv {
	SHARE_DB: D1Database;
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

// GET /v1/users/:user_id/videos — public. Merges recent uploads across the
// user's linked channels (each KV-cached, SWR). No auth, no PII: channels are
// user-published and videos are the same for every viewer.
export async function handleUserVideos(
	userId: string,
	request: Request,
	env: ChannelsEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const rows = await env.SHARE_DB.prepare(
		"SELECT platform, channel_id FROM user_video_channels WHERE user_id = ?",
	)
		.bind(userId)
		.all<{ platform: string; channel_id: string }>();

	const channels = rows.results ?? [];

	const perChannel = await Promise.all(
		channels.map((c): Promise<Video[]> => {
			const provider = providerForPlatform(c.platform);
			// A stored platform with no registered provider (e.g. one removed in
			// a later release) simply contributes nothing.
			if (!provider) return Promise.resolve([]);
			return getRecentVideosCached(env, provider, c.channel_id, ctx);
		}),
	);

	const videos = perChannel
		.flat()
		// Newest first across all platforms; ISO timestamps sort lexically.
		.sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
		.slice(0, MAX_MERGED_VIDEOS);

	return jsonResponse({ videos }, 200, cors);
}

// --- Cross-creator home feed ---------------------------------------------
//
// The home page shows the newest uploads ACROSS every user's linked channels
// (multiple per creator allowed), merged newest-first and capped to fill a
// two-row strip. Unlike the per-profile read above, this is cached as ONE
// pre-assembled KV entry (not per channel), so a home-page request costs a
// single KV read and NEVER fans out across every creator's feed on the request
// path.
//
// Stale-while-revalidate, mirroring getRecentVideosCached: a fresh entry is
// served as-is; a stale entry is served immediately while a background refresh
// (ctx.waitUntil) re-assembles it; a cold miss builds SYNCHRONOUSLY, caches the
// result, and returns it, so the first request already gets the feed. Nothing
// else populates this entry, so a non-blocking cold miss would leave the home
// strip empty until some later visit happened to warm it. The synchronous cost
// is bounded: the per-channel fetches run in parallel and mostly hit warm
// caches, so a cold build is ~one RSS fetch of latency at worst. An empty feed
// is never cached nor served from cache (see rebuildCreatorFeed / getCreatorFeed):
// a transient all-fail can't blank the strip for the TTL, and a fresh upload
// shows up without waiting one out.

// Display cap — two rows of four on the desktop strip. Applied when building
// the cached feed AND again at serve time (see handleCreatorVideos), so
// lowering it takes effect immediately rather than after the cache expires.
const MAX_CREATOR_FEED_VIDEOS = 8;
const CREATOR_FEED_KEY = "creator_feed:v1:all";
const CREATOR_FEED_SOFT_TTL_MS = 60 * 60 * 1000; // 1h
const CREATOR_FEED_HARD_TTL_S = 24 * 60 * 60; // 24h

// A home-feed video: the normalized Video plus the creator it belongs to, so
// the strip can attribute each upload and link to the uploader's profile.
export interface CreatorVideo extends Video {
	user_id: string;
	display_name: string;
	avatar_url: string;
}

interface CachedCreatorFeed {
	fetched_at: number; // epoch ms
	videos: CreatorVideo[];
}

// Merge per-channel lists (each already attributed to its creator) into the
// home feed: newest-first across all creators, capped. Pure — the DB query and
// per-channel fetch live in buildCreatorFeed. ISO timestamps sort lexically.
export function mergeCreatorFeed(
	perChannel: CreatorVideo[][],
	cap = MAX_CREATOR_FEED_VIDEOS,
): CreatorVideo[] {
	return perChannel
		.flat()
		.sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
		.slice(0, cap);
}

// Assemble the feed from scratch: every linked channel joined to its owner,
// each channel's recent uploads (per-channel KV cache, SWR) tagged with the
// creator, then merged/capped. Runs off the request path (see getCreatorFeed).
async function buildCreatorFeed(
	env: ChannelsEnv,
	ctx: ExecutionContext,
): Promise<CreatorVideo[]> {
	const rows = await env.SHARE_DB.prepare(
		`SELECT c.user_id, c.platform, c.channel_id,
		        ${displayNameSql("u")} AS display_name,
		        u.discord_id, u.avatar_hash
		 FROM user_video_channels c
		 JOIN users u ON u.user_id = c.user_id`,
	).all<{
		user_id: string;
		platform: string;
		channel_id: string;
		display_name: string;
		discord_id: string;
		avatar_hash: string | null;
	}>();

	const channels = rows.results ?? [];

	const perChannel = await Promise.all(
		channels.map((c): Promise<CreatorVideo[]> => {
			const provider = providerForPlatform(c.platform);
			// A stored platform with no registered provider contributes nothing.
			if (!provider) return Promise.resolve([]);
			const author = {
				user_id: c.user_id,
				display_name: c.display_name,
				avatar_url: buildAvatarUrl(c.discord_id, c.avatar_hash),
			};
			return getRecentVideosCached(env, provider, c.channel_id, ctx).then(
				(videos) => videos.map((video) => ({ ...video, ...author })),
			);
		}),
	);

	return mergeCreatorFeed(perChannel);
}

// Build the feed, cache it, and return it. Throws on failure so the cold-miss
// path can swallow to [] while the stale path logs and keeps the prior entry.
async function rebuildCreatorFeed(
	env: ChannelsEnv,
	ctx: ExecutionContext,
): Promise<CreatorVideo[]> {
	const videos = await buildCreatorFeed(env, ctx);
	// Only cache a non-empty feed. An empty build is usually transient (a cold
	// rebuild racing cold per-channel caches whose RSS fetch failed); caching it
	// would blank the strip for the whole soft-TTL. A genuinely empty feed is
	// cheap to rebuild and self-heals the moment an upload appears.
	if (videos.length > 0) {
		const payload: CachedCreatorFeed = { fetched_at: Date.now(), videos };
		await env.SESSIONS_KV.put(CREATOR_FEED_KEY, JSON.stringify(payload), {
			expirationTtl: CREATOR_FEED_HARD_TTL_S,
		});
	}
	return videos;
}

// The assembled home feed via the aggregate SWR cache (see the block above).
async function getCreatorFeed(
	env: ChannelsEnv,
	ctx: ExecutionContext,
): Promise<CreatorVideo[]> {
	const raw = await env.SESSIONS_KV.get(CREATOR_FEED_KEY);
	if (raw) {
		try {
			const cached = JSON.parse(raw) as CachedCreatorFeed;
			// Only trust a non-empty cache — writes never persist an empty feed
			// (see rebuildCreatorFeed), so an empty/legacy entry falls through to a
			// synchronous rebuild below instead of serving a blank strip.
			if (cached.videos.length > 0) {
				if (Date.now() - cached.fetched_at >= CREATOR_FEED_SOFT_TTL_MS) {
					// Stale: serve now, repopulate in the background.
					ctx.waitUntil(
						rebuildCreatorFeed(env, ctx).catch((e: unknown) => {
							logError("creator_feed_refresh_failed", e);
						}),
					);
				}
				return cached.videos;
			}
		} catch {
			// Corrupt entry — treat as a cold miss below.
		}
	}
	// Cold miss (or an empty/corrupt entry): build synchronously so the first
	// request already gets the feed. Swallow transient errors to [] — the next
	// request retries (nothing cached).
	try {
		return await rebuildCreatorFeed(env, ctx);
	} catch (e) {
		logError("creator_feed_fetch_failed", e);
		return [];
	}
}

// GET /v1/creator-videos — public. The cross-creator home feed (see above).
// No auth, no PII: same public, user-published videos for every viewer.
export async function handleCreatorVideos(
	request: Request,
	env: ChannelsEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	// Re-apply the display cap at serve time: a cached entry built under a
	// previous, higher cap must not over-fill the strip, so a lowered count
	// takes effect immediately without waiting out the cache TTL.
	const videos = (await getCreatorFeed(env, ctx)).slice(
		0,
		MAX_CREATOR_FEED_VIDEOS,
	);
	return jsonResponse({ videos }, 200, cors);
}
