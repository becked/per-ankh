// Comparative-standing shifts: the game classifies one player's stat against
// another's through InfoHelpers.getBestPercentValue — percent = ours × 100 /
// theirs (integer division), bucketed by an XML tier table whose entry
// without a threshold is the catch-all (InfoPercentBase defaults miPercent to
// int.MaxValue). Two consumers share this: the Techs rail's knowledge
// standing (cumulative science, knowledge.xml) and the Military rail's power
// standing (military power, power.xml).

export type StandingTier = {
	readonly type: string;
	readonly percent: number | null;
};

export type StandingShift = {
	turn: number;
	from: string; // tier zType the player was
	to: string; // tier zType they became
	// The player's value as a percent of the opponent's that turn — the
	// exact quantity the game buckets.
	pct: number;
};

// The game's bucketing: the tier with the smallest threshold ≥ pct wins; no
// threshold is the catch-all.
function standingTier(pct: number, tiers: readonly StandingTier[]): string {
	let best = tiers[tiers.length - 1].type;
	let min = Infinity;
	for (const t of tiers) {
		const p = t.percent ?? Infinity;
		if (p >= pct && p <= min) {
			min = p;
			best = t.type;
		}
	}
	return best;
}

/**
 * Turns where the player's standing vs the opponent shifted tier. Runs
 * shorter than `minRun` are folded into their predecessor — sitting exactly
 * on a threshold flip-flops the raw classification every turn (and the
 * blob's ÷10 rounding adds jitter), and a burst of chips at one boundary
 * says nothing a single shift doesn't. The final run always stands, so the
 * last shift agrees with the end state. No marker for the initial
 * classification — only changes.
 */
export function standingShiftMarkers(
	mine: { turn: number; value: number }[],
	theirs: { turn: number; value: number }[],
	tiers: readonly StandingTier[],
	minRun: number,
): StandingShift[] {
	const other = new Map<number, number>();
	for (const d of theirs) other.set(d.turn, d.value);
	const perTurn: { turn: number; tier: string; pct: number }[] = [];
	for (const d of mine) {
		const opp = other.get(d.turn);
		if (opp == null || opp <= 0) continue;
		const pct = Math.trunc((d.value * 100) / opp);
		perTurn.push({ turn: d.turn, tier: standingTier(pct, tiers), pct });
	}
	// Group into runs, then fold sub-minimum runs into their predecessor.
	type Run = { tier: string; first: (typeof perTurn)[number]; length: number };
	const runs: Run[] = [];
	for (const p of perTurn) {
		const last = runs[runs.length - 1];
		if (last && last.tier === p.tier) last.length++;
		else runs.push({ tier: p.tier, first: p, length: 1 });
	}
	const kept: Run[] = [];
	for (let i = 0; i < runs.length; i++) {
		const isLast = i === runs.length - 1;
		if (!isLast && runs[i].length < minRun && kept.length > 0) continue;
		const prev = kept[kept.length - 1];
		if (prev && prev.tier === runs[i].tier) continue;
		kept.push(runs[i]);
	}
	return kept.slice(1).map((r, i) => ({
		turn: r.first.turn,
		from: kept[i].tier,
		to: r.tier,
		pct: r.first.pct,
	}));
}

/**
 * Chip label for a shift: each side's tier shorthand joined with an arrow —
 * "MW→W". The caller supplies the shorthand rule; it must be unambiguous
 * within its tier set (power's Similar/Stronger both initial to "S", so that
 * set can't just use initials).
 */
export function standingShiftLabel(
	from: string,
	to: string,
	abbrevOf: (tier: string) => string,
): string {
	return `${abbrevOf(from)}→${abbrevOf(to)}`;
}
