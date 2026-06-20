// In-memory shapes used by the pure-function algorithms (pairing, standings,
// maps, bracket). These are intentionally narrower than the D1 row shapes —
// only the fields the algorithms read. Handlers map from D1 rows to these
// types at the boundary.

export type Phase = "swiss" | "championship";
export type Division = "A" | "B";
export type MatchStatus = "pending" | "complete" | "forfeit" | "bye";
export type SwissStatus = "active" | "advanced" | "eliminated";

export interface SlotRef {
	slot_id: string;
	phase: Phase;
	division: Division | null;
	swiss_seed: number | null;
	championship_seed: number | null;
	// True when an admin has withdrawn the slot mid-tournament (D1
	// tournament_slots.withdrawn_at IS NOT NULL). Withdrawn slots are excluded
	// from the pairing engine's active pool and from championship qualifiers,
	// while their already-played matches stand. Orthogonal to the match-derived
	// SwissStatus — a slot can be 'advanced' and withdrawn.
	withdrawn: boolean;
}

export interface MatchRef {
	match_id: string;
	round_id: string;
	round_number: number;
	phase: Phase;
	division: Division | null;
	slot_a_id: string;
	slot_b_id: string | null;
	// Instance the match was assigned, into tournaments.map_pool. Drives
	// anti-repeat (counts by instance, so two Continent variants are distinct).
	// map_script is the denormalized played MAPCLASS, kept for display.
	map_pool_id: string | null;
	map_script: string | null;
	status: MatchStatus;
	winner_slot_id: string | null;
}

// One entry in tournaments.map_pool: an instance of a map script with its own
// options. The same script may appear in multiple entries (e.g. Continent @
// Duel and Continent @ Tiny).
export interface MapPoolEntry {
	id: string;
	script: string;
	options: Record<string, string | boolean>;
}

export interface TournamentConfig {
	swiss_wins_to_advance: number;
	swiss_losses_to_eliminate: number;
	swiss_max_rounds: number;
}
