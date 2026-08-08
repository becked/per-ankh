// HTTP handler for the stats endpoint.
//
//   GET /v1/users/:user_id/stats           — user corpus
//
// Resolve corpus → check cache → compute on miss → return bundle.

import { CURRENT_PARSER_VERSION } from "../schemas/game";
import { sessionFromRequest } from "../session";
import type { SessionEnv } from "../session";
import {
	cloudCorsHeaders,
	errorResponse,
	getClientIp,
	jsonResponse,
} from "../util";
import { ANON_READS_PER_HOUR, countEventsSince, isScraperUA } from "../games";
import { displayNameSql } from "../identity";
import { parseScopeParam } from "../games-scope";
import { buildChartBundle } from "./aggregate";
import { getCached, putCached } from "./cache";
import { resolveUserCorpus } from "./resolve";
import type { ChartBundle, UserStatsScope } from "./types";
import type { QueryableD1 } from "../d1";

export interface UserStatsEnv extends SessionEnv {
	SHARE_DB: QueryableD1;
	SESSIONS_KV: KVNamespace;
	ALLOWED_ORIGINS: string;
}

export async function handleUserStats(
	userId: string,
	request: Request,
	env: UserStatsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	if (!/^[A-Za-z0-9_-]{21}$/.test(userId)) {
		return errorResponse("Invalid user_id", 400, cors, "INVALID_USER_ID");
	}

	const session = await sessionFromRequest(env, request);
	const viewerId = session?.data.user_id ?? null;
	const viewerScope: UserStatsScope = viewerId === userId ? "self" : "public";

	const url = new URL(request.url);
	const scope = parseScopeParam(url.searchParams.get("scope"));

	const cacheKey = {
		kind: "user" as const,
		user_id: userId,
		viewerScope,
		scope,
		parser_version: CURRENT_PARSER_VERSION,
	};
	const cached = await getCached<ChartBundle>(env, cacheKey);
	if (cached) {
		return jsonResponse(
			cached as unknown as Record<string, unknown>,
			200,
			cors,
		);
	}

	const corpus = await resolveUserCorpus(env, userId, viewerScope, scope);
	if (!corpus) {
		return errorResponse("User not found", 404, cors, "NOT_FOUND");
	}

	const bundle = await buildChartBundle(
		env,
		corpus,
		CURRENT_PARSER_VERSION,
		"uploader",
	);
	await putCached(env, cacheKey, bundle);
	return jsonResponse(bundle as unknown as Record<string, unknown>, 200, cors);
}

// ─── Played-games leaderboard ────────────────────────────────────────
//
//   GET /v1/stats/players — public site-wide leaderboard of games PLAYED
//   per user, split by category: network duels, cloud duels, FFAs (3+
//   humans, any mode), and other (single-player, hotseat/LAN). Playing is
//   what's counted, not uploading: anyone's upload credits every human
//   seat in it — the uploader via their claimed seat, everyone else by
//   matching the seat's online id against user_online_ids. The same match
//   uploaded by both players (separate game rows, same save GameId)
//   counts once per player, deduped on xml_game_id. Only display names
//   and counts are exposed.

export interface PlayerLeaderboardEnv {
	SHARE_DB: QueryableD1;
	EVENTS_DB: D1Database;
	ALLOWED_ORIGINS: string;
}

interface PlayedGamesRow {
	user_id: string;
	display_name: string;
	duels_network: number;
	duels_cloud: number;
	ffas: number;
	total: number;
}

