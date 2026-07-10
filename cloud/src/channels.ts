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
