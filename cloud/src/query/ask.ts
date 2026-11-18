// The Explore ask path (issue #380): a question in plain language, translated
// by a Workers AI model into a selection.
//
// The model never writes SQL. It answers through one tool whose parameters are
// a selection or an "unsupported" reply, and its selection passes through
// parseSelection exactly as a hand-built URL does. Then two checks that
// parseSelection does not make run here:
//
//   * Every enum value must be in its vocabulary's list. parseSelection takes
//     any token, because a token that names nothing selects nothing. The
//     builder never sends one, but a model can (UNIT_BALLISTAE for
//     UNIT_BALLISTA), and the reader would take "No games match" for the
//     answer.
//   * Player and tournament names are matched against the served rosters in
//     code. The rosters are not in the prompt.
//
// This module is the one copy of the request. The eval
// (scripts/eval-query-ask.ts) imports the prompt, the tool and the checks from
// here, so the model and effort it picked were picked against what production
// sends. Editing the prompt or the tool means re-running it.
//
// No Worker bindings are touched here. The endpoint (handlers.ts) and the eval
// each pass the model call and the roster reads in as functions.

import { VOCABULARY_ROSTERS } from "../../../src/lib/query/vocabulary-rosters";
import {
	DEFAULT_ROWS,
	MAX_DIMENSIONS,
	MAX_FILTERS,
	MAX_FILTER_VALUES,
	MAX_ROWS,
	SOURCES,
	filterByKey,
	sourceByKey,
	type CatalogDimension,
	type CatalogFilter,
	type CatalogMeasure,
	type CatalogRosterOption,
	type FilterOp,
	type MeasureUnit,
	type QuerySource,
} from "./catalog";
import {
	SORTS,
	canonicalSelection,
	parseSelection,
	type QuerySelection,
} from "./select";

// ---------- Model ----------

// The two models the eval compared (issue #380). Both are Cloudflare-hosted
// with zero data retention, which matters because a question can name other
// players.
export const ASK_MODELS = {
	flash: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
	pro: "@cf/deepseek-ai/deepseek-v4-pro-0813",
} as const;

// USD per million tokens, from the Workers AI pricing page
// (developers.cloudflare.com/workers-ai/platform/pricing/), read 2026-11-17.
// Cached input is the share of input the prompt-prefix cache served, which a
// reply reports as prompt_tokens_details.cached_tokens. The monthly budget
// (ask-usage.ts) charges the shipped model's tokens at these prices, and the
// eval prices both models from them.
export interface AskPrices {
	input: number;
	cachedInput: number;
	output: number;
}

export const ASK_MODEL_PRICES: Record<keyof typeof ASK_MODELS, AskPrices> = {
	flash: { input: 0.3, cachedInput: 0.006, output: 1.2 },
	pro: { input: 1.32, cachedInput: 0.044, output: 3.96 },
};

// The levels both models accept. The installed workers-types also lists them.
export type ReasoningEffort = "none" | "low" | "high" | "max";
export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
	"none",
	"low",
	"high",
	"max",
];

// THE SHIPPED MODEL AND EFFORT, picked by the eval over the 32-question test
// set, one pass per configuration on 2026-11-17, at the model's default
// temperature:
//
//   model/effort   pass    mean $/question   median latency
//   flash/none     32/32   0.00307           2.0 s
//   flash/low      29/32   0.00315           2.1 s
//   pro/none       31/32   0.01377           4.9 s
//   pro/low        31/32   0.01381           5.2 s
//
// Cost prices every input token as uncached and includes the retry where one
// ran. Flash at no reasoning was the only configuration to pass every
// question, at a fifth of Pro's cost and under half its latency. Three more
// passes of Flash/none passed 95 of 96; the miss added an is_winner filter to
// a count of wins, which returns the same number. Reasoning did not help
// either model: Flash/low's three misses were an extra filter that changes
// nothing (is_winner on a count of wins) and a sort nobody asked for.
//
// Typed `string` rather than as one of ASK_MODELS' literals, so the AI binding
// takes its unknown-model overload. The installed workers-types knows the Pro
// model's input type and not the Flash one's.
const SHIPPED_MODEL: keyof typeof ASK_MODELS = "flash";
export const ASK_MODEL: string = ASK_MODELS[SHIPPED_MODEL];
export const ASK_PRICES: AskPrices = ASK_MODEL_PRICES[SHIPPED_MODEL];
export const ASK_REASONING_EFFORT: ReasoningEffort = "none";

