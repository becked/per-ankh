import { describe, expect, it } from "vitest";
import { computeRecord, computeStandings, rankStandings } from "./standings";
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

	it("Sion regression: Division A 3-way tie resolved by H2H", () => {
		// Recreate Sion's Div A from May 2026:
		//   12thumbs: 3-0; eyebeams: 3-1 (R1 bye); brain1: 3-2; thingobongo: 2-3; anxiety: 1-3
		// H2H within the 3-way tie {12thumbs, eyebeams, brain1}:
		//   eyebeams beat brain1 twice (R2 + R4)
		//   12thumbs beat eyebeams (R3)
		//   brain1 and 12thumbs didn't play
		// H2H sum-of-points: eyebeams=2, 12thumbs=1, brain1=0.
		// Order: eyebeams > 12thumbs > brain1 (brain1 cut by H2H, NOT by Buchholz).
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
		// Top 3 by H2H within the 3-win tie:
		expect(ranked[0].slot_id).toBe("eyebeams");
		expect(ranked[0].h2h).toBe(2);
		expect(ranked[1].slot_id).toBe("12thumbs");
		expect(ranked[1].h2h).toBe(1);
		expect(ranked[2].slot_id).toBe("brain1");
		expect(ranked[2].h2h).toBe(0);
		// All three 3-W players are "advanced" — no cut.
		expect(ranked[0].status).toBe("advanced");
		expect(ranked[1].status).toBe("advanced");
		expect(ranked[2].status).toBe("advanced");
	});

	it("Sion regression: Division B 3-way tie resolved by H2H then Buchholz", () => {
		// Recreate Sion's Div B from May 2026:
		//   brian: 3-0 (R1 bye); twobits: 3-1; cerebelum: 3-2; hippocampus: 2-3; brain2: 1-3
		// H2H: brian beat cerebelum (R2) and twobits (R3); cerebelum vs twobits didn't play.
		// H2H sum: brian=2, cerebelum=0, twobits=0 → brian wins outright.
		// Cerebelum/twobits then break tie at Buchholz cut-1:
		//   cerebelum opps: brain2(1), brian(3), hippocampus(2), brain2(1), hippocampus(2) → cut1 = 8
		//   twobits opps: hippocampus(2), brain2(1), brian(3), hippocampus(2) → cut1 = 7
		// So cerebelum (8) > twobits (7).
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
		expect(ranked[0].slot_id).toBe("brian");
		expect(ranked[0].h2h).toBe(2);
		expect(ranked[1].slot_id).toBe("cerebelum");
		expect(ranked[1].buchholz_cut1).toBe(8);
		expect(ranked[2].slot_id).toBe("twobits");
		expect(ranked[2].buchholz_cut1).toBe(7);
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
});
