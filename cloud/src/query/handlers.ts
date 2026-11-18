// HTTP handlers for the ad-hoc query surface.
//
//   GET /v1/query/catalog — the vocabulary a question may be composed from
//   GET /v1/query         — run one composed question
//   POST /v1/query/ask    — translate a question in plain language into one
//
// The catalog is served rather than baked into the client for the reason the
// Worker's own notes give about second implementations: a copy of the
// allowlist in the frontend would drift from the one the compiler enforces,
// and the drift would show up as a picker offering a column that 400s. Its
// columns are constant data; the two value rosters beside them are D1 reads,
// which is why both routes here spend the same per-IP budget.

import { buildAvatarUrl } from "../auth";
import { sessionFromRequest } from "../session";
import type { SessionEnv } from "../session";
import {
	cloudCorsHeaders,
	errorResponse,
	getClientIp,
	jsonResponse,
	parseJsonBody,
} from "../util";
import { ceilingFrom, enforceReadRateLimit } from "../read-budget";
import type { ReadBudget } from "../read-budget";
import { logError, setLogField } from "../log";
import type { EventsEnv, QueryableD1 } from "../d1";
import { AskQuestionSchema } from "../schemas/query";
import {
	askCacheKey,
	readCachedAnswer,
	writeCachedAnswer,
	type CachedAnswer,
} from "./ask-cache";
import {
	countQuestionsSince,
	monthToDateCostUsd,
	reserveQuestion,
	settledUsage,
	settleQuestion,
} from "./ask-usage";
import {
	ASK_DISABLED_KEY,
	ASK_MODEL,
	ASK_SESSION_AFFINITY,
	askQuestion,
	type AskOutcome,
} from "./ask";
import { compileQuery } from "./compile";
import {
	canonicalSelection,
	parseSelection,
	type QuerySelection,
} from "./select";
import {
	measureByKey,
	PLAYER_ROSTER_SQL,
	serializeCatalog,
	TOURNAMENT_ROSTER_SQL,
	type CatalogRosterOption,
} from "./catalog";

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
// Both routes of this surface spend it: a question, and the catalog the
// builder needs before it can compose one. The catalog takes this budget
// rather than one of its own for the reason `/v1/stats/records` shares
// `global_stats_view` — it is the same surface and the same visitor asking, so
// a separate ceiling would only let one of the page's two reads starve the
// other. It is also a D1 reader, not the constant-data route it started as:
// it runs TOURNAMENT_ROSTER_SQL and PLAYER_ROSTER_SQL, and the second is a
// scan of `users` with a correlated scan of `player_summaries` per row.
//
// 300, not the 600 the other read budgets share, because the fan-out is
// different in both directions: an Explore load is one catalog read and each
// question after it is one more, so 300 is a page load and 299 questions an
// hour per address, and a question is the most expensive read here rather than
// the cheapest. What the right number is depends on the per-request cost nobody
// has measured yet — which is the number this surface exists to produce — so it
// is a var (`AD_HOC_QUERY_PER_HOUR`) and expected to move once there is data to
// move it against.
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

// The two served rosters. The catalog serves both to the builder's pickers,
// and the ask endpoint matches typed names against them.
async function loadTournamentRoster(
	db: QueryableD1,
): Promise<CatalogRosterOption[]> {
	const { results } = await db.prepare(TOURNAMENT_ROSTER_SQL).all<{
		tournament_id: string;
		name: string;
	}>();
	return results.map((r) => ({ value: r.tournament_id, label: r.name }));
}

async function loadPlayerRoster(
	db: QueryableD1,
): Promise<CatalogRosterOption[]> {
	const { results } = await db.prepare(PLAYER_ROSTER_SQL).all<{
		user_id: string;
		display_name: string;
		discord_id: string;
		avatar_hash: string | null;
	}>();
	return results.map((r) => ({
		value: r.user_id,
		label: r.display_name,
		// The account's avatar, so a player reads here the way it reads on
		// /players and in a game's seat list. Built from the two columns rather
		// than stored: buildAvatarUrl is the one place that knows the CDN path
		// and the default-avatar fallback for an account with no hash.
		icon: buildAvatarUrl(r.discord_id, r.avatar_hash),
	}));
}

