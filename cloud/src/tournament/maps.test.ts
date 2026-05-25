import { describe, expect, it } from "vitest";
import { assignMap, assignMapsToPairings } from "./maps";
import { createRng } from "./rng";
import type { MapPoolEntry, MatchRef } from "./types";

// `poolId` is the map_pool instance the match was played on. Anti-repeat counts
// by base script, so map_script is what actually matters; the helper sets both
// fields to `poolId`, and the POOL below uses ids that equal their scripts so
// the two coincide for these single-instance-per-script cases.
function m(
	id: string,
	a: string,
	b: string | null,
	poolId: string | null,
): MatchRef {
	return {
		match_id: id,
		round_id: "r",
		round_number: 1,
		phase: "swiss",
		division: "A",
		slot_a_id: a,
		slot_b_id: b,
		map_pool_id: poolId,
		map_script: poolId,
		status: "complete",
		winner_slot_id: a,
	};
}

// Instance ids are chosen to read like the scripts they represent so the
// tiebreak (lowest combined play count, then id localeCompare) is legible.
// One instance per script, with id === script so the `m()` helper's
// `map_script: poolId` lines up with each entry's script for these cases.
const POOL: MapPoolEntry[] = [
	{ id: "Continent", script: "Continent", options: {} },
	{ id: "CoastalRainBasin", script: "CoastalRainBasin", options: {} },
	{ id: "AridPlateau", script: "AridPlateau", options: {} },
	{ id: "Donut", script: "Donut", options: {} },
];
const POOL_IDS = POOL.map((e) => e.id);

describe("assignMap", () => {
	it("picks an unplayed instance when one exists for both slots", () => {
		const prior = [m("m1", "A", "X", "Continent")];
		const entry = assignMap("A", "B", POOL, prior, createRng("seed"));
		expect(POOL_IDS).toContain(entry.id);
		expect(entry.id).not.toBe("Continent");
	});

	it("when all instances played, falls back to min combined-play count", () => {
		// A: Continent x2, CoastalRainBasin x1, AridPlateau x1, Donut x0.
		// B: Donut x2, Continent x1, AridPlateau x0, CoastalRainBasin x0.
		// Combined: Continent 3, CoastalRainBasin 1, AridPlateau 1, Donut 2.
		// Min: CoastalRainBasin and AridPlateau (both 1). id tiebreak → AridPlateau.
		const prior: MatchRef[] = [
			m("a1", "A", "X1", "Continent"),
			m("a2", "A", "X2", "Continent"),
			m("a3", "A", "X3", "CoastalRainBasin"),
			m("a4", "A", "X4", "AridPlateau"),
			m("b1", "B", "Y1", "Donut"),
			m("b2", "B", "Y2", "Donut"),
			m("b3", "B", "Y3", "Continent"),
		];
		const entry = assignMap("A", "B", POOL, prior, createRng("seed"));
		expect(entry.id).toBe("AridPlateau");
	});

	it("collapses two instances of the same script for anti-repeat", () => {
		// Two Continent instances (different sizes) plus a Donut. A has played a
		// Continent, so the whole Continent script is now off-limits — the other
		// Continent instance is NOT eligible, and Donut must be chosen.
		const pool: MapPoolEntry[] = [
			{
				id: "cont-duel",
				script: "MAPCLASS_MapScriptContinent",
				options: { MAPSIZE: "MAPSIZE_SMALLEST" },
			},
			{
				id: "cont-tiny",
				script: "MAPCLASS_MapScriptContinent",
				options: { MAPSIZE: "MAPSIZE_TINY" },
			},
			{ id: "donut", script: "MAPCLASS_MapScriptDonut", options: {} },
		];
		// A played cont-duel → map_script "MAPCLASS_MapScriptContinent".
		const prior: MatchRef[] = [
			{
				...m("m1", "A", "X", "cont-duel"),
				map_script: "MAPCLASS_MapScriptContinent",
			},
		];
		const entry = assignMap("A", "B", pool, prior, createRng("seed"));
		expect(entry.id).toBe("donut");
		expect(entry.script).toBe("MAPCLASS_MapScriptDonut");
	});

	it("prefers a script unused this round over one already used", () => {
		// No prior history, so both scripts are eligible. Continent is already
		// used this round → Donut (unused) must be chosen.
		const used = new Set(["Continent"]);
		const pool: MapPoolEntry[] = [
			{ id: "Continent", script: "Continent", options: {} },
			{ id: "Donut", script: "Donut", options: {} },
		];
		const entry = assignMap("A", "B", pool, [], createRng("seed"), used);
		expect(entry.script).toBe("Donut");
	});

	it("repeats a script this round when the only alternative is a player repeat", () => {
		// A has played Donut, so Donut is ineligible (primary). Continent is the
		// only eligible script even though it's already used this round — primary
		// anti-repeat beats round diversity.
		const used = new Set(["Continent"]);
		const pool: MapPoolEntry[] = [
			{ id: "Continent", script: "Continent", options: {} },
			{ id: "Donut", script: "Donut", options: {} },
		];
		const prior = [m("m1", "A", "X", "Donut")];
		const entry = assignMap("A", "B", pool, prior, createRng("seed"), used);
		expect(entry.script).toBe("Continent");
	});

	it("on a forced script repeat, prefers an unplayed options-variant", () => {
		// The Test 03 case: pool has two Bay instances + one AridPlateau. A has
		// played bay-tiny, B has played Arid — so every script is burned and a
		// repeat is forced. Both scripts have combined count 1; the pick must
		// still be Bay (Arid would repeat B too), but the *other* Bay instance
		// (bay-small), not the exact bay-tiny A already played.
		const pool: MapPoolEntry[] = [
			{ id: "arid", script: "MAPCLASS_MapScriptAridPlateau", options: {} },
			{
				id: "bay-tiny",
				script: "MAPCLASS_MapScriptBay",
				options: { MAPSIZE: "MAPSIZE_TINY" },
			},
			{
				id: "bay-small",
				script: "MAPCLASS_MapScriptBay",
				options: { MAPSIZE: "MAPSIZE_SMALLEST" },
			},
		];
		const prior: MatchRef[] = [
			{ ...m("m1", "A", "X", "bay-tiny"), map_script: "MAPCLASS_MapScriptBay" },
			{
				...m("m2", "B", "Y", "arid"),
				map_script: "MAPCLASS_MapScriptAridPlateau",
			},
		];
		const entry = assignMap("A", "B", pool, prior, createRng("seed"));
		expect(entry.id).toBe("bay-small");
	});

	it("throws on empty pool", () => {
		expect(() => assignMap("A", "B", [], [], createRng("s"))).toThrow();
	});
});

