// Challenge maps: the public read surface, the creator's lifecycle endpoints
// and the map download. The run upload itself is a `challenge_id` field on
// POST /v1/games (games.ts) — see link.ts for its half.
//
// Design: docs/challenge-maps-design.md §6 (data), §7 (endpoints).

import { nanoid } from "nanoid";
import * as v from "valibot";
import { asScorable, extractSetup, validateChallengeMap } from "./scoring";
import {
	DEFAULT_CHALLENGE_DAYS,
	FIRST_CHALLENGE_NUMBER,
	type ChallengeSetup,
	type Criterion,
	type Objective,
	type Verdict,
} from "./types";
import { isSiteAdmin } from "../admin";
import { ceilingFrom } from "../read-budget";
import { buildAvatarUrl } from "../auth";
import {
	buildSaveFilename,
	countEventsSince,
	enforceDownloadRateLimit,
	isBlobLike,
	MAX_BLOB_COMPRESSED,
	MAX_BLOB_DECOMPRESSED,
	MAX_ZIP_BYTES,
	staleParserResponse,
	zipStreamResponse,
	type GamesEnv,
} from "../games";
import { displayNameSql } from "../identity";
import { beginR2Op, logError, logWarn, setLogField } from "../log";
import { enforceReadRateLimit, type ReadBudget } from "../read-budget";
import {
	CreateChallengeSchema,
	PatchChallengeSchema,
	type CreateChallengeInput,
} from "../schemas/challenge";
import { FullGameDataSchema } from "../schemas/game";
import { sessionFromRequest } from "../session";
import { CHUNK_SIZE, chunk } from "../stats/aggregate";
import {
	cloudCorsHeaders,
	decompressWithLimit,
	errorResponse,
	getClientIp,
	jsonResponse,
	parseJsonBody,
	sha256Hex,
} from "../util";

// ---------- Limits ----------

// Per-IP ceiling on the challenge pages (list, detail). The map download is
// session-gated and metered as a `download`.
//
// The default only — read the effective ceiling with challengeViewPerHour().
export const CHALLENGE_VIEW_PER_HOUR = 600;

// Effective ceilings: the wrangler var when it parses, the constant
// otherwise — the lever the tournament and /stats ceilings have, so a crawl
// mid-event is retuned with `wrangler secret put`, not a redeploy.
export function challengeViewPerHour(env: ChallengeReadEnv): number {
	return ceilingFrom(
		env.CHALLENGE_VIEW_PER_HOUR,
		CHALLENGE_VIEW_PER_HOUR,
		"CHALLENGE_VIEW_PER_HOUR",
	);
}
// The game→challenge link read gets its own budget, for the reason
// TOURNAMENT_LINK_VIEW_PER_HOUR documents: every /games/[id] render calls it
// whether or not the game is a run, so on the page budget a crawl of game
// pages would spend the challenge pages' allowance and 429 /challenges. Same
// ceiling — above ANON_READS_PER_HOUR so it's never the limit a real visitor
// meets first; when it fires, the game page's loader hides the banner.
//
// The default only — read the effective ceiling with challengeLinkViewPerHour().
export const CHALLENGE_LINK_VIEW_PER_HOUR = 600;

export function challengeLinkViewPerHour(env: ChallengeReadEnv): number {
	return ceilingFrom(
		env.CHALLENGE_LINK_VIEW_PER_HOUR,
		CHALLENGE_LINK_VIEW_PER_HOUR,
		"CHALLENGE_LINK_VIEW_PER_HOUR",
	);
}

// The two ceilings as wrangler vars (optional: unset falls back to the
// constants). GamesEnv carries them because the handlers here take GamesEnv.
export interface ChallengeReadEnv {
	CHALLENGE_VIEW_PER_HOUR?: string;
	CHALLENGE_LINK_VIEW_PER_HOUR?: string;
}
// Mirrors TOURNAMENT_CREATE_PER_USER_PER_HOUR: a map is a 1–50 MB R2 put.
const CHALLENGE_CREATE_PER_USER_PER_HOUR = 5;

const VIEW_BUDGET: ReadBudget = {
	eventType: "challenge_view",
	message: "Challenge view rate limit exceeded",
	code: "RATE_LIMIT_CHALLENGE_VIEW",
};

