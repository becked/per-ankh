// Admin-only tournament endpoints. All require a tournament_admins row for
// the target tournament; the helper requireTournamentAdmin returns 403
// otherwise. None of these are CLI-only — the CLI is reserved for the
// tournament_admins grant itself (no API path for granting admin).

import { nanoid } from "nanoid";
import * as v from "valibot";
import {
	BulkCreateSlotsSchema,
	GenerateRoundSchema,
	PatchMatchSchema,
	PatchPairingSchema,
	PatchSlotSchema,
	PatchTournamentSchema,
	TransitionChampionshipSchema,
} from "../schemas/tournament";
import { sessionFromRequest, type SessionEnv } from "../session";
import { cloudCorsHeaders, errorResponse, jsonResponse } from "../util";
import {
	advanceCountSuggestion,
	buildChampionshipFollowupRound,
	buildChampionshipRound1,
	buildChampionshipSeeds,
} from "./bracket";
import { assignMapsToPairings } from "./maps";
import { pairSwissRound, type Pairing } from "./pairing";
import {
	computeStandings,
	rankStandings,
	type RankedStanding,
} from "./standings";
import { AuthzError, requireTournamentAdmin } from "./authz";
import {
	bumpTournamentUpdatedAt,
	loadMatch,
	loadMatches,
	loadRound,
	loadRounds,
	loadSlot,
	loadSlotInTournament,
	loadSlots,
	loadTournamentById,
	MapConfigError,
	matchRowToRef,
	parseAllowedMaps,
	slotRowToRef,
	tournamentConfig,
	type MatchRow,
	type RoundRow,
	type SlotRow,
	type TournamentEnv,
	type TournamentRow,
} from "./data";
import type { Division, Phase } from "./types";

export interface TournamentAdminEnv extends TournamentEnv, SessionEnv {
	ALLOWED_ORIGINS: string;
}

// Helper: load tournament and verify caller is an admin. Returns null on
// any failure mode after sending the appropriate response back through the
// `respond` callback pattern. Saves ~10 lines per handler.
async function authedTournament(
	tournamentId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<
	| { ok: true; tournament: TournamentRow; userId: string }
	| { ok: false; response: Response }
> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return {
			ok: false,
			response: errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED"),
		};
	}
	try {
		await requireTournamentAdmin(env, session.data, tournamentId);
	} catch (e) {
		if (e instanceof AuthzError) {
			return {
				ok: false,
				response: errorResponse(e.message, e.status, cors, e.code),
			};
		}
		throw e;
	}
	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament) {
		return {
			ok: false,
			response: errorResponse(
				"Tournament not found",
				404,
				cors,
				"TOURNAMENT_NOT_FOUND",
			),
		};
	}
	return { ok: true, tournament, userId: session.data.user_id };
}

async function parseJsonBody<T>(
	request: Request,
	schema: v.GenericSchema<unknown, T>,
	cors: Record<string, string>,
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		return {
			ok: false,
			response: errorResponse("Invalid JSON body", 400, cors, "INVALID_JSON"),
		};
	}
	const result = v.safeParse(schema, parsed);
	if (!result.success) {
		return {
			ok: false,
			response: errorResponse(
				`Invalid body: ${result.issues[0]?.message ?? "unknown"}`,
				400,
				cors,
				"INVALID_BODY",
			),
		};
	}
	return { ok: true, body: result.output };
}

// Wrap parseAllowedMaps so the corrupted-config case becomes an explicit
// 500 with MAP_CONFIG_INVALID rather than propagating into assignMap as a
// misleading "allowedMaps must be non-empty" 500. Reachable only via
// direct-DB tampering — the write paths (PATCH schema + CLI create) both
// enforce a non-empty string array.
function parseAllowedMapsOrError(
	tournament: TournamentRow,
	cors: Record<string, string>,
): { ok: true; maps: string[] } | { ok: false; response: Response } {
	try {
		return { ok: true, maps: parseAllowedMaps(tournament) };
	} catch (e) {
		if (e instanceof MapConfigError) {
			return {
				ok: false,
				response: errorResponse(e.message, 500, cors, "MAP_CONFIG_INVALID"),
			};
		}
		throw e;
	}
}

// ----------------------------------------------------------------------
// PATCH /v1/tournaments/:id — edit metadata
// ----------------------------------------------------------------------

export async function handlePatchTournament(
	tournamentId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;
	const { tournament } = a;

	const body = await parseJsonBody(request, PatchTournamentSchema, cors);
	if (!body.ok) return body.response;
	const patch = body.body;

	// Some fields are locked once the tournament has started.
	const locked = tournament.status !== "setup";
	if (
		locked &&
		(patch.swiss_advance_count !== undefined ||
			patch.swiss_wins_to_advance !== undefined ||
			patch.swiss_losses_to_eliminate !== undefined ||
			patch.swiss_max_rounds !== undefined ||
			patch.allowed_map_scripts !== undefined)
	) {
		return errorResponse(
			"Cannot edit Swiss config after the tournament has started",
			409,
			cors,
			"TOURNAMENT_LOCKED",
		);
	}

	const fragments: string[] = [];
	const binds: unknown[] = [];
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) continue;
		if (key === "allowed_map_scripts") {
			fragments.push(`${key} = ?`);
			binds.push(JSON.stringify(value));
		} else {
			fragments.push(`${key} = ?`);
			binds.push(value);
		}
	}
	if (fragments.length === 0) {
		return jsonResponse({ tournament }, 200, cors);
	}
	binds.push(tournamentId);
	await env.SHARE_DB.prepare(
		`UPDATE tournaments SET ${fragments.join(", ")}, updated_at = datetime('now') WHERE tournament_id = ?`,
	)
		.bind(...binds)
		.run();
	const updated = await loadTournamentById(env, tournamentId);
	return jsonResponse({ tournament: updated }, 200, cors);
}

