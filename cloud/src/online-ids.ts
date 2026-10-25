// OnlineID-to-user linking. Populated implicitly from upload-modal picker
// selections (see games.ts handleGameUpload step "Auto-link OnlineIDs").
// Read by the picker before each upload to pre-check matching humans.

import {
	cloudCorsHeaders,
	errorResponse,
	getClientIp,
	jsonResponse,
} from "./util";
import { sessionFromRequest } from "./session";
import type { SessionEnv } from "./session";
import { logError } from "./log";
import type { QueryableD1, EventsEnv } from "./d1";

export interface OnlineIdsEnv extends SessionEnv, EventsEnv {
	SHARE_DB: QueryableD1;
	ALLOWED_ORIGINS: string;
}

// The rows of user_online_ids whose online_id resolves to exactly one account,
// as a subquery yielding (online_id, user_id).
//
// user_online_ids is many-to-many by design (0003: shared account, Discord
// account rebuild) and links are captured implicitly from whichever seat an
// uploader claimed, so an id can name two people without either of them doing
// anything wrong. Crediting both hands one player the other's history, and
// nothing here distinguishes the real owner — the earliest claimant is not the
// likelier one. So an id claimed twice resolves to nobody until the claim path
// sorts it out.
//
// One definition, because both readers must answer it the same way: the
// played-games leaderboard credits seats with it (stats/handlers.ts) and the
// rating model resolves duel rosters with it (ratings/duels.ts).
export const UNAMBIGUOUS_ONLINE_ID_OWNERS_SQL = `SELECT uo.online_id, uo.user_id
	   FROM user_online_ids uo
	  WHERE NOT EXISTS (
	          SELECT 1 FROM user_online_ids amb
	           WHERE amb.online_id = uo.online_id
	             AND amb.user_id <> uo.user_id)`;

export async function getUserOnlineIds(
	env: Pick<OnlineIdsEnv, "SHARE_DB">,
	userId: string,
): Promise<string[]> {
	const result = await env.SHARE_DB.prepare(
		"SELECT online_id FROM user_online_ids WHERE user_id = ?",
	)
		.bind(userId)
		.all<{ online_id: string }>();
	return (result.results ?? []).map((r) => r.online_id);
}

// Upsert one or more (user_id, online_id) pairs. Bumps last_seen_at on
// existing rows; sets first_seen_at on new ones via the column default.
//
// An empty id is dropped rather than linked. `Player.writeGameXML` writes
// `OnlineID` unconditionally (Player.cs:27523), so a seat that has none
// carries `""` instead of omitting the attribute — 406 of the 2,541
// player_summaries.online_id values in the 2026-10-23 production snapshot are
// `''` and none are NULL, 4 of them on human seats. `""` names nobody, and
// UNAMBIGUOUS_ONLINE_ID_OWNERS_SQL above resolves an id linked by exactly one
// account to that account, so a single `('')` row would credit its owner with
// every public game holding an empty-id human seat.
//
// Filtered here, not at the call sites: this is the field's one write path,
// and its two callers disagreed before — the upload path tested the id and
// handleGamePatch's correction did not.
export async function captureOnlineIds(
	env: Pick<OnlineIdsEnv, "SHARE_DB">,
	userId: string,
	onlineIds: string[],
): Promise<void> {
	const ids = onlineIds.filter((id) => id !== "");
	if (ids.length === 0) return;
	const stmt = env.SHARE_DB.prepare(
		`INSERT INTO user_online_ids (user_id, online_id)
		 VALUES (?, ?)
		 ON CONFLICT(user_id, online_id) DO UPDATE SET last_seen_at = datetime('now')`,
	);
	const batch = ids.map((id) => stmt.bind(userId, id));
	await env.SHARE_DB.batch(batch);
}

export async function handleListOnlineIds(
	request: Request,
	env: OnlineIdsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	}

	const onlineIds = await getUserOnlineIds(env, session.data.user_id);
	return jsonResponse({ online_ids: onlineIds }, 200, cors);
}

// DELETE /v1/users/me/online-ids/:online_id — remove a user's manually-managed
// link. Idempotent — returns 204 whether or not the row existed (DELETE on a
// missing row is a no-op the user doesn't need to know about). Composite
// primary key (user_id, online_id) ensures only the caller's own row is
// touched. Re-uploading a save where the same online_id appears will
// auto-relink it via captureOnlineIds.
export async function handleRemoveOnlineId(
	onlineId: string,
	request: Request,
	env: OnlineIdsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	}

	const result = await env.SHARE_DB.prepare(
		"DELETE FROM user_online_ids WHERE user_id = ? AND online_id = ?",
	)
		.bind(session.data.user_id, onlineId)
		.run();

	// Only audit when a row was actually removed. The endpoint is
	// idempotent (no-op DELETEs return 204) so UI retries don't pollute
	// the trail. The events table is internal D1 — `online_id` in
	// metadata is NOT shipped to the log sinks (PII deny-list).
	const changes = result.meta?.changes ?? 0;
	if (changes > 0) {
		try {
			await env.EVENTS_DB.prepare(
				`INSERT INTO events (event_type, user_id, ip_address, metadata)
				 VALUES ('online_id_remove', ?, ?, ?)`,
			)
				.bind(
					session.data.user_id,
					getClientIp(request),
					JSON.stringify({ online_id: onlineId }),
				)
				.run();
		} catch (e) {
			logError("audit_event_log_failed", e, {
				event_type: "online_id_remove",
			});
		}
	}

	return new Response(null, { status: 204, headers: cors });
}
