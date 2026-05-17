import { describe, expect, it } from "vitest";
import { assignMap, assignMapsToPairings } from "./maps";
import { createRng } from "./rng";
import type { MatchRef } from "./types";

function m(
	id: string,
	a: string,
	b: string | null,
	map: string | null,
): MatchRef {
	return {
		match_id: id,
		round_id: "r",
		round_number: 1,
		phase: "swiss",
		division: "A",
		slot_a_id: a,
		slot_b_id: b,
		map_script: map,
		status: "complete",
		winner_slot_id: a,
	};
}

const ALLOWED = ["Continent", "CoastalRainBasin", "AridPlateau", "Donut"];

describe("assignMap", () => {
	it("picks an unplayed map when one exists for both slots", () => {
		const prior = [m("m1", "A", "X", "Continent")];
		const map = assignMap("A", "B", ALLOWED, prior, createRng("seed"));
		expect(ALLOWED).toContain(map);
		expect(map).not.toBe("Continent");
	});

	it("when all maps played, falls back to min combined-play count", () => {
		// A has played Continent twice, CoastalRainBasin once, AridPlateau once, Donut zero.
		// B has played Donut twice, Continent once, AridPlateau zero, CoastalRainBasin zero.
		// Combined: Continent 3, CoastalRainBasin 1, AridPlateau 1, Donut 2.
		// Min: CoastalRainBasin and AridPlateau (both 1). Alpha tiebreak → AridPlateau.
		const prior: MatchRef[] = [
			m("a1", "A", "X1", "Continent"),
			m("a2", "A", "X2", "Continent"),
			m("a3", "A", "X3", "CoastalRainBasin"),
			m("a4", "A", "X4", "AridPlateau"),
			m("b1", "B", "Y1", "Donut"),
			m("b2", "B", "Y2", "Donut"),
			m("b3", "B", "Y3", "Continent"),
		];
		const map = assignMap("A", "B", ALLOWED, prior, createRng("seed"));
		expect(map).toBe("AridPlateau");
	});

	it("throws on empty allowed list", () => {
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
			ALLOWED,
			[],
			"seed",
		);
		expect(assigned[0].map_script).not.toBeNull();
		expect(assigned[1].map_script).toBeNull();
	});

	it("is deterministic for the same seed", () => {
		const a = assignMapsToPairings(
			[{ slot_a_id: "A", slot_b_id: "B" }],
			ALLOWED,
			[],
			"seed-1",
		);
		const b = assignMapsToPairings(
			[{ slot_a_id: "A", slot_b_id: "B" }],
			ALLOWED,
			[],
			"seed-1",
		);
		expect(a[0].map_script).toBe(b[0].map_script);
	});

	it("different seeds produce different picks across runs", () => {
		// Not a strict guarantee on a single match, but across enough trials
		// it should diverge. Run 20 different seeds and verify at least 2
		// different maps were chosen.
		const picks = new Set<string>();
		for (let i = 0; i < 20; i++) {
			const a = assignMapsToPairings(
				[{ slot_a_id: "A", slot_b_id: "B" }],
				ALLOWED,
				[],
				`seed-${i}`,
			);
			picks.add(a[0].map_script!);
		}
		expect(picks.size).toBeGreaterThan(1);
	});
});
