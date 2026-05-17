// Admin-only tournament endpoints. All require a tournament_admins row for
// the target tournament; the helper requireTournamentAdmin returns 403
// otherwise. None of these are CLI-only — the CLI is reserved for the
// tournament_admins grant itself (no API path for granting admin).

import { nanoid } from "nanoid";
import * as v from "valibot";
import {
	BulkCreateSlotsSchema,
	CreateTournamentSchema,
	PatchMatchSchema,
	PatchMatchMapSchema,
	PatchSlotSchema,
	PatchTournamentSchema,
	ReorderSlotsSchema,
	TransitionChampionshipSchema,
} from "../schemas/tournament";
import { sessionFromRequest, type SessionEnv } from "../session";
import { cloudCorsHeaders, errorResponse, jsonResponse } from "../util";
import { countEventsSince } from "../games";
import { logError } from "../log";
import {
	TOURNAMENT_ADMIN_ACTIONS_PER_HOUR,
	TOURNAMENT_CREATE_PER_USER_PER_HOUR,
} from "./limits";
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
	loadTournamentBySlug,
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
import type { Division, MatchRef, Phase, SlotRef } from "./types";

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
	// Per-user rate limit on admin mutations. Bounds the damage from a
	// stolen admin session (4 admins acting deliberately stay well below
	// the limit).
	const adminEventCount = await countEventsSince(
		env.SHARE_DB,
		"tournament_admin",
		"user_id",
		session.data.user_id,
	);
	if (adminEventCount >= TOURNAMENT_ADMIN_ACTIONS_PER_HOUR) {
		return {
			ok: false,
			response: errorResponse(
				"Tournament admin rate limit exceeded",
				429,
				cors,
				"RATE_LIMIT_TOURNAMENT_ADMIN",
			),
		};
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

// Fire-and-forget audit + rate-limit insert. Logged at the end of an admin
// handler's happy path so failed mutations don't leave audit ghosts. The
// same event_type drives the per-user rate limit (countEventsSince above),
// so every successful mutation counts toward the next hour's budget.
function logTournamentAdminAction(
	env: TournamentAdminEnv,
	userId: string,
	tournamentId: string,
	action: string,
	extra?: Record<string, unknown>,
): void {
	const metadata = JSON.stringify({
		action,
		tournament_id: tournamentId,
		...(extra ?? {}),
	});
	env.SHARE_DB.prepare(
		`INSERT INTO events (event_type, user_id, metadata)
		 VALUES ('tournament_admin', ?, ?)`,
	)
		.bind(userId, metadata)
		.run()
		.catch((e: unknown) => {
			logError("tournament_admin_audit_failed", e, {
				action,
				tournament_id: tournamentId,
				user_id: userId,
			});
		});
}

async function parseJsonBody<T>(
	request: Request,
	schema: v.GenericSchema<unknown, T>,
	cors: Record<string, string>,
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
	// Defense-in-depth against CSRF: SameSite=Lax already blocks
	// cross-origin POST in modern browsers, but an explicit Content-Type
	// check rejects form-encoded submissions that could otherwise reach a
	// JSON endpoint with a non-empty body.
	const rawType = request.headers.get("Content-Type") ?? "";
	const baseType = rawType.split(";", 1)[0].trim().toLowerCase();
	if (baseType !== "application/json") {
		return {
			ok: false,
			response: errorResponse(
				"Content-Type must be application/json",
				415,
				cors,
				"UNSUPPORTED_MEDIA_TYPE",
			),
		};
	}
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
// POST /v1/tournaments — anyone signed in can create a tournament.
// The creator becomes the sole tournament admin (CLI is still the only
// path for adding additional admins — out of scope until a future
// session adds a global-admin role).
// ----------------------------------------------------------------------

// Slugs that would collide with planned/anticipated frontend routes under
// /tournaments. Kept tight so we don't over-restrict legitimate naming;
// expand only when adding a real route that would conflict.
const RESERVED_SLUGS = new Set([
	"new",
	"create",
	"edit",
	"admin",
	"settings",
	"api",
]);

// Slug derivation for the no-slug create flow. Kebab-cases the name, drops
// non-[a-z0-9-] characters, collapses repeats, trims hyphens, truncates to
// 64 chars. Falls back to "tournament" if the sanitized result is empty
// (e.g. name is all emoji) — the caller then disambiguates with a suffix.
function deriveSlugFromName(name: string): string {
	const sanitized = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64)
		.replace(/-+$/g, "");
	return sanitized || "tournament";
}

// Resolve a final, unique slug. Tries the base first; on collision (or if
// the base is reserved), appends "-<short_nanoid>" and retries. The retry
// loop is bounded — if 8 attempts all collide, something is very wrong
// (the suffix alphabet alone gives ~17M variants per length-4 suffix).
async function resolveSlug(
	env: TournamentAdminEnv,
	base: string,
): Promise<string | null> {
	const candidates: string[] = [];
	if (!RESERVED_SLUGS.has(base)) candidates.push(base);
	for (let i = 0; i < 8; i++) {
		const suffix = nanoid(4)
			.toLowerCase()
			.replace(/[^a-z0-9]/g, "");
		if (!suffix) continue;
		const candidate = `${base.slice(0, 64 - 1 - suffix.length)}-${suffix}`;
		if (RESERVED_SLUGS.has(candidate)) continue;
		candidates.push(candidate);
	}
	for (const candidate of candidates) {
		const taken = await loadTournamentBySlug(env, candidate);
		if (!taken) return candidate;
	}
	return null;
}

export async function handleCreateTournament(
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	}

	// Per-user create-tournament rate limit. Bounds spam from a single
	// account; account creation itself is gated by Discord OAuth so
	// horizontal abuse costs real accounts.
	const createCount = await countEventsSince(
		env.SHARE_DB,
		"tournament_create",
		"user_id",
		session.data.user_id,
	);
	if (createCount >= TOURNAMENT_CREATE_PER_USER_PER_HOUR) {
		return errorResponse(
			"Tournament create rate limit exceeded",
			429,
			cors,
			"RATE_LIMIT_TOURNAMENT_CREATE",
		);
	}

	const body = await parseJsonBody(request, CreateTournamentSchema, cors);
	if (!body.ok) return body.response;
	const input = body.body;

	// Slug handling diverges by caller:
	//   - Explicit slug (admin CLI): reject reserved values + collisions
	//     up-front so the operator sees the conflict immediately.
	//   - No slug (public UI): derive from name and disambiguate.
	let slug: string;
	if (input.slug !== undefined) {
		if (RESERVED_SLUGS.has(input.slug)) {
			return errorResponse(
				`Slug "${input.slug}" is reserved`,
				400,
				cors,
				"SLUG_RESERVED",
			);
		}
		const existing = await loadTournamentBySlug(env, input.slug);
		if (existing) {
			return errorResponse(
				`Slug "${input.slug}" is taken`,
				409,
				cors,
				"SLUG_TAKEN",
			);
		}
		slug = input.slug;
	} else {
		const base = deriveSlugFromName(input.name);
		const resolved = await resolveSlug(env, base);
		if (!resolved) {
			return errorResponse(
				"Could not pick a unique slug for this name",
				500,
				cors,
				"SLUG_DERIVATION_FAILED",
			);
		}
		slug = resolved;
	}

	const tournamentId = nanoid(21);
	const divA = input.division_a_name?.trim() ?? "Division A";
	const divB = input.division_b_name?.trim() ?? "Division B";
	const description = input.description?.trim() || null;
	const allowedMapsJson = JSON.stringify(input.allowed_map_scripts);
	// Migration defaults: 5 / 3 / 3. Mirror them here so the API returns
	// the actual stored values without a re-load round-trip on the
	// happy path (we still re-load below to get created_at/updated_at).
	const swissMaxRounds = input.swiss_max_rounds ?? 5;
	const swissWinsToAdvance = input.swiss_wins_to_advance ?? 3;
	const swissLossesToEliminate = input.swiss_losses_to_eliminate ?? 3;

	const metadata = JSON.stringify({
		action: "tournament_created",
		tournament_id: tournamentId,
		slug,
	});

	try {
		await env.SHARE_DB.batch([
			env.SHARE_DB.prepare(
				`INSERT INTO tournaments (
				    tournament_id, slug, name, description, status,
				    division_a_name, division_b_name,
				    swiss_wins_to_advance, swiss_losses_to_eliminate, swiss_max_rounds,
				    allowed_map_scripts
				 ) VALUES (?, ?, ?, ?, 'setup', ?, ?, ?, ?, ?, ?)`,
			).bind(
				tournamentId,
				slug,
				input.name.trim(),
				description,
				divA,
				divB,
				swissWinsToAdvance,
				swissLossesToEliminate,
				swissMaxRounds,
				allowedMapsJson,
			),
			env.SHARE_DB.prepare(
				`INSERT INTO tournament_admins (tournament_id, user_id) VALUES (?, ?)`,
			).bind(tournamentId, session.data.user_id),
			env.SHARE_DB.prepare(
				`INSERT INTO events (event_type, user_id, metadata)
				 VALUES ('tournament_create', ?, ?)`,
			).bind(session.data.user_id, metadata),
		]);
	} catch (e) {
		// Race: another batch landed the same slug between our pre-check
		// and the INSERT. D1 surfaces the SQLite error; identify the slug
		// UNIQUE constraint specifically to return 409.
		const msg = e instanceof Error ? e.message : String(e);
		if (
			msg.includes("UNIQUE constraint failed") &&
			msg.includes("tournaments.slug")
		) {
			return errorResponse(`Slug "${slug}" is taken`, 409, cors, "SLUG_TAKEN");
		}
		throw e;
	}

	const created = await loadTournamentById(env, tournamentId);
	if (!created) {
		// Should never happen — we just inserted it. Surface as 500 so the
		// failure is visible rather than a confusing "success but blank
		// response".
		logError("tournament_create_post_insert_load_failed", null, {
			tournament_id: tournamentId,
		});
		return errorResponse(
			"Tournament created but failed to reload",
			500,
			cors,
			"TOURNAMENT_LOAD_FAILED",
		);
	}

	return jsonResponse(
		{
			tournament: {
				tournament_id: created.tournament_id,
				slug: created.slug,
				name: created.name,
				description: created.description,
				status: created.status,
				division_a_name: created.division_a_name,
				division_b_name: created.division_b_name,
				swiss_advance_count: created.swiss_advance_count,
				swiss_wins_to_advance: created.swiss_wins_to_advance,
				swiss_losses_to_eliminate: created.swiss_losses_to_eliminate,
				swiss_max_rounds: created.swiss_max_rounds,
				allowed_map_scripts: input.allowed_map_scripts,
				slot_counts: { swiss: 0, championship: 0 },
				is_viewer_admin: true,
				created_at: created.created_at,
				updated_at: created.updated_at,
			},
		},
		201,
		cors,
	);
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
	logTournamentAdminAction(env, a.userId, tournamentId, "tournament_patched", {
		fields_changed: Object.keys(patch).filter(
			(k) => patch[k as keyof typeof patch] !== undefined,
		),
	});
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
	logTournamentAdminAction(env, a.userId, tournamentId, "slots_bulk_created", {
		count: created.length,
	});
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
	logTournamentAdminAction(env, a.userId, tournamentId, "slot_patched", {
		slot_id: slotId,
		username_changed: usernameChanged,
	});
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
	logTournamentAdminAction(env, a.userId, tournamentId, "slot_deleted", {
		slot_id: slotId,
	});
	return new Response(null, { status: 204, headers: cors });
}

