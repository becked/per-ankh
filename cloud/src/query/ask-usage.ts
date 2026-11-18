// The `query_asks` table (migration 0058): one row per Explore ask question
// that reaches the model, carrying the tokens its calls spent. Every ask limit
// reads it (query/handlers.ts): questions per account in the last 24 hours,
// questions per IP and in total in the last hour, and the calendar month's
// spend against the monthly budget.
//
// A question is reserved before its first call, at the most its calls could
// spend, and settled after the last with what the replies reported. So a
// question in flight counts at worst case, and so does one whose call threw:
// the budget can over-count a question and never under-count one.
//
// Every helper takes a real `D1Database`, as countEventsSince does: EVENTS_DB
// is the only handle that satisfies it, so a replica-eligible SHARE_DB session
// fails to compile instead of under-counting (cloud/src/d1.ts).

import {
	ASK_MAX_ATTEMPTS,
	ASK_MAX_OUTPUT_TOKENS,
	ASK_PRICES,
	type AskUsage,
} from "./ask";

// What one call is charged when its usage is unknown: before it runs, after it
// threw, or when its reply reported no input tokens. The eval measured ~9,750
// input tokens on a first call (the derivation in cloud/wrangler.toml). A retry
// reads the first call's input again plus its reply and the refusal, and the
// reply is capped at ASK_MAX_OUTPUT_TOKENS, so 12,000 covers the retry too.
// Every input token is priced as uncached, and the output runs to the cap.
const RESERVED_CALL_USAGE: AskUsage = {
	inputTokens: 12_000,
	cachedInputTokens: 0,
	outputTokens: ASK_MAX_OUTPUT_TOKENS,
};

// What a question is charged before its first call: every attempt at worst
// case. ~$0.012 at the shipped prices.
export const RESERVED_QUESTION_USAGE: AskUsage = {
	inputTokens: RESERVED_CALL_USAGE.inputTokens * ASK_MAX_ATTEMPTS,
	cachedInputTokens: 0,
	outputTokens: RESERVED_CALL_USAGE.outputTokens * ASK_MAX_ATTEMPTS,
};

// A question's usage, summed over its calls. A call that reported no input
// tokens is counted at the reservation: every call reads the prompt, so a zero
// means the reply carried no usage, not that the call was free. Cached tokens
// are a share of input tokens, and a reply that claims more is clamped.
export function settledUsage(calls: readonly AskUsage[]): AskUsage {
	const total: AskUsage = {
		inputTokens: 0,
		cachedInputTokens: 0,
		outputTokens: 0,
	};
	for (const reported of calls) {
		const call = reported.inputTokens > 0 ? reported : RESERVED_CALL_USAGE;
		total.inputTokens += call.inputTokens;
		total.cachedInputTokens += Math.min(
			call.cachedInputTokens,
			call.inputTokens,
		);
		total.outputTokens += call.outputTokens;
	}
	return total;
}

// What usage costs at the shipped model's prices, in USD.
export function askCostUsd(usage: AskUsage): number {
	const uncached = usage.inputTokens - usage.cachedInputTokens;
	return (
		(uncached * ASK_PRICES.input +
			usage.cachedInputTokens * ASK_PRICES.cachedInput +
			usage.outputTokens * ASK_PRICES.output) /
		1e6
	);
}

// Reserve a question: one row at RESERVED_QUESTION_USAGE. Returns its id, for
// settleQuestion.
export async function reserveQuestion(
	db: D1Database,
	userId: string,
	ip: string | null,
): Promise<number> {
	const row = await db
		.prepare(
			`INSERT INTO query_asks
			   (user_id, ip_address, input_tokens, cached_input_tokens, output_tokens)
			 VALUES (?, ?, ?, ?, ?)
			 RETURNING id`,
		)
		.bind(
			userId,
			ip,
			RESERVED_QUESTION_USAGE.inputTokens,
			RESERVED_QUESTION_USAGE.cachedInputTokens,
			RESERVED_QUESTION_USAGE.outputTokens,
		)
		.first<{ id: number }>();
	if (!row) throw new Error("query_asks insert returned no id");
	return row.id;
}

// Replace a reservation with the usage the replies reported.
export async function settleQuestion(
	db: D1Database,
	id: number,
	usage: AskUsage,
): Promise<void> {
	await db
		.prepare(
			`UPDATE query_asks
			 SET input_tokens = ?, cached_input_tokens = ?, output_tokens = ?
			 WHERE id = ?`,
		)
		.bind(usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, id)
		.run();
}

// Questions asked within the window, by one account, by one IP, or by
// everyone (`null`).
export async function countQuestionsSince(
	db: D1Database,
	scope: { column: "user_id" | "ip_address"; value: string } | null,
	window: "-1 hour" | "-24 hours",
): Promise<number> {
	const row = scope
		? await db
				.prepare(
					`SELECT COUNT(*) AS n FROM query_asks
					 WHERE ${scope.column} = ? AND created_at > datetime('now', ?)`,
				)
				.bind(scope.value, window)
				.first<{ n: number }>()
		: await db
				.prepare(
					`SELECT COUNT(*) AS n FROM query_asks
					 WHERE created_at > datetime('now', ?)`,
				)
				.bind(window)
				.first<{ n: number }>();
	return row?.n ?? 0;
}

// The current UTC calendar month's questions and their summed usage. A SQL
// string so `./per-ankh admin ask status` runs the same statement through
// wrangler.
export const MONTH_TO_DATE_SQL = `SELECT
	COUNT(*) AS questions,
	COALESCE(SUM(input_tokens), 0) AS input_tokens,
	COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
	COALESCE(SUM(output_tokens), 0) AS output_tokens
FROM query_asks
WHERE created_at >= strftime('%Y-%m-01 00:00:00', 'now')`;

export interface MonthToDateRow {
	questions: number;
	input_tokens: number;
	cached_input_tokens: number;
	output_tokens: number;
}

export function monthToDateUsage(row: MonthToDateRow | null): {
	questions: number;
	usage: AskUsage;
} {
	return {
		questions: row?.questions ?? 0,
		usage: {
			inputTokens: row?.input_tokens ?? 0,
			cachedInputTokens: row?.cached_input_tokens ?? 0,
			outputTokens: row?.output_tokens ?? 0,
		},
	};
}

// The current month's spend so far, in USD.
export async function monthToDateCostUsd(db: D1Database): Promise<number> {
	const row = await db.prepare(MONTH_TO_DATE_SQL).first<MonthToDateRow>();
	return askCostUsd(monthToDateUsage(row).usage);
}