const LINK_BUDGET: ReadBudget = {
	eventType: "challenge_link_view",
	message: "Challenge link rate limit exceeded",
	code: "RATE_LIMIT_CHALLENGE_LINK",
};

const CHALLENGE_NUMBER_RE = /^\d{1,6}$/;

// ---------- Rows and serialization ----------

interface ChallengeRow {
	challenge_id: string;
	number: number;
	title: string;
	description: string | null;
	created_by: string;
	closes_at: string;
	setup: string;
	objectives: string;
	criteria: string;
	map_size_bytes: number;
	created_at: string;
	updated_at: string;
	closed: number;
	creator_name: string;
	creator_discord_id: string;
	creator_avatar_hash: string | null;
	creator_slug: string | null;
	submission_count: number;
	runner_count: number;
}

// One SELECT shape for list and detail so the two can't drift on a column.
const CHALLENGE_SELECT = `
	SELECT c.challenge_id, c.number, c.title, c.description, c.created_by,
	       c.closes_at, c.setup, c.objectives, c.criteria,
	       c.map_size_bytes, c.created_at, c.updated_at,
	       (c.closes_at <= datetime('now')) AS closed,
	       ${displayNameSql("u")} AS creator_name,
	       u.discord_id AS creator_discord_id,
	       u.avatar_hash AS creator_avatar_hash,
	       u.slug AS creator_slug,
	       (SELECT COUNT(*) FROM challenge_submissions s WHERE s.challenge_id = c.challenge_id) AS submission_count,
	       (SELECT COUNT(DISTINCT s.user_id) FROM challenge_submissions s WHERE s.challenge_id = c.challenge_id) AS runner_count
	FROM challenges c
	JOIN users u ON u.user_id = c.created_by`;

interface LeaderboardRow {
	submission_id: string;
	game_id: string;
	user_id: string;
	score_turn: number;
	verdict: string;
	created_at: string;
	display_name: string;
	discord_id: string;
	avatar_hash: string | null;
	slug: string | null;
	game_name: string | null;
}

export interface LeaderboardEntry {
	rank: number;
	submission_id: string;
	game_id: string;
	game_name: string | null;
	score_turn: number;
	earliest_turn: number | null;
	submitted_at: string;
	user: PublicUser;
}

interface PublicUser {
	user_id: string;
	display_name: string;
	avatar_url: string;
	slug: string | null;
}

function publicUser(r: {
	user_id: string;
	display_name: string;
	discord_id: string;
	avatar_hash: string | null;
	slug: string | null;
}): PublicUser {
	return {
		user_id: r.user_id,
		display_name: r.display_name,
		avatar_url: buildAvatarUrl(r.discord_id, r.avatar_hash),
		slug: r.slug,
	};
}

// D1's datetime('now') is "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker,
// which `new Date()` reads as local time. The challenge timestamps drive
// "closes in 3 days" labels, so they go out as ISO instants.
function sqliteToIso(ts: string): string {
	return `${ts.replace(" ", "T")}Z`;
}

function serializeChallenge(row: ChallengeRow) {
	return {
		challenge_id: row.challenge_id,
		number: row.number,
		title: row.title,
		description: row.description,
		status: row.closed === 1 ? "closed" : "open",
		closes_at: sqliteToIso(row.closes_at),
		created_at: sqliteToIso(row.created_at),
		updated_at: sqliteToIso(row.updated_at),
		creator: publicUser({
			user_id: row.created_by,
			display_name: row.creator_name,
			discord_id: row.creator_discord_id,
			avatar_hash: row.creator_avatar_hash,
			slug: row.creator_slug,
		}),
		setup: JSON.parse(row.setup) as ChallengeSetup,
		objectives: JSON.parse(row.objectives) as Objective[],
		criteria: JSON.parse(row.criteria) as Criterion[],
		map_size_bytes: row.map_size_bytes,
		submission_count: row.submission_count,
		runner_count: row.runner_count,
	};
}