export async function handlePlayerLeaderboard(
	request: Request,
	env: PlayerLeaderboardEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	// Same anon_read budget as the other public list reads (public-recent,
	// game detail): scrapers exempt by UA, untrusted IPs share one bucket.
	const ip = getClientIp(request) ?? "untrusted";
	const ua = request.headers.get("User-Agent");
	if (!isScraperUA(ua)) {
		const count = await countEventsSince(
			env.EVENTS_DB,
			"anon_read",
			"ip_address",
			ip,
		);
		if (count >= ANON_READS_PER_HOUR) {
			return errorResponse(
				"Rate limit exceeded. Try again later.",
				429,
				cors,
				"RATE_LIMIT",
			);
		}
		env.EVENTS_DB.prepare(
			`INSERT INTO events (event_type, ip_address) VALUES ('anon_read', ?)`,
		)
			.bind(ip)
			.run()
			.catch(() => {});
	}

	// Optional season window: `since`/`until` (YYYY-MM-DD, until exclusive)
	// count only games UPLOADED in the window — created_at is
	// server-authoritative, unlike the save's own dates. Invalid values are
	// rejected rather than silently ignored so a malformed season picker
	// can't masquerade as all-time.
	const url = new URL(request.url);
	const sinceRaw = url.searchParams.get("since");
	const untilRaw = url.searchParams.get("until");
	for (const v of [sinceRaw, untilRaw]) {
		if (v != null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
			return errorResponse("Invalid window date", 400, cors, "INVALID_QUERY");
		}
	}

	// `played` is (user, match) pairs — the uploader's claimed seat, plus
	// every seat whose online id belongs to a registered user; UNION dedupes
	// both the two credit paths and double-uploaded matches (same
	// xml_game_id). `match_class` classifies each match from any in-window
	// upload of it (all uploads of a match carry the same save, so humans
	// and game_mode agree). Duel = exactly two humans, split by game mode;
	// two-human hotseat/LAN lands in `other` (derived client-side).
	const rows = await env.SHARE_DB.prepare(
		`WITH humans AS (
		   SELECT game_id, SUM(is_human) AS n
		   FROM player_summaries GROUP BY game_id
		 ),
		 played AS (
		   SELECT g.user_id, g.xml_game_id
		   FROM games g
		   JOIN player_summaries ps
		     ON ps.game_id = g.game_id AND ps.is_uploader = 1 AND ps.is_human = 1
		   WHERE (?1 IS NULL OR g.created_at >= ?1)
		     AND (?2 IS NULL OR g.created_at < ?2)
		   UNION
		   SELECT uo.user_id, g.xml_game_id
		   FROM games g
		   JOIN player_summaries ps
		     ON ps.game_id = g.game_id AND ps.is_human = 1
		        AND ps.online_id IS NOT NULL
		   JOIN user_online_ids uo ON uo.online_id = ps.online_id
		   WHERE (?1 IS NULL OR g.created_at >= ?1)
		     AND (?2 IS NULL OR g.created_at < ?2)
		 ),
		 match_class AS (
		   SELECT g.xml_game_id, MAX(h.n) AS n_humans, MAX(g.game_mode) AS game_mode
		   FROM games g
		   JOIN humans h ON h.game_id = g.game_id
		   WHERE (?1 IS NULL OR g.created_at >= ?1)
		     AND (?2 IS NULL OR g.created_at < ?2)
		   GROUP BY g.xml_game_id
		 )
		 SELECT
		   u.user_id,
		   ${displayNameSql("u")} AS display_name,
		   SUM(mc.n_humans = 2 AND mc.game_mode = 'NETWORK') AS duels_network,
		   SUM(mc.n_humans = 2 AND mc.game_mode = 'PLAY_BY_CLOUD') AS duels_cloud,
		   SUM(mc.n_humans >= 3) AS ffas,
		   COUNT(*) AS total
		 FROM played p
		 JOIN match_class mc ON mc.xml_game_id = p.xml_game_id
		 JOIN users u ON u.user_id = p.user_id
		 GROUP BY u.user_id
		 ORDER BY total DESC, display_name ASC`,
	)
		.bind(sinceRaw, untilRaw)
		.all<PlayedGamesRow>();

	// A CLOSED window is immutable — created_at can't be backdated, so a
	// finished season's board never changes — and caches for a day; open
	// windows keep the public-recent shape (60s edge, 5min browser).
	const closed =
		untilRaw != null && untilRaw <= new Date().toISOString().slice(0, 10);
	return new Response(JSON.stringify({ players: rows.results ?? [] }), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": closed
				? "public, max-age=86400, s-maxage=86400"
				: "public, max-age=300, s-maxage=60",
			...cors,
			Vary: "Origin",
		},
	});
}
