// Auto-assignment of map scripts to matches at round-generation time.
//
// Two objectives, in priority order. For each match (slot_a, slot_b):
//
//   PRIMARY — avoid repeating a base map *script* for either player.
//   Compute, per slot, the scripts each has already played across all prior
//   matches in this tournament. Eligible instances are those whose script
//   neither slot has played. If any exist, pick from them; otherwise fall back
//   to the instance with the lowest combined script play count for the pair.
//   When a repeat is forced this way, prefer an instance (options set) the pair
//   hasn't actually played, so at least the settings differ. (id tiebreak for
//   determinism.)
//
//   SECONDARY (best-effort, subordinate to the primary) — spread distinct
//   scripts across the matches of the current round. Among the eligible
//   instances, prefer those whose script hasn't been used yet earlier in this
//   round; only if every eligible script is already used this round do we
//   reuse one. In the fallback tier, round-usage is a secondary sort key
//   beneath combined play count.
//
// The primary preference applies across the whole tournament history, not just
// the current round. So if you played Coastal Rain Basin in round 1, your
// round 4 opponent (who's also played it) and you will only be assigned CRB if
// there's literally no script both haven't played.
//
// When an eligible script has several instances (same script, different
// options) in the pool, the pick is uniform over instances — so a script with
// more option-variants is proportionally more likely.

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

// Count plays by base map script, not by instance — two instances of the same
// script (e.g. Continent @ Duel and Continent @ Tiny) collapse to one
// anti-repeat unit and differ only in options when that script is picked.
function countScriptPlays(
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

// The set of map_pool instance ids either slot has actually played. Used only
// in the forced-repeat fallback to prefer an unplayed options-variant of a
// script over the exact instance already seen.
function playedInstanceIds(
	slotA: string,
	slotB: string,
	matches: MatchRef[],
): Set<string> {
	const ids = new Set<string>();
	for (const m of matches) {
		if (m.map_pool_id === null) continue;
		if (
			m.slot_a_id === slotA ||
			m.slot_b_id === slotA ||
			m.slot_a_id === slotB ||
			m.slot_b_id === slotB
		) {
			ids.add(m.map_pool_id);
		}
	}
	return ids;
}

export function assignMap(
	slotA: string,
	slotB: string,
	pool: MapPoolEntry[],
	priorMatches: MatchRef[],
	rng: () => number,
	usedScriptsThisRound: Set<string> = new Set(),
): MapPoolEntry {
	if (pool.length === 0) {
		throw new Error("map pool must be non-empty");
	}
	const playsA = countScriptPlays(slotA, priorMatches);
	const playsB = countScriptPlays(slotB, priorMatches);

	// Eligible = instances whose script neither slot has played (PRIMARY).
	const eligible = pool.filter(
		(e) => !playsA.has(e.script) && !playsB.has(e.script),
	);
	if (eligible.length > 0) {
		// Prefer scripts not yet used this round (SECONDARY); if every eligible
		// script is already used this round, fall back to the full eligible set.
		const fresh = eligible.filter((e) => !usedScriptsThisRound.has(e.script));
		const candidates = fresh.length > 0 ? fresh : eligible;
		const i = Math.floor(rng() * candidates.length);
		return candidates[i];
	}

	// Every script played by at least one of the pair, so a script repeat is
	// forced. Pick by: lowest combined script play count; then scripts unused
	// this round; then — since we're stuck repeating a script — prefer an
	// instance (options set) the pair hasn't actually played, so at least the
	// settings differ; id tiebreak for determinism.
	const playedInstances = playedInstanceIds(slotA, slotB, priorMatches);
	const sorted = [...pool].sort((a, b) => {
		const ca = (playsA.get(a.script) ?? 0) + (playsB.get(a.script) ?? 0);
		const cb = (playsA.get(b.script) ?? 0) + (playsB.get(b.script) ?? 0);
		if (ca !== cb) return ca - cb;
		const ra = usedScriptsThisRound.has(a.script) ? 1 : 0;
		const rb = usedScriptsThisRound.has(b.script) ? 1 : 0;
		if (ra !== rb) return ra - rb;
		const ia = playedInstances.has(a.id) ? 1 : 0;
		const ib = playedInstances.has(b.id) ? 1 : 0;
		if (ia !== ib) return ia - ib;
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
	const usedScriptsThisRound = new Set<string>();
	return pairings.map((p) => {
		if (p.slot_b_id === null) {
			return { ...p, map_pool_id: null, map_script: null };
		}
		const entry = assignMap(
			p.slot_a_id,
			p.slot_b_id,
			pool,
			priorMatches,
			rng,
			usedScriptsThisRound,
		);
		usedScriptsThisRound.add(entry.script);
		return { ...p, map_pool_id: entry.id, map_script: entry.script };
	});
}
