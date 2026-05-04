// /v1/games endpoints — upload, list, detail, delete.
//
// Mirrors the structure of legacy `handleUpload` (cloud/src/index.ts) but
// adapted for the cloud-rewrite:
//   - Auth: Discord session cookie (vs legacy app-key)
//   - Storage: gzipped JSON blob + raw ZIP, both in R2 under prefixes
//   - Indexing: D1 inserts into games + player_summaries + game_player_turn
//     + tech_events + law_events; OnlineID auto-link for picker pre-check
//   - Dedup: SHA-256 of raw ZIP, scoped per user
//
// The blob is FullGameData (spec §3); see cloud/src/schemas/game.ts.

import { nanoid } from "nanoid";
import * as v from "valibot";
import {
	FullGameDataSchema,
	UploaderPlayerIndexSchema,
	type FullGameData,
	type PlayerRosterEntry,
} from "./schemas/game";
import {
	cloudCorsHeaders,
	decompressWithLimit,
	errorResponse,
	jsonResponse,
	sha256Hex,
} from "./util";
import { sessionFromRequest } from "./session";
import type { SessionEnv } from "./session";
import { captureOnlineIds } from "./online-ids";

export interface GamesEnv extends SessionEnv {
	SHARE_BUCKET: R2Bucket;
	SHARE_DB: D1Database;
	ALLOWED_ORIGINS: string;
}

// Size + rate limits (spec §4)
const MAX_BLOB_COMPRESSED = 10 * 1024 * 1024; // 10 MB
const MAX_BLOB_DECOMPRESSED = 50 * 1024 * 1024; // 50 MB
const MAX_ZIP_BYTES = 50 * 1024 * 1024; // 50 MB
const PER_USER_UPLOADS_PER_HOUR = 20;
const PER_IP_UPLOADS_PER_HOUR = 30;
const GLOBAL_UPLOADS_PER_HOUR = 500;

// D1 caps bound parameters at 100 per query (much tighter than standalone
// SQLite's 999). Multi-row INSERTs chunked so N_rows × N_cols ≤ 99 to
// leave headroom. The trade-off vs the ex-990 cap is more statements per
// upload (~530 GPT statements for a 200-turn 8-player game), all bundled
// into one db.batch() call so it remains a single transaction.
const D1_MAX_PARAMS = 99;
const GPT_COLS = 33;
const GPT_ROWS_PER_INSERT = Math.floor(D1_MAX_PARAMS / GPT_COLS); // 3
const TECH_LAW_ROWS_PER_INSERT = Math.floor(D1_MAX_PARAMS / 4); // 24

// ---------- Rate limit checks (D1 events table) ----------

async function countUploadsSince(
	db: D1Database,
	column: "user_id" | "ip_address" | null,
	value: string | null,
): Promise<number> {
	const where = column
		? `${column} = ? AND event_type = 'upload' AND created_at > datetime('now', '-1 hour')`
		: `event_type = 'upload' AND created_at > datetime('now', '-1 hour')`;
	const stmt = db.prepare(`SELECT COUNT(*) as count FROM events WHERE ${where}`);
	const result = await (column && value !== null
		? stmt.bind(value).first<{ count: number }>()
		: stmt.first<{ count: number }>());
	return result?.count ?? 0;
}

// ---------- Helpers for D1 inserts ----------

function chunked<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

// Build a multi-row INSERT statement: `INSERT INTO t (c1,c2) VALUES (?,?), (?,?), ...`
function buildMultiRowInsert(
	table: string,
	columns: string[],
	rowCount: number,
): string {
	const placeholders = `(${columns.map(() => "?").join(",")})`;
	const valuesClause = Array(rowCount).fill(placeholders).join(", ");
	return `INSERT INTO ${table} (${columns.join(",")}) VALUES ${valuesClause}`;
}

// ---------- Field extractors (FullGameData → DB rows) ----------

interface GameRowInputs {
	gameId: string;
	userId: string;
	blob: FullGameData;
	fileHash: string;
	blobSize: number;
	uploaderIndex: number | null;
}

