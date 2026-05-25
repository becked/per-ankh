// Auto-assignment of map scripts to matches at round-generation time.
//
// Per-match independent pick — no within-round repeat avoidance. For each
// match (slot_a, slot_b):
//   1. Compute the union of map_scripts both slots have already played
//      across all prior matches in this tournament.
//   2. If any allowed maps are unplayed by either slot, pick randomly from
//      that set.
//   3. Otherwise, pick the map with the lowest combined play count for
//      these two slots. Ties broken by alphabetical order for determinism.
//
// The "anti-repeat" preference applies across the whole tournament history,
// not just the current round. So if you played Coastal Rain Basin in
// round 1, your round 4 opponent (who's also played it) and you will only
// be assigned CRB if there's literally no map both haven't played.

import { createRng } from "./rng";
import type { MapPoolEntry, MatchRef } from "./types";

export interface PairingInput {
	slot_a_id: string;
	slot_b_id: string | null; // null = bye, gets no map
}

export interface MapAssignment extends PairingInput {
	// Assigned map_pool instance + its denormalized script. Both null for byes.
	map_pool_id: string | null;
	map_script: string | null;
}

// Count plays by map_pool instance id, not by script — two instances of the
// same script (e.g. Continent @ Duel and Continent @ Tiny) are distinct for
// anti-repeat purposes.
function countMapPlays(
	slotId: string,
	matches: MatchRef[],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const m of matches) {
		if (m.map_pool_id === null) continue;
		const isParticipant = m.slot_a_id === slotId || m.slot_b_id === slotId;
		if (!isParticipant) continue;
		counts.set(m.map_pool_id, (counts.get(m.map_pool_id) ?? 0) + 1);
	}
	return counts;
}

export function assignMap(
	slotA: string,
	slotB: string,
	pool: MapPoolEntry[],
	priorMatches: MatchRef[],
	rng: () => number,
): MapPoolEntry {
	if (pool.length === 0) {
		throw new Error("map pool must be non-empty");
	}
	const playsA = countMapPlays(slotA, priorMatches);
	const playsB = countMapPlays(slotB, priorMatches);

	const unplayed = pool.filter((e) => !playsA.has(e.id) && !playsB.has(e.id));
	if (unplayed.length > 0) {
		const i = Math.floor(rng() * unplayed.length);
		return unplayed[i];
	}

	// All instances played by at least one of the pair. Pick the one with the
	// lowest combined play count; id tiebreak for determinism.
	const sorted = [...pool].sort((a, b) => {
		const ca = (playsA.get(a.id) ?? 0) + (playsB.get(a.id) ?? 0);
		const cb = (playsA.get(b.id) ?? 0) + (playsB.get(b.id) ?? 0);
		if (ca !== cb) return ca - cb;
		return a.id.localeCompare(b.id);
	});
	return sorted[0];
}

export function assignMapsToPairings(
	pairings: PairingInput[],
	pool: MapPoolEntry[],
	priorMatches: MatchRef[],
	seed: string,
): MapAssignment[] {
	const rng = createRng(seed);
	return pairings.map((p) => {
		if (p.slot_b_id === null) {
			return { ...p, map_pool_id: null, map_script: null };
		}
		const entry = assignMap(p.slot_a_id, p.slot_b_id, pool, priorMatches, rng);
		return { ...p, map_pool_id: entry.id, map_script: entry.script };
	});
}
