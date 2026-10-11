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
	byPublishedDesc,
	ChannelResolutionError,
	type Video,
	type VideoEnv,
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

// GET /v1/users/:user_id/videos — public. Merges recent uploads across the
// user's linked channels (each KV-cached, SWR). No auth: channels are
// user-published and videos are the same for every viewer. The uploader on
// each video is the profile's own owner — the display name and avatar this
// page's header already serves publicly — so the tab renders the cards with
// the credit suppressed rather than repeating it once per card.
export async function handleUserVideos(
	userId: string,
	request: Request,
	env: ChannelsEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const rows = await env.SHARE_DB.prepare(
		`${CHANNELS_WITH_OWNER_SQL} WHERE c.user_id = ?`,
	)
		.bind(userId)
		.all<ChannelWithOwner>();

	const perChannel = await Promise.all(
		(rows.results ?? []).map((c) => attributedChannelVideos(env, ctx, c)),
	);

	const videos = perChannel
		.flat()
		// Newest first across all platforms.
		.sort(byPublishedDesc)
		.slice(0, MAX_MERGED_VIDEOS);

	return jsonResponse({ videos }, 200, cors);
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
	// KV fan-out at the origin — live as of `[cache]` (cloud/wrangler.toml),
	// having reached browsers and intermediaries only before that. No browser
	// cache (max-age=0), so a viewer who just added or removed a channel is
	// waiting out the shared 60s rather than a TTL of their own: within a
	// minute on reload, not immediately. Vary: Origin because the CORS headers
	// are origin-specific and the response is shared-cacheable.
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