function buildGameRow(inp: GameRowInputs): {
	sql: string;
	bindings: unknown[];
} {
	const { gameId, userId, blob, fileHash, blobSize, uploaderIndex } = inp;
	const md = blob.match_metadata;
	const gd = blob.game_details as {
		winner_name: string | null;
		winner_civilization: string | null;
	};
	const winner = md.winner;
	const victoryType = winner?.victory_type ?? null;

	// In observer mode (uploaderIndex === null) user_nation and user_won are
	// both NULL — the uploader has no claim on the game's outcome.
	const roster = blob.player_roster as PlayerRosterEntry[];
	let userNation: string | null = null;
	let userWon: boolean | null = null;
	if (uploaderIndex !== null) {
		const uploader = roster.find((p) => p.player_index === uploaderIndex);
		userNation = uploader?.nation ?? null;
		userWon = winner ? winner.winner_player_xml_id === uploaderIndex : null;
	}

	return {
		sql: `INSERT INTO games (
			game_id, user_id, xml_game_id, total_turns, file_hash,
			game_name, save_date, map_size, map_class, game_mode,
			difficulty, opponent_level,
			winner_nation, winner_name, victory_type,
			user_nation, user_won,
			is_public,
			blob_version, blob_size_bytes, parser_version
		) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?, ?,?, ?, ?,?,?)`,
		bindings: [
			gameId, userId, md.xml_game_id, md.total_turns, fileHash,
			md.game_name, md.save_date, md.map_size, md.map_class, md.game_mode,
			md.difficulty, md.opponent_level,
			gd.winner_civilization, gd.winner_name, victoryType,
			userNation, userWon === null ? null : userWon ? 1 : 0,
			0, // is_public default false
			blob.version, blobSize, blob.parser_version,
		],
	};
}

interface SummaryRowInputs {
	gameId: string;
	roster: PlayerRosterEntry[];
	uploaderIndex: number | null;
	winnerIndex: number | null;
}

function buildSummaryStatements(
	db: D1Database,
	inp: SummaryRowInputs,
): D1PreparedStatement[] {
	const { gameId, roster, uploaderIndex, winnerIndex } = inp;
	const stmt = db.prepare(
		`INSERT INTO player_summaries (
			game_id, player_index, player_name, nation, is_human, is_uploader, is_winner
		) VALUES (?,?,?,?,?,?,?)`,
	);
	return roster.map((p) =>
		stmt.bind(
			gameId,
			p.player_index,
			p.player_name,
			p.nation,
			p.is_human ? 1 : 0,
			uploaderIndex !== null && p.player_index === uploaderIndex ? 1 : 0,
			winnerIndex !== null && p.player_index === winnerIndex ? 1 : 0,
		),
	);
}

