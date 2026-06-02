// User-table-shaped endpoints: search (tournament admin autocomplete)
// and public profile (the /users/[user_id] page chrome).
//
// Anything more user-table-shaped that grows beyond a few hundred lines
// can split into its own subdir.
//
// Auth model:
//   1. session required (anonymous → 401) — the search returns user
//      identity fields, so it's logged-in only.
//   2. per-user rate limit on the user_id, audited via the shared
//      `events` table — same engine as the tournament_view limit.
//
// Privacy: only the four fields the autocomplete needs are returned
// (user_id, discord_id, discord_username, display_name). No email,
// avatar, or timestamps. Result cap defaults to 10, max 20.

import * as v from "valibot";
import { buildAvatarUrl } from "./auth";
import { countEventsSince } from "./games";
import { logError } from "./log";
import { UserSearchQuerySchema } from "./schemas/tournament";
import { sessionFromRequest, type SessionEnv } from "./session";
import type { TournamentEnv } from "./tournament/data";
import { cloudCorsHeaders, errorResponse, jsonResponse } from "./util";

// Generous ceiling — typing 5 chars to find someone, picking from the
// dropdown, costs ~4 requests per slot. An admin adding a 16-player
// tournament makes ~64 requests; 60/hour limits that to one full slot
// list per hour from a single account. Any logged-in user can search, so
// the limit mostly bounds runaway scripts.
export const USER_SEARCH_PER_USER_PER_HOUR = 60;

const DEFAULT_LIMIT = 10;

export interface UserSearchEnv extends SessionEnv, TournamentEnv {
	ALLOWED_ORIGINS: string;
}

export async function handleUserSearch(
	request: Request,
	env: UserSearchEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}

	// Rate limit per user. Check BEFORE doing any DB work or audit-row
	// insert so a hammered account fails cheaply.
	const count = await countEventsSince(
		env.SHARE_DB,
		"user_search",
		"user_id",
		session.data.user_id,
	);
	if (count >= USER_SEARCH_PER_USER_PER_HOUR) {
		return errorResponse(
			"User search rate limit exceeded",
			429,
			cors,
			"RATE_LIMIT_USER_SEARCH",
		);
	}

	const url = new URL(request.url);
	const rawQ = url.searchParams.get("q") ?? "";
	const rawLimit = url.searchParams.get("limit");
	const limitNum = rawLimit !== null ? parseInt(rawLimit, 10) : NaN;
	const parsed = v.safeParse(UserSearchQuerySchema, {
		q: rawQ,
		...(Number.isFinite(limitNum) ? { limit: limitNum } : {}),
	});
	if (!parsed.success) {
		return errorResponse(
			`Invalid query: ${parsed.issues[0]?.message ?? "unknown"}`,
			400,
			cors,
			"VALIDATION_ERROR",
		);
	}
	const { q, limit = DEFAULT_LIMIT } = parsed.output;

	// "Still typing" floor — return empty without an audit row, so per-
	// keystroke calls below 2 chars don't churn the rate-limit counter or
	// the events table. Frontend can call /search on every keystroke
	// without thinking.
	if (q.length < 2) {
		return jsonResponse({ users: [] }, 200, cors);
	}

	// Audit row also serves as the rate-limit counter source. async fire-
	// and-forget — failure to audit shouldn't block the lookup.
	env.SHARE_DB.prepare(
		`INSERT INTO events (event_type, user_id, metadata)
		 VALUES ('user_search', ?, ?)`,
	)
		.bind(session.data.user_id, JSON.stringify({ q_length: q.length }))
		.run()
		.catch((e: unknown) => {
			logError("user_search_audit_failed", e, {
				user_id: session.data.user_id,
			});
		});

	// Match a prefix of either display_name (the global_name fallback to
	// username — what people recognize themselves as) OR discord_username (the
	// lowercased canonical @ handle), so an admin can type whichever they know.
	// Picking a row threads discord_username into the slot via the user_id
	// pre-link path, so the data we store is unchanged. discord_username IS NOT
	// NULL filters out users who haven't logged in since migration 0016 and
	// would therefore be unpickable.
	//
	// LOWER(...) for case-insensitive match against the already-lowercased `q`
	// (discord_username is already stored lowercase). Indexes:
	// idx_users_discord_username covers the handle prefix; display_name has no
	// index. Table is small enough that the scan is fine — promote to a
	// functional index if user count grows past a few thousand.
	const rows = await env.SHARE_DB.prepare(
		`SELECT user_id, discord_id, discord_username, display_name
		 FROM users
		 WHERE (LOWER(display_name) LIKE ? OR LOWER(discord_username) LIKE ?)
		   AND discord_username IS NOT NULL
		   AND display_name IS NOT NULL
		 ORDER BY display_name
		 LIMIT ?`,
	)
		.bind(q + "%", q + "%", limit)
		.all<{
			user_id: string;
			discord_id: string;
			discord_username: string;
			display_name: string;
		}>();

	return jsonResponse({ users: rows.results ?? [] }, 200, cors);
}

