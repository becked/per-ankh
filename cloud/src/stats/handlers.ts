// HTTP handlers for the stats endpoints.
//
//   GET /v1/users/:user_id/stats           — user corpus
//   GET /v1/stats                          — global (public) corpus
//
// Resolve corpus → check cache → compute on miss → return bundle.

import { CURRENT_PARSER_VERSION } from "../schemas/game";
import { sessionFromRequest } from "../session";
import type { SessionEnv } from "../session";
import { cloudCorsHeaders, errorResponse, jsonResponse } from "../util";
import {
	parseNationParam,
	parsePeriodParam,
	parseScopeParam,
	parseSliceParam,
} from "../games-scope";
import { ceilingFrom, enforceReadRateLimit } from "../read-budget";
import type { ReadBudget } from "../read-budget";
import { logError } from "../log";
import { buildChartBundle } from "./aggregate";
import { getCached, getStaleGlobalCached, putCached } from "./cache";
import { buildGlobalSelection } from "./precompute";
import type { PrecomputeEnv } from "./precompute";
import { resolveGlobalCorpus, resolveUserCorpus } from "./resolve";
import type { ChartBundle, ChartBundleCore, UserStatsScope } from "./types";
import type { EventsEnv, QueryableD1 } from "../d1";

export interface UserStatsEnv extends SessionEnv {
	SHARE_DB: QueryableD1;
	SESSIONS_KV: KVNamespace;
	ALLOWED_ORIGINS: string;
}

export interface GlobalStatsEnv extends PrecomputeEnv, EventsEnv {
	ALLOWED_ORIGINS: string;
	// Per-IP hourly ceiling on the /stats read budget. Optional: unset falls
	// back to the constant below. A var rather than a bare const for the same
	// reason the tournament ceilings are — retunable without a redeploy.
	GLOBAL_STATS_VIEW_PER_HOUR?: string;
}

export async function handleUserStats(
	userId: string,
	request: Request,
	env: UserStatsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	if (!/^[A-Za-z0-9_-]{21}$/.test(userId)) {
		return errorResponse("Invalid user_id", 400, cors, "INVALID_USER_ID");
	}

	const session = await sessionFromRequest(env, request);
	const viewerId = session?.data.user_id ?? null;
	const viewerScope: UserStatsScope = viewerId === userId ? "self" : "public";

	const url = new URL(request.url);
	const scope = parseScopeParam(url.searchParams.get("scope"));

	const cacheKey = {
		kind: "user" as const,
		user_id: userId,
		viewerScope,
		scope,
		parser_version: CURRENT_PARSER_VERSION,
	};
	const cached = await getCached<ChartBundle>(env, cacheKey);
	if (cached) {
		return jsonResponse(
			cached as unknown as Record<string, unknown>,
			200,
			cors,
		);
	}

	const corpus = await resolveUserCorpus(env, userId, viewerScope, scope);
	if (!corpus) {
		return errorResponse("User not found", 404, cors, "NOT_FOUND");
	}

	const bundle = await buildChartBundle(
		env,
		corpus,
		CURRENT_PARSER_VERSION,
		"uploader",
	);
	await putCached(env, cacheKey, bundle);
	return jsonResponse(bundle as unknown as Record<string, unknown>, 200, cors);
}

// ---------- GET /v1/stats — the global corpus ----------

// Per-IP budget for the public /stats read, spent one slot per bundle fetched.
//
// Its own budget, deliberately not a share of anon_read: /stats and /games/*
// are different populations, and a shared budget lets whichever is busier
// decide when the other starts refusing — the coupling that took the
// tournament pages down on 2026-08-05. It also ties the abuse ceiling to the
// cold-start ceiling, two knobs that want to move independently.
//
// 600 arrived through the fan-out, not by copying a number across: /stats is
// one read per page load, so 600 is 600 page loads an hour — the same headroom
// TOURNAMENT_LIST_VIEW_PER_HOUR buys at the same number, and the same headroom
// TOURNAMENT_VIEW_PER_HOUR needs 2400 to reach on its four-to-six reads a page.
//
// The default only — read the effective ceiling with globalStatsViewPerHour().
export const GLOBAL_STATS_VIEW_PER_HOUR = 600;

export function globalStatsViewPerHour(env: {
	GLOBAL_STATS_VIEW_PER_HOUR?: string;
}): number {
	return ceilingFrom(
		env.GLOBAL_STATS_VIEW_PER_HOUR,
		GLOBAL_STATS_VIEW_PER_HOUR,
		"GLOBAL_STATS_VIEW_PER_HOUR",
	);
}

const GLOBAL_STATS_BUDGET: ReadBudget = {
	eventType: "global_stats_view",
	message: "Stats view rate limit exceeded",
	code: "RATE_LIMIT_GLOBAL_STATS",
};

// The payload is byte-identical for every viewer and changes at most nightly,
// so it takes an edge cache — the same header the other public reads carry
// (channels.ts, featured.ts, tournament/public.ts). No browser cache, so a
// visitor who reloads after the nightly precompute sees the new numbers rather
// than waiting out a client TTL. `cors` already carries Vary: Origin
// (cloudCorsHeaders), which is what keeps the origin-specific CORS headers from
// being served to the wrong origin out of a shared cache.
//
// It is also half the herd control a cold key has: every colo answers its
// second and later requests from the edge, which takes a version bump from
// "one recompute per request" to roughly one per colo. The other half is the
// hourly warm (STATS_WARM_CRON, stats/precompute.ts), which rebuilds any of
// the four unfaceted bundles that a bump orphaned and so bounds the cold
// window to one interval. Design §12 wanted that warm at deploy time instead;
// it is a cron because a deploy step would need an app session the wrangler
// toolchain has no way to mint. Whether the two hold together is the trigger
// for a single-flight lock, which the design defers until they measurably
// don't.
function globalStatsResponse(
	bundle: ChartBundleCore,
	cors: Record<string, string>,
): Response {
	return new Response(JSON.stringify(bundle), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=0, s-maxage=60",
			...cors,
		},
	});
}

