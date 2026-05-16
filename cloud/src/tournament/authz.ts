// Tournament authorization helpers.
//
// requireTournamentAdmin — the caller must own a row in tournament_admins
// for the target tournament. CLI is the only path to insert into that
// table. Throws AuthzError with a status code; handlers translate to JSON
// responses via the shared errorResponse helper.

import type { SessionData } from "../session";
import type { TournamentEnv } from "./data";

export class AuthzError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
	) {
		super(message);
		this.name = "AuthzError";
	}
}

export async function requireTournamentAdmin(
	env: TournamentEnv,
	session: SessionData | null,
	tournamentId: string,
): Promise<void> {
	if (!session) {
		throw new AuthzError(401, "UNAUTHORIZED", "Authentication required");
	}
	const row = await env.SHARE_DB.prepare(
		"SELECT 1 AS ok FROM tournament_admins WHERE tournament_id = ? AND user_id = ?",
	)
		.bind(tournamentId, session.user_id)
		.first<{ ok: number }>();
	if (!row) {
		// 403 with no 404-vs-403 distinction — don't leak tournament existence
		// to non-admins (the public read paths already surface tournament
		// existence by other means, but the admin paths shouldn't).
		throw new AuthzError(403, "NOT_TOURNAMENT_ADMIN", "Not a tournament admin");
	}
}

export async function isTournamentAdmin(
	env: TournamentEnv,
	session: SessionData | null,
	tournamentId: string,
): Promise<boolean> {
	if (!session) return false;
	const row = await env.SHARE_DB.prepare(
		"SELECT 1 AS ok FROM tournament_admins WHERE tournament_id = ? AND user_id = ?",
	)
		.bind(tournamentId, session.user_id)
		.first<{ ok: number }>();
	return row !== null;
}
