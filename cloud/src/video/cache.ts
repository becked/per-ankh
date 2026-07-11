// Recent-videos cache in SESSIONS_KV, stale-while-revalidate.
//
// Key shape: `videos:v{CACHE_VERSION}:{platform}:{channel_id}` — the `videos:`
// prefix keeps these distinct from `session:`/`oauth:`/`stats:` entries in the
// same namespace (no new infra), mirroring cloud/src/stats/cache.ts.
//
// SWR: a fresh entry (age < SOFT_TTL) is served as-is; a stale-but-present
// entry is served immediately while a background refresh (ctx.waitUntil)
// repopulates it, so a profile view never blocks on YouTube once warm; a cold
// miss fetches synchronously. Transient upstream errors never overwrite a good
// entry (fetchRecent throws rather than returning []) — worst case we serve
// slightly-stale videos.

import { logError } from "../log";
import type { Video, VideoEnv, VideoProvider } from "./types";

// Bump when the CachedVideos shape changes — old keys orphan and expire.
// v2: playlist entries gained per-video uploader fields (PlaylistVideo).
// v3: tournament playlists now enumerate the full playlist (Data API) instead
//     of the RSS recent-only feed; orphan the truncated v2 entries so a
//     warmed playlist doesn't keep serving a short list its search can't span.
const CACHE_VERSION = 3;
// Serve a cached entry without refetching under this age.
const SOFT_TTL_MS = 60 * 60 * 1000; // 1h
// KV hard expiry — a safety net far past the soft TTL.
const HARD_TTL_S = 24 * 60 * 60; // 24h

interface CachedVideos {
	fetched_at: number; // epoch ms
	videos: Video[];
}

function cacheKey(platform: string, cacheId: string): string {
	return `videos:v${CACHE_VERSION}:${platform}:${cacheId}`;
}

async function readCache(
	env: VideoEnv,
	platform: string,
	cacheId: string,
): Promise<CachedVideos | null> {
	const raw = await env.SESSIONS_KV.get(cacheKey(platform, cacheId));
	if (!raw) return null;
	try {
		return JSON.parse(raw) as CachedVideos;
	} catch {
		return null; // corrupt entry — treat as miss, overwritten on next put
	}
}

async function writeCache(
	env: VideoEnv,
	platform: string,
	cacheId: string,
	videos: Video[],
): Promise<void> {
	const payload: CachedVideos = { fetched_at: Date.now(), videos };
	await env.SESSIONS_KV.put(
		cacheKey(platform, cacheId),
		JSON.stringify(payload),
		{ expirationTtl: HARD_TTL_S },
	);
}

async function refresh<T extends Video>(
	env: VideoEnv,
	platform: string,
	cacheId: string,
	fetchFn: () => Promise<T[]>,
): Promise<T[]> {
	const videos = await fetchFn();
	await writeCache(env, platform, cacheId, videos);
	return videos;
}

// Generic SWR read: `fetchFn` produces the fresh list; `cacheId` namespaces the
// entry within `platform` (a channel id for the profile feed, `playlist:<id>`
// for a tournament playlist). Both reads go through this so the
// stale-while-revalidate policy lives in one place. `T` flows through so a
// playlist read keeps its richer PlaylistVideo shape — the cache stores exactly
// what `fetchFn` produced, so the cast on read is sound.
export async function getVideosCached<T extends Video>(
	env: VideoEnv,
	platform: string,
	cacheId: string,
	fetchFn: () => Promise<T[]>,
	ctx?: ExecutionContext,
): Promise<T[]> {
	const cached = await readCache(env, platform, cacheId);
	if (cached) {
		if (Date.now() - cached.fetched_at >= SOFT_TTL_MS) {
			// Stale: serve now, repopulate in the background when we can.
			const p = refresh(env, platform, cacheId, fetchFn).catch((e: unknown) => {
				logError("video_refresh_failed", e, { platform });
			});
			if (ctx) ctx.waitUntil(p);
		}
		return cached.videos as T[];
	}
	// Cold miss: must fetch synchronously. Swallow transient errors to an empty
	// list — the next view retries (nothing was cached).
	try {
		return await refresh(env, platform, cacheId, fetchFn);
	} catch (e) {
		logError("video_fetch_failed", e, { platform });
		return [];
	}
}

// Recent videos for one resolved channel, via the SWR cache above.
export async function getRecentVideosCached(
	env: VideoEnv,
	provider: VideoProvider,
	channelId: string,
	ctx?: ExecutionContext,
): Promise<Video[]> {
	return getVideosCached(
		env,
		provider.platform,
		channelId,
		() => provider.fetchRecent(channelId, env),
		ctx,
	);
}
