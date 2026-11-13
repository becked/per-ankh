import { describe, expect, it } from "vitest";
import { compileQuery } from "./compile";
import { parseSelection } from "./select";
import type { CompiledQuery } from "./compile";

function compile(qs: string): CompiledQuery {
	const parsed = parseSelection(new URLSearchParams(qs));
	if (!parsed.ok) throw new Error(parsed.message);
	return compileQuery(parsed.source, parsed.selection);
}

// Collapse the statement's whitespace so an assertion reads as one fragment
// rather than as the formatting it happens to be emitted with.
function flat(sql: string): string {
	return sql.replace(/\s+/g, " ");
}

describe("the corpus every selection runs over", () => {
	it("is public games with challenge runs excluded, always", () => {
		for (const qs of [
			"source=games&measure=matches",
			"source=player_summaries&measure=seats&dim=nation",
			"source=game_player_turn&measure=avg_legitimacy",
		]) {
			const sql = flat(compile(qs).sql);
			expect(sql, qs).toContain("g.is_public = 1");
			expect(sql, qs).toContain("challenge_submissions");
		}
	});

	it("is not expressible, so it cannot be turned off", () => {
		// There is no catalog entry for is_public, which is what makes the
		// predicate a visibility rule rather than a facet.
		expect(() =>
			compile("source=games&measure=matches&f=is_public:in:0"),
		).toThrow();
	});
});

describe("binding", () => {
	it("binds every caller-supplied value", () => {
		const { sql, binds } = compile(
			"source=player_summaries&measure=matches" +
				"&f=nation:in:NATION_ROME,NATION_EGYPT&f=final_points:gte:100&limit=25",
		);
		expect(sql).not.toContain("NATION_ROME");
		expect(sql).not.toContain("100");
		// Values in selection order, then the row cap last.
		expect(binds).toEqual(["NATION_ROME", "NATION_EGYPT", 100, 25]);
	});

	it("binds a number as a number", () => {
		// Rather than leaning on SQLite's affinity rules to turn '50' into 50
		// at the comparison.
		const { binds } = compile(
			"source=game_player_turn&measure=avg_science&f=turn:gte:50",
		);
		expect(binds[0]).toBe(50);
	});

	it("ends every statement with the row cap", () => {
		const { sql, binds } = compile("source=games&measure=matches&limit=7");
		expect(sql.trimEnd().endsWith("LIMIT ?")).toBe(true);
		expect(binds.at(-1)).toBe(7);
	});
});

describe("measure units", () => {
	it("dedupes a match both players uploaded", () => {
		expect(flat(compile("source=games&measure=matches").sql)).toContain(
			"COUNT(DISTINCT g.xml_game_id)",
		);
	});

	it("counts uploads when the unit is a save", () => {
		expect(flat(compile("source=games&measure=saves").sql)).toContain(
			"COUNT(DISTINCT g.game_id)",
		);
	});

	it("keys a seat on the match, not on the save", () => {
		const sql = flat(compile("source=player_summaries&measure=seats").sql);
		expect(sql).toContain(
			"COUNT(DISTINCT g.xml_game_id || ':' || ps.player_index)",
		);
	});

	it("counts a win once however many uploads the match has", () => {
		// SUM(ps.is_winner) is the obvious spelling and counts it twice.
		const sql = flat(compile("source=player_summaries&measure=wins").sql);
		expect(sql).toContain("COUNT(DISTINCT CASE WHEN ps.is_winner = 1");
		expect(sql).not.toContain("SUM(ps.is_winner)");
	});

	it("keys an event on the source's own grain", () => {
		expect(
			flat(compile("source=wonder_events&measure=wonders_built").sql),
		).toContain("COUNT(DISTINCT g.xml_game_id || ':' || we.wonder)");
	});
});

describe("joins", () => {
	it("joins games from every other source", () => {
		expect(flat(compile("source=wonder_events&measure=matches").sql)).toContain(
			"JOIN games g ON g.game_id = we.game_id",
		);
	});

	it("leaves the seat join out of a question that never mentions one", () => {
		const sql = flat(compile("source=wonder_events&measure=matches").sql);
		expect(sql).not.toContain("JOIN player_summaries");
	});

	it("adds the identity joins only when a question asks who", () => {
		const without = flat(
			compile("source=wonder_events&measure=matches&dim=wonder").sql,
		);
		expect(without).not.toContain("user_online_ids");

		const with_ = flat(
			compile("source=wonder_events&measure=matches&dim=player").sql,
		);
		expect(with_).toContain("user_online_ids");
		expect(with_).toContain("LEFT JOIN users ud");
	});

	it("does not re-join a source that is already the seat table", () => {
		const sql = flat(compile("source=player_summaries&measure=seats").sql);
		expect(sql).toContain("FROM player_summaries ps");
		expect(sql.match(/JOIN player_summaries/g)).toBeNull();
	});
});

