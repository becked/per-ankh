// OnlineID-to-user linking. Populated implicitly from upload-modal picker
// selections (see games.ts handleGameUpload step "Auto-link OnlineIDs").
// Read by the picker before each upload to pre-check matching humans.

import { cloudCorsHeaders, errorResponse, jsonResponse } from "./util";
import { sessionFromRequest } from "./session";
import type { SessionEnv } from "./session";

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
