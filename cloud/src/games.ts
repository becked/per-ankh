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
import { buildAvatarUrl } from "./auth";
import { captureOnlineIds } from "./online-ids";
import { logError, logWarn } from "./log";
import {
	AuthzError,
	isTournamentAdmin,
	requireTournamentBeta,
} from "./tournament/authz";
import { maybeAdvanceAfterMatchReport } from "./tournament/admin";
import {
	buildSummaryGameContext,
	derivePlayerSummary,
} from "./derive-player-summary";

export interface GamesEnv extends SessionEnv {
	SHARE_BUCKET: R2Bucket;
	SHARE_DB: D1Database;
	ALLOWED_ORIGINS: string;
	// Upload-bucket rate limits (apply to uploads + reimports together).
	// Strings because wrangler.toml `[vars]` are always strings at runtime;
	// parsed with parseInt at the call site.
	PER_USER_UPLOADS_PER_HOUR: string;
	PER_IP_UPLOADS_PER_HOUR: string;
	GLOBAL_UPLOADS_PER_HOUR: string;
}

// Size limits (spec §4)
const MAX_BLOB_COMPRESSED = 10 * 1024 * 1024; // 10 MB
const MAX_BLOB_DECOMPRESSED = 50 * 1024 * 1024; // 50 MB
const MAX_ZIP_BYTES = 50 * 1024 * 1024; // 50 MB

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