describe("assignMapsToPairings", () => {
	it("assigns null map to byes", () => {
		const assigned = assignMapsToPairings(
			[
				{ slot_a_id: "A", slot_b_id: "B" },
				{ slot_a_id: "C", slot_b_id: null },
			],
			POOL,
			[],
			"seed",
		);
		expect(assigned[0].map_pool_id).not.toBeNull();
		expect(assigned[0].map_script).not.toBeNull();
		expect(assigned[1].map_pool_id).toBeNull();
		expect(assigned[1].map_script).toBeNull();
	});

	it("is deterministic for the same seed", () => {
		const a = assignMapsToPairings(
			[{ slot_a_id: "A", slot_b_id: "B" }],
			POOL,
			[],
			"seed-1",
		);
		const b = assignMapsToPairings(
			[{ slot_a_id: "A", slot_b_id: "B" }],
			POOL,
			[],
			"seed-1",
		);
		expect(a[0].map_pool_id).toBe(b[0].map_pool_id);
	});

	it("spreads distinct scripts across matches in a round", () => {
		// Four matches, empty history, four distinct scripts available → each
		// match should get a different script (best-effort round diversity).
		const assigned = assignMapsToPairings(
			[
				{ slot_a_id: "A", slot_b_id: "B" },
				{ slot_a_id: "C", slot_b_id: "D" },
				{ slot_a_id: "E", slot_b_id: "F" },
				{ slot_a_id: "G", slot_b_id: "H" },
			],
			POOL,
			[],
			"seed",
		);
		const scripts = assigned.map((a) => a.map_script);
		expect(new Set(scripts).size).toBe(4);
	});

	it("different seeds produce different picks across runs", () => {
		// Not a strict guarantee on a single match, but across enough trials
		// it should diverge. Run 20 different seeds and verify at least 2
		// different instances were chosen.
		const picks = new Set<string>();
		for (let i = 0; i < 20; i++) {
			const a = assignMapsToPairings(
				[{ slot_a_id: "A", slot_b_id: "B" }],
				POOL,
				[],
				`seed-${i}`,
			);
			picks.add(a[0].map_pool_id!);
		}
		expect(picks.size).toBeGreaterThan(1);
	});
});
