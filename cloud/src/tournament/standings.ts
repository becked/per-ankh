// W/L tallying, tiebreaker scoring, and the bracket-seeding cascade.
//
// All standings are derived from tournament_matches on read — there is no
// stored swiss_wins/swiss_losses column on tournament_slots. That keeps
// retro-edits a pure UPDATE and removes the class of bugs where derived
// state drifts from the underlying matches.
//
// Cascade for bracket seeding:
//   1. Match wins (descending)
//   2. Head-to-head — sum of wins against other still-tied players
//   3. Buchholz cut-1 — sum of opponents' wins, lowest dropped
//   4. Cumulative — sum of running win count across rounds (Harkness)
//
// Tiebreakers only seed the bracket — qualification is purely "did you
// reach `swiss_wins_to_advance` wins." A 3-0 player never gets cut by
// the cascade; they may just receive a different bracket seed than a
// 3-2 player with stronger Buchholz.
//
// Bye / forfeit notes:
//   * Byes (slot_b_id IS NULL) award the bye-receiver +1 win but do NOT
//     enter anyone's opponent list. Standard Swiss treatment. The bye-
//     recipient ends up with fewer opponents counted in Buchholz, which
//     is a known under-counting. We deliberately don't add a "virtual
//     opponent" correction: stakes are seeding-only now, complexity isn't
//     justified.
//   * Forfeits (status='forfeit') award +1 win to the non-forfeiting slot
//     and DO count as opponent encounters. If the forfeiter drops out
//     entirely, the opponent's Buchholz is permanently deflated by the
//     forfeiter's frozen win count. Acceptable — standard Swiss behavior.

import type { MatchRef, SlotRef, SwissStatus, TournamentConfig } from "./types";

export interface SlotRecord {
	slot_id: string;
	wins: number;
	losses: number;
	status: SwissStatus;
}

export interface SlotStanding extends SlotRecord {
	buchholz_cut1: number;
	cumulative: number;
}

export function computeRecord(
	slotId: string,
	matches: MatchRef[],
	config: TournamentConfig,
): SlotRecord {
	let wins = 0;
	let losses = 0;
	for (const m of matches) {
		const isParticipant = m.slot_a_id === slotId || m.slot_b_id === slotId;
		if (!isParticipant) continue;
		if (m.status === "pending") continue;
		if (m.winner_slot_id === slotId) {
			wins++;
		} else if (m.winner_slot_id !== null) {
			losses++;
		}
	}
	let status: SwissStatus = "active";
	if (wins >= config.swiss_wins_to_advance) status = "advanced";
	else if (losses >= config.swiss_losses_to_eliminate) status = "eliminated";
	return { slot_id: slotId, wins, losses, status };
}

// Collect the set of opponent slot IDs a given slot has played, excluding
// byes. Used by Buchholz computation.
function collectOpponents(slotId: string, matches: MatchRef[]): string[] {
	const opponents: string[] = [];
	for (const m of matches) {
		if (m.status === "pending" || m.status === "bye") continue;
		if (m.slot_b_id === null) continue;
		if (m.slot_a_id === slotId) opponents.push(m.slot_b_id);
		else if (m.slot_b_id === slotId) opponents.push(m.slot_a_id);
	}
	return opponents;
}

// Buchholz cut-1: sort opponent wins ascending, drop the single lowest,
// sum the rest. For ≤1 opponent, no trim (return the full sum).
function computeBuchholzCut1(opponentWins: number[]): number {
	if (opponentWins.length <= 1) {
		return opponentWins.reduce((a, b) => a + b, 0);
	}
	const sorted = [...opponentWins].sort((a, b) => a - b);
	return sorted.slice(1).reduce((a, b) => a + b, 0);
}

// Cumulative (Harkness): for each round the slot has any match (won, lost,
// forfeit, or bye), take the slot's running W count *after* that round, and
// sum across rounds. Pending matches contribute nothing. Rounds where the
// slot didn't play (clinched-and-resting or eliminated) contribute the W
// count frozen at its last-played value — implemented by carrying the
// running W across max_rounds even when no match exists.
//
// Why count past-clinch rounds: a player who hit 3-0 in R3 should outscore
// a player who hit 3-0 in R5 on this tier. Carrying their 3-W through R4-R5
// captures that.
function computeCumulative(
	slotId: string,
	matches: MatchRef[],
	maxRounds: number,
): number {
	// Collect the slot's matches, indexed by round_number.
	const byRound = new Map<number, MatchRef>();
	for (const m of matches) {
		if (m.slot_a_id !== slotId && m.slot_b_id !== slotId) continue;
		byRound.set(m.round_number, m);
	}
	let runningWins = 0;
	let total = 0;
	for (let r = 1; r <= maxRounds; r++) {
		const m = byRound.get(r);
		if (m && m.status !== "pending") {
			// Bye counts as +1; otherwise check winner.
			if (m.status === "bye") {
				if (m.slot_a_id === slotId || m.slot_b_id === slotId) {
					runningWins++;
				}
			} else if (m.winner_slot_id === slotId) {
				runningWins++;
			}
		}
		total += runningWins;
	}
	return total;
}

