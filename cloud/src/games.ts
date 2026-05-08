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
	GamePatchSchema,
	UploaderPlayerIndexSchema,
	type FullGameData,
	type PlayerRosterEntry,
} from "./schemas/game";
import {
	cloudCorsHeaders,
	decompressWithLimit,
	errorResponse,
	getClientIp,
	jsonResponse,
	sha256Hex,
} from "./util";
import { sessionFromRequest } from "./session";
import type { SessionEnv } from "./session";
import { captureOnlineIds } from "./online-ids";
import {
	buildSummaryGameContext,
	derivePlayerSummary,
} from "./derive-player-summary";

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

// Anonymous public-game read limit (per-IP, global via D1 `events` table).
const ANON_READS_PER_HOUR = 200;

// Per-user PATCH limit on visibility toggles. Generous — one toggle per
// minute for an hour straight is well past human use.
const PER_USER_PATCH_PER_HOUR = 60;

// Save-download limits. Per-user is the meaningful signal (auth required);
// per-IP is a backstop for one user spamming from one IP.
const PER_USER_DOWNLOADS_PER_HOUR = 50;
const PER_IP_DOWNLOADS_PER_HOUR = 100;

// User agents we treat as link-preview scrapers and exempt from anon read
// rate-limiting. Trivially spoofable, but the data is public — this is
// availability defense, not security. Match by case-insensitive prefix.
const SCRAPER_UA_PREFIXES = [
	"discordbot/",
	"slackbot-linkexpanding",
	"slackbot/",
	"twitterbot/",
	"facebookexternalhit/",
	"linkedinbot/",
	"telegrambot",
	"whatsapp/",
];

function isScraperUA(ua: string | null): boolean {
	if (!ua) return false;
	const lower = ua.toLowerCase();
	return SCRAPER_UA_PREFIXES.some((p) => lower.startsWith(p));
}

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

// Count `events` rows with the given event_type in the last hour, optionally
// filtered by user_id or ip_address. Used for per-user / per-IP / global
// rate limits across upload, visibility_change, download, and anon_read.
//
// `event_type` is a fixed allowlist rather than free-form to keep the SQL
// safely parameterized (event_type can't be a bind parameter — it's part
// of the WHERE clause structure — but the allowlist closes the injection
// path while still letting all callers share one query shape).
type RateLimitedEventType =
	| "upload"
	| "reimport"
	| "visibility_change"
	| "download"
	| "anon_read";

// Upload rate limits cover both first-time uploads and re-imports — both
// hit the same R2 puts + D1 batch, so they cost the same.
const UPLOAD_EVENT_TYPES = ["upload", "reimport"] as const;

async function countEventsSince(
	db: D1Database,
	eventType: RateLimitedEventType | readonly RateLimitedEventType[],
	column: "user_id" | "ip_address" | null,
	value: string | null,
): Promise<number> {
	const types: RateLimitedEventType[] = Array.isArray(eventType)
		? [...eventType]
		: [eventType as RateLimitedEventType];
	const placeholders = types.map(() => "?").join(", ");
	const where = column
		? `${column} = ? AND event_type IN (${placeholders}) AND created_at > datetime('now', '-1 hour')`
		: `event_type IN (${placeholders}) AND created_at > datetime('now', '-1 hour')`;
	const stmt = db.prepare(`SELECT COUNT(*) as count FROM events WHERE ${where}`);
	const result = await (column && value !== null
		? stmt.bind(value, ...types).first<{ count: number }>()
		: stmt.bind(...types).first<{ count: number }>());
	return result?.count ?? 0;
}

