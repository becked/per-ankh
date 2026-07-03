// Admin-only tournament endpoints. All require a tournament_admins row for
// the target tournament; the helper requireTournamentAdmin returns 403
// otherwise. handleCreateTournament is the one exception that doesn't gate
// on requireTournamentAdmin — it only requires a session, and inserts the
// caller's user_id into tournament_admins as part of the create batch.
// Granting admin to a second user on an existing tournament is CLI-only.
//
// handlePatchMatchSchedule is the second exception: it accepts a tournament
// admin OR either participant in the match (via authedMatchScheduler), so a
// player can schedule their own upcoming game without an admin.

import { nanoid } from "nanoid";
import * as v from "valibot";
import {
	BulkCreateSlotsSchema,
	CreateTournamentSchema,
	GrantAdminSchema,
	PatchMatchSchema,
	PatchMatchMapSchema,
	PatchMatchPartsSchema,
	PatchSlotSchema,
	PatchTournamentSchema,
	ReorderSlotsSchema,
	TransitionChampionshipSchema,
} from "../schemas/tournament";
import { sessionFromRequest, type SessionEnv } from "../session";
import { isSiteAdmin } from "../admin";
import { buildAvatarUrl } from "../auth";
import { displayNameSql } from "../identity";
import {
	cloudCorsHeaders,
	errorResponse,
	jsonResponse,
	parseJsonBody,
} from "../util";
import { countEventsSince } from "../games";
import { logError } from "../log";
import {
	TOURNAMENT_ADMIN_ACTIONS_PER_HOUR,
	TOURNAMENT_CREATE_PER_USER_PER_HOUR,
	TOURNAMENT_SCHEDULE_ACTIONS_PER_HOUR,
} from "./limits";
import {
	buildChampionshipFollowupRound,
	buildChampionshipRound1,
} from "./bracket";
import { assignMapsToPairings } from "./maps";
import { pairSwissRound, type Pairing } from "./pairing";
import { computeStandings, rankStandings } from "./standings";
import { AuthzError, isTournamentBeta, requireTournamentAdmin } from "./authz";
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
	parseMapPool,
	parseParts,
	slotRowToRef,
	tournamentConfig,
	type MatchPart,
	type MatchPartCaster,
	type MatchPartStream,
	type MatchRow,
	type RoundRow,
	type SlotRow,
	type TournamentEnv,
	type TournamentRow,
} from "./data";
import {
	CANONICAL_MAP_OPTIONS,
	CANONICAL_MAP_OPTION_DEFAULTS,
	CANONICAL_SCRIPT_OPTIONS,
} from "./canonical-map-options";
import type { Division, MapPoolEntry, MatchRef, Phase, SlotRef } from "./types";

// ---------- Map-pool helpers ----------

// Shape of a map_pool entry as it arrives from the schema (id optional — the
// maps panel sends new entries without one).
type MapPoolEntryInput = {
	id?: string;
	script: string;
	options?: Record<string, string | boolean>;
};

// Validate one instance's options against its script's applicable set + the
// canonical manifest. Returns the cleaned options on success.
function validateInstanceOptions(
	script: string,
	options: Record<string, string | boolean>,
):
	| { ok: true; value: Record<string, string | boolean> }
	| {
			ok: false;
			message: string;
	  } {
	const applicable = CANONICAL_SCRIPT_OPTIONS[script];
	if (!applicable) {
		return {
			ok: false,
			message: `script "${script}" has no known options manifest`,
		};
	}
	const applicableSet = new Set(applicable);
	const cleaned: Record<string, string | boolean> = {};
	for (const [optKey, optVal] of Object.entries(options)) {
		if (!applicableSet.has(optKey)) {
			return {
				ok: false,
				message: `option "${optKey}" does not apply to script "${script}"`,
			};
		}
		const def = CANONICAL_MAP_OPTIONS[optKey];
		if (!def) {
			return {
				ok: false,
				message: `option "${optKey}" is not a canonical map option`,
			};
		}
		if (def.kind === "toggle") {
			if (typeof optVal !== "boolean") {
				return {
					ok: false,
					message: `option "${optKey}" expects boolean, got ${typeof optVal}`,
				};
			}
			cleaned[optKey] = optVal;
		} else {
			if (typeof optVal !== "string") {
				return {
					ok: false,
					message: `option "${optKey}" expects string choice, got ${typeof optVal}`,
				};
			}
			if (!def.choices.includes(optVal)) {
				return {
					ok: false,
					message: `option "${optKey}" got invalid choice "${optVal}"`,
				};
			}
			cleaned[optKey] = optVal;
		}
	}
	return { ok: true, value: cleaned };
}

// Pre-populate every applicable option for a script with the instance's value
// (when set) or the XML default — mirrors the in-game lobby, which shows all
// options. Drops options that don't apply. Assumes `options` is already
// validated by validateInstanceOptions.
function reconcileInstanceOptions(
	script: string,
	options: Record<string, string | boolean>,
): Record<string, string | boolean> {
	const applicable = CANONICAL_SCRIPT_OPTIONS[script] ?? [];
	const next: Record<string, string | boolean> = {};
	for (const optKey of applicable) {
		if (Object.prototype.hasOwnProperty.call(options, optKey)) {
			next[optKey] = options[optKey];
		} else {
			next[optKey] = CANONICAL_MAP_OPTION_DEFAULTS[optKey] ?? false;
		}
	}
	return next;
}

// Build the canonical, reconciled map_pool from validated schema input.
// Assigns an id to any entry without one (new entries from the maps panel)
// and repairs duplicate ids, then validates + reconciles each entry's options.
function buildMapPool(
	input: readonly MapPoolEntryInput[],
): { ok: true; pool: MapPoolEntry[] } | { ok: false; message: string } {
	const pool: MapPoolEntry[] = [];
	const seenIds = new Set<string>();
	for (const entry of input) {
		const valid = validateInstanceOptions(entry.script, entry.options ?? {});
		if (!valid.ok) return valid;
		let id = entry.id;
		if (!id || seenIds.has(id)) id = nanoid(12);
		seenIds.add(id);
		pool.push({
			id,
			script: entry.script,
			options: reconcileInstanceOptions(entry.script, valid.value),
		});
	}
	return { ok: true, pool };
}

// Shallow value-equality for an instance's options (keys are option zTypes,
// values are string | boolean — no nesting).
function sameOptions(
	a: Record<string, string | boolean>,
	b: Record<string, string | boolean>,
): boolean {
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return false;
	return keys.every((k) => a[k] === b[k]);
}

// Enforce the append-only rule for a started tournament's map pool: every
// existing instance must reappear in `next` unchanged (same script + options),
// and `next` may otherwise add new instances. Returns a human-readable reason
// on violation, or null if `next` is a valid append of `existing`.
function appendOnlyViolation(
	existing: MapPoolEntry[],
	next: MapPoolEntry[],
): string | null {
	const nextById = new Map(next.map((e) => [e.id, e]));
	for (const prev of existing) {
		const now = nextById.get(prev.id);
		if (!now) {
			return "Existing maps can't be removed after the tournament has started";
		}
		if (now.script !== prev.script || !sameOptions(prev.options, now.options)) {
			return "Existing maps can't be changed after the tournament has started — you can only add new maps";
		}
	}
	return null;
}

export interface TournamentAdminEnv extends TournamentEnv, SessionEnv {
	ALLOWED_ORIGINS: string;
}

// Helper: load tournament and verify caller is an admin. Returns null on
// any failure mode after sending the appropriate response back through the
// `respond` callback pattern. Saves ~10 lines per handler.
//
// Gate order: anon → admin. Anonymous callers get 401; an authed non-admin
// gets 403 NOT_TOURNAMENT_ADMIN.
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
			response: errorResponse(
				"Authentication required",
				401,
				cors,
				"UNAUTHORIZED",
			),
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