// THE SHIPPED TEMPERATURE, from a second eval on 2026-11-17: Flash/none, three
// passes of the test set at the model's default temperature and three at 0.
//
//   temperature   pass    same selection on all three passes
//   default       94/96   29/32
//   0             95/96   31/32
//
// Cost and latency did not move. At 0, one question of 32 still gave a
// different selection on one pass, so answers are more repeatable and still
// not fixed. The answer cache (ask-cache.ts) relies on that repeatability: a
// stored answer is the one a fresh call would most likely give.
export const ASK_TEMPERATURE = 0;

// The cap on one call's output, reasoning included. It bounds what one call
// can cost, which the monthly budget's reservation is derived from
// (ask-usage.ts). The eval's largest Flash/none output was 188 tokens, so the
// cap is never what ends a reply; it is what stops a runaway one.
export const ASK_MAX_OUTPUT_TOKENS = 2048;

// Sent as `x-session-affinity`. Every request shares the system prompt, so one
// affinity key for all of them is what gives the prefix cache a chance to hit.
export const ASK_SESSION_AFFINITY = "explore-ask";

export const ASK_TOOL_NAME = "answer";

// ---------- The off switch ----------

// The SESSIONS_KV key that switches the ask endpoint off. A missing key means
// on and a present key means off, whatever its value. A KV key rather than a
// var, because a var overridden with `wrangler secret put` reverts on the next
// deploy, and an unrelated deploy would turn the feature back on during an
// incident. `./per-ankh admin ask` writes this key and no other.
export const ASK_DISABLED_KEY = "query_ask:disabled";

// ---------- The tool ----------

const ALL_DIMENSION_KEYS = uniqueKeys(SOURCES.flatMap((s) => s.dimensions));
const ALL_MEASURE_KEYS = uniqueKeys(SOURCES.flatMap((s) => s.measures));
const ALL_FILTER_KEYS = uniqueKeys(SOURCES.flatMap((s) => s.filters));
const FILTER_OPS: readonly FilterOp[] = ["in", "not_in", "gte", "lte"];

function uniqueKeys(entries: readonly { key: string }[]): string[] {
	return [...new Set(entries.map((e) => e.key))];
}

// One tool, called with tool_choice "required". Flat rather than a oneOf of
// two shapes: `kind` says which half is filled in. The enums narrow what the
// model can write, and they are a hint and not a check. Workers AI does not
// guarantee that a reply conforms to the schema, so parseSelection and the
// checks below run on every reply.
export const ASK_TOOL = {
	type: "function",
	function: {
		name: ASK_TOOL_NAME,
		description:
			"Answer the question with one selection, or say that no selection can express it.",
		parameters: {
			type: "object",
			properties: {
				kind: {
					type: "string",
					enum: ["selection", "unsupported"],
					description:
						"'selection' when a selection answers the whole question. 'unsupported' when it cannot.",
				},
				reason: {
					type: "string",
					description:
						"Only for 'unsupported'. One sentence naming the part of the question that no selection can express.",
				},
				source: {
					type: "string",
					enum: SOURCES.map((s) => s.key),
				},
				measure: { type: "string", enum: ALL_MEASURE_KEYS },
				dimensions: {
					type: "array",
					items: { type: "string", enum: ALL_DIMENSION_KEYS },
					maxItems: MAX_DIMENSIONS,
				},
				filters: {
					type: "array",
					maxItems: MAX_FILTERS,
					items: {
						type: "object",
						properties: {
							key: { type: "string", enum: ALL_FILTER_KEYS },
							op: { type: "string", enum: FILTER_OPS },
							values: {
								type: "array",
								items: { type: "string" },
								maxItems: MAX_FILTER_VALUES,
							},
						},
						required: ["key", "op", "values"],
					},
				},
				sort: { type: "string", enum: SORTS },
				limit: { type: "integer", minimum: 1, maximum: MAX_ROWS },
			},
			required: ["kind"],
		},
	},
} as const;

// ---------- The system prompt ----------

const UNIT_NOTES: Record<MeasureUnit, string> = {
	match: "counts each match once, even when both players uploaded it",
	save: "one uploaded save file",
	seat: "one player in one match",
	event: "one row of the source",
};

