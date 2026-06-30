// Swiss pairing algorithm.
//
// Round 1: seed-ordered fold pairing within division. Slots are sorted by
// swiss_seed (everyone is 0-0, so the record tiers are no-ops) and the top
// half is paired against the bottom half — seed 1 vs seed N/2+1, etc. — the
// same fold the bucket logic uses in later rounds. Odd field: the lowest seed
// takes the bye.
//
// Round 2+:
//   1. Compute W-L per active slot (active = not yet at 3W or 3L).
//   2. Bucket by (wins, losses).
//   3. Within each bucket, sort by (wins desc, losses asc, swiss_seed asc)
//      and pair top-half vs bottom-half.
//   4. If a pairing is a rematch, try swapping one bottom-half slot with
//      another bottom-half slot to eliminate it without creating a new
//      rematch.
//   5. If no clean swap exists, accept the rematch — an unavoidable rematch
//      stands; there is no manual re-pair step.
//   6. Odd-sized buckets: the lowest-ranked slot floats down to the next
//      bucket.
//   7. Odd total active in division: lowest-ranked-no-bye-yet gets the bye.
//
// The handler writes this pairing straight into the round's matches when the
// round is generated — there is no pairing-review/edit step and no endpoint to
// re-pair a round or reassign a bye. Seeding and division assignment (both set
// before the tournament starts) are the only levers that shape pairings.

import { computeRecord } from "./standings";
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
): Pairing[] {
	if (roundNumber === 1) {
		return pairRound1(slots);
	}

	const active: ActiveSlot[] = [];
	for (const s of slots) {
		if (s.withdrawn) continue; // admin-withdrawn: out of all future pairing
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

function pairRound1(slots: SlotRef[]): Pairing[] {
	// Every slot is 0-0, so compareForPairing reduces to swiss_seed asc: the
	// field ends up sorted best-seed-first. pairBucket then folds top half
	// against bottom half (seed 1 vs seed N/2+1, …) — no prior matches, so no
	// rematch avoidance is needed. Withdrawn slots are excluded up front (an
	// admin can withdraw a player before round 1 is generated).
	const active: ActiveSlot[] = slots
		.filter((s) => !s.withdrawn)
		.map((s) => ({
			slot: s,
			wins: 0,
			losses: 0,
		}));
	active.sort(compareForPairing);

	let byeSlot: SlotRef | null = null;
	if (active.length % 2 === 1) {
		// Lowest seed (last after the best-first sort) takes the bye.
		byeSlot = active.pop()!.slot;
	}

	const pairings = pairBucket(active, new Set());
	if (byeSlot) {
		pairings.push({ slot_a_id: byeSlot.slot_id, slot_b_id: null });
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