// ----------------------------------------------------------------------
// POST /v1/tournaments/:id/slots — bulk create swiss slots
// ----------------------------------------------------------------------

export async function handleBulkCreateSlots(
	tournamentId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;
	const { tournament } = a;
	if (tournament.status !== "setup") {
		return errorResponse(
			"Slots can only be added in 'setup' status",
			409,
			cors,
			"INVALID_PHASE",
		);
	}
	const body = await parseJsonBody(request, BulkCreateSlotsSchema, cors);
	if (!body.ok) return body.response;
	const newSlots = body.body;

	// Verify no duplicate discord_usernames within the tournament (existing or
	// in the same batch).
	const existing = await loadSlots(env, tournamentId);
	const taken = new Set(
		existing
			.filter((s) => s.discord_username && s.phase === "swiss")
			.map((s) => s.discord_username as string),
	);
	const batchSet = new Set<string>();
	for (const s of newSlots) {
		if (taken.has(s.discord_username)) {
			return errorResponse(
				`Discord username already used: ${s.discord_username}`,
				409,
				cors,
				"DUPLICATE_USERNAME",
			);
		}
		if (batchSet.has(s.discord_username)) {
			return errorResponse(
				`Duplicate within batch: ${s.discord_username}`,
				400,
				cors,
				"DUPLICATE_USERNAME",
			);
		}
		batchSet.add(s.discord_username);
	}

	// Determine swiss_seed for any slots that didn't specify one.
	const nextSeedByDiv: Record<Division, number> = {
		A: 1,
		B: 1,
	};
	for (const s of existing) {
		if (s.phase === "swiss" && s.division && s.swiss_seed !== null) {
			const div = s.division as Division;
			nextSeedByDiv[div] = Math.max(nextSeedByDiv[div], s.swiss_seed + 1);
		}
	}

	const statements: D1PreparedStatement[] = [];
	const created: { slot_id: string; division: Division; swiss_seed: number }[] =
		[];
	for (const s of newSlots) {
		const seed = s.swiss_seed ?? nextSeedByDiv[s.division]++;
		const slotId = nanoid(21);
		statements.push(
			env.SHARE_DB.prepare(
				`INSERT INTO tournament_slots
				   (slot_id, tournament_id, phase, division, swiss_seed, discord_username)
				 VALUES (?, ?, 'swiss', ?, ?, ?)`,
			).bind(slotId, tournamentId, s.division, seed, s.discord_username),
		);
		created.push({ slot_id: slotId, division: s.division, swiss_seed: seed });
	}
	statements.push(
		env.SHARE_DB.prepare(
			"UPDATE tournaments SET updated_at = datetime('now') WHERE tournament_id = ?",
		).bind(tournamentId),
	);
	await env.SHARE_DB.batch(statements);
	return jsonResponse({ created }, 201, cors);
}

// ----------------------------------------------------------------------
// PATCH /v1/tournaments/:id/slots/:slot_id — edit slot (substitution)
// DELETE /v1/tournaments/:id/slots/:slot_id — delete slot
// ----------------------------------------------------------------------

export async function handlePatchSlot(
	tournamentId: string,
	slotId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;
	const { tournament } = a;
	const slot = await loadSlot(env, slotId);
	if (!slot || slot.tournament_id !== tournamentId) {
		return errorResponse("Slot not found", 404, cors, "SLOT_NOT_FOUND");
	}
	const body = await parseJsonBody(request, PatchSlotSchema, cors);
	if (!body.ok) return body.response;
	const patch = body.body;

	// Substitution: changing discord_username clears user_id + discord_id so
	// the new occupant must log in and re-claim.
	const usernameChanged =
		patch.discord_username !== undefined &&
		patch.discord_username !== slot.discord_username;

	if (
		patch.division !== undefined &&
		tournament.status !== "setup" &&
		patch.division !== slot.division
	) {
		return errorResponse(
			"Cannot change division after the tournament has started",
			409,
			cors,
			"TOURNAMENT_LOCKED",
		);
	}

	const fragments: string[] = [];
	const binds: unknown[] = [];
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) continue;
		fragments.push(`${key} = ?`);
		binds.push(value);
	}
	if (usernameChanged) {
		fragments.push("user_id = NULL", "discord_id = NULL");
	}
	if (fragments.length === 0) {
		return jsonResponse({ slot }, 200, cors);
	}
	binds.push(slotId);
	await env.SHARE_DB.prepare(
		`UPDATE tournament_slots SET ${fragments.join(", ")} WHERE slot_id = ?`,
	)
		.bind(...binds)
		.run();

	if (usernameChanged) {
		// Audit substitution
		try {
			await env.SHARE_DB.prepare(
				`INSERT INTO events (event_type, user_id, metadata)
				 VALUES ('tournament_slot_substituted', ?, ?)`,
			)
				.bind(
					a.userId,
					JSON.stringify({
						tournament_id: tournamentId,
						slot_id: slotId,
						old_username: slot.discord_username,
						new_username: patch.discord_username,
					}),
				)
				.run();
		} catch {
			// audit failures don't break the operation
		}
	}

	await bumpTournamentUpdatedAt(env, tournamentId);
	const updated = await loadSlot(env, slotId);
	return jsonResponse({ slot: updated }, 200, cors);
}