// The leaderboard: every accepted run ordered by score, reduced to each
// runner's best. Ties break on who got there first. Done in JS rather than a
// window function — the rows are already in rank order, and a challenge has
// dozens of runs, not thousands.
async function loadLeaderboard(
	env: GamesEnv,
	challengeId: string,
): Promise<{ entries: LeaderboardEntry[]; runs: LeaderboardEntry[] }> {
	const res = await env.SHARE_DB.prepare(
		`SELECT s.submission_id, s.game_id, s.user_id, s.score_turn, s.verdict, s.created_at,
		        ${displayNameSql("u")} AS display_name, u.discord_id, u.avatar_hash, u.slug,
		        g.display_name AS game_name
		 FROM challenge_submissions s
		 JOIN users u ON u.user_id = s.user_id
		 JOIN games g ON g.game_id = s.game_id
		 WHERE s.challenge_id = ?
		 ORDER BY s.score_turn ASC, s.created_at ASC`,
	)
		.bind(challengeId)
		.all<LeaderboardRow>();
	const runs: LeaderboardEntry[] = [];
	const entries: LeaderboardEntry[] = [];
	const seen = new Set<string>();
	for (const r of res.results ?? []) {
		let earliest: number | null = null;
		try {
			earliest = (JSON.parse(r.verdict) as Verdict).earliest_turn;
		} catch {
			/* a malformed verdict just loses the secondary column */
		}
		const entry: LeaderboardEntry = {
			rank: 0,
			submission_id: r.submission_id,
			game_id: r.game_id,
			game_name: r.game_name,
			score_turn: r.score_turn,
			earliest_turn: earliest,
			submitted_at: sqliteToIso(r.created_at),
			user: publicUser(r),
		};
		runs.push(entry);
		if (!seen.has(r.user_id)) {
			seen.add(r.user_id);
			entries.push({ ...entry, rank: entries.length + 1 });
		}
	}
	return { entries, runs };
}

async function loadChallengeByNumber(
	env: GamesEnv,
	number: number,
): Promise<ChallengeRow | null> {
	return env.SHARE_DB.prepare(`${CHALLENGE_SELECT} WHERE c.number = ?`)
		.bind(number)
		.first<ChallengeRow>();
}

function parseNumber(raw: string): number | null {
	if (!CHALLENGE_NUMBER_RE.test(raw)) return null;
	return Number(raw);
}

// ---------- Reads ----------

// GET /v1/challenges?status=open|closed|all — newest first. Public.
export async function handleChallengeList(
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const rl = await enforceReadRateLimit(
		env,
		request,
		cors,
		VIEW_BUDGET,
		challengeViewPerHour(env),
	);
	if (rl) return rl;
	const status = new URL(request.url).searchParams.get("status") ?? "all";
	const where =
		status === "open"
			? "WHERE c.closes_at > datetime('now')"
			: status === "closed"
				? "WHERE c.closes_at <= datetime('now')"
				: "";
	const res = await env.SHARE_DB.prepare(
		`${CHALLENGE_SELECT} ${where} ORDER BY c.number DESC LIMIT 200`,
	).all<ChallengeRow>();
	const rows = res.results ?? [];
	// The best run per challenge, for the browse cards. One query per
	// CHUNK_SIZE challenges rather than one per card — the page can list up to
	// 200, and D1 binds at most 100 parameters per statement.
	const bests = new Map<string, LeaderboardEntry>();
	for (const ids of chunk(
		rows.map((r) => r.challenge_id),
		CHUNK_SIZE,
	)) {
		const best = await env.SHARE_DB.prepare(
			`SELECT s.challenge_id, s.submission_id, s.game_id, s.user_id, s.score_turn, s.verdict, s.created_at,
			        ${displayNameSql("u")} AS display_name, u.discord_id, u.avatar_hash, u.slug,
			        g.display_name AS game_name
			 FROM challenge_submissions s
			 JOIN users u ON u.user_id = s.user_id
			 JOIN games g ON g.game_id = s.game_id
			 WHERE s.challenge_id IN (${ids.map(() => "?").join(", ")})
			 ORDER BY s.score_turn ASC, s.created_at ASC`,
		)
			.bind(...ids)
			.all<LeaderboardRow & { challenge_id: string }>();
		for (const r of best.results ?? []) {
			if (bests.has(r.challenge_id)) continue;
			bests.set(r.challenge_id, {
				rank: 1,
				submission_id: r.submission_id,
				game_id: r.game_id,
				game_name: r.game_name,
				score_turn: r.score_turn,
				earliest_turn: null,
				submitted_at: sqliteToIso(r.created_at),
				user: publicUser(r),
			});
		}
	}
	return jsonResponse(
		{
			challenges: rows.map((r) => ({
				...serializeChallenge(r),
				best: bests.get(r.challenge_id) ?? null,
			})),
		},
		200,
		cors,
	);
}

