// KV-backed bundle cache for the /stats endpoints.
//
// One key per (corpus, scope). Visitor and owner views of the same user
// corpus live under separate keys so a private-game upload doesn't leak
// to the public-scope cache. PARSER_VERSION (echoed by the Worker via
// KNOWN_PARSER_VERSIONS) is embedded in the key so a frontend that
// bumps parser naturally orphans every old entry instead of needing a
// purge step.
//
// Key shape:
//   stats:v{parser_version}:user:{user_id}:{viewerScope}:{scope}
//   stats:v{parser_version}:tournament:{tournament_id}:{updated_at}
//
// We reuse the existing SESSIONS_KV binding (no new infra) — the
// `stats:` prefix keeps these distinct from `session:` and `oauth:`
// keys.

import type { SessionEnv } from "../session";
import type { UserScope, UserStatsScope } from "./types";

// Bumping this is equivalent to a global cache flush — every read
// becomes a miss and recomputes. Use when the ChartBundle shape itself
// changes in a backwards-incompatible way (e.g. dropping a field). For
// data-only changes (a new chart, a new aggregation), no bump needed.
export const BUNDLE_SCHEMA_VERSION = 4;

export interface StatsCacheEnv extends SessionEnv {
	// SESSIONS_KV is the existing KV binding; this module reuses it
	// under the stats: prefix.
}

// The cache key covers both corpora. For the user corpus the game-type filter
// (scope) is part of the key because each value selects a different SQL slice.
// For the tournament corpus, tournaments.updated_at is embedded: it's bumped on
// every tournament mutation (bumpTournamentUpdatedAt), so a mutation drifts the
// key, the next read recomputes, and the orphaned entry dies by TTL — the same
// expiry-by-drift the parser-version segment relies on (no explicit invalidate).
export type StatsCacheKey =
	| {
			kind: "user";
			user_id: string;
			// Identity visibility (self/public) — distinct from `scope`,
			// which is the user-chosen slice.
			viewerScope: UserStatsScope;
			scope: UserScope;
			parser_version: string;
	  }
	| {
			kind: "tournament";
			tournament_id: string;
			// tournaments.updated_at — drifts on every mutation (see above).
			updated_at: string;
			parser_version: string;
	  };

export function cacheKeyToString(key: StatsCacheKey): string {
	const v = `v${BUNDLE_SCHEMA_VERSION}-p${key.parser_version}`;
	if (key.kind === "tournament") {
		return `stats:${v}:tournament:${key.tournament_id}:${key.updated_at}`;
	}
	// The `:user:{id}:` anchor stays early so the prefix walk in
	// invalidateStatsCache matches every viewerScope × scope variant.
	return `stats:${v}:user:${key.user_id}:${key.viewerScope}:${key.scope}`;
}

// Generic over the cached bundle shape: the user corpus caches a ChartBundle,
// the tournament corpus a ChartBundleCore. The cache is opaque JSON either way.
export async function getCached<T>(
	env: StatsCacheEnv,
	key: StatsCacheKey,
): Promise<T | null> {
	const raw = await env.SESSIONS_KV.get(cacheKeyToString(key));
	if (!raw) return null;
	try {
		return JSON.parse(raw) as T;
	} catch {
		// Stale or corrupted JSON — fall back to recompute by returning
		// null. The bad entry will be overwritten on next put.
		return null;
	}
}

export async function putCached<T>(
	env: StatsCacheEnv,
	key: StatsCacheKey,
	bundle: T,
): Promise<void> {
	// 24h TTL. Explicit invalidation (KV delete) handles the common
	// mutation cases; the TTL is the safety net for bugs in the
	// invalidation chain.
	await env.SESSIONS_KV.put(cacheKeyToString(key), JSON.stringify(bundle), {
		expirationTtl: 24 * 60 * 60,
	});
}

// Invalidate every cache entry for the given user. Every viewerScope
// (self/public) × scope-selection variant is nuked — invalidation paths
// can't reliably predict which slice changed, and the recompute cost is
// low.
//
// We list keys by prefix so we don't have to enumerate every variant
// manually (and so new scope values Just Work).
export async function invalidateStatsCache(
	env: StatsCacheEnv,
	target: { kind: "user"; user_id: string },
): Promise<void> {
	const prefix = `stats:v${BUNDLE_SCHEMA_VERSION}-p`;
	// Walk the prefix; KV list paginates implicitly via cursor. Volume
	// here is tiny (one entry per corpus) so we don't worry about cursor
	// loops in practice.
	const suffix = `:user:${target.user_id}:`;

	let cursor: string | undefined;
	do {
		const res = await env.SESSIONS_KV.list({ prefix, cursor });
		await Promise.all(
			res.keys
				.filter((k) => k.name.includes(suffix))
				.map((k) => env.SESSIONS_KV.delete(k.name)),
		);
		cursor = res.list_complete ? undefined : res.cursor;
	} while (cursor);
}
