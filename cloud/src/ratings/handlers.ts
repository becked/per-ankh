// The two endpoints over the recommender: the viewer's own list, and the
// operator's rebuild trigger.
//
// The list is session-scoped by construction — there is no route that takes a
// user id, so "show a player only their own list" is not a check that could be
// forgotten, it is the shape of the API. And what comes back is names, badges
// and a meeting count: no win probability, no rating, no deviation, no score.
// The whole point of computing the model in the Worker is that none of it
// crosses this line.

import { buildAvatarUrl } from "../auth";
import { ATLAS_BASE_URL, ATLAS_POOL } from "../generated/atlas-pool";
import { isSiteAdmin, type AdminAuthEnv } from "../admin";
import type { EventsEnv, QueryableD1 } from "../d1";
import { displayNameSql } from "../identity";
import { logError, logEvent } from "../log";
import { sessionFromRequest, type SessionEnv } from "../session";
import {
	cloudCorsHeaders,
	errorResponse,
	getClientIp,
	jsonResponse,
} from "../util";
import { rebuildRatings } from "./rebuild";
import type { OpponentBadge } from "./recommend";

export interface OpponentsEnv extends SessionEnv {
	SHARE_DB: QueryableD1;
	ALLOWED_ORIGINS: string;
}

export interface RatingsAdminEnv extends SessionEnv, AdminAuthEnv, EventsEnv {
	SHARE_DB: QueryableD1;
	ALLOWED_ORIGINS: string;
}

interface OpponentRow {
	user_id: string;
	discord_id: string;
	display_name: string;
	slug: string | null;
	avatar_hash: string | null;
	meetings: number;
	badges: string;
	map_anchor: string | null;
}

// Anchor -> the baked pool entry, so a stored suggestion is resolved to a name
// and a link at read time. A row whose anchor is no longer in the pool (the
// atlas dropped the map between a rebuild and now) simply loses its map rather
// than rendering a dead link.
const POOL_BY_ANCHOR = new Map(ATLAS_POOL.map((m) => [m.anchor, m]));

function mapFor(anchor: string | null) {
	if (!anchor) return null;
	const m = POOL_BY_ANCHOR.get(anchor);
	if (!m) return null;
	return {
		name: m.name,
		setting: m.setting,
		url: `${ATLAS_BASE_URL}#${m.anchor}`,
	};
}

// GET /v1/users/me/opponents — the signed-in viewer's ten suggested opponents,
// in the order the nightly rebuild shuffled them into. Identity, a link to
// their Discord profile, and the pair's history: no rating, no probability, no
// score, because the numbers stop at this line.
//
// `rated` is what separates the two empty lists: a player with no rated
// multiplayer game yet has nothing the model can reason from and needs to be
// told so, where a rated player with an empty list is just having a thin week.
export async function handleMyOpponents(
	request: Request,
	env: OpponentsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	}
	const userId = session.data.user_id;

	const rows = await env.SHARE_DB.prepare(
		`SELECT o.opponent_user_id AS user_id, u.discord_id,
		        ${displayNameSql("u")} AS display_name, u.slug, u.avatar_hash,
		        o.meetings, o.badges, o.map_anchor
		   FROM user_recommended_opponents o
		   JOIN users u ON u.user_id = o.opponent_user_id
		  WHERE o.user_id = ?
		  ORDER BY o.position`,
	)
		.bind(userId)
		.all<OpponentRow>();
	const results = rows.results ?? [];

	const rated = await env.SHARE_DB.prepare(
		"SELECT 1 FROM user_ratings WHERE user_id = ?",
	)
		.bind(userId)
		.first<{ 1: number }>();

	return jsonResponse(
		{
			opponents: results.map((r) => ({
				user_id: r.user_id,
				display_name: r.display_name,
				slug: r.slug,
				avatar_url: buildAvatarUrl(r.discord_id, r.avatar_hash),
				// The Discord profile, where the Message button is. Built here
				// from the snowflake rather than shipping a discord_* field, the
				// same select-use-don't-serialize shape as avatar_url — which
				// already carries the same snowflake to every public payload, as
				// cdn.discordapp.com/avatars/<discord_id>/<hash>.png. The line the
				// PII stance holds is the *handle*, discord_username, and nothing
				// here exposes it.
				discord_url: `https://discord.com/users/${r.discord_id}`,
				meetings: r.meetings,
				badges: JSON.parse(r.badges) as OpponentBadge[],
				// A map neither of them has played lately, ready to link and to
				// paste into a message. Resolved here rather than shipping the
				// anchor for the page to look up: the page has no copy of the
				// pool, and this keeps the one it renders and the one the
				// recommender picked from the same table.
				map: mapFor(r.map_anchor),
			})),
			rated: rated !== null,
		},
		200,
		cors,
	);
}

// POST /v1/admin/ratings/rebuild — run the nightly job now.
//
// The job is idempotent and self-contained, so the trigger takes no body and
// carries no options. It exists because the tables are empty until the first
// cron fires: after a deploy (and after the reindex sweep has backfilled
// player_summaries.online_id) an operator wants the feature live today, not at
// 03:47 tomorrow.
export async function handleRebuildRatings(
	request: Request,
	env: RatingsAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	// The `!session` leg is redundant against isSiteAdmin, which returns false
	// for a null session — it is here so the audit insert below can read
	// session.data without an assertion. Same shape as handleUnfeatureVideo.
	if (!session || !(await isSiteAdmin(env, session))) {
		return errorResponse("Not found", 404, cors, "NOT_FOUND");
	}

	let result;
	try {
		result = await rebuildRatings(env.SHARE_DB as D1Database);
	} catch (e) {
		logError("ratings_rebuild_failed", e);
		return errorResponse("Rebuild failed", 500, cors, "REBUILD_FAILED");
	}
	logEvent("info", "ratings_rebuild_completed", {
		trigger: "admin",
		users: result.users,
		ratable_duels: result.ratableDuels,
		recommended: result.recommended,
	});

	// Audited like the other admin sweeps (admin_reimport, admin_reindex): this
	// rewrites what every player sees on their Opponents tab, so who ran it and
	// when is worth keeping. Through EVENTS_DB, never SHARE_DB — see cloud/src/d1.ts.
	// Best-effort, for the same reason the reindex audit is: a failed audit
	// insert must not turn a completed rebuild into a 500.
	try {
		await env.EVENTS_DB.prepare(
			`INSERT INTO events (event_type, user_id, ip_address, metadata)
			 VALUES (?, ?, ?, ?)`,
		)
			.bind(
				"ratings_rebuild",
				session.data.user_id,
				getClientIp(request),
				JSON.stringify({
					users: result.users,
					ratable_duels: result.ratableDuels,
					recommended: result.recommended,
				}),
			)
			.run();
	} catch (e) {
		logError("audit_event_log_failed", e, { event_type: "ratings_rebuild" });
	}

	return jsonResponse({ ...result }, 200, cors);
}
