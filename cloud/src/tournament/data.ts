// D1 row types and shared queries for tournament endpoints.
//
// Handlers import these helpers rather than scattering SELECT/INSERT/UPDATE
// across the codebase. Anything that mutates a tournament also bumps
// tournaments.updated_at via bumpTournamentUpdatedAt — that's the cache
// invalidation key for /standings and /bracket.

import { buildAvatarUrl } from "../auth";
import type {
	Division,
	MapPoolEntry,
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
	swiss_wins_to_advance: number;
	swiss_losses_to_eliminate: number;
	swiss_max_rounds: number;
	// JSON array of map_pool instances: [{ id, script, options }]. The same
	// script may appear multiple times with different options. Parsed by
	// parseMapPool. (Replaced allowed_map_scripts + map_script_options in
	// migration 0019.)
	map_pool: string;
	// 0/1 (SQLite has no real bool). When 1 AND status='setup', the tournament
	// is visible to all beta users and POST /signup is enabled. Auto-flipped
	// to 0 on the setup → swiss transition in handleStartTournament.
	signups_open: number;
	// Admin-announced start time (full ISO-8601 instant), shown as "Starts
	// <date>" during setup/sign-ups. NULL until set via the settings form.
	starts_at: string | null;
	// Stamped once, on the championship-final report that flips status →
	// 'complete'. Shown as "Ended <date>". NULL for any non-complete tournament.
	completed_at: string | null;
	// The creator. Stamped at create time (handleCreateTournament); backfilled
	// for pre-existing rows from the earliest tournament_admins row (migration
	// 0022). Drives delete authz and creator-protection in the admin list. NULL
	// only if backfill found no admin row (shouldn't happen — create always
	// inserts one).
	created_by_user_id: string | null;
	// Optional freeform prompt shown on the signup form. NULL when no question
	// is configured. Set via the settings form (migration 0023).
	signup_question: string | null;
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
	// avatar_hash of the claiming user, LEFT JOINed from users by the slot
	// loaders below. NULL when the slot is unclaimed (no user_id) or the
	// claiming user has no custom Discord avatar. Feeds slotAvatarUrl().
	user_avatar_hash: string | null;
	claim_banner_dismissed_at: string | null;
	// The player's answer to the tournament's optional signup_question, captured
	// at signup (migration 0023). NULL when unanswered or the slot predates the
	// question. Admin-only display in the roster.
	signup_answer: string | null;
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
	// Assigned map_pool instance id (migration 0019). map_script is the
	// denormalized played MAPCLASS, kept for display. Null for byes.
	map_pool_id: string | null;
	map_script: string | null;
	pick_order_winner_slot_id: string | null;
	status: MatchStatus;
	winner_slot_id: string | null;
	game_id: string | null;
	reported_by_user_id: string | null;
	reported_at: string | null;
	notes: string | null;
	// Player indexes from the uploaded save (migration 0007). Populated by
	// the upload flow in games.ts when a tournament-linked game is reported;
	// NULL for matches without a linked game (bye, forfeit, pending).
	slot_a_player_index: number | null;
	slot_b_player_index: number | null;
	// 1-based position of this match within its round (migration 0008).
	// Set at INSERT time by every code path that creates matches. Drives
	// deterministic ORDER BY in loadMatches; consumed by
	// generateChampionshipFollowup to pair winners by structural position.
	match_index: number | null;
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
		`SELECT s.*, u.avatar_hash AS user_avatar_hash
		 FROM tournament_slots s
		 LEFT JOIN users u ON u.user_id = s.user_id
		 WHERE s.tournament_id = ?
		 ORDER BY s.phase, s.division, s.swiss_seed, s.championship_seed`,
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
		 ORDER BY r.phase, r.division, r.round_number, m.match_index, m.created_at`,
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
		`SELECT s.*, u.avatar_hash AS user_avatar_hash
		 FROM tournament_slots s
		 LEFT JOIN users u ON u.user_id = s.user_id
		 WHERE s.slot_id = ?`,
	)
		.bind(slotId)
		.first<SlotRow>();
}

// Tournament-scoped slot load. Returns null if the slot doesn't exist OR
// belongs to a different tournament. Use this whenever a handler accepts a
// slot_id from request input — the URL pins one tournament, the body must
// not be allowed to splice in a slot from another.
export async function loadSlotInTournament(
	env: TournamentEnv,
	slotId: string,
	tournamentId: string,
): Promise<SlotRow | null> {
	return env.SHARE_DB.prepare(
		`SELECT s.*, u.avatar_hash AS user_avatar_hash
		 FROM tournament_slots s
		 LEFT JOIN users u ON u.user_id = s.user_id
		 WHERE s.slot_id = ? AND s.tournament_id = ?`,
	)
		.bind(slotId, tournamentId)
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

// Public avatar URL for a slot's occupant, or null when the slot is
// unclaimed (no discord_id pinned yet). buildAvatarUrl always yields a URL
// once discord_id is present — falling back to Discord's default avatar when
// the user has no custom one — so null here means "show the unclaimed
// fallback" (the EFFECTUNIT_ENLIST_ICON sprite) on the client.
export function slotAvatarUrl(row: SlotRow): string | null {
	return row.discord_id
		? buildAvatarUrl(row.discord_id, row.user_avatar_hash)
		: null;
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
		map_pool_id: row.map_pool_id,
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

export class MapConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MapConfigError";
	}
}

// Parse the JSON-encoded map_pool column into instances. Throws MapConfigError
// on hard corruption (bad JSON, not an array). Individual malformed entries
// (missing id/script, bad option values) are skipped leniently — every option
// has an XML fallback at render time, so a partially-bad blob degrades rather
// than bricking the tournament. An empty array is a legitimate state during
// status='setup' (create accepts the field as optional so the public modal can
// omit it). Match-generation call sites are gated by handleStartTournament,
// which rejects an empty pool before any transition out of 'setup'.
export function parseMapPool(t: TournamentRow): MapPoolEntry[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(t.map_pool);
	} catch {
		throw new MapConfigError(
			`map_pool JSON is corrupted for tournament ${t.tournament_id}`,
		);
	}
	if (!Array.isArray(parsed)) {
		throw new MapConfigError(
			`map_pool must be a JSON array for tournament ${t.tournament_id}`,
		);
	}
	const out: MapPoolEntry[] = [];
	for (const raw of parsed) {
		if (typeof raw !== "object" || raw === null) continue;
		const e = raw as Record<string, unknown>;
		if (typeof e.id !== "string" || typeof e.script !== "string") continue;
		const options: Record<string, string | boolean> = {};
		if (typeof e.options === "object" && e.options !== null) {
			for (const [k, v] of Object.entries(
				e.options as Record<string, unknown>,
			)) {
				if (typeof v === "string" || typeof v === "boolean") options[k] = v;
			}
		}
		out.push({ id: e.id, script: e.script, options });
	}
	return out;
}
