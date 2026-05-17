import { describe, expect, it } from "vitest";
import {
	compareStandings,
	computeRecord,
	computeStandings,
	rankStandings,
	type SlotStanding,
} from "./standings";
import type { MatchRef, SlotRef, TournamentConfig } from "./types";

const CONFIG: TournamentConfig = {
	swiss_wins_to_advance: 3,
	swiss_losses_to_eliminate: 3,
	swiss_max_rounds: 5,
};

function slot(id: string, seed = 0): SlotRef {
	return {
		slot_id: id,
		phase: "swiss",
		division: "A",
		swiss_seed: seed,
		championship_seed: null,
	};
}

function match(
	id: string,
	round: number,
	a: string,
	b: string | null,
	winner: string | null,
	status: MatchRef["status"] = "complete",
): MatchRef {
	return {
		match_id: id,
		round_id: `r${round}`,
		round_number: round,
		phase: "swiss",
		division: "A",
		slot_a_id: a,
		slot_b_id: b,
		map_script: "M1",
		status,
		winner_slot_id: winner,
	};
}

describe("computeRecord", () => {
	it("tallies wins and losses, ignoring pending", () => {
		const matches = [
			match("m1", 1, "A", "B", "A"),
			match("m2", 2, "A", "C", "A"),
			match("m3", 3, "A", "D", "D"),
			match("m4", 4, "A", "E", null, "pending"),
		];
		const rec = computeRecord("A", matches, CONFIG);
		expect(rec.wins).toBe(2);
		expect(rec.losses).toBe(1);
		expect(rec.status).toBe("active");
	});

	it("flips to advanced at 3 wins", () => {
		const matches = [
			match("m1", 1, "A", "B", "A"),
			match("m2", 2, "A", "C", "A"),
			match("m3", 3, "A", "D", "A"),
		];
		expect(computeRecord("A", matches, CONFIG).status).toBe("advanced");
	});

	it("flips to eliminated at 3 losses", () => {
		const matches = [
			match("m1", 1, "A", "B", "B"),
			match("m2", 2, "A", "C", "C"),
			match("m3", 3, "A", "D", "D"),
		];
		expect(computeRecord("A", matches, CONFIG).status).toBe("eliminated");
	});

	it("counts a bye match as a win for the receiver", () => {
		const matches = [match("m1", 1, "A", null, "A", "bye")];
		expect(computeRecord("A", matches, CONFIG).wins).toBe(1);
	});

	it("counts a forfeit win for the winner", () => {
		const matches = [match("m1", 1, "A", "B", "A", "forfeit")];
		expect(computeRecord("A", matches, CONFIG).wins).toBe(1);
		expect(computeRecord("B", matches, CONFIG).losses).toBe(1);
	});
});

describe("computeStandings (Buchholz)", () => {
	it("byes do not enter opponents' Buchholz pool", () => {
		// A had a bye in round 1; in rounds 2-3 played B (2W) and C (1W).
		// Solkoff for A = 2 + 1 = 3 (bye contributes nothing).
		const slots = [slot("A"), slot("B"), slot("C"), slot("D")];
		const matches = [
			match("m1", 1, "A", null, "A", "bye"),
			match("m2", 1, "B", "C", "B"),
			match("m3", 2, "A", "B", "A"),
			match("m4", 2, "C", "D", "C"),
			match("m5", 3, "A", "C", "A"),
			match("m6", 3, "B", "D", "B"),
		];
		const standings = computeStandings(slots, matches, CONFIG);
		const aStanding = standings.find((s) => s.slot_id === "A")!;
		// A played B (2W) and C (1W); bye doesn't count.
		expect(aStanding.solkoff).toBe(3);
	});

	it("forfeits DO count as opponent encounters", () => {
		const slots = [slot("A"), slot("B"), slot("C")];
		const matches = [
			// A forfeits to B
			match("m1", 1, "A", "B", "B", "forfeit"),
			match("m2", 2, "B", "C", "B"),
			match("m3", 2, "A", "C", "A"),
		];
		const standings = computeStandings(slots, matches, CONFIG);
		const cStanding = standings.find((s) => s.slot_id === "C")!;
		// C played B (2W) and A (1W); forfeiter is still in opponent pool.
		expect(cStanding.solkoff).toBe(3);
	});

	it("Median-Buchholz drops highest and lowest opponent scores", () => {
		// Slot X played 4 opponents with wins [3, 2, 1, 0].
		// MB drops 3 and 0 → 2 + 1 = 3. Solkoff = 6.
		const slots = ["X", "A", "B", "C", "D"].map((id) => slot(id));
		const matches: MatchRef[] = [
			match("m1", 1, "X", "A", "X"),
			match("m2", 2, "X", "B", "X"),
			match("m3", 3, "X", "C", "X"),
			match("m4", 4, "X", "D", "X"),
			// give A 3 wins, B 2, C 1, D 0 by faking matches against filler
			match("m5", 1, "A", "Y1", "A"),
			match("m6", 2, "A", "Y2", "A"),
			match("m7", 3, "A", "Y3", "A"),
			match("m8", 1, "B", "Z1", "B"),
			match("m9", 2, "B", "Z2", "B"),
			match("m10", 1, "C", "W1", "C"),
		];
		// Add the filler slots so they're in the universe
		const allSlots = [
			...slots,
			...["Y1", "Y2", "Y3", "Z1", "Z2", "W1"].map((id) => slot(id)),
		];
		const standings = computeStandings(allSlots, matches, CONFIG);
		const xStanding = standings.find((s) => s.slot_id === "X")!;
		expect(xStanding.solkoff).toBe(3 + 2 + 1 + 0);
		expect(xStanding.median_buchholz).toBe(2 + 1);
	});
});

describe("rankStandings", () => {
	it("ranks by wins, then MB, then Solkoff", () => {
		const a: SlotStanding = {
			slot_id: "A",
			wins: 3,
			losses: 0,
			status: "advanced",
			median_buchholz: 5,
			solkoff: 6,
		};
		const b: SlotStanding = { ...a, slot_id: "B", median_buchholz: 4 };
		const c: SlotStanding = { ...a, slot_id: "C", wins: 2, losses: 1 };
		const ranked = rankStandings([c, b, a]);
		expect(ranked.map((r) => r.slot_id)).toEqual(["A", "B", "C"]);
		expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
		expect(ranked.every((r) => r.tied_with.length === 0)).toBe(true);
	});

	it("marks ties when cascade returns 0", () => {
		const a: SlotStanding = {
			slot_id: "A",
			wins: 3,
			losses: 0,
			status: "advanced",
			median_buchholz: 5,
			solkoff: 6,
		};
		const b: SlotStanding = { ...a, slot_id: "B" };
		const ranked = rankStandings([a, b]);
		expect(ranked[0].rank).toBe(1);
		expect(ranked[1].rank).toBe(1);
		expect(ranked[0].tied_with).toEqual(["B"]);
		expect(ranked[1].tied_with).toEqual(["A"]);
	});
});

describe("compareStandings cascade", () => {
	it("equal MB but different Solkoff still resolves", () => {
		const a: SlotStanding = {
			slot_id: "A",
			wins: 3,
			losses: 0,
			status: "advanced",
			median_buchholz: 4,
			solkoff: 6,
		};
		const b: SlotStanding = { ...a, slot_id: "B", solkoff: 5 };
		expect(compareStandings(a, b)).toBeLessThan(0); // a ranks first
	});
});