// game_player_turn: build chunked multi-row INSERTs from yield_history +
// player_history.
//
// Wire shapes (src/lib/types/):
//   YieldHistory      = { player_id, yield_type, data: YieldDataPoint[] }
//   YieldDataPoint    = { turn, rate, cumulative }   ← both columns per point
//   PlayerHistory     = { player_id, history: PlayerHistoryPoint[] }
//   PlayerHistoryPoint= { turn, points, military_power, legitimacy }
//
// Pivot into rows keyed by (player_index, turn). Each yield entry fills two
// columns per turn (rate → *_per_turn, cumulative → *_cumulative). Each
// player_history point fills military_power + legitimacy.
//
// Yield name mapping: XML `YIELD_FOOD` → `food` → columns `food_per_turn`
// and `food_cumulative`.
function buildGamePlayerTurnStatements(
	db: D1Database,
	gameId: string,
	blob: FullGameData,
): D1PreparedStatement[] {
	type Row = Record<string, number | null>;
	const rowsByKey = new Map<string, Row>();

	const ensureRow = (playerIdx: number, turn: number): Row => {
		const key = `${playerIdx}:${turn}`;
		let row = rowsByKey.get(key);
		if (!row) {
			row = { player_index: playerIdx, turn };
			rowsByKey.set(key, row);
		}
		return row;
	};

	const yieldHistory = blob.yield_history as Array<{
		player_id: number;
		yield_type: string;
		data: Array<{ turn: number; rate: number | null; cumulative: number | null }>;
	}>;

	for (const entry of yieldHistory) {
		const yieldName = entry.yield_type.replace(/^YIELD_/, "").toLowerCase();
		const perTurnCol = `${yieldName}_per_turn`;
		const cumulativeCol = `${yieldName}_cumulative`;
		for (const point of entry.data) {
			const row = ensureRow(entry.player_id, point.turn);
			if (point.rate !== null) row[perTurnCol] = point.rate;
			if (point.cumulative !== null) row[cumulativeCol] = point.cumulative;
		}
	}

	const playerHistory = blob.player_history as Array<{
		player_id: number;
		history: Array<{
			turn: number;
			military_power: number | null;
			legitimacy: number | null;
		}>;
	}>;

	for (const entry of playerHistory) {
		for (const point of entry.history) {
			const row = ensureRow(entry.player_id, point.turn);
			if (point.military_power !== null) row.military_power = point.military_power;
			if (point.legitimacy !== null) row.legitimacy = point.legitimacy;
		}
	}

	if (rowsByKey.size === 0) return [];

	// Stable column order matches table definition.
	const columns = [
		"game_id", "player_index", "turn",
		"food_per_turn", "food_cumulative",
		"growth_per_turn", "growth_cumulative",
		"science_per_turn", "science_cumulative",
		"culture_per_turn", "culture_cumulative",
		"civics_per_turn", "civics_cumulative",
		"training_per_turn", "training_cumulative",
		"money_per_turn", "money_cumulative",
		"orders_per_turn", "orders_cumulative",
		"happiness_per_turn", "happiness_cumulative",
		"discontent_per_turn", "discontent_cumulative",
		"iron_per_turn", "iron_cumulative",
		"stone_per_turn", "stone_cumulative",
		"wood_per_turn", "wood_cumulative",
		"maintenance_per_turn", "maintenance_cumulative",
		"military_power", "legitimacy",
	];

	const allRows = Array.from(rowsByKey.values());
	const statements: D1PreparedStatement[] = [];

	for (const chunk of chunked(allRows, GPT_ROWS_PER_INSERT)) {
		const sql = buildMultiRowInsert("game_player_turn", columns, chunk.length);
		const bindings: unknown[] = [];
		for (const row of chunk) {
			for (const col of columns) {
				if (col === "game_id") bindings.push(gameId);
				else bindings.push(row[col] ?? null);
			}
		}
		statements.push(db.prepare(sql).bind(...bindings));
	}

	return statements;
}

function buildTechEventStatements(
	db: D1Database,
	gameId: string,
	blob: FullGameData,
): D1PreparedStatement[] {
	// PlayerTech wire shape (src/lib/types/PlayerTech.ts):
	//   { player_id, player_name, nation, tech, completed_turn }
	// Flat list across all players.
	const techs = blob.completed_techs as Array<{
		player_id: number;
		tech: string;
		completed_turn: number;
	}>;
	if (techs.length === 0) return [];

	const columns = ["game_id", "player_index", "tech", "turn"];
	const statements: D1PreparedStatement[] = [];

	for (const chunk of chunked(techs, TECH_LAW_ROWS_PER_INSERT)) {
		const sql = buildMultiRowInsert("tech_events", columns, chunk.length);
		const bindings: unknown[] = [];
		for (const t of chunk) {
			bindings.push(gameId, t.player_id, t.tech, t.completed_turn);
		}
		statements.push(db.prepare(sql).bind(...bindings));
	}

	return statements;
}

function buildLawEventStatements(
	db: D1Database,
	gameId: string,
	blob: FullGameData,
): D1PreparedStatement[] {
	// LawAdoptionHistory wire shape (src/lib/types/LawAdoptionHistory.ts):
	//   { player_id, data: LawAdoptionDataPoint[] }
	//   LawAdoptionDataPoint = { turn, law_count, law_name }
	// `law_name` is null on synthetic start/end points; filter those out
	// (only adoption events go into law_events).
	const lawHistory = blob.law_adoption_history as Array<{
		player_id: number;
		data: Array<{ turn: number; law_name: string | null }>;
	}>;

	type FlatRow = { playerIdx: number; law: string; turn: number };
	const flat: FlatRow[] = [];
	for (const entry of lawHistory) {
		for (const point of entry.data) {
			if (point.law_name === null) continue;
			flat.push({
				playerIdx: entry.player_id,
				law: point.law_name,
				turn: point.turn,
			});
		}
	}
	if (flat.length === 0) return [];

	const columns = ["game_id", "player_index", "law", "turn"];
	const statements: D1PreparedStatement[] = [];

	for (const chunk of chunked(flat, TECH_LAW_ROWS_PER_INSERT)) {
		const sql = buildMultiRowInsert("law_events", columns, chunk.length);
		const bindings: unknown[] = [];
		for (const r of chunk) {
			bindings.push(gameId, r.playerIdx, r.law, r.turn);
		}
		statements.push(db.prepare(sql).bind(...bindings));
	}

	return statements;
}

