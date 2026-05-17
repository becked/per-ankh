// Authenticated player-facing tournament endpoints.
//
// Match reporting itself isn't here — the upload flow (handleGameUpload in
// games.ts) auto-reports a match when called with `tournament_match_id`,
// deriving the winner from the save data. Admin manual overrides go through
// the admin retro-edit endpoint in admin.ts.
//
// All handlers gate on the tournament beta allowlist via
// requireTournamentBeta. Non-beta users get 404 so they can't tell the
// feature exists.

import { sessionFromRequest, type SessionEnv } from "../session";
import { cloudCorsHeaders, errorResponse, jsonResponse } from "../util";
import { type TournamentEnv } from "./data";
import { AuthzError, requireTournamentBeta } from "./authz";

// Wraps the session lookup and the beta-gate check. Returns the session
// for handler use, or an errorResponse-ready 404 on miss.
async function authedBetaSession(
	env: TournamentPlayerEnv,
	request: Request,
	cors: Record<string, string>,
): Promise<
	| { ok: true; userId: string }
	| { ok: false; response: Response }
> {
	const session = await sessionFromRequest(env, request);
	if (!session) {
		// Anonymous → 404 from the beta gate; preserve the original 401
		// shape would leak that signed-in users can reach the endpoint.
		// Aligned with the rest of the beta-gated surface.
		return {
			ok: false,
			response: errorResponse(
				"Not found",
				404,
				cors,
				"TOURNAMENT_NOT_FOUND",
			),
		};
	}
	try {
		await requireTournamentBeta(env, session.data);
	} catch (e) {
		if (e instanceof AuthzError) {
			return {
				ok: false,
				response: errorResponse(e.message, e.status, cors, e.code),
			};
		}
		throw e;
	}
	return { ok: true, userId: session.data.user_id };
}

export interface TournamentPlayerEnv extends TournamentEnv, SessionEnv {
	ALLOWED_ORIGINS: string;
}

export async function handleMyTournaments(
	request: Request,
	env: TournamentPlayerEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const gate = await authedBetaSession(env, request, cors);
	if (!gate.ok) return gate.response;
	const res = await env.SHARE_DB.prepare(
		`SELECT DISTINCT t.tournament_id, t.slug, t.name, t.status,
		        s.slot_id, s.division, s.claim_banner_dismissed_at
		 FROM tournament_slots s
		 JOIN tournaments t ON t.tournament_id = s.tournament_id
		 WHERE s.user_id = ?
		 ORDER BY t.created_at DESC`,
	)
		.bind(gate.userId)
		.all<{
			tournament_id: string;
			slug: string;
			name: string;
			status: string;
			slot_id: string;
			division: string | null;
			claim_banner_dismissed_at: string | null;
		}>();
	return jsonResponse({ tournaments: res.results ?? [] }, 200, cors);
}

export async function handleMyAdminTournaments(
	request: Request,
	env: TournamentPlayerEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const gate = await authedBetaSession(env, request, cors);
	if (!gate.ok) return gate.response;
	const res = await env.SHARE_DB.prepare(
		`SELECT t.tournament_id, t.slug, t.name, t.status
		 FROM tournament_admins a
		 JOIN tournaments t ON t.tournament_id = a.tournament_id
		 WHERE a.user_id = ?
		 ORDER BY t.created_at DESC`,
	)
		.bind(gate.userId)
		.all<{
			tournament_id: string;
			slug: string;
			name: string;
			status: string;
		}>();
	return jsonResponse({ tournaments: res.results ?? [] }, 200, cors);
}

export async function handleMyMatches(
	request: Request,
	env: TournamentPlayerEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const gate = await authedBetaSession(env, request, cors);
	if (!gate.ok) return gate.response;
	// Match by slot.user_id (after slot claim). Returns all matches a
	// caller's slots have participated in, across all tournaments. DISTINCT
	// guards against an edge case where the caller owns both slots of one
	// match — no DB constraint prevents that and the OR-join would
	// otherwise return two rows for the same match.
	const res = await env.SHARE_DB.prepare(
		`SELECT DISTINCT m.match_id, m.round_id, m.slot_a_id, m.slot_b_id, m.map_script,
		        m.status, m.winner_slot_id, m.game_id, m.reported_at,
		        r.tournament_id, r.phase, r.division, r.round_number,
		        r.status AS round_status,
		        t.slug AS tournament_slug, t.name AS tournament_name
		 FROM tournament_matches m
		 JOIN tournament_rounds r ON r.round_id = m.round_id
		 JOIN tournaments t ON t.tournament_id = r.tournament_id
		 JOIN tournament_slots s ON s.slot_id = m.slot_a_id OR s.slot_id = m.slot_b_id
		 WHERE s.user_id = ?
		 ORDER BY m.created_at DESC
		 LIMIT 200`,
	)
		.bind(gate.userId)
		.all();
	return jsonResponse({ matches: res.results ?? [] }, 200, cors);
}

export async function handleDismissBanner(
	tournamentId: string,
	request: Request,
	env: TournamentPlayerEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const gate = await authedBetaSession(env, request, cors);
	if (!gate.ok) return gate.response;
	// 404 when the user has no slot in the tournament — keeps the API
	// consistent with the rest of the surface (every other endpoint that
	// names a tournament_id returns 404 when the caller has nothing to act
	// on). A second call after a successful dismiss is still 200 with
	// dismissed: 0, which is idempotent-correct.
	const slot = await env.SHARE_DB.prepare(
		`SELECT 1 AS ok FROM tournament_slots
		 WHERE tournament_id = ? AND user_id = ? LIMIT 1`,
	)
		.bind(tournamentId, gate.userId)
		.first<{ ok: number }>();
	if (!slot) {
		return errorResponse(
			"No slot in tournament for this user",
			404,
			cors,
			"NO_SLOT_IN_TOURNAMENT",
		);
	}
	const result = await env.SHARE_DB.prepare(
		`UPDATE tournament_slots SET claim_banner_dismissed_at = datetime('now')
		 WHERE tournament_id = ? AND user_id = ? AND claim_banner_dismissed_at IS NULL`,
	)
		.bind(tournamentId, gate.userId)
		.run();
	return jsonResponse({ dismissed: result.meta?.changes ?? 0 }, 200, cors);
}