function filterValueNote(f: CatalogFilter): string {
	switch (f.type) {
		case "enum":
		case "game_mode":
			return `IDs from list ${f.vocabulary}`;
		case "identity":
			return "a player's name as the question writes it";
		case "tournament":
			return "a tournament's name as the question writes it";
		case "boolean":
			return "1 for yes, 0 for no";
		case "date":
			return "a date, YYYY-MM-DD";
		case "number":
			return "a number";
		case "text":
			return "text";
	}
}

function dimensionNote(d: CatalogDimension): string {
	return d.vocabulary && VOCABULARY_ROSTERS[d.vocabulary]
		? `${d.label}; values from list ${d.vocabulary}`
		: d.label;
}

function measureNote(m: CatalogMeasure): string {
	const how = m.agg ? `${m.agg.fn.toLowerCase()}; ` : "";
	return `${m.label} (${how}unit: ${m.unit}, ${UNIT_NOTES[m.unit]})`;
}

// One line per key, written once even though most keys are reachable from
// several sources. Two entries that share a key and describe different things
// would make the glossary wrong, so that throws at module load.
function glossary<T extends { key: string }>(
	entries: readonly T[],
	note: (entry: T) => string,
): string[] {
	const byKey = new Map<string, string>();
	for (const entry of entries) {
		const line = note(entry);
		const seen = byKey.get(entry.key);
		if (seen !== undefined && seen !== line) {
			throw new Error(
				`ask prompt: key '${entry.key}' has two definitions: '${seen}' and '${line}'`,
			);
		}
		byKey.set(entry.key, line);
	}
	return [...byKey].map(([key, line]) => `- ${key}: ${line}`);
}

function sourceBlock(s: QuerySource): string {
	return [
		`### ${s.key}: ${s.label}`,
		`Measures: ${s.measures.map((m) => m.key).join(", ")}`,
		`Dimensions: ${s.dimensions.map((d) => d.key).join(", ")}`,
		`Filters: ${s.filters.map((f) => `${f.key} [${f.ops.join(" ")}]`).join(", ")}`,
	].join("\n");
}

function vocabularyBlock(name: string): string {
	const roster = VOCABULARY_ROSTERS[name];
	return [
		`### ${name}`,
		...roster.options.map((value) => `${value} = ${roster.label(value)}`),
	].join("\n");
}

// The vocabularies some catalog entry names, in the order they first appear.
// `player` and `tournament` are served from D1 and matched by name in code, so
// they never reach this list.
const PROMPT_VOCABULARIES = [
	...new Set(
		SOURCES.flatMap((s) => [
			...s.dimensions.map((d) => d.vocabulary),
			...s.filters.map((f) => f.vocabulary),
		]),
	),
].filter((name): name is string => name != null && name in VOCABULARY_ROSTERS);