// ---------- Handlers ----------

export async function handleGameUpload(
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	const userId = session.data.user_id;
	const ip = request.headers.get("CF-Connecting-IP");

	// Rate limits (per-user, per-IP, global)
	if ((await countUploadsSince(env.SHARE_DB, "user_id", userId)) >= PER_USER_UPLOADS_PER_HOUR) {
		return errorResponse("Per-user upload limit exceeded", 429, cors, "RATE_LIMIT_USER");
	}
	if (ip && (await countUploadsSince(env.SHARE_DB, "ip_address", ip)) >= PER_IP_UPLOADS_PER_HOUR) {
		return errorResponse("Per-IP upload limit exceeded", 429, cors, "RATE_LIMIT_IP");
	}
	if ((await countUploadsSince(env.SHARE_DB, null, null)) >= GLOBAL_UPLOADS_PER_HOUR) {
		return errorResponse("Global upload limit exceeded", 429, cors, "RATE_LIMIT_GLOBAL");
	}

	// Parse multipart
	let form: FormData;
	try {
		form = await request.formData();
	} catch (err) {
		console.error("Multipart parse failed:", err);
		return errorResponse("Invalid multipart body", 400, cors, "INVALID_FORM");
	}

	// FormData entries are typed as FormDataEntryValue (string | File | null).
	// In the Workers runtime File extends Blob; we duck-type since Blob is
	// the structural ancestor and `instanceof Blob` doesn't work in the
	// workers-types DOM lib subset.
	const dataPart = form.get("data");
	const savePart = form.get("save");
	const indexRaw = form.get("uploader_player_index");
	const isBlobLike = (v: unknown): v is Blob =>
		!!v && typeof v === "object" && typeof (v as { arrayBuffer?: unknown }).arrayBuffer === "function";

	if (!isBlobLike(dataPart)) {
		return errorResponse("Missing 'data' part", 400, cors, "MISSING_DATA");
	}
	if (!isBlobLike(savePart)) {
		return errorResponse("Missing 'save' part", 400, cors, "MISSING_SAVE");
	}
	if (typeof indexRaw !== "string") {
		return errorResponse(
			"Missing 'uploader_player_index' field",
			400, cors, "MISSING_INDEX",
		);
	}
	const dataBlob = dataPart;
	const saveBlob = savePart;

	if (dataBlob.size > MAX_BLOB_COMPRESSED) {
		return errorResponse("Blob too large", 413, cors, "BLOB_TOO_LARGE");
	}
	if (saveBlob.size > MAX_ZIP_BYTES) {
		return errorResponse("ZIP too large", 413, cors, "ZIP_TOO_LARGE");
	}
	if (dataBlob.size === 0 || saveBlob.size === 0) {
		return errorResponse("Empty payload", 400, cors, "EMPTY_PAYLOAD");
	}

	// Decompress + parse blob
	const compressedData = await dataBlob.arrayBuffer();
	let decompressed: Uint8Array;
	try {
		decompressed = await decompressWithLimit(compressedData, MAX_BLOB_DECOMPRESSED);
	} catch (e) {
		console.error("Blob decompression rejected:", e instanceof Error ? e.message : "");
		return errorResponse("Decompressed payload too large", 413, cors, "DECOMPRESSED_TOO_LARGE");
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
		console.error("Blob validation failed:", issue?.message, issue?.path);
		return errorResponse(
			`Blob validation: ${issue?.message ?? "unknown"}`,
			400, cors, "INVALID_BLOB",
		);
	}
	const blob = validation.output;

	// Parse + validate uploader index. JSON-encoded so we can carry the
	// `null` sentinel for observer mode (form fields are strings).
	let indexParsed: unknown;
	try {
		indexParsed = JSON.parse(indexRaw);
	} catch {
		return errorResponse(
			"uploader_player_index is not valid JSON",
			400, cors, "INVALID_INDEX_JSON",
		);
	}
	const indexValidation = v.safeParse(UploaderPlayerIndexSchema, indexParsed);
	if (!indexValidation.success) {
		return errorResponse(
			`uploader_player_index: ${indexValidation.issues[0]?.message ?? "invalid"}`,
			400, cors, "INVALID_INDEX",
		);
	}

	// If a player was named, it must reference a human in the roster.
	// `null` = observer upload, no claim on any player.
	const roster = blob.player_roster as PlayerRosterEntry[];
	const humansByIndex = new Map<number, PlayerRosterEntry>(
		roster.filter((p) => p.is_human).map((p) => [p.player_index, p]),
	);
	const uploaderIndex = indexValidation.output;
	if (uploaderIndex !== null && !humansByIndex.has(uploaderIndex)) {
		return errorResponse(
			`Player index ${uploaderIndex} not found among humans`,
			400, cors, "UNKNOWN_PLAYER_INDEX",
		);
	}

	// Server-side hash of the raw ZIP. Don't trust client.
	const rawZip = await saveBlob.arrayBuffer();
	const fileHash = await sha256Hex(rawZip);

	// Dedup check
	const existing = await env.SHARE_DB.prepare(
		"SELECT game_id FROM games WHERE user_id = ? AND file_hash = ?",
	)
		.bind(userId, fileHash)
		.first<{ game_id: string }>();
	if (existing) {
		return jsonResponse(
			{ error: "Duplicate", code: "DUPLICATE", existing_game_id: existing.game_id },
			409,
			cors,
		);
	}

	// Game id + R2 keys
	const gameId = nanoid(21);
	const blobKey = `games/${gameId}.json.gz`;
	const zipKey = `saves/${gameId}.zip`;

	// R2 puts in parallel
	try {
		await Promise.all([
			env.SHARE_BUCKET.put(blobKey, compressedData, {
				httpMetadata: {
					contentType: "application/json",
					contentEncoding: "gzip",
				},
				customMetadata: { user_id: userId, created_at: new Date().toISOString() },
			}),
			env.SHARE_BUCKET.put(zipKey, rawZip, {
				httpMetadata: { contentType: "application/zip" },
				customMetadata: { user_id: userId, created_at: new Date().toISOString() },
			}),
		]);
	} catch (e) {
		console.error("R2 put failed:", e);
		return errorResponse("Storage write failed", 500, cors, "R2_FAILED");
	}

	// D1 inserts as a single transactional batch
	const winnerIndex = blob.match_metadata.winner?.winner_player_xml_id ?? null;
	const gameRow = buildGameRow({
		gameId, userId, blob, fileHash, blobSize: dataBlob.size, uploaderIndex,
	});
	const summaryStmts = buildSummaryStatements(env.SHARE_DB, {
		gameId, roster, uploaderIndex, winnerIndex,
	});
	const gptStmts = buildGamePlayerTurnStatements(env.SHARE_DB, gameId, blob);
	const techStmts = buildTechEventStatements(env.SHARE_DB, gameId, blob);
	const lawStmts = buildLawEventStatements(env.SHARE_DB, gameId, blob);

	const allStatements: D1PreparedStatement[] = [
		env.SHARE_DB.prepare(gameRow.sql).bind(...gameRow.bindings),
		...summaryStmts,
		...gptStmts,
		...techStmts,
		...lawStmts,
	];

	try {
		await env.SHARE_DB.batch(allStatements);
	} catch (e) {
		console.error(
			`D1_INSERT_FAILED: cleaning up R2 game_id=${gameId}`,
			e,
		);
		try {
			await Promise.all([
				env.SHARE_BUCKET.delete(blobKey),
				env.SHARE_BUCKET.delete(zipKey),
			]);
		} catch (cleanupErr) {
			console.error(`ORPHANED_BLOB: R2 cleanup failed game_id=${gameId}`, cleanupErr);
		}
		return errorResponse("Database write failed", 500, cors, "D1_FAILED");
	}

	// Auto-link the picked human's OnlineID. Observer uploads (uploaderIndex
	// null) capture nothing — they shouldn't pollute the user's known-id set.
	if (uploaderIndex !== null) {
		const pickedOnlineId = humansByIndex.get(uploaderIndex)?.online_id;
		if (typeof pickedOnlineId === "string" && pickedOnlineId !== "") {
			try {
				await captureOnlineIds(env, userId, [pickedOnlineId]);
			} catch (e) {
				// Non-fatal — uploads still succeed even if linking fails.
				console.error("captureOnlineIds failed:", e);
			}
		}
	}

	// Audit log
	try {
		await env.SHARE_DB.prepare(
			`INSERT INTO events (event_type, game_id, user_id, ip_address, metadata)
			 VALUES ('upload', ?, ?, ?, ?)`,
		)
			.bind(
				gameId,
				userId,
				ip,
				JSON.stringify({
					blob_size: dataBlob.size,
					decompressed_size: decompressed.byteLength,
					zip_size: rawZip.byteLength,
					uploader_index: uploaderIndex,
				}),
			)
			.run();
	} catch (e) {
		console.error("Failed to log upload event:", e);
	}

	return jsonResponse(
		{ game_id: gameId, url: `/games/${gameId}` },
		201,
		cors,
	);
}

