// Site-admin gate. Single-admin model: a Discord ID stored in the
// ADMIN_DISCORD_ID wrangler secret. Handlers call isSiteAdmin at the top
// and return 404 (not 403) on failure to avoid leaking endpoint existence.

import type { SessionData } from "./session";

export interface AdminAuthEnv {
	SHARE_DB: D1Database;
	ADMIN_DISCORD_ID?: string;
}

export async function isSiteAdmin(
	env: AdminAuthEnv,
	session: { data: SessionData } | null,
): Promise<boolean> {
	if (!session) return false;
	if (!env.ADMIN_DISCORD_ID) return false;
	const row = await env.SHARE_DB.prepare(
		"SELECT discord_id FROM users WHERE user_id = ?",
	)
		.bind(session.data.user_id)
		.first<{ discord_id: string }>();
	return row?.discord_id === env.ADMIN_DISCORD_ID;
}