// Built once per isolate. It does not change between requests, and the
// question goes in the user message, so every request shares this prefix.
export const ASK_SYSTEM_PROMPT = [
	"You translate a question about Old World games into a selection for the Explore page of Per-Ankh. Old World is a turn-based strategy game. Per-Ankh holds the games players upload, and Explore answers a selection by aggregating over the public ones.",
	"",
	`Answer by calling the \`${ASK_TOOL_NAME}\` tool once.`,
	"",
	"## A selection",
	"",
	"- source: one source key. A source is the table whose rows the measure aggregates.",
	"- measure: one measure key that the source lists. It is the number in each result row.",
	`- dimensions: up to ${MAX_DIMENSIONS} dimension keys that the source lists. Each result row is one combination of their values. With no dimensions the answer is one number.`,
	`- filters: up to ${MAX_FILTERS} filters that the source lists. A filter is a key, an operator and values. "in" keeps rows whose value is one of the values. "not_in" drops them. "gte" and "lte" take exactly one value and bound a number or a date from below or above. A key can appear once per operator, so a range is two filters.`,
	`- sort: "measure_desc" (largest first, the default), "measure_asc" (smallest first), or "dimension_asc" (by the dimension values; needs a dimension).`,
	`- limit: how many rows to return, 1 to ${MAX_ROWS}. The default is ${DEFAULT_ROWS}.`,
	"",
	"## Rules",
	"",
	"- Use only keys that the chosen source lists. Never invent a key.",
	"- A filter whose values come from a list takes IDs from that list, written exactly as the list writes them. Match the words in the question to the display name after the `=`.",
	"- A `player` filter takes a player's name as the question writes it. A `tournament` filter takes a tournament's name as the question writes it. The server looks the names up. Never invent an ID for either.",
	"- `player` is a person's Per-Ankh account. A question about who did something groups by the `player` dimension. Use `player_name`, the name typed into the save file, only when the question asks for that name.",
	"- Boolean values are 1 or 0. Dates are YYYY-MM-DD. The user message gives today's date for questions about recent games.",
	"- Choose the source whose rows are the things the question counts or measures, then the measure on it.",
	"- A question asking for the most or the top uses the default sort. One asking for the least or the fewest uses measure_asc. Leave limit unset unless the question asks for a number of results, such as a top 5. A question about who did the most leaves it unset too, so that a tie for first is visible.",
	"- A selection has one measure, so a rate, a percentage or a ratio of two measures (a win rate) cannot be expressed.",
	"- Measures aggregate rows and know nothing of their order within a game, so a question about what came first, last or next in each game (the first tech each player researched) cannot be expressed. A turn filter is not a substitute.",
	`- If no selection expresses the whole question, call the tool with kind "unsupported" and a reason naming the part that cannot be expressed. Never answer a wider or different question instead. A wider answer looks like the right answer and is worse than no answer.`,
	"",
	"## Sources",
	"",
	...SOURCES.flatMap((s) => [sourceBlock(s), ""]),
	"## Measures",
	"",
	...glossary(
		SOURCES.flatMap((s) => s.measures),
		measureNote,
	),
	"",
	"## Dimensions",
	"",
	...glossary(
		SOURCES.flatMap((s) => s.dimensions),
		dimensionNote,
	),
	"",
	"## Filters",
	"",
	...glossary(
		SOURCES.flatMap((s) => s.filters),
		(f) => `${f.label}; values: ${filterValueNote(f)}`,
	),
	"",
	"## Lists",
	"",
	...PROMPT_VOCABULARIES.flatMap((name) => [vocabularyBlock(name), ""]),
]
	.join("\n")
	.trimEnd();

// ---------- The request ----------

export interface AskToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

export type AskMessage =
	| { role: "system" | "user"; content: string }
	| { role: "assistant"; content: string | null; tool_calls?: AskToolCall[] }
	| { role: "tool"; tool_call_id: string; content: string };

// A plain object type rather than an interface: the AI binding's unknown-model
// overload takes Record<string, unknown>, which an interface does not satisfy.
export type AskModelInputs = {
	messages: AskMessage[];
	tools: (typeof ASK_TOOL)[];
	tool_choice: "required";
	reasoning_effort: ReasoningEffort;
	max_tokens: number;
	// The model pages list `store` ("Whether to store the output for model
	// distillation / evals") with no default, so it is sent explicitly.
	store: false;
	// ASK_TEMPERATURE, except where the eval leaves it out to compare against
	// the model's default.
	temperature?: number;
};

function askUserMessage(question: string, today: string): string {
	return `Today's date: ${today}\n\nQuestion: ${question}`;
}

// The conversation a question opens with. The answer cache hashes the request
// built from it, so it is built in one place.
export function askMessages(question: string, today: string): AskMessage[] {
	return [
		{ role: "system", content: ASK_SYSTEM_PROMPT },
		{ role: "user", content: askUserMessage(question, today) },
	];
}

export function buildAskInputs(
	messages: AskMessage[],
	effort: ReasoningEffort,
	temperature: number | null,
): AskModelInputs {
	return {
		messages,
		tools: [ASK_TOOL],
		tool_choice: "required",
		reasoning_effort: effort,
		max_tokens: ASK_MAX_OUTPUT_TOKENS,
		store: false,
		...(temperature != null ? { temperature } : {}),
	};
}

// ---------- The reply ----------

export interface AskUsage {
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
}