export async function handleGameList(
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	const userId = session.data.user_id;

	const url = new URL(request.url);
	const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
	const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

	const rows = await env.SHARE_DB.prepare(
		`SELECT game_id, game_name, save_date, total_turns,
		        user_nation, user_won, winner_nation, victory_type,
		        map_size, is_public, created_at
		 FROM games WHERE user_id = ?
		 ORDER BY created_at DESC LIMIT ? OFFSET ?`,
	)
		.bind(userId, limit, offset)
		.all();
	const total = await env.SHARE_DB.prepare(
		"SELECT COUNT(*) AS count FROM games WHERE user_id = ?",
	)
		.bind(userId)
		.first<{ count: number }>();

	return jsonResponse(
		{ games: rows.results ?? [], total: total?.count ?? 0 },
		200,
		cors,
	);
}

export async function handleGameDetail(
	gameId: string,
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	const userId = session.data.user_id;

	const row = await env.SHARE_DB.prepare(
		"SELECT user_id FROM games WHERE game_id = ?",
	)
		.bind(gameId)
		.first<{ user_id: string }>();
	if (!row) return errorResponse("Not found", 404, cors, "NOT_FOUND");
	if (row.user_id !== userId) {
		return errorResponse("Forbidden", 403, cors, "FORBIDDEN");
	}

	const obj = await env.SHARE_BUCKET.get(`games/${gameId}.json.gz`);
	if (!obj) {
		return errorResponse("Blob missing", 404, cors, "BLOB_MISSING");
	}

	// Decompress in Worker — Cloudflare strips Content-Encoding from Worker
	// responses, so we can't pass the compressed body through directly.
	const compressed = await obj.arrayBuffer();
	const ds = new DecompressionStream("gzip");
	const writer = ds.writable.getWriter();
	writer.write(compressed);
	writer.close();

	return new Response(ds.readable, {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "private, max-age=300",
			...cors,
		},
	});
}