// Durable audit + rate-limit insert. Awaited (not fire-and-forget) so the write
// can't be canceled by response teardown on the Workers runtime — an audit log
// must not silently drop events (issue #75). Logged at the end of an admin
// handler's happy path so failed mutations don't leave audit ghosts. The
// same event_type drives the per-user rate limit (countEventsSince above),
// so every successful mutation counts toward the next hour's budget. The .catch
// stays a backstop: a failed audit must not 500 a mutation that already
// committed, but await gives the write a full chance to land first.
async function logTournamentAdminAction(
	env: TournamentAdminEnv,
	userId: string,
	tournamentId: string,
	action: string,
	extra?: Record<string, unknown>,
): Promise<void> {
	const metadata = JSON.stringify({
		action,
		tournament_id: tournamentId,
		...(extra ?? {}),
	});
	await env.SHARE_DB.prepare(
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

// Wrap parseMapPool so JSON-shape corruption becomes an explicit 500 with
// MAP_CONFIG_INVALID rather than propagating into assignMap as a misleading
// 500. Reachable only via direct-DB tampering — schema-validated writes always
// produce a well-formed pool. Empty pools are legal (admin can create a
// tournament without maps and pick them later); the setup → swiss transition
// rejects empty separately with MAP_CONFIG_EMPTY.
function parseMapPoolOrError(
	tournament: TournamentRow,
	cors: Record<string, string>,
): { ok: true; pool: MapPoolEntry[] } | { ok: false; response: Response } {
	try {
		return { ok: true, pool: parseMapPool(tournament) };
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

// FSM-consistency check on Swiss thresholds. Run from create + patch.
// Returns an error message on failure, null on success.
//
// Rules:
//   1. swiss_wins_to_advance ≤ swiss_max_rounds — no one could ever clinch
//      if it took more wins than rounds.
//   2. swiss_wins_to_advance + swiss_losses_to_eliminate ≤ swiss_max_rounds + 1
//      — guarantees a player alternating W-L reaches a verdict by max_rounds.
//      Without this, some players may finish Swiss with status='active' and
//      no resolution (they would not auto-qualify into the bracket).
//
// `swiss_losses_to_eliminate ≤ swiss_max_rounds` is implied by rule 2 plus
// rule 1 (both ≥ 1).
function validateSwissThresholds(
	maxRounds: number,
	winsToAdvance: number,
	lossesToEliminate: number,
): string | null {
	if (winsToAdvance > maxRounds) {
		return `swiss_wins_to_advance (${winsToAdvance}) cannot exceed swiss_max_rounds (${maxRounds})`;
	}
	if (winsToAdvance + lossesToEliminate > maxRounds + 1) {
		return `swiss_wins_to_advance + swiss_losses_to_eliminate (${winsToAdvance + lossesToEliminate}) must be ≤ swiss_max_rounds + 1 (${maxRounds + 1}); otherwise some players may finish Swiss with no verdict`;
	}
	return null;
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
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}
	// Create stays allowlist-only — the one surviving beta gate. A logged-in
	// caller who isn't on the allowlist gets a plain 403 (not the 404 the
	// hidden-feature gate used to throw).
	if (!(await isTournamentBeta(env, session.data))) {
		return errorResponse(
			"Tournament creation is limited to approved organizers",
			403,
			cors,
			"TOURNAMENT_CREATE_FORBIDDEN",
		);
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
	// map_pool is optional on create — the public modal asks for name +
	// description only, leaving map selection to the tournament settings page.
	// Empty here is legal in 'setup'; the setup → swiss transition enforces
	// non-empty before match generation. Each entry's options are validated +
	// reconciled (XML defaults for unset options); ids are assigned here.
	const builtPool = buildMapPool(input.map_pool ?? []);
	if (!builtPool.ok) {
		return errorResponse(builtPool.message, 400, cors, "MAP_OPTIONS_INVALID");
	}
	const mapPool = builtPool.pool;
	const mapPoolJson = JSON.stringify(mapPool);
	// Migration defaults: 5 / 3 / 3. Mirror them here so the API returns
	// the actual stored values without a re-load round-trip on the
	// happy path (we still re-load below to get created_at/updated_at).
	const swissMaxRounds = input.swiss_max_rounds ?? 5;
	const swissWinsToAdvance = input.swiss_wins_to_advance ?? 3;
	const swissLossesToEliminate = input.swiss_losses_to_eliminate ?? 3;

	const thresholdError = validateSwissThresholds(
		swissMaxRounds,
		swissWinsToAdvance,
		swissLossesToEliminate,
	);
	if (thresholdError) {
		return errorResponse(thresholdError, 400, cors, "INVALID_THRESHOLDS");
	}

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
				    map_pool, created_by_user_id
				 ) VALUES (?, ?, ?, ?, 'setup', ?, ?, ?, ?, ?, ?, ?)`,
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
				mapPoolJson,
				session.data.user_id,
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
				swiss_wins_to_advance: created.swiss_wins_to_advance,
				swiss_losses_to_eliminate: created.swiss_losses_to_eliminate,
				swiss_max_rounds: created.swiss_max_rounds,
				map_pool: mapPool,
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

	// Swiss config is frozen once the tournament has started. The map pool is
	// not frozen outright — past 'setup' it becomes append-only (admins can add
	// maps for future rounds; see the append-only enforcement below where the
	// pool is built).
	const locked = tournament.status !== "setup";
	if (
		locked &&
		(patch.swiss_wins_to_advance !== undefined ||
			patch.swiss_losses_to_eliminate !== undefined ||
			patch.swiss_max_rounds !== undefined)
	) {
		return errorResponse(
			"Cannot edit Swiss config after the tournament has started",
			409,
			cors,
			"TOURNAMENT_LOCKED",
		);
	}

	// Opening signups only makes sense in setup. Outside setup the flag is
	// inert — handleStartTournament clears it on the transition — but a PATCH
	// that tries to reopen it after start is a bug, so reject. Closing it
	// (signups_open=false) after the fact is harmless and allowed.
	if (locked && patch.signups_open === true) {
		return errorResponse(
			"Signups can only be opened while the tournament is in setup",
			409,
			cors,
			"INVALID_PHASE",
		);
	}

	// FSM-consistency check on the effective (post-patch) thresholds. Each
	// field falls back to the existing row's value when not in the patch.
	const effMaxRounds = patch.swiss_max_rounds ?? tournament.swiss_max_rounds;
	const effWinsToAdvance =
		patch.swiss_wins_to_advance ?? tournament.swiss_wins_to_advance;
	const effLossesToEliminate =
		patch.swiss_losses_to_eliminate ?? tournament.swiss_losses_to_eliminate;
	const thresholdError = validateSwissThresholds(
		effMaxRounds,
		effWinsToAdvance,
		effLossesToEliminate,
	);
	if (thresholdError) {
		return errorResponse(thresholdError, 400, cors, "INVALID_THRESHOLDS");
	}

	// Build the post-patch map_pool when the caller provided one: validate +
	// reconcile each instance's options (XML defaults for unset options) and
	// assign ids to any new entries. Stored as JSON.
	let nextMapPoolJson: string | undefined;
	if (patch.map_pool !== undefined) {
		const built = buildMapPool(patch.map_pool);
		if (!built.ok) {
			return errorResponse(built.message, 400, cors, "MAP_OPTIONS_INVALID");
		}
		// A completed tournament has no future rounds to consume new maps and
		// nothing left to override, so the pool is frozen entirely.
		if (tournament.status === "complete") {
			return errorResponse(
				"Can't change the map pool of a completed tournament",
				409,
				cors,
				"TOURNAMENT_COMPLETE",
			);
		}
		// Otherwise past 'setup' the pool is append-only: new instances may be
		// added (future rounds pick them up at generation time, and pending
		// matches can be pointed at them via handlePatchMatchMap), but existing
		// instances must survive unchanged. Matches reference pool instances by
		// id with no per-match options snapshot (migration 0019), so editing or
		// removing a live instance would silently rewrite the config of matches
		// that reference it.
		if (locked) {
			const existing = parseMapPoolOrError(tournament, cors);
			if (!existing.ok) return existing.response;
			const violation = appendOnlyViolation(existing.pool, built.pool);
			if (violation) {
				return errorResponse(violation, 409, cors, "MAP_POOL_LOCKED");
			}
		}
		nextMapPoolJson = JSON.stringify(built.pool);
	}

	// Links are deliberately NOT phase-locked: admins add/edit them in every
	// status (e.g. a stream/VOD link mid-tournament, results after completion).
	// Already validated + trimmed by LinksSchema; just serialize the whole list.
	const nextLinksJson =
		patch.links !== undefined ? JSON.stringify(patch.links) : undefined;

	const fragments: string[] = [];
	const binds: unknown[] = [];
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) continue;
		if (key === "map_pool" || key === "links") {
			// Skip — JSON blob fields, handled below from their *Json vars (arrays
			// can't bind to D1 directly).
			continue;
		} else if (key === "signups_open") {
			// SQLite has no boolean; the column is INTEGER 0/1.
			fragments.push(`${key} = ?`);
			binds.push(value ? 1 : 0);
		} else {
			fragments.push(`${key} = ?`);
			binds.push(value);
		}
	}
	if (nextMapPoolJson !== undefined) {
		fragments.push("map_pool = ?");
		binds.push(nextMapPoolJson);
	}
	if (nextLinksJson !== undefined) {
		fragments.push("links = ?");
		binds.push(nextLinksJson);
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
	await logTournamentAdminAction(
		env,
		a.userId,
		tournamentId,
		"tournament_patched",
		{
			fields_changed: Object.keys(patch).filter(
				(k) => patch[k as keyof typeof patch] !== undefined,
			),
		},
	);
	return jsonResponse({ tournament: updated }, 200, cors);
}

// ----------------------------------------------------------------------
// Admin roster management — GET / POST / DELETE /v1/tournaments/:id/admins
// ----------------------------------------------------------------------

// GET /v1/tournaments/:id/admins — full admin list with user_ids for the
// in-app management UI. The public detail payload exposes only display_name +
// avatar (no user_ids) for everyone; this admin-gated endpoint is the one place
// that hands out user_ids so the remove buttons have something to act on.
export async function handleListTournamentAdmins(
	tournamentId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;

	const rows = await env.SHARE_DB.prepare(
		`SELECT ta.user_id, ${displayNameSql("u")} AS display_name, u.discord_id, u.avatar_hash
		 FROM tournament_admins ta
		 JOIN users u ON u.user_id = ta.user_id
		 WHERE ta.tournament_id = ?
		 ORDER BY ta.granted_at ASC, ta.user_id ASC`,
	)
		.bind(tournamentId)
		.all<{
			user_id: string;
			display_name: string;
			discord_id: string;
			avatar_hash: string | null;
		}>();
	const admins = (rows.results ?? []).map((r) => ({
		user_id: r.user_id,
		display_name: r.display_name,
		avatar_url: buildAvatarUrl(r.discord_id, r.avatar_hash),
		is_creator: r.user_id === a.tournament.created_by_user_id,
	}));
	return jsonResponse({ admins }, 200, cors);
}

// POST /v1/tournaments/:id/admins { user_id } — grant another Per-Ankh user
// admin on this tournament. The target must already exist as a user (the
// autocomplete sources from /v1/users/search). A granted admin can act
// regardless of beta status — beta now gates only tournament creation.
export async function handleGrantTournamentAdmin(
	tournamentId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;

	const body = await parseJsonBody(request, GrantAdminSchema, cors);
	if (!body.ok) return body.response;
	const targetUserId = body.body.user_id;

	const target = await env.SHARE_DB.prepare(
		`SELECT user_id, ${displayNameSql("users")} AS display_name, discord_id, avatar_hash FROM users WHERE user_id = ?`,
	)
		.bind(targetUserId)
		.first<{
			user_id: string;
			display_name: string;
			discord_id: string;
			avatar_hash: string | null;
		}>();
	if (!target) {
		return errorResponse("User not found", 404, cors, "USER_NOT_FOUND");
	}

	// Idempotent — re-granting an existing admin is a no-op, not an error.
	await env.SHARE_DB.prepare(
		"INSERT OR IGNORE INTO tournament_admins (tournament_id, user_id) VALUES (?, ?)",
	)
		.bind(tournamentId, targetUserId)
		.run();

	await bumpTournamentUpdatedAt(env, tournamentId);
	await logTournamentAdminAction(env, a.userId, tournamentId, "admin_granted", {
		granted_user_id: targetUserId,
	});

	return jsonResponse(
		{
			admin: {
				user_id: target.user_id,
				display_name: target.display_name,
				avatar_url: buildAvatarUrl(target.discord_id, target.avatar_hash),
				is_creator: target.user_id === a.tournament.created_by_user_id,
			},
		},
		201,
		cors,
	);
}

// DELETE /v1/tournaments/:id/admins/:user_id — revoke an admin. The creator
// (created_by_user_id) is protected — they can't be removed via the UI, so
// every tournament always retains at least its owner.
export async function handleRevokeTournamentAdmin(
	tournamentId: string,
	targetUserId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;

	if (targetUserId === a.tournament.created_by_user_id) {
		return errorResponse(
			"The tournament creator can't be removed as an admin",
			409,
			cors,
			"CANNOT_REMOVE_CREATOR",
		);
	}

	const result = await env.SHARE_DB.prepare(
		"DELETE FROM tournament_admins WHERE tournament_id = ? AND user_id = ?",
	)
		.bind(tournamentId, targetUserId)
		.run();
	if ((result.meta?.changes ?? 0) === 0) {
		return errorResponse(
			"Not an admin of this tournament",
			404,
			cors,
			"ADMIN_NOT_FOUND",
		);
	}

	await bumpTournamentUpdatedAt(env, tournamentId);
	await logTournamentAdminAction(env, a.userId, tournamentId, "admin_revoked", {
		revoked_user_id: targetUserId,
	});
	return jsonResponse({ revoked: true }, 200, cors);
}

// ----------------------------------------------------------------------
// DELETE /v1/tournaments/:id — delete a tournament (cancel == delete)
// ----------------------------------------------------------------------

// Authorized to the tournament creator OR the global site admin — NOT plain
// tournament admins (a co-admin can run the tournament but not tear it down).
// Completed tournaments are intentionally undeletable here; they're preserved
// unless removed via `./per-ankh admin tournament delete`. The FK cascade drops
// slots/rounds/matches/admins; R2 game blobs are left intact (the participants'
// own uploads), mirroring the CLI delete.
export async function handleDeleteTournament(
	tournamentId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}

	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament) {
		return errorResponse(
			"Tournament not found",
			404,
			cors,
			"TOURNAMENT_NOT_FOUND",
		);
	}

	const siteAdmin = await isSiteAdmin(env, session);
	if (!siteAdmin) {
		// Non-site-admins must be the tournament creator specifically (403 for
		// any other admin, including co-admins).
		if (tournament.created_by_user_id !== session.data.user_id) {
			return errorResponse(
				"Only the tournament creator or a site admin can delete a tournament",
				403,
				cors,
				"FORBIDDEN_DELETE",
			);
		}
	}

	// Completed tournaments stay CLI-only regardless of who's asking.
	if (tournament.status === "complete") {
		return errorResponse(
			"Completed tournaments can't be deleted here",
			409,
			cors,
			"CANNOT_DELETE_COMPLETED",
		);
	}

	await env.SHARE_DB.prepare("DELETE FROM tournaments WHERE tournament_id = ?")
		.bind(tournamentId)
		.run();

	// Audit. The tournament row is gone, but events.metadata is plain text
	// (not an FK), so the record survives the delete.
	await logTournamentAdminAction(
		env,
		session.data.user_id,
		tournamentId,
		"deleted",
		{
			slug: tournament.slug,
			status: tournament.status,
			by_site_admin: siteAdmin,
		},
	);
	return jsonResponse({ deleted: true }, 200, cors);
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

	// Resolve canonical identity for slots that ship a user_id (autocomplete
	// "pre-link" path). The body's discord_username is treated as a hint
	// from the client; for these slots the worker substitutes the value
	// stored on the users row so the client can't spoof a mismatched handle
	// into tournament_slots. user_ids missing from the users table are
	// rejected up front — no partial batch.
	const requestedUserIds = Array.from(
		new Set(newSlots.map((s) => s.user_id).filter((id): id is string => !!id)),
	);
	const canonicalByUserId = new Map<
		string,
		{ discord_id: string; discord_username: string }
	>();
	if (requestedUserIds.length > 0) {
		const placeholders = requestedUserIds.map(() => "?").join(",");
		const usersRes = await env.SHARE_DB.prepare(
			`SELECT user_id, discord_id, discord_username
			 FROM users
			 WHERE user_id IN (${placeholders})`,
		)
			.bind(...requestedUserIds)
			.all<{
				user_id: string;
				discord_id: string;
				discord_username: string | null;
			}>();
		for (const row of usersRes.results ?? []) {
			if (row.discord_username) {
				canonicalByUserId.set(row.user_id, {
					discord_id: row.discord_id,
					discord_username: row.discord_username,
				});
			}
		}
		for (const id of requestedUserIds) {
			if (!canonicalByUserId.has(id)) {
				// Either no users row, or that row has discord_username=NULL
				// (legacy user who hasn't logged in since migration 0016). Both
				// block pre-linking — admin should fall back to free-text and
				// let the user claim at next login.
				return errorResponse(
					`Unknown or unlinkable user_id: ${id}`,
					400,
					cors,
					"INVALID_USER_ID",
				);
			}
		}
	}

	// Resolved slot view used for the rest of the handler. For user_id slots,
	// discord_username is the canonical one; for free-text slots, the body's
	// value passes through. Carrying discord_id only when user_id is set keeps
	// the existing slot-claim path (NULL → match by username at OAuth) intact
	// for free-text rows.
	const resolvedSlots = newSlots.map((s) => {
		if (s.user_id) {
			const c = canonicalByUserId.get(s.user_id)!;
			return {
				division: s.division,
				swiss_seed: s.swiss_seed,
				discord_username: c.discord_username,
				discord_id: c.discord_id,
				user_id: s.user_id,
			};
		}
		return {
			division: s.division,
			swiss_seed: s.swiss_seed,
			discord_username: s.discord_username,
			discord_id: null as string | null,
			user_id: null as string | null,
		};
	});

	// Verify no duplicate discord_usernames within the tournament (existing
	// or in the same batch). Runs against resolved usernames so a user_id-
	// prelinked slot is correctly compared against its canonical handle.
	const existing = await loadSlots(env, tournamentId);
	const taken = new Set(
		existing
			.filter((s) => s.discord_username && s.phase === "swiss")
			.map((s) => s.discord_username as string),
	);
	const batchSet = new Set<string>();
	for (const s of resolvedSlots) {
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
	for (const s of resolvedSlots) {
		const seed = s.swiss_seed ?? nextSeedByDiv[s.division]++;
		const slotId = nanoid(21);
		statements.push(
			env.SHARE_DB.prepare(
				`INSERT INTO tournament_slots
				   (slot_id, tournament_id, phase, division, swiss_seed,
				    discord_username, discord_id, user_id)
				 VALUES (?, ?, 'swiss', ?, ?, ?, ?, ?)`,
			).bind(
				slotId,
				tournamentId,
				s.division,
				seed,
				s.discord_username,
				s.discord_id,
				s.user_id,
			),
		);
		created.push({ slot_id: slotId, division: s.division, swiss_seed: seed });
	}
	statements.push(
		env.SHARE_DB.prepare(
			"UPDATE tournaments SET updated_at = datetime('now') WHERE tournament_id = ?",
		).bind(tournamentId),
	);
	await env.SHARE_DB.batch(statements);
	await logTournamentAdminAction(
		env,
		a.userId,
		tournamentId,
		"slots_bulk_created",
		{
			count: created.length,
		},
	);
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

	// Resolve the new occupant. When user_id is supplied (a pick from the
	// admin's autocomplete), the slot links to that account immediately:
	// canonical discord_username + discord_id come from the users table and
	// user_id is pinned, so no OAuth-callback claim is needed. The body's
	// discord_username is ignored in this branch (the canonical handle wins),
	// mirroring handleBulkCreateSlots' pre-link path.
	let prelink: {
		user_id: string;
		discord_username: string;
		discord_id: string;
	} | null = null;
	if (patch.user_id !== undefined) {
		const u = await env.SHARE_DB.prepare(
			"SELECT discord_id, discord_username FROM users WHERE user_id = ?",
		)
			.bind(patch.user_id)
			.first<{ discord_id: string; discord_username: string | null }>();
		if (!u || !u.discord_username) {
			// No users row, or a legacy row with discord_username = NULL (hasn't
			// logged in since migration 0016) — can't pre-link. Admin should fall
			// back to free-text and let the user claim at next login.
			return errorResponse(
				`Unknown or unlinkable user_id: ${patch.user_id}`,
				400,
				cors,
				"INVALID_USER_ID",
			);
		}
		prelink = {
			user_id: patch.user_id,
			discord_username: u.discord_username,
			discord_id: u.discord_id,
		};
		// Don't link the same handle to two slots in the same phase. (A user
		// legitimately holds both a swiss and a championship slot, so scope the
		// check to the edited slot's phase rather than the whole tournament.)
		const others = await loadSlots(env, tournamentId);
		const collision = others.some(
			(s) =>
				s.slot_id !== slotId &&
				s.phase === slot.phase &&
				s.discord_username === prelink!.discord_username,
		);
		if (collision) {
			return errorResponse(
				`Discord username already used: ${prelink.discord_username}`,
				409,
				cors,
				"DUPLICATE_USERNAME",
			);
		}
	}

	// The effective post-resolution username (canonical when pre-linking).
	const effectiveUsername = prelink
		? prelink.discord_username
		: patch.discord_username;
	const occupantChanged =
		effectiveUsername !== undefined &&
		effectiveUsername !== slot.discord_username;

	// Build the UPDATE. user_id is never written from the raw patch — the
	// prelink / free-text branches own the identity columns.
	const fragments: string[] = [];
	const binds: unknown[] = [];
	if (patch.division !== undefined) {
		fragments.push("division = ?");
		binds.push(patch.division);
	}
	if (patch.swiss_seed !== undefined) {
		fragments.push("swiss_seed = ?");
		binds.push(patch.swiss_seed);
	}
	if (patch.signup_answer !== undefined) {
		// Normalize empty/whitespace to null, matching handleTournamentSignup
		// so a cleared answer reads as "unanswered" rather than "".
		const normalized =
			patch.signup_answer && patch.signup_answer.length > 0
				? patch.signup_answer
				: null;
		fragments.push("signup_answer = ?");
		binds.push(normalized);
	}
	if (prelink) {
		fragments.push("discord_username = ?", "discord_id = ?", "user_id = ?");
		binds.push(prelink.discord_username, prelink.discord_id, prelink.user_id);
	} else {
		if (patch.discord_username !== undefined) {
			fragments.push("discord_username = ?");
			binds.push(patch.discord_username);
		}
		// Free-text occupant change clears the prior link so the new occupant
		// claims at next login (OAuth callback or /v1/auth/me).
		if (occupantChanged) {
			fragments.push("user_id = NULL", "discord_id = NULL");
		}
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

	if (occupantChanged) {
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
						new_username: effectiveUsername,
					}),
				)
				.run();
		} catch {
			// audit failures don't break the operation
		}
	}

	await bumpTournamentUpdatedAt(env, tournamentId);
	const updated = await loadSlot(env, slotId);
	await logTournamentAdminAction(env, a.userId, tournamentId, "slot_patched", {
		slot_id: slotId,
		username_changed: occupantChanged,
		prelinked: prelink !== null,
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
	await logTournamentAdminAction(env, a.userId, tournamentId, "slot_deleted", {
		slot_id: slotId,
	});
	return new Response(null, { status: 204, headers: cors });
}

// ----------------------------------------------------------------------
// POST   /v1/tournaments/:id/slots/:slot_id/withdraw — withdraw a player
// DELETE /v1/tournaments/:id/slots/:slot_id/withdraw — reinstate a player
//
// Admin-initiated mid-tournament drop. Setting withdrawn_at excludes the slot
// from all *future* pairing (the pure engine skips withdrawn slots) and from
// championship qualifiers, while already-played matches stand. The slot's one
// in-flight pending match (if any) is forfeited to the opponent and routed
// through the normal advance path, so the round can close and the next round
// generates without the withdrawn player. If both slots in that match are
// withdrawn the forfeit lands on one side and is inert (both are excluded
// downstream). Deliberately admin-only — players can't drop themselves once a
// tournament has started, which avoids accidental self-withdrawals. During
// 'setup' a slot is hard-deleted (handleDeleteSlot) rather than withdrawn.
// ----------------------------------------------------------------------

export async function handleWithdrawSlot(
	tournamentId: string,
	slotId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;
	const { tournament } = a;
	if (tournament.status !== "swiss" && tournament.status !== "championship") {
		return errorResponse(
			tournament.status === "setup"
				? "Delete the slot during setup; withdraw applies after the tournament has started"
				: "Tournament is complete",
			409,
			cors,
			"INVALID_PHASE",
		);
	}
	const slot = await loadSlotInTournament(env, slotId, tournamentId);
	if (!slot) {
		return errorResponse("Slot not found", 404, cors, "SLOT_NOT_FOUND");
	}
	if (slot.withdrawn_at != null) {
		// Idempotent: already withdrawn, nothing left to forfeit.
		return jsonResponse({ slot }, 200, cors);
	}

	await env.SHARE_DB.prepare(
		"UPDATE tournament_slots SET withdrawn_at = datetime('now') WHERE slot_id = ?",
	)
		.bind(slotId)
		.run();

	const forfeitedMatchIds = await forfeitPendingMatchesForSlot(
		env,
		tournamentId,
		slotId,
	);

	await bumpTournamentUpdatedAt(env, tournamentId);
	await logTournamentAdminAction(
		env,
		a.userId,
		tournamentId,
		"slot_withdrawn",
		{
			slot_id: slotId,
			division: slot.division,
			forfeited_match_ids: forfeitedMatchIds,
		},
	);
	const updated = await loadSlotInTournament(env, slotId, tournamentId);
	return jsonResponse({ slot: updated }, 200, cors);
}

export async function handleReinstateSlot(
	tournamentId: string,
	slotId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedTournament(tournamentId, request, env);
	if (!a.ok) return a.response;
	const slot = await loadSlotInTournament(env, slotId, tournamentId);
	if (!slot) {
		return errorResponse("Slot not found", 404, cors, "SLOT_NOT_FOUND");
	}
	if (slot.withdrawn_at == null) {
		// Idempotent: not withdrawn.
		return jsonResponse({ slot }, 200, cors);
	}
	// Clear the flag. Takes effect from the NEXT round generated: a round
	// already paired without this slot is not retroactively repaired, and the
	// auto-forfeit applied on withdrawal is not undone (an admin can retro-edit
	// that match if the player returns to an in-progress round).
	await env.SHARE_DB.prepare(
		"UPDATE tournament_slots SET withdrawn_at = NULL WHERE slot_id = ?",
	)
		.bind(slotId)
		.run();
	await bumpTournamentUpdatedAt(env, tournamentId);
	await logTournamentAdminAction(
		env,
		a.userId,
		tournamentId,
		"slot_reinstated",
		{
			slot_id: slotId,
			division: slot.division,
		},
	);
	const updated = await loadSlotInTournament(env, slotId, tournamentId);
	return jsonResponse({ slot: updated }, 200, cors);
}

// Forfeit every pending match the slot is currently in, awarding the win to
// the opponent, and route each through maybeAdvanceAfterMatchReport so the
// round closes / the next round generates (now excluding the withdrawn slot).
// Normally there is at most one such match (the current in_progress round);
// the set is handled defensively. Mirrors handleRetroEditMatch's forward
// transition: snapshot both occupants so the forfeited card keeps correct
// names. Returns the forfeited match IDs for the audit log.
async function forfeitPendingMatchesForSlot(
	env: TournamentAdminEnv,
	tournamentId: string,
	slotId: string,
): Promise<string[]> {
	const res = await env.SHARE_DB.prepare(
		`SELECT m.* FROM tournament_matches m
		 JOIN tournament_rounds r ON r.round_id = m.round_id
		 WHERE r.tournament_id = ?
		   AND m.status = 'pending'
		   AND (m.slot_a_id = ? OR m.slot_b_id = ?)`,
	)
		.bind(tournamentId, slotId, slotId)
		.all<MatchRow>();
	const pending = res.results ?? [];
	const forfeitedIds: string[] = [];
	for (const m of pending) {
		// A pending match always has two real slots (byes are status='bye'),
		// so the opponent is non-null. The forfeit is inert if the opponent is
		// itself withdrawn — both are excluded from pairing and qualifiers.
		const opponentId = m.slot_a_id === slotId ? m.slot_b_id : m.slot_a_id;
		if (opponentId === null) continue;
		const slotA = await loadSlot(env, m.slot_a_id);
		const slotB = m.slot_b_id ? await loadSlot(env, m.slot_b_id) : null;
		await env.SHARE_DB.prepare(
			`UPDATE tournament_matches
			   SET status = 'forfeit', winner_slot_id = ?,
			       slot_a_username = ?, slot_a_user_id = ?,
			       slot_b_username = ?, slot_b_user_id = ?
			 WHERE match_id = ?`,
		)
			.bind(
				opponentId,
				slotA?.discord_username ?? null,
				slotA?.user_id ?? null,
				slotB?.discord_username ?? null,
				slotB?.user_id ?? null,
				m.match_id,
			)
			.run();
		forfeitedIds.push(m.match_id);
		await maybeAdvanceAfterMatchReport(env, m.match_id);
	}
	return forfeitedIds;
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

	await logTournamentAdminAction(
		env,
		a.userId,
		tournamentId,
		"slots_reordered",
		{
			count: requested.length,
			division_a: divisions.A.length,
			division_b: divisions.B.length,
		},
	);
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
	const mapsResult = parseMapPoolOrError(tournament, cors);
	if (!mapsResult.ok) return mapsResult.response;
	const mapPool = mapsResult.pool;
	// Empty is legal during status='setup' (create no longer requires the
	// field) but match generation needs at least one map. Block the
	// transition with a clear error rather than letting assignMap throw
	// "map pool must be non-empty" as an opaque 500.
	if (mapPool.length === 0) {
		return errorResponse(
			"Configure at least one map script before starting the tournament",
			409,
			cors,
			"MAP_CONFIG_EMPTY",
		);
	}

	const statements: D1PreparedStatement[] = [
		env.SHARE_DB.prepare(
			// Also clear signups_open on the transition. Self-signup is only
			// meaningful in setup, so we don't want the flag stuck "on" once
			// pairings exist — both the API (handleTournamentSignup checks
			// status='setup') and the UI key off this transition.
			`UPDATE tournaments SET status = 'swiss',
			        signups_open = 0,
			        updated_at = datetime('now')
			 WHERE tournament_id = ?`,
		).bind(tournamentId),
	];
	const summaries: { division: Division; round_id: string; matches: number }[] =
		[];
	const slotIdentityById = new Map(
		swissSlots.map((s) => [
			s.slot_id,
			{ discord_username: s.discord_username, user_id: s.user_id },
		]),
	);
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
			mapPool,
			slotIdentityById,
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
	await logTournamentAdminAction(
		env,
		a.userId,
		tournamentId,
		"tournament_started",
		{
			rounds: summaries,
		},
	);
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
	if (patch.map_pool_id === undefined) {
		return jsonResponse({ match }, 200, cors);
	}
	// Resolve the chosen instance from the tournament's pool and denormalize
	// its script onto the match alongside the instance id.
	const poolResult = parseMapPoolOrError(a.tournament, cors);
	if (!poolResult.ok) return poolResult.response;
	const entry = poolResult.pool.find((e) => e.id === patch.map_pool_id);
	if (!entry) {
		return errorResponse(
			"map_pool_id is not in this tournament's map pool",
			400,
			cors,
			"MAP_NOT_IN_POOL",
		);
	}
	await env.SHARE_DB.prepare(
		"UPDATE tournament_matches SET map_pool_id = ?, map_script = ? WHERE match_id = ?",
	)
		.bind(entry.id, entry.script, matchId)
		.run();
	await bumpTournamentUpdatedAt(env, tournamentId);
	const updated = await loadMatch(env, matchId);
	await logTournamentAdminAction(
		env,
		a.userId,
		tournamentId,
		"match_map_patched",
		{
			match_id: matchId,
		},
	);
	return jsonResponse({ match: updated }, 200, cors);
}

// ----------------------------------------------------------------------
// PATCH /v1/tournaments/:id/matches/:match_id/schedule — replace the match's
// scheduled parts (migration 0029): each part carries its own time, caster, and
// stream links. Replace-all over the full parts list. Admin OR participant (see
// authedMatchScheduler).
// ----------------------------------------------------------------------

// Like authedTournament, but widened for the schedule endpoint: a match
// participant may use it in addition to a tournament admin. Loads + scopes the
// match to the URL's tournament (404 hides existence cross-tournament) before
// the authz branch, then authorizes the caller as admin OR owner of either
// slot, and enforces the per-user schedule rate limit. Anonymous callers get
// 401, matching authedTournament.
async function authedMatchScheduler(
	tournamentId: string,
	matchId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<
	| { ok: true; match: MatchRow; userId: string; isAdmin: boolean }
	| { ok: false; response: Response }
> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return {
			ok: false,
			response: errorResponse(
				"Authentication required",
				401,
				cors,
				"UNAUTHORIZED",
			),
		};
	}

	const match = await loadMatch(env, matchId);
	if (!match) {
		return {
			ok: false,
			response: errorResponse("Match not found", 404, cors, "MATCH_NOT_FOUND"),
		};
	}
	const round = await loadRound(env, match.round_id);
	if (!round || round.tournament_id !== tournamentId) {
		return {
			ok: false,
			response: errorResponse("Match not found", 404, cors, "MATCH_NOT_FOUND"),
		};
	}

	// Admin OR participant. Try admin first (reuses requireTournamentAdmin);
	// on its 403 fall back to checking whether the caller owns either slot.
	let authorized = false;
	let isAdmin = false;
	try {
		await requireTournamentAdmin(env, session.data, tournamentId);
		authorized = true;
		isAdmin = true;
	} catch (e) {
		if (!(e instanceof AuthzError)) throw e;
		const slotA = await loadSlot(env, match.slot_a_id);
		const slotB = match.slot_b_id ? await loadSlot(env, match.slot_b_id) : null;
		authorized =
			slotA?.user_id === session.data.user_id ||
			slotB?.user_id === session.data.user_id;
	}
	if (!authorized) {
		return {
			ok: false,
			response: errorResponse(
				"You must be a tournament admin or a participant in this match to schedule it",
				403,
				cors,
				"NOT_MATCH_PARTICIPANT",
			),
		};
	}

	// Per-user schedule budget (admins and participants alike).
	const scheduleEventCount = await countEventsSince(
		env.SHARE_DB,
		"tournament_schedule",
		"user_id",
		session.data.user_id,
	);
	if (scheduleEventCount >= TOURNAMENT_SCHEDULE_ACTIONS_PER_HOUR) {
		return {
			ok: false,
			response: errorResponse(
				"Tournament schedule rate limit exceeded",
				429,
				cors,
				"RATE_LIMIT_TOURNAMENT_SCHEDULE",
			),
		};
	}

	return { ok: true, match, userId: session.data.user_id, isAdmin };
}

export async function handlePatchMatchSchedule(
	tournamentId: string,
	matchId: string,
	request: Request,
	env: TournamentAdminEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const a = await authedMatchScheduler(tournamentId, matchId, request, env);
	if (!a.ok) return a.response;
	const { match, isAdmin } = a;

	// Byes are auto-resolved and never played, so there's nothing to schedule or
	// attach streams to. Every other status is editable: pending to coordinate the
	// upcoming game, complete/forfeit to attach streams and casters after the fact.
	if (match.status === "bye") {
		return errorResponse(
			"Can't schedule a bye match",
			409,
			cors,
			"MATCH_NOT_PENDING",
		);
	}
	// Decided matches are an archive (streams, caster credits): editing them is
	// admin-only. A participant could otherwise wipe every stream on a match they
	// just lost — replace-all has no notion of an additive-only edit.
	if (match.status !== "pending" && !isAdmin) {
		return errorResponse(
			"Only a tournament admin can edit a decided match's schedule",
			403,
			cors,
			"NOT_TOURNAMENT_ADMIN",
		);
	}

	const body = await parseJsonBody(request, PatchMatchPartsSchema, cors);
	if (!body.ok) return body.response;
	const patch = body.body;

	// Resolve every linked caster across all parts in one batch: a non-null
	// user_id must reference a linkable user, and we snapshot that user's
	// canonical username into name (ignoring any client-sent name), mirroring
	// handlePatchSlot's prelink branch. Free-text casters keep their name.
	const casterIds = [
		...new Set(
			patch.parts
				.flatMap((p) => p.casters)
				.map((c) => c.user_id)
				.filter((id): id is string => id !== null),
		),
	];
	const canonicalByUserId = new Map<string, string>();
	if (casterIds.length > 0) {
		const placeholders = casterIds.map(() => "?").join(",");
		const res = await env.SHARE_DB.prepare(
			`SELECT user_id, discord_username FROM users WHERE user_id IN (${placeholders})`,
		)
			.bind(...casterIds)
			.all<{ user_id: string; discord_username: string | null }>();
		for (const row of res.results ?? []) {
			if (row.discord_username)
				canonicalByUserId.set(row.user_id, row.discord_username);
		}
		for (const id of casterIds) {
			if (!canonicalByUserId.has(id)) {
				return errorResponse(
					`Unknown or unlinkable user_id: ${id}`,
					400,
					cors,
					"INVALID_USER_ID",
				);
			}
		}
	}

	// Mint a stable id for any part the client added without one; dedupe against
	// ids already in the payload so an add can't collide with an existing part.
	const seenIds = new Set<string>();
	const parts: MatchPart[] = patch.parts.map((p) => {
		let id = p.id;
		if (!id || seenIds.has(id)) id = nanoid(12);
		seenIds.add(id);
		const streams: MatchPartStream[] = p.streams.map((stream) => ({
			url: stream.url,
			label: stream.label?.trim() ? stream.label.trim() : null,
		}));
		// Linked casters snapshot the canonical username; free-text casters keep
		// their typed name. Empty entries (neither set) are dropped.
		const casters: MatchPartCaster[] = p.casters
			.map((c) => {
				if (c.user_id) {
					return {
						user_id: c.user_id,
						name: canonicalByUserId.get(c.user_id) ?? null,
					};
				}
				const name = c.name?.trim();
				return { user_id: null, name: name ? name : null };
			})
			.filter((c) => c.user_id !== null || c.name !== null);
		return { id, scheduled_at: p.scheduled_at, casters, streams };
	});

	// Optimistic concurrency in a single conditional write: the UPDATE lands only
	// while the row is still at the rev the caller expected — the parts_rev the
	// editor loaded (expected_rev) or, for non-editor callers that omit it, the
	// rev we just read. A concurrent writer (another admin's save, a caster
	// sign-up) has since bumped parts_rev, so the WHERE matches nothing and we
	// 409 instead of silently erasing their change.
	const expectedRev = patch.expected_rev ?? match.parts_rev;
	const write = await env.SHARE_DB.prepare(
		"UPDATE tournament_matches SET parts = ?, parts_rev = parts_rev + 1 WHERE match_id = ? AND parts_rev = ?",
	)
		.bind(JSON.stringify(parts), matchId, expectedRev)
		.run();
	if (write.meta.changes === 0) {
		return errorResponse(
			"The match schedule changed while you were editing — reload and retry",
			409,
			cors,
			"CONFLICT",
		);
	}
	await bumpTournamentUpdatedAt(env, tournamentId);
	const updated = await loadMatch(env, matchId);
	await logTournamentAdminAction(
		env,
		a.userId,
		tournamentId,
		"match_schedule_patched",
		// Replace-all over a curated archive (stream/caster credits) with no
		// history table: record enough to spot and diagnose a destructive save —
		// the rev overwritten and the before/after part counts.
		{
			match_id: matchId,
			prev_parts_rev: match.parts_rev,
			prev_part_count: parseParts(match).length,
			new_part_count: parts.length,
		},
	);
	// Return the parsed parts we just wrote (canonical caster_name snapshotted)
	// rather than the raw row, whose `parts` is a JSON string. Caster display
	// names/avatars resolve on the GET/list serialize path, not here.
	return jsonResponse({ match: { ...updated, parts } }, 200, cors);
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

	// Snapshot occupant on a forward transition (pending → non-pending);
	// clear it on a revert (non-pending → pending) so a subsequent re-report
	// captures fresh occupants.
	const goingNonPending =
		match.status === "pending" && postStatus !== "pending";
	const revertingToPending =
		match.status !== "pending" && postStatus === "pending";
	if (goingNonPending) {
		const slotA = await loadSlot(env, match.slot_a_id);
		const slotB = match.slot_b_id ? await loadSlot(env, match.slot_b_id) : null;
		fragments.push(
			"slot_a_username = ?",
			"slot_a_user_id = ?",
			"slot_b_username = ?",
			"slot_b_user_id = ?",
		);
		binds.push(
			slotA?.discord_username ?? null,
			slotA?.user_id ?? null,
			slotB?.discord_username ?? null,
			slotB?.user_id ?? null,
		);
	} else if (revertingToPending) {
		fragments.push(
			"slot_a_username = NULL",
			"slot_a_user_id = NULL",
			"slot_b_username = NULL",
			"slot_b_user_id = NULL",
		);
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
	await logTournamentAdminAction(
		env,
		a.userId,
		tournamentId,
		"match_retro_edited",
		{
			match_id: matchId,
			fields_changed: Object.keys(patch).filter(
				(k) => patch[k as keyof typeof patch] !== undefined,
			),
		},
	);
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

// Correlated subquery assigning the next dense global match_number for a
// tournament: MAX(existing) + 1. Evaluated per-INSERT inside the
// round-generation D1 batch, so each statement sees the rows the prior
// statements in the batch inserted — dense and append-only by construction.
// Binds one param: the tournament_id.
const NEXT_MATCH_NUMBER_SQL = `(SELECT COALESCE(MAX(m2.match_number), 0) + 1
	FROM tournament_matches m2
	JOIN tournament_rounds r2 ON r2.round_id = m2.round_id
	WHERE r2.tournament_id = ?)`;

// Swiss / championship-transition variant: byes are never numbered (NULL).
// Championship rounds 2+ can't bye, so buildChampionshipRoundStatements uses
// the bare NEXT_MATCH_NUMBER_SQL instead. Binds two params in order: the match
// status, then the tournament_id.
const NEXT_MATCH_NUMBER_OR_NULL_FOR_BYE_SQL = `CASE WHEN ? = 'bye' THEN NULL ELSE ${NEXT_MATCH_NUMBER_SQL} END`;

// ----------------------------------------------------------------------
// POST /v1/tournaments/:id/transition-championship
//
// Body (optional): { override_ranks: [slot_id_1, slot_id_2, ...] }
// When provided, the flat list IS the bracket seed order (skipping the
// auto-promote-by-status logic). Used to (a) resolve full-cascade ties
// at any seed, or (b) promote non-clinched slots when too few clinched
// (INSUFFICIENT_QUALIFIERS case).
//
// Otherwise: auto-promote every slot with status='advanced' from both
// divisions, rank them as a combined list via the seeding cascade
// (wins → H2H → Buchholz cut-1 → cumulative), and use that as the bracket
// seed order.
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

	// Validate the request body before any state mutation. autoCloseRoundIfReady
	// below writes Swiss-round state, so a malformed body must be rejected first
	// — otherwise a bad request still mutates the tournament.
	const body = await parseJsonBody(request, TransitionChampionshipSchema, cors);
	if (!body.ok) return body.response;
	const override = body.body.override_ranks;

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

	const slots = await loadSlots(env, tournamentId);
	const matchRefs = await matchRefsForTournament(env, tournamentId, matches);
	const config = tournamentConfig(tournament);

	// Resolve the seed-ordered qualifier list.
	let seedOrder: string[];
	if (override) {
		// Override path: admin supplied the exact bracket seed order.
		if (override.length < 2) {
			return errorResponse(
				`override_ranks must include at least 2 slot IDs (got ${override.length})`,
				400,
				cors,
				"INVALID_OVERRIDE",
			);
		}
		const seen = new Set<string>();
		for (const slotId of override) {
			if (seen.has(slotId)) {
				return errorResponse(
					`Duplicate slot in override_ranks: ${slotId}`,
					400,
					cors,
					"INVALID_OVERRIDE",
				);
			}
			seen.add(slotId);
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
		}
		seedOrder = [...override];
	} else {
		// Auto path: rank all swiss-phase slots across both divisions in a
		// single combined cascade (H2H within the combined tied set). Then
		// filter to status='advanced'.
		const swissSlots = slots
			.filter((s) => s.phase === "swiss")
			.map(slotRowToRef);
		const standings = computeStandings(swissSlots, matchRefs, config);
		const ranked = rankStandings(standings, matchRefs);
		// Withdrawn slots are excluded even if they'd clinched the win
		// threshold — an admin-withdrawn player won't play the bracket, so
		// they must not be seeded into it.
		const qualifiers = ranked.filter(
			(r) => r.status === "advanced" && !r.withdrawn,
		);

		if (qualifiers.length < 2) {
			// Surface near-qualifiers (the full ranked list) so the admin's
			// override UI can present them.
			return errorResponse(
				`Only ${qualifiers.length} player(s) reached the win threshold; at least 2 needed. Use override_ranks to promote additional slots.`,
				409,
				cors,
				"INSUFFICIENT_QUALIFIERS",
				{
					qualifier_count: qualifiers.length,
					ranked: ranked.map((r) => ({
						slot_id: r.slot_id,
						rank: r.rank,
						wins: r.wins,
						losses: r.losses,
						status: r.status,
						buchholz_cut1: r.buchholz_cut1,
						cumulative: r.cumulative,
					})),
				},
			);
		}
		seedOrder = qualifiers.map((q) => q.slot_id);
	}

	// Build bracket structure from the seed order. Bracket size rounds up
	// to the next power of 2; non-power-of-2 qualifier counts produce R1
	// byes for top seeds.
	const round1 = buildChampionshipRound1(seedOrder.length);
	const roundId = nanoid(21);

	const statements: D1PreparedStatement[] = [];
	const championshipSlotIds: Record<number, string> = {};
	// For R1 byes we need to snapshot the occupant on the match row at
	// INSERT time. The championship slot row hasn't been committed yet
	// (the statements batch flushes after this loop), so capture identity
	// here keyed by the new slot_id and read it below.
	const champIdentityById: Record<
		string,
		{ discord_username: string | null; user_id: string | null }
	> = {};

	// Insert one championship slot per real qualifier (seeds 1..N where N
	// is seedOrder.length). Phantom seeds (N+1..bracket_size) do not get
	// championship_slot rows — they exist only as null slot_b_id in R1
	// bye matches.
	for (let i = 0; i < seedOrder.length; i++) {
		const sourceSlotId = seedOrder[i];
		const sourceSlot = slots.find((row) => row.slot_id === sourceSlotId);
		if (!sourceSlot) {
			return errorResponse(
				`Internal: source slot ${sourceSlotId} not found`,
				500,
				cors,
				"SOURCE_SLOT_MISSING",
			);
		}
		const seed = i + 1;
		const newSlotId = nanoid(21);
		championshipSlotIds[seed] = newSlotId;
		champIdentityById[newSlotId] = {
			discord_username: sourceSlot.discord_username,
			user_id: sourceSlot.user_id,
		};
		statements.push(
			env.SHARE_DB.prepare(
				`INSERT INTO tournament_slots
				   (slot_id, tournament_id, phase, division, championship_seed,
				    discord_username, discord_id, user_id)
				 VALUES (?, ?, 'championship', NULL, ?, ?, ?, ?)`,
			).bind(
				newSlotId,
				tournamentId,
				seed,
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

	const mapsResult = parseMapPoolOrError(tournament, cors);
	if (!mapsResult.ok) return mapsResult.response;
	const mapPool = mapsResult.pool;

	// Map assignment: real matches (not byes) get a pool instance; byes get
	// null. Convert each round1 template to a Pairing (slot_b_id null for byes)
	// and run assignMapsToPairings, which handles null slot_b correctly
	// (returns map_pool_id=null, map_script=null).
	const matchPairings: Pairing[] = round1.matches.map((t) => ({
		slot_a_id: championshipSlotIds[t.seed_a]!,
		slot_b_id: t.is_bye ? null : championshipSlotIds[t.seed_b]!,
	}));
	const seed = `${tournamentId}|championship|r1`;
	const withMaps = assignMapsToPairings(
		matchPairings,
		mapPool,
		matchRefs,
		seed,
	);
	for (let i = 0; i < withMaps.length; i++) {
		const p = withMaps[i];
		const template = round1.matches[i];
		const matchId = nanoid(21);
		const status = template.is_bye ? "bye" : "pending";
		const winnerSlotId = template.is_bye ? p.slot_a_id : null;
		// pick_order_winner_slot_id: defaults to slot_b for real matches
		// (player listed second picks first). NULL for byes.
		const pickOrderWinner = template.is_bye ? null : p.slot_b_id;
		// Snapshot occupant for byes (status='bye' is non-pending). Pending
		// matches leave snapshots NULL and resolve live until reported.
		const aIdentity = template.is_bye ? champIdentityById[p.slot_a_id] : null;
		const slotAUsername = aIdentity?.discord_username ?? null;
		const slotAUserId = aIdentity?.user_id ?? null;
		statements.push(
			env.SHARE_DB.prepare(
				`INSERT INTO tournament_matches
				   (match_id, round_id, slot_a_id, slot_b_id, map_pool_id, map_script,
				    pick_order_winner_slot_id, status, winner_slot_id, match_index,
				    slot_a_username, slot_a_user_id, match_number)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
				         ${NEXT_MATCH_NUMBER_OR_NULL_FOR_BYE_SQL})`,
			).bind(
				matchId,
				roundId,
				p.slot_a_id,
				p.slot_b_id,
				p.map_pool_id,
				p.map_script,
				pickOrderWinner,
				status,
				winnerSlotId,
				i + 1,
				slotAUsername,
				slotAUserId,
				status,
				tournamentId,
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
	await logTournamentAdminAction(
		env,
		a.userId,
		tournamentId,
		"championship_transitioned",
		{
			round_id: roundId,
			qualifier_count: seedOrder.length,
			bracket_size: round1.bracket_size,
			byes: round1.bye_count,
			override: !!override,
		},
	);
	return jsonResponse(
		{
			status: "championship",
			round_id: roundId,
			matches: withMaps.length,
			qualifier_count: seedOrder.length,
			bracket_size: round1.bracket_size,
			byes: round1.bye_count,
			seed_order: seedOrder,
		},
		201,
		cors,
	);
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
	pool: MapPoolEntry[],
	// For byes (status='bye' INSERTed below): snapshot the occupant identity
	// onto the match row at INSERT time so a later substitution doesn't
	// rewrite the bye card.
	slotIdentityById: Map<
		string,
		{ discord_username: string | null; user_id: string | null }
	>,
): { statements: D1PreparedStatement[]; roundId: string; matchCount: number } {
	const config = tournamentConfig(tournament);
	const seed = `${tournament.tournament_id}|swiss|${division}|r${nextRoundNumber}`;
	const pairings: Pairing[] = pairSwissRound(
		divSlots,
		divMatchRefs,
		nextRoundNumber,
		config,
	);
	const withMaps = assignMapsToPairings(pairings, pool, divMatchRefs, seed);

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
		const status = isBye ? "bye" : "pending";
		const aIdentity = isBye ? slotIdentityById.get(p.slot_a_id) : null;
		statements.push(
			env.SHARE_DB.prepare(
				`INSERT INTO tournament_matches
				   (match_id, round_id, slot_a_id, slot_b_id, map_pool_id, map_script,
				    pick_order_winner_slot_id, status, winner_slot_id, match_index,
				    slot_a_username, slot_a_user_id, match_number)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
				         ${NEXT_MATCH_NUMBER_OR_NULL_FOR_BYE_SQL})`,
			).bind(
				matchId,
				roundId,
				p.slot_a_id,
				p.slot_b_id,
				p.map_pool_id,
				p.map_script,
				isBye ? null : p.slot_b_id, // default pick-order to slot_b
				status,
				isBye ? p.slot_a_id : null,
				i + 1,
				aIdentity?.discord_username ?? null,
				aIdentity?.user_id ?? null,
				status,
				tournament.tournament_id,
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
	pool: MapPoolEntry[],
): { statements: D1PreparedStatement[]; roundId: string; matchCount: number } {
	const seed = `${tournament.tournament_id}|championship|r${nextRoundNumber}`;
	const withMaps = assignMapsToPairings(pairings, pool, matchRefs, seed);
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
				   (match_id, round_id, slot_a_id, slot_b_id, map_pool_id, map_script,
				    pick_order_winner_slot_id, status, winner_slot_id, match_index,
				    match_number)
				 VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?,
				         ${NEXT_MATCH_NUMBER_SQL})`,
			).bind(
				matchId,
				roundId,
				p.slot_a_id,
				p.slot_b_id,
				p.map_pool_id,
				p.map_script,
				p.slot_b_id,
				i + 1,
				tournament.tournament_id,
			),
		);
	}
	return { statements, roundId, matchCount: withMaps.length };
}

