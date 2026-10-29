// The succession chain, per seat, derived from the blob at index time.
//
// `cloud/src/games.ts` calls `deriveLeaderReigns()` once per upload and once
// per admin reindex; the rows it returns are the leader_reigns table
// (migration 0056), whose header explains why the chain has to be in D1 at all.
//
// What the save gives us, per character: `<LeaderTurn>` (accession) and the
// archetype as a self-named `*_ARCHETYPE` trait inside `<TraitTurn>`. A
// character with no `<LeaderTurn>` never sat the throne; one with no seat is
// tribal (`Player="-1"` in the save) and belongs to nobody's succession.
//
// Those two fields are the whole row. The reader counts leaders in the band
// their accession turn falls in, so there is no reign length to compute and no
// boundary to pick between a predecessor's death and their successor's
// accession.
//
// Type philosophy matches derive-player-summary.ts: the Valibot schema bounds
// the array sizes and leaves the entries `v.unknown()`, so we narrow inline
// with a cast whose shape mirrors CharacterInfo in src/lib/parser/types.ts.

import type { FullGameData } from "./schemas/game";

// Wire-shape mirror (kept in sync with CharacterInfo in
// src/lib/parser/types.ts). Only the fields a reign needs, and each one
// optional: a blob stored by a parser that predates a field omits the key
// rather than writing null, so the normalization below is `?? null` and the
// guards are `== null`, as derive-player-summary.ts does it.
interface CharacterRow {
	xml_id: number;
	player_xml_id?: number | null;
	became_leader_turn?: number | null;
	archetype?: string | null;
}

export interface LeaderReign {
	player_index: number;
	character_xml_id: number;
	archetype: string | null;
	start_turn: number;
}

export function deriveLeaderReigns(blob: FullGameData): LeaderReign[] {
	const out: LeaderReign[] = [];
	for (const c of blob.characters as CharacterRow[]) {
		if (c.became_leader_turn == null || c.player_xml_id == null) continue;
		out.push({
			player_index: c.player_xml_id,
			character_xml_id: c.xml_id,
			archetype: c.archetype ?? null,
			start_turn: c.became_leader_turn,
		});
	}
	return out;
}
