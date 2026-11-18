import { describe, expect, it } from "vitest";

import { VOCABULARY_ROSTERS } from "../../../src/lib/query/vocabulary-rosters";
import {
	ASK_SYSTEM_PROMPT,
	ASK_TOOL_NAME,
	askQuestion,
	checkAnswer,
	matchRosterName,
	readAnswer,
	readModelReply,
	type AskAnswer,
	type RosterLoader,
} from "./ask";
import { SOURCES, type CatalogRosterOption } from "./catalog";

const PLAYERS: CatalogRosterOption[] = [
	{ value: "user-al-0000000000000", label: "Al" },
	{ value: "user-alexios-00000000", label: "Alexios" },
	{ value: "user-alexandra-000000", label: "Alexandra" },
	{ value: "user-twin-a-000000000", label: "Twin" },
	{ value: "user-twin-b-000000000", label: "twin" },
];
const TOURNAMENTS: CatalogRosterOption[] = [
	{ value: "tournamentSpringCup01", label: "Per-Ankh Spring Cup 2026" },
];
const rosters: RosterLoader = async (v) =>
	v === "player" ? PLAYERS : TOURNAMENTS;

type SelectionAnswer = Extract<AskAnswer, { kind: "selection" }>;

function selection(over: Partial<SelectionAnswer>): SelectionAnswer {
	return {
		kind: "selection",
		source: "wonder_events",
		measure: "wonders_built",
		dimensions: [],
		filters: [],
		sort: null,
		limit: null,
		...over,
	};
}

function reply(args: unknown): unknown {
	return {
		choices: [
			{
				message: {
					content: null,
					tool_calls: [
						{
							id: "call_1",
							type: "function",
							function: {
								name: ASK_TOOL_NAME,
								arguments: JSON.stringify(args),
							},
						},
					],
				},
			},
		],
		usage: {
			prompt_tokens: 9000,
			completion_tokens: 100,
			prompt_tokens_details: { cached_tokens: 8000 },
		},
	};
}

describe("the system prompt", () => {
	it("checks every enum filter against a list the rosters module defines", () => {
		// checkAnswer refuses an enum filter with no list rather than passing it,
		// so a vocabulary missing here would make every question on that filter
		// fail. Pinned so the gap shows up here and not in production.
		for (const source of SOURCES) {
			for (const f of source.filters) {
				if (f.type !== "enum") continue;
				expect(VOCABULARY_ROSTERS[f.vocabulary ?? ""], f.key).toBeDefined();
			}
		}
	});

	it("names every source and carries no column expression", () => {
		for (const source of SOURCES) {
			expect(ASK_SYSTEM_PROMPT).toContain(`### ${source.key}:`);
			// `sql` is the half of a catalog entry that never leaves the Worker
			// (serializeCatalog says why). The prompt is built from the same
			// entries, so it is held to the same rule.
			for (const entry of [
				...source.dimensions,
				...source.measures.flatMap((m) => (m.agg ? [m.agg] : [])),
				...source.filters,
			]) {
				if (entry.sql) expect(ASK_SYSTEM_PROMPT).not.toContain(entry.sql);
			}
		}
	});
});

describe("matchRosterName", () => {
	it("prefers an exact name over a longer one containing it", () => {
		expect(matchRosterName(PLAYERS, "al", "player")).toEqual({
			ok: true,
			value: "user-al-0000000000000",
		});
	});

	it("matches a part of exactly one name", () => {
		expect(matchRosterName(TOURNAMENTS, "spring  cup", "tournament")).toEqual({
			ok: true,
			value: "tournamentSpringCup01",
		});
	});

	it("refuses a part of several names and lists them", () => {
		const match = matchRosterName(PLAYERS, "alex", "player");
		expect(match.ok).toBe(false);
		if (!match.ok) expect(match.message).toContain("Alexios, Alexandra");
	});

	it("refuses two accounts that share a display name", () => {
		expect(matchRosterName(PLAYERS, "Twin", "player").ok).toBe(false);
	});

	it("refuses a name nothing contains", () => {
		const match = matchRosterName(PLAYERS, "Gilgamesh99", "player");
		expect(match).toEqual({
			ok: false,
			message: 'No player matches "Gilgamesh99"',
		});
	});
});

