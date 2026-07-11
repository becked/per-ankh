// Public-shaped tournament handlers — open to anyone, including anonymous
// callers (no session). They don't gate on per-tournament roles; reads are
// rate-limited per IP via enforceTournamentViewRateLimit. Setup-phase
// tournaments stay admin-only unless signups_open=1 (see setupGateHides).

import { buildAvatarUrl } from "../auth";
import { displayNameSql } from "../identity";
import {
	sessionFromRequest,
	type SessionData,
	type SessionEnv,
} from "../session";
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
	parseLinks,
	parseMapPool,
	parseParts,
	slotAvatarUrl,
	slotDisplayName,
	slotRowToRef,
	tournamentConfig,
	type MatchPart,
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
import {
	computeCasterLeaderboard,
	computePlayerPicks,
	type PickSummary,
} from "./stats";
import { CURRENT_PARSER_VERSION } from "../schemas/game";
import { buildChartBundle, chunk, CHUNK_SIZE } from "../stats/aggregate";
import { getCached, putCached } from "../stats/cache";
import { resolveTournamentCorpus } from "../stats/resolve";
import type { ChartBundleCore } from "../stats/types";
import { getVideosCached } from "../video/cache";
import {
	fetchYouTubePlaylistVideos,
	parseYouTubePlaylistUrl,
} from "../video/youtube";
import type { PlaylistVideo } from "../video/types";

export interface TournamentPublicEnv extends TournamentEnv, SessionEnv {
	ALLOWED_ORIGINS: string;
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
	const session = await sessionFromRequest(env, request);
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
	const viewerId = session?.data.user_id ?? null;

	const params: unknown[] = [viewerId];
	// Setup-phase tournaments are visible to:
	//   1. admins of that tournament (ta.user_id IS NOT NULL), or
	//   2. anyone, when the admin has opened signups (t.signups_open = 1).
	// All non-setup statuses are always publicly visible.
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
			        COALESCE(${displayNameSql("u")}, s.discord_username) AS display_name,
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
	const session = await sessionFromRequest(env, request);
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
	// without a second round-trip. session is null for anonymous viewers
	// (public reads), so isTournamentAdmin resolves false for them.
	const is_viewer_admin = await isTournamentAdmin(
		env,
		session?.data ?? null,
		tournament.tournament_id,
	);
	// Setup-phase tournaments are admin-only by default, but also visible to
	// anyone once the admin opens signups — that's the whole point of
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
	const viewerUserId = session?.data.user_id ?? null;
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
		`SELECT ${displayNameSql("u")} AS display_name, u.discord_id, u.avatar_hash
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
	// Links parse leniently (never throws), so no try/catch needed.
	const links = parseLinks(tournament);
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
			links,
			slot_counts: {
				swiss: counts["swiss"] ?? 0,
				championship: counts["championship"] ?? 0,
				swiss_by_division: swissByDivision,
			},
			signups_open: tournament.signups_open === 1,
			signup_question: tournament.signup_question,
			// The raw admin-set playlist URL (public — it drives a public tab).
			// Null hides the Videos tab; the videos themselves come from the
			// separate /videos read.
			youtube_playlist_url: tournament.youtube_playlist_url,
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

// GET /v1/tournaments/:id/videos — public. The uploads from the tournament's
// admin-set YouTube playlist, newest first, KV-cached (SWR) like the profile
// videos read. Same view gate + rate-limit as the other per-tournament reads.
// Returns an empty list when no playlist is configured (or a stored value that
// no longer parses) — the Videos tab is normally hidden in that case, but a
// direct visit still gets a clean empty payload rather than an error.
export async function handleTournamentPlaylistVideos(
	tournamentId: string,
	request: Request,
	env: TournamentPublicEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	const tournament = await loadViewableTournament(
		env,
		request,
		tournamentId,
		cors,
		session,
	);
	if (tournament instanceof Response) return tournament;
	const parsed = tournament.youtube_playlist_url
		? parseYouTubePlaylistUrl(tournament.youtube_playlist_url)
		: null;
	if (!parsed) return jsonResponse({ videos: [] }, 200, cors);
	const videos = await getVideosCached(
		env,
		"youtube",
		`playlist:${parsed.playlistId}`,
		() => fetchYouTubePlaylistVideos(parsed.playlistId),
		ctx,
	);
	// Attribute each video's uploader. A channel a Per-Ankh user has linked (via
	// user_video_channels) renders with that user's Discord identity — the same
	// shape as the home creator feed; unmatched uploaders fall back to the raw
	// YouTube channel name + URL (no avatar, no profile link).
	const usersByChannel = await loadPlaylistUploaders(env, videos);
	const attributed = videos.map((v) => {
		const base = {
			id: v.id,
			title: v.title,
			url: v.url,
			thumbnail_url: v.thumbnail_url,
			published_at: v.published_at,
			platform: v.platform,
		};
		const user = v.uploader_channel_id
			? usersByChannel.get(v.uploader_channel_id)
			: undefined;
		if (user) return { ...base, ...user };
		if (v.uploader_channel_id && v.uploader_name) {
			return {
				...base,
				uploader_name: v.uploader_name,
				uploader_url: `https://www.youtube.com/channel/${v.uploader_channel_id}`,
			};
		}
		return base;
	});
	return jsonResponse({ videos: attributed }, 200, cors);
}

