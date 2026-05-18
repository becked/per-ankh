// Championship bracket construction.
//
// Input: a flat list of qualifier slot IDs in ranked order (seed 1 first).
// Output: a list of round-1 matches, with byes for non-power-of-2 counts.
//
// Bracket size = next power of 2 ≥ qualifierCount. Phantom seeds
// (qualifierCount+1..bracketSize) cause their R1 opponent to receive a
// bye (status='bye', winner_slot_id=slot_a_id at insert time).
//
// Seeding follows standard 1-vs-N tournament order: (1, N), (2, N-1), ...
// arranged so adjacent R1 matches feed into the same R2 match. This means
// the top seed gets the lowest real opponent in R1 (often a bye), and the
// top two seeds can only meet in the final.
//
// `buildChampionshipFollowupRound` is unchanged: R2+ pair adjacent winners
// (winner of match 2i-1 faces winner of match 2i). That works for any R1
// pairing order, including standard 1-vs-N.

export function largestPowerOfTwoAtLeast(n: number): number {
	if (n < 1) return 1;
	let p = 1;
	while (p < n) p *= 2;
	return p;
}

export interface ChampionshipMatchTemplate {
	match_index: number; // 1-based within round
	seed_a: number;
	seed_b: number;
	is_bye: boolean; // seed_b is a phantom; seed_a auto-advances
}

export interface ChampionshipRound1 {
	bracket_size: number;
	bye_count: number;
	matches: ChampionshipMatchTemplate[];
}

// Build standard tournament seed pairings for a power-of-2 bracket.
// For N=2: [(1, 2)].
// For N=4: [(1, 4), (2, 3)] — top seed meets bottom seed; second meets third.
// For N=8: [(1, 8), (4, 5), (2, 7), (3, 6)] — top half then bottom half.
// Recurrence: for each pair (a, b) at size N/2, emit (a, N+1-a), (b, N+1-b)
// at size N. Yields the order where adjacent R1 matches feed into the same
// R2 match.
export function standardBracketPairs(n: number): Array<[number, number]> {
	if (n < 2 || (n & (n - 1)) !== 0) {
		throw new Error(`Bracket size must be a power of 2 ≥ 2; got ${n}`);
	}
	if (n === 2) return [[1, 2]];
	const half = standardBracketPairs(n / 2);
	const result: Array<[number, number]> = [];
	for (const [a, b] of half) {
		result.push([a, n + 1 - a]);
		result.push([b, n + 1 - b]);
	}
	return result;
}

export function buildChampionshipRound1(
	qualifierCount: number,
): ChampionshipRound1 {
	if (qualifierCount < 2) {
		throw new Error(
			`Championship requires at least 2 qualifiers; got ${qualifierCount}`,
		);
	}
	const bracket_size = largestPowerOfTwoAtLeast(qualifierCount);
	const pairs = standardBracketPairs(bracket_size);
	const matches: ChampionshipMatchTemplate[] = pairs.map(([a, b], i) => ({
		match_index: i + 1,
		seed_a: a,
		seed_b: b,
		// seed_b > qualifierCount means seed_b is a phantom → bye for seed_a.
		// (In standardBracketPairs the larger seed is always the second of each
		// pair, so checking seed_b is sufficient.)
		is_bye: b > qualifierCount,
	}));
	const bye_count = matches.filter((m) => m.is_bye).length;
	return { bracket_size, bye_count, matches };
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
