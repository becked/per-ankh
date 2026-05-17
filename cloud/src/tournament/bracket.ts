// Championship bracket construction.
//
// Inputs: ranked advancer list per division (top-N from each, where N is
// the tournament's swiss_advance_count). Output: cross-paired round-1
// matches with championship_seed assignments.
//
// Seeding scheme: championship_seed 1 = A_rank_1, seed 2 = B_rank_N,
// seed 3 = A_rank_2, seed 4 = B_rank_{N-1}, ... Round-1 matches pair
// adjacent seeds (1 vs 2, 3 vs 4, ...), making round 1 entirely
// cross-division. Subsequent rounds use standard winner-progression:
// winner of match 2i-1 faces winner of match 2i.
//
// Also exports advanceCountSuggestion for the start-swiss handler. The
// formula picks the largest power-of-2 ≤ floor(min(div_a, div_b) / 2) so
// the championship bracket is always a clean power of 2 (no byes needed
// at the championship phase).

export function largestPowerOfTwoAtMost(n: number): number {
	if (n < 1) return 0;
	let p = 1;
	while (p * 2 <= n) p *= 2;
	return p;
}

export function advanceCountSuggestion(
	divACount: number,
	divBCount: number,
): number {
	const minDiv = Math.min(divACount, divBCount);
	return largestPowerOfTwoAtMost(Math.floor(minDiv / 2));
}

export interface ChampionshipSeed {
	championship_seed: number; // 1-based
	source_division: "A" | "B";
	source_rank: number; // 1-based rank within the division
}

export interface ChampionshipMatchTemplate {
	match_index: number; // 1-based within round
	seed_a: number;
	seed_b: number;
}

export function buildChampionshipSeeds(
	advanceCount: number,
	divARanked: number, // count of advancers from div A (should equal advanceCount)
	divBRanked: number,
): ChampionshipSeed[] {
	if (divARanked !== advanceCount || divBRanked !== advanceCount) {
		throw new Error(
			`Expected ${advanceCount} advancers from each division; got A=${divARanked}, B=${divBRanked}`,
		);
	}
	const seeds: ChampionshipSeed[] = [];
	for (let i = 0; i < advanceCount; i++) {
		seeds.push({
			championship_seed: 2 * i + 1,
			source_division: "A",
			source_rank: i + 1,
		});
		seeds.push({
			championship_seed: 2 * i + 2,
			source_division: "B",
			source_rank: advanceCount - i,
		});
	}
	return seeds;
}

// Round 1 of the championship: pair adjacent seeds (1-2, 3-4, ...).
export function buildChampionshipRound1(
	totalSeats: number,
): ChampionshipMatchTemplate[] {
	if (totalSeats % 2 !== 0) {
		throw new Error(
			`Championship requires an even seat count; got ${totalSeats}`,
		);
	}
	const matches: ChampionshipMatchTemplate[] = [];
	for (let i = 0; i < totalSeats / 2; i++) {
		matches.push({
			match_index: i + 1,
			seed_a: 2 * i + 1,
			seed_b: 2 * i + 2,
		});
	}
	return matches;
}

// Subsequent rounds: winner of match 2i-1 faces winner of match 2i. We don't
// know the actual winner seeds at generation time — this is a structural
// template the handler fills in when it has slot IDs from the prior round's
// reported matches.
export interface ChampionshipFollowupTemplate {
	match_index: number; // 1-based within the new round
	source_match_a_index: number; // prior round match whose winner becomes slot_a
	source_match_b_index: number;
}

export function buildChampionshipFollowupRound(
	priorRoundMatchCount: number,
): ChampionshipFollowupTemplate[] {
	if (priorRoundMatchCount % 2 !== 0) {
		throw new Error(
			`Prior round must have an even number of matches; got ${priorRoundMatchCount}`,
		);
	}
	const matches: ChampionshipFollowupTemplate[] = [];
	for (let i = 0; i < priorRoundMatchCount / 2; i++) {
		matches.push({
			match_index: i + 1,
			source_match_a_index: 2 * i + 1,
			source_match_b_index: 2 * i + 2,
		});
	}
	return matches;
}
