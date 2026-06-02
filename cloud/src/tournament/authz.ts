// Tournament authorization helpers.
//
// isTournamentBeta — whether the caller owns a row in tournament_beta_users
// (operator-managed allowlist). Gates tournament *creation* only; reads,
// signup, and admin actions are open. Returns a boolean — callers decide the
// failure response (create returns 403 TOURNAMENT_CREATE_FORBIDDEN).
//
// requireTournamentAdmin — the caller must own a row in tournament_admins
// for the target tournament. Throws AuthzError with a status code; handlers
// translate to JSON responses via the shared errorResponse helper.

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

// Allowlist check, keyed on user_id after the login-time pin in
// handleDiscordCallback runs; pre-login grants (keyed only on discord_id)
// become reachable on the user's next sign-in.
export async function isTournamentBeta(
	env: TournamentEnv,
	session: SessionData | null,
): Promise<boolean> {
	if (!session) return false;
	const row = await env.SHARE_DB.prepare(
		"SELECT 1 AS ok FROM tournament_beta_users WHERE user_id = ? LIMIT 1",
	)
		.bind(session.user_id)
		.first<{ ok: number }>();
	return row !== null;
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
