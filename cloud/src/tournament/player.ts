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

import { nanoid } from "nanoid";
import { logError } from "../log";
import { TournamentSignupSchema } from "../schemas/tournament";
import { sessionFromRequest, type SessionEnv } from "../session";
import {
	cloudCorsHeaders,
	errorResponse,
	jsonResponse,
	parseJsonBody,
} from "../util";
import {
	bumpTournamentUpdatedAt,
	loadTournamentById,
	type TournamentEnv,
} from "./data";
import { AuthzError, requireTournamentBeta } from "./authz";

// Wraps the session lookup and the beta-gate check. Returns the session
// for handler use, or an errorResponse-ready 404 on miss.
async function authedBetaSession(
	env: TournamentPlayerEnv,
	request: Request,
	cors: Record<string, string>,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
	const session = await sessionFromRequest(env, request);
	if (!session) {
		// Anonymous → 404 from the beta gate; preserve the original 401
		// shape would leak that signed-in users can reach the endpoint.
		// Aligned with the rest of the beta-gated surface.
		return {
			ok: false,
			response: errorResponse("Not found", 404, cors, "TOURNAMENT_NOT_FOUND"),
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
		        m.slot_a_username, m.slot_a_user_id, m.slot_b_username, m.slot_b_user_id,
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

// ----------------------------------------------------------------------
// POST /v1/tournaments/:id/signup — self-service enrollment.
//
// The mirror of admin.handleBulkCreateSlots: same final state in the DB
// (a tournament_slots row with discord_username + division + swiss_seed),
// just initiated by the player and with user_id + discord_id populated up
// front. Gated on status='setup' AND signups_open=1; auto-closes via the
// signups_open=0 update in handleStartTournament.
// ----------------------------------------------------------------------

export async function handleTournamentSignup(
	tournamentId: string,
	request: Request,
	env: TournamentPlayerEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		// 404 not 401 — keep the player-signup surface consistent with the rest
		// of the beta-gated API, which never tells anonymous callers that
		// signed-in users would reach a different result.
		return errorResponse("Not found", 404, cors, "TOURNAMENT_NOT_FOUND");
	}
	try {
		await requireTournamentBeta(env, session.data);
	} catch (e) {
		if (e instanceof AuthzError) {
			return errorResponse(e.message, e.status, cors, e.code);
		}
		throw e;
	}

	const body = await parseJsonBody(request, TournamentSignupSchema, cors);
	if (!body.ok) return body.response;
	const { division } = body.body;
	// Normalize a trimmed-empty answer to null so "answered with whitespace"
	// and "didn't answer" are the same stored state.
	const signupAnswer =
		body.body.signup_answer && body.body.signup_answer.length > 0
			? body.body.signup_answer
			: null;

	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament) {
		return errorResponse("Not found", 404, cors, "TOURNAMENT_NOT_FOUND");
	}
	if (tournament.status !== "setup" || tournament.signups_open !== 1) {
		return errorResponse(
			"Signups are not open for this tournament",
			409,
			cors,
			"SIGNUPS_CLOSED",
		);
	}

	// Pull the caller's pinned discord_id from the users table. The session
	// only carries discord_username (mutable); discord_id is the stable key
	// other parts of the system join on (e.g. handleDiscordCallback's
	// slot-claim path matches by discord_id first). Storing it on the slot
	// up-front means a Discord rename won't orphan their seat.
	const user = await env.SHARE_DB.prepare(
		"SELECT discord_id, display_name FROM users WHERE user_id = ?",
	)
		.bind(session.data.user_id)
		.first<{ discord_id: string; display_name: string | null }>();
	if (!user) {
		return errorResponse("Not found", 404, cors, "TOURNAMENT_NOT_FOUND");
	}

	// Compute next swiss_seed for the chosen division. Seeds aren't dense
	// after a withdraw — that's fine, pairing handles arbitrary seeds and
	// the admin renumbers via reorderSlots before starting.
	const seedRow = await env.SHARE_DB.prepare(
		`SELECT COALESCE(MAX(swiss_seed), 0) + 1 AS next_seed
		 FROM tournament_slots
		 WHERE tournament_id = ? AND phase = 'swiss' AND division = ?`,
	)
		.bind(tournamentId, division)
		.first<{ next_seed: number }>();
	const nextSeed = seedRow?.next_seed ?? 1;
	const slotId = nanoid(21);

	// Atomic insert + uniqueness check. The WHERE NOT EXISTS subquery makes
	// "one slot per user per swiss tournament" race-safe even without a
	// partial unique index: two concurrent signups by the same user collapse
	// to one INSERT, the loser sees meta.changes === 0 below and gets 409.
	const result = await env.SHARE_DB.prepare(
		`INSERT INTO tournament_slots
		   (slot_id, tournament_id, phase, division, swiss_seed,
		    discord_username, discord_id, user_id, signup_answer, created_at)
		 SELECT ?, ?, 'swiss', ?, ?, ?, ?, ?, ?, datetime('now')
		 WHERE NOT EXISTS (
		   SELECT 1 FROM tournament_slots
		   WHERE tournament_id = ? AND user_id = ? AND phase = 'swiss'
		 )`,
	)
		.bind(
			slotId,
			tournamentId,
			division,
			nextSeed,
			session.data.discord_username,
			user.discord_id,
			session.data.user_id,
			signupAnswer,
			tournamentId,
			session.data.user_id,
		)
		.run();

	if ((result.meta?.changes ?? 0) === 0) {
		return errorResponse(
			"You're already signed up for this tournament",
			409,
			cors,
			"ALREADY_SIGNED_UP",
		);
	}

	await bumpTournamentUpdatedAt(env, tournamentId);

	// Audit, fire-and-forget — matches the tournament_slot_substituted
	// pattern in admin.ts (audit failures don't break the operation).
	env.SHARE_DB.prepare(
		`INSERT INTO events (event_type, user_id, metadata)
		 VALUES ('tournament_self_signup', ?, ?)`,
	)
		.bind(
			session.data.user_id,
			JSON.stringify({
				tournament_id: tournamentId,
				slot_id: slotId,
				division,
			}),
		)
		.run()
		.catch((e: unknown) => {
			logError("tournament_self_signup_audit_failed", e, {
				user_id: session.data.user_id,
				tournament_id: tournamentId,
			});
		});

	return jsonResponse(
		{
			slot: {
				slot_id: slotId,
				division,
				swiss_seed: nextSeed,
			},
		},
		201,
		cors,
	);
}

// ----------------------------------------------------------------------
// DELETE /v1/tournaments/:id/signup — self-withdraw from a tournament.
//
// Allowed any time the tournament is still in 'setup' — even if the admin
// has flipped signups_open back to 0. A player who has signed up should
// always be able to drop out before the tournament starts; only NEW
// signups are gated on signups_open.
// ----------------------------------------------------------------------

export async function handleTournamentWithdraw(
	tournamentId: string,
	request: Request,
	env: TournamentPlayerEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Not found", 404, cors, "TOURNAMENT_NOT_FOUND");
	}
	try {
		await requireTournamentBeta(env, session.data);
	} catch (e) {
		if (e instanceof AuthzError) {
			return errorResponse(e.message, e.status, cors, e.code);
		}
		throw e;
	}

	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament) {
		return errorResponse("Not found", 404, cors, "TOURNAMENT_NOT_FOUND");
	}
	if (tournament.status !== "setup") {
		return errorResponse(
			"Can't withdraw after the tournament has started",
			409,
			cors,
			"TOURNAMENT_STARTED",
		);
	}

	// Pull slot_id first so the audit metadata can name what was deleted.
	const existing = await env.SHARE_DB.prepare(
		`SELECT slot_id, division
		 FROM tournament_slots
		 WHERE tournament_id = ? AND user_id = ? AND phase = 'swiss'
		 LIMIT 1`,
	)
		.bind(tournamentId, session.data.user_id)
		.first<{ slot_id: string; division: string }>();
	if (!existing) {
		return errorResponse(
			"You're not signed up for this tournament",
			404,
			cors,
			"NOT_SIGNED_UP",
		);
	}

	const result = await env.SHARE_DB.prepare(
		`DELETE FROM tournament_slots
		 WHERE slot_id = ? AND user_id = ?`,
	)
		.bind(existing.slot_id, session.data.user_id)
		.run();
	if ((result.meta?.changes ?? 0) === 0) {
		// Lost a race with a concurrent admin delete. Same final state, so
		// treat as success.
		return new Response(null, { status: 204, headers: cors });
	}

	await bumpTournamentUpdatedAt(env, tournamentId);

	env.SHARE_DB.prepare(
		`INSERT INTO events (event_type, user_id, metadata)
		 VALUES ('tournament_self_withdraw', ?, ?)`,
	)
		.bind(
			session.data.user_id,
			JSON.stringify({
				tournament_id: tournamentId,
				slot_id: existing.slot_id,
				division: existing.division,
			}),
		)
		.run()
		.catch((e: unknown) => {
			logError("tournament_self_withdraw_audit_failed", e, {
				user_id: session.data.user_id,
				tournament_id: tournamentId,
			});
		});

	return new Response(null, { status: 204, headers: cors });
}
