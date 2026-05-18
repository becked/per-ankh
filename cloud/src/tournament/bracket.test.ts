import { describe, expect, it } from "vitest";
import {
	buildChampionshipFollowupRound,
	buildChampionshipRound1,
	largestPowerOfTwoAtLeast,
	standardBracketPairs,
} from "./bracket";

describe("largestPowerOfTwoAtLeast", () => {
	it.each([
		[1, 1],
		[2, 2],
		[3, 4],
		[4, 4],
		[5, 8],
		[7, 8],
		[8, 8],
		[9, 16],
		[15, 16],
		[16, 16],
		[17, 32],
		[31, 32],
		[32, 32],
	])("largestPowerOfTwoAtLeast(%i) = %i", (n, expected) => {
		expect(largestPowerOfTwoAtLeast(n)).toBe(expected);
	});

	it("returns 1 for inputs below 1", () => {
		expect(largestPowerOfTwoAtLeast(0)).toBe(1);
		expect(largestPowerOfTwoAtLeast(-5)).toBe(1);
	});
});

describe("standardBracketPairs", () => {
	it("size 2: single (1,2)", () => {
		expect(standardBracketPairs(2)).toEqual([[1, 2]]);
	});

	it("size 4: (1,4) (2,3)", () => {
		expect(standardBracketPairs(4)).toEqual([
			[1, 4],
			[2, 3],
		]);
	});

	it("size 8: standard 1-vs-N order, adjacent R1 matches feed same R2", () => {
		expect(standardBracketPairs(8)).toEqual([
			[1, 8],
			[4, 5],
			[2, 7],
			[3, 6],
		]);
	});

	it("size 16: nested 1-vs-N", () => {
		const pairs = standardBracketPairs(16);
		expect(pairs).toEqual([
			[1, 16],
			[8, 9],
			[4, 13],
			[5, 12],
			[2, 15],
			[7, 10],
			[3, 14],
			[6, 11],
		]);
	});

	it("rejects non-power-of-2", () => {
		expect(() => standardBracketPairs(3)).toThrow();
		expect(() => standardBracketPairs(6)).toThrow();
		expect(() => standardBracketPairs(1)).toThrow();
	});
});

describe("buildChampionshipRound1", () => {
	it("exactly 2 qualifiers: 2-bracket, no byes", () => {
		const r1 = buildChampionshipRound1(2);
		expect(r1.bracket_size).toBe(2);
		expect(r1.bye_count).toBe(0);
		expect(r1.matches).toEqual([
			{ match_index: 1, seed_a: 1, seed_b: 2, is_bye: false },
		]);
	});

	it("4 qualifiers: 4-bracket, no byes, standard order", () => {
		const r1 = buildChampionshipRound1(4);
		expect(r1.bracket_size).toBe(4);
		expect(r1.bye_count).toBe(0);
		expect(r1.matches).toEqual([
			{ match_index: 1, seed_a: 1, seed_b: 4, is_bye: false },
			{ match_index: 2, seed_a: 2, seed_b: 3, is_bye: false },
		]);
	});

	it("6 qualifiers: 8-bracket with 2 byes for top seeds", () => {
		const r1 = buildChampionshipRound1(6);
		expect(r1.bracket_size).toBe(8);
		expect(r1.bye_count).toBe(2);
		// Standard 8-bracket pairings: (1,8), (4,5), (2,7), (3,6).
		// Phantom seeds 7 and 8 → matches with seed_b > 6 are byes.
		// Seeds 1 (vs phantom 8) and 2 (vs phantom 7) get byes.
		expect(r1.matches).toEqual([
			{ match_index: 1, seed_a: 1, seed_b: 8, is_bye: true },
			{ match_index: 2, seed_a: 4, seed_b: 5, is_bye: false },
			{ match_index: 3, seed_a: 2, seed_b: 7, is_bye: true },
			{ match_index: 4, seed_a: 3, seed_b: 6, is_bye: false },
		]);
	});

	it("8 qualifiers: 8-bracket, no byes", () => {
		const r1 = buildChampionshipRound1(8);
		expect(r1.bracket_size).toBe(8);
		expect(r1.bye_count).toBe(0);
		expect(r1.matches.every((m) => !m.is_bye)).toBe(true);
	});

	it("9 qualifiers: 16-bracket with 7 byes", () => {
		const r1 = buildChampionshipRound1(9);
		expect(r1.bracket_size).toBe(16);
		expect(r1.bye_count).toBe(7);
		// Seed 1 should get a bye (paired with phantom 16).
		const seed1Match = r1.matches.find((m) => m.seed_a === 1)!;
		expect(seed1Match.is_bye).toBe(true);
		expect(seed1Match.seed_b).toBe(16);
		// Seed 9 (real) should play seed 8 (real); not a bye.
		const seed8Match = r1.matches.find((m) => m.seed_a === 8)!;
		expect(seed8Match.is_bye).toBe(false);
		expect(seed8Match.seed_b).toBe(9);
	});

	it("rejects qualifier counts below 2", () => {
		expect(() => buildChampionshipRound1(0)).toThrow();
		expect(() => buildChampionshipRound1(1)).toThrow();
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

	it("R2 of a 6-qualifier (8-bracket) tournament pairs correctly", () => {
		// R1 has 4 matches: (1,bye), (4,5), (2,bye), (3,6).
		// R2 should pair winners of matches 1&2 and matches 3&4.
		// Match 1 winner = seed 1; match 2 winner = seed 4 or 5;
		// match 3 winner = seed 2; match 4 winner = seed 3 or 6.
		// So R2 finals: (seed 1) vs (4 or 5), and (seed 2) vs (3 or 6).
		// Templates only need to map structurally — the handler reads
		// winner_slot_id from the prior round at advance time.
		const templates = buildChampionshipFollowupRound(4);
		expect(templates).toEqual([
			{ match_index: 1, source_match_a_index: 1, source_match_b_index: 2 },
			{ match_index: 2, source_match_a_index: 3, source_match_b_index: 4 },
		]);
	});

	it("collapses correctly across rounds", () => {
		// 16 → 8 → 4 → 2 → 1
		expect(buildChampionshipFollowupRound(16)).toHaveLength(8);
		expect(buildChampionshipFollowupRound(8)).toHaveLength(4);
		expect(buildChampionshipFollowupRound(4)).toHaveLength(2);
		expect(buildChampionshipFollowupRound(2)).toHaveLength(1);
	});
});
