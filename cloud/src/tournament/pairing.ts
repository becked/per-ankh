// Swiss pairing algorithm.
//
// Round 1: random shuffle within division, paired sequentially. Seeded by
// (tournament_id + round_id) for reproducibility.
//
// Round 2+:
//   1. Compute W-L per active slot (active = not yet at 3W or 3L).
//   2. Bucket by (wins, losses).
//   3. Within each bucket, sort by (wins desc, losses asc, swiss_seed asc)
//      and pair top-half vs bottom-half.
//   4. If a pairing is a rematch, try swapping one bottom-half slot with
//      another bottom-half slot to eliminate it without creating a new
//      rematch.
//   5. If no clean swap exists, accept the rematch (algorithm is advisory;
//      admin can override the pairing before starting the round).
//   6. Odd-sized buckets: the lowest-ranked slot floats down to the next
//      bucket.
//   7. Odd total active in division: lowest-ranked-no-bye-yet gets the bye.
//
// All output is advisory — the handler returns it; admin reviews and edits
// before calling /start.

import { computeRecord } from "./standings";
import { createRng, shuffle } from "./rng";
import type { MatchRef, SlotRef, TournamentConfig } from "./types";

export interface Pairing {
	slot_a_id: string;
	slot_b_id: string | null; // null = bye
}

interface ActiveSlot {
	slot: SlotRef;
	wins: number;
	losses: number;
}

export function pairSwissRound(
	slots: SlotRef[],
	priorMatches: MatchRef[],
	roundNumber: number,
	config: TournamentConfig,
	seed: string,
): Pairing[] {
	const rng = createRng(seed);

	if (roundNumber === 1) {
		return pairRound1(slots, rng);
	}

	const active: ActiveSlot[] = [];
	for (const s of slots) {
		const rec = computeRecord(s.slot_id, priorMatches, config);
		if (rec.status === "active") {
			active.push({ slot: s, wins: rec.wins, losses: rec.losses });
		}
	}
	if (active.length === 0) return [];

	let byeSlot: SlotRef | null = null;
	if (active.length % 2 === 1) {
		byeSlot = pickByeRecipient(active, priorMatches);
		const idx = active.findIndex((a) => a.slot.slot_id === byeSlot!.slot_id);
		active.splice(idx, 1);
	}

	const buckets = bucketByRecord(active);
	const priorPairs = buildPriorPairsSet(priorMatches);

	const pairings: Pairing[] = [];
	let floater: ActiveSlot | null = null;
	for (let bi = 0; bi < buckets.length; bi++) {
		const bucket = buckets[bi];
		if (floater) {
			bucket.unshift(floater);
			floater = null;
		}
		if (bucket.length % 2 === 1) {
			floater = bucket.pop()!;
		}
		if (bucket.length === 0) continue;
		pairings.push(...pairBucket(bucket, priorPairs));
	}
	if (floater) {
		// Defensive: even total active should never leave a floater. If we
		// got here, the input was already odd (bye logic missed it) or
		// bucketing produced an impossible spill. Surface loudly.
		throw new Error(
			`Pairing algorithm orphaned slot ${floater.slot.slot_id}; active count parity broken`,
		);
	}

	if (byeSlot) {
		pairings.push({ slot_a_id: byeSlot.slot_id, slot_b_id: null });
	}

	return pairings;
}

function pairRound1(slots: SlotRef[], rng: () => number): Pairing[] {
	const order = shuffle([...slots], rng);
	const pairings: Pairing[] = [];
	for (let i = 0; i + 1 < order.length; i += 2) {
		pairings.push({
			slot_a_id: order[i].slot_id,
			slot_b_id: order[i + 1].slot_id,
		});
	}
	if (order.length % 2 === 1) {
		pairings.push({
			slot_a_id: order[order.length - 1].slot_id,
			slot_b_id: null,
		});
	}
	return pairings;
}

function compareForPairing(a: ActiveSlot, b: ActiveSlot): number {
	if (a.wins !== b.wins) return b.wins - a.wins;
	if (a.losses !== b.losses) return a.losses - b.losses;
	return (a.slot.swiss_seed ?? 0) - (b.slot.swiss_seed ?? 0);
}

function pickByeRecipient(
	active: ActiveSlot[],
	priorMatches: MatchRef[],
): SlotRef {
	const hadBye = new Set<string>();
	for (const m of priorMatches) {
		if (m.slot_b_id === null) hadBye.add(m.slot_a_id);
	}
	const sorted = [...active].sort(compareForPairing);
	for (let i = sorted.length - 1; i >= 0; i--) {
		if (!hadBye.has(sorted[i].slot.slot_id)) return sorted[i].slot;
	}
	return sorted[sorted.length - 1].slot;
}

function bucketByRecord(active: ActiveSlot[]): ActiveSlot[][] {
	const sorted = [...active].sort(compareForPairing);
	const buckets: ActiveSlot[][] = [];
	let current: ActiveSlot[] = [];
	let currentKey = "";
	for (const a of sorted) {
		const key = `${a.wins}-${a.losses}`;
		if (key !== currentKey) {
			if (current.length > 0) buckets.push(current);
			current = [];
			currentKey = key;
		}
		current.push(a);
	}
	if (current.length > 0) buckets.push(current);
	return buckets;
}

function buildPriorPairsSet(priorMatches: MatchRef[]): Set<string> {
	const set = new Set<string>();
	for (const m of priorMatches) {
		if (m.slot_b_id === null) continue;
		set.add(pairKey(m.slot_a_id, m.slot_b_id));
	}
	return set;
}

function pairKey(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function pairBucket(bucket: ActiveSlot[], priorPairs: Set<string>): Pairing[] {
	const mid = bucket.length / 2;
	const topHalf = bucket.slice(0, mid);
	const bottomHalf = bucket.slice(mid);

	for (let i = 0; i < topHalf.length; i++) {
		const aId = topHalf[i].slot.slot_id;
		const bId = bottomHalf[i].slot.slot_id;
		if (!priorPairs.has(pairKey(aId, bId))) continue;

		for (let j = 0; j < bottomHalf.length; j++) {
			if (j === i) continue;
			const candidateBId = bottomHalf[j].slot.slot_id;
			if (priorPairs.has(pairKey(aId, candidateBId))) continue;
			const otherTopId = topHalf[j].slot.slot_id;
			if (priorPairs.has(pairKey(otherTopId, bId))) continue;
			[bottomHalf[i], bottomHalf[j]] = [bottomHalf[j], bottomHalf[i]];
			break;
		}
	}

	const pairings: Pairing[] = [];
	for (let i = 0; i < topHalf.length; i++) {
		pairings.push({
			slot_a_id: topHalf[i].slot.slot_id,
			slot_b_id: bottomHalf[i].slot.slot_id,
		});
	}
	return pairings;
}
