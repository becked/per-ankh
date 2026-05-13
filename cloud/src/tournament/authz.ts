// Tournament authorization helpers.
//
// Two checks dominate:
//   1. requireTournamentAdmin — the caller must own a row in
//      tournament_admins for the target tournament. CLI is the only path
//      to insert into that table.
//   2. requireMatchParticipantOrAdmin — for the match-report endpoint:
//      the caller's user_id must match slot_a.user_id or slot_b.user_id,
//      OR the caller must be a tournament admin.
//
// Both throw AuthzError with a status code; handlers translate to JSON
// responses via the shared errorResponse helper.

import type { SessionData } from "../session";
import { loadMatch, loadSlot, type TournamentEnv } from "./data";

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

export interface MatchAuthContext {
	matchId: string;
	tournamentId: string;
	isAdmin: boolean;
	slotAUserId: string | null;
	slotBUserId: string | null;
}

export async function requireMatchParticipantOrAdmin(
	env: TournamentEnv,
	session: SessionData | null,
	matchId: string,
): Promise<MatchAuthContext> {
	if (!session) {
		throw new AuthzError(401, "UNAUTHORIZED", "Authentication required");
	}
	const match = await loadMatch(env, matchId);
	if (!match) {
		throw new AuthzError(404, "MATCH_NOT_FOUND", "Match not found");
	}
	const round = await env.SHARE_DB.prepare(
		"SELECT tournament_id FROM tournament_rounds WHERE round_id = ?",
	)
		.bind(match.round_id)
		.first<{ tournament_id: string }>();
	if (!round) {
		throw new AuthzError(500, "ORPHAN_MATCH", "Match has no round");
	}
	const slotA = await loadSlot(env, match.slot_a_id);
	const slotB = match.slot_b_id ? await loadSlot(env, match.slot_b_id) : null;
	const slotAUserId = slotA?.user_id ?? null;
	const slotBUserId = slotB?.user_id ?? null;

	const isParticipant =
		session.user_id === slotAUserId || session.user_id === slotBUserId;
	const isAdmin = await isTournamentAdmin(env, session, round.tournament_id);
	if (!isParticipant && !isAdmin) {
		throw new AuthzError(
			403,
			"NOT_MATCH_PARTICIPANT",
			"Not a participant or admin for this match",
		);
	}
	return {
		matchId,
		tournamentId: round.tournament_id,
		isAdmin,
		slotAUserId,
		slotBUserId,
	};
}
