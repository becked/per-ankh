// W/L tallying, Buchholz scoring, and the tiebreaker cascade.
//
// All standings are derived from tournament_matches on read — there is no
// stored swiss_wins/swiss_losses column on tournament_slots. That keeps
// retro-edits a pure UPDATE and removes the class of bugs where derived
// state drifts from the underlying matches.
//
// Buchholz scoring notes:
//   * Byes (slot_b_id IS NULL) award the bye-receiver +1 win but do NOT
//     enter anyone's opponent list. Standard Swiss treatment — a bye
//     shouldn't pollute strength-of-schedule for the receiver's later
//     opponents.
//   * Forfeits (status='forfeit') award +1 win to the non-forfeiting slot
//     and DO count as opponent encounters. If the forfeiter drops out
//     entirely, the opponent's MB/Solkoff is permanently deflated by the
//     forfeiter's frozen win count. Acceptable — standard Swiss behavior.

import type { MatchRef, SlotRef, SwissStatus, TournamentConfig } from "./types";

export interface SlotRecord {
	slot_id: string;
	wins: number;
	losses: number;
	status: SwissStatus;
}

export interface SlotStanding extends SlotRecord {
	median_buchholz: number;
	solkoff: number;
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
		opponentWins.sort((a, b) => a - b);
		const solkoff = opponentWins.reduce((acc, v) => acc + v, 0);
		// Median-Buchholz: drop the single highest and single lowest opponent
		// score, sum the rest. For ≤2 opponents the "median" is the full sum
		// (nothing to drop).
		const median_buchholz =
			opponentWins.length <= 2
				? solkoff
				: opponentWins.slice(1, -1).reduce((acc, v) => acc + v, 0);
		standings.push({ ...rec, median_buchholz, solkoff });
	}
	return standings;
}

// Cascade comparator: wins → Median-Buchholz → Solkoff. Returns 0 if all
// three are equal — caller must resolve via admin override.
//
// Returns negative if `a` ranks higher (should sort first), positive if `b`.
export function compareStandings(a: SlotStanding, b: SlotStanding): number {
	if (a.wins !== b.wins) return b.wins - a.wins;
	if (a.median_buchholz !== b.median_buchholz)
		return b.median_buchholz - a.median_buchholz;
	if (a.solkoff !== b.solkoff) return b.solkoff - a.solkoff;
	return 0;
}

export interface RankedStanding extends SlotStanding {
	rank: number; // 1-based
	tied_with: string[]; // other slot_ids the cascade couldn't separate at this rank
}

// Rank a group of standings (e.g. all slots in one division) using the
// cascade. Slots that are fully tied (compareStandings returns 0) share
// a rank and list each other in `tied_with`.
export function rankStandings(standings: SlotStanding[]): RankedStanding[] {
	const sorted = [...standings].sort(compareStandings);
	const ranked: RankedStanding[] = sorted.map((s) => ({
		...s,
		rank: 0,
		tied_with: [],
	}));
	let currentRank = 1;
	for (let i = 0; i < ranked.length; i++) {
		if (i === 0) {
			ranked[i].rank = currentRank;
		} else if (compareStandings(ranked[i - 1], ranked[i]) === 0) {
			ranked[i].rank = ranked[i - 1].rank;
		} else {
			currentRank = i + 1;
			ranked[i].rank = currentRank;
		}
	}
	for (let i = 0; i < ranked.length; i++) {
		for (let j = 0; j < ranked.length; j++) {
			if (i === j) continue;
			if (ranked[i].rank === ranked[j].rank) {
				ranked[i].tied_with.push(ranked[j].slot_id);
			}
		}
	}
	return ranked;
}
