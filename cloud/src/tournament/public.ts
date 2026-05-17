// Public (anonymous-read) tournament handlers. No session required.

import { sessionFromRequest } from "../session";
import {
	cloudCorsHeaders,
	errorResponse,
	getClientIp,
	jsonResponse,
} from "../util";
import { countEventsSince, isScraperUA } from "../games";
import { logError } from "../log";
import { isTournamentAdmin } from "./authz";
import {
	loadMatch,
	loadMatches,
	loadRounds,
	loadSlots,
	loadTournamentById,
	loadTournamentBySlug,
	MapConfigError,
	matchRowToRef,
	parseAllowedMaps,
	slotRowToRef,
	tournamentConfig,
	type MatchRow,
	type RoundRow,
	type TournamentEnv,
	type TournamentRow,
} from "./data";
import { TOURNAMENT_VIEW_PER_HOUR } from "./limits";
import {
	computeStandings,
	rankStandings,
	type RankedStanding,
} from "./standings";

export interface TournamentPublicEnv extends TournamentEnv {
	ALLOWED_ORIGINS: string;
	SESSIONS_KV: KVNamespace;
}

const LIST_LIMIT_MAX = 100;
const LIST_LIMIT_DEFAULT = 20;

// Per-IP rate limit on anonymous tournament reads. Scraper User-Agents
// (Discord/Slack/Twitter link previews) bypass both the gate and the
// audit-log insert — they fan out load that's not meaningful to count.
// Applies to everyone, including signed-in users; 600/hour is generous
// enough that no real UI traffic should hit it.
async function enforceTournamentViewRateLimit(
	env: TournamentPublicEnv,
	request: Request,
	cors: Record<string, string>,
): Promise<Response | null> {
	const ua = request.headers.get("User-Agent");
	if (isScraperUA(ua)) return null;
	const ip = getClientIp(request) ?? "untrusted";
	const count = await countEventsSince(
		env.SHARE_DB,
		"tournament_view",
		"ip_address",
		ip,
	);
	if (count >= TOURNAMENT_VIEW_PER_HOUR) {
		return errorResponse(
			"Tournament view rate limit exceeded",
			429,
			cors,
			"RATE_LIMIT_TOURNAMENT_VIEW",
		);
	}
	env.SHARE_DB.prepare(
		`INSERT INTO events (event_type, ip_address)
		 VALUES ('tournament_view', ?)`,
	)
		.bind(ip)
		.run()
		.catch((e: unknown) => {
			logError("tournament_view_audit_failed", e, { ip });
		});
	return null;
}

