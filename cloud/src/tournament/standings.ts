// W/L tallying, tiebreaker scoring, and the bracket-seeding cascade.
//
// All standings are derived from tournament_matches on read — there is no
// stored swiss_wins/swiss_losses column on tournament_slots. That keeps
// retro-edits a pure UPDATE and removes the class of bugs where derived
// state drifts from the underlying matches.
//
// Cascade for bracket seeding:
//   1. Losses (ascending), with wins (descending) as the primary axis for
//      the full-standings view — i.e. the composite key (wins desc, losses
//      asc). For qualifiers wins is constant at the advance threshold, so
//      Tier 1 reduces to losses asc — equivalently, "rounds taken to clinch."
//   2. Head-to-head — sum of wins against other still-tied players
//   3. Buchholz cut-1 — sum of opponents' wins, lowest dropped
//   4. Opponents' Buchholz — sum of each opponent's Buchholz cut-1. A
//      deeper strength-of-schedule measure; the only tier with discriminating
//      power in the zero-loss bucket (where cumulative is a structural no-op).
//   5. Cumulative — sum of running win count across rounds (Harkness)
//   6. Initial swiss seed, then slot_id — a deterministic terminal key so the
//      bracket seed order is always fully determined without manual input.
//      Only the *emission order within a tied group* is fixed here; `rank` and
//      `tied_with` still report ties on the meaningful tiers (1-5).
//
// Why Tier 1 is losses, not wins: in early-exit Swiss every qualifier has the
// same number of wins by definition, so wins-desc was degenerate and pushed
// the entire seeding job onto Tiers 2+ across a population that played
// different numbers of rounds. Losses-asc separates qualifiers directly and,
// as a side effect, restricts each downstream tier to a single rounds-played
// cohort. See docs/tournament-seeding-tier1-proposal.md.
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
	// Sum of each opponent's buchholz_cut1 (Tier 4). Two-pass: needs every
	// slot's buchholz_cut1 computed first.
	opponents_buchholz: number;
	cumulative: number;
	// Carried from the SlotRef so the ranker can use it as the deterministic
	// Tier 6 fallback. Null for slots without a swiss seed (shouldn't happen
	// for swiss-phase slots, but the column is nullable).
	swiss_seed: number | null;
	// Carried from the SlotRef. Withdrawn slots still appear in standings (with
	// their frozen record) for display, but are excluded from championship
	// qualifiers — see the filter in handleTransitionChampionship.
	withdrawn: boolean;
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
// Why count past-clinch rounds: it was originally how the cascade separated
// early clinchers from late ones. Under Tier 1 = losses asc that separation
// now happens upstream (everyone in a losses bucket clinched at the same
// round), so the carry only adds a per-bucket constant and never reorders
// within a bucket. Retained anyway: it keeps cumulative monotonic across
// buckets and the calculation simple.
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

	// Pass 1: per-slot Buchholz cut-1 and cumulative. Buchholz is also kept in
	// a map so pass 2 can sum opponents' Buchholz (Tier 4).
	const buchholzBySlot = new Map<string, number>();
	const partial = new Map<
		string,
		{ rec: SlotRecord; buchholz_cut1: number; cumulative: number }
	>();
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
		buchholzBySlot.set(s.slot_id, buchholz_cut1);
		partial.set(s.slot_id, { rec, buchholz_cut1, cumulative });
	}

	// Pass 2: opponents' Buchholz = sum of each (non-bye) opponent's Buchholz
	// cut-1. Needs every slot's buchholz_cut1 from pass 1.
	const standings: SlotStanding[] = [];
	for (const s of slots) {
		const { rec, buchholz_cut1, cumulative } = partial.get(s.slot_id)!;
		const opponents_buchholz = collectOpponents(s.slot_id, matches).reduce(
			(sum, oid) => sum + (buchholzBySlot.get(oid) ?? 0),
			0,
		);
		standings.push({
			...rec,
			buchholz_cut1,
			opponents_buchholz,
			cumulative,
			swiss_seed: s.swiss_seed,
			withdrawn: s.withdrawn,
		});
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
// Slots that share every *meaningful* tier value (1-5) share a rank and list
// each other in `tied_with`. Such ties no longer require manual intervention:
// Tier 6 (initial swiss seed, then slot_id) deterministically fixes the
// emission order — hence the bracket seed — within a tied group. override_ranks
// remains only for the INSUFFICIENT_QUALIFIERS case (promoting non-clinchers).
export function rankStandings(
	standings: SlotStanding[],
	matches: MatchRef[],
): RankedStanding[] {
	// Tier 1: composite (wins desc, losses asc). WINS_WEIGHT just needs to
	// exceed any realistic losses count (bounded by swiss_losses_to_eliminate)
	// so wins dominates the sort and losses breaks wins-ties. For qualifiers
	// wins is constant, so this reduces to losses asc.
	const WINS_WEIGHT = 1000;
	let groups: SlotStanding[][] = groupByKey(
		standings,
		(s) => s.losses - WINS_WEIGHT * s.wins,
	);

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

	// Tier 4: Opponents' Buchholz (depth of schedule).
	groups = groups.flatMap((group) =>
		group.length <= 1
			? [group]
			: groupByKey(group, (s) => -s.opponents_buchholz),
	);

	// Tier 5: Cumulative.
	groups = groups.flatMap((group) =>
		group.length <= 1 ? [group] : groupByKey(group, (s) => -s.cumulative),
	);

	// Tier 6: deterministic terminal key. Within any group the meaningful tiers
	// couldn't split, fix the emission order by initial swiss seed (asc), then
	// slot_id (asc) to guarantee a total order. This sets the bracket seed
	// order; `rank`/`tied_with` below still reflect the Tier 1-5 tie.
	for (const group of groups) {
		if (group.length <= 1) continue;
		group.sort(
			(a, b) =>
				(a.swiss_seed ?? Infinity) - (b.swiss_seed ?? Infinity) ||
				(a.slot_id < b.slot_id ? -1 : a.slot_id > b.slot_id ? 1 : 0),
		);
	}

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
