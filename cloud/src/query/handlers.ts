// HTTP handlers for the ad-hoc query surface.
//
//   GET /v1/query/catalog — the vocabulary a question may be composed from
//   GET /v1/query         — run one composed question
//
// The catalog is served rather than baked into the client for the reason the
// Worker's own notes give about second implementations: a copy of the
// allowlist in the frontend would drift from the one the compiler enforces,
// and the drift would show up as a picker offering a column that 400s. It is
// constant data with no I/O behind it, so it costs a Worker invocation and
// nothing else.

import { sessionFromRequest } from "../session";
import type { SessionEnv } from "../session";
import { cloudCorsHeaders, errorResponse } from "../util";
import { ceilingFrom, enforceReadRateLimit } from "../read-budget";
import type { ReadBudget } from "../read-budget";
import { logError, setLogField } from "../log";
import type { EventsEnv, QueryableD1 } from "../d1";
import { compileQuery } from "./compile";
import { canonicalSelection, parseSelection } from "./select";
import { measureByKey, serializeCatalog } from "./catalog";

export interface QueryEnv extends SessionEnv, EventsEnv {
	SHARE_DB: QueryableD1;
	ALLOWED_ORIGINS: string;
	// Per-IP hourly ceiling on the ad-hoc read budget. Optional: unset falls
	// back to the constant below.
	AD_HOC_QUERY_PER_HOUR?: string;
}

// Per-IP budget for a composed question.
//
// Its own budget, and specifically not a share of `global_stats_view`.
// stats/handlers.ts records why a budget is never pooled: a shared one lets
// whichever surface is busier decide when the other starts refusing, which is
// the coupling that took the tournament pages down on 2026-08-05. The reason
// bites harder here than anywhere else on the API, because this is the one
// endpoint whose cost per request the caller chooses — a count over
// `wonder_events` and an average over `game_player_turn` are the same request
// to the ceiling and are not the same query — so its ceiling has to move
// independently of the stats bundles'.
//
// 300, not the 600 the other read budgets share, because the fan-out is
// different in both directions: one question is one read (the catalog is a
// separate, un-budgeted route), so 300 is 300 questions an hour per address,
// and a question is the most expensive read here rather than the cheapest.
// What the right number is depends on the per-request cost nobody has measured
// yet — which is the number this surface exists to produce — so it is a var
// (`AD_HOC_QUERY_PER_HOUR`) and expected to move once there is data to move it
// against.
//
// The default only — read the effective ceiling with adHocQueryPerHour().
export const AD_HOC_QUERY_PER_HOUR = 300;

export function adHocQueryPerHour(env: {
	AD_HOC_QUERY_PER_HOUR?: string;
}): number {
	return ceilingFrom(
		env.AD_HOC_QUERY_PER_HOUR,
		AD_HOC_QUERY_PER_HOUR,
		"AD_HOC_QUERY_PER_HOUR",
	);
}

const QUERY_BUDGET: ReadBudget = {
	eventType: "ad_hoc_query_view",
	message: "Query rate limit exceeded",
	code: "RATE_LIMIT_AD_HOC_QUERY",
};

// Both routes answer the same way the public stats reads do: storable by a
// shared cache, no browser cache. What is in the key is the whole of what
// decides the body — the path and query string — which is what
// `canonicalSelection` is for: two spellings of one question would otherwise
// be two entries and two scans.
//
// The directive is a literal at each call site rather than built from a number
// here, because the inventory in shared-cache-routes.test.ts scans for the
// literal: a template would hide both sites from the count whose job is to put
// them in a diff.
function queryResponse(
	body: Record<string, unknown>,
	cors: Record<string, string>,
	cacheControl: string,
): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": cacheControl,
			...cors,
		},
	});
}

// GET /v1/query/catalog — the dimensions, measures and filters a selection may
// name, per source.
//
// Public and outside every read budget: it reads nothing, it is the same bytes
// for everyone, and it changes only when this Worker is deployed. Which is
// also why it takes a longer edge TTL than a question does — the answer to a
// question moves when a game is uploaded, and this one does not.
export async function handleQueryCatalog(
	request: Request,
	env: Pick<QueryEnv, "ALLOWED_ORIGINS">,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	return queryResponse(
		serializeCatalog() as unknown as Record<string, unknown>,
		cors,
		"public, max-age=0, s-maxage=300",
	);
}

// GET /v1/query — run one composed question.
//
// Session required, for the reason `/v1/stats` requires one: the payload is
// not viewer-dependent (`is_public = 1` is the whole visibility rule, and the
// catalog is the whole column allowlist), so what the session gates is who may
// spend an ad-hoc aggregation. Checked ahead of the budget, as handleGlobalStats
// does it, so a request that reads nothing spends none of an address's slots.
export async function handleQuery(
	request: Request,
	env: QueryEnv,
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
		QUERY_BUDGET,
		adHocQueryPerHour(env),
	);
	if (limited) return limited;

	const url = new URL(request.url);
	const parsed = parseSelection(url.searchParams);
	if (!parsed.ok) {
		return errorResponse(parsed.message, 400, cors, "INVALID_QUERY");
	}
	const { selection, source } = parsed;
	const measure = measureByKey(source, selection.measure);
	if (!measure) {
		// Unreachable — parseSelection resolved it against the same catalog.
		return errorResponse("Unknown measure", 400, cors, "INVALID_QUERY");
	}

	// The question's *shape* on the access-log line, never its values: a
	// filter on `player_name` carries a player's name, and PII does not go in
	// a log field. The shape is what makes read cost per question measurable,
	// which is the number this surface was built to produce.
	setLogField("query_source", selection.source);
	setLogField("query_measure", selection.measure);
	setLogField("query_dimensions", selection.dimensions.join(","));
	setLogField("query_filters", selection.filters.map((f) => f.key).join(","));

	const compiled = compileQuery(source, selection);

	let results: Record<string, unknown>[];
	try {
		const result = await env.SHARE_DB.prepare(compiled.sql)
			.bind(...compiled.binds)
			.all<Record<string, unknown>>();
		results = result.results ?? [];
	} catch (e) {
		// The statement is composed from catalog literals, so a failure here is
		// the engine rather than the question — a timeout, or a selection whose
		// cost D1 refused. Answered as a 500 naming neither, with the shape
		// already on the log line above.
		logError("ad_hoc_query_failed", e, {
			query_source: selection.source,
			query_measure: selection.measure,
		});
		return errorResponse("Query failed", 500, cors, "QUERY_FAILED");
	}

	const wireColumns = compiled.columns.map((c) => ({
		key: c.key,
		label: c.label,
		role: c.role,
		type: c.type,
	}));
	const rows = results.map((row) => {
		const out: Record<string, string | number | null> = {};
		for (const column of compiled.columns) {
			const value = row[column.alias];
			out[column.key] =
				value === undefined || value === null
					? null
					: (value as string | number);
		}
		return out;
	});

	return queryResponse(
		{
			selection: canonicalSelection(selection),
			source: source.key,
			columns: wireColumns,
			rows,
			row_count: rows.length,
			// The cap was reached, so there may be more groups than are here.
			// Reported rather than inferred client-side: a reader who cannot
			// tell a complete answer from a truncated one has been given a
			// wrong one.
			truncated: rows.length >= selection.limit,
			limit: selection.limit,
			measure: {
				key: measure.key,
				label: measure.label,
				unit: measure.unit,
				note: measure.note,
			},
		},
		cors,
		"public, max-age=0, s-maxage=60",
	);
}
