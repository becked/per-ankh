import { describe, expect, it } from "vitest";
import { compileQuery, needsOneUploadPerMatch } from "./compile";
import { SOURCES } from "./catalog";
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

describe("the game mode filter", () => {
	// Its values are roster compositions rather than the `games.game_mode`
	// column, so it is the one filter whose values name a predicate instead of
	// being compared against a column. What is checked here is that each value
	// compiles to the composition /stats slices by, and that the two set
	// operators mean what they say over a set of subqueries.
	it("compiles a value to the composition predicate it names", () => {
		const { sql, binds } = compile(
			"source=games&measure=matches&f=game_mode:in:duel",
		);
		const flattened = flat(sql);
		expect(flattened).toContain(
			"g.game_id IN (SELECT game_id FROM player_summaries " +
				"GROUP BY game_id HAVING COUNT(*) = 2 AND SUM(is_human) = 2)",
		);
		// Nothing bound but the row cap: the value picked a compiled-in
		// fragment, so there is no literal of the caller's in the statement.
		expect(binds).toEqual([50]);
		expect(flattened).not.toContain("duel");
	});

	it("joins several values with OR, and their negation with AND", () => {
		expect(
			flat(compile("source=games&measure=matches&f=game_mode:in:duel,ffa").sql),
		).toContain("HAVING COUNT(*) = 2 AND SUM(is_human) = 2) OR g.game_id IN (");

		const negated = flat(
			compile("source=games&measure=matches&f=game_mode:not_in:duel,ffa").sql,
		);
		expect(negated).toContain("g.game_id NOT IN (");
		expect(negated).toContain(
			"HAVING COUNT(*) = 2 AND SUM(is_human) = 2) AND g.game_id NOT IN (",
		);
	});

	it("refuses a value that names no composition", () => {
		// Refused at the parse rather than left to select nothing: a value
		// compared against a column can name nothing and return no rows, but a
		// composition value with no fragment has no predicate to compile to.
		// NETWORK is the test case on purpose — it is a value the column this
		// filter replaced did take.
		expect(() =>
			compile("source=games&measure=matches&f=game_mode:in:NETWORK"),
		).toThrow();
	});

	it("is offered at every grain, because it is a property of the game", () => {
		for (const source of SOURCES) {
			expect(
				source.filters.map((f) => f.key),
				source.key,
			).toContain("game_mode");
		}
	});

	it("is a filter and not a grouping", () => {
		// The three compositions do not partition the corpus — a game with two
		// humans and any AI matches none of them — so a grouping on it would
		// carry a NULL row for a bucket with no name. This also pins that the
		// `games.game_mode` dimension it replaced is gone: one key, and it is
		// not groupable.
		for (const source of SOURCES) {
			expect(
				source.dimensions.map((d) => d.key),
				source.key,
			).not.toContain("game_mode");
		}
	});
});