// ----------------------------------------------------------------------
// POST /v1/tournaments/:id/slots/reorder — reseed swiss-phase slots
//
// Admin reorders the seed list (drag-and-drop in the setup UI). Body carries
// the desired display order for both divisions; the server renumbers
// swiss_seed = 1..N within each and updates division for any slot that moved
// across. Setup-only — once round 1 has paired against the old seeds,
// reseeding would desync match history from the visible order.
// ----------------------------------------------------------------------

export async function handleReorderSlots(
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
			"Slots can only be reordered in 'setup' status",
			409,
			cors,
			"INVALID_PHASE",
		);
	}
	const body = await parseJsonBody(request, ReorderSlotsSchema, cors);
	if (!body.ok) return body.response;
	const { divisions } = body.body;

	const swissSlots = (await loadSlots(env, tournamentId)).filter(
		(s) => s.phase === "swiss",
	);
	const requested = [...divisions.A, ...divisions.B];
	const requestedSet = new Set(requested);
	if (requestedSet.size !== requested.length) {
		return errorResponse(
			"Duplicate slot_id in reorder payload",
			400,
			cors,
			"DUPLICATE_SLOT",
		);
	}
	const existingIds = new Set(swissSlots.map((s) => s.slot_id));
	if (
		requestedSet.size !== existingIds.size ||
		[...requestedSet].some((id) => !existingIds.has(id))
	) {
		return errorResponse(
			"Reorder payload must include every swiss-phase slot exactly once",
			400,
			cors,
			"INCOMPLETE_REORDER",
		);
	}

	// Two-phase rewrite: shift all current swiss_seeds to negative first, so
	// the per-slot UPDATEs that follow can assign 1..N without tripping the
	// UNIQUE (tournament_id, phase, division, swiss_seed) constraint
	// mid-batch. The unique index allows negatives, and no other code path
	// reads negative seeds — they're only visible inside this batch.
	const statements: D1PreparedStatement[] = [
		env.SHARE_DB.prepare(
			`UPDATE tournament_slots
			 SET swiss_seed = -swiss_seed
			 WHERE tournament_id = ? AND phase = 'swiss' AND swiss_seed IS NOT NULL`,
		).bind(tournamentId),
	];
	for (const division of ["A", "B"] as const) {
		divisions[division].forEach((slotId, index) => {
			statements.push(
				env.SHARE_DB.prepare(
					`UPDATE tournament_slots
					 SET division = ?, swiss_seed = ?
					 WHERE slot_id = ? AND tournament_id = ?`,
				).bind(division, index + 1, slotId, tournamentId),
			);
		});
	}
	statements.push(
		env.SHARE_DB.prepare(
			"UPDATE tournaments SET updated_at = datetime('now') WHERE tournament_id = ?",
		).bind(tournamentId),
	);
	await env.SHARE_DB.batch(statements);

	logTournamentAdminAction(env, a.userId, tournamentId, "slots_reordered", {
		count: requested.length,
		division_a: divisions.A.length,
		division_b: divisions.B.length,
	});
	const updated = await loadSlots(env, tournamentId);
	return jsonResponse(
		{ slots: updated.filter((s) => s.phase === "swiss").map(slotRowToRef) },
		200,
		cors,
	);
}

