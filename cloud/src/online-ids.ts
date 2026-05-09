// OnlineID-to-user linking. Populated implicitly from upload-modal picker
// selections (see games.ts handleGameUpload step "Auto-link OnlineIDs").
// Read by the picker before each upload to pre-check matching humans.

import { cloudCorsHeaders, errorResponse, getClientIp, jsonResponse } from "./util";
import { sessionFromRequest } from "./session";
import type { SessionEnv } from "./session";
import { logError } from "./log";

export interface OnlineIdsEnv extends SessionEnv {
	SHARE_DB: D1Database;
	ALLOWED_ORIGINS: string;
}

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
export async function captureOnlineIds(
	env: Pick<OnlineIdsEnv, "SHARE_DB">,
	userId: string,
	onlineIds: string[],
): Promise<void> {
	if (onlineIds.length === 0) return;
	const stmt = env.SHARE_DB.prepare(
		`INSERT INTO user_online_ids (user_id, online_id)
		 VALUES (?, ?)
		 ON CONFLICT(user_id, online_id) DO UPDATE SET last_seen_at = datetime('now')`,
	);
	const batch = onlineIds.map((id) => stmt.bind(userId, id));
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
	// metadata is NOT shipped to Logpush (PII deny-list).
	const changes = result.meta?.changes ?? 0;
	if (changes > 0) {
		try {
			await env.SHARE_DB.prepare(
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
