// Precompute and warm for the public /stats bundles.
//
// Two crons drive this module: the nightly precompute builds every selection
// of one slice (one pattern per slice, global-stats design §4.1), and the
// hourly warm rebuilds only the unfaceted bundles a version bump orphaned
// (§12).
//
// Every selection the /stats surface can express is a (slice, nation?) pair,
// and the whole space is small enough to build ahead of time: four composition
// slices, each unfaceted plus one bundle per nation seated in it. The request
// path still computes on a miss (global-stats design §5) — this warms the
// cache, it does not own it, and no correctness rests on it having run. That
// is also why it writes through putCached rather than a longer-lived tier:
// both paths produce the same kind of entry, so both get the same 24h TTL.

import { buildChartBundle } from "./aggregate";
import type { AggregateEnv } from "./aggregate";
import { getCached, putCached } from "./cache";
import type { StatsCacheEnv } from "./cache";
import { DEFAULT_GLOBAL_PERIOD } from "../games-scope";
import { listGlobalSliceNations, resolveGlobalCorpus } from "./resolve";
import type { ResolveEnv, StatsCorpus } from "./resolve";
import type { ChartBundleCore, GlobalPeriod, GlobalSlice } from "./types";

// Cron pattern → the slice that pattern precomputes.
//
// One pattern per slice rather than one invocation for all four. The four
// together are ~856 D1 queries against a 1,000-per-invocation ceiling, and
// both that ceiling and the 128 MB isolate are charged per invocation — so a
// pattern each buys a fresh query budget *and* a fresh isolate, and a fifth
// slice later adds a pattern instead of eating another's margin. Every
// interval stays at an hour or more, which is what puts a cron on the
// 15-minute CPU tier rather than the 30-second one.
//
// The Worker's `scheduled` handler dispatches on this table with no fallback,
// so a pattern missing from it does nothing rather than running the retention
// sweep — which is what lets staging declare these patterns and only these.
// Kept in sync by eye with `crons` in wrangler.toml, top-level and staging
// alike; nothing imports a wrangler config.
export const STATS_PRECOMPUTE_CRONS: Readonly<Record<string, GlobalSlice>> = {
	"17 4 * * *": "all",
	"17 5 * * *": "duel",
	"17 6 * * *": "ffa",
	"17 7 * * *": "single_player",
};

// The pattern the hourly warm runs on (warmGlobalSlices below).
//
// A standalone constant rather than a row in the table above, a second table
// beside it, or a sentinel value. That table's shape *is* its meaning: one
// pattern maps to one slice, and the dispatch reads it by looking a pattern up
// and getting a `GlobalSlice` back. A warm invocation covers all four slices,
// so it has no slice to be the value of — putting it in there means widening
// the value type to `GlobalSlice | "warm"` and making every reader branch on a
// value that isn't a slice, including the test that asserts one pattern per
// slice. A second `Record` would be a table shape carrying a single fact. What
// this actually is — one pattern, one job that isn't per-slice — is what
// `RETENTION_CRON` (retention.ts) already is, so it takes that shape.
//
// The no-fallback property survives unchanged: the dispatch stays a chain of
// exact matches that each return, and a pattern matched by none of them still
// logs and does nothing. That is what lets staging declare the stats patterns
// and not the sweep's without a drift ever reaching staging's `events`.
//
// Hourly, and deliberately not tighter: an interval under an hour drops the
// cron to the 30-second CPU tier instead of the 15-minute one. :37 keeps it
// clear of the daily patterns' :17 and :47.
export const STATS_WARM_CRON = "37 * * * *";

export interface PrecomputeEnv
	extends AggregateEnv, ResolveEnv, StatsCacheEnv {}

export interface PrecomputeSliceResult {
	// Selections built: the unfaceted slice, plus one per nation seated in it.
	// Every one of them is also written, except in the degenerate case where
	// the slice itself holds no public game — see buildGlobalSelection.
	selections: number;
	// Games in the unfaceted slice. The faceted selections are subsets of it,
	// so this is the number the invocation's cost is denominated in.
	games: number;
}

// Build one selection's bundle and cache it. The nightly loop below and the
// request path's cache miss (stats/handlers.ts) both go through here, so the
// two provably write the same bytes under the same key — a cron that warmed a
// key the request path would then overwrite with something else would make the
// warm step worse than useless.
//
// "humans" widens the focal set to every human seat, which is the whole point
// of a corpus where both sides of a duel are someone's game. It returns a
// ChartBundleCore; the cache is opaque JSON either way.
//
// An empty corpus is built but not cached. buildChartBundle short-circuits it
// to a fully-shaped empty bundle without a single query, so the entry would
// save nothing — and on the request path the selection that resolves to
// nothing is a nation token no game holds, which anyone can mint from the URL
// bar. Caching those is a KV write per distinct string, charged to us.
//
// `corpus` is for the caller that had to resolve the selection to make a
// decision of its own — the request path checks for emptiness before deciding
// whether a stale lookup is worth a keyspace walk (stats/handlers.ts). Passing
// it back in is what keeps that from being a second resolve of the same
// selection. The nightly loop has no such decision and omits it.
export async function buildGlobalSelection(
	env: PrecomputeEnv,
	slice: GlobalSlice,
	nations: string[],
	parserVersion: string,
	resolved?: StatsCorpus,
	period: GlobalPeriod = DEFAULT_GLOBAL_PERIOD,
): Promise<ChartBundleCore> {
	const corpus =
		resolved ?? (await resolveGlobalCorpus(env, slice, { nations, period }));
	const bundle = (await buildChartBundle(
		env,
		corpus,
		parserVersion,
		"humans",
	)) as ChartBundleCore;
	if (corpus.gameIds.length > 0) {
		await putCached(
			env,
			{ kind: "global", slice, nations, period, parser_version: parserVersion },
			bundle,
		);
	}
	return bundle;
}