// ----------------------------------------------------------------------
// POST /v1/tournaments/:id/start
//
// One-shot: setup → swiss + generate Round 1 for both divisions. Replaces
// the old start-swiss / generate-round / start-round trio. After this,
// rounds advance automatically as matches report (see
// maybeAdvanceAfterMatchReport).
// ----------------------------------------------------------------------

export async function handleStartTournament(
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

	const mapsResult = parseAllowedMapsOrError(tournament, cors);
	if (!mapsResult.ok) return mapsResult.response;
	const allowedMaps = mapsResult.maps;

	const statements: D1PreparedStatement[] = [
		env.SHARE_DB.prepare(
			`UPDATE tournaments SET status = 'swiss', swiss_advance_count = ?,
			        updated_at = datetime('now')
			 WHERE tournament_id = ?`,
		).bind(advanceCount, tournamentId),
	];
	const summaries: { division: Division; round_id: string; matches: number }[] =
		[];
	for (const division of ["A", "B"] as const) {
		const divSlots = swissSlots
			.filter((s) => s.division === division)
			.map(slotRowToRef);
		const built = buildSwissRoundStatements(
			env,
			tournament,
			division,
			1,
			divSlots,
			[],
			allowedMaps,
		);
		statements.push(...built.statements);
		summaries.push({
			division,
			round_id: built.roundId,
			matches: built.matchCount,
		});
	}
	await env.SHARE_DB.batch(statements);
	const updated = await loadTournamentById(env, tournamentId);
	logTournamentAdminAction(env, a.userId, tournamentId, "tournament_started", {
		advance_count: advanceCount,
		rounds: summaries,
	});
	return jsonResponse({ tournament: updated, rounds: summaries }, 201, cors);
}