// Strip Steam/GOG/Epic OnlineIDs from a parsed FullGameData blob before
// returning it to anonymous viewers. The owner clicked Make Public on
// their own game; opponents' platform IDs are not theirs to publish.
//
// `player_name` is intentionally preserved — it's the in-game identity
// used to discuss who won. `online_id` is the cross-platform tracking
// surface and is the only field we strip.
//
// Deep walk by design: most of FullGameData is typed as `v.unknown()` /
// `v.array(v.unknown())` in schemas/game.ts (player_history, player_nations,
// game_religions, current_laws, completed_techs, map_tiles, etc. — opaque
// parser payloads round-tripped to R2). Today only `player_roster` carries
// `online_id`, but a future parser version that lands the field anywhere
// else would silently leak past a roster-only sweep. The walk preserves
// the input subtree by reference whenever no rewrite happens, so unchanged
// branches don't allocate.
function stripOnlineIds(blob: unknown): unknown {
	return stripOnlineIdsDeep(blob);
}

function stripOnlineIdsDeep(node: unknown): unknown {
	if (Array.isArray(node)) {
		let changed = false;
		const out: unknown[] = new Array(node.length);
		for (let i = 0; i < node.length; i++) {
			const next = stripOnlineIdsDeep(node[i]);
			if (next !== node[i]) changed = true;
			out[i] = next;
		}
		return changed ? out : node;
	}
	if (node !== null && typeof node === "object") {
		const obj = node as Record<string, unknown>;
		let changed = false;
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(obj)) {
			const value = obj[key];
			if (key === "online_id" && value !== null) {
				out[key] = null;
				changed = true;
			} else {
				const next = stripOnlineIdsDeep(value);
				if (next !== value) changed = true;
				out[key] = next;
			}
		}
		return changed ? out : node;
	}
	return node;
}

// ---------- Save-download filename helpers ----------

// Sanitize a user-supplied game_name into a filesystem-safe filename for
// the Content-Disposition header. Keeps printable Unicode (so non-ASCII
// names like "Caesar Civil War" survive into the filename* UTF-8 form),
// strips path separators and control chars, collapses whitespace, trims
// to a sensible length. Falls back to the gameId on null/empty/all-junk.
function buildSaveFilename(name: string | null, gameId: string): string {
	if (!name) return `${gameId}.zip`;
	// Strip path separators, drive colons, quotes, control chars, and shell
	// glob metacharacters. Replace runs of whitespace with a single space.
	const cleaned = name
		// eslint-disable-next-line no-control-regex
		.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^[.\s]+|[.\s]+$/g, ""); // strip leading/trailing dots+spaces (Windows hates them)
	if (!cleaned) return `${gameId}.zip`;
	// 120 chars + ".zip" stays under the typical filesystem 255-char limit
	// even with UTF-8 multi-byte expansion.
	const truncated = cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
	return `${truncated}.zip`;
}