export function isScraperUA(ua: string | null): boolean {
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
export type RateLimitedEventType =
	| "upload"
	| "reimport"
	| "visibility_change"
	| "download"
	| "anon_read"
	| "tournament_admin"
	| "tournament_view"
	| "tournament_create"
	| "user_search";

// Upload rate limits cover both first-time uploads and re-imports — both
// hit the same R2 puts + D1 batch, so they cost the same.
const UPLOAD_EVENT_TYPES = ["upload", "reimport"] as const;

export async function countEventsSince(
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
	const stmt = db.prepare(
		`SELECT COUNT(*) as count FROM events WHERE ${where}`,
	);
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
	// On first upload, the user's Personal (is_default=1) collection_id
	// resolved by the caller. On re-import, the existing row's collection_id
	// (preserved across the REPLACE so manual moves aren't clobbered).
	collectionId: number | null;
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
		gameId,
		userId,
		blob,
		fileHash,
		blobSize,
		uploaderIndex,
		collectionId,
		createdAtOverride,
		isPublicOverride,
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

	const isPublic =
		isPublicOverride === undefined ? 0 : isPublicOverride ? 1 : 0;

	// On re-import, REPLACE the games row (cascades child deletes), preserve
	// created_at, is_public, and collection_id, and bump updated_at to now.
	// On first upload, rely on column defaults for created_at/updated_at and
	// is_public=FALSE; collection_id is the user's Personal default.
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
				collection_id,
				created_at, updated_at
			) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?, ?,?, ?, ?,?,?, ?, ?, datetime('now'))`,
			bindings: [
				gameId,
				userId,
				md.xml_game_id,
				md.total_turns,
				fileHash,
				md.game_name,
				md.save_date,
				md.map_size,
				md.map_class,
				md.game_mode,
				md.difficulty,
				md.opponent_level,
				gd.winner_civilization,
				gd.winner_name,
				victoryType,
				userNation,
				userWon === null ? null : userWon ? 1 : 0,
				isPublic,
				blob.version,
				blobSize,
				blob.parser_version,
				collectionId,
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
			blob_version, blob_size_bytes, parser_version,
			collection_id
		) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?, ?,?, ?, ?,?,?, ?)`,
		bindings: [
			gameId,
			userId,
			md.xml_game_id,
			md.total_turns,
			fileHash,
			md.game_name,
			md.save_date,
			md.map_size,
			md.map_class,
			md.game_mode,
			md.difficulty,
			md.opponent_level,
			gd.winner_civilization,
			gd.winner_name,
			victoryType,
			userNation,
			userWon === null ? null : userWon ? 1 : 0,
			isPublic,
			blob.version,
			blobSize,
			blob.parser_version,
			collectionId,
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
		data: Array<{
			turn: number;
			rate: number | null;
			cumulative: number | null;
		}>;
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
			if (point.military_power !== null)
				row.military_power = point.military_power;
			if (point.legitimacy !== null) row.legitimacy = point.legitimacy;
		}
	}

	if (rowsByKey.size === 0) return [];

	// Stable column order matches table definition.
	const columns = [
		"game_id",
		"player_index",
		"turn",
		"food_per_turn",
		"food_cumulative",
		"growth_per_turn",
		"growth_cumulative",
		"science_per_turn",
		"science_cumulative",
		"culture_per_turn",
		"culture_cumulative",
		"civics_per_turn",
		"civics_cumulative",
		"training_per_turn",
		"training_cumulative",
		"money_per_turn",
		"money_cumulative",
		"orders_per_turn",
		"orders_cumulative",
		"happiness_per_turn",
		"happiness_cumulative",
		"discontent_per_turn",
		"discontent_cumulative",
		"iron_per_turn",
		"iron_cumulative",
		"stone_per_turn",
		"stone_cumulative",
		"wood_per_turn",
		"wood_cumulative",
		"maintenance_per_turn",
		"maintenance_cumulative",
		"military_power",
		"legitimacy",
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

// D1 returns BOOLEAN columns as integers (0/1) — not JS booleans. Any row
// that's serialized straight back to the client must coerce, otherwise
// callers comparing with `=== true` / `=== false` silently fall through.
// Internal Worker code that compares with `=== 1` is fine and intentional.
function coerceD1Bool(v: unknown): boolean | null {
	if (v === null || v === undefined) return null;
	return v === 1 || v === true;
}

// Normalize a /v1/games row to the wire types declared in
// src/lib/api-cloud.ts `GameListItem`. Boolean columns: `user_won`,
// `is_public`. collection_id passes through (already number | null in D1).
function normalizeGameListRow(
	row: Record<string, unknown>,
): Record<string, unknown> {
	return {
		...row,
		user_won: coerceD1Bool(row.user_won),
		is_public: coerceD1Bool(row.is_public) ?? false,
	};
}

// ---------- Helpers ----------

// Resolved tournament context for an upload — populated from the form's
// tournament_match_id (and the parsed blob's slot mappings + winner). Used
// by linkTournamentMatch to stamp the match as reported. Kept structurally
// in sync with the inline literal in handleGameUpload.
interface TournamentUploadContext {
	match_id: string;
	tournament_id: string;
	tournament_name: string;
	slot_a_id: string;
	slot_b_id: string | null;
	slot_a_user_id: string | null;
	slot_b_user_id: string | null;
	is_participant: boolean;
	slot_a_player_index?: number;
	slot_b_player_index?: number;
	winner_slot_id?: string;
	is_admin_override: boolean;
}

// Tournament-linked uploads: move the game into the user's
// `Tournament: {name}` collection (find-or-create), force is_public=TRUE,
// and stamp the match row with the result. Used by both fresh uploads and
// the dedup-link path (admin uploads a save that's already in their
// library — we still want the match reported).
//
// Each side-effect is wrapped in its own try/catch and logged. The upload
// is never rejected by failures here — the game row was already inserted
// (or already existed, on dedup) by the caller.
async function linkTournamentMatch(
	env: GamesEnv,
	gameId: string,
	userId: string,
	tournamentContext: TournamentUploadContext,
): Promise<void> {
	try {
		let tournamentCollectionId: number | null = null;
		const collectionName = `Tournament: ${tournamentContext.tournament_name}`;
		// INSERT OR IGNORE keyed on (user_id, name) UNIQUE — safe to re-run.
		await env.SHARE_DB.prepare(
			"INSERT OR IGNORE INTO collections (user_id, name, is_default) VALUES (?, ?, 0)",
		)
			.bind(userId, collectionName)
			.run();
		const collRow = await env.SHARE_DB.prepare(
			"SELECT collection_id FROM collections WHERE user_id = ? AND name = ?",
		)
			.bind(userId, collectionName)
			.first<{ collection_id: number }>();
		if (collRow) tournamentCollectionId = collRow.collection_id;
		await env.SHARE_DB.prepare(
			`UPDATE games SET collection_id = ?, is_public = 1, updated_at = datetime('now')
			 WHERE game_id = ?`,
		)
			.bind(tournamentCollectionId, gameId)
			.run();
	} catch (e) {
		logError("tournament_link_failed", e, {
			game_id: gameId,
			match_id: tournamentContext.match_id,
		});
	}

	// Link the upload to the match. First-upload-wins for participants
	// (the UPDATE is guarded by status='pending'); admin observer uploads
	// always override and replace the linked game. The caller's blob-parse
	// block populated slot_a/b_player_index and winner_slot_id.
	try {
		const isOverride = tournamentContext.is_admin_override;
		const matchUpdate = await env.SHARE_DB.prepare(
			`UPDATE tournament_matches
			   SET game_id = ?, winner_slot_id = ?, status = 'complete',
			       slot_a_player_index = ?, slot_b_player_index = ?,
			       reported_by_user_id = ?, reported_at = datetime('now')
			 WHERE match_id = ?
			   AND (? = 1 OR status = 'pending')`,
		)
			.bind(
				gameId,
				tournamentContext.winner_slot_id ?? null,
				tournamentContext.slot_a_player_index ?? null,
				tournamentContext.slot_b_player_index ?? null,
				userId,
				tournamentContext.match_id,
				isOverride ? 1 : 0,
			)
			.run();
		// rowcount=0 + non-override means the match was already reported by
		// someone else. The save still lives in the uploader's library; we
		// just don't change the match link. Fits the first-upload-wins
		// semantic the spec calls for.
		if ((matchUpdate.meta?.changes ?? 0) > 0) {
			await env.SHARE_DB.prepare(
				"UPDATE tournaments SET updated_at = datetime('now') WHERE tournament_id = ?",
			)
				.bind(tournamentContext.tournament_id)
				.run();
			// First report (or admin override) flipped the match to
			// non-pending. Auto-advance handles closing the round +
			// generating the next round / completing the tournament. Helper
			// swallows its own errors so upload success is never gated on it.
			await maybeAdvanceAfterMatchReport(env, tournamentContext.match_id);
		}
	} catch (e) {
		logError("tournament_match_link_failed", e, {
			game_id: gameId,
			match_id: tournamentContext.match_id,
		});
	}
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
	if (
		(await countEventsSince(
			env.SHARE_DB,
			UPLOAD_EVENT_TYPES,
			"user_id",
			userId,
		)) >= parseInt(env.PER_USER_UPLOADS_PER_HOUR)
	) {
		return errorResponse(
			"Per-user upload limit exceeded",
			429,
			cors,
			"RATE_LIMIT_USER",
		);
	}
	if (
		ip &&
		(await countEventsSince(
			env.SHARE_DB,
			UPLOAD_EVENT_TYPES,
			"ip_address",
			ip,
		)) >= parseInt(env.PER_IP_UPLOADS_PER_HOUR)
	) {
		return errorResponse(
			"Per-IP upload limit exceeded",
			429,
			cors,
			"RATE_LIMIT_IP",
		);
	}
	if (
		(await countEventsSince(env.SHARE_DB, UPLOAD_EVENT_TYPES, null, null)) >=
		parseInt(env.GLOBAL_UPLOADS_PER_HOUR)
	) {
		return errorResponse(
			"Global upload limit exceeded",
			429,
			cors,
			"RATE_LIMIT_GLOBAL",
		);
	}

	// Parse multipart
	let form: FormData;
	try {
		form = await request.formData();
	} catch (err) {
		logWarn("multipart_parse_failed", {
			message: err instanceof Error ? err.message : "unknown",
		});
		return errorResponse("Invalid multipart body", 400, cors, "INVALID_FORM");
	}

	// FormData entries are typed as FormDataEntryValue (string | File | null).
	// In the Workers runtime File extends Blob; we duck-type since Blob is
	// the structural ancestor and `instanceof Blob` doesn't work in the
	// workers-types DOM lib subset.
	const dataPart = form.get("data");
	const savePart = form.get("save");
	const indexRaw = form.get("uploader_player_index");
	// Optional: link this upload to a tournament match. When provided, we
	// validate participation up-front (and admin override), then after the
	// main D1 batch succeeds we move the game into the user's
	// `Tournament: {name}` collection and force is_public=TRUE. The match's
	// game_id link itself is set later via the report endpoint, keeping
	// save-upload and result-reporting independent.
	const tournamentMatchIdRaw = form.get("tournament_match_id");
	// Observer-mode mapping fields. Required when an admin uploads to a match
	// they're not a participant in (uploader_player_index = null). Ignored
	// for participant uploads (mappings derived from uploader_player_index
	// + elimination). See handleGameUpload tournament block below.
	const tournamentSlotARaw = form.get("tournament_slot_a_player_index");
	const tournamentSlotBRaw = form.get("tournament_slot_b_player_index");
	const isBlobLike = (v: unknown): v is Blob =>
		!!v &&
		typeof v === "object" &&
		typeof (v as { arrayBuffer?: unknown }).arrayBuffer === "function";

	if (!isBlobLike(dataPart)) {
		return errorResponse("Missing 'data' part", 400, cors, "MISSING_DATA");
	}
	if (!isBlobLike(savePart)) {
		return errorResponse("Missing 'save' part", 400, cors, "MISSING_SAVE");
	}
	if (typeof indexRaw !== "string") {
		return errorResponse(
			"Missing 'uploader_player_index' field",
			400,
			cors,
			"MISSING_INDEX",
		);
	}
	let tournamentMatchId: string | null = null;
	if (tournamentMatchIdRaw !== null) {
		if (
			typeof tournamentMatchIdRaw !== "string" ||
			!/^[A-Za-z0-9_-]{21}$/.test(tournamentMatchIdRaw)
		) {
			return errorResponse(
				"Invalid tournament_match_id",
				400,
				cors,
				"INVALID_TOURNAMENT_MATCH_ID",
			);
		}
		tournamentMatchId = tournamentMatchIdRaw;
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

	// Tournament-link validation. We resolve match → tournament here so we
	// can fail fast (before decompression and parser work), and so we have
	// the tournament_name handy for the post-insert collection assignment.
	// Caller must be slot_a/slot_b's user_id OR a tournament_admins row.
	let tournamentContext: {
		match_id: string;
		tournament_id: string;
		tournament_name: string;
		slot_a_id: string;
		slot_b_id: string | null;
		slot_a_user_id: string | null;
		slot_b_user_id: string | null;
		// True when the caller's user_id matches either slot's user_id.
		// Drives participant-mode mapping derivation. False when caller is
		// an admin uploading on behalf of others (observer mode) — then the
		// slot_*_player_index form fields are required.
		is_participant: boolean;
		// Derived after the blob is parsed, before D1 write. Populated by
		// the slot-mapping + winner-derivation block further down.
		slot_a_player_index?: number;
		slot_b_player_index?: number;
		winner_slot_id?: string;
		// Admin observer uploads override an already-reported match. The
		// flag is set so the match UPDATE doesn't filter on status='pending'.
		is_admin_override: boolean;
	} | null = null;
	if (tournamentMatchId !== null) {
		// Beta gate before the match lookup — a non-beta user with a
		// guessed match ID gets the same 404 they'd get on the tournament
		// list, not a "match not found" that hints the feature exists.
		try {
			await requireTournamentBeta(env, session.data);
		} catch (e) {
			if (e instanceof AuthzError) {
				return errorResponse(e.message, e.status, cors, e.code);
			}
			throw e;
		}
		const match = await env.SHARE_DB.prepare(
			`SELECT m.slot_a_id, m.slot_b_id, r.tournament_id, t.name AS tournament_name,
			        t.status AS tournament_status,
			        sa.user_id AS slot_a_user, sb.user_id AS slot_b_user
			 FROM tournament_matches m
			 JOIN tournament_rounds r ON r.round_id = m.round_id
			 JOIN tournaments t ON t.tournament_id = r.tournament_id
			 JOIN tournament_slots sa ON sa.slot_id = m.slot_a_id
			 LEFT JOIN tournament_slots sb ON sb.slot_id = m.slot_b_id
			 WHERE m.match_id = ?`,
		)
			.bind(tournamentMatchId)
			.first<{
				slot_a_id: string;
				slot_b_id: string | null;
				tournament_id: string;
				tournament_name: string;
				tournament_status: string;
				slot_a_user: string | null;
				slot_b_user: string | null;
			}>();
		if (!match) {
			return errorResponse(
				"Tournament match not found",
				404,
				cors,
				"MATCH_NOT_FOUND",
			);
		}
		if (match.tournament_status === "complete") {
			return errorResponse(
				"Tournament is complete",
				409,
				cors,
				"TOURNAMENT_COMPLETE",
			);
		}
		const isParticipant =
			userId === match.slot_a_user || userId === match.slot_b_user;
		if (!isParticipant) {
			const isAdmin = await isTournamentAdmin(
				env,
				session.data,
				match.tournament_id,
			);
			if (!isAdmin) {
				return errorResponse(
					"Not a participant or admin for this match",
					403,
					cors,
					"NOT_MATCH_PARTICIPANT",
				);
			}
		}
		tournamentContext = {
			match_id: tournamentMatchId,
			tournament_id: match.tournament_id,
			tournament_name: match.tournament_name,
			slot_a_id: match.slot_a_id,
			slot_b_id: match.slot_b_id,
			slot_a_user_id: match.slot_a_user,
			slot_b_user_id: match.slot_b_user,
			is_participant: isParticipant,
			is_admin_override: !isParticipant,
		};
	}

	// Decompress + parse blob
	const compressedData = await dataBlob.arrayBuffer();
	let decompressed: Uint8Array;
	try {
		decompressed = await decompressWithLimit(
			compressedData,
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
	const blob = validation.output;

	// Spec §4 gate: only completed games are uploadable. `<GameOver/>` is
	// the universal completion signal across all save formats. A null
	// `winner` is acceptable — very old saves (≤ ~1.0.60668) record
	// completion via GameOver but no winner element exists in the XML.
	// The frontend's `validateCompletedGame` already enforces this; the
	// duplicate check here is defense-in-depth against a hand-crafted blob.
	if (blob.match_metadata.game_over !== true) {
		return errorResponse(
			"Save is not a completed game — only completed games can be uploaded.",
			400,
			cors,
			"NOT_COMPLETED",
		);
	}

	// Parse + validate uploader index. JSON-encoded so we can carry the
	// `null` sentinel for observer mode (form fields are strings).
	let indexParsed: unknown;
	try {
		indexParsed = JSON.parse(indexRaw);
	} catch {
		return errorResponse(
			"uploader_player_index is not valid JSON",
			400,
			cors,
			"INVALID_INDEX_JSON",
		);
	}
	const indexValidation = v.safeParse(UploaderPlayerIndexSchema, indexParsed);
	if (!indexValidation.success) {
		return errorResponse(
			`uploader_player_index: ${indexValidation.issues[0]?.message ?? "invalid"}`,
			400,
			cors,
			"INVALID_INDEX",
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
			400,
			cors,
			"UNKNOWN_PLAYER_INDEX",
		);
	}

	// Tournament slot↔player mapping + winner derivation. Done now that the
	// blob's player_roster is validated. Two modes:
	//   * Participant: caller is slot_a/slot_b's user. Mapping derived from
	//     uploader_player_index (caller's slot) + the other human in the
	//     roster by elimination.
	//   * Observer: caller is a tournament admin uploading on someone else's
	//     behalf. Both slot_*_player_index form fields required; uploader
	//     must NOT claim a slot via uploader_player_index.
	// In both modes we then check match_metadata.winner against the
	// mapping to derive winner_slot_id.
	if (tournamentContext) {
		const humans = roster.filter((p) => p.is_human);
		if (humans.length !== 2) {
			return errorResponse(
				`Tournament matches require exactly 2 humans; got ${humans.length}`,
				409,
				cors,
				"WRONG_HUMAN_COUNT",
			);
		}

		let slotAIdx: number;
		let slotBIdx: number;

		if (tournamentContext.is_participant) {
			if (uploaderIndex === null) {
				return errorResponse(
					"Participants must select their player in the upload picker",
					400,
					cors,
					"MISSING_PARTICIPANT_INDEX",
				);
			}
			const callerIsSlotA = userId === tournamentContext.slot_a_user_id;
			const otherHuman = humans.find((p) => p.player_index !== uploaderIndex);
			if (!otherHuman) {
				return errorResponse(
					"Could not identify the other human in the save",
					409,
					cors,
					"OTHER_PLAYER_MISSING",
				);
			}
			if (callerIsSlotA) {
				slotAIdx = uploaderIndex;
				slotBIdx = otherHuman.player_index;
			} else {
				slotAIdx = otherHuman.player_index;
				slotBIdx = uploaderIndex;
			}
		} else {
			// Observer mode (admin uploading)
			if (uploaderIndex !== null) {
				return errorResponse(
					"Observer uploads must have uploader_player_index = null",
					400,
					cors,
					"INVALID_OBSERVER_UPLOAD",
				);
			}
			if (
				typeof tournamentSlotARaw !== "string" ||
				typeof tournamentSlotBRaw !== "string"
			) {
				return errorResponse(
					"Observer uploads require tournament_slot_a_player_index and tournament_slot_b_player_index form fields",
					400,
					cors,
					"MISSING_SLOT_MAPPING",
				);
			}
			const parsedA = parseInt(tournamentSlotARaw, 10);
			const parsedB = parseInt(tournamentSlotBRaw, 10);
			if (
				!Number.isInteger(parsedA) ||
				!Number.isInteger(parsedB) ||
				parsedA < 0 ||
				parsedB < 0 ||
				parsedA === parsedB
			) {
				return errorResponse(
					"Invalid slot mapping (both must be distinct non-negative integers)",
					400,
					cors,
					"INVALID_SLOT_MAPPING",
				);
			}
			if (!humansByIndex.has(parsedA) || !humansByIndex.has(parsedB)) {
				return errorResponse(
					"Slot mappings must reference humans in the save's player roster",
					400,
					cors,
					"INVALID_SLOT_MAPPING",
				);
			}
			slotAIdx = parsedA;
			slotBIdx = parsedB;
		}

		// Derive winner_slot_id by matching the save's winner_player_xml_id
		// to the slot mappings. Uses the same field the regular game-detail
		// path uses to set player_summaries.is_winner.
		const winnerXmlId =
			blob.match_metadata?.winner?.winner_player_xml_id ?? null;
		if (winnerXmlId === null) {
			return errorResponse(
				"Save has no recorded winner; cannot report this match",
				409,
				cors,
				"NO_WINNER",
			);
		}
		let winnerSlotId: string | null = null;
		if (winnerXmlId === slotAIdx) winnerSlotId = tournamentContext.slot_a_id;
		else if (winnerXmlId === slotBIdx)
			winnerSlotId = tournamentContext.slot_b_id;
		if (winnerSlotId === null) {
			return errorResponse(
				`Winner (player_index ${winnerXmlId}) does not correspond to either slot — check the slot mapping`,
				409,
				cors,
				"WINNER_NOT_IN_MATCH",
			);
		}
		tournamentContext.slot_a_player_index = slotAIdx;
		tournamentContext.slot_b_player_index = slotBIdx;
		tournamentContext.winner_slot_id = winnerSlotId;
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
		`SELECT game_id, parser_version, created_at, is_public, collection_id
		 FROM games WHERE user_id = ? AND file_hash = ?`,
	)
		.bind(userId, fileHash)
		.first<{
			game_id: string;
			parser_version: string;
			created_at: string;
			is_public: number;
			collection_id: number | null;
		}>();

	let isReimport = false;
	let existingCreatedAt: string | undefined;
	let existingIsPublic: boolean | undefined;
	let existingParserVersion: string | undefined;
	let collectionId: number | null;
	let gameId: string;
	if (existing) {
		const cmp = compareSemver(blob.parser_version, existing.parser_version);
		if (cmp <= 0) {
			// Dedup hit on the bytes. If this upload was also reporting a
			// tournament match, run the match-link side-effects against the
			// existing game_id and return success — the match-report is the
			// action the admin actually intended, even though the storage
			// side is a no-op. Without this branch the upload would 409 and
			// the match would stay pending despite the save being on file.
			if (tournamentContext) {
				await linkTournamentMatch(
					env,
					existing.game_id,
					userId,
					tournamentContext,
				);
				try {
					await env.SHARE_DB.prepare(
						`INSERT INTO events (event_type, game_id, user_id, ip_address, metadata)
						 VALUES (?, ?, ?, ?, ?)`,
					)
						.bind(
							"upload",
							existing.game_id,
							userId,
							ip,
							JSON.stringify({
								tournament_match_relinked: true,
								match_id: tournamentContext.match_id,
							}),
						)
						.run();
				} catch (e) {
					logError("audit_event_log_failed", e, {
						event_type: "upload",
						game_id: existing.game_id,
					});
				}
				return jsonResponse(
					{
						game_id: existing.game_id,
						url: `/games/${existing.game_id}`,
						tournament_match_reported: true,
					},
					200,
					cors,
				);
			}
			return jsonResponse(
				{
					error: "Duplicate",
					code: "DUPLICATE",
					existing_game_id: existing.game_id,
				},
				409,
				cors,
			);
		}
		isReimport = true;
		gameId = existing.game_id;
		existingCreatedAt = existing.created_at;
		existingIsPublic = existing.is_public === 1;
		existingParserVersion = existing.parser_version;
		// Preserve the user's manual collection placement across re-imports.
		// Without this the INSERT OR REPLACE would null collection_id.
		collectionId = existing.collection_id;
	} else {
		gameId = nanoid(21);
		// First upload: land in the user's Personal (is_default=1) collection.
		// Seeded in handleDiscordCallback so this lookup always returns a row
		// for an authenticated user.
		const def = await env.SHARE_DB.prepare(
			"SELECT collection_id FROM collections WHERE user_id = ? AND is_default = 1",
		)
			.bind(userId)
			.first<{ collection_id: number }>();
		collectionId = def?.collection_id ?? null;
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
				customMetadata: {
					user_id: userId,
					created_at: new Date().toISOString(),
				},
			}),
			env.SHARE_BUCKET.put(zipKey, rawZip, {
				httpMetadata: { contentType: "application/zip" },
				customMetadata: {
					user_id: userId,
					created_at: new Date().toISOString(),
				},
			}),
		]);
	} catch (e) {
		logError("r2_put_failed", e, { game_id: gameId });
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
		gameId,
		userId,
		blob,
		fileHash,
		blobSize: dataBlob.size,
		uploaderIndex,
		collectionId,
		createdAtOverride: existingCreatedAt,
		isPublicOverride: existingIsPublic,
	});
	const summaryStmts = buildSummaryStatements(env.SHARE_DB, {
		gameId,
		blob,
		uploaderIndex,
		winnerIndex,
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
		logError("d1_insert_failed", e, {
			game_id: gameId,
			is_reimport: isReimport,
		});
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
				logError("orphaned_blob", cleanupErr, { game_id: gameId });
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
				logError("capture_online_ids_failed", e, { game_id: gameId });
			}
		}
	}

	// Tournament-linked uploads: move into the user's `Tournament: {name}`
	// collection, force is_public=TRUE, and stamp the match as reported.
	// Failures inside the helper are logged but never reject the upload.
	if (tournamentContext) {
		await linkTournamentMatch(env, gameId, userId, tournamentContext);
	}

	// Audit log — distinct event_type for re-imports so admin tooling
	// (./per-ankh admin events --type reimport) can filter cleanly. Both
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
		logError("audit_event_log_failed", e, {
			event_type: isReimport ? "reimport" : "upload",
			game_id: gameId,
		});
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
	return jsonResponse({ game_id: gameId, url: `/games/${gameId}` }, 201, cors);
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
	const limit = Math.min(
		parseInt(url.searchParams.get("limit") ?? "50", 10) || 50,
		200,
	);
	const offset = Math.max(
		parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
		0,
	);

	// Optional filters. ?filter=public takes precedence over ?collection_id
	// when both are passed; the dashboard sidebar only ever sends one at a
	// time, so resolution order is mostly defensive.
	const filter = url.searchParams.get("filter");
	const collectionIdParam = url.searchParams.get("collection_id");
	const collectionId =
		collectionIdParam !== null && /^\d+$/.test(collectionIdParam)
			? parseInt(collectionIdParam, 10)
			: null;

	let where = "user_id = ?";
	const bindings: (string | number)[] = [userId];
	if (filter === "public") {
		where += " AND is_public = 1";
	} else if (collectionId !== null) {
		where += " AND collection_id = ?";
		bindings.push(collectionId);
	}

	// Sort by save_date (in-game date) so the sidebar's month-grouped
	// rendering produces contiguous month buckets. Without this the desktop
	// CloudGameSidebar groups break when games are uploaded out of save-date
	// order. created_at is the tiebreak for games sharing a save_date.
	const rows = await env.SHARE_DB.prepare(
		`SELECT game_id, game_name, save_date, total_turns,
		        user_nation, user_won, winner_nation, victory_type,
		        map_size, is_public, collection_id, created_at, parser_version
		 FROM games WHERE ${where}
		 ORDER BY save_date DESC NULLS LAST, created_at DESC
		 LIMIT ? OFFSET ?`,
	)
		.bind(...bindings, limit, offset)
		.all();
	const total = await env.SHARE_DB.prepare(
		`SELECT COUNT(*) AS count FROM games WHERE ${where}`,
	)
		.bind(...bindings)
		.first<{ count: number }>();

	const games = (rows.results ?? []).map((r) =>
		normalizeGameListRow(r as Record<string, unknown>),
	);
	return jsonResponse({ games, total: total?.count ?? 0 }, 200, cors);
}