// The question's *shape* on the access-log line, never its values: a filter on
// `player_name` carries a player's name, and PII does not go in a log field.
// The shape is what makes read cost per question measurable, which is the
// number this surface was built to produce.
function logSelectionShape(selection: QuerySelection): void {
	setLogField("query_source", selection.source);
	setLogField("query_measure", selection.measure);
	setLogField("query_dimensions", selection.dimensions.join(","));
	setLogField("query_filters", selection.filters.map((f) => f.key).join(","));
}

// GET /v1/query/catalog — the dimensions, measures and filters a selection may
// name, per source, and the value rosters only this side knows.
//
// Public, and the same bytes for everyone: the columns are constant data, and
// both rosters served with them — the tournaments a question can be asked
// about (TOURNAMENT_ROSTER_SQL) and the accounts it can be asked about
// (PLAYER_ROSTER_SQL) — are viewer-independent by construction. So there is no
// aggregation to gate and no session required.
//
// On the ad-hoc budget even so, because it is two D1 reads rather than the
// constant-data route it started as: a scan of `tournaments` and one of
// `users` with a correlated scan of `player_summaries` per row. The edge TTL is
// not a substitute — matchRoute keys on the pathname alone, so
// `/v1/query/catalog?x=1` reaches this handler and is its own cache entry —
// which is what the per-IP gate bounds. Charged before the reads, as a question
// is charged before its own.
//
// It still takes a longer edge TTL than a question does. A question's answer
// moves whenever a game is uploaded; this moves only on a deploy, when a
// tournament's first match is reported, or when an account's first public game
// lands.
//
// A failed roster read serves the columns with an empty one rather than a 500,
// and the two fail independently: the builder's other fifteen pickers and every
// typed filter still work, and a filter whose roster is missing falls back to
// the typed token every one of them took before it had a roster at all.
export async function handleQueryCatalog(
	request: Request,
	env: Pick<
		QueryEnv,
		"ALLOWED_ORIGINS" | "SHARE_DB" | "EVENTS_DB" | "AD_HOC_QUERY_PER_HOUR"
	>,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const limited = await enforceReadRateLimit(
		env,
		request,
		cors,
		QUERY_BUDGET,
		adHocQueryPerHour(env),
	);
	if (limited) return limited;

	let tournaments: CatalogRosterOption[] = [];
	let players: CatalogRosterOption[] = [];
	try {
		tournaments = await loadTournamentRoster(env.SHARE_DB);
	} catch (err) {
		logError("query_catalog_roster_failed", err);
	}
	try {
		players = await loadPlayerRoster(env.SHARE_DB);
	} catch (err) {
		logError("query_catalog_player_roster_failed", err);
	}
	return queryResponse(
		serializeCatalog({
			tournament: tournaments,
			player: players,
		}) as unknown as Record<string, unknown>,
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

	logSelectionShape(selection);

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
			measure: {
				key: measure.key,
				label: measure.label,
				unit: measure.unit,
			},
		},
		cors,
		"public, max-age=0, s-maxage=60",
	);
}

// ---------- POST /v1/query/ask ----------

export interface QueryAskEnv extends QueryEnv {
	// Workers AI, for the model call that translates the question.
	AI: Ai;
	// The ask limits. Optional: unset falls back to the constants below.
	PER_USER_QUERY_ASKS_PER_DAY?: string;
	PER_IP_QUERY_ASKS_PER_HOUR?: string;
	GLOBAL_QUERY_ASKS_PER_HOUR?: string;
	ASK_MONTHLY_BUDGET_USD?: string;
}

// The ask limits, all counted over `query_asks` rows (ask-usage.ts): one row
// per question that reaches the model, so a retry is not a second question
// and a question answered from the answer cache is not one at all.
//
//   * Per account, questions in the last 24 hours. Shares the month's budget
//     between accounts.
//   * Per IP and global, questions in the last hour. The per-IP one bounds one
//     visitor holding several accounts. The global one bounds how fast the
//     month's budget can be spent.
//   * The monthly budget, in USD, over the current UTC calendar month. The
//     only one that bounds total spend: Discord accounts are free and IPs
//     rotate. Usage is priced at ASK_PRICES, and a question in flight counts
//     at its reservation.
//
// When one refuses, only the ask input stops working; the builder does not
// spend these. The derivation is in cloud/wrangler.toml above the vars.
//
// The defaults only — read the effective values with askLimits().
export const PER_USER_QUERY_ASKS_PER_DAY = 10;
export const PER_IP_QUERY_ASKS_PER_HOUR = 60;
export const GLOBAL_QUERY_ASKS_PER_HOUR = 300;
export const ASK_MONTHLY_BUDGET_USD = 5;