// GET /v1/challenges/:number — the challenge, its leaderboard, and what the
// viewer can do with it. Public; `viewer` is null for anonymous callers.
export async function handleChallengeDetail(
	numberRaw: string,
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const rl = await enforceReadRateLimit(
		env,
		request,
		cors,
		VIEW_BUDGET,
		challengeViewPerHour(env),
	);
	if (rl) return rl;
	const number = parseNumber(numberRaw);
	const row = number === null ? null : await loadChallengeByNumber(env, number);
	if (!row) return errorResponse("Not found", 404, cors, "NOT_FOUND");
	const [board, session] = await Promise.all([
		loadLeaderboard(env, row.challenge_id),
		sessionFromRequest(env, request),
	]);
	let viewer: { can_manage: boolean; runs: LeaderboardEntry[] } | null = null;
	if (session) {
		const uid = session.data.user_id;
		const admin = await isSiteAdmin(env, session);
		viewer = {
			can_manage: row.created_by === uid || admin,
			runs: board.runs.filter((e) => e.user.user_id === uid),
		};
	}
	return jsonResponse(
		{
			challenge: serializeChallenge(row),
			leaderboard: board.entries,
			viewer,
		},
		200,
		cors,
	);
}

// GET /v1/games/:id/challenge-link — which challenge a game is a run of, or
// null. The /games/[id] banner; public like the rest of the surface.
export async function handleGameChallengeLink(
	gameId: string,
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const rl = await enforceReadRateLimit(
		env,
		request,
		cors,
		LINK_BUDGET,
		challengeLinkViewPerHour(env),
	);
	if (rl) return rl;
	const row = await env.SHARE_DB.prepare(
		`SELECT c.number, c.title, s.score_turn,
		        (SELECT COUNT(*) + 1 FROM challenge_submissions s2
		          WHERE s2.challenge_id = s.challenge_id
		            AND (s2.score_turn < s.score_turn
		                 OR (s2.score_turn = s.score_turn AND s2.created_at < s.created_at))) AS rank
		 FROM challenge_submissions s
		 JOIN challenges c ON c.challenge_id = s.challenge_id
		 WHERE s.game_id = ?`,
	)
		.bind(gameId)
		.first<{
			number: number;
			title: string;
			score_turn: number;
			rank: number;
		}>();
	if (!row) return jsonResponse({ link: null }, 200, cors);
	return jsonResponse(
		{
			link: {
				number: row.number,
				title: row.title,
				score_turn: row.score_turn,
				rank: row.rank,
			},
		},
		200,
		cors,
	);
}

// GET /v1/challenges/:number/map — the map ZIP. Any logged-in user; metered
// as a `download` like a save, and streamed the same way.
export async function handleChallengeMap(
	numberRaw: string,
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	const number = parseNumber(numberRaw);
	const row =
		number === null
			? null
			: await env.SHARE_DB.prepare(
					"SELECT challenge_id, number, title, map_r2_key FROM challenges WHERE number = ?",
				)
					.bind(number)
					.first<{
						challenge_id: string;
						number: number;
						title: string;
						map_r2_key: string;
					}>();
	if (!row) return errorResponse("Not found", 404, cors, "NOT_FOUND");

	const userId = session.data.user_id;
	const ip = getClientIp(request);
	const rl = await enforceDownloadRateLimit(env, userId, ip, cors);
	if (rl) return rl;
	// Streamed, not cached — same reasoning as handleGameDownload.
	setLogField("r2_op", "streamed");
	const obj = await env.SHARE_BUCKET.get(row.map_r2_key);
	if (!obj) {
		logError("challenge_map_missing", null, {
			challenge_id: row.challenge_id,
		});
		return errorResponse("Map not found", 404, cors, "NOT_FOUND");
	}
	env.EVENTS_DB.prepare(
		`INSERT INTO events (event_type, user_id, ip_address, metadata)
		 VALUES ('download', ?, ?, ?)`,
	)
		.bind(
			userId,
			ip,
			JSON.stringify({ challenge_id: row.challenge_id, size: obj.size }),
		)
		.run()
		.catch((e: unknown) => {
			logError("audit_event_log_failed", e, {
				event_type: "download",
				challenge_id: row.challenge_id,
			});
		});
	return zipStreamResponse(
		obj,
		buildSaveFilename(`Challenge ${row.number} ${row.title}`, row.challenge_id),
		cors,
	);
}

