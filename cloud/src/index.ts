// Per-Ankh Worker — legacy share endpoints + cloud rewrite endpoints.
//
// Legacy (desktop, being decommissioned):
//   POST   /v1/share       — Upload a shared game blob
//   GET    /v1/share/{id}  — Download a shared game blob
//   DELETE /v1/share/{id}  — Delete a shared game blob
//
// Cloud rewrite (browser-first):
//   POST   /v1/auth/discord/start
//   POST   /v1/auth/discord/callback
//   GET    /v1/auth/me
//   POST   /v1/auth/logout
//
// Storage: R2 for blobs, D1 for indices/users, KV for sessions+OAuth state.

import { nanoid } from "nanoid";
import { validateSharePayload, extractMetadata } from "./validation";
import {
	cloudCorsHeaders,
	decompressWithLimit,
	getClientIp,
	legacyCorsHeaders,
	timingSafeEqual,
} from "./util";
import {
	emitAccessLog,
	getRequestId,
	logError,
	logWarn,
	runWithLogContext,
	setRoute,
} from "./log";
import {
	handleDiscordCallback,
	handleDiscordStart,
	handleLogout,
	handleMe,
} from "./auth";
import type { AuthEnv } from "./auth";
import {
	handleGameDelete,
	handleGameDetail,
	handleGameDownload,
	handleGameList,
	handleGamePatch,
	handleGameUpload,
} from "./games";
import type { GamesEnv } from "./games";
import { handleCollectionCreate, handleCollectionsList } from "./collections";
import type { CollectionsEnv } from "./collections";
import { handleListOnlineIds, handleRemoveOnlineId } from "./online-ids";
import type { OnlineIdsEnv } from "./online-ids";
import { handleStats } from "./stats";
import type { StatsEnv } from "./stats";
import { handleCspReport } from "./csp";
import {
	handleGameTournamentLink,
	handleTournamentBracket,
	handleTournamentDetail,
	handleTournamentList,
	handleTournamentMatchDetail,
	handleTournamentMatches,
	handleTournamentRounds,
	handleTournamentStandings,
} from "./tournament/public";
import type { TournamentPublicEnv } from "./tournament/public";
import {
	handleDismissBanner,
	handleMyMatches,
	handleMyTournaments,
} from "./tournament/player";
import type { TournamentPlayerEnv } from "./tournament/player";
import {
	handleBulkCreateSlots,
	handleCompleteTournament,
	handleDeleteSlot,
	handleGenerateRound,
	handlePatchPairing,
	handlePatchSlot,
	handlePatchTournament,
	handleRetroEditMatch,
	handleStartRound,
	handleStartSwiss,
	handleTransitionChampionship,
} from "./tournament/admin";
import type { TournamentAdminEnv } from "./tournament/admin";

interface Env
	extends
		AuthEnv,
		GamesEnv,
		CollectionsEnv,
		OnlineIdsEnv,
		StatsEnv,
		TournamentPublicEnv,
		TournamentPlayerEnv,
		TournamentAdminEnv {
	SHARE_BUCKET: R2Bucket;
	SHARE_DB: D1Database;
	SESSIONS_KV: KVNamespace;
	MAX_COMPRESSED_SIZE: string;
	MAX_DECOMPRESSED_SIZE: string;
	ALLOWED_ORIGIN: string;
	ALLOWED_ORIGINS: string;
	RATE_LIMIT_PER_HOUR: string;
	DOWNLOAD_RATE_LIMIT_PER_HOUR: string;
	IP_RATE_LIMIT_PER_HOUR: string;
	GLOBAL_UPLOAD_LIMIT_PER_HOUR: string;
	UPLOADS_ENABLED: string;
	DISCORD_CLIENT_ID: string;
	DISCORD_CLIENT_SECRET: string;
}

