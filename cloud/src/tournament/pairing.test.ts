import { describe, expect, it } from "vitest";
import { pairSwissRound } from "./pairing";
import type { MatchRef, SlotRef, TournamentConfig } from "./types";

const CONFIG: TournamentConfig = {
	swiss_wins_to_advance: 3,
	swiss_losses_to_eliminate: 3,
	swiss_max_rounds: 5,
};

function slot(id: string, seed: number): SlotRef {
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
		map_pool_id: null,
		map_script: null,
		status,
		winner_slot_id: winner,
	};
}

function unorderedPair(a: string, b: string | null): string {
	if (b === null) return `${a}|BYE`;
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

describe("pairSwissRound — round 1", () => {
	it("pairs all slots when count is even", () => {
		const slots = ["A", "B", "C", "D"].map((id, i) => slot(id, i + 1));
		const pairings = pairSwissRound(slots, [], 1, CONFIG, "s1");
		expect(pairings).toHaveLength(2);
		const allSlots = new Set<string>();
		for (const p of pairings) {
			allSlots.add(p.slot_a_id);
			if (p.slot_b_id) allSlots.add(p.slot_b_id);
		}
		expect(allSlots.size).toBe(4);
	});

	it("assigns a bye when count is odd", () => {
		const slots = ["A", "B", "C"].map((id, i) => slot(id, i + 1));
		const pairings = pairSwissRound(slots, [], 1, CONFIG, "s1");
		const byes = pairings.filter((p) => p.slot_b_id === null);
		expect(byes).toHaveLength(1);
		expect(pairings).toHaveLength(2);
	});

	it("is deterministic for the same seed", () => {
		const slots = ["A", "B", "C", "D"].map((id, i) => slot(id, i + 1));
		const a = pairSwissRound(slots, [], 1, CONFIG, "seed");
		const b = pairSwissRound(slots, [], 1, CONFIG, "seed");
		expect(a).toEqual(b);
	});
});

describe("pairSwissRound — round 2+", () => {
	it("buckets by W-L and pairs within bucket", () => {
		// 4 slots: A and B won round 1, C and D lost.
		const slots = ["A", "B", "C", "D"].map((id, i) => slot(id, i + 1));
		const r1 = [match("m1", 1, "A", "C", "A"), match("m2", 1, "B", "D", "B")];
		const pairings = pairSwissRound(slots, r1, 2, CONFIG, "s2");
		expect(pairings).toHaveLength(2);
		// Winners should be paired with winners, losers with losers.
		const pairKeys = pairings.map((p) =>
			unorderedPair(p.slot_a_id, p.slot_b_id),
		);
		expect(pairKeys).toContain(unorderedPair("A", "B"));
		expect(pairKeys).toContain(unorderedPair("C", "D"));
	});

	it("avoids a forced rematch via in-bucket swap when both replacement pairings are fresh", () => {
		// 8 slots play 2 rounds engineered so the (1-1) bucket in round 3
		// contains A, B, C, D — with both default-pair candidates (A-C from
		// round 1, B-D from round 1) being prior matches. The swap branch
		// at pairing.ts:170-189 should produce A-D and B-C instead.
		//
		// E, F reach 2-0 and are advanced (excluded from round-3 pairing).
		// P, Q reach 0-2 and are eliminated (also excluded).
		const allSlots = [
			slot("A", 1),
			slot("B", 2),
			slot("C", 3),
			slot("D", 4),
			slot("E", 5),
			slot("F", 6),
			slot("P", 7),
			slot("Q", 8),
		];
		const shortConfig: TournamentConfig = {
			swiss_wins_to_advance: 2,
			swiss_losses_to_eliminate: 2,
			swiss_max_rounds: 4,
		};
		const prior: MatchRef[] = [
			// Round 1: A beats C, B beats D — the rematches we'll avoid later.
			match("r1m1", 1, "A", "C", "A"),
			match("r1m2", 1, "B", "D", "B"),
			match("r1m3", 1, "E", "P", "E"),
			match("r1m4", 1, "F", "Q", "F"),
			// Round 2: E beats A, F beats B (drops A/B to 1-1 alongside C/D);
			// C beats P, D beats Q (lifts C/D to 1-1).
			match("r2m1", 2, "E", "A", "E"),
			match("r2m2", 2, "F", "B", "F"),
			match("r2m3", 2, "C", "P", "C"),
			match("r2m4", 2, "D", "Q", "D"),
		];

		const pairings = pairSwissRound(
			allSlots,
			prior,
			3,
			shortConfig,
			"rematch-swap",
		);

		// 4 active slots → 2 pairings. (E/F advanced, P/Q eliminated.)
		expect(pairings).toHaveLength(2);
		const pairKeys = pairings.map((p) =>
			unorderedPair(p.slot_a_id, p.slot_b_id),
		);
		// Default seed-based pairing would produce A-C and B-D; both are
		// prior matches. The swap branch should pick A-D and B-C instead.
		expect(pairKeys).not.toContain(unorderedPair("A", "C"));
		expect(pairKeys).not.toContain(unorderedPair("B", "D"));
		expect(pairKeys).toContain(unorderedPair("A", "D"));
		expect(pairKeys).toContain(unorderedPair("B", "C"));
	});

	it("gives a bye to lowest-ranked slot with no prior bye", () => {
		// 5 active slots. Lowest seed = E. E has had no bye → E gets bye.
		const slots = ["A", "B", "C", "D", "E"].map((id, i) => slot(id, i + 1));
		const priorMatches = [
			match("m1", 1, "A", "B", "A"),
			match("m2", 1, "C", "D", "C"),
			match("m3", 1, "E", null, "E", "bye"),
			// Add round 2 results so E is "active" (not eliminated)
			match("m4", 2, "A", "C", "A"),
			match("m5", 2, "B", "D", "B"),
			match("m6", 2, "E", null, "E", "bye"),
		];
		// Now in round 3: active set still A, B, C, D, E (none at 3W or 3L).
		// E already had byes — should prefer someone else if anyone hasn't.
		// All of A,B,C,D have played each round. None had bye. E had byes.
		// Lowest-ranked without bye = D (seed 4). D should get the bye.
		const pairings = pairSwissRound(slots, priorMatches, 3, CONFIG, "s3");
		const byes = pairings.filter((p) => p.slot_b_id === null);
		expect(byes).toHaveLength(1);
		expect(byes[0].slot_a_id).toBe("D");
	});

	it("excludes advanced and eliminated slots from pairing", () => {
		// A has 3 wins → advanced. B has 3 losses → eliminated. C, D still active.
		const slots = ["A", "B", "C", "D"].map((id, i) => slot(id, i + 1));
		const prior = [
			match("m1", 1, "A", "B", "A"),
			match("m2", 2, "A", "B", "A"),
			match("m3", 3, "A", "B", "A"),
			match("m4", 1, "C", "D", "C"),
		];
		// A=3-0 advanced; B=0-3 eliminated; C=1-0; D=0-1.
		const pairings = pairSwissRound(slots, prior, 4, CONFIG, "s4");
		// Only C and D should be paired.
		expect(pairings).toHaveLength(1);
		const ids = new Set<string>([
			pairings[0].slot_a_id,
			pairings[0].slot_b_id!,
		]);
		expect(ids).toEqual(new Set(["C", "D"]));
	});

	it("handles bucket spillover (odd bucket floats to next)", () => {
		// 6 slots, after round 1: A,B,C win (1-0), D,E,F lose (0-1).
		// Round 2 bucketing: (1,0)=[A,B,C], (0,1)=[D,E,F].
		// Both buckets odd-sized; algorithm should float A,B,C lowest into D,E,F.
		const slots = ["A", "B", "C", "D", "E", "F"].map((id, i) =>
			slot(id, i + 1),
		);
		const prior = [
			match("m1", 1, "A", "D", "A"),
			match("m2", 1, "B", "E", "B"),
			match("m3", 1, "C", "F", "C"),
		];
		const pairings = pairSwissRound(slots, prior, 2, CONFIG, "s5");
		// Should produce 3 pairings, all slots covered, no byes.
		expect(pairings).toHaveLength(3);
		const allIds = new Set<string>();
		for (const p of pairings) {
			allIds.add(p.slot_a_id);
			if (p.slot_b_id) allIds.add(p.slot_b_id);
		}
		expect(allIds.size).toBe(6);
		// No byes (count was even).
		expect(pairings.filter((p) => p.slot_b_id === null)).toHaveLength(0);
	});
});
