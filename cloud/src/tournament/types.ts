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
}

export interface MatchRef {
	match_id: string;
	round_id: string;
	round_number: number;
	phase: Phase;
	division: Division | null;
	slot_a_id: string;
	slot_b_id: string | null;
	map_script: string | null;
	status: MatchStatus;
	winner_slot_id: string | null;
}

export interface TournamentConfig {
	swiss_wins_to_advance: number;
	swiss_losses_to_eliminate: number;
	swiss_max_rounds: number;
}
