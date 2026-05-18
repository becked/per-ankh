// User search for the tournament admin's slot-creation autocomplete.
//
// Scope: only `GET /v1/users/search` lives here today. The endpoint is
// generic enough that future user-facing surfaces (e.g. mention picker,
// admin grant flow) can reuse it without piggybacking on a tournament-
// scoped handler. Anything more user-table-shaped that grows beyond a
// few hundred lines can split into its own subdir.
//
// Auth model mirrors the rest of the beta surface:
//   1. session required (anonymous → 404, not 401 — keeps the surface
//      consistent with /v1/tournaments/* which never tells anonymous
//      callers that authed callers would see different results)
//   2. requireTournamentBeta gate (404 on miss for the same reason)
//   3. per-user rate limit on the user_id, audited via the shared
//      `events` table — same engine as the tournament_view limit.
//
// Privacy: only the four fields the autocomplete needs are returned
// (user_id, discord_id, discord_username, display_name). No email,
// avatar, or timestamps. Result cap defaults to 10, max 20.

import * as v from "valibot";
import { countEventsSince } from "./games";
import { logError } from "./log";
import { UserSearchQuerySchema } from "./schemas/tournament";
import { sessionFromRequest, type SessionEnv } from "./session";
import { AuthzError, requireTournamentBeta } from "./tournament/authz";
import type { TournamentEnv } from "./tournament/data";
import { cloudCorsHeaders, errorResponse, jsonResponse } from "./util";

// Generous ceiling — typing 5 chars to find someone, picking from the
// dropdown, costs ~4 requests per slot. An admin adding a 16-player
// tournament makes ~64 requests; 60/hour limits that to one full slot
// list per hour from a single account. The beta gate already bounds
// the actor population, so we mostly want to bound runaway scripts.
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
		return errorResponse("Not found", 404, cors, "USER_SEARCH_NOT_FOUND");
	}
	try {
		await requireTournamentBeta(env, session.data);
	} catch (e) {
		if (e instanceof AuthzError) {
			return errorResponse(e.message, e.status, cors, e.code);
		}
		throw e;
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

	// Search on display_name (the global_name fallback to username — what
	// people typically recognize themselves as) rather than discord_username
	// (the lowercased canonical @ handle). Picking a row still threads
	// discord_username into the slot row via the user_id pre-link path, so
	// the data we store is unchanged. discord_username IS NOT NULL filters
	// out users who haven't logged in since migration 0016 and would
	// therefore be unpickable.
	//
	// LOWER(display_name) for case-insensitive match against the already-
	// lowercased `q`. Index on display_name doesn't exist (we only added
	// idx_users_discord_username); table is small enough that full-scan is
	// fine — promote to a functional index if user count grows past a few
	// thousand.
	const rows = await env.SHARE_DB.prepare(
		`SELECT user_id, discord_id, discord_username, display_name
		 FROM users
		 WHERE LOWER(display_name) LIKE ?
		   AND discord_username IS NOT NULL
		   AND display_name IS NOT NULL
		 ORDER BY display_name
		 LIMIT ?`,
	)
		.bind(q + "%", limit)
		.all<{
			user_id: string;
			discord_id: string;
			discord_username: string;
			display_name: string;
		}>();

	return jsonResponse({ users: rows.results ?? [] }, 200, cors);
}