// GET /v1/games/public-recent — anonymous, IP-rate-limited list of the most
// recent is_public=1 games across all users. Used to populate the marketing
// home page (src/routes/+page.svelte) with a discovery feed. Each row carries
// the human player roster + their per-turn legitimacy series so the home
// cards can render an in-place VP sparkline without N follow-up fetches.
//
// PII stance mirrors anonymous /v1/games/:id: only display_name (already
// public on /games/[id] pages) and player_name (the in-game character) are
// returned. No online_ids, no email.
export async function handlePublicRecentGames(
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	// Rate limit: share the anon_read bucket — same logical category as the
	// public game-detail read. Scrapers are exempted by UA. Untrusted IP
	// (CF-RAY missing) falls into a shared "untrusted" bucket so a
	// misconfigured topology can't silently disable enforcement.
	const ip = getClientIp(request) ?? "untrusted";
	const ua = request.headers.get("User-Agent");
	if (!isScraperUA(ua)) {
		const count = await countEventsSince(
			env.SHARE_DB,
			"anon_read",
			"ip_address",
			ip,
		);
		if (count >= ANON_READS_PER_HOUR) {
			return errorResponse(
				"Rate limit exceeded. Try again later.",
				429,
				cors,
				"RATE_LIMIT",
			);
		}
		// Fire-and-forget — a logging hiccup mustn't 500 a public list.
		env.SHARE_DB.prepare(
			`INSERT INTO events (event_type, ip_address) VALUES ('anon_read', ?)`,
		)
			.bind(ip)
			.run()
			.catch(() => {});
	}

	const PUBLIC_RECENT_LIMIT = 20;

	// Latest public games + uploader display name.
	const gameRows = await env.SHARE_DB.prepare(
		`SELECT g.game_id, g.game_name, g.user_nation, g.user_won,
		        g.winner_nation, g.winner_name, g.victory_type,
		        g.map_size, g.map_class, g.total_turns,
		        g.save_date, g.created_at,
		        u.display_name AS uploader_display_name,
		        u.discord_id AS uploader_discord_id,
		        u.avatar_hash AS uploader_avatar_hash
		 FROM games g
		 JOIN users u ON g.user_id = u.user_id
		 WHERE g.is_public = 1
		 ORDER BY g.created_at DESC
		 LIMIT ?`,
	)
		.bind(PUBLIC_RECENT_LIMIT)
		.all<{
			game_id: string;
			game_name: string | null;
			user_nation: string | null;
			user_won: number | null;
			winner_nation: string | null;
			winner_name: string | null;
			victory_type: string | null;
			map_size: string | null;
			map_class: string | null;
			total_turns: number;
			save_date: string | null;
			created_at: string;
			uploader_display_name: string;
			uploader_discord_id: string;
			uploader_avatar_hash: string | null;
		}>();

	const games = gameRows.results ?? [];
	if (games.length === 0) {
		return jsonResponse({ games: [] }, 200, cors);
	}

	const gameIds = games.map((g) => g.game_id);
	const placeholders = gameIds.map(() => "?").join(", ");

	// Human player summaries for every game in the list. AI players are
	// excluded server-side — the sparkline only renders humans.
	//
	// cities_total / techs_completed / laws_count + is_winner power the
	// home's Nations-card-style featured-player block, mirroring the
	// Overview tab's per-player card.
	const playerRows = await env.SHARE_DB.prepare(
		`SELECT game_id, player_index, player_name, nation, is_uploader,
		        is_winner, final_points, cities_total, techs_completed, laws_count
		 FROM player_summaries
		 WHERE game_id IN (${placeholders}) AND is_human = 1
		 ORDER BY game_id, player_index`,
	)
		.bind(...gameIds)
		.all<{
			game_id: string;
			player_index: number;
			player_name: string;
			nation: string | null;
			is_uploader: number;
			is_winner: number;
			final_points: number | null;
			cities_total: number | null;
			techs_completed: number | null;
			laws_count: number | null;
		}>();

	// Per-turn legitimacy (in-app "VP") for human players only. Joining
	// against player_summaries keeps the AI rows out of the result set so
	// the payload stays small.
	const seriesRows = await env.SHARE_DB.prepare(
		`SELECT gpt.game_id, gpt.player_index, gpt.turn, gpt.legitimacy
		 FROM game_player_turn gpt
		 JOIN player_summaries ps
		   ON gpt.game_id = ps.game_id AND gpt.player_index = ps.player_index
		 WHERE gpt.game_id IN (${placeholders}) AND ps.is_human = 1
		 ORDER BY gpt.game_id, gpt.player_index, gpt.turn`,
	)
		.bind(...gameIds)
		.all<{
			game_id: string;
			player_index: number;
			turn: number;
			legitimacy: number | null;
		}>();

	// Index series rows by (game_id, player_index) so the assembly loop
	// stays O(N) instead of N² scans.
	const seriesByPlayer = new Map<
		string,
		Array<{ turn: number; vp: number | null }>
	>();
	for (const r of seriesRows.results ?? []) {
		const key = `${r.game_id}:${r.player_index}`;
		let arr = seriesByPlayer.get(key);
		if (!arr) {
			arr = [];
			seriesByPlayer.set(key, arr);
		}
		arr.push({ turn: r.turn, vp: r.legitimacy });
	}

	const playersByGame = new Map<
		string,
		Array<{
			player_index: number;
			player_name: string;
			nation: string | null;
			is_uploader: boolean;
			is_winner: boolean;
			final_points: number | null;
			cities_total: number | null;
			techs_completed: number | null;
			laws_count: number | null;
			vp_series: Array<{ turn: number; vp: number | null }>;
		}>
	>();
	for (const r of playerRows.results ?? []) {
		let arr = playersByGame.get(r.game_id);
		if (!arr) {
			arr = [];
			playersByGame.set(r.game_id, arr);
		}
		arr.push({
			player_index: r.player_index,
			player_name: r.player_name,
			nation: r.nation,
			is_uploader: r.is_uploader === 1,
			is_winner: r.is_winner === 1,
			final_points: r.final_points,
			cities_total: r.cities_total,
			techs_completed: r.techs_completed,
			laws_count: r.laws_count,
			vp_series: seriesByPlayer.get(`${r.game_id}:${r.player_index}`) ?? [],
		});
	}

	const responseGames = games.map((g) => ({
		game_id: g.game_id,
		game_name: g.game_name,
		user_nation: g.user_nation,
		user_won: coerceD1Bool(g.user_won),
		winner_nation: g.winner_nation,
		winner_name: g.winner_name,
		victory_type: g.victory_type,
		map_size: g.map_size,
		map_class: g.map_class,
		total_turns: g.total_turns,
		save_date: g.save_date,
		created_at: g.created_at,
		uploader_display_name: g.uploader_display_name,
		uploader_avatar_url: buildAvatarUrl(
			g.uploader_discord_id,
			g.uploader_avatar_hash,
		),
		players: playersByGame.get(g.game_id) ?? [],
	}));

	// Public cache: 60s edge, 5min browser. Short TTL keeps newly uploaded
	// public games surfacing on the home page within a minute.
	return new Response(JSON.stringify({ games: responseGames }), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=300, s-maxage=60",
			...cors,
			Vary: "Origin",
		},
	});
}