export async function handleGameDelete(
	gameId: string,
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	const userId = session.data.user_id;

	const row = await env.SHARE_DB.prepare(
		"SELECT user_id FROM games WHERE game_id = ?",
	)
		.bind(gameId)
		.first<{ user_id: string }>();
	if (!row) return errorResponse("Not found", 404, cors, "NOT_FOUND");
	if (row.user_id !== userId) {
		return errorResponse("Forbidden", 403, cors, "FORBIDDEN");
	}

	// R2 cleanup first (hardest to undo); D1 cascade handles dependents.
	try {
		await Promise.all([
			env.SHARE_BUCKET.delete(`games/${gameId}.json.gz`),
			env.SHARE_BUCKET.delete(`saves/${gameId}.zip`),
		]);
	} catch (e) {
		console.error("R2 delete failed (continuing to D1):", e);
	}

	await env.SHARE_DB.prepare("DELETE FROM games WHERE game_id = ?")
		.bind(gameId)
		.run();

	const ip = request.headers.get("CF-Connecting-IP");
	try {
		await env.SHARE_DB.prepare(
			`INSERT INTO events (event_type, game_id, user_id, ip_address)
			 VALUES ('delete', ?, ?, ?)`,
		)
			.bind(gameId, userId, ip)
			.run();
	} catch (e) {
		console.error("Failed to log delete event:", e);
	}

	return new Response(null, { status: 204, headers: cors });
}
