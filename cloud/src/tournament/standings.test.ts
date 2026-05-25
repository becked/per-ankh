import { describe, expect, it } from "vitest";
import {
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

// Hand-built SlotStanding for tests that exercise rankStandings directly
// (the ranker is a pure function of standings + matches). status is derived
// from CONFIG thresholds so callers only supply the record + tiebreaker fields.
function standing(
	id: string,
	wins: number,
	losses: number,
	extra: Partial<SlotStanding> = {},
): SlotStanding {
	return {
		slot_id: id,
		wins,
		losses,
		status:
			wins >= CONFIG.swiss_wins_to_advance
				? "advanced"
				: losses >= CONFIG.swiss_losses_to_eliminate
					? "eliminated"
					: "active",
		buchholz_cut1: 0,
		opponents_buchholz: 0,
		cumulative: 0,
		swiss_seed: 0,
		...extra,
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
		map_pool_id: "M1",
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

describe("computeStandings — Buchholz cut-1 and Cumulative", () => {
	it("byes do not enter opponents' Buchholz pool", () => {
		// A had a bye in round 1; in rounds 2-3 played B (2W) and C (1W).
		// Buchholz cut-1 for A: opponent wins [1, 2] → drop 1 → 2.
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
		expect(aStanding.buchholz_cut1).toBe(2);
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
		// C played B (2W) and A (1W); Buchholz cut-1 drops 1 → 2.
		expect(cStanding.buchholz_cut1).toBe(2);
	});

	it("Buchholz cut-1 drops the single lowest opponent score", () => {
		// Slot X played 4 opponents with wins [3, 2, 1, 0].
		// Buchholz cut-1 drops 0 → 3 + 2 + 1 = 6.
		const slots = ["X", "A", "B", "C", "D"].map((id) => slot(id));
		const matches: MatchRef[] = [
			match("m1", 1, "X", "A", "X"),
			match("m2", 2, "X", "B", "X"),
			match("m3", 3, "X", "C", "X"),
			match("m4", 4, "X", "D", "X"),
			// Give A 3 wins, B 2, C 1, D 0 by faking matches against filler.
			match("m5", 1, "A", "Y1", "A"),
			match("m6", 2, "A", "Y2", "A"),
			match("m7", 3, "A", "Y3", "A"),
			match("m8", 1, "B", "Z1", "B"),
			match("m9", 2, "B", "Z2", "B"),
			match("m10", 1, "C", "W1", "C"),
		];
		const allSlots = [
			...slots,
			...["Y1", "Y2", "Y3", "Z1", "Z2", "W1"].map((id) => slot(id)),
		];
		const standings = computeStandings(allSlots, matches, CONFIG);
		const xStanding = standings.find((s) => s.slot_id === "X")!;
		expect(xStanding.buchholz_cut1).toBe(6);
	});

	it("Cumulative rewards early dominance", () => {
		// A goes W-W-W (clinches R3); cumulative = 1+2+3 + 3+3 = 12 (carries
		// to maxRounds=5).
		// B goes L-L-W-W-W (3-2, clinches R5); cumulative = 0+0+1+2+3 = 6.
		const slots = [slot("A"), slot("B"), slot("C")];
		const matches = [
			match("m1", 1, "A", "C", "A"),
			match("m2", 2, "A", "C", "A"),
			match("m3", 3, "A", "C", "A"),
			match("m4", 1, "B", "C", "C"),
			match("m5", 2, "B", "C", "C"),
			match("m6", 3, "B", "C", "B"),
			match("m7", 4, "B", "C", "B"),
			match("m8", 5, "B", "C", "B"),
		];
		const standings = computeStandings(slots, matches, CONFIG);
		const a = standings.find((s) => s.slot_id === "A")!;
		const b = standings.find((s) => s.slot_id === "B")!;
		expect(a.cumulative).toBe(1 + 2 + 3 + 3 + 3); // 12
		expect(b.cumulative).toBe(0 + 0 + 1 + 2 + 3); // 6
	});

	it("opponents' Buchholz sums each opponent's Buchholz cut-1", () => {
		// 4-player single round robin. Final wins: A=3, B=2, C=1, D=0.
		// Buchholz cut-1: A=3, B=4, C=5, D=5.
		// Opponents' Buchholz (sum of opponents' cut-1):
		//   A (opps B,C,D) = 4+5+5 = 14
		//   B (opps A,C,D) = 3+5+5 = 13
		//   C (opps A,B,D) = 3+4+5 = 12
		//   D (opps A,B,C) = 3+4+5 = 12
		const slots = [slot("A"), slot("B"), slot("C"), slot("D")];
		const matches = [
			match("r1a", 1, "A", "B", "A"),
			match("r1b", 1, "C", "D", "C"),
			match("r2a", 2, "A", "C", "A"),
			match("r2b", 2, "B", "D", "B"),
			match("r3a", 3, "A", "D", "A"),
			match("r3b", 3, "B", "C", "B"),
		];
		const standings = computeStandings(slots, matches, CONFIG);
		const get = (id: string) => standings.find((s) => s.slot_id === id)!;
		expect(get("A").buchholz_cut1).toBe(3);
		expect(get("B").buchholz_cut1).toBe(4);
		expect(get("C").buchholz_cut1).toBe(5);
		expect(get("D").buchholz_cut1).toBe(5);
		expect(get("A").opponents_buchholz).toBe(14);
		expect(get("B").opponents_buchholz).toBe(13);
		expect(get("C").opponents_buchholz).toBe(12);
		expect(get("D").opponents_buchholz).toBe(12);
	});
});

describe("rankStandings — full cascade", () => {
	it("ranks by wins, with no ties", () => {
		const slots = [slot("A"), slot("B"), slot("C")];
		const matches = [
			match("m1", 1, "A", "B", "A"),
			match("m2", 2, "A", "C", "A"),
			match("m3", 3, "A", "B", "A"),
			match("m4", 1, "C", "B", "B"),
		];
		const standings = computeStandings(slots, matches, CONFIG);
		const ranked = rankStandings(standings, matches);
		expect(ranked[0].slot_id).toBe("A");
		expect(ranked[0].rank).toBe(1);
	});

	it("Sion Div A: losses-asc seeds the 3-0 first, ahead of stronger-H2H 3-1/3-2", () => {
		// Recreate Sion's Div A from May 2026:
		//   12thumbs: 3-0; eyebeams: 3-1 (R1 bye); brain1: 3-2; thingobongo: 2-3; anxiety: 1-3
		// Under the OLD wins-desc Tier 1 the three 3-W players tied and H2H
		// seeded eyebeams (H2H 2) above 12thumbs (the actual 3-0). Under
		// losses-asc Tier 1 they separate by losses with no tie: the 3-0 seeds
		// first, then the 3-1, then the 3-2 — H2H never fires (all singletons).
		const slots = [
			slot("12thumbs"),
			slot("eyebeams"),
			slot("brain1"),
			slot("thingobongo"),
			slot("anxiety"),
		];
		const matches: MatchRef[] = [
			match("a1", 1, "eyebeams", null, "eyebeams", "bye"),
			match("a2", 1, "brain1", "thingobongo", "brain1"),
			match("a3", 1, "anxiety", "12thumbs", "12thumbs"),
			match("a4", 2, "anxiety", null, "anxiety", "bye"),
			match("a5", 2, "12thumbs", "thingobongo", "12thumbs"),
			match("a6", 2, "brain1", "eyebeams", "eyebeams"),
			match("a7", 3, "thingobongo", null, "thingobongo", "bye"),
			match("a8", 3, "eyebeams", "12thumbs", "12thumbs"),
			match("a9", 3, "brain1", "anxiety", "brain1"),
			match("a10", 4, "brain1", "eyebeams", "eyebeams"),
			match("a11", 4, "thingobongo", "anxiety", "thingobongo"),
			match("a12", 5, "brain1", "thingobongo", "brain1"),
		];
		const standings = computeStandings(slots, matches, CONFIG);
		const ranked = rankStandings(standings, matches);
		// Strict losses-asc order, no ties:
		expect(ranked.map((r) => r.slot_id)).toEqual([
			"12thumbs", // 3-0
			"eyebeams", // 3-1
			"brain1", // 3-2
			"thingobongo", // 2-3
			"anxiety", // 1-3
		]);
		expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
		// All three 3-W players still "advanced" — Tier 1 only reorders seeds.
		expect(ranked[0].status).toBe("advanced");
		expect(ranked[1].status).toBe("advanced");
		expect(ranked[2].status).toBe("advanced");
	});

	it("Sion Div B: losses-asc seeds the 3-1 above the stronger-Buchholz 3-2", () => {
		// Recreate Sion's Div B from May 2026:
		//   brian: 3-0 (R1 bye); twobits: 3-1; cerebelum: 3-2; hippocampus: 2-3; brain2: 1-3
		// Under the OLD wins-desc Tier 1, cerebelum (3-2, Buchholz 8) seeded
		// ABOVE twobits (3-1, Buchholz 7). Under losses-asc Tier 1 the 3-1
		// outranks the 3-2 outright, regardless of Buchholz — the intended fix.
		const slots = [
			slot("brian"),
			slot("twobits"),
			slot("cerebelum"),
			slot("hippocampus"),
			slot("brain2"),
		];
		const matches: MatchRef[] = [
			match("b1", 1, "brian", null, "brian", "bye"),
			match("b2", 1, "hippocampus", "twobits", "twobits"),
			match("b3", 1, "cerebelum", "brain2", "cerebelum"),
			match("b4", 2, "hippocampus", null, "hippocampus", "bye"),
			match("b5", 2, "twobits", "brain2", "twobits"),
			match("b6", 2, "brian", "cerebelum", "brian"),
			match("b7", 3, "brain2", null, "brain2", "bye"),
			match("b8", 3, "brian", "twobits", "brian"),
			match("b9", 3, "hippocampus", "cerebelum", "hippocampus"),
			match("b10", 4, "hippocampus", "twobits", "twobits"),
			match("b11", 4, "brain2", "cerebelum", "cerebelum"),
			match("b12", 5, "hippocampus", "cerebelum", "cerebelum"),
		];
		const standings = computeStandings(slots, matches, CONFIG);
		const ranked = rankStandings(standings, matches);
		// Strict losses-asc order, no ties:
		expect(ranked.map((r) => r.slot_id)).toEqual([
			"brian", // 3-0
			"twobits", // 3-1
			"cerebelum", // 3-2
			"hippocampus", // 2-3
			"brain2", // 1-3
		]);
		// twobits now seeds above cerebelum despite cerebelum's higher Buchholz.
		expect(ranked[1].slot_id).toBe("twobits");
		expect(ranked[1].buchholz_cut1).toBe(7);
		expect(ranked[2].slot_id).toBe("cerebelum");
		expect(ranked[2].buchholz_cut1).toBe(8);
	});

	it("marks ties when every tier returns equal", () => {
		// Two players with identical records who didn't play each other:
		// wins=3, no H2H signal, identical Buchholz, identical cumulative.
		const slots = [slot("A"), slot("B"), slot("C"), slot("D")];
		const matches: MatchRef[] = [
			// A and B each go 3-0 against perfectly symmetric weaker opponents.
			match("m1", 1, "A", "C", "A"),
			match("m2", 2, "A", "C", "A"),
			match("m3", 3, "A", "C", "A"),
			match("m4", 1, "B", "D", "B"),
			match("m5", 2, "B", "D", "B"),
			match("m6", 3, "B", "D", "B"),
		];
		const standings = computeStandings(slots, matches, CONFIG);
		const ranked = rankStandings(standings, matches);
		// A and B both at rank 1, tied with each other.
		const a = ranked.find((r) => r.slot_id === "A")!;
		const b = ranked.find((r) => r.slot_id === "B")!;
		expect(a.rank).toBe(1);
		expect(b.rank).toBe(1);
		expect(a.tied_with).toEqual(["B"]);
		expect(b.tied_with).toEqual(["A"]);
	});

	it("H2H only fires within a tied set, never across win counts", () => {
		// A: 3-0 vs C (C goes 0-3). B: 2-1 vs C plus an unrelated W and L.
		// A and B aren't tied at the wins tier, so H2H is irrelevant —
		// A ranks higher purely by match wins.
		const slots = [slot("A"), slot("B"), slot("C")];
		const matches = [
			match("m1", 1, "A", "C", "A"),
			match("m2", 2, "A", "B", "B"),
			match("m3", 3, "A", "B", "A"),
			match("m4", 4, "A", null, "A", "bye"),
		];
		const standings = computeStandings(slots, matches, CONFIG);
		const ranked = rankStandings(standings, matches);
		// A has more wins than B; A's H2H against B is irrelevant.
		expect(ranked[0].slot_id).toBe("A");
		expect(ranked[0].wins).toBeGreaterThan(ranked[1].wins);
	});

	it("within a losses bucket, H2H then Buchholz still break ties", () => {
		// P, Q, R all finish 2-1 (one losses bucket). Within {P,Q,R}:
		//   P beat Q, Q beat R, P vs R didn't play → H2H: P=1, Q=1, R=0.
		// R drops to the bottom on H2H; P/Q (both H2H 1) split on Buchholz:
		//   Q opps P(2),R(2),C(0) → cut-1 = 4; P opps Q(2),A(1),B(0) → cut-1 = 3.
		// So within the bucket: Q > P > R.
		const slots = ["P", "Q", "R", "A", "B", "C"].map((id) => slot(id));
		const matches = [
			match("w1", 1, "P", "Q", "P"),
			match("w2", 2, "P", "A", "A"),
			match("w3", 2, "Q", "R", "Q"),
			match("w4", 3, "P", "B", "P"),
			match("w5", 3, "R", "A", "R"),
			match("w6", 4, "Q", "C", "Q"),
			match("w7", 4, "R", "B", "R"),
		];
		const standings = computeStandings(slots, matches, CONFIG);
		const ranked = rankStandings(standings, matches);
		expect(ranked.slice(0, 3).map((r) => r.slot_id)).toEqual(["Q", "P", "R"]);
		expect(ranked[0].h2h).toBe(1);
		expect(ranked[0].buchholz_cut1).toBe(4);
		expect(ranked[1].h2h).toBe(1);
		expect(ranked[1].buchholz_cut1).toBe(3);
		expect(ranked[2].h2h).toBe(0);
	});

	it("Tier 4: opponents' Buchholz breaks a Buchholz tie before cumulative", () => {
		// Both 3-0, equal Buchholz and cumulative; differ only on opponents'
		// Buchholz. swiss_seed favors "low" (1 < 2), so a win for "high" proves
		// Tier 4 fires ahead of the Tier 6 seed fallback.
		const standings = [
			standing("low", 3, 0, {
				buchholz_cut1: 6,
				opponents_buchholz: 10,
				cumulative: 12,
				swiss_seed: 1,
			}),
			standing("high", 3, 0, {
				buchholz_cut1: 6,
				opponents_buchholz: 14,
				cumulative: 12,
				swiss_seed: 2,
			}),
		];
		const ranked = rankStandings(standings, []);
		expect(ranked[0].slot_id).toBe("high");
		expect(ranked[1].slot_id).toBe("low");
		expect(ranked[0].rank).toBe(1);
		expect(ranked[1].rank).toBe(2);
	});

	it("Tier 6: fully-tied players seed by swiss_seed yet still report the tie", () => {
		// Identical through Tier 5; only swiss_seed differs. Input order is
		// scrambled (b before a) to prove the deterministic sort.
		const standings = [
			standing("b", 3, 0, {
				buchholz_cut1: 6,
				opponents_buchholz: 12,
				cumulative: 12,
				swiss_seed: 5,
			}),
			standing("a", 3, 0, {
				buchholz_cut1: 6,
				opponents_buchholz: 12,
				cumulative: 12,
				swiss_seed: 2,
			}),
		];
		const ranked = rankStandings(standings, []);
		// Emission (bracket-seed) order is swiss_seed asc: a (2) before b (5).
		expect(ranked.map((r) => r.slot_id)).toEqual(["a", "b"]);
		// But they remain a reported tie on the meaningful tiers.
		expect(ranked[0].rank).toBe(1);
		expect(ranked[1].rank).toBe(1);
		expect(ranked[0].tied_with).toEqual(["b"]);
		expect(ranked[1].tied_with).toEqual(["a"]);
	});
});