export async function handleGameDetail(
	gameId: string,
	request: Request,
	env: GamesEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);

	const row = await env.SHARE_DB.prepare(
		`SELECT g.user_id, g.is_public, g.user_nation, g.user_won,
		        u.display_name AS user_display_name
		 FROM games g
		 JOIN users u ON g.user_id = u.user_id
		 WHERE g.game_id = ?`,
	)
		.bind(gameId)
		.first<{
			user_id: string;
			is_public: number;
			user_nation: string | null;
			user_won: number | null;
			user_display_name: string;
		}>();
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
				env.SHARE_DB,
				"anon_read",
				"ip_address",
				ip,
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
					logError("audit_event_log_failed", e, {
						event_type: "anon_read",
						game_id: gameId,
					});
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
	const decompressed = await decompressWithLimit(
		compressed,
		MAX_BLOB_DECOMPRESSED,
	);

	// Parse, transform, re-serialize. Owner gets an `is_public` flag
	// injected for the visibility toggle's initial state; anonymous viewers
	// get the blob with online_id stripped (PII protection — see
	// stripOnlineIds). Everyone gets the uploader's identity triple
	// (user_nation, user_won, user_display_name) so the detail view can
	// surface "becked won as Tamil" even when the save's winner_name is
	// the empty string (Old World writes "" for solo games where the
	// player didn't customize their leader name). display_name is the same
	// public identity already returned by /v1/games/public-recent — no
	// new PII. FullGameData is a looseObject schema so the extra top-level
	// fields are non-breaking.
	const parsed = JSON.parse(new TextDecoder().decode(decompressed)) as unknown;
	const baseBlob = isOwner
		? { ...(parsed as Record<string, unknown>), is_public: isPublic }
		: (stripOnlineIds(parsed) as Record<string, unknown>);
	const transformed = {
		...baseBlob,
		user_nation: row.user_nation,
		user_won: coerceD1Bool(row.user_won),
		user_display_name: row.user_display_name,
	};
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
// PATCH /v1/games/:id — owner-only mutation of two optional fields:
//   { is_public?: boolean, collection_id?: number | null }
// At least one must be present. is_public toggles share visibility and is
// rate-limited 60/hr/user via the 'visibility_change' audit event.
// collection_id moves the game between collections owned by the same user;
// not rate-limited (routine UX), audited as 'collection_change'.
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
	const { is_public, collection_id } = validation.output;

	// Rate-limit only when is_public is being changed. A pure collection
	// move shouldn't burn the user's hourly toggle budget.
	if (is_public !== undefined) {
		if (
			(await countEventsSince(
				env.SHARE_DB,
				"visibility_change",
				"user_id",
				userId,
			)) >= PER_USER_PATCH_PER_HOUR
		) {
			return errorResponse(
				"Per-user toggle limit exceeded",
				429,
				cors,
				"RATE_LIMIT_USER",
			);
		}
	}

	// Tournament lockout: a game linked to a match in an active tournament
	// stays public so anonymous viewers can see the linked save on the
	// tournament page. The owner can still flip it private once the
	// tournament reaches 'complete' status.
	if (is_public === false) {
		const link = await env.SHARE_DB.prepare(
			`SELECT 1 FROM tournament_matches m
			 JOIN tournament_rounds r ON r.round_id = m.round_id
			 JOIN tournaments t ON t.tournament_id = r.tournament_id
			 WHERE m.game_id = ? AND t.status != 'complete'
			 LIMIT 1`,
		)
			.bind(gameId)
			.first();
		if (link) {
			return errorResponse(
				"Game is linked to an active tournament match",
				409,
				cors,
				"LINKED_TO_ACTIVE_TOURNAMENT",
			);
		}
	}

	// Ownership check on collection_id: prevent moving a game into another
	// user's collection. 404 (not 403) so we don't reveal which IDs exist.
	if (collection_id !== undefined && collection_id !== null) {
		const owns = await env.SHARE_DB.prepare(
			"SELECT 1 FROM collections WHERE collection_id = ? AND user_id = ?",
		)
			.bind(collection_id, userId)
			.first<{ 1: number }>();
		if (!owns) {
			return errorResponse("Not found", 404, cors, "NOT_FOUND");
		}
	}

	const ip = request.headers.get("CF-Connecting-IP");

	if (is_public !== undefined) {
		await env.SHARE_DB.prepare(
			"UPDATE games SET is_public = ?, updated_at = datetime('now') WHERE game_id = ?",
		)
			.bind(is_public ? 1 : 0, gameId)
			.run();
		try {
			await env.SHARE_DB.prepare(
				`INSERT INTO events (event_type, game_id, user_id, ip_address, metadata)
				 VALUES ('visibility_change', ?, ?, ?, ?)`,
			)
				.bind(gameId, userId, ip, JSON.stringify({ is_public }))
				.run();
		} catch (e) {
			logError("audit_event_log_failed", e, {
				event_type: "visibility_change",
				game_id: gameId,
			});
		}
	}

	if (collection_id !== undefined) {
		await env.SHARE_DB.prepare(
			"UPDATE games SET collection_id = ?, updated_at = datetime('now') WHERE game_id = ?",
		)
			.bind(collection_id, gameId)
			.run();
		try {
			await env.SHARE_DB.prepare(
				`INSERT INTO events (event_type, game_id, user_id, ip_address, metadata)
				 VALUES ('collection_change', ?, ?, ?, ?)`,
			)
				.bind(gameId, userId, ip, JSON.stringify({ collection_id }))
				.run();
		} catch (e) {
			logError("audit_event_log_failed", e, {
				event_type: "collection_change",
				game_id: gameId,
			});
		}
	}

	return jsonResponse(
		{
			game_id: gameId,
			...(is_public !== undefined ? { is_public } : {}),
			...(collection_id !== undefined ? { collection_id } : {}),
		},
		200,
		cors,
	);
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

	// Tournament lockout: same shape as handleGamePatch. Refuse to delete a
	// save that's linked to an active tournament match — without this guard,
	// the R2 deletes below succeed but the D1 DELETE aborts on the
	// tournament_matches.game_id FK, leaving the games row with no R2 backing.
	// Once the tournament reaches 'complete', the trigger in migration 0013
	// nulls the match's game_id so the DELETE proceeds cleanly.
	const link = await env.SHARE_DB.prepare(
		`SELECT 1 FROM tournament_matches m
		 JOIN tournament_rounds r ON r.round_id = m.round_id
		 JOIN tournaments t ON t.tournament_id = r.tournament_id
		 WHERE m.game_id = ? AND t.status != 'complete'
		 LIMIT 1`,
	)
		.bind(gameId)
		.first();
	if (link) {
		return errorResponse(
			"Game is linked to an active tournament match",
			409,
			cors,
			"LINKED_TO_ACTIVE_TOURNAMENT",
		);
	}

	// R2 cleanup first (hardest to undo); D1 cascade handles dependents.
	try {
		await Promise.all([
			env.SHARE_BUCKET.delete(`games/${gameId}.json.gz`),
			env.SHARE_BUCKET.delete(`saves/${gameId}.zip`),
		]);
	} catch (e) {
		logError("r2_delete_failed", e, { game_id: gameId });
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
		logError("audit_event_log_failed", e, {
			event_type: "delete",
			game_id: gameId,
		});
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
			429,
			cors,
			"RATE_LIMIT_USER",
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
			429,
			cors,
			"RATE_LIMIT_IP",
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
			logError("audit_event_log_failed", e, {
				event_type: "download",
				game_id: gameId,
			});
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