// ---------- Creator lifecycle ----------

function closesAtFrom(days: number): string {
	// ISO without milliseconds, the shape datetime('now') compares against.
	return new Date(Date.now() + days * 86_400_000)
		.toISOString()
		.replace(/\.\d{3}Z$/, "")
		.replace("T", " ");
}

// POST /v1/challenges — multipart: `meta` (JSON, CreateChallengeSchema),
// `data` (the gzipped parsed blob, as an upload sends it) and `save` (the
// map ZIP). The setup is extracted server-side from the blob; the client's
// preview of it is never trusted.
export async function handleCreateChallenge(
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	const userId = session.data.user_id;

	const created = await countEventsSince(
		env.EVENTS_DB,
		"challenge_create",
		"user_id",
		userId,
	);
	if (created >= CHALLENGE_CREATE_PER_USER_PER_HOUR) {
		return errorResponse(
			"Challenge create rate limit exceeded",
			429,
			cors,
			"RATE_LIMIT_CHALLENGE_CREATE",
		);
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return errorResponse("Invalid multipart body", 400, cors, "INVALID_FORM");
	}
	const metaRaw = form.get("meta");
	const dataPart = form.get("data");
	const savePart = form.get("save");
	if (typeof metaRaw !== "string") {
		return errorResponse("Missing 'meta' part", 400, cors, "MISSING_META");
	}
	if (!isBlobLike(dataPart)) {
		return errorResponse("Missing 'data' part", 400, cors, "MISSING_DATA");
	}
	if (!isBlobLike(savePart)) {
		return errorResponse("Missing 'save' part", 400, cors, "MISSING_SAVE");
	}
	let metaJson: unknown;
	try {
		metaJson = JSON.parse(metaRaw);
	} catch {
		return errorResponse("meta is not valid JSON", 400, cors, "INVALID_JSON");
	}
	const meta = v.safeParse(CreateChallengeSchema, metaJson);
	if (!meta.success) {
		const issue = meta.issues[0];
		return errorResponse(
			`meta: ${issue?.message ?? "invalid"}`,
			400,
			cors,
			"INVALID_META",
		);
	}
	const input: CreateChallengeInput = meta.output;

	if (dataPart.size > MAX_BLOB_COMPRESSED) {
		return errorResponse("Blob too large", 413, cors, "BLOB_TOO_LARGE");
	}
	if (savePart.size > MAX_ZIP_BYTES) {
		return errorResponse("ZIP too large", 413, cors, "ZIP_TOO_LARGE");
	}
	if (dataPart.size === 0 || savePart.size === 0) {
		return errorResponse("Empty payload", 400, cors, "EMPTY_PAYLOAD");
	}

	let decompressed: Uint8Array;
	try {
		decompressed = await decompressWithLimit(
			await dataPart.arrayBuffer(),
			MAX_BLOB_DECOMPRESSED,
		);
	} catch (e) {
		logWarn("blob_decompress_failed", {
			message: e instanceof Error ? e.message : "unknown",
		});
		return errorResponse(
			"Decompressed payload too large",
			413,
			cors,
			"DECOMPRESSED_TOO_LARGE",
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(decompressed));
	} catch {
		return errorResponse("Invalid JSON in blob", 400, cors, "INVALID_JSON");
	}
	const validation = v.safeParse(FullGameDataSchema, parsed);
	if (!validation.success) {
		const issue = validation.issues[0];
		logWarn("blob_validation_failed", {
			message: issue?.message,
			path: issue?.path?.map((p) => String(p.key)).join(".") ?? null,
		});
		return errorResponse(
			`Blob validation: ${issue?.message ?? "unknown"}`,
			400,
			cors,
			"INVALID_BLOB",
		);
	}
	const stale = staleParserResponse(validation.output.parser_version, cors);
	if (stale) return stale;
	const blob = asScorable(validation.output);
	const problems = validateChallengeMap(blob);
	if (problems.length > 0) {
		return errorResponse(problems.join(" "), 400, cors, "INVALID_MAP", {
			problems,
		});
	}
	const setup = extractSetup(blob);

	const rawZip = await savePart.arrayBuffer();
	const fileHash = await sha256Hex(rawZip);
	const challengeId = nanoid(21);
	const mapKey = `challenges/${challengeId}/map.zip`;

	const endPut = beginR2Op();
	try {
		await env.SHARE_BUCKET.put(mapKey, rawZip, {
			httpMetadata: { contentType: "application/zip" },
		});
	} catch (e) {
		logError("r2_put_failed", e, { challenge_id: challengeId });
		return errorResponse("Storage write failed", 500, cors, "R2_FAILED");
	} finally {
		endPut();
	}

	// Number allocation is a subquery in the INSERT so two creators racing
	// can't both read the same MAX; the UNIQUE index turns a lost race into
	// a failure the loser retries once (design §6) rather than a duplicate #N.
	const closesAt = closesAtFrom(input.duration_days ?? DEFAULT_CHALLENGE_DAYS);
	const insert = env.SHARE_DB.prepare(
		`INSERT INTO challenges
		   (challenge_id, number, title, description, created_by, closes_at,
		    setup, objectives, criteria,
		    map_r2_key, map_file_hash, map_size_bytes)
		 VALUES (?, (SELECT COALESCE(MAX(number) + 1, ?) FROM challenges), ?, ?, ?, ?,
		         ?, ?, ?, ?, ?, ?)`,
	).bind(
		challengeId,
		FIRST_CHALLENGE_NUMBER,
		input.title,
		input.description ?? null,
		userId,
		closesAt,
		JSON.stringify(setup),
		JSON.stringify(input.objectives),
		JSON.stringify(input.criteria),
		mapKey,
		fileHash,
		rawZip.byteLength,
	);
	try {
		try {
			await insert.run();
		} catch (e) {
			if (!isNumberRace(e)) throw e;
			await insert.run();
		}
	} catch (e) {
		logError("d1_insert_failed", e, { challenge_id: challengeId });
		try {
			await env.SHARE_BUCKET.delete(mapKey);
		} catch (cleanupErr) {
			logError("orphaned_blob", cleanupErr, { challenge_id: challengeId });
		}
		return errorResponse("Database write failed", 500, cors, "D1_FAILED");
	}

	await audit(env, "challenge_create", userId, request, {
		challenge_id: challengeId,
		map_size: rawZip.byteLength,
	});

	const row = await env.SHARE_DB.prepare(
		`${CHALLENGE_SELECT} WHERE c.challenge_id = ?`,
	)
		.bind(challengeId)
		.first<ChallengeRow>();
	if (!row) {
		// The insert just succeeded on this same primary handle.
		logError("d1_read_after_write_missed", new Error("challenge row missing"), {
			challenge_id: challengeId,
		});
		return errorResponse("Database read failed", 500, cors, "D1_FAILED");
	}
	return jsonResponse({ challenge: serializeChallenge(row) }, 201, cors);
}

