// Which families players keep, against how often keeping one would happen by
// itself.
//
// A nation has a fixed pool of families and a player fields exactly three per
// game, so a four-family nation leaves one out of every game it ever plays.
// Which one is a decision made before the first turn, and no other statistic
// here captures it: a win rate by family says how games went *with* a family,
// never how often it was refused.
//
// Two things make the obvious query wrong, and both are easy to miss.
//
// The denominator is not the nation's games, it is the games where the family
// was **eligible** — every player-game whose nation's pool contained the class.
// A class in six nations' pools is being asked about in all six.
//
// And the null is not zero. Fielding three of four means 75% is exactly what
// indifference produces, so a 70% keep rate is a family being *refused*, not
// one being liked. Worse, pools differ in size — Maurya's six give 50% — so the
// baseline has to be accumulated per game rather than applied as one percentage
// at the end. Skipping that makes every Maurya class look shunned.
//
// Counted as keeps rather than cuts. It is the same quantity from the other
// side (kept = eligible - cut, and the two baselines sum to 100), so the
// arithmetic still checks against a spec written in cuts — but a page about
// what players field reads better than one about what they refuse, and the
// interesting rows end up at the top rather than the bottom.
//
// Everything here describes choices, not outcomes, so nothing is rating
// adjusted: the null is the pool's chance level, not what a rating expected.

import { NATION_FAMILY_POOLS } from "../generated/family-pools";

// A nation whose pool is this size or smaller fields all of it every game. It
// carries exactly zero information about preference, and left in it parks a
// permanent 0%-cut row at the top of the table.
const FORCED_POOL_MAX = 3;

// How many families a player fields per game. Not a tendency — a rule — and the
// rows that disagree are the ones this file refuses to guess about.
const FIELDED_PER_GAME = 3;

// Ten classes tested at once. Uncorrected, that throws a false "shunned family"
// about 40% of the time, so the table would be decorative.
const FDR_Q = 0.05;

export interface FamilyKeepRow {
	family_class: string;
	// Player-games where this class was in the nation's pool.
	eligible: number;
	kept: number;
	kept_pct: number;
	// What indifference alone would have produced, accumulated per game: three
	// of a four-family pool is 75%, three of Maurya's six is 50%.
	baseline_pct: number;
	// Above zero is kept more often than chance, below is a family refused.
	delta: number;
	z: number;
	// Survives Benjamini-Hochberg at q=0.05 across the classes in this table.
	significant: boolean;
}

export interface FamilyKeepTable {
	rows: FamilyKeepRow[];
	// Player-games the table is built from.
	player_games: number;
	// And the ones it isn't, surfaced rather than quietly dropped. A roster that
	// doesn't hold exactly three families cannot say what was chosen at setup:
	// a captured seat drops its family out of the end-of-game roster, and a
	// conquest can add one. Those are skipped rather than reconstructed —
	// mapping a family's name back to a class across games would repair them,
	// but that mapping is not stable across game versions (a patch swapped a
	// nation's two families between Clerics and Riders), so the repair
	// mislabels.
	skipped_incomplete: number;
	// Nations that field their whole pool every game (see FORCED_POOL_MAX).
	skipped_forced_pool: number;
	// A nation with no baked pool, or a roster naming a class outside it —
	// a stale pool table, which mislabels rather than merely missing.
	skipped_unknown_pool: number;
}

// The overall table plus the same thing per nation, because a reader wants to
// ask "and what about Rome?".
//
// Each nation carries its own false-discovery gate rather than a slice of the
// overall one: the gate belongs to the set of classes actually on trial, and
// looking at one nation is four tests, not ten.
export interface FamilyKeeps {
	overall: FamilyKeepTable;
	byNation: Array<{ nation: string } & FamilyKeepTable>;
}

/** One player's families in one game, as stored on player_summaries. */
export interface FamilyKeepInput {
	nation: string | null;
	// The `family_classes` JSON column, already parsed.
	family_classes: readonly string[] | null;
}

// Complementary error function — Numerical Recipes' erfcc, fractional error
// below 1.2e-7, which is far inside what a p-value used only for a
// Benjamini-Hochberg cutoff needs. There is no Math.erfc.
function erfc(x: number): number {
	const z = Math.abs(x);
	const t = 2 / (2 + z);
	const y = 4 * t - 2;
	const coeffs = [
		-1.3026537197817094, 0.6419697923564902, 0.019476473204185836,
		-0.00956151478680863, -0.000946595344482036, 0.000366839497852761,
		4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6,
		1.30365583558e-6, 1.5626441722e-8, -8.5238095915e-8, 6.529054439e-9,
		5.059343495e-9, -9.91364156e-10, -2.27365122e-10, 9.6467911e-11,
		2.394038e-12, -6.886027e-12, 8.94487e-13, 3.13092e-13, -1.12708e-13,
		3.81e-16, 7.106e-15,
	];
	let d = 0;
	let dd = 0;
	for (let j = coeffs.length - 1; j > 0; j--) {
		const tmp = d;
		d = y * d - dd + coeffs[j];
		dd = tmp;
	}
	const ans = t * Math.exp(-z * z + 0.5 * (coeffs[0] + y * d) - dd);
	return x >= 0 ? ans : 2 - ans;
}