// GET /v1/stats — the chart bundle over the whole public corpus.
//
// Session required. Not because the payload is viewer-dependent — it is not:
// is_public = 1 is the whole visibility rule (it already covers tournament
// games, which linkTournamentMatch forces public), so every signed-in viewer
// reads the same bytes and nothing here consults the session beyond its
// existence. The gate is on who may spend a whole-corpus aggregation, not on
// what they get to see.
//
// Checked before the rate limit, the way handleUserSearch does it: a request
// that never reads anything should not spend an IP's read budget, and an
// anonymous caller with no cookie is refused without touching KV or D1.
//
// One consequence worth naming: enforceReadRateLimit exempts scraper
// User-Agents from the budget, but that exemption was only ever about counting.
// A Discord or Slack link-preview bot carries no session, so it is refused here
// like any other anonymous caller — and the frontend /stats route bounces the
// same visitors to login, so a shared /stats link previews as the home page.
//
// The selection is a composition slice plus an optional nation, both parsed
// forgivingly: an unknown ?slice= falls back to the duel default and an
// unknown ?nation= to no facet, so a stale bookmark or a hand-edited URL
// degrades to a neighbouring view instead of 400ing.
//
// Three ways to answer, in order:
//
//   1. The precomputed entry (stats/precompute.ts warms all 56 of them
//      nightly). The steady state, and a single KV read.
//   2. Last night's entry under a superseded parser_version, served stale
//      while this one rebuilds behind ctx.waitUntil. Available on parser drift
//      only — a BUNDLE_SCHEMA_VERSION bump changes the bundle's shape, and a
//      frontend on the new shape would break on the old bytes (see
//      getStaleGlobalCached).
//   3. Computing it here.
//
// Step 3 is not a vestige of step 1 and never refuses. A schema bump orphans
// all 56 keys at once and step 2 deliberately won't reach across that bump,
// so what warms them back is the hourly cron (STATS_WARM_CRON,
// stats/precompute.ts) — and it covers the four unfaceted slices only. Every
// nation selection asked for between the bump and the night's precompute is
// still served by building it here. Precompute-only is the one shape that
// would make the facet model expensive to change later.
//
// Step 2 is skipped where the selection resolves to no games — see the
// resolve below.
export async function handleGlobalStats(
	request: Request,
	env: GlobalStatsEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}

	const limited = await enforceReadRateLimit(
		env,
		request,
		cors,
		GLOBAL_STATS_BUDGET,
		globalStatsViewPerHour(env),
	);
	if (limited) return limited;

	const url = new URL(request.url);
	const slice = parseSliceParam(url.searchParams.get("slice"));
	const nation = parseNationParam(url.searchParams.get("nation"));
	const period = parsePeriodParam(url.searchParams.get("period"));
	// The resolver and the cache key both take a set, even though the UI is
	// single-select, so widening the facet to multi-select later costs the
	// nightly precompute table rather than this call chain.
	const nations = nation === null ? [] : [nation];

	const cacheKey = {
		kind: "global" as const,
		slice,
		nations,
		period,
		parser_version: CURRENT_PARSER_VERSION,
	};
	const cached = await getCached<ChartBundleCore>(env, cacheKey);
	if (cached) return globalStatsResponse(cached, cors);

	// Resolve before reaching for a stale entry, so a selection with no games
	// never pays for the reach. Such a selection is deliberately never cached
	// (precompute.ts — an empty bundle costs no queries, and caching one would
	// be a KV write per distinct string anyone can mint), so it misses forever,
	// and getStaleGlobalCached answers a miss by paginating every `stats:` key
	// in the namespace — user and tournament bundles included — to conclude the
	// same nothing every time.
	//
	// It is not only a hand-edited URL that lands here. The facet offers all 13
	// nations in every slice by design (§9.1), so picking one that nobody has
	// played in the FFA slice is an ordinary click, and it walks the keyspace on
	// every request for as long as the corpus stays that way.
	//
	// Nothing is given up by skipping the lookup: an empty selection was never
	// written under any parser version, so there is no stale entry to find. The
	// cost is one D1 query ahead of a stale response, which already pays for the
	// walk itself.
	const corpus = await resolveGlobalCorpus(env, slice, { nations, period });
	const build = () =>
		buildGlobalSelection(
			env,
			slice,
			nations,
			CURRENT_PARSER_VERSION,
			corpus,
			period,
		);

	if (corpus.gameIds.length === 0) {
		return globalStatsResponse(await build(), cors);
	}

	const stale = await getStaleGlobalCached<ChartBundleCore>(env, cacheKey);
	if (stale) {
		ctx.waitUntil(
			build().catch((e: unknown) => {
				// Nothing awaits this, so the log line is the only signal. The
				// next request misses again and retries it, either from the
				// request path or from the night's cron.
				logError("global_stats_refresh_failed", e, {
					slice,
					nation: nation ?? "",
					period,
				});
			}),
		);
		return globalStatsResponse(stale, cors);
	}

	return globalStatsResponse(await build(), cors);
}