export type ModelReply = {
	usage: AskUsage;
	// The tool call, when the model made one. Absent when it answered in text,
	// which tool_choice "required" asks it not to do and does not prevent.
	call: AskToolCall | null;
	content: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readUsage(raw: unknown): AskUsage {
	const usage = asRecord(raw);
	const details = asRecord(usage?.prompt_tokens_details);
	const num = (v: unknown): number => (typeof v === "number" ? v : 0);
	return {
		inputTokens: num(usage?.prompt_tokens),
		cachedInputTokens: num(details?.cached_tokens),
		outputTokens: num(usage?.completion_tokens),
	};
}

/**
 * Read one chat-completions reply. Throws when the reply is not that shape at
 * all, which the endpoint answers as the model being unavailable. A reply that
 * is the right shape but holds no usable tool call is not a throw: it is a
 * failed check, and the caller retries it.
 */
export function readModelReply(result: unknown): ModelReply {
	const reply = asRecord(result);
	const choices = reply?.choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error("ask: the model reply carried no choices");
	}
	const message = asRecord(asRecord(choices[0])?.message);
	if (!message) throw new Error("ask: the model reply carried no message");
	const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
	const first = asRecord(calls[0]);
	const fn = asRecord(first?.function);
	const call: AskToolCall | null =
		fn && typeof fn.name === "string" && typeof fn.arguments === "string"
			? {
					id: typeof first?.id === "string" ? first.id : "call_0",
					type: "function",
					function: { name: fn.name, arguments: fn.arguments },
				}
			: null;
	return {
		usage: readUsage(reply?.usage),
		call,
		content: typeof message.content === "string" ? message.content : null,
	};
}

// What the model's tool arguments say, after a shape check. The selection half
// is still unchecked against the catalog.
export type AskAnswer =
	| { kind: "unsupported"; reason: string }
	| {
			kind: "selection";
			source: string;
			measure: string;
			dimensions: string[];
			filters: { key: string; op: string; values: string[] }[];
			sort: string | null;
			limit: number | null;
	  };

type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

const isStringArray = (v: unknown): v is string[] =>
	Array.isArray(v) && v.every((x) => typeof x === "string");

export function readAnswer(argumentsJson: string): Checked<AskAnswer> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(argumentsJson);
	} catch {
		return { ok: false, message: "The tool arguments were not valid JSON" };
	}
	const args = asRecord(parsed);
	if (!args) {
		return { ok: false, message: "The tool arguments were not an object" };
	}
	if (args.kind === "unsupported") {
		const reason =
			typeof args.reason === "string" && args.reason.trim() !== ""
				? args.reason.trim()
				: "The question asks for something Explore cannot express.";
		return { ok: true, value: { kind: "unsupported", reason } };
	}
	if (args.kind !== "selection") {
		return {
			ok: false,
			message: "'kind' must be 'selection' or 'unsupported'",
		};
	}
	if (typeof args.source !== "string") {
		return { ok: false, message: "Missing 'source'" };
	}
	if (typeof args.measure !== "string") {
		return { ok: false, message: "Missing 'measure'" };
	}
	const dimensions = args.dimensions ?? [];
	if (!isStringArray(dimensions)) {
		return { ok: false, message: "'dimensions' must be a list of keys" };
	}
	const rawFilters = args.filters ?? [];
	if (!Array.isArray(rawFilters)) {
		return { ok: false, message: "'filters' must be a list" };
	}
	const filters: { key: string; op: string; values: string[] }[] = [];
	for (const raw of rawFilters) {
		const f = asRecord(raw);
		if (
			!f ||
			typeof f.key !== "string" ||
			typeof f.op !== "string" ||
			!isStringArray(f.values)
		) {
			return {
				ok: false,
				message: "Each filter needs a 'key', an 'op' and a list of 'values'",
			};
		}
		filters.push({ key: f.key, op: f.op, values: f.values });
	}
	const sort = args.sort == null ? null : String(args.sort);
	const limit =
		args.limit == null
			? null
			: typeof args.limit === "number"
				? args.limit
				: Number.NaN;
	return {
		ok: true,
		value: {
			kind: "selection",
			source: args.source,
			measure: args.measure,
			dimensions,
			filters,
			sort,
			limit,
		},
	};
}

// ---------- Name matching ----------

// Case and runs of whitespace folded. Names are matched on it, and the answer
// cache keys a question on it.
export const normalizeText = (s: string): string =>
	s.trim().replace(/\s+/g, " ").toLocaleLowerCase();

// How many candidate names an ambiguity message lists before it stops.
const MAX_CANDIDATES_NAMED = 5;

/**
 * The roster entry a typed name means, or why there is none.
 *
 * An exact match on the display name wins, ignoring case and spacing. Failing
 * that, a name that is part of exactly one roster name matches it, so
 * "Spring Cup" finds "Per-Ankh Spring Cup 2026". Two exact matches are refused
 * rather than picked between: two accounts can share a display name, and
 * crediting the wrong one answers a question about somebody else.
 */