export async function handleTournamentList(
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const url = new URL(request.url);
	const status = url.searchParams.get("status");
	const limit = clampInt(
		url.searchParams.get("limit"),
		LIST_LIMIT_DEFAULT,
		1,
		LIST_LIMIT_MAX,
	);
	const offset = clampInt(url.searchParams.get("offset"), 0, 0, 10_000);

	const allowedStatus = new Set(["setup", "swiss", "championship", "complete"]);
	const filter = status && allowedStatus.has(status) ? status : null;

	// Setup-phase tournaments are admin-only. A LEFT JOIN against
	// tournament_admins for the current viewer turns the visibility check
	// into a SQL predicate. Binding NULL when there's no session causes
	// `ta.user_id = ?` to never match (NULL comparisons are unknown), so
	// anonymous callers naturally see only non-setup rows.
	const session = await sessionFromRequest(env, request);
	const viewerId = session?.data.user_id ?? null;

	const params: unknown[] = [viewerId];
	let whereSetup = "(t.status != 'setup' OR ta.user_id IS NOT NULL)";
	if (filter) {
		whereSetup += " AND t.status = ?";
		params.push(filter);
	}
	params.push(limit, offset);

	const stmt = env.SHARE_DB.prepare(
		`SELECT t.tournament_id, t.slug, t.name, t.status, t.created_at, t.updated_at
		 FROM tournaments t
		 LEFT JOIN tournament_admins ta
		   ON ta.tournament_id = t.tournament_id AND ta.user_id = ?
		 WHERE ${whereSetup}
		 ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
	).bind(...params);

	const res = await stmt.all<{
		tournament_id: string;
		slug: string;
		name: string;
		status: string;
		created_at: string;
		updated_at: string;
	}>();

	return jsonResponse(
		{ tournaments: res.results ?? [], limit, offset },
		200,
		cors,
	);
}

export async function handleTournamentDetail(
	slug: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const tournament = await loadTournamentBySlug(env, slug);
	if (!tournament) {
		return errorResponse(
			"Tournament not found",
			404,
			cors,
			"TOURNAMENT_NOT_FOUND",
		);
	}
	// is_viewer_admin lets the frontend show observer-upload affordances
	// without a second round-trip. Anonymous callers always see false.
	const session = await sessionFromRequest(env, request);
	const is_viewer_admin = await isTournamentAdmin(
		env,
		session?.data ?? null,
		tournament.tournament_id,
	);
	// Setup-phase tournaments are admin-only. 404 (not 403) so we don't
	// leak existence to non-admins.
	if (tournament.status === "setup" && !is_viewer_admin) {
		return errorResponse(
			"Tournament not found",
			404,
			cors,
			"TOURNAMENT_NOT_FOUND",
		);
	}
	const slotCount = await env.SHARE_DB.prepare(
		"SELECT phase, COUNT(*) AS count FROM tournament_slots WHERE tournament_id = ? GROUP BY phase",
	)
		.bind(tournament.tournament_id)
		.all<{ phase: string; count: number }>();
	const counts: Record<string, number> = {};
	for (const row of slotCount.results ?? []) counts[row.phase] = row.count;
	// Public-read leniency: render the tournament detail even if the maps
	// JSON is corrupted (admins will see the failure surface via round
	// generation; no need to break the public-facing page). Admin write
	// paths still throw MAP_CONFIG_INVALID via parseAllowedMapsOrError.
	let allowed_map_scripts: string[];
	try {
		allowed_map_scripts = parseAllowedMaps(tournament);
	} catch (e) {
		if (!(e instanceof MapConfigError)) throw e;
		allowed_map_scripts = [];
	}
	return jsonResponse(
		{
			tournament_id: tournament.tournament_id,
			slug: tournament.slug,
			name: tournament.name,
			description: tournament.description,
			status: tournament.status,
			division_a_name: tournament.division_a_name,
			division_b_name: tournament.division_b_name,
			swiss_advance_count: tournament.swiss_advance_count,
			swiss_wins_to_advance: tournament.swiss_wins_to_advance,
			swiss_losses_to_eliminate: tournament.swiss_losses_to_eliminate,
			swiss_max_rounds: tournament.swiss_max_rounds,
			allowed_map_scripts,
			slot_counts: {
				swiss: counts["swiss"] ?? 0,
				championship: counts["championship"] ?? 0,
			},
			is_viewer_admin,
			created_at: tournament.created_at,
			updated_at: tournament.updated_at,
		},
		200,
		cors,
	);
}

// Setup-phase tournaments are admin-only. Centralised so every public
// read endpoint that exposes setup data (standings, bracket, rounds,
// matches, match detail) returns 404 — not 403 — to non-admins, to
// match the detail endpoint and avoid leaking tournament existence.
async function setupGateHides(
	env: TournamentPublicEnv,
	request: Request,
	tournament: TournamentRow,
): Promise<boolean> {
	if (tournament.status !== "setup") return false;
	const session = await sessionFromRequest(env, request);
	const isAdmin = await isTournamentAdmin(
		env,
		session?.data ?? null,
		tournament.tournament_id,
	);
	return !isAdmin;
}

export async function handleTournamentStandings(
	tournamentId: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament || (await setupGateHides(env, request, tournament))) {
		return errorResponse(
			"Tournament not found",
			404,
			cors,
			"TOURNAMENT_NOT_FOUND",
		);
	}
	const body = await computeStandingsResponse(env, tournament);
	return jsonResponse(body, 200, cors);
}

async function computeStandingsResponse(
	env: TournamentEnv,
	tournament: TournamentRow,
) {
	const slotRows = await loadSlots(env, tournament.tournament_id);
	const matchRowsAll = await loadMatchesWithRound(
		env,
		tournament.tournament_id,
	);
	const config = tournamentConfig(tournament);

	const swissSlots = slotRows.filter((s) => s.phase === "swiss");
	const swissMatches = matchRowsAll.filter((m) => m.round.phase === "swiss");
	const slotIdentity = new Map<
		string,
		{
			discord_username: string | null;
			user_id: string | null;
			swiss_seed: number | null;
		}
	>();
	for (const s of swissSlots) {
		slotIdentity.set(s.slot_id, {
			discord_username: s.discord_username,
			user_id: s.user_id,
			swiss_seed: s.swiss_seed,
		});
	}

	const byDivision: Record<
		"A" | "B",
		Array<
			RankedStanding & {
				discord_username: string | null;
				user_id: string | null;
				swiss_seed: number | null;
			}
		>
	> = {
		A: [],
		B: [],
	};
	for (const division of ["A", "B"] as const) {
		const divSlots = swissSlots
			.filter((s) => s.division === division)
			.map(slotRowToRef);
		const divMatches = swissMatches
			.filter((m) => m.round.division === division)
			.map((m) => matchRowToRef(m.match, m.round));
		const standings = computeStandings(divSlots, divMatches, config);
		const ranked = rankStandings(standings);
		const enriched = ranked.map((r) => ({
			...r,
			...(slotIdentity.get(r.slot_id) ?? {
				discord_username: null,
				user_id: null,
				swiss_seed: null,
			}),
		}));
		// Within a rank group, sort by swiss_seed asc for stable display
		// order. The rank itself isn't changed — this is purely cosmetic so
		// admin slot tables (and public standings during setup, when
		// everyone shares rank 1) show a consistent ordering.
		enriched.sort((a, b) => {
			if (a.rank !== b.rank) return a.rank - b.rank;
			return (a.swiss_seed ?? 0) - (b.swiss_seed ?? 0);
		});
		byDivision[division] = enriched;
	}
	return {
		tournament_id: tournament.tournament_id,
		divisions: {
			A: { name: tournament.division_a_name, standings: byDivision.A },
			B: { name: tournament.division_b_name, standings: byDivision.B },
		},
	};
}

export async function handleTournamentBracket(
	tournamentId: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament || (await setupGateHides(env, request, tournament))) {
		return errorResponse(
			"Tournament not found",
			404,
			cors,
			"TOURNAMENT_NOT_FOUND",
		);
	}

	const slots = await loadSlots(env, tournament.tournament_id);
	const rounds = await loadRounds(env, tournament.tournament_id);
	const matches = await loadMatches(env, tournament.tournament_id);

	const champSlots = slots.filter((s) => s.phase === "championship");
	const champRounds = rounds.filter((r) => r.phase === "championship");
	const matchesByRound = new Map<string, MatchRow[]>();
	for (const m of matches) {
		const list = matchesByRound.get(m.round_id) ?? [];
		list.push(m);
		matchesByRound.set(m.round_id, list);
	}

	const body = {
		tournament_id: tournament.tournament_id,
		slots: champSlots.map((s) => ({
			slot_id: s.slot_id,
			championship_seed: s.championship_seed,
			discord_username: s.discord_username,
			user_id: s.user_id,
		})),
		rounds: champRounds.map((r) => ({
			round_id: r.round_id,
			round_number: r.round_number,
			status: r.status,
			matches: (matchesByRound.get(r.round_id) ?? []).map(serializeMatch),
		})),
	};
	return jsonResponse(body, 200, cors);
}

export async function handleTournamentRounds(
	tournamentId: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament || (await setupGateHides(env, request, tournament))) {
		return errorResponse(
			"Tournament not found",
			404,
			cors,
			"TOURNAMENT_NOT_FOUND",
		);
	}
	const rounds = await loadRounds(env, tournament.tournament_id);
	return jsonResponse(
		{ tournament_id: tournament.tournament_id, rounds },
		200,
		cors,
	);
}

export async function handleTournamentMatches(
	tournamentId: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament || (await setupGateHides(env, request, tournament))) {
		return errorResponse(
			"Tournament not found",
			404,
			cors,
			"TOURNAMENT_NOT_FOUND",
		);
	}
	const url = new URL(request.url);
	const roundId = url.searchParams.get("round_id");
	const phase = url.searchParams.get("phase");
	const division = url.searchParams.get("division");
	const slotId = url.searchParams.get("slot_id");

	const matchesWithRound = await loadMatchesWithRound(
		env,
		tournament.tournament_id,
	);
	const filtered = matchesWithRound.filter(({ match, round }) => {
		if (roundId && round.round_id !== roundId) return false;
		if (phase && round.phase !== phase) return false;
		if (division && round.division !== division) return false;
		if (slotId && match.slot_a_id !== slotId && match.slot_b_id !== slotId)
			return false;
		return true;
	});

	return jsonResponse(
		{
			tournament_id: tournament.tournament_id,
			matches: filtered.map(({ match, round }) => ({
				...serializeMatch(match),
				round_id: round.round_id,
				round_number: round.round_number,
				phase: round.phase,
				division: round.division,
			})),
		},
		200,
		cors,
	);
}

export async function handleTournamentMatchDetail(
	tournamentId: string,
	matchId: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament || (await setupGateHides(env, request, tournament))) {
		return errorResponse(
			"Tournament not found",
			404,
			cors,
			"TOURNAMENT_NOT_FOUND",
		);
	}
	const match = await loadMatch(env, matchId);
	if (!match) {
		return errorResponse("Match not found", 404, cors, "MATCH_NOT_FOUND");
	}
	// Verify the match belongs to this tournament.
	const round = await env.SHARE_DB.prepare(
		"SELECT * FROM tournament_rounds WHERE round_id = ?",
	)
		.bind(match.round_id)
		.first<RoundRow>();
	if (!round || round.tournament_id !== tournament.tournament_id) {
		return errorResponse("Match not found", 404, cors, "MATCH_NOT_FOUND");
	}
	return jsonResponse(
		{
			...serializeMatch(match),
			round_id: round.round_id,
			round_number: round.round_number,
			phase: round.phase,
			division: round.division,
			tournament_id: tournament.tournament_id,
		},
		200,
		cors,
	);
}

// GET /v1/games/:game_id/tournament-link — returns the tournament+match
// pair if the game is linked, or null. Used by the /games/[id] page to
// render the "linked to tournament X" preTabs banner. Anonymous read.
export async function handleGameTournamentLink(
	gameId: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const row = await env.SHARE_DB.prepare(
		`SELECT m.match_id, m.slot_a_id, m.slot_b_id, m.status, m.winner_slot_id,
		        m.map_script,
		        r.round_number, r.phase, r.division,
		        t.tournament_id, t.slug, t.name, t.status AS tournament_status
		 FROM tournament_matches m
		 JOIN tournament_rounds r ON r.round_id = m.round_id
		 JOIN tournaments t ON t.tournament_id = r.tournament_id
		 WHERE m.game_id = ?
		 LIMIT 1`,
	)
		.bind(gameId)
		.first<{
			match_id: string;
			slot_a_id: string;
			slot_b_id: string | null;
			status: string;
			winner_slot_id: string | null;
			map_script: string | null;
			round_number: number;
			phase: string;
			division: string | null;
			tournament_id: string;
			slug: string;
			name: string;
			tournament_status: string;
		}>();
	if (!row) {
		return jsonResponse({ link: null }, 200, cors);
	}
	// Pull slot identity for both slots so the frontend can render names
	// without a second roundtrip.
	const slots = await env.SHARE_DB.prepare(
		`SELECT slot_id, discord_username FROM tournament_slots
		 WHERE slot_id = ? OR slot_id = ?`,
	)
		.bind(row.slot_a_id, row.slot_b_id ?? row.slot_a_id)
		.all<{ slot_id: string; discord_username: string | null }>();
	const usernameById = new Map<string, string | null>();
	for (const s of slots.results ?? []) {
		usernameById.set(s.slot_id, s.discord_username);
	}
	return jsonResponse(
		{
			link: {
				tournament: {
					tournament_id: row.tournament_id,
					slug: row.slug,
					name: row.name,
					status: row.tournament_status,
				},
				match: {
					match_id: row.match_id,
					phase: row.phase,
					division: row.division,
					round_number: row.round_number,
					map_script: row.map_script,
					status: row.status,
					slot_a_id: row.slot_a_id,
					slot_b_id: row.slot_b_id,
					winner_slot_id: row.winner_slot_id,
					slot_a_username: usernameById.get(row.slot_a_id) ?? null,
					slot_b_username: row.slot_b_id
						? (usernameById.get(row.slot_b_id) ?? null)
						: null,
				},
			},
		},
		200,
		cors,
	);
}

function serializeMatch(m: MatchRow) {
	return {
		match_id: m.match_id,
		slot_a_id: m.slot_a_id,
		slot_b_id: m.slot_b_id,
		map_script: m.map_script,
		pick_order_winner_slot_id: m.pick_order_winner_slot_id,
		status: m.status,
		winner_slot_id: m.winner_slot_id,
		game_id: m.game_id,
		reported_by_user_id: m.reported_by_user_id,
		reported_at: m.reported_at,
		notes: m.notes,
	};
}

interface MatchWithRound {
	match: MatchRow;
	round: RoundRow;
}

async function loadMatchesWithRound(
	env: TournamentEnv,
	tournamentId: string,
): Promise<MatchWithRound[]> {
	const res = await env.SHARE_DB.prepare(
		`SELECT
		   m.match_id, m.round_id, m.slot_a_id, m.slot_b_id, m.map_script,
		   m.pick_order_winner_slot_id, m.status, m.winner_slot_id, m.game_id,
		   m.reported_by_user_id, m.reported_at, m.notes,
		   m.slot_a_player_index, m.slot_b_player_index, m.match_index,
		   m.created_at,
		   r.tournament_id, r.phase, r.division, r.round_number,
		   r.status AS round_status,
		   r.generated_at, r.started_at, r.completed_at
		 FROM tournament_matches m
		 JOIN tournament_rounds r ON r.round_id = m.round_id
		 WHERE r.tournament_id = ?
		 ORDER BY r.phase, r.division, r.round_number, m.match_index, m.created_at`,
	)
		.bind(tournamentId)
		.all<MatchRow & RoundRow & { round_status: RoundRow["status"] }>();
	return (res.results ?? []).map((row) => ({
		match: {
			match_id: row.match_id,
			round_id: row.round_id,
			slot_a_id: row.slot_a_id,
			slot_b_id: row.slot_b_id,
			map_script: row.map_script,
			pick_order_winner_slot_id: row.pick_order_winner_slot_id,
			status: row.status,
			winner_slot_id: row.winner_slot_id,
			game_id: row.game_id,
			reported_by_user_id: row.reported_by_user_id,
			reported_at: row.reported_at,
			notes: row.notes,
			slot_a_player_index: row.slot_a_player_index,
			slot_b_player_index: row.slot_b_player_index,
			match_index: row.match_index,
			created_at: row.created_at,
		},
		round: {
			round_id: row.round_id,
			tournament_id: row.tournament_id,
			phase: row.phase,
			division: row.division,
			round_number: row.round_number,
			status: row.round_status,
			generated_at: row.generated_at,
			started_at: row.started_at,
			completed_at: row.completed_at,
		},
	}));
}

function clampInt(
	raw: string | null,
	fallback: number,
	min: number,
	max: number,
): number {
	if (raw === null) return fallback;
	const n = parseInt(raw, 10);
	if (Number.isNaN(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

export { loadMatchesWithRound };
