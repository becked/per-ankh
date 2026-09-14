// KV-backed bundle cache for the /stats endpoints.
//
// One key per (corpus, scope). Visitor and owner views of the same user
// corpus live under separate keys so a private-game upload doesn't leak
// to the public-scope cache. PARSER_VERSION (echoed by the Worker via
// KNOWN_PARSER_VERSIONS) is embedded in the key so a frontend that
// bumps parser naturally orphans every old entry instead of needing a
// purge step; BUNDLE_SCHEMA_VERSION is embedded beside it and does the
// same for a change to the bundle's own shape.
//
// Key shape:
//   stats:v{BUNDLE_SCHEMA_VERSION}-p{parser_version}:user:{user_id}:{viewerScope}:{scope}
//   stats:v{BUNDLE_SCHEMA_VERSION}-p{parser_version}:tournament:{tournament_id}:{updated_at}
//   stats:v{BUNDLE_SCHEMA_VERSION}-p{parser_version}:global:{slice}:{nations}
//
// We reuse the existing SESSIONS_KV binding (no new infra) — the
// `stats:` prefix keeps these distinct from `session:` and `oauth:`
// keys.

import type { SessionEnv } from "../session";
import type { GlobalSlice, UserScope, UserStatsScope } from "./types";

// What each version of the bundle shape changed. This table *is* the version:
// BUNDLE_SCHEMA_VERSION below is its highest key, so a bump can't happen
// without saying what changed, and the two can't drift apart.
//
// Bumping is equivalent to a global cache flush — every read becomes a miss
// and recomputes. Bump when the ChartBundle shape itself changes: dropping a
// field, or adding one. Adding counts because entries live for 24h, so without
// a bump a frontend deployed behind the Worker would read a cached bundle that
// predates the field and blow up on it (the bundle types declare every field
// required, so consumers dereference them directly). A data-only change — a
// chart drawn from fields the bundle already carries — needs no bump.
//
// Versions 1-3 never shipped; the constant was introduced at 4.
const BUNDLE_SCHEMA_CHANGELOG: Record<number, string> = {
	4: "initial cached bundle shape",
	5: "winner/loser split on the yield curves (yieldCurves.outcome)",
	6: "starting-leader archetype + trait win rates",
	7: "per-wonder build rate, builder win rate, and build-turn distribution",
	8: "capital family class win rate, plus avg_share / share_samples / slot_counts on familyByNation (per-class city footprint and founding order)",
	9: "favorite_day_of_week dropped (no consumer — the profile card reads its own copy from GET /v1/users/:user_id), and save_dates moved from ChartBundleCore to the user-only ChartBundle: only the profile Overview calendar renders it, and it was the one field whose size grew with the corpus rather than with the turn axis",
	10: "records — per yield series, the top player-games on each of seven boards (peak, end-of-game, and the T20/T40/T60/T80/T100 checkpoints), for both the rate and the cumulative column. Folded into the pass that already builds the bands, so no new query",
	11: "gdp — a per-turn GDP series on yieldCurves and a GDP record board, from the game_player_turn columns migration 0044 adds. A new key inside an existing Record rather than a new declared field, so nothing dereferences it blind, but a bundle cached before the deploy would draw an empty GDP chart on the Yields tab for up to a TTL. A flush is cheaper than that",
};

export const BUNDLE_SCHEMA_VERSION = Math.max(
	...Object.keys(BUNDLE_SCHEMA_CHANGELOG).map(Number),
);

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
	  }
	| {
			kind: "global";
			// Composition slice of the public corpus (games-scope.ts). No
			// viewerScope: is_public = 1 is the whole visibility rule, so every
			// viewer reads the same bytes.
			slice: GlobalSlice;
			// Nations the selection is faceted on; empty is the whole slice.
			// Normalized when stringified, so a selection has one spelling
			// however the caller ordered it — which is what keeps widening the
			// facet to multi-select a UI change rather than a key migration.
			nations: string[];
			parser_version: string;
	  };

// Everything after a global key's version segment. Its own function because
// getStaleGlobalCached matches on it across parser versions: written under one
// spelling and looked for under another, serve-stale would never find anything.
function globalKeySuffix(
	key: Extract<StatsCacheKey, { kind: "global" }>,
): string {
	return `global:${key.slice}:${[...new Set(key.nations)].sort().join(",")}`;
}

export function cacheKeyToString(key: StatsCacheKey): string {
	const v = `v${BUNDLE_SCHEMA_VERSION}-p${key.parser_version}`;
	if (key.kind === "tournament") {
		return `stats:${v}:tournament:${key.tournament_id}:${key.updated_at}`;
	}
	if (key.kind === "global") {
		// The empty nation set leaves a trailing colon, so the unfaceted slice
		// can't be a prefix of a faceted one — what the suffix match relies on.
		return `stats:${v}:${globalKeySuffix(key)}`;
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

// Serve-stale, for the global bundles only (global-stats design §12).
//
// The key carries two version segments and exactly one of them is safe to
// reach across. A parser_version bump orphans every entry without changing the
// bundle's shape, so the previous entry is merely stale and a consumer on the
// current shape reads it fine. A BUNDLE_SCHEMA_VERSION bump does change the
// shape, and this module's whole contract is that consumers dereference fields
// directly — so the walk pins the schema in its prefix and leaves only the
// parser open. Treating the two segments alike is what makes serve-stale look
// unavailable here.
//
// Only the global corpus wants it. A user or tournament bundle covers one
// library or one event and recomputes on the request that missed it; a global
// bundle is up to 96 queries over the whole public corpus, which is what makes
// last night's copy worth a list walk. The caller is the one that missed on
// `key`, and is expected to start the recompute itself (ctx.waitUntil) so the
// stale response never waits on it.
export async function getStaleGlobalCached<T>(
	env: StatsCacheEnv,
	key: Extract<StatsCacheKey, { kind: "global" }>,
): Promise<T | null> {
	const prefix = `stats:v${BUNDLE_SCHEMA_VERSION}-p`;
	const suffix = `:${globalKeySuffix(key)}`;

	// Every entry carries putCached's 24h TTL, so the greatest expiration is
	// the most recently written — the freshest of the stale, when the parser
	// has moved more than once inside a TTL. Key order would not do: parser
	// versions are semver, where "2.9.0" sorts after "2.15.0".
	let best: { name: string; expiration: number } | null = null;
	let cursor: string | undefined;
	do {
		const res = await env.SESSIONS_KV.list({ prefix, cursor });
		for (const k of res.keys) {
			if (!k.name.endsWith(suffix)) continue;
			const expiration = k.expiration ?? 0;
			if (best === null || expiration > best.expiration) {
				best = { name: k.name, expiration };
			}
		}
		cursor = res.list_complete ? undefined : res.cursor;
	} while (cursor);

	if (best === null) return null;
	const raw = await env.SESSIONS_KV.get(best.name);
	// Expired between the list and the read, or written by a build that
	// crashed mid-JSON — either way the caller recomputes, same as a miss.
	if (!raw) return null;
	try {
		return JSON.parse(raw) as T;
	} catch {
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
