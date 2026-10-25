// The succession chain, per seat, derived from the blob at index time.
//
// `cloud/src/games.ts` calls `deriveLeaderReigns()` once per upload and once
// per admin reindex; the rows it returns are the leader_reigns table
// (migration 0054), whose header explains why the chain has to be in D1 at all.
//
// What the save gives us, per character: `<LeaderTurn>` (accession),
// `<AbdicateTurn>`, `<DeathTurn>`, and the archetype as a self-named
// `*_ARCHETYPE` trait inside `<TraitTurn>`. A character with no `<LeaderTurn>`
// never sat the throne.
//
// Type philosophy matches derive-player-summary.ts: the Valibot schema bounds
// the array sizes and leaves the entries `v.unknown()`, so we narrow inline
// with a cast whose shape mirrors CharacterInfo in src/lib/parser/types.ts.

import type { FullGameData } from "./schemas/game";

// Wire-shape mirror (kept in sync with CharacterInfo in
// src/lib/parser/types.ts). Only the fields a reign needs.
interface CharacterRow {
	xml_id: number;
	player_xml_id: number | null;
	became_leader_turn: number | null;
	death_turn: number | null;
	archetype: string | null;
}

export interface LeaderReign {
	player_index: number;
	character_xml_id: number;
	archetype: string | null;
	start_turn: number;
	// Exclusive: the turn the next leader acceded. See the migration header for
	// why this is not the leader's own death turn.
	end_turn: number;
}

export function deriveLeaderReigns(blob: FullGameData): LeaderReign[] {
	const totalTurns = blob.match_metadata.total_turns;
	const characters = blob.characters as CharacterRow[];

	// Group the throne-holders by seat. A character with a null player_xml_id
	// is tribal/unowned and belongs to no seat.
	const bySeat = new Map<number, CharacterRow[]>();
	for (const c of characters) {
		if (c.player_xml_id === null || c.became_leader_turn === null) continue;
		const seat = bySeat.get(c.player_xml_id) ?? [];
		seat.push(c);
		bySeat.set(c.player_xml_id, seat);
	}

	const out: LeaderReign[] = [];
	for (const [playerIndex, seat] of bySeat) {
		// Accession order. Ties (two accessions on one turn, 7 in the corpus)
		// break on xml_id, which is the order the game assigned the characters —
		// the only tiebreak the save offers. Both reigns end up zero-length
		// whichever way round they fall, so the choice costs no throne-time.
		seat.sort(
			(a, b) =>
				(a.became_leader_turn as number) - (b.became_leader_turn as number) ||
				a.xml_id - b.xml_id,
		);
		seat.forEach((c, i) => {
			const start = c.became_leader_turn as number;
			const end = seat[i + 1]?.became_leader_turn ?? c.death_turn ?? totalTurns;
			out.push({
				player_index: playerIndex,
				character_xml_id: c.xml_id,
				archetype: c.archetype,
				start_turn: start,
				// A leader who outlived the save's last recorded turn, or whose
				// successor's accession somehow precedes their own, holds no turns
				// rather than negative ones.
				end_turn: Math.max(start, end),
			});
		});
	}
	return out;
}