// GET /v1/users/:user_id — public user profile.
//
// Returns identity fields the /users/[user_id] profile page needs to
// render its chrome (display name + avatar). No auth, no beta gate;
// 404 if the user doesn't exist.
export interface UserProfileEnv extends SessionEnv {
	SHARE_DB: D1Database;
	ALLOWED_ORIGINS: string;
}

interface UserProfileRow {
	user_id: string;
	discord_id: string;
	display_name: string;
	avatar_hash: string | null;
}

export async function handleUserProfile(
	userId: string,
	request: Request,
	env: UserProfileEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const row = await env.SHARE_DB.prepare(
		"SELECT user_id, discord_id, display_name, avatar_hash FROM users WHERE user_id = ?",
	)
		.bind(userId)
		.first<UserProfileRow>();

	if (!row) {
		return errorResponse("User not found", 404, cors, "NOT_FOUND");
	}

	// All-time profile summary for the profile-header card. Deliberately
	// over ALL the user's saves (no collection / game-type scope) — the
	// header sits above the scope selector and shouldn't move with it.
	// Visibility-scoped only: owner sees private+public, others public-only.
	const session = await sessionFromRequest(env, request);
	const vis = session?.data.user_id === userId ? "" : " AND is_public = 1";
	const [countsRow, nationRow, dayRow] = await Promise.all([
		env.SHARE_DB.prepare(
			`SELECT COUNT(*) AS total,
			        CAST(SUM(CASE WHEN user_won = 1 THEN 1 ELSE 0 END) AS REAL)
			          / NULLIF(SUM(CASE WHEN user_won IS NOT NULL THEN 1 ELSE 0 END), 0)
			          AS win_rate
			 FROM games WHERE user_id = ?${vis}`,
		)
			.bind(userId)
			.first<{ total: number; win_rate: number | null }>(),
		env.SHARE_DB.prepare(
			`SELECT user_nation FROM games
			 WHERE user_id = ? AND user_nation IS NOT NULL${vis}
			 GROUP BY user_nation
			 ORDER BY COUNT(*) DESC, user_nation ASC
			 LIMIT 1`,
		)
			.bind(userId)
			.first<{ user_nation: string }>(),
		env.SHARE_DB.prepare(
			`SELECT CAST(strftime('%w', save_date) AS INTEGER) AS weekday
			 FROM games WHERE user_id = ? AND save_date IS NOT NULL${vis}
			 GROUP BY weekday
			 ORDER BY COUNT(*) DESC, weekday ASC
			 LIMIT 1`,
		)
			.bind(userId)
			.first<{ weekday: number | null }>(),
	]);

	return jsonResponse(
		{
			user_id: row.user_id,
			display_name: row.display_name,
			avatar_url: buildAvatarUrl(row.discord_id, row.avatar_hash),
			summary: {
				total_games: countsRow?.total ?? 0,
				win_rate: countsRow?.win_rate ?? null,
				favorite_nation: nationRow?.user_nation ?? null,
				favorite_day_of_week: dayRow?.weekday ?? null,
			},
		},
		200,
		cors,
	);
}