export async function handleDeleteSlot(
	tournamentId: string,
	slotId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;
	const { tournament } = a;
	if (tournament.status !== "setup") {
		return errorResponse(
			"Slots can only be deleted in 'setup' status",
			409,
			cors,
			"INVALID_PHASE",
		);
	}
	const result = await env.SHARE_DB.prepare(
		"DELETE FROM tournament_slots WHERE slot_id = ? AND tournament_id = ?",
	)
		.bind(slotId, tournamentId)
		.run();
	if ((result.meta?.changes ?? 0) === 0) {
		return errorResponse("Slot not found", 404, cors, "SLOT_NOT_FOUND");
	}
	await bumpTournamentUpdatedAt(env, tournamentId);
	return new Response(null, { status: 204, headers: cors });
}

// ----------------------------------------------------------------------
// POST /v1/tournaments/:id/start-swiss
// ----------------------------------------------------------------------

export async function handleStartSwiss(
	tournamentId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;
	const { tournament } = a;
	if (tournament.status !== "setup") {
		return errorResponse(
			"Tournament has already started",
			409,
			cors,
			"INVALID_PHASE",
		);
	}
	const slots = await loadSlots(env, tournamentId);
	const swissSlots = slots.filter((s) => s.phase === "swiss");
	if (swissSlots.length === 0) {
		return errorResponse("No slots in tournament", 409, cors, "NO_SLOTS");
	}
	const divA = swissSlots.filter((s) => s.division === "A").length;
	const divB = swissSlots.filter((s) => s.division === "B").length;
	if (divA === 0 || divB === 0) {
		return errorResponse(
			"Both divisions must have at least one slot",
			409,
			cors,
			"DIVISION_EMPTY",
		);
	}
	const advanceCount =
		tournament.swiss_advance_count ?? advanceCountSuggestion(divA, divB);
	if (advanceCount < 1) {
		return errorResponse(
			"Computed advance count is zero — too few players",
			409,
			cors,
			"INSUFFICIENT_PLAYERS",
		);
	}
	// Fail-fast: advance_count > smaller division's size is unrecoverable.
	// Without this, the tournament starts, plays through Swiss, and only
	// hits INSUFFICIENT_ADVANCERS at transition-championship time. The
	// bound is min(divA, divB) (not /2) — computeStandings ranks every
	// slot regardless of active/eliminated status, so eliminations don't
	// shrink the candidate pool.
	const smallerDiv = Math.min(divA, divB);
	if (advanceCount > smallerDiv) {
		return errorResponse(
			`swiss_advance_count (${advanceCount}) exceeds smaller division's size (${smallerDiv})`,
			409,
			cors,
			"ADVANCE_COUNT_TOO_LARGE",
		);
	}
	await env.SHARE_DB.prepare(
		`UPDATE tournaments SET status = 'swiss', swiss_advance_count = ?, updated_at = datetime('now')
		 WHERE tournament_id = ?`,
	)
		.bind(advanceCount, tournamentId)
		.run();
	const updated = await loadTournamentById(env, tournamentId);
	return jsonResponse({ tournament: updated }, 200, cors);
}

// ----------------------------------------------------------------------
// POST /v1/tournaments/:id/rounds — generate next round
// Body: { division?: 'A'|'B' } for swiss; division ignored for championship.
// ----------------------------------------------------------------------

export async function handleGenerateRound(
	tournamentId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;
	const { tournament } = a;
	if (tournament.status !== "swiss" && tournament.status !== "championship") {
		return errorResponse(
			"Cannot generate a round outside swiss/championship phase",
			409,
			cors,
			"INVALID_PHASE",
		);
	}
	const body = await parseJsonBody(request, GenerateRoundSchema, cors);
	if (!body.ok) return body.response;
	const reqBody = body.body;

	if (tournament.status === "swiss") {
		if (!reqBody.division) {
			return errorResponse(
				"division required when generating a swiss round",
				400,
				cors,
				"DIVISION_REQUIRED",
			);
		}
		return generateSwissRound(env, tournament, reqBody.division, cors);
	}
	// championship: generate next round from winners
	return generateChampionshipFollowup(env, tournament, cors);
}