// UUID v4 format: 8-4-4-4-12 hex chars
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Legacy /v1/share/* uses the single-origin CORS helper. New /v1/auth/*
// endpoints use the multi-origin helper (cookie-credentialed) defined in
// util.ts.
function corsHeaders(env: Env): Record<string, string> {
	return legacyCorsHeaders(env);
}

function jsonResponse(
	body: Record<string, unknown>,
	status: number,
	env: Env,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			...corsHeaders(env),
		},
	});
}

function errorResponse(error: string, status: number, env: Env): Response {
	return jsonResponse({ error }, status, env);
}

// Probabilistic cleanup of old events (runs ~2% of the time)
async function maybeCleanupEvents(db: D1Database): Promise<void> {
	if (Math.random() > 0.02) return;

	try {
		await db
			.prepare(
				"DELETE FROM events WHERE created_at < datetime('now', '-90 days')",
			)
			.run();
	} catch (e) {
		logError("event_cleanup_failed", e);
	}
}

async function logEvent(
	db: D1Database,
	eventType: "upload" | "delete",
	shareId: string,
	appKey: string | null,
	ipAddress: string | null,
	metadata?: Record<string, unknown>,
): Promise<void> {
	try {
		await db
			.prepare(
				"INSERT INTO events (event_type, share_id, app_key, ip_address, metadata) VALUES (?, ?, ?, ?, ?)",
			)
			.bind(
				eventType,
				shareId,
				appKey,
				ipAddress,
				metadata ? JSON.stringify(metadata) : null,
			)
			.run();

		await maybeCleanupEvents(db);
	} catch (e) {
		// Log failure is non-critical — don't fail the request
		logError("audit_event_log_failed", e, { event_type: eventType });
	}
}

// === Rate Limiting ===

// Per-app-key upload rate limit (D1)
async function checkKeyRateLimit(
	db: D1Database,
	appKey: string,
	maxPerHour: number,
): Promise<boolean> {
	const result = await db
		.prepare(
			"SELECT COUNT(*) as count FROM events WHERE app_key = ? AND event_type = 'upload' AND created_at > datetime('now', '-1 hour')",
		)
		.bind(appKey)
		.first<{ count: number }>();

	return (result?.count ?? 0) < maxPerHour;
}

// Per-IP upload rate limit — catches app-key rotation attacks (D1)
async function checkIpRateLimit(
	db: D1Database,
	ip: string,
	maxPerHour: number,
): Promise<boolean> {
	const result = await db
		.prepare(
			"SELECT COUNT(*) as count FROM events WHERE ip_address = ? AND event_type = 'upload' AND created_at > datetime('now', '-1 hour')",
		)
		.bind(ip)
		.first<{ count: number }>();

	return (result?.count ?? 0) < maxPerHour;
}

// Global upload circuit breaker — emergency brake for distributed attacks (D1)
async function checkGlobalUploadLimit(
	db: D1Database,
	maxPerHour: number,
): Promise<boolean> {
	const result = await db
		.prepare(
			"SELECT COUNT(*) as count FROM events WHERE event_type = 'upload' AND created_at > datetime('now', '-1 hour')",
		)
		.first<{ count: number }>();

	return (result?.count ?? 0) < maxPerHour;
}

// Per-IP download rate limit — lightweight counter via Cache API (per-POP)
async function checkDownloadRateLimit(
	ip: string,
	maxPerHour: number,
): Promise<boolean> {
	const cache = caches.default;
	const url = new URL(`https://rate-limit.internal/download/${ip}`);

	const cached = await cache.match(url);
	const count = cached ? parseInt(await cached.text()) + 1 : 1;

	const response = new Response(String(count), {
		headers: { "Cache-Control": "max-age=3600" },
	});
	await cache.put(url, response);

	return count <= maxPerHour;
}

// === Blocklist ===

async function checkBlocklists(
	db: D1Database,
	appKey: string,
	ip: string | null,
): Promise<boolean> {
	const blockedKey = await db
		.prepare("SELECT 1 FROM blocked_keys WHERE app_key = ?")
		.bind(appKey)
		.first();
	if (blockedKey) return true;

	if (ip) {
		const blockedIp = await db
			.prepare("SELECT 1 FROM blocked_ips WHERE ip_address = ?")
			.bind(ip)
			.first();
		if (blockedIp) return true;
	}

	return false;
}

// === Endpoint Handlers ===

async function handleUpload(request: Request, env: Env): Promise<Response> {
	// 1. Kill switch
	if (env.UPLOADS_ENABLED !== "true") {
		return errorResponse("Uploads temporarily disabled", 503, env);
	}

	// 2. Require X-App-Key header
	const appKey = request.headers.get("X-App-Key");
	if (!appKey || !UUID_REGEX.test(appKey)) {
		return errorResponse("Missing or invalid X-App-Key header", 400, env);
	}

	// 3. Extract IP early for rate limiting and blocklist checks
	const ip = getClientIp(request);

	// 4. Check blocklists before doing any expensive work
	const blocked = await checkBlocklists(env.SHARE_DB, appKey, ip);
	if (blocked) {
		return errorResponse("Forbidden", 403, env);
	}

	// 5. Rate limits: per-key, per-IP, global (before body buffering)
	const maxPerHour = parseInt(env.RATE_LIMIT_PER_HOUR);
	const withinKeyLimit = await checkKeyRateLimit(
		env.SHARE_DB,
		appKey,
		maxPerHour,
	);
	if (!withinKeyLimit) {
		return errorResponse("Rate limit exceeded. Try again later.", 429, env);
	}

	if (ip) {
		const ipMaxPerHour = parseInt(env.IP_RATE_LIMIT_PER_HOUR);
		const withinIpLimit = await checkIpRateLimit(
			env.SHARE_DB,
			ip,
			ipMaxPerHour,
		);
		if (!withinIpLimit) {
			return errorResponse("Rate limit exceeded. Try again later.", 429, env);
		}
	}

	const globalMax = parseInt(env.GLOBAL_UPLOAD_LIMIT_PER_HOUR);
	const withinGlobalLimit = await checkGlobalUploadLimit(
		env.SHARE_DB,
		globalMax,
	);
	if (!withinGlobalLimit) {
		return errorResponse("Rate limit exceeded. Try again later.", 429, env);
	}

	// 6. Require Content-Type: application/gzip
	const contentType = request.headers.get("Content-Type");
	if (contentType !== "application/gzip") {
		return errorResponse("Content-Type must be application/gzip", 400, env);
	}

	// 7. Early Content-Length check before buffering the body
	const maxCompressed = parseInt(env.MAX_COMPRESSED_SIZE);
	const contentLength = request.headers.get("Content-Length");
	if (contentLength) {
		const declaredSize = parseInt(contentLength, 10);
		if (!Number.isNaN(declaredSize) && declaredSize > maxCompressed) {
			return errorResponse("Payload too large", 413, env);
		}
	}

	// 8. Read and check actual compressed body size
	const body = await request.arrayBuffer();
	if (body.byteLength > maxCompressed) {
		logWarn("legacy_upload_oversized", {
			size: body.byteLength,
			limit: maxCompressed,
		});
		return errorResponse("Payload too large", 413, env);
	}
	if (body.byteLength === 0) {
		return errorResponse("Empty payload", 400, env);
	}

	// 9. Decompress with size limit (gzip bomb protection)
	const maxDecompressed = parseInt(env.MAX_DECOMPRESSED_SIZE);
	let decompressed: Uint8Array;
	try {
		decompressed = await decompressWithLimit(body, maxDecompressed);
	} catch (e) {
		logWarn("legacy_decompress_failed", {
			message: e instanceof Error ? e.message : "unknown",
		});
		return errorResponse("Decompressed payload too large", 413, env);
	}

	// 10. Parse JSON
	let parsed: unknown;
	try {
		const text = new TextDecoder().decode(decompressed);
		parsed = JSON.parse(text);
	} catch {
		return errorResponse("Invalid JSON in decompressed payload", 400, env);
	}

	// 11. Validate schema
	const validation = validateSharePayload(parsed);
	if (!validation.valid) {
		// app_key is on the PII deny-list — passing it surfaces as
		// [REDACTED] in the log line.
		logWarn("legacy_validation_failed", {
			app_key: appKey,
			error: validation.error,
		});
		return errorResponse("Invalid payload", 400, env);
	}

	// 12. Generate IDs
	const shareId = nanoid(21);
	const deleteToken = nanoid(32);

	// 13. Extract metadata for D1 index
	const metadata = extractMetadata(parsed as Record<string, unknown>);
	const blobVersion = (parsed as Record<string, unknown>).version as number;

	// 14. Write to R2 (do this first — if D1 fails, we clean up the blob)
	const r2Key = `${shareId}.json.gz`;
	await env.SHARE_BUCKET.put(r2Key, body, {
		httpMetadata: {
			contentType: "application/json",
			contentEncoding: "gzip",
		},
		customMetadata: {
			appKey,
			createdAt: new Date().toISOString(),
		},
	});

	// 15. Write to D1 share index
	const createdAt = new Date().toISOString();
	try {
		await env.SHARE_DB.prepare(
			`INSERT INTO shares (share_id, app_key, created_at, blob_version, game_name, total_turns, player_nation, map_size, blob_size_bytes, delete_token)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				shareId,
				appKey,
				createdAt,
				blobVersion,
				metadata.game_name,
				metadata.total_turns,
				metadata.player_nation,
				metadata.map_size,
				body.byteLength,
				deleteToken,
			)
			.run();
	} catch (e) {
		logError("d1_insert_failed", e, { share_id: shareId, r2_key: r2Key });
		try {
			await env.SHARE_BUCKET.delete(r2Key);
		} catch (cleanupErr) {
			logError("orphaned_blob", cleanupErr, {
				share_id: shareId,
				r2_key: r2Key,
			});
		}
		return errorResponse("Failed to create share", 500, env);
	}

	// 16. Log upload event
	await logEvent(env.SHARE_DB, "upload", shareId, appKey, ip, {
		blob_size: body.byteLength,
		decompressed_size: decompressed.byteLength,
	});

	// 17. Return share info
	const shareUrl = `https://per-ankh.app/share/${shareId}`;
	return jsonResponse(
		{
			share_id: shareId,
			url: shareUrl,
			delete_token: deleteToken,
		},
		201,
		env,
	);
}

async function handleDownload(
	shareId: string,
	request: Request,
	env: Env,
): Promise<Response> {
	// Rate limit downloads per IP via Cache API. Untrusted IP (CF-RAY missing)
	// → use a single shared "untrusted" bucket rather than skipping the limit.
	const ip = getClientIp(request) ?? "untrusted";
	const maxDownloads = parseInt(env.DOWNLOAD_RATE_LIMIT_PER_HOUR);
	const withinLimit = await checkDownloadRateLimit(ip, maxDownloads);
	if (!withinLimit) {
		return errorResponse("Rate limit exceeded. Try again later.", 429, env);
	}

	const r2Key = `${shareId}.json.gz`;
	const object = await env.SHARE_BUCKET.get(r2Key);

	if (!object) {
		return errorResponse("Share not found", 404, env);
	}

	// Decompress in Worker because Cloudflare CDN strips Content-Encoding
	// from Worker responses. Acceptable because:
	// 1. CDN caches decompressed response for 1 hour (Cache-Control header)
	// 2. Decompression of ~1MB takes <10ms
	// 3. Download rate limiting prevents cache-busting abuse
	const compressed = await object.arrayBuffer();
	const ds = new DecompressionStream("gzip");
	const writer = ds.writable.getWriter();
	writer.write(compressed);
	writer.close();

	return new Response(ds.readable, {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=3600",
			...corsHeaders(env),
		},
	});
}

async function handleDelete(
	shareId: string,
	request: Request,
	env: Env,
): Promise<Response> {
	// 1. Require X-Delete-Token and X-App-Key headers
	const deleteToken = request.headers.get("X-Delete-Token");
	if (!deleteToken) {
		return errorResponse("Missing X-Delete-Token header", 400, env);
	}
	const appKey = request.headers.get("X-App-Key");
	if (!appKey) {
		return errorResponse("Missing X-App-Key header", 400, env);
	}

	// 2. Look up share in D1 and verify credentials
	const share = await env.SHARE_DB.prepare(
		"SELECT share_id, delete_token, app_key FROM shares WHERE share_id = ?",
	)
		.bind(shareId)
		.first<{ share_id: string; delete_token: string; app_key: string }>();

	if (!share) {
		return errorResponse("Share not found", 404, env);
	}

	if (
		!timingSafeEqual(share.delete_token, deleteToken) ||
		!timingSafeEqual(share.app_key, appKey)
	) {
		return errorResponse("Invalid delete credentials", 403, env);
	}

	// 3. Delete R2 blob
	const r2Key = `${shareId}.json.gz`;
	await env.SHARE_BUCKET.delete(r2Key);

	// 4. Delete D1 record (hard delete)
	await env.SHARE_DB.prepare("DELETE FROM shares WHERE share_id = ?")
		.bind(shareId)
		.run();

	// 5. Log delete event
	const ip = request.headers.get("CF-Connecting-IP");
	await logEvent(env.SHARE_DB, "delete", shareId, share.app_key, ip);

	return new Response(null, {
		status: 204,
		headers: corsHeaders(env),
	});
}

// === Router ===
//
// Routes are declared as a typed table so the dispatch loop can:
//   (a) match by exact path or regex,
//   (b) set the route pattern (e.g. "GET /v1/games/:id") on the log
//       context for stable per-route grouping in Logpush,
//   (c) keep route additions to a single self-describing edit.
//
// More-specific patterns (e.g. /v1/games/:id/download) MUST appear before
// more-generic ones (/v1/games/:id) — first match wins.

type RouteHandler = (
	request: Request,
	env: Env,
	match: RegExpMatchArray | null,
	ctx: ExecutionContext,
) => Promise<Response>;

interface RouteSpec {
	method: string;
	match: { kind: "path"; path: string } | { kind: "regex"; regex: RegExp };
	route: string;
	handler: RouteHandler;
}

const ROUTES: RouteSpec[] = [
	// Cloud rewrite: /v1/auth/*
	{
		method: "POST",
		match: { kind: "path", path: "/v1/auth/discord/start" },
		route: "POST /v1/auth/discord/start",
		handler: (r, e) => handleDiscordStart(r, e),
	},
	{
		method: "POST",
		match: { kind: "path", path: "/v1/auth/discord/callback" },
		route: "POST /v1/auth/discord/callback",
		handler: (r, e) => handleDiscordCallback(r, e),
	},
	{
		method: "GET",
		match: { kind: "path", path: "/v1/auth/me" },
		route: "GET /v1/auth/me",
		handler: (r, e) => handleMe(r, e),
	},
	{
		method: "POST",
		match: { kind: "path", path: "/v1/auth/logout" },
		route: "POST /v1/auth/logout",
		handler: (r, e) => handleLogout(r, e),
	},

	// Cloud rewrite: /v1/games/*
	{
		method: "POST",
		match: { kind: "path", path: "/v1/games" },
		route: "POST /v1/games",
		handler: (r, e) => handleGameUpload(r, e),
	},
	{
		method: "GET",
		match: { kind: "path", path: "/v1/games" },
		route: "GET /v1/games",
		handler: (r, e) => handleGameList(r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/games\/([A-Za-z0-9_-]{21})\/download$/,
		},
		route: "GET /v1/games/:id/download",
		handler: (r, e, m) => handleGameDownload(m![1], r, e),
	},
	{
		method: "GET",
		match: { kind: "regex", regex: /^\/v1\/games\/([A-Za-z0-9_-]{21})$/ },
		route: "GET /v1/games/:id",
		handler: (r, e, m) => handleGameDetail(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/games\/([A-Za-z0-9_-]{21})\/tournament-link$/,
		},
		route: "GET /v1/games/:id/tournament-link",
		handler: (r, e, m) => handleGameTournamentLink(m![1], r, e),
	},
	{
		method: "PATCH",
		match: { kind: "regex", regex: /^\/v1\/games\/([A-Za-z0-9_-]{21})$/ },
		route: "PATCH /v1/games/:id",
		handler: (r, e, m) => handleGamePatch(m![1], r, e),
	},
	{
		method: "DELETE",
		match: { kind: "regex", regex: /^\/v1\/games\/([A-Za-z0-9_-]{21})$/ },
		route: "DELETE /v1/games/:id",
		handler: (r, e, m) => handleGameDelete(m![1], r, e),
	},

	// Cloud rewrite: /v1/collections
	{
		method: "GET",
		match: { kind: "path", path: "/v1/collections" },
		route: "GET /v1/collections",
		handler: (r, e) => handleCollectionsList(r, e),
	},
	{
		method: "POST",
		match: { kind: "path", path: "/v1/collections" },
		route: "POST /v1/collections",
		handler: (r, e) => handleCollectionCreate(r, e),
	},

	// Cloud rewrite: /v1/users/me/online-ids
	{
		method: "GET",
		match: { kind: "path", path: "/v1/users/me/online-ids" },
		route: "GET /v1/users/me/online-ids",
		handler: (r, e) => handleListOnlineIds(r, e),
	},
	{
		method: "DELETE",
		match: { kind: "regex", regex: /^\/v1\/users\/me\/online-ids\/(.+)$/ },
		route: "DELETE /v1/users/me/online-ids/:id",
		handler: (r, e, m) => handleRemoveOnlineId(decodeURIComponent(m![1]), r, e),
	},

	// Cloud rewrite: /v1/stats
	{
		method: "GET",
		match: { kind: "path", path: "/v1/stats" },
		route: "GET /v1/stats",
		handler: (r, e) => handleStats(r, e),
	},

	// CSP violation reports — unauthenticated; the browser POSTs here
	// directly when the page's CSP triggers. See cloud/src/csp.ts.
	{
		method: "POST",
		match: { kind: "path", path: "/v1/csp-report" },
		route: "POST /v1/csp-report",
		handler: (r) => handleCspReport(r),
	},

	// Cloud rewrite: /v1/tournaments/* — more-specific patterns first
	{
		method: "GET",
		match: { kind: "path", path: "/v1/tournaments" },
		route: "GET /v1/tournaments",
		handler: (r, e) => handleTournamentList(r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/standings$/,
		},
		route: "GET /v1/tournaments/:id/standings",
		handler: (r, e, m) => handleTournamentStandings(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/bracket$/,
		},
		route: "GET /v1/tournaments/:id/bracket",
		handler: (r, e, m) => handleTournamentBracket(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/rounds$/,
		},
		route: "GET /v1/tournaments/:id/rounds",
		handler: (r, e, m) => handleTournamentRounds(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/matches$/,
		},
		route: "GET /v1/tournaments/:id/matches",
		handler: (r, e, m) => handleTournamentMatches(m![1], r, e),
	},
	{
		method: "GET",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/matches\/([A-Za-z0-9_-]{21})$/,
		},
		route: "GET /v1/tournaments/:id/matches/:match_id",
		handler: (r, e, m) => handleTournamentMatchDetail(m![1], m![2], r, e),
	},
	// Player + admin mutations on matches (more specific than detail GET above)
	{
		method: "PATCH",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/matches\/([A-Za-z0-9_-]{21})\/pairing$/,
		},
		route: "PATCH /v1/tournaments/:id/matches/:match_id/pairing",
		handler: (r, e, m) => handlePatchPairing(m![1], m![2], r, e),
	},
	{
		method: "PATCH",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/matches\/([A-Za-z0-9_-]{21})$/,
		},
		route: "PATCH /v1/tournaments/:id/matches/:match_id",
		handler: (r, e, m) => handleRetroEditMatch(m![1], m![2], r, e),
	},
	// Round controls
	{
		method: "POST",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/rounds\/([A-Za-z0-9_-]{21})\/start$/,
		},
		route: "POST /v1/tournaments/:id/rounds/:round_id/start",
		handler: (r, e, m) => handleStartRound(m![1], m![2], r, e),
	},
	{
		method: "POST",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/rounds$/,
		},
		route: "POST /v1/tournaments/:id/rounds",
		handler: (r, e, m) => handleGenerateRound(m![1], r, e),
	},
	// Slots
	{
		method: "POST",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/slots$/,
		},
		route: "POST /v1/tournaments/:id/slots",
		handler: (r, e, m) => handleBulkCreateSlots(m![1], r, e),
	},
	{
		method: "PATCH",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/slots\/([A-Za-z0-9_-]{21})$/,
		},
		route: "PATCH /v1/tournaments/:id/slots/:slot_id",
		handler: (r, e, m) => handlePatchSlot(m![1], m![2], r, e),
	},
	{
		method: "DELETE",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/slots\/([A-Za-z0-9_-]{21})$/,
		},
		route: "DELETE /v1/tournaments/:id/slots/:slot_id",
		handler: (r, e, m) => handleDeleteSlot(m![1], m![2], r, e),
	},
	// Lifecycle
	{
		method: "POST",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/start-swiss$/,
		},
		route: "POST /v1/tournaments/:id/start-swiss",
		handler: (r, e, m) => handleStartSwiss(m![1], r, e),
	},
	{
		method: "POST",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/transition-championship$/,
		},
		route: "POST /v1/tournaments/:id/transition-championship",
		handler: (r, e, m) => handleTransitionChampionship(m![1], r, e),
	},
	{
		method: "POST",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})\/complete$/,
		},
		route: "POST /v1/tournaments/:id/complete",
		handler: (r, e, m) => handleCompleteTournament(m![1], r, e),
	},
	{
		method: "PATCH",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([A-Za-z0-9_-]{21})$/,
		},
		route: "PATCH /v1/tournaments/:id",
		handler: (r, e, m) => handlePatchTournament(m![1], r, e),
	},
	// Tournament detail by slug (must come AFTER all /tournaments/:id/... routes;
	// slug regex is broader)
	{
		method: "GET",
		match: {
			kind: "regex",
			regex: /^\/v1\/tournaments\/([a-z0-9][a-z0-9-]{0,63})$/,
		},
		route: "GET /v1/tournaments/:slug",
		handler: (r, e, m) => handleTournamentDetail(m![1], r, e),
	},

	// User-facing tournament endpoints
	{
		method: "GET",
		match: { kind: "path", path: "/v1/users/me/tournaments" },
		route: "GET /v1/users/me/tournaments",
		handler: (r, e) => handleMyTournaments(r, e),
	},
	{
		method: "GET",
		match: { kind: "path", path: "/v1/users/me/matches" },
		route: "GET /v1/users/me/matches",
		handler: (r, e) => handleMyMatches(r, e),
	},
	{
		method: "POST",
		match: {
			kind: "regex",
			regex:
				/^\/v1\/users\/me\/tournaments\/([A-Za-z0-9_-]{21})\/dismiss-banner$/,
		},
		route: "POST /v1/users/me/tournaments/:id/dismiss-banner",
		handler: (r, e, m) => handleDismissBanner(m![1], r, e),
	},

	// Legacy: /v1/share/*
	{
		method: "POST",
		match: { kind: "path", path: "/v1/share" },
		route: "POST /v1/share",
		handler: (r, e) => handleUpload(r, e),
	},
	{
		method: "GET",
		match: { kind: "regex", regex: /^\/v1\/share\/([A-Za-z0-9_-]{21})$/ },
		route: "GET /v1/share/:id",
		handler: (r, e, m) => handleDownload(m![1], r, e),
	},
	{
		method: "DELETE",
		match: { kind: "regex", regex: /^\/v1\/share\/([A-Za-z0-9_-]{21})$/ },
		route: "DELETE /v1/share/:id",
		handler: (r, e, m) => handleDelete(m![1], r, e),
	},
];

// Cloud paths use credentialed (echo-Origin) CORS so cookies traverse
// per-ankh.app ↔ api.per-ankh.app. Legacy /v1/share uses single-origin.
// /v1/csp-report rides cloud-CORS too — browsers don't preflight CSP
// reports, but listing it here keeps OPTIONS responses correct for any
// tooling that does.
function isCloudPath(pathname: string): boolean {
	return (
		pathname.startsWith("/v1/auth/") ||
		pathname === "/v1/games" ||
		pathname.startsWith("/v1/games/") ||
		pathname === "/v1/collections" ||
		pathname.startsWith("/v1/users/") ||
		pathname === "/v1/stats" ||
		pathname === "/v1/csp-report" ||
		pathname === "/v1/tournaments" ||
		pathname.startsWith("/v1/tournaments/")
	);
}

function dispatch(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const url = new URL(request.url);
	for (const r of ROUTES) {
		if (r.method !== request.method) continue;
		if (r.match.kind === "path") {
			if (r.match.path !== url.pathname) continue;
			setRoute(r.route);
			return r.handler(request, env, null, ctx);
		}
		const m = url.pathname.match(r.match.regex);
		if (!m) continue;
		setRoute(r.route);
		return r.handler(request, env, m, ctx);
	}
	// 404 — pick CORS based on path so error responses still allow the
	// origin that asked. The cloud helper echoes the request Origin; the
	// legacy helper returns the single ALLOWED_ORIGIN.
	const cors = isCloudPath(url.pathname)
		? cloudCorsHeaders(env, request)
		: corsHeaders(env);
	return Promise.resolve(
		new Response(JSON.stringify({ error: "Not found" }), {
			status: 404,
			headers: { "Content-Type": "application/json", ...cors },
		}),
	);
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		return runWithLogContext(request, async () => {
			const url = new URL(request.url);
			let response: Response;

			try {
				if (request.method === "OPTIONS") {
					const headers = isCloudPath(url.pathname)
						? cloudCorsHeaders(env, request)
						: corsHeaders(env);
					response = new Response(null, { status: 204, headers });
				} else {
					response = await dispatch(request, env, ctx);
				}
			} catch (err) {
				// Top-level safety net. Any uncaught throw becomes a 500 with
				// the request_id in the body so the caller can include it in
				// a bug report. Error class is captured for the access log.
				logError("unhandled_handler_error", err);
				const requestId = getRequestId();
				const cors = isCloudPath(url.pathname)
					? cloudCorsHeaders(env, request)
					: corsHeaders(env);
				response = new Response(
					JSON.stringify({
						error: "Internal server error",
						request_id: requestId,
					}),
					{
						status: 500,
						headers: { "Content-Type": "application/json", ...cors },
					},
				);
			}

			// Surface request_id to the client. Re-wrap so headers are mutable
			// even when the handler returned a Response with frozen headers
			// (e.g. R2 streams).
			response = new Response(response.body, response);
			response.headers.set("X-Request-Id", getRequestId() ?? "");
			emitAccessLog(response);
			return response;
		});
	},
} satisfies ExportedHandler<Env>;