function askLimits(env: QueryAskEnv): {
	perUserPerDay: number;
	perIpPerHour: number;
	globalPerHour: number;
	monthlyBudgetUsd: number;
} {
	return {
		perUserPerDay: ceilingFrom(
			env.PER_USER_QUERY_ASKS_PER_DAY,
			PER_USER_QUERY_ASKS_PER_DAY,
			"PER_USER_QUERY_ASKS_PER_DAY",
		),
		perIpPerHour: ceilingFrom(
			env.PER_IP_QUERY_ASKS_PER_HOUR,
			PER_IP_QUERY_ASKS_PER_HOUR,
			"PER_IP_QUERY_ASKS_PER_HOUR",
		),
		globalPerHour: ceilingFrom(
			env.GLOBAL_QUERY_ASKS_PER_HOUR,
			GLOBAL_QUERY_ASKS_PER_HOUR,
			"GLOBAL_QUERY_ASKS_PER_HOUR",
		),
		monthlyBudgetUsd: ceilingFrom(
			env.ASK_MONTHLY_BUDGET_USD,
			ASK_MONTHLY_BUDGET_USD,
			"ASK_MONTHLY_BUDGET_USD",
		),
	};
}

const ASK_UNAVAILABLE_MESSAGE =
	"Asking in plain language is unavailable right now";

function logAskOutcome(outcome: AskOutcome): void {
	setLogField("ask_outcome", outcome.kind);
	setLogField("ask_attempts", outcome.attempts);
	setLogField(
		"ask_input_tokens",
		outcome.usage.reduce((n, u) => n + u.inputTokens, 0),
	);
	setLogField(
		"ask_cached_input_tokens",
		outcome.usage.reduce((n, u) => n + u.cachedInputTokens, 0),
	);
	setLogField(
		"ask_output_tokens",
		outcome.usage.reduce((n, u) => n + u.outputTokens, 0),
	);
}