// The lost side of a numbering race: SQLite names the column in the message.
function isNumberRace(e: unknown): boolean {
	return (
		e instanceof Error &&
		e.message.includes("UNIQUE constraint failed: challenges.number")
	);
}

// Creator (or site admin) check shared by PATCH and DELETE. 404 rather than
// 403 for non-creators, matching how games hide existence.
async function loadOwnedChallenge(
	numberRaw: string,
	request: Request,
	env: GamesEnv,
	cors: Record<string, string>,
): Promise<
	| { ok: true; row: ChallengeRow; userId: string; isAdmin: boolean }
	| { ok: false; response: Response }
> {
	const session = await sessionFromRequest(env, request);
	if (!session) {
		return {
			ok: false,
			response: errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED"),
		};
	}
	const number = parseNumber(numberRaw);
	const row = number === null ? null : await loadChallengeByNumber(env, number);
	const isAdmin = await isSiteAdmin(env, session);
	if (!row || (row.created_by !== session.data.user_id && !isAdmin)) {
		return {
			ok: false,
			response: errorResponse("Not found", 404, cors, "NOT_FOUND"),
		};
	}
	return { ok: true, row, userId: session.data.user_id, isAdmin };
}

// PATCH /v1/challenges/:number — title and description always; duration
// while the challenge is open (a final leaderboard stays final); objectives
// and criteria only until the first run is in (the leaderboard would
// otherwise rank runs scored against different rules).
export async function handlePatchChallenge(
	numberRaw: string,
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const owned = await loadOwnedChallenge(numberRaw, request, env, cors);
	if (!owned.ok) return owned.response;
	const { row, userId } = owned;
	const body = await parseJsonBody(request, PatchChallengeSchema, cors);
	if (!body.ok) return body.response;
	const input = body.body;

	const touchesRules =
		input.objectives !== undefined || input.criteria !== undefined;
	if (touchesRules && row.submission_count > 0) {
		return errorResponse(
			"Rules lock once a run has been submitted",
			409,
			cors,
			"CHALLENGE_RULES_LOCKED",
		);
	}
	if (input.duration_days !== undefined && row.closed === 1) {
		return errorResponse(
			"A closed challenge stays closed",
			409,
			cors,
			"CHALLENGE_CLOSED",
		);
	}

	const sets: string[] = [];
	const binds: unknown[] = [];
	if (input.title !== undefined) {
		sets.push("title = ?");
		binds.push(input.title);
	}
	if (input.description !== undefined) {
		sets.push("description = ?");
		binds.push(input.description);
	}
	if (input.duration_days !== undefined) {
		// Duration is measured from creation, as at create time.
		sets.push("closes_at = datetime(created_at, ?)");
		binds.push(`+${input.duration_days} days`);
	}
	if (input.objectives !== undefined) {
		sets.push("objectives = ?");
		binds.push(JSON.stringify(input.objectives));
	}
	if (input.criteria !== undefined) {
		sets.push("criteria = ?");
		binds.push(JSON.stringify(input.criteria));
	}
	sets.push("updated_at = datetime('now')");
	await env.SHARE_DB.prepare(
		`UPDATE challenges SET ${sets.join(", ")} WHERE challenge_id = ?`,
	)
		.bind(...binds, row.challenge_id)
		.run();

	await audit(env, "challenge_admin", userId, request, {
		challenge_id: row.challenge_id,
		action: "patch",
		fields: Object.keys(input),
	});

	const updated = await loadChallengeByNumber(env, row.number);
	return jsonResponse({ challenge: serializeChallenge(updated!) }, 200, cors);
}