describe("identity", () => {
	it("groups on the account and displays the name", () => {
		const { sql, columns } = compile(
			"source=player_summaries&measure=matches&dim=player",
		);
		// Grouping on the display name instead would merge two accounts that
		// happen to share one.
		expect(flat(sql)).toContain("GROUP BY COALESCE(CASE WHEN ps.is_uploader");
		expect(columns.map((c) => c.key)).toEqual([
			"player",
			"player_id",
			"player_slug",
			"value",
		]);
	});

	it("resolves an id only while it names exactly one account", () => {
		// The rule lives in UNAMBIGUOUS_ONLINE_ID_OWNERS_SQL and is read, not
		// restated — an id two accounts claim credits nobody.
		expect(
			flat(compile("source=player_summaries&measure=matches&dim=player").sql),
		).toContain("WHERE NOT EXISTS");
	});
});

describe("grouping and ordering", () => {
	it("always groups, so no selection returns raw rows", () => {
		const sql = flat(
			compile("source=game_player_turn&measure=turn_rows&dim=turn").sql,
		);
		expect(sql).toContain("GROUP BY gpt.turn");
	});

	it("is one row when nothing is grouped", () => {
		// A grand total is still an aggregate — there is no raw-row projection
		// in the grammar at all.
		const sql = flat(compile("source=game_player_turn&measure=turn_rows").sql);
		expect(sql).not.toContain("GROUP BY");
		expect(sql).toContain("COUNT(DISTINCT");
	});

	it("breaks a tie on the grouping rather than on scan order", () => {
		const sql = flat(
			compile("source=player_summaries&measure=matches&dim=nation").sql,
		);
		expect(sql).toContain("ORDER BY value DESC, d0 ASC");
	});

	it("orders by the grouping when asked to", () => {
		const sql = flat(
			compile(
				"source=player_summaries&measure=matches&dim=nation&sort=dimension_asc",
			).sql,
		);
		expect(sql).toContain("ORDER BY d0 ASC");
	});
});

// The three questions issue #272 sets as the acceptance test. Q3 needs a
// projection that does not exist yet (units_produced) and is phase two; these
// are the two that are answerable over the eight projected tables.
describe("the issue's acceptance questions", () => {
	it("Q1 — which players in tournament X built the Pyramids", () => {
		const { sql, binds } = compile(
			"source=wonder_events&dim=player&measure=matches" +
				"&f=wonder:in:IMPROVEMENT_PYRAMIDS" +
				"&f=tournament:in:bbbbbbbbbbbbbbbbbbbbb",
		);
		const flattened = flat(sql);
		expect(flattened).toContain("FROM wonder_events we");
		expect(flattened).toContain("we.wonder IN (?)");
		expect(flattened).toContain("g.game_id IN (SELECT DISTINCT m.game_id");
		expect(flattened).toContain("COUNT(DISTINCT g.xml_game_id)");
		expect(binds).toEqual([
			"IMPROVEMENT_PYRAMIDS",
			"bbbbbbbbbbbbbbbbbbbbb",
			50,
		]);
	});

	it("Q2 — how often a player played Carthage with a Schemer ruler", () => {
		const { sql, binds } = compile(
			"source=player_summaries&dim=player&measure=matches" +
				"&f=nation:in:NATION_CARTHAGE" +
				"&f=starting_archetype:in:TRAIT_SCHEMER_ARCHETYPE",
		);
		const flattened = flat(sql);
		expect(flattened).toContain("ps.nation IN (?)");
		expect(flattened).toContain("ps.starting_ruler_archetype IN (?)");
		// The count the issue names as inflated by the double upload. Deduped
		// here because the measure's unit is a match.
		expect(flattened).toContain("COUNT(DISTINCT g.xml_game_id)");
		expect(binds).toEqual(["NATION_CARTHAGE", "TRAIT_SCHEMER_ARCHETYPE", 50]);
	});
});