describe("measure units", () => {
	it("dedupes a match both players uploaded", () => {
		expect(flat(compile("source=games&measure=matches").sql)).toContain(
			"COUNT(DISTINCT g.xml_game_id)",
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

	it("narrows the aggregates that need it to one upload per match, on every source", () => {
		// Split on needsOneUploadPerMatch rather than on the string "AVG":
		// the defect this guards against is an aggregate added later that
		// nobody remembers to dedupe, and a sum is one — it adds up however
		// many rows it was handed, so a match uploaded twice doubles it. Under
		// the old split a sum fell into the other bucket, so the suite passed
		// on a sum that double-counted and failed on one that did not.
		//
		// Enumerated from the catalog rather than from a list written here,
		// for the same reason: a hand-written list is the thing that goes
		// stale.
		for (const source of SOURCES) {
			for (const measure of source.measures) {
				if (!needsOneUploadPerMatch(measure)) continue;
				const sql = flat(
					compile(`source=${source.key}&measure=${measure.key}`).sql,
				);
				expect(sql, `${source.key}.${measure.key}`).toContain(
					"ROW_NUMBER() OVER (PARTITION BY xml_game_id",
				);
			}
		}
	});

	it("leaves a count and an extremum reading every upload", () => {
		// They are already invariant: a count says DISTINCT over the key its
		// unit names, and the same extremum comes back however many copies of
		// a row there are. Narrowing them too would be a second answer to a
		// question that is already answered.
		for (const source of SOURCES) {
			for (const measure of source.measures) {
				if (needsOneUploadPerMatch(measure)) continue;
				const sql = flat(
					compile(`source=${source.key}&measure=${measure.key}`).sql,
				);
				expect(sql, `${source.key}.${measure.key}`).not.toContain(
					"ROW_NUMBER()",
				);
			}
		}
	});

	it("narrows a sum, named rather than derived", () => {
		// The one assertion here that does not read needsOneUploadPerMatch, so
		// the rule is pinned against the SQL and not only against its own
		// predicate. A sum over two uploads of one match is double the units
		// that match's seats trained.
		const sql = flat(
			compile("source=player_units_produced&measure=units_produced").sql,
		);
		expect(sql).toContain("SUM(pup.count)");
		expect(sql).toContain("ROW_NUMBER() OVER (PARTITION BY xml_game_id");
	});

	it("picks the surviving upload by a property of the corpus", () => {
		// Without the ORDER BY the pick would be D1's scan order, and the same
		// question would answer differently between two runs.
		const sql = flat(compile("source=player_summaries&measure=avg_techs").sql);
		expect(sql).toContain("ORDER BY total_turns DESC, game_id ASC");
	});

	it("picks only from the corpus the question runs over", () => {
		// A private upload that won the pick would then be filtered out by the
		// outer WHERE, and the match would leave the answer entirely.
		const sql = flat(compile("source=games&measure=avg_turns").sql);
		expect(sql).toContain("FROM games WHERE is_public = 1 AND game_id NOT IN");
	});

	it("reads total science off the cumulative column, not the rate", () => {
		// The two science measures answer different questions and must not
		// compile to the same column: `avg_science` is the per-turn rate,
		// `max_science` the running total it accumulates into.
		expect(
			flat(compile("source=game_player_turn&measure=max_science").sql),
		).toContain("MAX(gpt.science_cumulative)");
		expect(
			flat(compile("source=game_player_turn&measure=avg_science").sql),
		).toContain("AVG(gpt.science_per_turn)");
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

	it("drops the seats that resolve to no account", () => {
		// All of them share the one NULL key, so they group into a single row
		// that names nobody and leads the default sort. 702 of the 2,051 seats
		// in the 2026-11-10 snapshot, 116 in-save names and 346 AI seats in
		// one row, against 227 for the top account.
		expect(
			flat(compile("source=player_summaries&measure=seats&dim=player").sql),
		).toContain(
			"COALESCE(CASE WHEN ps.is_uploader = 1 THEN g.user_id END, uo.user_id) IS NOT NULL",
		);
	});

	it("drops them for the grouping only, not for a filter on the same column", () => {
		// A filter is IN/NOT IN over user_ids and NULL satisfies neither, so
		// the predicate would be a second spelling of a rule SQL already has.
		expect(
			flat(
				compile(
					"source=player_summaries&measure=seats&dim=nation" +
						"&f=player:in:O-1ONgvfrVql0yVJiATyh",
				).sql,
			),
		).not.toContain("uo.user_id) IS NOT NULL");
	});

	it("leaves a value dimension's unrecorded rows in", () => {
		// The opposite call for the opposite reason: `difficulty` is
		// unrecorded for 429 matches against 475 on DIFFICULTY_MAGNIFICENT in
		// that snapshot, and dropping the row would read as 475 of 510.
		expect(
			flat(compile("source=games&measure=matches&dim=difficulty").sql),
		).not.toContain("IS NOT NULL");
	});

	it("narrows to one account by the same expression it groups on", () => {
		// A filter that resolved a seat's owner differently from the grouping
		// would answer "Siontific's games" over a different set of seats than
		// the row labelled Siontific holds.
		const { sql, binds } = compile(
			"source=player_summaries&measure=matches" +
				"&f=player:in:O-1ONgvfrVql0yVJiATyh",
		);
		expect(flat(sql)).toContain(
			"COALESCE(CASE WHEN ps.is_uploader = 1 THEN g.user_id END, uo.user_id) IN (?)",
		);
		expect(binds).toContain("O-1ONgvfrVql0yVJiATyh");
	});

	it("brings the identity joins in for a filter, not only a grouping", () => {
		// `reach` carries from the dimension to the filter derived from it, so
		// a question that only narrows by player still gets `uo` and `ud` in
		// scope. Without them the WHERE names an alias that is not there.
		const sql = flat(
			compile(
				"source=wonder_events&measure=matches&dim=wonder" +
					"&f=player:in:O-1ONgvfrVql0yVJiATyh",
			).sql,
		);
		expect(sql).toContain("user_online_ids");
		expect(sql).toContain("LEFT JOIN users ud");
		expect(sql).toContain("JOIN player_summaries ps");
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

// The three questions issue #272 sets as the acceptance test, over the nine
// game-derived tables D1 projects — `player_units_produced` (migration 0057)
// being the ninth, added for Q3.
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

	it("Q3 — who built the most ballistae in the tournament", () => {
		const { sql, binds } = compile(
			"source=player_units_produced&dim=player&measure=units_produced" +
				"&f=unit:in:UNIT_BALLISTA" +
				"&f=tournament:in:bbbbbbbbbbbbbbbbbbbbb",
		);
		const flattened = flat(sql);
		expect(flattened).toContain("FROM player_units_produced pup");
		expect(flattened).toContain("pup.unit_type IN (?)");
		expect(flattened).toContain("g.game_id IN (SELECT DISTINCT m.game_id");
		// The seat join is what carries the account the question groups on:
		// the table holds a player_index and nothing else about the seat.
		expect(flattened).toContain("JOIN player_summaries ps");
		// Summed over one upload per match, or a duel both players uploaded
		// reports twice the ballistae either of them built.
		expect(flattened).toContain("SUM(pup.count)");
		expect(flattened).toContain("ROW_NUMBER() OVER (PARTITION BY xml_game_id");
		expect(binds).toEqual(["UNIT_BALLISTA", "bbbbbbbbbbbbbbbbbbbbb", 50]);
	});
});
