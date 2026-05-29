// Public-shaped tournament handlers. During the private beta these all
// require both a session and a tournament_beta_users row — anon callers
// and non-beta callers get a 404 via requireBetaOr404. The "public" label
// is preserved because the handlers don't gate on per-tournament roles;
// once the beta lifts, removing requireBetaOr404 from each handler
// restores anonymous access.

import { buildAvatarUrl } from "../auth";
import { sessionFromRequest, type SessionData } from "../session";
import {
	cloudCorsHeaders,
	errorResponse,
	getClientIp,
	jsonResponse,
} from "../util";
import { countEventsSince, isScraperUA } from "../games";
import { logError } from "../log";
import { AuthzError, isTournamentAdmin, requireTournamentBeta } from "./authz";
import {
	loadMatch,
	loadMatches,
	loadRounds,
	loadSlots,
	loadTournamentById,
	loadTournamentBySlug,
	MapConfigError,
	matchRowToRef,
	parseMapPool,
	slotAvatarUrl,
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

// Tournament beta gate. Resolves the session, runs requireTournamentBeta,
// and translates an AuthzError into the standard error response so every
// handler can early-return on a single line. Returns the session on the
// happy path (saves the caller a second sessionFromRequest call when the
// handler needs the session anyway, e.g. to compute is_viewer_admin).
async function requireBetaOr404(
	env: TournamentPublicEnv,
	request: Request,
	cors: Record<string, string>,
): Promise<
	| { ok: true; session: { token: string; data: SessionData } | null }
	| { ok: false; response: Response }
> {
	const session = await sessionFromRequest(env, request);
	try {
		await requireTournamentBeta(env, session?.data ?? null);
	} catch (e) {
		if (e instanceof AuthzError) {
			return {
				ok: false,
				response: errorResponse(e.message, e.status, cors, e.code),
			};
		}
		throw e;
	}
	return { ok: true, session };
}

export async function handleTournamentList(
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const gate = await requireBetaOr404(env, request, cors);
	if (!gate.ok) return gate.response;
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
	const session = gate.session;
	const viewerId = session?.data.user_id ?? null;

	const params: unknown[] = [viewerId];
	// Setup-phase tournaments are visible to:
	//   1. admins of that tournament (ta.user_id IS NOT NULL), or
	//   2. anyone, when the admin has opened signups (t.signups_open = 1).
	// All non-setup statuses are always visible to any beta user.
	let whereSetup =
		"(t.status != 'setup' OR ta.user_id IS NOT NULL OR t.signups_open = 1)";
	if (filter) {
		whereSetup += " AND t.status = ?";
		params.push(filter);
	}
	params.push(limit, offset);

	const stmt = env.SHARE_DB.prepare(
		`SELECT t.tournament_id, t.slug, t.name, t.status, t.signups_open,
		        t.created_at, t.updated_at,
		        t.swiss_wins_to_advance, t.swiss_losses_to_eliminate,
		        t.swiss_max_rounds, t.map_pool
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
		signups_open: number;
		created_at: string;
		updated_at: string;
		swiss_wins_to_advance: number;
		swiss_losses_to_eliminate: number;
		swiss_max_rounds: number;
		map_pool: string;
	}>();

	const baseRows = res.results ?? [];
	const ids = baseRows.map((r) => r.tournament_id);
	const aggregates = await loadListAggregates(env, ids);

	// Normalize SQLite's INTEGER 0/1 to a boolean for the JSON response so
	// the frontend can treat it as a plain bool. Map pool size is derived
	// from the JSON column at the worker so the client doesn't have to
	// re-parse it just to count entries.
	const tournaments = baseRows.map((t) => {
		let mapPoolSize = 0;
		try {
			const parsed = JSON.parse(t.map_pool);
			if (Array.isArray(parsed)) mapPoolSize = parsed.length;
		} catch {
			// Tournament with corrupt JSON shows zero — same leniency the
			// detail handler applies to map_pool.
		}
		const slotCounts = aggregates.slotCounts.get(t.tournament_id) ?? {
			swiss: 0,
			championship: 0,
		};
		// Player count reflects the phase the tournament is currently in:
		//   - championship/complete → bracket size
		//   - setup/swiss → signed-up swiss roster
		const playerCount =
			t.status === "championship" || t.status === "complete"
				? slotCounts.championship || slotCounts.swiss
				: slotCounts.swiss;
		return {
			tournament_id: t.tournament_id,
			slug: t.slug,
			name: t.name,
			status: t.status,
			signups_open: t.signups_open === 1,
			created_at: t.created_at,
			updated_at: t.updated_at,
			swiss_wins_to_advance: t.swiss_wins_to_advance,
			swiss_losses_to_eliminate: t.swiss_losses_to_eliminate,
			swiss_max_rounds: t.swiss_max_rounds,
			map_pool_size: mapPoolSize,
			player_count: playerCount,
			active_round: aggregates.activeRounds.get(t.tournament_id) ?? null,
			champion: aggregates.champions.get(t.tournament_id) ?? null,
		};
	});

	return jsonResponse({ tournaments, limit, offset }, 200, cors);
}

interface ListAggregates {
	slotCounts: Map<string, { swiss: number; championship: number }>;
	activeRounds: Map<
		string,
		{ round_number: number; matches_total: number; matches_reported: number }
	>;
	champions: Map<string, { display_name: string; avatar_url: string | null }>;
}

// Fan out batched aggregates for the listed tournaments. Bounded by
// LIST_LIMIT_MAX (100) so the IN (...) expansions stay safe; each query
// hits an existing index on tournament_id. Issued in parallel since none
// of them depend on each other.
async function loadListAggregates(
	env: TournamentPublicEnv,
	ids: string[],
): Promise<ListAggregates> {
	if (ids.length === 0) {
		return {
			slotCounts: new Map(),
			activeRounds: new Map(),
			champions: new Map(),
		};
	}
	const placeholders = ids.map(() => "?").join(",");

	const [slotsRes, roundsRes, championsRes] = await Promise.all([
		env.SHARE_DB.prepare(
			`SELECT tournament_id, phase, COUNT(*) AS count
			 FROM tournament_slots
			 WHERE tournament_id IN (${placeholders})
			 GROUP BY tournament_id, phase`,
		)
			.bind(...ids)
			.all<{ tournament_id: string; phase: string; count: number }>(),
		// "Active round" = the highest-numbered round in the tournament's
		// current phase (whatever phase the tournament's status names). For
		// swiss this aggregates across divisions A+B; the client renders a
		// single counter rather than separate per-division progress.
		env.SHARE_DB.prepare(
			`SELECT r.tournament_id,
			        r.round_number,
			        COUNT(m.match_id) AS matches_total,
			        SUM(CASE WHEN m.status != 'pending' THEN 1 ELSE 0 END) AS matches_reported
			 FROM tournament_rounds r
			 JOIN tournaments t ON t.tournament_id = r.tournament_id
			 LEFT JOIN tournament_matches m ON m.round_id = r.round_id
			 WHERE r.tournament_id IN (${placeholders})
			   AND t.status IN ('swiss','championship')
			   AND r.phase = t.status
			   AND r.round_number = (
			     SELECT MAX(round_number) FROM tournament_rounds r2
			     WHERE r2.tournament_id = r.tournament_id AND r2.phase = t.status
			   )
			 GROUP BY r.tournament_id, r.round_number`,
		)
			.bind(...ids)
			.all<{
				tournament_id: string;
				round_number: number;
				matches_total: number;
				matches_reported: number;
			}>(),
		// Champion = the winner of the final championship match (the round
		// with the highest round_number where status='complete' and exactly
		// one match exists). Joining through tournament_slots → users picks
		// up the Discord display_name + avatar for the card. Slots whose
		// user_id is still null (admin-set but unclaimed) fall back to the
		// stored discord_username and have no avatar. avatar_url is built in
		// JS from (discord_id, avatar_hash) since the column isn't stored.
		env.SHARE_DB.prepare(
			`SELECT r.tournament_id,
			        COALESCE(u.display_name, s.discord_username) AS display_name,
			        u.discord_id,
			        u.avatar_hash
			 FROM tournament_rounds r
			 JOIN tournaments t ON t.tournament_id = r.tournament_id
			 JOIN tournament_matches m ON m.round_id = r.round_id
			   AND m.winner_slot_id IS NOT NULL
			 JOIN tournament_slots s ON s.slot_id = m.winner_slot_id
			 LEFT JOIN users u ON u.user_id = s.user_id
			 WHERE r.tournament_id IN (${placeholders})
			   AND t.status = 'complete'
			   AND r.phase = 'championship'
			   AND r.round_number = (
			     SELECT MAX(round_number) FROM tournament_rounds r2
			     WHERE r2.tournament_id = r.tournament_id AND r2.phase = 'championship'
			   )`,
		)
			.bind(...ids)
			.all<{
				tournament_id: string;
				display_name: string | null;
				discord_id: string | null;
				avatar_hash: string | null;
			}>(),
	]);

	const slotCounts = new Map<string, { swiss: number; championship: number }>();
	for (const row of slotsRes.results ?? []) {
		const entry = slotCounts.get(row.tournament_id) ?? {
			swiss: 0,
			championship: 0,
		};
		if (row.phase === "swiss") entry.swiss = row.count;
		else if (row.phase === "championship") entry.championship = row.count;
		slotCounts.set(row.tournament_id, entry);
	}

	const activeRounds = new Map<
		string,
		{ round_number: number; matches_total: number; matches_reported: number }
	>();
	for (const row of roundsRes.results ?? []) {
		activeRounds.set(row.tournament_id, {
			round_number: row.round_number,
			matches_total: row.matches_total ?? 0,
			matches_reported: row.matches_reported ?? 0,
		});
	}

	const champions = new Map<
		string,
		{ display_name: string; avatar_url: string | null }
	>();
	for (const row of championsRes.results ?? []) {
		if (!row.display_name) continue;
		// Build the avatar URL only when we have a Discord ID (i.e., the
		// winner's slot has been claimed by a logged-in user). Unclaimed
		// slots fall back to the stored discord_username with no avatar.
		const avatar_url = row.discord_id
			? buildAvatarUrl(row.discord_id, row.avatar_hash)
			: null;
		champions.set(row.tournament_id, {
			display_name: row.display_name,
			avatar_url,
		});
	}

	return { slotCounts, activeRounds, champions };
}

export async function handleTournamentDetail(
	slug: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const gate = await requireBetaOr404(env, request, cors);
	if (!gate.ok) return gate.response;
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
	// without a second round-trip. Always backed by the gate-resolved
	// session — anon callers can't reach here once the beta gate is on,
	// but the null branch is preserved for the post-beta world.
	const is_viewer_admin = await isTournamentAdmin(
		env,
		gate.session?.data ?? null,
		tournament.tournament_id,
	);
	// Setup-phase tournaments are admin-only by default, but also visible to
	// any beta user once the admin opens signups — that's the whole point of
	// the toggle.
	if (
		tournament.status === "setup" &&
		!is_viewer_admin &&
		tournament.signups_open !== 1
	) {
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
	// Per-division swiss counts for the signup modal's "Division A (5 players)"
	// hint. Cheap aggregate; cheaper than a second round-trip from the
	// frontend once we've already loaded the tournament here.
	const divisionCounts = await env.SHARE_DB.prepare(
		`SELECT division, COUNT(*) AS count
		 FROM tournament_slots
		 WHERE tournament_id = ? AND phase = 'swiss'
		 GROUP BY division`,
	)
		.bind(tournament.tournament_id)
		.all<{ division: string; count: number }>();
	const swissByDivision: { A: number; B: number } = { A: 0, B: 0 };
	for (const row of divisionCounts.results ?? []) {
		if (row.division === "A" || row.division === "B") {
			swissByDivision[row.division] = row.count;
		}
	}
	// Viewer's swiss slot in this tournament (if any). Drives the "you're
	// signed up — Division A" strip on the detail page and the Sign up /
	// Withdraw button choice. Skipped when there's no session.
	const viewerUserId = gate.session?.data.user_id ?? null;
	let viewer_slot: {
		slot_id: string;
		division: "A" | "B";
		swiss_seed: number;
	} | null = null;
	if (viewerUserId) {
		const vs = await env.SHARE_DB.prepare(
			`SELECT slot_id, division, swiss_seed
			 FROM tournament_slots
			 WHERE tournament_id = ? AND user_id = ? AND phase = 'swiss'
			 LIMIT 1`,
		)
			.bind(tournament.tournament_id, viewerUserId)
			.first<{
				slot_id: string;
				division: "A" | "B" | null;
				swiss_seed: number | null;
			}>();
		if (
			vs &&
			(vs.division === "A" || vs.division === "B") &&
			vs.swiss_seed != null
		) {
			viewer_slot = {
				slot_id: vs.slot_id,
				division: vs.division,
				swiss_seed: vs.swiss_seed,
			};
		}
	}
	// Admin roster for the header's meta strip. The creator is inserted into
	// tournament_admins at create time, so the earliest granted_at row is the
	// owner; any later rows are co-admins added afterward. (user_id ASC is a
	// deterministic tiebreaker for the degenerate same-second case.) Joined to
	// users for display_name + avatar — both always present (display_name is
	// NOT NULL; discord_id always yields a buildAvatarUrl result).
	const adminRows = await env.SHARE_DB.prepare(
		`SELECT u.display_name, u.discord_id, u.avatar_hash
		 FROM tournament_admins ta
		 JOIN users u ON u.user_id = ta.user_id
		 WHERE ta.tournament_id = ?
		 ORDER BY ta.granted_at ASC, ta.user_id ASC`,
	)
		.bind(tournament.tournament_id)
		.all<{
			display_name: string;
			discord_id: string;
			avatar_hash: string | null;
		}>();
	const adminList = (adminRows.results ?? []).map((r) => ({
		display_name: r.display_name,
		avatar_url: buildAvatarUrl(r.discord_id, r.avatar_hash),
	}));
	const owner = adminList[0] ?? null;
	const admins = adminList.slice(1);

	// Public-read leniency: render the tournament detail even if the map_pool
	// JSON is corrupted (admins will see the failure surface via round
	// generation; no need to break the public-facing page). Admin write
	// paths still throw MAP_CONFIG_INVALID via parseMapPoolOrError.
	let map_pool: ReturnType<typeof parseMapPool>;
	try {
		map_pool = parseMapPool(tournament);
	} catch (e) {
		if (!(e instanceof MapConfigError)) throw e;
		map_pool = [];
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
			swiss_wins_to_advance: tournament.swiss_wins_to_advance,
			swiss_losses_to_eliminate: tournament.swiss_losses_to_eliminate,
			swiss_max_rounds: tournament.swiss_max_rounds,
			map_pool,
			slot_counts: {
				swiss: counts["swiss"] ?? 0,
				championship: counts["championship"] ?? 0,
				swiss_by_division: swissByDivision,
			},
			signups_open: tournament.signups_open === 1,
			signup_question: tournament.signup_question,
			viewer_slot,
			is_viewer_admin,
			// Whether the viewer is the tournament's creator. Combined with the
			// global is_admin flag on the frontend's user object, this gates the
			// in-app delete button (the server delete handler authorizes the same
			// creator-or-site-admin pair independently).
			is_viewer_creator:
				viewerUserId != null && viewerUserId === tournament.created_by_user_id,
			owner,
			admins,
			starts_at: tournament.starts_at,
			completed_at: tournament.completed_at,
			created_at: tournament.created_at,
			updated_at: tournament.updated_at,
		},
		200,
		cors,
	);
}

// Setup-phase tournaments are admin-only by default — every public read
// endpoint that exposes setup data (standings, bracket, rounds, matches,
// match detail) returns 404 (not 403) to non-admins so we don't leak the
// tournament's existence.
//
// Exception: when signups_open=1, the tournament is visible to every beta
// user (the whole point of the toggle). The companion endpoints return
// effectively-empty payloads in setup (no rounds → no standings → no
// matches), but the page load on /tournaments/[slug] expects them not to
// 404, so we mirror the detail-endpoint predicate here.
//
// Callers pass the session they already resolved via requireBetaOr404 so
// the lookup is done once per request.
async function setupGateHides(
	env: TournamentPublicEnv,
	session: { token: string; data: SessionData } | null,
	tournament: TournamentRow,
): Promise<boolean> {
	if (tournament.status !== "setup") return false;
	if (tournament.signups_open === 1) return false;
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
	const gate = await requireBetaOr404(env, request, cors);
	if (!gate.ok) return gate.response;
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament || (await setupGateHides(env, gate.session, tournament))) {
		return errorResponse(
			"Tournament not found",
			404,
			cors,
			"TOURNAMENT_NOT_FOUND",
		);
	}
	// Signup answers are admin-only — they're collected for the admin's
	// scheduling use, not for public display alongside the standings.
	const viewerIsAdmin = await isTournamentAdmin(
		env,
		gate.session?.data ?? null,
		tournament.tournament_id,
	);
	const body = await computeStandingsResponse(env, tournament, viewerIsAdmin);
	return jsonResponse(body, 200, cors);
}

async function computeStandingsResponse(
	env: TournamentEnv,
	tournament: TournamentRow,
	viewerIsAdmin: boolean,
) {
	const slotRows = await loadSlots(env, tournament.tournament_id);
	const matchRowsAll = await loadMatchesWithRound(
		env,
		tournament.tournament_id,
	);
	const config = tournamentConfig(tournament);

	const swissSlots = slotRows.filter((s) => s.phase === "swiss");
	const swissMatches = matchRowsAll.filter((m) => m.round.phase === "swiss");
	const swissMatchRefs = swissMatches.map((m) =>
		matchRowToRef(m.match, m.round),
	);
	const slotIdentity = new Map<
		string,
		{
			discord_username: string | null;
			user_id: string | null;
			avatar_url: string | null;
			swiss_seed: number | null;
			division: "A" | "B" | null;
			signup_answer: string | null;
		}
	>();
	for (const s of swissSlots) {
		slotIdentity.set(s.slot_id, {
			discord_username: s.discord_username,
			user_id: s.user_id,
			avatar_url: slotAvatarUrl(s),
			swiss_seed: s.swiss_seed,
			division: s.division,
			// Admin-only — omitted for non-admin viewers so signup answers don't
			// leak into the public standings payload.
			signup_answer: viewerIsAdmin ? s.signup_answer : null,
		});
	}

	const byDivision: Record<
		"A" | "B",
		Array<
			RankedStanding & {
				discord_username: string | null;
				user_id: string | null;
				avatar_url: string | null;
				swiss_seed: number | null;
				signup_answer: string | null;
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
		const divMatches = swissMatchRefs.filter((m) => m.division === division);
		const standings = computeStandings(divSlots, divMatches, config);
		const ranked = rankStandings(standings, divMatches);
		const enriched = ranked.map((r) => {
			const id = slotIdentity.get(r.slot_id) ?? {
				discord_username: null,
				user_id: null,
				avatar_url: null,
				swiss_seed: null,
				division: null,
				signup_answer: null,
			};
			// Strip `division` — division grouping is communicated by the
			// containing key in the response, not by a per-row field. The
			// combined_qualifier_ranking attaches division per row separately.
			const { division: _div, ...identity } = id;
			void _div;
			return { ...r, ...identity };
		});
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

	// Combined qualifier preview: only meaningful from swiss-phase onward.
	// For setup-phase tournaments there are no matches yet, so the cascade
	// is degenerate. Skip the field entirely until status='swiss'.
	let combined_qualifier_ranking:
		| Array<{
				slot_id: string;
				rank: number;
				wins: number;
				losses: number;
				status: "active" | "advanced" | "eliminated";
				h2h: number;
				buchholz_cut1: number;
				opponents_buchholz: number;
				cumulative: number;
				division: "A" | "B" | null;
				discord_username: string | null;
				avatar_url: string | null;
				swiss_seed: number | null;
		  }>
		| undefined = undefined;
	if (tournament.status !== "setup") {
		const allSwissSlotRefs = swissSlots.map(slotRowToRef);
		const standings = computeStandings(
			allSwissSlotRefs,
			swissMatchRefs,
			config,
		);
		const ranked = rankStandings(standings, swissMatchRefs);
		combined_qualifier_ranking = ranked.map((r) => {
			const id = slotIdentity.get(r.slot_id);
			return {
				slot_id: r.slot_id,
				rank: r.rank,
				wins: r.wins,
				losses: r.losses,
				status: r.status,
				h2h: r.h2h,
				buchholz_cut1: r.buchholz_cut1,
				opponents_buchholz: r.opponents_buchholz,
				cumulative: r.cumulative,
				division: id?.division ?? null,
				discord_username: id?.discord_username ?? null,
				avatar_url: id?.avatar_url ?? null,
				swiss_seed: id?.swiss_seed ?? null,
			};
		});
	}

	return {
		tournament_id: tournament.tournament_id,
		divisions: {
			A: { name: tournament.division_a_name, standings: byDivision.A },
			B: { name: tournament.division_b_name, standings: byDivision.B },
		},
		combined_qualifier_ranking,
	};
}

export async function handleTournamentBracket(
	tournamentId: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const gate = await requireBetaOr404(env, request, cors);
	if (!gate.ok) return gate.response;
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament || (await setupGateHides(env, gate.session, tournament))) {
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

	// Linked-game turn counts for matches that have a reported game. The
	// complete-tournament header renders "won the final … in N turns" off the
	// championship final's count; one batched lookup covers every match here.
	const gameIds = [
		...new Set(
			matches.map((m) => m.game_id).filter((id): id is string => id !== null),
		),
	];
	const turnsByGame = new Map<string, number>();
	if (gameIds.length > 0) {
		const res = await env.SHARE_DB.prepare(
			`SELECT game_id, total_turns FROM games
			 WHERE game_id IN (${gameIds.map(() => "?").join(",")})`,
		)
			.bind(...gameIds)
			.all<{ game_id: string; total_turns: number }>();
		for (const row of res.results ?? []) {
			turnsByGame.set(row.game_id, row.total_turns);
		}
	}

	const avatarByUserId = await loadHistoricalAvatarsForMatches(env, matches);

	const body = {
		tournament_id: tournament.tournament_id,
		slots: champSlots.map((s) => ({
			slot_id: s.slot_id,
			championship_seed: s.championship_seed,
			discord_username: s.discord_username,
			user_id: s.user_id,
			avatar_url: slotAvatarUrl(s),
		})),
		rounds: champRounds.map((r) => ({
			round_id: r.round_id,
			round_number: r.round_number,
			status: r.status,
			matches: (matchesByRound.get(r.round_id) ?? []).map((m) => ({
				...serializeMatch(m, avatarByUserId),
				total_turns: m.game_id ? (turnsByGame.get(m.game_id) ?? null) : null,
			})),
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
	const gate = await requireBetaOr404(env, request, cors);
	if (!gate.ok) return gate.response;
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament || (await setupGateHides(env, gate.session, tournament))) {
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
	const gate = await requireBetaOr404(env, request, cors);
	if (!gate.ok) return gate.response;
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament || (await setupGateHides(env, gate.session, tournament))) {
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

	const avatarByUserId = await loadHistoricalAvatarsForMatches(
		env,
		filtered.map(({ match }) => match),
	);

	return jsonResponse(
		{
			tournament_id: tournament.tournament_id,
			matches: filtered.map(({ match, round }) => ({
				...serializeMatch(match, avatarByUserId),
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
	const gate = await requireBetaOr404(env, request, cors);
	if (!gate.ok) return gate.response;
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament || (await setupGateHides(env, gate.session, tournament))) {
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
	const avatarByUserId = await loadHistoricalAvatarsForMatches(env, [match]);
	return jsonResponse(
		{
			...serializeMatch(match, avatarByUserId),
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
// render the "linked to tournament X" preTabs banner. Beta-gated like the
// rest of the tournament surface so non-beta viewers of a tournament-linked
// game don't see a link they can't follow.
export async function handleGameTournamentLink(
	gameId: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const gate = await requireBetaOr404(env, request, cors);
	if (!gate.ok) return gate.response;
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

function serializeMatch(
	m: MatchRow,
	avatarByUserId?: Map<string, string | null>,
) {
	const slotAAvatar =
		m.slot_a_user_id && avatarByUserId
			? (avatarByUserId.get(m.slot_a_user_id) ?? null)
			: null;
	const slotBAvatar =
		m.slot_b_user_id && avatarByUserId
			? (avatarByUserId.get(m.slot_b_user_id) ?? null)
			: null;
	return {
		match_id: m.match_id,
		slot_a_id: m.slot_a_id,
		slot_b_id: m.slot_b_id,
		map_pool_id: m.map_pool_id,
		map_script: m.map_script,
		pick_order_winner_slot_id: m.pick_order_winner_slot_id,
		status: m.status,
		winner_slot_id: m.winner_slot_id,
		game_id: m.game_id,
		reported_by_user_id: m.reported_by_user_id,
		reported_at: m.reported_at,
		notes: m.notes,
		slot_a_username: m.slot_a_username,
		slot_a_user_id: m.slot_a_user_id,
		slot_a_avatar_url: slotAAvatar,
		slot_b_username: m.slot_b_username,
		slot_b_user_id: m.slot_b_user_id,
		slot_b_avatar_url: slotBAvatar,
	};
}

// Resolve avatar URLs for every distinct snapshot user_id referenced by the
// supplied matches. One batched SELECT per call. Returns a Map keyed by
// user_id; missing rows or NULL discord_id map to null (placeholder avatar
// on the client). For pending matches (snapshot user_ids are NULL) callers
// can pass an empty match list — no users → no query.
async function loadHistoricalAvatarsForMatches(
	env: TournamentEnv,
	matches: MatchRow[],
): Promise<Map<string, string | null>> {
	const userIds = new Set<string>();
	for (const m of matches) {
		if (m.slot_a_user_id) userIds.add(m.slot_a_user_id);
		if (m.slot_b_user_id) userIds.add(m.slot_b_user_id);
	}
	const map = new Map<string, string | null>();
	if (userIds.size === 0) return map;
	const ids = [...userIds];
	const placeholders = ids.map(() => "?").join(",");
	const res = await env.SHARE_DB.prepare(
		`SELECT user_id, discord_id, avatar_hash FROM users WHERE user_id IN (${placeholders})`,
	)
		.bind(...ids)
		.all<{
			user_id: string;
			discord_id: string | null;
			avatar_hash: string | null;
		}>();
	for (const row of res.results ?? []) {
		map.set(
			row.user_id,
			row.discord_id ? buildAvatarUrl(row.discord_id, row.avatar_hash) : null,
		);
	}
	return map;
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
		   m.match_id, m.round_id, m.slot_a_id, m.slot_b_id, m.map_pool_id, m.map_script,
		   m.pick_order_winner_slot_id, m.status, m.winner_slot_id, m.game_id,
		   m.reported_by_user_id, m.reported_at, m.notes,
		   m.slot_a_player_index, m.slot_b_player_index, m.match_index,
		   m.slot_a_username, m.slot_a_user_id, m.slot_b_username, m.slot_b_user_id,
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
			map_pool_id: row.map_pool_id,
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
			slot_a_username: row.slot_a_username,
			slot_a_user_id: row.slot_a_user_id,
			slot_b_username: row.slot_b_username,
			slot_b_user_id: row.slot_b_user_id,
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