describe("checkAnswer", () => {
	it("resolves names to IDs and returns the parsed selection", async () => {
		const checked = await checkAnswer(
			selection({
				dimensions: ["player"],
				filters: [
					{ key: "tournament", op: "in", values: ["Spring Cup"] },
					{ key: "wonder", op: "in", values: ["IMPROVEMENT_PYRAMIDS"] },
				],
			}),
			rosters,
		);
		expect(checked.ok && checked.value.filters).toEqual([
			{ key: "tournament", op: "in", values: ["tournamentSpringCup01"] },
			{ key: "wonder", op: "in", values: ["IMPROVEMENT_PYRAMIDS"] },
		]);
	});

	it("refuses an enum value outside its list", async () => {
		const checked = await checkAnswer(
			selection({
				source: "player_units_produced",
				measure: "units_produced",
				filters: [{ key: "unit", op: "in", values: ["UNIT_BALLISTAE"] }],
			}),
			rosters,
		);
		expect(checked).toEqual({
			ok: false,
			message: "Filter 'unit' names UNIT_BALLISTAE, which is not in list unit",
		});
	});

	it("passes the parser's refusal through", async () => {
		const checked = await checkAnswer(
			selection({ measure: "not_a_measure" }),
			rosters,
		);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.message).toContain("Unknown measure");
	});

	it("refuses a value carrying a separator", async () => {
		const checked = await checkAnswer(
			selection({
				source: "player_summaries",
				measure: "seats",
				filters: [{ key: "player_name", op: "in", values: ["a,b"] }],
			}),
			rosters,
		);
		expect(checked.ok).toBe(false);
	});

	it("reads a roster only when a filter needs it", async () => {
		const asked: string[] = [];
		await checkAnswer(selection({}), async (v) => {
			asked.push(v);
			return [];
		});
		expect(asked).toEqual([]);
	});
});

describe("readAnswer and readModelReply", () => {
	it("reads an unsupported reply with its reason", () => {
		expect(
			readAnswer(
				JSON.stringify({ kind: "unsupported", reason: "No religions." }),
			),
		).toEqual({
			ok: true,
			value: { kind: "unsupported", reason: "No religions." },
		});
	});

	it("refuses arguments that are not JSON", () => {
		expect(readAnswer("{not json").ok).toBe(false);
	});

	it("reads the usage, cached tokens included", () => {
		const read = readModelReply(reply({ kind: "unsupported", reason: "x" }));
		expect(read.usage).toEqual({
			inputTokens: 9000,
			cachedInputTokens: 8000,
			outputTokens: 100,
		});
		expect(read.call?.function.name).toBe(ASK_TOOL_NAME);
	});

	it("throws on a reply with no choices", () => {
		expect(() => readModelReply({})).toThrow();
	});
});

describe("askQuestion", () => {
	const deps = (replies: unknown[]) => {
		const sent: unknown[] = [];
		let charged = 0;
		return {
			sent,
			charged: () => charged,
			deps: {
				callModel: async (inputs: unknown) => {
					sent.push(inputs);
					return replies.shift();
				},
				loadRoster: rosters,
				beforeCall: async () => {
					charged++;
				},
				today: "2026-11-17",
			},
		};
	};

	it("retries once and then reports the second failure", async () => {
		const bad = reply({
			kind: "selection",
			source: "wonder_events",
			measure: "wonders_built",
			filters: [{ key: "wonder", op: "in", values: ["IMPROVEMENT_PYRAMID"] }],
		});
		const run = deps([bad, bad]);
		const outcome = await askQuestion("Who built the pyramid?", run.deps);
		expect(outcome.kind).toBe("failed");
		expect(outcome.attempts).toBe(2);
		expect(run.charged()).toBe(2);
	});

	it("asks again after a reply with no tool call", async () => {
		const text = {
			choices: [{ message: { content: "Sure!", tool_calls: [] } }],
		};
		const run = deps([
			text,
			reply({ kind: "unsupported", reason: "No religions." }),
		]);
		const outcome = await askQuestion("Which religion?", run.deps);
		expect(outcome.kind).toBe("unsupported");
		expect(outcome.attempts).toBe(2);
	});

	it("returns the canonical spelling of the selection", async () => {
		const run = deps([
			reply({
				kind: "selection",
				source: "wonder_events",
				measure: "wonders_built",
				dimensions: ["player"],
				filters: [
					{ key: "wonder", op: "in", values: ["IMPROVEMENT_PYRAMIDS"] },
				],
				sort: "measure_desc",
				limit: 50,
			}),
		]);
		const outcome = await askQuestion("Who built the Pyramids?", run.deps);
		expect(outcome.kind === "selection" && outcome.canonical).toBe(
			"source=wonder_events&dim=player&measure=wonders_built&f=wonder:in:IMPROVEMENT_PYRAMIDS",
		);
	});
});