/**
 * Build the cut table over a set of player-games.
 *
 * Caller decides the population — one tournament's games, or one player's — and
 * the arithmetic is identical either way, because the baseline is per game.
 * That is what lets a player who favours unusual nations still be read against
 * chance.
 */
export function buildFamilyKeepTable(
	inputs: readonly FamilyKeepInput[],
): FamilyKeepTable {
	interface Record {
		pool: readonly string[];
		fielded: Set<string>;
	}
	const records: Record[] = [];
	let skippedIncomplete = 0;
	let skippedForced = 0;
	let skippedUnknown = 0;

	for (const input of inputs) {
		const pool = input.nation ? NATION_FAMILY_POOLS[input.nation] : undefined;
		if (!pool) {
			skippedUnknown += 1;
			continue;
		}
		if (pool.length <= FORCED_POOL_MAX) {
			skippedForced += 1;
			continue;
		}
		const fielded = new Set(input.family_classes ?? []);
		if (fielded.size !== FIELDED_PER_GAME) {
			skippedIncomplete += 1;
			continue;
		}
		// A class outside the pool means the baked table is stale for this
		// nation. Mislabelling is worse than missing, so the row goes.
		if ([...fielded].some((f) => !pool.includes(f))) {
			skippedUnknown += 1;
			continue;
		}
		records.push({ pool, fielded });
	}

	const classes = [...new Set(records.flatMap((r) => [...r.pool]))].sort();

	const rows = classes.map((family) => {
		const eligible = records.filter((r) => r.pool.includes(family));
		const kept = eligible.filter((r) => r.fielded.has(family)).length;

		// Poisson-binomial: every game brings its own probability, because pools
		// differ in size. A binomial test with one pooled p would be measuring a
		// population that doesn't exist.
		let expected = 0;
		let variance = 0;
		for (const r of eligible) {
			const pKeep = FIELDED_PER_GAME / r.pool.length;
			expected += pKeep;
			variance += pKeep * (1 - pKeep);
		}

		const n = eligible.length;
		const z = variance > 0 ? (kept - expected) / Math.sqrt(variance) : 0;
		return {
			family_class: family,
			eligible: n,
			kept,
			kept_pct: n > 0 ? (100 * kept) / n : 0,
			baseline_pct: n > 0 ? (100 * expected) / n : 0,
			delta: n > 0 ? (100 * kept) / n - (100 * expected) / n : 0,
			z,
			p: variance > 0 ? erfc(Math.abs(z) / Math.SQRT2) : 1,
			significant: false,
		};
	});

	// Benjamini-Hochberg: sort by p, find the largest rank whose p is within
	// q·rank/m, and everything up to it survives.
	const byP = [...rows].sort((a, b) => a.p - b.p);
	let cutoff = -1;
	byP.forEach((row, i) => {
		if (row.p <= (FDR_Q * (i + 1)) / byP.length) cutoff = i;
	});
	byP.slice(0, cutoff + 1).forEach((row) => {
		row.significant = true;
	});

	return {
		// Most-kept first: the families a field actually fights over lead.
		rows: rows
			.sort((a, b) => b.kept_pct - a.kept_pct)
			.map(({ p: _p, ...row }) => row),
		player_games: records.length,
		skipped_incomplete: skippedIncomplete,
		skipped_forced_pool: skippedForced,
		skipped_unknown_pool: skippedUnknown,
	};
}

/**
 * The overall table and one per nation, from the same player-games.
 *
 * A nation with no usable player-games is left out rather than listed empty —
 * the selector should only offer nations there is something to show for.
 */
export function buildFamilyKeeps(
	inputs: readonly FamilyKeepInput[],
): FamilyKeeps {
	const byNation = new Map<string, FamilyKeepInput[]>();
	for (const input of inputs) {
		if (!input.nation) continue;
		const list = byNation.get(input.nation);
		if (list) list.push(input);
		else byNation.set(input.nation, [input]);
	}

	return {
		overall: buildFamilyKeepTable(inputs),
		byNation: [...byNation.entries()]
			.map(([nation, rows]) => ({ nation, ...buildFamilyKeepTable(rows) }))
			.filter((n) => n.rows.length > 0)
			.sort((a, b) => b.player_games - a.player_games),
	};
}