// System-triggered audit entry (no admin user_id). event_type is distinct
// from 'tournament_admin' so per-admin rate-limit queries naturally skip
// these rows and log inspection can separate human from automatic actions.
// Awaited for durability for the same reason as logTournamentAdminAction
// (issue #75); the .catch keeps a failed audit from breaking auto-advance.
async function logSystemTournamentAction(
	env: TournamentEnv,
	tournamentId: string,
	action: string,
	extra?: Record<string, unknown>,
): Promise<void> {
	const metadata = JSON.stringify({
		action,
		tournament_id: tournamentId,
		...(extra ?? {}),
	});
	await env.SHARE_DB.prepare(
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
//
// WHY concurrency is safe (so the next reader doesn't reach for a fault-
// injection harness): two reports completing the last matches of a round can
// both pass the `roundMatches.some(pending)` gate. The application guards —
// the `downstream`-exists check and the status-scoped WHERE clauses below —
// make the slower one a no-op in the common case. The hard backstop for a
// genuine read-then-write interleaving is the database: round + match inserts
// are pushed into a single transactional env.SHARE_DB.batch(...), and
// tournament_rounds has UNIQUE(tournament_id, phase, division, round_number)
// (migration 0006). A duplicate round insert fails that constraint, rolling
// the whole batch back (no orphan matches) into the try/catch. Idempotency is
// pinned by test/integration/tournament/concurrent-advance.test.ts.
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
				const mapPool = parseMapPool(tournament);
				const slotIdentityById = new Map(
					slots
						.filter((s) => s.phase === "swiss")
						.map((s) => [
							s.slot_id,
							{ discord_username: s.discord_username, user_id: s.user_id },
						]),
				);
				const built = buildSwissRoundStatements(
					env,
					tournament,
					division,
					round.round_number + 1,
					divSlots,
					divMatchRefs,
					mapPool,
					slotIdentityById,
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
							`UPDATE tournaments
							 SET status = 'complete',
							     completed_at = datetime('now'),
							     updated_at = datetime('now')
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
					const mapPool = parseMapPool(tournament);
					const built = buildChampionshipRoundStatements(
						env,
						tournament,
						round.round_number + 1,
						pairings,
						matchRefs,
						mapPool,
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
		await logSystemTournamentAction(
			env,
			tournament.tournament_id,
			auditAction,
			auditMetadata,
		);
	} catch (e) {
		logError("tournament_auto_advance_failed", e, { match_id: matchId });
	}
}