// Build and cache every selection of one slice.
//
// Strictly sequential, and that is the load-bearing part rather than an
// incidental loop: one bundle's working set peaks near 60 MB while it builds,
// against a 128 MB isolate. Fourteen of them in flight is the shape that runs
// out of memory; one at a time, each released before the next starts, is the
// shape that fits — so nothing here may become a Promise.all.
//
// The unfaceted slice goes first. It is the largest bundle and the one a
// visitor lands on (nobody arrives on a nation), so if an invocation is going
// to exhaust its query budget it should do that after the entry point is warm
// rather than before.
export async function precomputeGlobalSlice(
	env: PrecomputeEnv,
	slice: GlobalSlice,
	parserVersion: string,
): Promise<PrecomputeSliceResult> {
	const nations = await listGlobalSliceNations(env, slice);
	const selections: string[][] = [[], ...nations.map((nation) => [nation])];

	let games = 0;
	for (const selection of selections) {
		const bundle = await buildGlobalSelection(
			env,
			slice,
			selection,
			parserVersion,
		);
		if (selection.length === 0) games = bundle.meta.game_count;
	}

	return { selections: selections.length, games };
}

export interface WarmResult {
	// Unfaceted slices looked at — every slice STATS_PRECOMPUTE_CRONS names.
	checked: number;
	// The ones that were missing and got rebuilt. Empty in the steady state,
	// and all four on the first run after a version bump.
	built: GlobalSlice[];
}

// Rebuild any of the four *unfaceted* bundles that is missing, hourly.
//
// This is the warm step design §12 argued for, and it is a cron rather than
// the deploy-time HTTP request that section imagined. The deploy has no
// credential to warm with: scripts/admin/wrangler.ts shells out to `wrangler`,
// so the toolchain authenticates to Cloudflare rather than to the app, and
// GET /v1/stats requires a session. That same session gate is also why the
// herd it feared is smaller than planned for — the surface is signed-in only,
// so what a cold key costs now is one visitor's latency, not an anonymous
// stampede.
//
// **Only the four unfaceted slices.** All 56 selections in one invocation is
// ~856 D1 queries against a 1,000-per-invocation ceiling, which is the reason
// §4.1 splits the nightly by slice in the first place; the four unfaceted ones
// are ~200 and fit with room. They are also the ones that matter here — a
// visitor lands on a slice, never on a nation — and the 52 nation bundles have
// the nightly crons and the request path's compute-on-miss.
//
// **Only the ones actually missing.** An unconditional hourly rebuild would be
// ~4,800 D1 queries a day spent overwriting entries that were already correct.
// Both segments of the cache key are Worker-compiled — BUNDLE_SCHEMA_VERSION
// (stats/cache.ts) and CURRENT_PARSER_VERSION (schemas/game.ts) — so every
// event that orphans a key at once is a Worker deploy, and the worst case this
// leaves open is one interval of cold keys. Steady state is four KV reads an
// hour.
//
// getCached rather than a lighter existence check: it reads the whole entry
// and parses it, which is wasteful for a question this cheap to ask, but four
// reads an hour is where that stops mattering and a `hasCached` helper would
// never have a second caller. It also answers unparseable JSON the way the
// warm wants it answered — a corrupted entry is one to rebuild, not one to
// count as present.
//
// Sequential, for the same reason precomputeGlobalSlice is: an unfaceted
// bundle is the largest there is and peaks near 60 MB against a 128 MB
// isolate, so nothing here may become a Promise.all.
export async function warmGlobalSlices(
	env: PrecomputeEnv,
	parserVersion: string,
): Promise<WarmResult> {
	// The slices the nightly builds, by construction rather than from a second
	// list that could drift from it. A fifth slice adds a precompute pattern
	// (§4.1) and this follows it.
	const slices = Object.values(STATS_PRECOMPUTE_CRONS);

	const built: GlobalSlice[] = [];
	for (const slice of slices) {
		const cached = await getCached<ChartBundleCore>(env, {
			kind: "global",
			slice,
			nations: [],
			// The nightly warms the all-time window only. A recency window is a
			// secondary facet, and tripling a cron whose cost is denominated in
			// the unfaceted slice's game count — to warm views most visits never
			// open — buys less than serve-stale already gives them.
			period: DEFAULT_GLOBAL_PERIOD,
			parser_version: parserVersion,
		});
		if (cached !== null) continue;
		// buildGlobalSelection, so the cron and the request path write the same
		// bytes under the same key. A slice holding no public game resolves to an
		// empty corpus, whose bundle is fully shaped, costs no aggregation, and is
		// deliberately not cached — so it reports built on every pass, which is
		// accurate and costs the one resolve query.
		await buildGlobalSelection(env, slice, [], parserVersion);
		built.push(slice);
	}

	return { checked: slices.length, built };
}