// POST /v1/query/ask — translate a question in plain language into a selection
// (issue #380). Answers `{ selection }`, the canonical query string the client
// navigates to; GET /v1/query then answers it like any other question.
//
// Session required, as for GET /v1/query: the session gates who may spend a
// model call. Then, cheapest refusal first and all of them before the model
// runs: the body, the off switch, the limits (askLimits).
//
// The answer cache (ask-cache.ts) is read after the off switch and before the
// limits. A hit makes no model call, so it is not charged and a spent limit
// does not refuse it. The off switch still refuses a hit, because turning the
// feature off covers the answers it gave earlier.
//
// A question that passes the limits is reserved in `query_asks` before its
// first call and settled after its last (ask-usage.ts). A reservation that
// cannot be written refuses the question: the row is what the monthly budget
// counts, so a question without one would be spend the budget never sees.
//
// Every refusal carries its own code, so the page can show one line under the
// input and leave the builder working. The off switch is a 503 with
// ASK_DISABLED, and a model or store that is down is a 503 with
// ASK_UNAVAILABLE. A spent limit is a 429 with RATE_LIMIT_ASK_*. An
// unsupported question is a 422 with ASK_UNSUPPORTED, and a reply that failed
// its checks twice is a 422 with ASK_UNMATCHED.
export async function handleQueryAsk(
	request: Request,
	env: QueryAskEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}

	const body = await parseJsonBody(request, AskQuestionSchema, cors);
	if (!body.ok) return body.response;
	const { question } = body.body;

	// The off switch. A read that throws refuses: a switch that fails open is
	// on exactly when somebody may be trying to turn it off.
	let switchedOff: boolean;
	try {
		switchedOff = (await env.SESSIONS_KV.get(ASK_DISABLED_KEY)) !== null;
	} catch (e) {
		logError("query_ask_switch_read_failed", e);
		return errorResponse(ASK_UNAVAILABLE_MESSAGE, 503, cors, "ASK_UNAVAILABLE");
	}
	if (switchedOff) {
		return errorResponse(
			"Asking in plain language is switched off",
			503,
			cors,
			"ASK_DISABLED",
		);
	}

	const today = new Date().toISOString().slice(0, 10);
	const cacheKey = await askCacheKey(question, today);
	const cached = await readCachedAnswer(env.SESSIONS_KV, cacheKey);
	setLogField("ask_cache", cached ? "hit" : "miss");
	if (cached) {
		setLogField("ask_question", question);
		setLogField("ask_outcome", cached.kind);
		return answeredResponse(cached, cors);
	}

	const userId = session.data.user_id;
	const ip = getClientIp(request);
	const limits = askLimits(env);
	if (
		(await countQuestionsSince(
			env.EVENTS_DB,
			{ column: "user_id", value: userId },
			"-24 hours",
		)) >= limits.perUserPerDay
	) {
		return errorResponse(
			`You've asked ${limits.perUserPerDay} questions in the last 24 hours — try again later`,
			429,
			cors,
			"RATE_LIMIT_ASK_USER",
		);
	}
	if (
		ip &&
		(await countQuestionsSince(
			env.EVENTS_DB,
			{ column: "ip_address", value: ip },
			"-1 hour",
		)) >= limits.perIpPerHour
	) {
		return errorResponse(
			"Too many questions from this network this hour — try again later",
			429,
			cors,
			"RATE_LIMIT_ASK_IP",
		);
	}
	if (
		(await countQuestionsSince(env.EVENTS_DB, null, "-1 hour")) >=
		limits.globalPerHour
	) {
		return errorResponse(
			"Asking in plain language is busy this hour — try again later",
			429,
			cors,
			"RATE_LIMIT_ASK_GLOBAL",
		);
	}
	if ((await monthToDateCostUsd(env.EVENTS_DB)) >= limits.monthlyBudgetUsd) {
		return errorResponse(
			"Asking in plain language is paused until next month",
			429,
			cors,
			"RATE_LIMIT_ASK_BUDGET",
		);
	}

	let reservation: number;
	try {
		reservation = await reserveQuestion(env.EVENTS_DB, userId, ip);
	} catch (e) {
		logError("query_ask_reserve_failed", e);
		return errorResponse(ASK_UNAVAILABLE_MESSAGE, 503, cors, "ASK_UNAVAILABLE");
	}

	// The question text, verbatim. A deliberate exception to the shape-only
	// rule handleQuery follows (issue #380): real questions are what the eval's
	// test set grows from, and the text can carry a player's name, so it goes
	// on this route's line and on no other.
	setLogField("ask_question", question);

	let outcome: AskOutcome;
	try {
		outcome = await askQuestion(question, {
			callModel: (inputs) =>
				env.AI.run(ASK_MODEL, inputs, {
					extraHeaders: { "x-session-affinity": ASK_SESSION_AFFINITY },
				}),
			loadRoster: (vocabulary) =>
				vocabulary === "player"
					? loadPlayerRoster(env.SHARE_DB)
					: loadTournamentRoster(env.SHARE_DB),
			today,
		});
	} catch (e) {
		// The reservation stands: a call that threw may still have been billed,
		// and its usage is not known.
		logError("query_ask_failed", e);
		return errorResponse(ASK_UNAVAILABLE_MESSAGE, 503, cors, "ASK_UNAVAILABLE");
	}
	logAskOutcome(outcome);
	try {
		await settleQuestion(
			env.EVENTS_DB,
			reservation,
			settledUsage(outcome.usage),
		);
	} catch (e) {
		// The reservation stands, which over-counts the question. The answer
		// is still good, so it is still returned.
		logError("query_ask_settle_failed", e);
	}
	await writeCachedAnswer(env.SESSIONS_KV, cacheKey, outcome);

	if (outcome.kind === "failed") {
		return errorResponse(outcome.message, 422, cors, "ASK_UNMATCHED");
	}
	return answeredResponse(outcome, cors);
}

// A selection or an "unsupported" reply, fresh or from the cache.
function answeredResponse(
	answer: CachedAnswer,
	cors: Record<string, string>,
): Response {
	if (answer.kind === "selection") {
		logSelectionShape(answer.selection);
		return jsonResponse({ selection: answer.canonical }, 200, cors);
	}
	return errorResponse(answer.reason, 422, cors, "ASK_UNSUPPORTED");
}
