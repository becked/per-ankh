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
// slightly-stale videos. A fetch that succeeded but degraded says so with
// UncacheableVideos, and is served without being written (see refresh).

import { logError } from "../log";
import {
	UncacheableVideos,
	type Video,
	type VideoEnv,
	type VideoProvider,
} from "./types";

// Bump when the CachedVideos shape changes — old keys orphan and expire.
// v2: playlist entries gained per-video uploader fields (PlaylistVideo).
// v3: tournament playlists now enumerate the full playlist (Data API) instead
//     of the RSS recent-only feed; orphan the truncated v2 entries so a
//     warmed playlist doesn't keep serving a short list its search can't span.
// v4: playlist fetches now dedupe repeated video ids (a curator re-adding a
//     video); orphan the v3 entries so a warmed playlist doesn't keep serving a
//     duplicate-containing list that crashes the Videos tab's keyed {#each}.
// v5: live content is dated by when the broadcast aired rather than when its
//     VOD was published; orphan the v4 entries so a warmed feed doesn't keep
//     serving dates that are hours-to-a-day too recent.
// v6: every video carries duration_seconds; orphan the v5 entries so a warmed
//     feed doesn't keep serving videos with the field absent entirely (not
//     null), which a consumer reading it would see as undefined.
const CACHE_VERSION = 6;
// Serve a cached entry without refetching under this age.
const SOFT_TTL_MS = 60 * 60 * 1000; // 1h
// KV hard expiry — a safety net far past the soft TTL.
const HARD_TTL_S = 24 * 60 * 60; // 24h

interface CachedVideos {
	fetched_at: number; // epoch ms
	videos: Video[];
}

// Exported for the integration tests that seed an entry directly: they must
// write the key this module reads, or a CACHE_VERSION bump turns their seed
// into an orphan and the handler under test into one reading nothing.
export function cacheKey(platform: string, cacheId: string): string {
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
	let videos: T[];
	try {
		videos = await fetchFn();
	} catch (e) {
		// Degraded but serve-able: hand it back without writing, so the
		// degradation lasts this one response rather than the whole TTL. On the
		// stale path the caller has already served the prior (good) entry and
		// discards this; leaving it unwritten is what keeps that entry. The cast
		// is sound for the same reason the read cast below is — the payload is
		// exactly what fetchFn produced.
		if (e instanceof UncacheableVideos) return e.videos as T[];
		throw e;
	}
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