// DELETE /v1/challenges/:number — drops the challenge and its submissions'
// links (the runs stay in their owners' libraries) and the map from R2. The
// creator can only while no run is in — the same lock as the rules, since
// other people's places on the board are what would go; an admin always.
export async function handleDeleteChallenge(
	numberRaw: string,
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const owned = await loadOwnedChallenge(numberRaw, request, env, cors);
	if (!owned.ok) return owned.response;
	const { row, userId, isAdmin } = owned;
	if (row.submission_count > 0 && !isAdmin) {
		return errorResponse(
			"A challenge with runs on its board can only be removed by an admin",
			409,
			cors,
			"CHALLENGE_HAS_RUNS",
		);
	}
	const mapKey = await env.SHARE_DB.prepare(
		"SELECT map_r2_key FROM challenges WHERE challenge_id = ?",
	)
		.bind(row.challenge_id)
		.first<{ map_r2_key: string }>();
	await env.SHARE_DB.prepare("DELETE FROM challenges WHERE challenge_id = ?")
		.bind(row.challenge_id)
		.run();
	if (mapKey) {
		const endDel = beginR2Op();
		try {
			await env.SHARE_BUCKET.delete(mapKey.map_r2_key);
		} catch (e) {
			logError("orphaned_blob", e, { challenge_id: row.challenge_id });
		} finally {
			endDel();
		}
	}
	await audit(env, "challenge_admin", userId, request, {
		challenge_id: row.challenge_id,
		number: row.number,
		action: "delete",
		submissions: row.submission_count,
	});
	return jsonResponse({ deleted: true }, 200, cors);
}

async function audit(
	env: GamesEnv,
	eventType: "challenge_create" | "challenge_admin",
	userId: string,
	request: Request,
	metadata: Record<string, unknown>,
): Promise<void> {
	try {
		await env.EVENTS_DB.prepare(
			`INSERT INTO events (event_type, user_id, ip_address, metadata)
			 VALUES (?, ?, ?, ?)`,
		)
			.bind(eventType, userId, getClientIp(request), JSON.stringify(metadata))
			.run();
	} catch (e) {
		logError("audit_event_log_failed", e, { event_type: eventType });
	}
}