// Build an RFC 6266 Content-Disposition value with both an ASCII fallback
// and a UTF-8 form. Browsers prefer `filename*=UTF-8''...`; older clients
// fall back to plain `filename="..."`.
function buildContentDisposition(filename: string): string {
	// ASCII fallback: replace any non-ASCII char with '_' so the quoted
	// `filename` value stays in the latin-1 character set HTTP headers
	// historically allowed. Modern browsers ignore this when filename* is
	// present; it's a safety net for clients that don't speak RFC 5987.
	// eslint-disable-next-line no-control-regex
	const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
	const encoded = encodeURIComponent(filename);
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
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

// ---------- Semver helper ----------

// Strict numeric semver compare. Returns -1, 0, or 1 for a < b, a == b, a > b.
// Three-segment "X.Y.Z" only — no pre-release/build suffix support, since
// PARSER_VERSION never carries one. Non-numeric segments compare as 0.
function compareSemver(a: string, b: string): number {
	const pa = a.split(".").map((s) => parseInt(s, 10) || 0);
	const pb = b.split(".").map((s) => parseInt(s, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const da = pa[i] ?? 0;
		const db = pb[i] ?? 0;
		if (da < db) return -1;
		if (da > db) return 1;
	}
	return 0;
}

// ---------- Field extractors (FullGameData → DB rows) ----------

interface GameRowInputs {
	gameId: string;
	userId: string;
	blob: FullGameData;
	fileHash: string;
	blobSize: number;
	uploaderIndex: number | null;
	// Re-import overrides — preserve the existing row's URL-stable fields
	// instead of resetting them from defaults.
	createdAtOverride?: string;
	isPublicOverride?: boolean;
}

function buildGameRow(inp: GameRowInputs): {
	sql: string;
	bindings: unknown[];
} {
	const {
		gameId, userId, blob, fileHash, blobSize, uploaderIndex,
		createdAtOverride, isPublicOverride,
	} = inp;
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

	const isPublic = isPublicOverride === undefined ? 0 : isPublicOverride ? 1 : 0;

	// On re-import, REPLACE the games row (cascades child deletes), preserve
	// created_at and is_public, and bump updated_at to now. On first upload,
	// rely on column defaults for created_at/updated_at and is_public=FALSE.
	if (createdAtOverride !== undefined) {
		return {
			sql: `INSERT OR REPLACE INTO games (
				game_id, user_id, xml_game_id, total_turns, file_hash,
				game_name, save_date, map_size, map_class, game_mode,
				difficulty, opponent_level,
				winner_nation, winner_name, victory_type,
				user_nation, user_won,
				is_public,
				blob_version, blob_size_bytes, parser_version,
				created_at, updated_at
			) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?, ?,?, ?, ?,?,?, ?, datetime('now'))`,
			bindings: [
				gameId, userId, md.xml_game_id, md.total_turns, fileHash,
				md.game_name, md.save_date, md.map_size, md.map_class, md.game_mode,
				md.difficulty, md.opponent_level,
				gd.winner_civilization, gd.winner_name, victoryType,
				userNation, userWon === null ? null : userWon ? 1 : 0,
				isPublic,
				blob.version, blobSize, blob.parser_version,
				createdAtOverride,
			],
		};
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
			isPublic,
			blob.version, blobSize, blob.parser_version,
		],
	};
}

interface SummaryRowInputs {
	gameId: string;
	blob: FullGameData;
	uploaderIndex: number | null;
	winnerIndex: number | null;
}

// Insert one row per roster entry. 24 columns × 1 row = 24 binds per stmt,
// well under D1's 100-param cap. All statements bundle into the same
// db.batch() call as the rest of the upload writes (single transaction).
function buildSummaryStatements(
	db: D1Database,
	inp: SummaryRowInputs,
): D1PreparedStatement[] {
	const { gameId, blob, uploaderIndex, winnerIndex } = inp;
	const roster = blob.player_roster as PlayerRosterEntry[];
	const ctx = buildSummaryGameContext(blob);

	const stmt = db.prepare(
		`INSERT INTO player_summaries (
			game_id, player_index, player_name, nation, family_classes,
			is_human, is_uploader,
			starting_ruler_archetype, starting_ruler_traits,
			starting_ruler_reign_turns, succession_count,
			final_points, final_military_power, final_legitimacy,
			cities_total, cities_founded, techs_completed, laws_count,
			fifth_city_turn, tenth_city_turn, fourth_law_turn, seventh_law_turn,
			is_winner, vp_margin
		) VALUES (?,?,?,?,?, ?,?, ?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?, ?,?)`,
	);

	return roster.map((p) => {
		const s = derivePlayerSummary(blob, p, ctx);
		return stmt.bind(
			gameId,
			p.player_index,
			p.player_name,
			p.nation,
			s.family_classes,
			p.is_human ? 1 : 0,
			uploaderIndex !== null && p.player_index === uploaderIndex ? 1 : 0,
			s.starting_ruler_archetype,
			s.starting_ruler_traits,
			s.starting_ruler_reign_turns,
			s.succession_count,
			s.final_points,
			s.final_military_power,
			s.final_legitimacy,
			s.cities_total,
			s.cities_founded,
			s.techs_completed,
			s.laws_count,
			s.fifth_city_turn,
			s.tenth_city_turn,
			s.fourth_law_turn,
			s.seventh_law_turn,
			winnerIndex !== null && p.player_index === winnerIndex ? 1 : 0,
			s.vp_margin,
		);
	});
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
	const ip = getClientIp(request);

	// Rate limits (per-user, per-IP, global). Counts uploads + re-imports
	// together — re-imports are the same R2/D1 work as a fresh upload.
	if ((await countEventsSince(env.SHARE_DB, UPLOAD_EVENT_TYPES, "user_id", userId)) >= PER_USER_UPLOADS_PER_HOUR) {
		return errorResponse("Per-user upload limit exceeded", 429, cors, "RATE_LIMIT_USER");
	}
	if (ip && (await countEventsSince(env.SHARE_DB, UPLOAD_EVENT_TYPES, "ip_address", ip)) >= PER_IP_UPLOADS_PER_HOUR) {
		return errorResponse("Per-IP upload limit exceeded", 429, cors, "RATE_LIMIT_IP");
	}
	if ((await countEventsSince(env.SHARE_DB, UPLOAD_EVENT_TYPES, null, null)) >= GLOBAL_UPLOADS_PER_HOUR) {
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

	// Dedup check. A `(user_id, file_hash)` collision is one of two cases:
	//   - Same-or-older parser_version → return 409 (don't downgrade, no
	//     point overwriting with identical content).
	//   - Newer parser_version → re-import path: reuse the existing game_id
	//     so URLs stay stable, REPLACE the games row (cascades child rows),
	//     overwrite the R2 blob with the new gzipped JSON. ZIP bytes match
	//     by hash so the ZIP put is idempotent.
	const existing = await env.SHARE_DB.prepare(
		`SELECT game_id, parser_version, created_at, is_public
		 FROM games WHERE user_id = ? AND file_hash = ?`,
	)
		.bind(userId, fileHash)
		.first<{
			game_id: string;
			parser_version: string;
			created_at: string;
			is_public: number;
		}>();

	let isReimport = false;
	let existingCreatedAt: string | undefined;
	let existingIsPublic: boolean | undefined;
	let existingParserVersion: string | undefined;
	let gameId: string;
	if (existing) {
		const cmp = compareSemver(blob.parser_version, existing.parser_version);
		if (cmp <= 0) {
			return jsonResponse(
				{ error: "Duplicate", code: "DUPLICATE", existing_game_id: existing.game_id },
				409,
				cors,
			);
		}
		isReimport = true;
		gameId = existing.game_id;
		existingCreatedAt = existing.created_at;
		existingIsPublic = existing.is_public === 1;
		existingParserVersion = existing.parser_version;
	} else {
		gameId = nanoid(21);
	}

	// R2 keys
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

	// D1 inserts as a single transactional batch. On re-import the games
	// row uses INSERT OR REPLACE — REPLACE fires ON DELETE CASCADE on the
	// child tables (player_summaries, game_player_turn, tech_events,
	// law_events) so the fresh child INSERTs in this batch land into a
	// cleared slate. created_at and is_public are preserved from the
	// existing row.
	const winnerIndex = blob.match_metadata.winner?.winner_player_xml_id ?? null;
	const gameRow = buildGameRow({
		gameId, userId, blob, fileHash, blobSize: dataBlob.size, uploaderIndex,
		createdAtOverride: existingCreatedAt,
		isPublicOverride: existingIsPublic,
	});
	const summaryStmts = buildSummaryStatements(env.SHARE_DB, {
		gameId, blob, uploaderIndex, winnerIndex,
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
			`D1_INSERT_FAILED: ${isReimport ? "preserving" : "cleaning up"} R2 game_id=${gameId}`,
			e,
		);
		// On first-upload failure: D1 has nothing pointing at the R2 blobs
		// we just wrote, so delete them to avoid orphans.
		// On re-import failure: D1 still references the R2 blobs (the
		// REPLACE rolled back), but the blob bytes have already been
		// overwritten with the new payload. Deleting them would delete
		// the user's existing game entirely. Leave R2 alone — the old D1
		// row continues to render the new (fresher) data, with a stale
		// parser_version badge. Acceptable degraded state vs. data loss.
		if (!isReimport) {
			try {
				await Promise.all([
					env.SHARE_BUCKET.delete(blobKey),
					env.SHARE_BUCKET.delete(zipKey),
				]);
			} catch (cleanupErr) {
				console.error(`ORPHANED_BLOB: R2 cleanup failed game_id=${gameId}`, cleanupErr);
			}
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

	// Audit log — distinct event_type for re-imports so admin tooling
	// (cloud/admin.sh events --type reimport) can filter cleanly. Both
	// types count toward upload rate limits (UPLOAD_EVENT_TYPES).
	try {
		await env.SHARE_DB.prepare(
			`INSERT INTO events (event_type, game_id, user_id, ip_address, metadata)
			 VALUES (?, ?, ?, ?, ?)`,
		)
			.bind(
				isReimport ? "reimport" : "upload",
				gameId,
				userId,
				ip,
				JSON.stringify({
					blob_size: dataBlob.size,
					decompressed_size: decompressed.byteLength,
					zip_size: rawZip.byteLength,
					uploader_index: uploaderIndex,
					...(isReimport
						? {
							from_version: existingParserVersion,
							to_version: blob.parser_version,
						}
						: {}),
				}),
			)
			.run();
	} catch (e) {
		console.error("Failed to log upload event:", e);
	}

	if (isReimport) {
		return jsonResponse(
			{
				game_id: gameId,
				url: `/games/${gameId}`,
				reimported: true,
				from_version: existingParserVersion,
				to_version: blob.parser_version,
			},
			200,
			cors,
		);
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

	const row = await env.SHARE_DB.prepare(
		"SELECT user_id, is_public FROM games WHERE game_id = ?",
	)
		.bind(gameId)
		.first<{ user_id: string; is_public: number }>();
	if (!row) return errorResponse("Not found", 404, cors, "NOT_FOUND");

	const isOwner = session?.data.user_id === row.user_id;
	const isPublic = row.is_public === 1;

	if (!isOwner && !isPublic) {
		// Anonymous → 401 so the frontend can redirect to /login.
		// Signed-in non-owner → 403 (the game exists but isn't theirs).
		return session
			? errorResponse("Forbidden", 403, cors, "FORBIDDEN")
			: errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	}

	// Anonymous public reads: rate-limit per IP via the D1 `events` table
	// (global, not per-POP), exempting known link-preview scrapers
	// (Discord/Slack/Twitter/etc.). Untrusted IP (CF-RAY missing) → shared
	// "untrusted" bucket so per-IP enforcement doesn't silently degrade in
	// a misconfigured topology.
	if (!isOwner) {
		const ip = getClientIp(request) ?? "untrusted";
		const ua = request.headers.get("User-Agent");
		if (!isScraperUA(ua)) {
			const count = await countEventsSince(
				env.SHARE_DB, "anon_read", "ip_address", ip,
			);
			if (count >= ANON_READS_PER_HOUR) {
				return errorResponse(
					"Rate limit exceeded. Try again later.",
					429,
					cors,
					"RATE_LIMIT",
				);
			}
			// Audit-log fire-and-forget — same pattern as the download path.
			// A logging hiccup mustn't 500 a public-game view.
			env.SHARE_DB.prepare(
				`INSERT INTO events (event_type, game_id, ip_address)
				 VALUES ('anon_read', ?, ?)`,
			)
				.bind(gameId, ip)
				.run()
				.catch((e: unknown) => {
					console.error("Failed to log anon_read event:", e);
				});
		}
	}

	const obj = await env.SHARE_BUCKET.get(`games/${gameId}.json.gz`);
	if (!obj) {
		return errorResponse("Blob missing", 404, cors, "BLOB_MISSING");
	}

	// Decompress in Worker — Cloudflare strips Content-Encoding from Worker
	// responses, so we can't pass the compressed body through directly.
	const compressed = await obj.arrayBuffer();
	const decompressed = await decompressWithLimit(compressed, MAX_BLOB_DECOMPRESSED);

	// Parse, transform, re-serialize. Owner gets an `is_public` flag
	// injected for the visibility toggle's initial state; anonymous viewers
	// get the blob with online_id stripped (PII protection — see
	// stripOnlineIds). FullGameData is a looseObject schema so the extra
	// is_public top-level field is non-breaking.
	const parsed = JSON.parse(new TextDecoder().decode(decompressed)) as unknown;
	const transformed = isOwner
		? { ...(parsed as Record<string, unknown>), is_public: isPublic }
		: stripOnlineIds(parsed);
	const bodyText = JSON.stringify(transformed);

	// Vary: Cookie keeps the public-cache key correct. Scrapers send no
	// Cookie header → single edge cache key. Cookie-bearing requests bypass
	// the public cache (correctness > hit rate). Origin must also be in
	// Vary so the credentialed-CORS response isn't reused for a different
	// origin — combine both rather than letting `...cors` clobber Cookie.
	return new Response(bodyText, {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			// Owners get no-store so post-mutation reloads (reparse,
			// visibility toggle) always see fresh data. Public viewers
			// cache 1h in the browser (max-age) but only 60s at the edge
			// (s-maxage) — short edge TTL means a Make Private toggle
			// propagates within ~1min instead of hanging on the CDN for
			// an hour.
			"Cache-Control": isOwner
				? "private, no-store"
				: "public, max-age=3600, s-maxage=60",
			...cors,
			Vary: "Cookie, Origin",
		},
	});
}

// CSRF stance for PATCH/DELETE on /v1/games/:id and DELETE on /v1/games/:id:
// session cookies are SameSite=Lax + Secure. PATCH/DELETE are non-simple
// methods, so a cross-site fetch hits a CORS preflight and is blocked by the
// ALLOWED_ORIGINS allowlist; HTML forms can't emit PATCH/DELETE at all. No
// CSRF token is needed under that stance — if we ever loosen CORS or accept
// POST mutations, revisit and add an `X-CSRF-Token` requirement.
//
// PATCH /v1/games/:id — toggle visibility (owner-only). Body shape:
//   { is_public: boolean }
// Returns the updated row subset. Per-user 60/hr rate limit on toggles
// (event_type='visibility_change' in audit log).
export async function handleGamePatch(
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
	// Don't leak existence: 404 covers both "no game" and "not yours".
	if (!row || row.user_id !== userId) {
		return errorResponse("Not found", 404, cors, "NOT_FOUND");
	}

	if ((await countEventsSince(env.SHARE_DB, "visibility_change", "user_id", userId)) >= PER_USER_PATCH_PER_HOUR) {
		return errorResponse(
			"Per-user toggle limit exceeded",
			429,
			cors,
			"RATE_LIMIT_USER",
		);
	}

	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		return errorResponse("Invalid JSON body", 400, cors, "INVALID_JSON");
	}
	const validation = v.safeParse(GamePatchSchema, parsed);
	if (!validation.success) {
		return errorResponse(
			`Invalid body: ${validation.issues[0]?.message ?? "unknown"}`,
			400,
			cors,
			"INVALID_BODY",
		);
	}
	const { is_public } = validation.output;

	await env.SHARE_DB.prepare(
		"UPDATE games SET is_public = ?, updated_at = datetime('now') WHERE game_id = ?",
	)
		.bind(is_public ? 1 : 0, gameId)
		.run();

	const ip = request.headers.get("CF-Connecting-IP");
	try {
		await env.SHARE_DB.prepare(
			`INSERT INTO events (event_type, game_id, user_id, ip_address, metadata)
			 VALUES ('visibility_change', ?, ?, ?, ?)`,
		)
			.bind(gameId, userId, ip, JSON.stringify({ is_public }))
			.run();
	} catch (e) {
		console.error("Failed to log visibility_change event:", e);
	}

	return jsonResponse({ game_id: gameId, is_public }, 200, cors);
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

// GET /v1/games/:id/download — stream the raw save .zip from R2.
//
// Auth model (decided in design discussion, not the original spec):
//   - Auth required (any logged-in user, not just owner).
//   - Game must be is_public = TRUE OR requester is owner.
//   - 404 on signed-in non-owner of a private game (don't leak existence;
//     mirrors the JSON GET path).
//   - 401 on anonymous; the frontend bounces to /login?next=...
//
// Why not anonymous: the JSON GET strips player_roster.online_id for
// anonymous viewers (PII), but the raw ZIP contains the original XML
// with OnlineIDs intact. Letting anonymous download would undo the strip
// via this route. Auth-gating preserves PII without on-the-fly XML
// rewriting and gives us a per-user audit trail.
export async function handleGameDownload(
	gameId: string,
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	const userId = session.data.user_id;

	const row = await env.SHARE_DB.prepare(
		"SELECT user_id, is_public, game_name FROM games WHERE game_id = ?",
	)
		.bind(gameId)
		.first<{ user_id: string; is_public: number; game_name: string | null }>();
	if (!row) return errorResponse("Not found", 404, cors, "NOT_FOUND");

	const isOwner = row.user_id === userId;
	const isPublic = row.is_public === 1;
	if (!isOwner && !isPublic) {
		// Don't leak existence — same shape as a genuine 404.
		return errorResponse("Not found", 404, cors, "NOT_FOUND");
	}

	// Per-user limit (meaningful — auth-bound) + per-IP backstop.
	if (
		(await countEventsSince(env.SHARE_DB, "download", "user_id", userId)) >=
		PER_USER_DOWNLOADS_PER_HOUR
	) {
		return errorResponse(
			"Per-user download limit exceeded",
			429, cors, "RATE_LIMIT_USER",
		);
	}
	const ip = getClientIp(request);
	if (
		ip &&
		(await countEventsSince(env.SHARE_DB, "download", "ip_address", ip)) >=
			PER_IP_DOWNLOADS_PER_HOUR
	) {
		return errorResponse(
			"Per-IP download limit exceeded",
			429, cors, "RATE_LIMIT_IP",
		);
	}

	const obj = await env.SHARE_BUCKET.get(`saves/${gameId}.zip`);
	if (!obj) return errorResponse("Save missing", 404, cors, "BLOB_MISSING");

	const filename = buildSaveFilename(row.game_name, gameId);

	// Audit event — fire-and-forget so a logging hiccup doesn't 500 the
	// download. Caught + logged in case of error.
	env.SHARE_DB.prepare(
		`INSERT INTO events (event_type, game_id, user_id, ip_address, metadata)
		 VALUES ('download', ?, ?, ?, ?)`,
	)
		.bind(gameId, userId, ip, JSON.stringify({ size: obj.size }))
		.run()
		.catch((e: unknown) => {
			console.error("Failed to log download event:", e);
		});

	// Stream R2 body straight through. obj.body is a ReadableStream — no
	// buffering, memory-safe even at the 50MB R2 ceiling.
	// Access-Control-Expose-Headers is set per-response (not in the global
	// CORS helper) so cross-origin JS in the browser can read
	// Content-Disposition to pick the filename.
	return new Response(obj.body, {
		status: 200,
		headers: {
			"Content-Type": "application/zip",
			"Content-Length": String(obj.size),
			"Content-Disposition": buildContentDisposition(filename),
			"Cache-Control": "private, max-age=300",
			...cors,
			Vary: "Cookie, Origin",
			"Access-Control-Expose-Headers": "Content-Disposition",
		},
	});
}
