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
import type { MatchRef } from "./types";

export interface PairingInput {
	slot_a_id: string;
	slot_b_id: string | null; // null = bye, gets no map
}

export interface MapAssignment extends PairingInput {
	map_script: string | null; // null for byes
}

function countMapPlays(
	slotId: string,
	matches: MatchRef[],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const m of matches) {
		if (m.map_script === null) continue;
		const isParticipant = m.slot_a_id === slotId || m.slot_b_id === slotId;
		if (!isParticipant) continue;
		counts.set(m.map_script, (counts.get(m.map_script) ?? 0) + 1);
	}
	return counts;
}

export function assignMap(
	slotA: string,
	slotB: string,
	allowedMaps: string[],
	priorMatches: MatchRef[],
	rng: () => number,
): string {
	if (allowedMaps.length === 0) {
		throw new Error("allowedMaps must be non-empty");
	}
	const playsA = countMapPlays(slotA, priorMatches);
	const playsB = countMapPlays(slotB, priorMatches);

	const unplayed = allowedMaps.filter((m) => !playsA.has(m) && !playsB.has(m));
	if (unplayed.length > 0) {
		const i = Math.floor(rng() * unplayed.length);
		return unplayed[i];
	}

	// All maps played by at least one of the pair. Pick the map with the
	// lowest combined play count; alphabetical tiebreak for determinism.
	const sorted = [...allowedMaps].sort((a, b) => {
		const ca = (playsA.get(a) ?? 0) + (playsB.get(a) ?? 0);
		const cb = (playsA.get(b) ?? 0) + (playsB.get(b) ?? 0);
		if (ca !== cb) return ca - cb;
		return a.localeCompare(b);
	});
	return sorted[0];
}

export function assignMapsToPairings(
	pairings: PairingInput[],
	allowedMaps: string[],
	priorMatches: MatchRef[],
	seed: string,
): MapAssignment[] {
	const rng = createRng(seed);
	return pairings.map((p) => {
		if (p.slot_b_id === null) {
			return { ...p, map_script: null };
		}
		const map = assignMap(
			p.slot_a_id,
			p.slot_b_id,
			allowedMaps,
			priorMatches,
			rng,
		);
		return { ...p, map_script: map };
	});
}