interface PlaylistUploader {
	user_id: string;
	display_name: string;
	avatar_url: string;
}

// Map each distinct uploading channel in a playlist to the Per-Ankh user who
// linked it (user_video_channels), so matched uploads get Discord identity.
// Channels no user has linked are simply absent from the map. The playlist feed
// is capped at a dozen videos, so the IN (…) list stays well under D1's limit.
async function loadPlaylistUploaders(
	env: TournamentPublicEnv,
	videos: PlaylistVideo[],
): Promise<Map<string, PlaylistUploader>> {
	const channelIds = [
		...new Set(
			videos
				.map((v) => v.uploader_channel_id)
				// != null drops both null and undefined — a cache entry written before
				// the uploader fields existed has no channel id on its videos, and
				// binding undefined to D1 throws.
				.filter((id): id is string => id != null),
		),
	];
	const map = new Map<string, PlaylistUploader>();
	if (channelIds.length === 0) return map;
	const res = await env.SHARE_DB.prepare(
		`SELECT c.channel_id, c.user_id,
		        ${displayNameSql("u")} AS display_name,
		        u.discord_id, u.avatar_hash
		 FROM user_video_channels c
		 JOIN users u ON u.user_id = c.user_id
		 WHERE c.platform = 'youtube'
		   AND c.channel_id IN (${channelIds.map(() => "?").join(",")})`,
	)
		.bind(...channelIds)
		.all<{
			channel_id: string;
			user_id: string;
			display_name: string;
			discord_id: string;
			avatar_hash: string | null;
		}>();
	for (const row of res.results ?? []) {
		map.set(row.channel_id, {
			user_id: row.user_id,
			display_name: row.display_name,
			avatar_url: buildAvatarUrl(row.discord_id, row.avatar_hash),
		});
	}
	return map;
}

// Setup-phase tournaments are admin-only by default — every public read
// endpoint that exposes setup data (standings, bracket, rounds, matches,
// match detail) returns 404 (not 403) to non-admins so we don't leak the
// tournament's existence.
//
// Exception: when signups_open=1, the tournament is visible to everyone
// (the whole point of the toggle). The companion endpoints return
// effectively-empty payloads in setup (no rounds → no standings → no
// matches), but the page load on /tournaments/[slug] expects them not to
// 404, so we mirror the detail-endpoint predicate here.
//
// Callers pass the session they already resolved so the lookup is done
// once per request.
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

// Shared preamble for every public per-tournament read: rate-limit, load, and
// setup-gate. Returns the loaded tournament, or a Response to return as-is
// (429 over the view limit, or 404 when missing / hidden during setup) — the
// same short-circuit idiom enforceTournamentViewRateLimit uses. A change to
// public-read gating (visibility rule, 404 shape, rate limit) lands here once
// and covers standings, bracket, rounds, matches, match detail, and both stats
// endpoints alike.
async function loadViewableTournament(
	env: TournamentPublicEnv,
	request: Request,
	tournamentId: string,
	cors: Record<string, string>,
	session: { token: string; data: SessionData } | null,
): Promise<TournamentRow | Response> {
	const rl = await enforceTournamentViewRateLimit(env, request, cors);
	if (rl) return rl;
	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament || (await setupGateHides(env, session, tournament))) {
		return errorResponse(
			"Tournament not found",
			404,
			cors,
			"TOURNAMENT_NOT_FOUND",
		);
	}
	return tournament;
}