// Pairwise head-to-head: count completed (non-bye, non-pending) matches
// the slot won against any opponent in `tiedIds`. Multiple matches between
// the same pair all count — symmetric with Buchholz, which sums all wins.
function computePairwiseH2H(
	slotId: string,
	tiedIds: ReadonlySet<string>,
	matches: MatchRef[],
): number {
	let h2h = 0;
	for (const m of matches) {
		if (m.status === "pending" || m.status === "bye") continue;
		if (m.winner_slot_id !== slotId) continue;
		const isAB = m.slot_a_id === slotId && m.slot_b_id !== null;
		const isBA = m.slot_b_id === slotId;
		if (!isAB && !isBA) continue;
		const opponentId = isAB ? m.slot_b_id! : m.slot_a_id;
		if (tiedIds.has(opponentId)) h2h++;
	}
	return h2h;
}

export function computeStandings(
	slots: SlotRef[],
	matches: MatchRef[],
	config: TournamentConfig,
): SlotStanding[] {
	const recordById = new Map<string, SlotRecord>();
	for (const s of slots) {
		recordById.set(s.slot_id, computeRecord(s.slot_id, matches, config));
	}

	const standings: SlotStanding[] = [];
	for (const s of slots) {
		const rec = recordById.get(s.slot_id)!;
		const opponentWins = collectOpponents(s.slot_id, matches).map(
			(oid) => recordById.get(oid)?.wins ?? 0,
		);
		const buchholz_cut1 = computeBuchholzCut1(opponentWins);
		const cumulative = computeCumulative(
			s.slot_id,
			matches,
			config.swiss_max_rounds,
		);
		standings.push({ ...rec, buchholz_cut1, cumulative });
	}
	return standings;
}

export interface RankedStanding extends SlotStanding {
	rank: number; // 1-based
	tied_with: string[]; // other slot_ids the cascade couldn't separate at this rank
	h2h: number; // computed against the final tied set at this slot's rank (0 if not in a tie)
}

// Rank a group of standings using the seeding cascade. Multi-pass: each
// tier may break some ties and leave others, with H2H specifically
// requiring the *tied set* to be known before it can be computed.
//
// Slots that share every tier value share a rank and list each other in
// `tied_with`. Callers that need to disambiguate seed-1 (or any rank with
// a non-empty tied_with) must use override_ranks.
export function rankStandings(
	standings: SlotStanding[],
	matches: MatchRef[],
): RankedStanding[] {
	// Initial grouping by wins (desc). Each group is a list of slots tied on
	// match wins so far. Subsequent tiers split groups further.
	let groups: SlotStanding[][] = groupByKey(standings, (s) => -s.wins);

	// Tier 2: H2H sum-of-points within each still-tied group.
	const h2hByPair = new Map<string, number>(); // slot_id → h2h within its current group
	const newGroups: SlotStanding[][] = [];
	for (const group of groups) {
		if (group.length <= 1) {
			newGroups.push(group);
			if (group.length === 1) h2hByPair.set(group[0].slot_id, 0);
			continue;
		}
		const tiedIds = new Set(group.map((s) => s.slot_id));
		const withH2H = group.map((s) => ({
			s,
			h2h: computePairwiseH2H(s.slot_id, tiedIds, matches),
		}));
		for (const { s, h2h } of withH2H) h2hByPair.set(s.slot_id, h2h);
		// Sub-group by H2H within this win-group.
		const subgroups = groupByKey(withH2H, (x) => -x.h2h);
		for (const sg of subgroups) newGroups.push(sg.map((x) => x.s));
	}
	groups = newGroups;

	// Tier 3: Buchholz cut-1.
	groups = groups.flatMap((group) =>
		group.length <= 1 ? [group] : groupByKey(group, (s) => -s.buchholz_cut1),
	);

	// Tier 4: Cumulative.
	groups = groups.flatMap((group) =>
		group.length <= 1 ? [group] : groupByKey(group, (s) => -s.cumulative),
	);

	// Assemble ranked output. Slots in the same final group share a rank.
	const ranked: RankedStanding[] = [];
	let nextRank = 1;
	for (const group of groups) {
		const groupRank = nextRank;
		const groupIds = group.map((s) => s.slot_id);
		for (const s of group) {
			ranked.push({
				...s,
				rank: groupRank,
				tied_with:
					group.length > 1 ? groupIds.filter((id) => id !== s.slot_id) : [],
				h2h: h2hByPair.get(s.slot_id) ?? 0,
			});
		}
		nextRank += group.length;
	}
	return ranked;
}

// Helper: group a list by a numeric key, preserving descending sort by key.
// Items within the same key keep their input order (stable).
function groupByKey<T>(items: T[], keyFn: (item: T) => number): T[][] {
	const sorted = [...items].sort((a, b) => keyFn(a) - keyFn(b));
	const out: T[][] = [];
	let current: T[] = [];
	let currentKey: number | null = null;
	for (const item of sorted) {
		const k = keyFn(item);
		if (currentKey === null || k !== currentKey) {
			if (current.length > 0) out.push(current);
			current = [];
			currentKey = k;
		}
		current.push(item);
	}
	if (current.length > 0) out.push(current);
	return out;
}
