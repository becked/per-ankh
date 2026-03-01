// Per-Ankh Share API — Cloudflare Worker
//
// Endpoints:
//   POST   /v1/share       — Upload a shared game blob
//   GET    /v1/share/{id}  — Download a shared game blob
//   DELETE /v1/share/{id}  — Delete a shared game blob
//
// Storage: R2 for blobs, D1 for share index and event logging.

import { nanoid } from "nanoid";
import { validateSharePayload, extractMetadata } from "./validation";

interface Env {
	SHARE_BUCKET: R2Bucket;
	SHARE_DB: D1Database;
	MAX_COMPRESSED_SIZE: string;
	MAX_DECOMPRESSED_SIZE: string;
	ALLOWED_ORIGIN: string;
	RATE_LIMIT_PER_HOUR: string;
}

// UUID v4 format: 8-4-4-4-12 hex chars
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function corsHeaders(env: Env): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
		"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, X-App-Key, X-Delete-Token",
		"Access-Control-Max-Age": "86400",
	};
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

// Decompress gzipped data with a size limit to prevent gzip bombs
async function decompressWithLimit(
	compressed: ArrayBuffer,
	maxBytes: number,
): Promise<Uint8Array> {
	const ds = new DecompressionStream("gzip");
	const writer = ds.writable.getWriter();
	const reader = ds.readable.getReader();

	// Write compressed data
	writer.write(compressed);
	writer.close();

	// Read decompressed data with size tracking
	const chunks: Uint8Array[] = [];
	let totalSize = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		totalSize += value.byteLength;
		if (totalSize > maxBytes) {
			reader.cancel();
			throw new Error(
				`Decompressed size exceeds limit (${maxBytes} bytes)`,
			);
		}
		chunks.push(value);
	}

	// Concatenate chunks
	const result = new Uint8Array(totalSize);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
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
	} catch (e) {
		// Log failure is non-critical — don't fail the request
		console.error("Failed to log event:", e);
	}
}

// Check rate limit: count recent uploads from same app_key
async function checkRateLimit(
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

// === Endpoint Handlers ===

async function handleUpload(
	request: Request,
	env: Env,
): Promise<Response> {
	// 1. Require X-App-Key header
	const appKey = request.headers.get("X-App-Key");
	if (!appKey || !UUID_REGEX.test(appKey)) {
		return errorResponse(
			"Missing or invalid X-App-Key header (must be UUID v4)",
			400,
			env,
		);
	}

	// 2. Require Content-Type: application/gzip
	const contentType = request.headers.get("Content-Type");
	if (contentType !== "application/gzip") {
		return errorResponse(
			"Content-Type must be application/gzip",
			400,
			env,
		);
	}

	// 3. Check compressed body size
	const maxCompressed = parseInt(env.MAX_COMPRESSED_SIZE);
	const body = await request.arrayBuffer();
	if (body.byteLength > maxCompressed) {
		return errorResponse(
			`Payload too large (${body.byteLength} bytes > ${maxCompressed} byte limit)`,
			413,
			env,
		);
	}
	if (body.byteLength === 0) {
		return errorResponse("Empty payload", 400, env);
	}

	// 4. Rate limit by app_key
	const maxPerHour = parseInt(env.RATE_LIMIT_PER_HOUR);
	const withinLimit = await checkRateLimit(env.SHARE_DB, appKey, maxPerHour);
	if (!withinLimit) {
		return errorResponse(
			`Rate limit exceeded (max ${maxPerHour} uploads per hour)`,
			429,
			env,
		);
	}

	// 5. Decompress with size limit (gzip bomb protection)
	const maxDecompressed = parseInt(env.MAX_DECOMPRESSED_SIZE);
	let decompressed: Uint8Array;
	try {
		decompressed = await decompressWithLimit(body, maxDecompressed);
	} catch (e) {
		const message =
			e instanceof Error ? e.message : "Decompression failed";
		return errorResponse(message, 413, env);
	}

	// 6. Parse JSON
	let parsed: unknown;
	try {
		const text = new TextDecoder().decode(decompressed);
		parsed = JSON.parse(text);
	} catch {
		return errorResponse("Invalid JSON in decompressed payload", 400, env);
	}

	// 7. Validate schema
	const validation = validateSharePayload(parsed);
	if (!validation.valid) {
		return errorResponse(
			`Schema validation failed: ${validation.error}`,
			400,
			env,
		);
	}

	// 8. Generate IDs
	const shareId = nanoid(21);
	const deleteToken = nanoid(32);

	// 9. Extract metadata for D1 index
	const metadata = extractMetadata(parsed as Record<string, unknown>);
	const blobVersion = (parsed as Record<string, unknown>).version as number;
	const ip = request.headers.get("CF-Connecting-IP");

	// 10. Write to R2 (do this first — if D1 fails, orphaned blob is harmless)
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

	// 11. Write to D1 share index
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
		// D1 write failed after R2 succeeded — log but don't fail the upload.
		// The blob is accessible via R2; the D1 record is for admin/gallery only.
		console.error("Failed to write D1 share index:", e);
	}

	// 12. Log upload event
	await logEvent(env.SHARE_DB, "upload", shareId, appKey, ip, {
		blob_size: body.byteLength,
		decompressed_size: decompressed.byteLength,
	});

	// 13. Return share info
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
	env: Env,
): Promise<Response> {
	const r2Key = `${shareId}.json.gz`;
	const object = await env.SHARE_BUCKET.get(r2Key);

	if (!object) {
		return errorResponse("Share not found", 404, env);
	}

	// Decompress in the Worker — Cloudflare's CDN strips Content-Encoding: gzip
	// from Worker responses, so we must return raw JSON and let the edge
	// handle transparent compression based on the client's Accept-Encoding.
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
	// 1. Require X-Delete-Token header
	const deleteToken = request.headers.get("X-Delete-Token");
	if (!deleteToken) {
		return errorResponse("Missing X-Delete-Token header", 400, env);
	}

	// 2. Look up share in D1 and verify token
	const share = await env.SHARE_DB.prepare(
		"SELECT share_id, delete_token, app_key FROM shares WHERE share_id = ?",
	)
		.bind(shareId)
		.first<{ share_id: string; delete_token: string; app_key: string }>();

	if (!share) {
		return errorResponse("Share not found", 404, env);
	}

	if (share.delete_token !== deleteToken) {
		return errorResponse("Invalid delete token", 403, env);
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

	return jsonResponse({ deleted: true }, 200, env);
}

// === Router ===

export default {
	async fetch(
		request: Request,
		env: Env,
	): Promise<Response> {
		const url = new URL(request.url);
		const method = request.method;

		// Handle CORS preflight
		if (method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders(env),
			});
		}

		// Route: POST /v1/share
		if (method === "POST" && url.pathname === "/v1/share") {
			return handleUpload(request, env);
		}

		// Route: GET /v1/share/{id}
		const getMatch = url.pathname.match(/^\/v1\/share\/([A-Za-z0-9_-]{21})$/);
		if (method === "GET" && getMatch) {
			return handleDownload(getMatch[1], env);
		}

		// Route: DELETE /v1/share/{id}
		const deleteMatch = url.pathname.match(
			/^\/v1\/share\/([A-Za-z0-9_-]{21})$/,
		);
		if (method === "DELETE" && deleteMatch) {
			return handleDelete(deleteMatch[1], request, env);
		}

		return errorResponse("Not found", 404, env);
	},
} satisfies ExportedHandler<Env>;