// ----------------------------------------------------------------------
// PATCH /v1/tournaments/:id/matches/:match_id/map — change the map for a
// pending or bye match. Slot identity is deliberately not patchable here;
// see PatchMatchMapSchema in cloud/src/schemas/tournament.ts for the
// rationale.
// ----------------------------------------------------------------------

export async function handlePatchMatchMap(
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
			"Can only edit map on a pending match",
			409,
			cors,
			"MATCH_NOT_PENDING",
		);
	}
	const body = await parseJsonBody(request, PatchMatchMapSchema, cors);
	if (!body.ok) return body.response;
	const patch = body.body;
	if (patch.map_script === undefined) {
		return jsonResponse({ match }, 200, cors);
	}
	await env.SHARE_DB.prepare(
		"UPDATE tournament_matches SET map_script = ? WHERE match_id = ?",
	)
		.bind(patch.map_script, matchId)
		.run();
	await bumpTournamentUpdatedAt(env, tournamentId);
	const updated = await loadMatch(env, matchId);
	logTournamentAdminAction(env, a.userId, tournamentId, "match_map_patched", {
		match_id: matchId,
	});
	return jsonResponse({ match: updated }, 200, cors);
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
	// 'complete'/'forfeit' require one. Validated against the post-patch
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
		(postStatus === "complete" || postStatus === "forfeit") &&
		postWinner == null
	) {
		return errorResponse(
			"winner_slot_id is required when status is 'complete' or 'forfeit'",
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
	logTournamentAdminAction(env, a.userId, tournamentId, "match_retro_edited", {
		match_id: matchId,
		fields_changed: Object.keys(patch).filter(
			(k) => patch[k as keyof typeof patch] !== undefined,
		),
	});
	// Forward transition (pending → non-pending) may complete the round.
	// Reverse transitions are intentional admin un-reports; leave any
	// already-auto-generated next round alone (admin can manually fix or
	// retro-edit further). See docs/tournament-implementation-notes.md.
	if (match.status === "pending" && postStatus !== "pending") {
		await maybeAdvanceAfterMatchReport(env, matchId);
	}
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
			   (round_id, tournament_id, phase, division, round_number, status,
			    generated_at, started_at)
			 VALUES (?, ?, 'championship', NULL, 1, 'in_progress',
			         datetime('now'), datetime('now'))`,
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
	logTournamentAdminAction(
		env,
		a.userId,
		tournamentId,
		"championship_transitioned",
		{
			round_id: roundId,
			advance_count: tournament.swiss_advance_count,
			override: !!override,
		},
	);
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

// Build the D1 statements to insert a swiss round + its matches. Pure
// builder so the caller can batch with other writes (e.g. the start-
// tournament path atomically writes both divisions' Round 1 plus the
// status flip in one batch). Rounds are always created in_progress —
// the `pending` state was removed when the admin "Start round" button
// was dropped.
function buildSwissRoundStatements(
	env: TournamentEnv,
	tournament: TournamentRow,
	division: Division,
	nextRoundNumber: number,
	divSlots: SlotRef[],
	divMatchRefs: MatchRef[],
	allowedMaps: string[],
): { statements: D1PreparedStatement[]; roundId: string; matchCount: number } {
	const config = tournamentConfig(tournament);
	const seed = `${tournament.tournament_id}|swiss|${division}|r${nextRoundNumber}`;
	const pairings: Pairing[] = pairSwissRound(
		divSlots,
		divMatchRefs,
		nextRoundNumber,
		config,
		seed,
	);
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
			   (round_id, tournament_id, phase, division, round_number, status,
			    generated_at, started_at)
			 VALUES (?, ?, 'swiss', ?, ?, 'in_progress',
			         datetime('now'), datetime('now'))`,
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
	return { statements, roundId, matchCount: withMaps.length };
}

// Build the D1 statements to insert a championship round (rounds 2+; round 1
// is built inline by handleTransitionChampionship). Caller supplies the
// pairings (derived from prior-round winners) so this function stays a
// pure builder.
function buildChampionshipRoundStatements(
	env: TournamentEnv,
	tournament: TournamentRow,
	nextRoundNumber: number,
	pairings: Pairing[],
	matchRefs: MatchRef[],
	allowedMaps: string[],
): { statements: D1PreparedStatement[]; roundId: string; matchCount: number } {
	const seed = `${tournament.tournament_id}|championship|r${nextRoundNumber}`;
	const withMaps = assignMapsToPairings(pairings, allowedMaps, matchRefs, seed);
	const roundId = nanoid(21);
	const statements: D1PreparedStatement[] = [
		env.SHARE_DB.prepare(
			`INSERT INTO tournament_rounds
			   (round_id, tournament_id, phase, division, round_number, status,
			    generated_at, started_at)
			 VALUES (?, ?, 'championship', NULL, ?, 'in_progress',
			         datetime('now'), datetime('now'))`,
		).bind(roundId, tournament.tournament_id, nextRoundNumber),
	];
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
	return { statements, roundId, matchCount: withMaps.length };
}

// System-triggered audit entry (no admin user_id). event_type is distinct
// from 'tournament_admin' so per-admin rate-limit queries naturally skip
// these rows and log inspection can separate human from automatic actions.
function logSystemTournamentAction(
	env: TournamentEnv,
	tournamentId: string,
	action: string,
	extra?: Record<string, unknown>,
): void {
	const metadata = JSON.stringify({
		action,
		tournament_id: tournamentId,
		...(extra ?? {}),
	});
	env.SHARE_DB.prepare(
		`INSERT INTO events (event_type, user_id, metadata)
		 VALUES ('tournament_system', NULL, ?)`,
	)
		.bind(metadata)
		.run()
		.catch((e: unknown) => {
			logError("tournament_system_audit_failed", e, {
				action,
				tournament_id: tournamentId,
			});
		});
}

// Called after any match transitions pending → non-pending (upload-reports
// from cloud/src/games.ts and admin retro-edits in handleRetroEditMatch).
// If the just-reported match completes its round, this auto-closes the
// round and either auto-generates the next round in that phase/division
// or auto-completes the tournament (championship final).
//
// Idempotent and best-effort: any failure logs but does not propagate.
// Skips when the work has already been done (race-safe against parallel
// reports racing the same round to completion).
export async function maybeAdvanceAfterMatchReport(
	env: TournamentEnv,
	matchId: string,
): Promise<void> {
	try {
		const match = await loadMatch(env, matchId);
		if (!match) return;
		const round = await loadRound(env, match.round_id);
		if (!round) return;
		const tournament = await loadTournamentById(env, round.tournament_id);
		if (!tournament) return;

		const allMatches = await loadMatches(env, tournament.tournament_id);
		const roundMatches = allMatches.filter(
			(m) => m.round_id === round.round_id,
		);
		if (roundMatches.some((m) => m.status === "pending")) return;

		const statements: D1PreparedStatement[] = [];

		// Close the just-completed round. WHERE guard makes the UPDATE
		// idempotent if a parallel report already closed it.
		if (round.status !== "complete") {
			statements.push(
				env.SHARE_DB.prepare(
					`UPDATE tournament_rounds SET status = 'complete', completed_at = datetime('now')
					 WHERE round_id = ? AND status != 'complete'`,
				).bind(round.round_id),
			);
		}

		const allRounds = await loadRounds(env, tournament.tournament_id);
		let auditAction = "round_closed";
		let auditMetadata: Record<string, unknown> = {
			round_id: round.round_id,
			phase: round.phase,
			division: round.division,
		};

		if (round.phase === "swiss") {
			const division = round.division as Division;
			const downstream = allRounds.find(
				(r) =>
					r.phase === "swiss" &&
					r.division === division &&
					r.round_number > round.round_number,
			);
			if (
				!downstream &&
				round.round_number < tournament.swiss_max_rounds &&
				tournament.status === "swiss"
			) {
				const slots = await loadSlots(env, tournament.tournament_id);
				const divSlots = slots
					.filter((s) => s.phase === "swiss" && s.division === division)
					.map(slotRowToRef);
				const matchRefs = await matchRefsForTournament(
					env,
					tournament.tournament_id,
					allMatches,
				);
				const divMatchRefs = matchRefs.filter((m) => m.division === division);
				const allowedMaps = parseAllowedMaps(tournament);
				const built = buildSwissRoundStatements(
					env,
					tournament,
					division,
					round.round_number + 1,
					divSlots,
					divMatchRefs,
					allowedMaps,
				);
				statements.push(...built.statements);
				auditAction = "round_generated";
				auditMetadata = {
					phase: "swiss",
					division,
					round_number: round.round_number + 1,
					round_id: built.roundId,
				};
			}
		} else {
			// championship
			const downstream = allRounds.find(
				(r) =>
					r.phase === "championship" && r.round_number > round.round_number,
			);
			if (!downstream && tournament.status === "championship") {
				if (roundMatches.length === 1) {
					// The just-closed round was the final.
					statements.push(
						env.SHARE_DB.prepare(
							`UPDATE tournaments SET status = 'complete', updated_at = datetime('now')
							 WHERE tournament_id = ? AND status = 'championship'`,
						).bind(tournament.tournament_id),
					);
					auditAction = "tournament_completed";
					auditMetadata = {
						round_id: round.round_id,
					};
				} else {
					// roundMatches is already in match_index order (loadMatches
					// orders by phase, division, round_number, match_index).
					const templates = buildChampionshipFollowupRound(roundMatches.length);
					const pairings: Pairing[] = templates.map((t) => ({
						slot_a_id: roundMatches[t.source_match_a_index - 1].winner_slot_id!,
						slot_b_id: roundMatches[t.source_match_b_index - 1].winner_slot_id!,
					}));
					const matchRefs = await matchRefsForTournament(
						env,
						tournament.tournament_id,
						allMatches,
					);
					const allowedMaps = parseAllowedMaps(tournament);
					const built = buildChampionshipRoundStatements(
						env,
						tournament,
						round.round_number + 1,
						pairings,
						matchRefs,
						allowedMaps,
					);
					statements.push(...built.statements);
					auditAction = "round_generated";
					auditMetadata = {
						phase: "championship",
						round_number: round.round_number + 1,
						round_id: built.roundId,
					};
				}
			}
		}

		if (statements.length === 0) return;

		statements.push(
			env.SHARE_DB.prepare(
				"UPDATE tournaments SET updated_at = datetime('now') WHERE tournament_id = ?",
			).bind(tournament.tournament_id),
		);
		await env.SHARE_DB.batch(statements);
		logSystemTournamentAction(
			env,
			tournament.tournament_id,
			auditAction,
			auditMetadata,
		);
	} catch (e) {
		logError("tournament_auto_advance_failed", e, { match_id: matchId });
	}
}
