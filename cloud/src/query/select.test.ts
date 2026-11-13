import { describe, expect, it } from "vitest";
import { MAX_ROWS } from "./catalog";
import { canonicalSelection, parseSelection } from "./select";

function parse(qs: string) {
	return parseSelection(new URLSearchParams(qs));
}

function ok(qs: string) {
	const result = parse(qs);
	if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
	return result;
}

function err(qs: string): string {
	const result = parse(qs);
	if (result.ok) throw new Error("expected a refusal");
	return result.message;
}

describe("parseSelection", () => {
	it("reads the whole selection", () => {
		const { selection } = ok(
			"source=player_summaries&dim=player,nation&measure=matches" +
				"&f=nation:in:NATION_CARTHAGE&sort=measure_asc&limit=10",
		);
		expect(selection).toEqual({
			source: "player_summaries",
			dimensions: ["player", "nation"],
			measure: "matches",
			filters: [{ key: "nation", op: "in", values: ["NATION_CARTHAGE"] }],
			sort: "measure_asc",
			limit: 10,
		});
	});

	it("requires a source and a measure", () => {
		expect(err("measure=matches")).toContain("source");
		expect(err("source=games")).toContain("measure");
	});

	// The whole point of parsing strictly where the /stats facets parse
	// forgivingly: an unknown facet can fall back to a neighbouring view, but
	// an unknown filter key can only be dropped, and dropping a filter widens
	// the question. A wider answer reads exactly like the right one.
	it("refuses an unknown key rather than dropping it", () => {
		expect(err("source=games&measure=nope")).toContain("nope");
		expect(err("source=games&measure=matches&dim=nope")).toContain("nope");
		expect(err("source=games&measure=matches&f=nope:in:x")).toContain("nope");
	});

	it("refuses an entry the source cannot reach", () => {
		// `nation` lives on a seat; the games source has no player_index.
		expect(err("source=games&measure=matches&dim=nation")).toContain("nation");
	});

	it("refuses an operator the filter does not offer", () => {
		expect(err("source=games&measure=matches&f=map_class:gte:X")).toContain(
			"gte",
		);
	});

	it("takes one value for a range bound", () => {
		// Two would be an AND the caller meant to write as two filters, and
		// silently taking the first is the quiet widening this parse refuses.
		expect(
			err("source=games&measure=matches&f=total_turns:gte:10,20"),
		).toContain("one value");
	});

	it("refuses a malformed filter", () => {
		expect(err("source=games&measure=matches&f=map_class")).toContain(
			"Malformed",
		);
		expect(err("source=games&measure=matches&f=a:b:c:d")).toContain(
			"Malformed",
		);
	});

	it("refuses a duplicate grouping", () => {
		expect(
			err("source=player_summaries&measure=matches&dim=nation,nation"),
		).toContain("twice");
	});

	it("refuses a repeated filter pair", () => {
		expect(
			err("source=games&measure=matches&f=map_class:in:A&f=map_class:in:B"),
		).toContain("twice");
	});

	it("takes the two bounds of a window on one column", () => {
		// A pair is (key, operator), so `gte` and `lte` on one column are two
		// filters rather than a repeat — and so is an include beside an exclude.
		expect(
			ok(
				"source=games&measure=matches&f=total_turns:gte:10&f=total_turns:lte:80",
			).selection.filters,
		).toHaveLength(2);
		expect(
			ok("source=games&measure=matches&f=map_class:in:A&f=map_class:not_in:B")
				.selection.filters,
		).toHaveLength(2);
	});

	it("refuses sorting by a grouping there isn't", () => {
		expect(err("source=games&measure=matches&sort=dimension_asc")).toContain(
			"grouping",
		);
	});

	it("clamps the row cap instead of refusing it", () => {
		// The one value that is clamped: asking for more rows than the
		// endpoint serves can only narrow to the bound it already has.
		expect(ok("source=games&measure=matches&limit=99999").selection.limit).toBe(
			MAX_ROWS,
		);
		expect(err("source=games&measure=matches&limit=0")).toContain("limit");
		expect(err("source=games&measure=matches&limit=ten")).toContain("limit");
	});

	it("validates a value against its type", () => {
		expect(
			err("source=games&measure=matches&f=played:gte:last-tuesday"),
		).toContain("played");
		expect(
			err("source=games&measure=matches&f=tournament:in:not-a-nanoid"),
		).toContain("tournament");
		expect(
			err("source=player_summaries&measure=matches&f=is_human:in:maybe"),
		).toContain("is_human");
	});

	it("normalizes a boolean to the spelling it stores", () => {
		// So `is_human=true` and `is_human=1` are one cache entry rather than
		// two scans of the same question.
		const a = ok("source=player_summaries&measure=matches&f=is_human:in:true");
		const b = ok("source=player_summaries&measure=matches&f=is_human:in:1");
		expect(canonicalSelection(a.selection)).toBe(
			canonicalSelection(b.selection),
		);
	});
});

describe("canonicalSelection", () => {
	it("is one spelling for one question", () => {
		const a = ok(
			"limit=50&source=player_summaries&f=nation:in:NATION_ROME,NATION_EGYPT" +
				"&measure=matches&dim=player&sort=measure_desc",
		);
		const b = ok(
			"source=player_summaries&dim=player&measure=matches" +
				"&f=nation:in:NATION_EGYPT,NATION_ROME",
		);
		expect(canonicalSelection(a.selection)).toBe(
			canonicalSelection(b.selection),
		);
	});

	it("drops the defaults", () => {
		const { selection } = ok("source=games&measure=matches");
		expect(canonicalSelection(selection)).toBe("source=games&measure=matches");
	});

	it("round-trips through the parser", () => {
		const { selection } = ok(
			"source=wonder_events&dim=player&measure=matches" +
				"&f=wonder:in:IMPROVEMENT_PYRAMIDS&limit=25",
		);
		const canonical = canonicalSelection(selection);
		const again = ok(canonical);
		expect(canonicalSelection(again.selection)).toBe(canonical);
	});

	it("sorts filters so two orderings are one key", () => {
		const a = ok(
			"source=player_summaries&measure=matches" +
				"&f=nation:in:NATION_ROME&f=is_human:in:1",
		);
		const b = ok(
			"source=player_summaries&measure=matches" +
				"&f=is_human:in:1&f=nation:in:NATION_ROME",
		);
		expect(canonicalSelection(a.selection)).toBe(
			canonicalSelection(b.selection),
		);
	});
});