export async function handleTournamentStandings(
	tournamentId: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	const tournament = await loadViewableTournament(
		env,
		request,
		tournamentId,
		cors,
		session,
	);
	if (tournament instanceof Response) return tournament;
	// Signup answers are admin-only — they're collected for the admin's
	// scheduling use, not for public display alongside the standings.
	const viewerIsAdmin = await isTournamentAdmin(
		env,
		session?.data ?? null,
		tournament.tournament_id,
	);
	const body = await computeStandingsResponse(env, tournament, viewerIsAdmin);
	return jsonResponse(body, 200, cors);
}

export async function computeStandingsResponse(
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
			display_name: string | null;
			user_id: string | null;
			avatar_url: string | null;
			swiss_seed: number | null;
			division: "A" | "B" | null;
			signup_answer: string | null;
			discord_username: string | null;
		}
	>();
	for (const s of swissSlots) {
		slotIdentity.set(s.slot_id, {
			display_name: slotDisplayName(s),
			user_id: s.user_id,
			avatar_url: slotAvatarUrl(s),
			swiss_seed: s.swiss_seed,
			division: s.division,
			// Admin-only — omitted for non-admin viewers so signup answers don't
			// leak into the public standings payload.
			signup_answer: viewerIsAdmin ? s.signup_answer : null,
			// Admin-only — the raw Discord handle is storage-level (claim
			// matching, pre-link). Exposed only to admins so the slots panel /
			// standings pencil can seed the occupant editor with the real handle
			// rather than the display name (which would unlink the slot on save).
			discord_username: viewerIsAdmin ? s.discord_username : null,
		});
	}

	const byDivision: Record<
		"A" | "B",
		Array<
			RankedStanding & {
				display_name: string | null;
				user_id: string | null;
				avatar_url: string | null;
				swiss_seed: number | null;
				signup_answer: string | null;
				discord_username: string | null;
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
				display_name: null,
				user_id: null,
				avatar_url: null,
				swiss_seed: null,
				division: null,
				signup_answer: null,
				discord_username: null,
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
				display_name: string | null;
				avatar_url: string | null;
				swiss_seed: number | null;
				withdrawn: boolean;
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
				display_name: id?.display_name ?? null,
				avatar_url: id?.avatar_url ?? null,
				swiss_seed: id?.swiss_seed ?? null,
				withdrawn: r.withdrawn,
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

// Plane A competition stats: the standings block (reused verbatim from
// computeStandingsResponse, so the /stats page needs one Plane-A fetch) plus the
// caster leaderboard. viewerIsAdmin=false always — the admin-only standings
// fields (signup_answer, discord_username) are for the standings-page editors,
// and charts never render them, so the stats payload always uses the public
// shape. The caster leaderboard does its own match load: computeStandingsResponse
// loads matches internally, and the duplicate load is accepted for v1 (small
// table, same cost class as the uncached /standings read).
async function computeCompetitionStats(
	env: TournamentEnv,
	tournament: TournamentRow,
) {
	// Standings and the raw match rows are independent; the identity and
	// player_summaries batches both key off the matches. Two parallel stages,
	// with each match's parts JSON parsed once and shared (the serializeMatch
	// idiom) between identity collection and the caster tally.
	const [standings, matches] = await Promise.all([
		computeStandingsResponse(env, tournament, false),
		loadMatches(env, tournament.tournament_id),
	]);
	const partsByMatchId = new Map(
		matches.map((m) => [m.match_id, parseParts(m)]),
	);
	const [identities, summaries] = await Promise.all([
		loadUserIdentitiesForMatches(env, matches, partsByMatchId),
		loadPlayerSummaryFieldsForMatches(env, matches),
	]);
	const caster_leaderboard = computeCasterLeaderboard(
		matches,
		identities,
		partsByMatchId,
	);

	// slot_id → standings rank, so the picks rows read in the same order as the
	// standings chart. Both divisions plus the combined ranking; the first entry
	// for a slot wins (combined and per-division agree on rank per slot).
	const rankBySlotId = new Map<string, number>();
	const addRank = (slotId: string, rank: number) => {
		if (!rankBySlotId.has(slotId)) rankBySlotId.set(slotId, rank);
	};
	for (const r of standings.combined_qualifier_ranking ?? [])
		addRank(r.slot_id, r.rank);
	for (const r of standings.divisions.A.standings) addRank(r.slot_id, r.rank);
	for (const r of standings.divisions.B.standings) addRank(r.slot_id, r.rank);

	const player_picks = computePlayerPicks(
		matches,
		summaries,
		identities,
		rankBySlotId,
	);
	return { standings, caster_leaderboard, player_picks };
}

// GET /v1/tournaments/:id/stats — Plane A competition shape. Same preamble and
// gates as /standings; uncached in v1 (cost ≈ the already-uncached /standings
// read, scaling with matches not games).
export async function handleTournamentStats(
	tournamentId: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	const tournament = await loadViewableTournament(
		env,
		request,
		tournamentId,
		cors,
		session,
	);
	if (tournament instanceof Response) return tournament;
	const body = await computeCompetitionStats(env, tournament);
	return jsonResponse(body, 200, cors);
}

// GET /v1/tournaments/:id/stats/games — Plane B1 ChartBundleCore over the
// tournament's completed-match saves. Cached (KV, keyed on tournament_id +
// updated_at); pinned to CURRENT_PARSER_VERSION like handleUserStats. The
// "humans" focal widens the aggregator to every human player.
export async function handleTournamentGamesStats(
	tournamentId: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	const tournament = await loadViewableTournament(
		env,
		request,
		tournamentId,
		cors,
		session,
	);
	if (tournament instanceof Response) return tournament;

	const cacheKey = {
		kind: "tournament" as const,
		tournament_id: tournament.tournament_id,
		updated_at: tournament.updated_at,
		parser_version: CURRENT_PARSER_VERSION,
	};
	const cached = await getCached<ChartBundleCore>(env, cacheKey);
	if (cached) {
		return jsonResponse(
			cached as unknown as Record<string, unknown>,
			200,
			cors,
		);
	}

	const corpus = await resolveTournamentCorpus(env, tournament.tournament_id);
	const bundle = await buildChartBundle(
		env,
		corpus,
		CURRENT_PARSER_VERSION,
		"humans",
	);
	await putCached(env, cacheKey, bundle);
	return jsonResponse(bundle as unknown as Record<string, unknown>, 200, cors);
}

export async function handleTournamentBracket(
	tournamentId: string,
	request: Request,
	env: TournamentPublicEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	const tournament = await loadViewableTournament(
		env,
		request,
		tournamentId,
		cors,
		session,
	);
	if (tournament instanceof Response) return tournament;

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

	const partsByMatchId = new Map(
		matches.map((m) => [m.match_id, parseParts(m)]),
	);
	const identityByUserId = await loadUserIdentitiesForMatches(
		env,
		matches,
		partsByMatchId,
	);
	const nationByGamePlayer = await loadNationsForMatches(env, matches);
	const viewerIsAdmin = await isTournamentAdmin(
		env,
		session?.data ?? null,
		tournament.tournament_id,
	);
	const handleBySlotId = viewerIsAdmin
		? new Map<string, AdminSlotIdentity>(
				slots.map((s): [string, AdminSlotIdentity] => [
					s.slot_id,
					{ discord_username: s.discord_username, discord_id: s.discord_id },
				]),
			)
		: new Map<string, AdminSlotIdentity>();

	const body = {
		tournament_id: tournament.tournament_id,
		slots: champSlots.map((s) => ({
			slot_id: s.slot_id,
			championship_seed: s.championship_seed,
			display_name: slotDisplayName(s),
			user_id: s.user_id,
			avatar_url: slotAvatarUrl(s),
		})),
		rounds: champRounds.map((r) => ({
			round_id: r.round_id,
			round_number: r.round_number,
			status: r.status,
			matches: (matchesByRound.get(r.round_id) ?? []).map((m) => ({
				...serializeMatch(
					m,
					identityByUserId,
					nationByGamePlayer,
					handleBySlotId,
					partsByMatchId.get(m.match_id),
				),
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
	const session = await sessionFromRequest(env, request);
	const tournament = await loadViewableTournament(
		env,
		request,
		tournamentId,
		cors,
		session,
	);
	if (tournament instanceof Response) return tournament;
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
	const session = await sessionFromRequest(env, request);
	const tournament = await loadViewableTournament(
		env,
		request,
		tournamentId,
		cors,
		session,
	);
	if (tournament instanceof Response) return tournament;
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

	const partsByMatchId = new Map(
		filtered.map(({ match }) => [match.match_id, parseParts(match)]),
	);
	const identityByUserId = await loadUserIdentitiesForMatches(
		env,
		filtered.map(({ match }) => match),
		partsByMatchId,
	);
	const nationByGamePlayer = await loadNationsForMatches(
		env,
		filtered.map(({ match }) => match),
	);
	const viewerIsAdmin = await isTournamentAdmin(
		env,
		session?.data ?? null,
		tournament.tournament_id,
	);
	const handleBySlotId = viewerIsAdmin
		? new Map<string, AdminSlotIdentity>(
				(await loadSlots(env, tournament.tournament_id)).map(
					(s): [string, AdminSlotIdentity] => [
						s.slot_id,
						{ discord_username: s.discord_username, discord_id: s.discord_id },
					],
				),
			)
		: new Map<string, AdminSlotIdentity>();

	return jsonResponse(
		{
			tournament_id: tournament.tournament_id,
			matches: filtered.map(({ match, round }) => ({
				...serializeMatch(
					match,
					identityByUserId,
					nationByGamePlayer,
					handleBySlotId,
					partsByMatchId.get(match.match_id),
				),
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
	const session = await sessionFromRequest(env, request);
	const tournament = await loadViewableTournament(
		env,
		request,
		tournamentId,
		cors,
		session,
	);
	if (tournament instanceof Response) return tournament;
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
	const parts = parseParts(match);
	const partsByMatchId = new Map([[match.match_id, parts]]);
	const identityByUserId = await loadUserIdentitiesForMatches(
		env,
		[match],
		partsByMatchId,
	);
	const nationByGamePlayer = await loadNationsForMatches(env, [match]);
	const viewerIsAdmin = await isTournamentAdmin(
		env,
		session?.data ?? null,
		tournament.tournament_id,
	);
	const handleBySlotId = viewerIsAdmin
		? new Map<string, AdminSlotIdentity>(
				(await loadSlots(env, tournament.tournament_id)).map(
					(s): [string, AdminSlotIdentity] => [
						s.slot_id,
						{ discord_username: s.discord_username, discord_id: s.discord_id },
					],
				),
			)
		: new Map<string, AdminSlotIdentity>();
	return jsonResponse(
		{
			...serializeMatch(
				match,
				identityByUserId,
				nationByGamePlayer,
				handleBySlotId,
				parts,
			),
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
// render the "linked to tournament X" preTabs banner. Public like the rest
// of the tournament read surface.
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
	// without a second roundtrip. Display-name resolution mirrors
	// slotDisplayName(): the claiming user's display_name, falling back to
	// the stored discord_username for unclaimed slots.
	const slots = await env.SHARE_DB.prepare(
		`SELECT s.slot_id,
		        COALESCE(${displayNameSql("u")}, s.discord_username) AS display_name
		 FROM tournament_slots s
		 LEFT JOIN users u ON u.user_id = s.user_id
		 WHERE s.slot_id = ? OR s.slot_id = ?`,
	)
		.bind(row.slot_a_id, row.slot_b_id ?? row.slot_a_id)
		.all<{ slot_id: string; display_name: string | null }>();
	const displayNameById = new Map<string, string | null>();
	for (const s of slots.results ?? []) {
		displayNameById.set(s.slot_id, s.display_name);
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
					slot_a_display_name: displayNameById.get(row.slot_a_id) ?? null,
					slot_b_display_name: row.slot_b_id
						? (displayNameById.get(row.slot_b_id) ?? null)
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
	identityByUserId?: Map<string, UserIdentity>,
	nationByGamePlayer?: Map<string, string>,
	// Admin-only map slot_id → raw discord handle + numeric id for the LIVE slots
	// (not the frozen snapshot). Populated only for admin viewers: the handle
	// seeds the substitute editor with the real handle (the display name would
	// unlink the slot on save); the discord_id lets the sesh export emit real
	// `<@id>` mentions. Empty/undefined → fields null.
	handleBySlotId?: Map<string, AdminSlotIdentity>,
	// This match's parts, parsed once by the caller and shared with
	// loadUserIdentitiesForMatches, so each parts blob is walked once per request
	// rather than twice. Falls back to parsing here when a caller doesn't pre-parse.
	preParsedParts?: MatchPart[],
) {
	const slotAIdentity =
		m.slot_a_user_id && identityByUserId
			? identityByUserId.get(m.slot_a_user_id)
			: undefined;
	const slotBIdentity =
		m.slot_b_user_id && identityByUserId
			? identityByUserId.get(m.slot_b_user_id)
			: undefined;
	// Scheduled parts (migration 0029). Each part's casters resolve from the
	// same batch identity map as the slots (index 0 is the streamer, the rest
	// co-casters); the stream list passes through as stored (already url-sanitized
	// by parseParts).
	const parts = (preParsedParts ?? parseParts(m)).map((p) => ({
		id: p.id,
		scheduled_at: p.scheduled_at,
		casters: p.casters.map((c) => {
			const identity =
				c.user_id && identityByUserId
					? identityByUserId.get(c.user_id)
					: undefined;
			return {
				user_id: c.user_id,
				name: c.name,
				display_name: identity?.display_name ?? c.name,
				avatar_url: identity?.avatar_url ?? null,
			};
		}),
		streams: p.streams,
	}));
	// Nation each slot played, resolved via the slot↔player_index mapping
	// (migration 0007) against player_summaries. Null when no save is linked
	// or the index/nation is unknown (bye, forfeit, admin-set, legacy match).
	const slotANation =
		m.game_id && m.slot_a_player_index !== null && nationByGamePlayer
			? (nationByGamePlayer.get(`${m.game_id}:${m.slot_a_player_index}`) ??
				null)
			: null;
	const slotBNation =
		m.game_id && m.slot_b_player_index !== null && nationByGamePlayer
			? (nationByGamePlayer.get(`${m.game_id}:${m.slot_b_player_index}`) ??
				null)
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
		// Display labels resolved live from the snapshot user_id, falling back
		// to the report-time username snapshot for occupants who never claimed
		// an account. Null for pending matches (no snapshot yet) — the client
		// falls through to its live slot-identity maps, same shape as avatars.
		slot_a_display_name: slotAIdentity?.display_name ?? m.slot_a_username,
		slot_a_user_id: m.slot_a_user_id,
		slot_a_avatar_url: slotAIdentity?.avatar_url ?? null,
		slot_a_nation: slotANation,
		// Admin-only — raw handle + numeric Discord id of the live slot occupant
		// (null for public viewers, pending/bye sides, and unclaimed slots with
		// no linked account). The handle seeds the substitute editor; the id backs
		// `<@id>` mentions in the sesh export.
		slot_a_discord_username:
			handleBySlotId?.get(m.slot_a_id)?.discord_username ?? null,
		slot_a_discord_id: handleBySlotId?.get(m.slot_a_id)?.discord_id ?? null,
		slot_b_display_name: slotBIdentity?.display_name ?? m.slot_b_username,
		slot_b_user_id: m.slot_b_user_id,
		slot_b_avatar_url: slotBIdentity?.avatar_url ?? null,
		slot_b_nation: slotBNation,
		slot_b_discord_username: m.slot_b_id
			? (handleBySlotId?.get(m.slot_b_id)?.discord_username ?? null)
			: null,
		slot_b_discord_id: m.slot_b_id
			? (handleBySlotId?.get(m.slot_b_id)?.discord_id ?? null)
			: null,
		// Scheduled parts (migration 0029). Each carries its own time, caster
		// (rendered by display name when linked, else caster_name), and stream
		// links. An empty array means the match has no scheduled sittings yet.
		parts,
		parts_rev: m.parts_rev,
		// Stable global "Match N" handle (null for byes).
		match_number: m.match_number,
	};
}

// Resolve the nation each slot played for every match with a linked game.
// Keyed by `${game_id}:${player_index}` → nation enum (e.g. "NATION_ROME").
// Batch-load (nation, is_winner) for every roster row of every game a match set
// links, keyed `${game_id}:${player_index}`. Chunked under D1's 100-param cap.
// The shared loader behind both loadNationsForMatches (match serialization) and
// the competition stats' per-player picks — two columns per game, so the cost
// stays in the /standings class even at full-tournament scale. Matches without a
// linked game contribute no game_ids — empty list → no query.
async function loadPlayerSummaryFieldsForMatches(
	env: TournamentEnv,
	matches: MatchRow[],
): Promise<Map<string, PickSummary>> {
	const gameIds = [
		...new Set(
			matches.map((m) => m.game_id).filter((id): id is string => id !== null),
		),
	];
	const out = new Map<string, PickSummary>();
	for (const ids of chunk(gameIds, CHUNK_SIZE)) {
		const res = await env.SHARE_DB.prepare(
			`SELECT game_id, player_index, nation, is_winner FROM player_summaries
			 WHERE game_id IN (${ids.map(() => "?").join(",")})`,
		)
			.bind(...ids)
			.all<{
				game_id: string;
				player_index: number;
				nation: string | null;
				is_winner: number | null;
			}>();
		for (const r of res.results ?? []) {
			out.set(`${r.game_id}:${r.player_index}`, {
				nation: r.nation,
				is_winner: r.is_winner,
			});
		}
	}
	return out;
}

// Nation per (game_id, player_index) for a match set, keyed
// `${game_id}:${player_index}`; a projection of loadPlayerSummaryFieldsForMatches
// that drops the win flag and skips NULL nations, so a missing key resolves to
// "unknown" at serialize time.
async function loadNationsForMatches(
	env: TournamentEnv,
	matches: MatchRow[],
): Promise<Map<string, string>> {
	const fields = await loadPlayerSummaryFieldsForMatches(env, matches);
	const map = new Map<string, string>();
	for (const [key, { nation }] of fields) {
		if (nation != null) map.set(key, nation);
	}
	return map;
}

export interface UserIdentity {
	avatar_url: string | null;
	display_name: string | null;
}

// Resolve avatar URL + display name for every distinct snapshot user_id
// referenced by the supplied matches. One batched SELECT per call. Returns a
// Map keyed by user_id; missing rows map to nothing (callers fall back), a
// NULL discord_id maps to a null avatar (placeholder on the client). The
// snapshot pins WHO played (user_id, substitution-proof); presentation —
// avatar and display name — follows that user's current profile, matching
// how the rest of the site renders people. For pending matches (snapshot
// user_ids are NULL) callers can pass an empty match list — no users → no
// query.
export async function loadUserIdentitiesForMatches(
	env: TournamentEnv,
	matches: MatchRow[],
	// Parts parsed once by the caller (shared with serializeMatch). Omitted →
	// parsed here (the export path, which doesn't also re-serialize).
	partsByMatchId?: Map<string, MatchPart[]>,
): Promise<Map<string, UserIdentity>> {
	const userIds = new Set<string>();
	for (const m of matches) {
		if (m.slot_a_user_id) userIds.add(m.slot_a_user_id);
		if (m.slot_b_user_id) userIds.add(m.slot_b_user_id);
		// Every part's casters (migration 0029) resolve from the same batch.
		for (const p of partsByMatchId?.get(m.match_id) ?? parseParts(m)) {
			for (const c of p.casters) {
				if (c.user_id) userIds.add(c.user_id);
			}
		}
	}
	const map = new Map<string, UserIdentity>();
	if (userIds.size === 0) return map;
	const ids = [...userIds];
	const placeholders = ids.map(() => "?").join(",");
	const res = await env.SHARE_DB.prepare(
		`SELECT user_id, discord_id, ${displayNameSql("users")} AS display_name, avatar_hash
		 FROM users WHERE user_id IN (${placeholders})`,
	)
		.bind(...ids)
		.all<{
			user_id: string;
			discord_id: string | null;
			display_name: string | null;
			avatar_hash: string | null;
		}>();
	for (const row of res.results ?? []) {
		map.set(row.user_id, {
			avatar_url: row.discord_id
				? buildAvatarUrl(row.discord_id, row.avatar_hash)
				: null,
			display_name: row.display_name,
		});
	}
	return map;
}

// Admin-only per-slot Discord identity threaded into serializeMatch: the raw
// handle (substitute editor) plus the numeric id (sesh `<@id>` mentions).
interface MatchWithRound {
	match: MatchRow;
	round: RoundRow;
}

// Admin-only live-slot identity: the raw discord_username seeds the
// substitute editor; the numeric discord_id backs real `<@id>` mentions in
// the sesh export. Neither is exposed to non-admin viewers.
interface AdminSlotIdentity {
	discord_username: string | null;
	discord_id: string | null;
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
		   m.parts,
		   m.parts_rev,
		   m.match_number,
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
			parts: row.parts,
			parts_rev: row.parts_rev,
			match_number: row.match_number,
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
