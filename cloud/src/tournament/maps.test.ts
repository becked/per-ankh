import { describe, expect, it } from "vitest";
import { assignMap, assignMapsToPairings } from "./maps";
import { createRng } from "./rng";
import type { MapPoolEntry, MatchRef } from "./types";

// `poolId` is the map_pool instance the match was played on — anti-repeat
// counts by instance id, so that's what matters here.
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
const POOL: MapPoolEntry[] = [
	{ id: "Continent", script: "MAPCLASS_MapScriptContinent", options: {} },
	{
		id: "CoastalRainBasin",
		script: "MAPCLASS_MapScriptCoastalRainBasin",
		options: {},
	},
	{ id: "AridPlateau", script: "MAPCLASS_MapScriptAridPlateau", options: {} },
	{ id: "Donut", script: "MAPCLASS_MapScriptDonut", options: {} },
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

	it("treats two instances of the same script as distinct", () => {
		// Two Continent instances at different sizes. A has played the first;
		// the second is still unplayed, so it must be chosen.
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
		];
		const prior = [m("m1", "A", "X", "cont-duel")];
		const entry = assignMap("A", "B", pool, prior, createRng("seed"));
		expect(entry.id).toBe("cont-tiny");
		expect(entry.script).toBe("MAPCLASS_MapScriptContinent");
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