export function matchRosterName(
	roster: readonly CatalogRosterOption[],
	typed: string,
	noun: "player" | "tournament",
): Checked<string> {
	const want = normalizeText(typed);
	if (want === "") return { ok: false, message: `An empty ${noun} name` };
	const exact = roster.filter((o) => normalizeText(o.label) === want);
	const hits =
		exact.length > 0
			? exact
			: roster.filter((o) => normalizeText(o.label).includes(want));
	if (hits.length === 1) return { ok: true, value: hits[0].value };
	if (hits.length === 0) {
		return { ok: false, message: `No ${noun} matches "${typed}"` };
	}
	const named = hits
		.slice(0, MAX_CANDIDATES_NAMED)
		.map((o) => o.label)
		.join(", ");
	const more = hits.length > MAX_CANDIDATES_NAMED ? ", …" : "";
	return {
		ok: false,
		message: `"${typed}" matches more than one ${noun}: ${named}${more}`,
	};
}

// ---------- The checks ----------

export type RosterVocabulary = "player" | "tournament";

export type RosterLoader = (
	vocabulary: RosterVocabulary,
) => Promise<readonly CatalogRosterOption[]>;

function rosterVocabulary(f: CatalogFilter): RosterVocabulary | null {
	if (f.type === "identity") return "player";
	if (f.type === "tournament") return "tournament";
	return null;
}

// The two separators canonicalSelection writes. A value carrying either would
// split into two values, so it is refused here with the same reason the
// parser would give.
const FILTER_SEPARATOR = ":";
const VALUE_SEPARATOR = ",";

/**
 * Turn a model's selection into a checked one, or say what failed.
 *
 * The order matters for the messages. Names are resolved first, because a
 * player filter has to hold account IDs before parseSelection sees it. Then
 * parseSelection, which is the check every hand-built URL gets. Then the enum
 * lists, which only this path checks.
 */
export async function checkAnswer(
	answer: Extract<AskAnswer, { kind: "selection" }>,
	loadRoster: RosterLoader,
): Promise<Checked<QuerySelection>> {
	const source = sourceByKey(answer.source);
	const rosters = new Map<RosterVocabulary, readonly CatalogRosterOption[]>();

	const params = new URLSearchParams();
	params.set("source", answer.source);
	if (answer.dimensions.length > 0) {
		params.set("dim", answer.dimensions.join(VALUE_SEPARATOR));
	}
	params.set("measure", answer.measure);
	for (const f of answer.filters) {
		const spec = source ? filterByKey(source, f.key) : null;
		const vocabulary = spec ? rosterVocabulary(spec) : null;
		let values = f.values;
		if (vocabulary) {
			let roster = rosters.get(vocabulary);
			if (!roster) {
				roster = await loadRoster(vocabulary);
				rosters.set(vocabulary, roster);
			}
			const ids: string[] = [];
			for (const typed of f.values) {
				const match = matchRosterName(roster, typed, vocabulary);
				if (!match.ok) return match;
				ids.push(match.value);
			}
			values = ids;
		}
		for (const value of values) {
			if (value.includes(FILTER_SEPARATOR) || value.includes(VALUE_SEPARATOR)) {
				return {
					ok: false,
					message: `A value for filter '${f.key}' contains ':' or ','`,
				};
			}
		}
		params.append(
			"f",
			[f.key, f.op, values.join(VALUE_SEPARATOR)].join(FILTER_SEPARATOR),
		);
	}
	if (answer.sort !== null) params.set("sort", answer.sort);
	if (answer.limit !== null) params.set("limit", String(answer.limit));

	const parsed = parseSelection(params);
	if (!parsed.ok) return parsed;

	for (const f of parsed.selection.filters) {
		const spec = filterByKey(parsed.source, f.key);
		if (spec?.type !== "enum") continue;
		const roster = spec.vocabulary
			? VOCABULARY_ROSTERS[spec.vocabulary]
			: undefined;
		if (!roster) {
			// Unreachable while every enum filter names a vocabulary the rosters
			// module defines — pinned in ask.test.ts. Refused rather than passed,
			// because an unchecked value is the failure this check exists for.
			return { ok: false, message: `Filter '${f.key}' has no list to check` };
		}
		const unknown = f.values.filter((v) => !roster.options.includes(v));
		if (unknown.length > 0) {
			return {
				ok: false,
				message: `Filter '${f.key}' names ${unknown.join(", ")}, which ${unknown.length === 1 ? "is" : "are"} not in list ${spec.vocabulary}`,
			};
		}
	}
	return { ok: true, value: parsed.selection };
}

