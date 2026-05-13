// D1 row types and shared queries for tournament endpoints.
//
// Handlers import these helpers rather than scattering SELECT/INSERT/UPDATE
// across the codebase. Anything that mutates a tournament also bumps
// tournaments.updated_at via bumpTournamentUpdatedAt — that's the cache
// invalidation key for /standings and /bracket.

import type {
	Division,
	MatchRef,
	MatchStatus,
	Phase,
	SlotRef,
	TournamentConfig,
} from "./types";

export interface TournamentRow {
	tournament_id: string;
	slug: string;
	name: string;
	description: string | null;
	status: "setup" | "swiss" | "championship" | "complete";
	division_a_name: string;
	division_b_name: string;
	swiss_advance_count: number | null;
	swiss_wins_to_advance: number;
	swiss_losses_to_eliminate: number;
	swiss_max_rounds: number;
	allowed_map_scripts: string; // JSON array
	created_at: string;
	updated_at: string;
}

export interface SlotRow {
	slot_id: string;
	tournament_id: string;
	phase: Phase;
	division: Division | null;
	swiss_seed: number | null;
	championship_seed: number | null;
	discord_username: string | null;
	discord_id: string | null;
	user_id: string | null;
	claim_banner_dismissed_at: string | null;
	created_at: string;
}

export interface RoundRow {
	round_id: string;
	tournament_id: string;
	phase: Phase;
	division: Division | null;
	round_number: number;
	status: "pending" | "in_progress" | "complete";
	generated_at: string | null;
	started_at: string | null;
	completed_at: string | null;
}

export interface MatchRow {
	match_id: string;
	round_id: string;
	slot_a_id: string;
	slot_b_id: string | null;
	map_script: string | null;
	pick_order_winner_slot_id: string | null;
	status: MatchStatus;
	winner_slot_id: string | null;
	game_id: string | null;
	reported_by_user_id: string | null;
	reported_at: string | null;
	notes: string | null;
	created_at: string;
}

export interface TournamentEnv {
	SHARE_DB: D1Database;
}

export async function loadTournamentBySlug(
	env: TournamentEnv,
	slug: string,
): Promise<TournamentRow | null> {
	return env.SHARE_DB.prepare("SELECT * FROM tournaments WHERE slug = ?")
		.bind(slug)
		.first<TournamentRow>();
}

export async function loadTournamentById(
	env: TournamentEnv,
	id: string,
): Promise<TournamentRow | null> {
	return env.SHARE_DB.prepare(
		"SELECT * FROM tournaments WHERE tournament_id = ?",
	)
		.bind(id)
		.first<TournamentRow>();
}

export async function loadSlots(
	env: TournamentEnv,
	tournamentId: string,
): Promise<SlotRow[]> {
	const res = await env.SHARE_DB.prepare(
		"SELECT * FROM tournament_slots WHERE tournament_id = ? ORDER BY phase, division, swiss_seed, championship_seed",
	)
		.bind(tournamentId)
		.all<SlotRow>();
	return res.results ?? [];
}

export async function loadRounds(
	env: TournamentEnv,
	tournamentId: string,
): Promise<RoundRow[]> {
	const res = await env.SHARE_DB.prepare(
		"SELECT * FROM tournament_rounds WHERE tournament_id = ? ORDER BY phase, division, round_number",
	)
		.bind(tournamentId)
		.all<RoundRow>();
	return res.results ?? [];
}

export async function loadMatches(
	env: TournamentEnv,
	tournamentId: string,
): Promise<MatchRow[]> {
	const res = await env.SHARE_DB.prepare(
		`SELECT m.* FROM tournament_matches m
		 JOIN tournament_rounds r ON r.round_id = m.round_id
		 WHERE r.tournament_id = ?
		 ORDER BY r.phase, r.division, r.round_number, m.created_at`,
	)
		.bind(tournamentId)
		.all<MatchRow>();
	return res.results ?? [];
}

export async function loadMatch(
	env: TournamentEnv,
	matchId: string,
): Promise<MatchRow | null> {
	return env.SHARE_DB.prepare(
		"SELECT * FROM tournament_matches WHERE match_id = ?",
	)
		.bind(matchId)
		.first<MatchRow>();
}

export async function loadRound(
	env: TournamentEnv,
	roundId: string,
): Promise<RoundRow | null> {
	return env.SHARE_DB.prepare(
		"SELECT * FROM tournament_rounds WHERE round_id = ?",
	)
		.bind(roundId)
		.first<RoundRow>();
}

export async function loadSlot(
	env: TournamentEnv,
	slotId: string,
): Promise<SlotRow | null> {
	return env.SHARE_DB.prepare(
		"SELECT * FROM tournament_slots WHERE slot_id = ?",
	)
		.bind(slotId)
		.first<SlotRow>();
}

// Bump updated_at on any mutation. Cache keys for /standings and /bracket
// include this timestamp, so reads naturally return fresh data after a write.
export async function bumpTournamentUpdatedAt(
	env: TournamentEnv,
	tournamentId: string,
): Promise<void> {
	await env.SHARE_DB.prepare(
		"UPDATE tournaments SET updated_at = datetime('now') WHERE tournament_id = ?",
	)
		.bind(tournamentId)
		.run();
}

// Convert D1 rows → in-memory refs used by the pure-function algorithms.
export function slotRowToRef(row: SlotRow): SlotRef {
	return {
		slot_id: row.slot_id,
		phase: row.phase,
		division: row.division,
		swiss_seed: row.swiss_seed,
		championship_seed: row.championship_seed,
	};
}

export function matchRowToRef(
	row: MatchRow,
	round: { round_number: number; phase: Phase; division: Division | null },
): MatchRef {
	return {
		match_id: row.match_id,
		round_id: row.round_id,
		round_number: round.round_number,
		phase: round.phase,
		division: round.division,
		slot_a_id: row.slot_a_id,
		slot_b_id: row.slot_b_id,
		map_script: row.map_script,
		status: row.status,
		winner_slot_id: row.winner_slot_id,
	};
}

export function tournamentConfig(t: TournamentRow): TournamentConfig {
	return {
		swiss_wins_to_advance: t.swiss_wins_to_advance,
		swiss_losses_to_eliminate: t.swiss_losses_to_eliminate,
		swiss_max_rounds: t.swiss_max_rounds,
	};
}

export function parseAllowedMaps(t: TournamentRow): string[] {
	try {
		const parsed = JSON.parse(t.allowed_map_scripts);
		if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
			return parsed;
		}
	} catch {
		// fall through
	}
	return [];
}
