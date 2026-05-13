import { describe, expect, it } from "vitest";
import {
	advanceCountSuggestion,
	buildChampionshipFollowupRound,
	buildChampionshipRound1,
	buildChampionshipSeeds,
	largestPowerOfTwoAtMost,
} from "./bracket";

describe("largestPowerOfTwoAtMost", () => {
	it("returns 0 for inputs below 1", () => {
		expect(largestPowerOfTwoAtMost(0)).toBe(0);
		expect(largestPowerOfTwoAtMost(-5)).toBe(0);
	});

	it.each([
		[1, 1],
		[2, 2],
		[3, 2],
		[4, 4],
		[7, 4],
		[8, 8],
		[15, 8],
		[16, 16],
		[31, 16],
		[32, 32],
	])("largestPowerOfTwoAtMost(%i) = %i", (n, expected) => {
		expect(largestPowerOfTwoAtMost(n)).toBe(expected);
	});
});

describe("advanceCountSuggestion", () => {
	it.each([
		// User-specified targets:
		[22, 22, 8], // 44 players → top 8 each
		[33, 33, 16], // 66 players → top 16 each
		// Other boundaries:
		[6, 6, 2], // 12 players → top 2 each
		[8, 8, 4],
		[14, 14, 4], // floor(14/2)=7, largest pow2 ≤ 7 = 4
		[63, 63, 16], // floor(63/2)=31, largest pow2 ≤ 31 = 16
		[64, 64, 32],
		// Asymmetric divisions take min:
		[22, 33, 8],
		[6, 22, 2], // min=6 → 2 advance each → 4-player championship
	])("advanceCountSuggestion(divA=%i, divB=%i) = %i", (a, b, expected) => {
		expect(advanceCountSuggestion(a, b)).toBe(expected);
	});
});

describe("buildChampionshipSeeds", () => {
	it("cross-pairs A_rank_i with B_rank_(N-i+1) at adjacent seeds", () => {
		const seeds = buildChampionshipSeeds(4, 4, 4);
		// Expected:
		// seed 1: A rank 1
		// seed 2: B rank 4
		// seed 3: A rank 2
		// seed 4: B rank 3
		// seed 5: A rank 3
		// seed 6: B rank 2
		// seed 7: A rank 4
		// seed 8: B rank 1
		expect(seeds).toEqual([
			{ championship_seed: 1, source_division: "A", source_rank: 1 },
			{ championship_seed: 2, source_division: "B", source_rank: 4 },
			{ championship_seed: 3, source_division: "A", source_rank: 2 },
			{ championship_seed: 4, source_division: "B", source_rank: 3 },
			{ championship_seed: 5, source_division: "A", source_rank: 3 },
			{ championship_seed: 6, source_division: "B", source_rank: 2 },
			{ championship_seed: 7, source_division: "A", source_rank: 4 },
			{ championship_seed: 8, source_division: "B", source_rank: 1 },
		]);
	});

	it("throws when advancer counts don't match advanceCount", () => {
		expect(() => buildChampionshipSeeds(4, 3, 4)).toThrow();
		expect(() => buildChampionshipSeeds(4, 4, 3)).toThrow();
	});

	it("works for N=2, 8, 16", () => {
		expect(buildChampionshipSeeds(2, 2, 2)).toHaveLength(4);
		expect(buildChampionshipSeeds(8, 8, 8)).toHaveLength(16);
		expect(buildChampionshipSeeds(16, 16, 16)).toHaveLength(32);
	});
});

describe("buildChampionshipRound1", () => {
	it("pairs adjacent seeds", () => {
		const matches = buildChampionshipRound1(8);
		expect(matches).toEqual([
			{ match_index: 1, seed_a: 1, seed_b: 2 },
			{ match_index: 2, seed_a: 3, seed_b: 4 },
			{ match_index: 3, seed_a: 5, seed_b: 6 },
			{ match_index: 4, seed_a: 7, seed_b: 8 },
		]);
	});

	it("throws on odd seat count", () => {
		expect(() => buildChampionshipRound1(5)).toThrow();
	});
});

describe("buildChampionshipFollowupRound", () => {
	it("templates winner-of-(2i-1) vs winner-of-(2i)", () => {
		const templates = buildChampionshipFollowupRound(8);
		expect(templates).toEqual([
			{ match_index: 1, source_match_a_index: 1, source_match_b_index: 2 },
			{ match_index: 2, source_match_a_index: 3, source_match_b_index: 4 },
			{ match_index: 3, source_match_a_index: 5, source_match_b_index: 6 },
			{ match_index: 4, source_match_a_index: 7, source_match_b_index: 8 },
		]);
	});

	it("collapses correctly across rounds", () => {
		// 16 → 8 → 4 → 2 → 1 (5 rounds total including round 1)
		const r2 = buildChampionshipFollowupRound(16);
		expect(r2).toHaveLength(8);
		const r3 = buildChampionshipFollowupRound(8);
		expect(r3).toHaveLength(4);
		const r4 = buildChampionshipFollowupRound(4);
		expect(r4).toHaveLength(2);
		const final = buildChampionshipFollowupRound(2);
		expect(final).toHaveLength(1);
	});
});