// ---------- One question ----------

export interface AskDeps {
	// One model call. Throws when the model is unavailable.
	callModel: (inputs: AskModelInputs) => Promise<unknown>;
	loadRoster: RosterLoader;
	// YYYY-MM-DD, for questions about recent games.
	today: string;
	effort?: ReasoningEffort;
	// Unset means ASK_TEMPERATURE. null sends no temperature, so the model's
	// default applies. The eval uses null to compare against the default.
	temperature?: number | null;
}

export type AskOutcome = {
	attempts: number;
	usage: AskUsage[];
	// The tool arguments of the last reply, verbatim. For the eval's report.
	lastArguments: string | null;
} & (
	| { kind: "selection"; selection: QuerySelection; canonical: string }
	| { kind: "unsupported"; reason: string }
	// Both attempts failed a check. `message` is the second failure's.
	| { kind: "failed"; message: string }
);

// The first call, and one retry that carries the failure's message. The
// monthly budget reserves this many calls for a question before it runs.
export const ASK_MAX_ATTEMPTS = 2;

/**
 * Translate one question. A failed check is retried once with its message; a
 * second failure, or an "unsupported" reply, is the outcome. A model call that
 * throws propagates.
 */
export async function askQuestion(
	question: string,
	deps: AskDeps,
): Promise<AskOutcome> {
	const effort = deps.effort ?? ASK_REASONING_EFFORT;
	const temperature =
		deps.temperature === undefined ? ASK_TEMPERATURE : deps.temperature;
	const messages = askMessages(question, deps.today);
	const usage: AskUsage[] = [];
	let lastArguments: string | null = null;
	let failure = "";

	for (let attempt = 1; attempt <= ASK_MAX_ATTEMPTS; attempt++) {
		const reply = readModelReply(
			await deps.callModel(buildAskInputs(messages, effort, temperature)),
		);
		usage.push(reply.usage);
		lastArguments = reply.call?.function.arguments ?? null;

		const checked = await checkReply(reply, deps.loadRoster);
		if (checked.ok) {
			const value = checked.value;
			if (value.kind === "unsupported") {
				return {
					kind: "unsupported",
					reason: value.reason,
					attempts: attempt,
					usage,
					lastArguments,
				};
			}
			return {
				kind: "selection",
				selection: value.selection,
				canonical: canonicalSelection(value.selection),
				attempts: attempt,
				usage,
				lastArguments,
			};
		}

		failure = checked.message;
		const retry = `That answer was refused: ${failure}. Call the ${ASK_TOOL_NAME} tool again with a corrected selection, or with kind "unsupported". A name the server could not match is not a reason to move it to player_name: answer "unsupported" unless the question misspelled a name you can correct.`;
		if (reply.call) {
			messages.push(
				{ role: "assistant", content: null, tool_calls: [reply.call] },
				{ role: "tool", tool_call_id: reply.call.id, content: retry },
			);
		} else {
			messages.push(
				{ role: "assistant", content: reply.content ?? "" },
				{ role: "user", content: retry },
			);
		}
	}
	return {
		kind: "failed",
		message: failure,
		attempts: ASK_MAX_ATTEMPTS,
		usage,
		lastArguments,
	};
}

async function checkReply(
	reply: ModelReply,
	loadRoster: RosterLoader,
): Promise<
	Checked<
		| { kind: "unsupported"; reason: string }
		| { kind: "selection"; selection: QuerySelection }
	>
> {
	if (!reply.call || reply.call.function.name !== ASK_TOOL_NAME) {
		return {
			ok: false,
			message: `The reply did not call the ${ASK_TOOL_NAME} tool`,
		};
	}
	const answer = readAnswer(reply.call.function.arguments);
	if (!answer.ok) return answer;
	if (answer.value.kind === "unsupported") {
		return { ok: true, value: answer.value };
	}
	const checked = await checkAnswer(answer.value, loadRoster);
	if (!checked.ok) return checked;
	return {
		ok: true,
		value: { kind: "selection", selection: checked.value },
	};
}