async function generateSwissRound(
	env: TournamentAdminEnv,
	tournament: TournamentRow,
	division: Division,
	cors: Record<string, string>,
): Promise<Response> {
	const rounds = await loadRounds(env, tournament.tournament_id);
	const divRounds = rounds.filter(
		(r) => r.phase === "swiss" && r.division === division,
	);
	const nextRoundNumber = divRounds.length + 1;

	if (nextRoundNumber > tournament.swiss_max_rounds) {
		return errorResponse(
			`Already past max swiss rounds (${tournament.swiss_max_rounds})`,
			409,
			cors,
			"MAX_ROUNDS_REACHED",
		);
	}

	const allMatches = await loadMatches(env, tournament.tournament_id);

	// Auto-close any prior round in this division: in_progress → complete
	// if all matches are reported. The dedicated Close button was dropped;
	// closing is implicit on advance.
	for (const r of divRounds) {
		const closeResult = await autoCloseRoundIfReady(env, r, allMatches);
		if (!closeResult.ok) {
			return errorResponse(closeResult.reason, 409, cors, closeResult.code);
		}
	}

	const allSlots = await loadSlots(env, tournament.tournament_id);
	const divSlots = allSlots
		.filter((s) => s.phase === "swiss" && s.division === division)
		.map(slotRowToRef);

	const matchRefs = await matchRefsForTournament(
		env,
		tournament.tournament_id,
		allMatches,
	);
	const divMatchRefs = matchRefs.filter((m) => m.division === division);

	const config = tournamentConfig(tournament);
	const seed = `${tournament.tournament_id}|swiss|${division}|r${nextRoundNumber}`;
	const pairings: Pairing[] = pairSwissRound(
		divSlots,
		divMatchRefs,
		nextRoundNumber,
		config,
		seed,
	);

	const mapsResult = parseAllowedMapsOrError(tournament, cors);
	if (!mapsResult.ok) return mapsResult.response;
	const allowedMaps = mapsResult.maps;
	const withMaps = assignMapsToPairings(
		pairings,
		allowedMaps,
		divMatchRefs,
		seed,
	);

	const roundId = nanoid(21);
	const statements: D1PreparedStatement[] = [
		env.SHARE_DB.prepare(
			`INSERT INTO tournament_rounds
			   (round_id, tournament_id, phase, division, round_number, status, generated_at)
			 VALUES (?, ?, 'swiss', ?, ?, 'pending', datetime('now'))`,
		).bind(roundId, tournament.tournament_id, division, nextRoundNumber),
	];
	for (let i = 0; i < withMaps.length; i++) {
		const p = withMaps[i];
		const matchId = nanoid(21);
		const isBye = p.slot_b_id === null;
		statements.push(
			env.SHARE_DB.prepare(
				`INSERT INTO tournament_matches
				   (match_id, round_id, slot_a_id, slot_b_id, map_script,
				    pick_order_winner_slot_id, status, winner_slot_id, match_index)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).bind(
				matchId,
				roundId,
				p.slot_a_id,
				p.slot_b_id,
				p.map_script,
				isBye ? null : p.slot_b_id, // default pick-order to slot_b
				isBye ? "bye" : "pending",
				isBye ? p.slot_a_id : null,
				i + 1,
			),
		);
	}
	statements.push(
		env.SHARE_DB.prepare(
			"UPDATE tournaments SET updated_at = datetime('now') WHERE tournament_id = ?",
		).bind(tournament.tournament_id),
	);
	await env.SHARE_DB.batch(statements);
	return jsonResponse(
		{ round_id: roundId, matches: withMaps.length },
		201,
		cors,
	);
}

async function generateChampionshipFollowup(
	env: TournamentAdminEnv,
	tournament: TournamentRow,
	cors: Record<string, string>,
): Promise<Response> {
	const rounds = await loadRounds(env, tournament.tournament_id);
	const champRounds = rounds.filter((r) => r.phase === "championship");
	if (champRounds.length === 0) {
		return errorResponse(
			"No championship round 1 yet; call /transition-championship first",
			409,
			cors,
			"NO_CHAMPIONSHIP",
		);
	}
	const lastRound = champRounds[champRounds.length - 1];
	const allMatches = await loadMatches(env, tournament.tournament_id);
	// Auto-close the prior championship round if it's in_progress and all
	// matches are reported. Implicit close on advance (the dedicated Close
	// button was dropped).
	const closeResult = await autoCloseRoundIfReady(env, lastRound, allMatches);
	if (!closeResult.ok) {
		return errorResponse(closeResult.reason, 409, cors, closeResult.code);
	}
	// loadMatches orders by (phase, division, round_number, match_index,
	// created_at), so filtering to one round yields match_index order.
	const priorMatches = allMatches.filter(
		(m) => m.round_id === lastRound.round_id,
	);

	if (priorMatches.length === 1) {
		// That was the final.
		return errorResponse(
			"Championship final already played; mark tournament complete",
			409,
			cors,
			"CHAMPIONSHIP_FINISHED",
		);
	}

	for (const m of priorMatches) {
		if (!m.winner_slot_id) {
			return errorResponse(
				"All prior matches must have winners before generating the next round",
				409,
				cors,
				"MISSING_WINNERS",
			);
		}
	}

	const templates = buildChampionshipFollowupRound(priorMatches.length);
	const nextRoundNumber = lastRound.round_number + 1;
	const roundId = nanoid(21);
	const statements: D1PreparedStatement[] = [
		env.SHARE_DB.prepare(
			`INSERT INTO tournament_rounds
			   (round_id, tournament_id, phase, division, round_number, status, generated_at)
			 VALUES (?, ?, 'championship', NULL, ?, 'pending', datetime('now'))`,
		).bind(roundId, tournament.tournament_id, nextRoundNumber),
	];

	// Build new championship slots inheriting from prior winners — but actually
	// the spec is to reuse championship slots across rounds (each player keeps
	// the same slot through the bracket). The winners are slot IDs from
	// existing championship slots. So no new slots; matches reference
	// existing slot_ids.
	const pairings: Pairing[] = [];
	for (const t of templates) {
		const winnerA = priorMatches[t.source_match_a_index - 1].winner_slot_id!;
		const winnerB = priorMatches[t.source_match_b_index - 1].winner_slot_id!;
		pairings.push({ slot_a_id: winnerA, slot_b_id: winnerB });
	}

	const matchRefs = await matchRefsForTournament(
		env,
		tournament.tournament_id,
		allMatches,
	);
	const mapsResult = parseAllowedMapsOrError(tournament, cors);
	if (!mapsResult.ok) return mapsResult.response;
	const allowedMaps = mapsResult.maps;
	const seed = `${tournament.tournament_id}|championship|r${nextRoundNumber}`;
	const withMaps = assignMapsToPairings(pairings, allowedMaps, matchRefs, seed);

	for (let i = 0; i < withMaps.length; i++) {
		const p = withMaps[i];
		const matchId = nanoid(21);
		statements.push(
			env.SHARE_DB.prepare(
				`INSERT INTO tournament_matches
				   (match_id, round_id, slot_a_id, slot_b_id, map_script,
				    pick_order_winner_slot_id, status, winner_slot_id, match_index)
				 VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`,
			).bind(
				matchId,
				roundId,
				p.slot_a_id,
				p.slot_b_id,
				p.map_script,
				p.slot_b_id,
				i + 1,
			),
		);
	}
	statements.push(
		env.SHARE_DB.prepare(
			"UPDATE tournaments SET updated_at = datetime('now') WHERE tournament_id = ?",
		).bind(tournament.tournament_id),
	);
	await env.SHARE_DB.batch(statements);
	return jsonResponse(
		{ round_id: roundId, matches: withMaps.length },
		201,
		cors,
	);
}

// ----------------------------------------------------------------------
// PATCH /v1/tournaments/:id/matches/:match_id/pairing — edit pairing
// ----------------------------------------------------------------------

export async function handlePatchPairing(
	tournamentId: string,
	matchId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;
	const match = await loadMatch(env, matchId);
	if (!match) {
		return errorResponse("Match not found", 404, cors, "MATCH_NOT_FOUND");
	}
	// Scope the match to the URL's tournament before any other check —
	// otherwise MATCH_NOT_PENDING would leak existence of a reported match
	// in a different tournament to an admin of this one.
	const round = await loadRound(env, match.round_id);
	if (!round || round.tournament_id !== tournamentId) {
		return errorResponse("Match not found", 404, cors, "MATCH_NOT_FOUND");
	}
	if (match.status !== "pending" && match.status !== "bye") {
		return errorResponse(
			"Can only edit pairing on a pending match",
			409,
			cors,
			"MATCH_NOT_PENDING",
		);
	}
	const body = await parseJsonBody(request, PatchPairingSchema, cors);
	if (!body.ok) return body.response;
	const patch = body.body;

	// Validate each slot ID supplied in the patch: must exist, belong to
	// this tournament, and match the round's phase + division.
	for (const slotId of [
		patch.slot_a_id,
		patch.slot_b_id,
		patch.pick_order_winner_slot_id,
	]) {
		if (slotId == null) continue;
		const slot = await loadSlotInTournament(env, slotId, tournamentId);
		if (!slot) {
			return errorResponse(
				"Slot not in tournament",
				400,
				cors,
				"SLOT_NOT_IN_TOURNAMENT",
			);
		}
		if (slot.phase !== round.phase || slot.division !== round.division) {
			return errorResponse(
				"Slot phase/division does not match round",
				400,
				cors,
				"SLOT_PHASE_MISMATCH",
			);
		}
	}

	// Enforce pick_order_winner_slot_id ∈ {slot_a_id, slot_b_id} against the
	// POST-patch state — caller may be changing slot_a/slot_b in the same body.
	const postA = patch.slot_a_id ?? match.slot_a_id;
	const postB = patch.slot_b_id ?? match.slot_b_id;
	const postPickWinner =
		"pick_order_winner_slot_id" in patch
			? patch.pick_order_winner_slot_id
			: match.pick_order_winner_slot_id;
	if (
		postPickWinner != null &&
		postPickWinner !== postA &&
		postPickWinner !== postB
	) {
		return errorResponse(
			"pick_order_winner_slot_id must be one of slot_a_id or slot_b_id",
			400,
			cors,
			"PICK_ORDER_WINNER_NOT_IN_MATCH",
		);
	}

	const fragments: string[] = [];
	const binds: unknown[] = [];
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) continue;
		fragments.push(`${key} = ?`);
		binds.push(value);
	}
	if (fragments.length === 0) return jsonResponse({ match }, 200, cors);
	binds.push(matchId);
	await env.SHARE_DB.prepare(
		`UPDATE tournament_matches SET ${fragments.join(", ")} WHERE match_id = ?`,
	)
		.bind(...binds)
		.run();
	await bumpTournamentUpdatedAt(env, tournamentId);
	const updated = await loadMatch(env, matchId);
	return jsonResponse({ match: updated }, 200, cors);
}

// ----------------------------------------------------------------------
// POST /v1/tournaments/:id/rounds/:round_id/start
// POST /v1/tournaments/:id/rounds/:round_id/close
// ----------------------------------------------------------------------

export async function handleStartRound(
	tournamentId: string,
	roundId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;
	const round = await loadRound(env, roundId);
	if (!round || round.tournament_id !== tournamentId) {
		return errorResponse("Round not found", 404, cors, "ROUND_NOT_FOUND");
	}
	if (round.status !== "pending") {
		return errorResponse(
			`Round is ${round.status}`,
			409,
			cors,
			"INVALID_ROUND_STATUS",
		);
	}
	await env.SHARE_DB.prepare(
		`UPDATE tournament_rounds SET status = 'in_progress', started_at = datetime('now')
		 WHERE round_id = ?`,
	)
		.bind(roundId)
		.run();
	await bumpTournamentUpdatedAt(env, tournamentId);
	return jsonResponse({ round_id: roundId, status: "in_progress" }, 200, cors);
}

// ----------------------------------------------------------------------
// PATCH /v1/tournaments/:id/matches/:match_id — retro-edit
//
// Refuses with 409 if any downstream round has any non-pending match
// (for swiss: same division, higher round_number, OR tournament already
// in championship phase; for championship: any later round with reported
// matches).
// ----------------------------------------------------------------------

export async function handleRetroEditMatch(
	tournamentId: string,
	matchId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;
	const { tournament } = a;
	const match = await loadMatch(env, matchId);
	if (!match) {
		return errorResponse("Match not found", 404, cors, "MATCH_NOT_FOUND");
	}
	const round = await loadRound(env, match.round_id);
	if (!round || round.tournament_id !== tournamentId) {
		return errorResponse("Match not found", 404, cors, "MATCH_NOT_FOUND");
	}

	// Downstream guard
	const blockReason = await downstreamBlocked(
		env,
		tournament,
		round.phase,
		round.division,
		round.round_number,
	);
	if (blockReason) {
		return errorResponse(blockReason, 409, cors, "DOWNSTREAM_BLOCKED");
	}

	const body = await parseJsonBody(request, PatchMatchSchema, cors);
	if (!body.ok) return body.response;
	const patch = body.body;

	// winner_slot_id must be one of this match's two slots. Schema only
	// validates nanoid shape, so without this an admin could mark the
	// match as won by a stranger's slot.
	if (patch.winner_slot_id != null) {
		if (
			patch.winner_slot_id !== match.slot_a_id &&
			patch.winner_slot_id !== match.slot_b_id
		) {
			return errorResponse(
				"winner_slot_id must be one of slot_a_id or slot_b_id",
				400,
				cors,
				"WINNER_NOT_IN_MATCH",
			);
		}
		// Defense in depth: confirm the slot row actually exists in this
		// tournament. Guards against retro-editing a match that references
		// an orphaned slot ID.
		const winnerSlot = await loadSlotInTournament(
			env,
			patch.winner_slot_id,
			tournamentId,
		);
		if (!winnerSlot) {
			return errorResponse(
				"Winner slot not in tournament",
				400,
				cors,
				"SLOT_NOT_IN_TOURNAMENT",
			);
		}
	}

	// Status ↔ winner_slot_id invariant. status='pending' forbids a winner;
	// 'reported'/'forfeit' require one. Validated against the post-patch
	// state so callers may patch either field independently. The UI always
	// sends both, but we don't trust that.
	if (patch.status === "pending") {
		if (patch.winner_slot_id != null) {
			return errorResponse(
				"winner_slot_id must be null when status is 'pending'",
				400,
				cors,
				"WINNER_REQUIRES_NON_PENDING_STATUS",
			);
		}
		// Force-clear in case patch.winner_slot_id was absent. Mutates patch
		// so the existing UPDATE loop emits SET winner_slot_id = NULL.
		patch.winner_slot_id = null;
	}
	const postStatus = patch.status ?? match.status;
	const postWinner =
		"winner_slot_id" in patch ? patch.winner_slot_id : match.winner_slot_id;
	if (
		(postStatus === "reported" || postStatus === "forfeit") &&
		postWinner == null
	) {
		return errorResponse(
			"winner_slot_id is required when status is 'reported' or 'forfeit'",
			400,
			cors,
			"WINNER_REQUIRED_FOR_STATUS",
		);
	}

	const fragments: string[] = [];
	const binds: unknown[] = [];
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) continue;
		fragments.push(`${key} = ?`);
		binds.push(value);
	}
	if (fragments.length === 0) return jsonResponse({ match }, 200, cors);
	binds.push(matchId);
	await env.SHARE_DB.prepare(
		`UPDATE tournament_matches SET ${fragments.join(", ")} WHERE match_id = ?`,
	)
		.bind(...binds)
		.run();
	await bumpTournamentUpdatedAt(env, tournamentId);
	const updated = await loadMatch(env, matchId);
	return jsonResponse({ match: updated }, 200, cors);
}

async function downstreamBlocked(
	env: TournamentEnv,
	tournament: TournamentRow,
	phase: Phase,
	division: Division | null,
	roundNumber: number,
): Promise<string | null> {
	if (phase === "swiss" && tournament.status === "championship") {
		return "Championship has started; Swiss edits would invalidate it";
	}
	const rounds = await loadRounds(env, tournament.tournament_id);
	const downstream = rounds.filter((r) => {
		if (r.phase !== phase) return false;
		if (phase === "swiss" && r.division !== division) return false;
		return r.round_number > roundNumber;
	});
	for (const r of downstream) {
		const cnt = await env.SHARE_DB.prepare(
			"SELECT COUNT(*) AS count FROM tournament_matches WHERE round_id = ? AND status != 'pending'",
		)
			.bind(r.round_id)
			.first<{ count: number }>();
		if (cnt && cnt.count > 0) {
			return `Round ${r.round_number} (${r.phase}${r.division ? ` div ${r.division}` : ""}) has reported matches`;
		}
	}
	return null;
}

// ----------------------------------------------------------------------
// POST /v1/tournaments/:id/transition-championship
//
// Body (optional): { override_ranks: { A: [slot_ids], B: [slot_ids] } }
// When provided, uses the admin's explicit ranking. Otherwise applies the
// cascade and returns 409 if there's a tie at the cutoff.
// ----------------------------------------------------------------------

export async function handleTransitionChampionship(
	tournamentId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;
	const { tournament } = a;
	if (tournament.status !== "swiss") {
		return errorResponse(
			"Tournament is not in 'swiss' phase",
			409,
			cors,
			"INVALID_PHASE",
		);
	}
	if (tournament.swiss_advance_count === null) {
		return errorResponse(
			"swiss_advance_count not set",
			409,
			cors,
			"NO_ADVANCE_COUNT",
		);
	}

	// Auto-close any in_progress Swiss rounds that have all matches
	// reported. Pending matches (or pending-status rounds) still block.
	const rounds = await loadRounds(env, tournamentId);
	const swissRounds = rounds.filter((r) => r.phase === "swiss");
	const matches = await loadMatches(env, tournamentId);
	for (const r of swissRounds) {
		const closeResult = await autoCloseRoundIfReady(env, r, matches);
		if (!closeResult.ok) {
			return errorResponse(closeResult.reason, 409, cors, closeResult.code);
		}
	}

	const body = await parseJsonBody(request, TransitionChampionshipSchema, cors);
	if (!body.ok) return body.response;
	const override = body.body.override_ranks;

	// Compute rankings per division (or use override).
	const slots = await loadSlots(env, tournamentId);
	const matchRefs = await matchRefsForTournament(env, tournamentId, matches);
	const config = tournamentConfig(tournament);

	const advancersByDiv: Record<Division, string[]> = { A: [], B: [] };
	for (const division of ["A", "B"] as const) {
		if (override) {
			const ids = override[division] ?? [];
			if (ids.length < tournament.swiss_advance_count) {
				return errorResponse(
					`override_ranks.${division} must include at least ${tournament.swiss_advance_count} slot IDs`,
					400,
					cors,
					"INVALID_OVERRIDE",
				);
			}
			const chosen = ids.slice(0, tournament.swiss_advance_count);
			// Validate each override slot up-front. Previously a bad ID would
			// trip the eventual sourceSlot.find at line ~1120 and 500 with
			// SOURCE_SLOT_MISSING — surface specific 4xx errors instead.
			for (const slotId of chosen) {
				const slot = slots.find((s) => s.slot_id === slotId);
				if (!slot) {
					return errorResponse(
						`Override slot ${slotId} not in tournament`,
						400,
						cors,
						"OVERRIDE_SLOT_NOT_IN_TOURNAMENT",
					);
				}
				if (slot.phase !== "swiss") {
					return errorResponse(
						`Override slot ${slotId} is not a swiss-phase slot`,
						400,
						cors,
						"OVERRIDE_SLOT_WRONG_PHASE",
					);
				}
				if (slot.division !== division) {
					return errorResponse(
						`Override slot ${slotId} is in division ${slot.division ?? "null"}, not ${division}`,
						400,
						cors,
						"OVERRIDE_SLOT_WRONG_DIVISION",
					);
				}
			}
			advancersByDiv[division] = chosen;
			continue;
		}
		const divSlots = slots
			.filter((s) => s.phase === "swiss" && s.division === division)
			.map(slotRowToRef);
		const divMatches = matchRefs.filter((m) => m.division === division);
		const standings = computeStandings(divSlots, divMatches, config);
		const ranked = rankStandings(standings);

		// Cascade tie at cutoff: the slot at rank (N) and the slot at rank
		// (N+1) (or any slot at rank N tied with a slot at rank N+1) is
		// blocked.
		const cutoff = tournament.swiss_advance_count;
		if (ranked.length < cutoff) {
			return errorResponse(
				`Division ${division} has ${ranked.length} slots but advance_count is ${cutoff}`,
				409,
				cors,
				"INSUFFICIENT_ADVANCERS",
			);
		}
		const tied = collectTiedAtCutoff(ranked, cutoff);
		if (tied.length > 0) {
			return errorResponse(
				"Cascade tied at advance cutoff",
				409,
				cors,
				"CASCADE_TIE_AT_CUTOFF",
				{
					division,
					tied_slot_ids: tied,
					ranked: ranked.map((r) => ({
						slot_id: r.slot_id,
						rank: r.rank,
						wins: r.wins,
						losses: r.losses,
						median_buchholz: r.median_buchholz,
						solkoff: r.solkoff,
					})),
				},
			);
		}
		advancersByDiv[division] = ranked.slice(0, cutoff).map((r) => r.slot_id);
	}

	// Build championship slots
	const seeds = buildChampionshipSeeds(
		tournament.swiss_advance_count,
		advancersByDiv.A.length,
		advancersByDiv.B.length,
	);
	const round1Templates = buildChampionshipRound1(seeds.length);
	const roundId = nanoid(21);

	const statements: D1PreparedStatement[] = [];
	const championshipSlotIds: Record<number, string> = {};

	for (const s of seeds) {
		const sourceSlotId =
			s.source_division === "A"
				? advancersByDiv.A[s.source_rank - 1]
				: advancersByDiv.B[s.source_rank - 1];
		const sourceSlot = slots.find((row) => row.slot_id === sourceSlotId);
		if (!sourceSlot) {
			return errorResponse(
				`Internal: source slot ${sourceSlotId} not found`,
				500,
				cors,
				"SOURCE_SLOT_MISSING",
			);
		}
		const newSlotId = nanoid(21);
		championshipSlotIds[s.championship_seed] = newSlotId;
		statements.push(
			env.SHARE_DB.prepare(
				`INSERT INTO tournament_slots
				   (slot_id, tournament_id, phase, division, championship_seed,
				    discord_username, discord_id, user_id)
				 VALUES (?, ?, 'championship', NULL, ?, ?, ?, ?)`,
			).bind(
				newSlotId,
				tournamentId,
				s.championship_seed,
				sourceSlot.discord_username,
				sourceSlot.discord_id,
				sourceSlot.user_id,
			),
		);
	}

	statements.push(
		env.SHARE_DB.prepare(
			`INSERT INTO tournament_rounds
			   (round_id, tournament_id, phase, division, round_number, status, generated_at)
			 VALUES (?, ?, 'championship', NULL, 1, 'pending', datetime('now'))`,
		).bind(roundId, tournamentId),
	);

	const mapsResult = parseAllowedMapsOrError(tournament, cors);
	if (!mapsResult.ok) return mapsResult.response;
	const allowedMaps = mapsResult.maps;
	const matchPairings: Pairing[] = round1Templates.map((t) => ({
		slot_a_id: championshipSlotIds[t.seed_a]!,
		slot_b_id: championshipSlotIds[t.seed_b]!,
	}));
	const seed = `${tournamentId}|championship|r1`;
	const withMaps = assignMapsToPairings(
		matchPairings,
		allowedMaps,
		matchRefs,
		seed,
	);
	for (let i = 0; i < withMaps.length; i++) {
		const p = withMaps[i];
		const matchId = nanoid(21);
		statements.push(
			env.SHARE_DB.prepare(
				`INSERT INTO tournament_matches
				   (match_id, round_id, slot_a_id, slot_b_id, map_script,
				    pick_order_winner_slot_id, status, winner_slot_id, match_index)
				 VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`,
			).bind(
				matchId,
				roundId,
				p.slot_a_id,
				p.slot_b_id,
				p.map_script,
				p.slot_b_id,
				i + 1,
			),
		);
	}

	statements.push(
		env.SHARE_DB.prepare(
			`UPDATE tournaments SET status = 'championship', updated_at = datetime('now')
			 WHERE tournament_id = ?`,
		).bind(tournamentId),
	);
	await env.SHARE_DB.batch(statements);
	return jsonResponse(
		{
			status: "championship",
			round_id: roundId,
			matches: withMaps.length,
			advancers: advancersByDiv,
		},
		201,
		cors,
	);
}

function collectTiedAtCutoff(
	ranked: RankedStanding[],
	cutoff: number,
): string[] {
	// If the slot at index cutoff-1 shares its rank with the slot at index
	// cutoff, the cascade left a tie that bridges the cutoff.
	if (cutoff <= 0 || cutoff >= ranked.length) return [];
	const insideRank = ranked[cutoff - 1].rank;
	const outsideRank = ranked[cutoff].rank;
	if (insideRank !== outsideRank) return [];
	return ranked.filter((r) => r.rank === insideRank).map((r) => r.slot_id);
}

// ----------------------------------------------------------------------
// POST /v1/tournaments/:id/complete
// ----------------------------------------------------------------------

export async function handleCompleteTournament(
	tournamentId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;
	const { tournament } = a;
	if (tournament.status !== "championship") {
		return errorResponse(
			"Tournament is not in 'championship' phase",
			409,
			cors,
			"INVALID_PHASE",
		);
	}
	// Find the final match (last championship round, single match, with winner).
	const rounds = await loadRounds(env, tournamentId);
	const champRounds = rounds.filter((r) => r.phase === "championship");
	if (champRounds.length === 0) {
		return errorResponse(
			"No championship rounds",
			409,
			cors,
			"NO_CHAMPIONSHIP",
		);
	}
	const lastRound = champRounds[champRounds.length - 1];
	const allMatches = await loadMatches(env, tournamentId);
	const lastMatches = allMatches.filter(
		(m) => m.round_id === lastRound.round_id,
	);
	if (lastMatches.length !== 1 || !lastMatches[0].winner_slot_id) {
		return errorResponse(
			"Final has not been decided",
			409,
			cors,
			"FINAL_INCOMPLETE",
		);
	}
	// Auto-close the final round if it's still in_progress.
	const closeResult = await autoCloseRoundIfReady(env, lastRound, allMatches);
	if (!closeResult.ok) {
		return errorResponse(closeResult.reason, 409, cors, closeResult.code);
	}
	await env.SHARE_DB.prepare(
		`UPDATE tournaments SET status = 'complete', updated_at = datetime('now')
		 WHERE tournament_id = ?`,
	)
		.bind(tournamentId)
		.run();
	return jsonResponse({ status: "complete" }, 200, cors);
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

// Auto-close a round on advance: if status='in_progress' and every match
// is non-pending, flip to status='complete'. Used by generateRound,
// transition-championship, and complete-tournament to remove the explicit
// "Close round" step from the admin workflow. Pending matches still
// block the advance.
async function autoCloseRoundIfReady(
	env: TournamentEnv,
	round: RoundRow,
	allMatches: MatchRow[],
): Promise<{ ok: true } | { ok: false; reason: string; code: string }> {
	if (round.status === "complete") return { ok: true };
	if (round.status === "pending") {
		return {
			ok: false,
			reason: `Round ${round.round_number}${round.division ? ` (div ${round.division})` : ""} hasn't been started yet`,
			code: "PRIOR_ROUND_NOT_STARTED",
		};
	}
	const roundMatches = allMatches.filter((m) => m.round_id === round.round_id);
	const pendingMatches = roundMatches.filter((m) => m.status === "pending");
	if (pendingMatches.length > 0) {
		return {
			ok: false,
			reason: `Round ${round.round_number}${round.division ? ` (div ${round.division})` : ""} has ${pendingMatches.length} unreported match(es)`,
			code: "PRIOR_ROUND_PENDING_MATCHES",
		};
	}
	await env.SHARE_DB.prepare(
		`UPDATE tournament_rounds SET status = 'complete', completed_at = datetime('now')
		 WHERE round_id = ?`,
	)
		.bind(round.round_id)
		.run();
	return { ok: true };
}

async function matchRefsForTournament(
	env: TournamentEnv,
	tournamentId: string,
	matchRows: MatchRow[],
) {
	const rounds = await loadRounds(env, tournamentId);
	const roundById = new Map(rounds.map((r) => [r.round_id, r]));
	return matchRows.map((m) => {
		const r = roundById.get(m.round_id)!;
		return matchRowToRef(m, {
			round_number: r.round_number,
			phase: r.phase,
			division: r.division,
		});
	});
}
