// Shared helpers used by both legacy share endpoints and the new cloud
// auth/games endpoints.

import * as v from "valibot";
import { logWarn, setErrorCode } from "./log";

export interface CommonEnv {
	ALLOWED_ORIGIN: string;
	ALLOWED_ORIGINS: string;
}

// Constant-time string comparison to prevent timing attacks on secret tokens.
// Used for delete-token verification (legacy) and OAuth state verification.
export function timingSafeEqual(a: string, b: string): boolean {
	const encoder = new TextEncoder();
	const bufA = encoder.encode(a);
	const bufB = encoder.encode(b);
	if (bufA.byteLength !== bufB.byteLength) return false;
	return crypto.subtle.timingSafeEqual(bufA, bufB);
}

// Parse a Cookie header value into a flat name → value map.
// Returns an empty object if the header is missing or malformed.
export function parseCookies(
	headerValue: string | null,
): Record<string, string> {
	const out: Record<string, string> = {};
	if (!headerValue) return out;
	for (const part of headerValue.split(";")) {
		const eq = part.indexOf("=");
		if (eq < 0) continue;
		const name = part.slice(0, eq).trim();
		const value = part.slice(eq + 1).trim();
		if (name) out[name] = decodeURIComponent(value);
	}
	return out;
}

// CORS for legacy /v1/share/* — single allowed origin, no credentials.
//
// Vary: Origin is needed because /v1/share/:id is publicly cached
// (Cache-Control: public, max-age=3600). Without it, the CDN and
// browser disk cache key by URL alone and serve one response across
// all origins — so a CORS-config change can leave the wrong ACL
// header cached for up to an hour. Same value works as a shield for
// OPTIONS preflight responses too.
export function legacyCorsHeaders(
	env: Pick<CommonEnv, "ALLOWED_ORIGIN">,
): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
		"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, X-App-Key, X-Delete-Token",
		"Access-Control-Max-Age": "86400",
		Vary: "Origin",
	};
}

// CORS for new /v1/auth/* and (future) /v1/games/* routes.
// Echoes the request Origin if it's in ALLOWED_ORIGINS so credentialed
// requests work. Returns null Access-Control-Allow-Origin if the origin
// isn't allowed (the browser will then block the response).
// Parse the comma-separated ALLOWED_ORIGINS into a trimmed, non-empty list.
// Shared by cloudCorsHeaders and the OAuth redirect_uri allowlist so both read
// the same source of truth.
export function parseAllowedOrigins(allowed: string): string[] {
	return allowed
		.split(",")
		.map((o) => o.trim())
		.filter(Boolean);
}

// Allowlist check for the OAuth callback URL. The origin must be in
// ALLOWED_ORIGINS and the path must be exactly the SvelteKit callback route —
// nothing else is a legitimate redirect target. Defense in depth atop Discord's
// own registered-redirect-URI list (see handleDiscordStart).
export function isAllowedRedirectUri(
	redirectUri: string,
	allowedOrigins: string[],
): boolean {
	let url: URL;
	try {
		url = new URL(redirectUri);
	} catch {
		return false;
	}
	if (url.pathname !== "/auth/callback") return false;
	return allowedOrigins.includes(url.origin);
}

export function cloudCorsHeaders(
	env: Pick<CommonEnv, "ALLOWED_ORIGINS">,
	request: Request,
): Record<string, string> {
	const origin = request.headers.get("Origin");
	const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
	const allowedOrigin = origin && allowed.includes(origin) ? origin : "";
	const headers: Record<string, string> = {
		"Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "86400",
		Vary: "Origin",
	};
	if (allowedOrigin) {
		headers["Access-Control-Allow-Origin"] = allowedOrigin;
		headers["Access-Control-Allow-Credentials"] = "true";
	}
	return headers;
}

export function jsonResponse(
	body: Record<string, unknown>,
	status: number,
	cors: Record<string, string>,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			...cors,
		},
	});
}

export function errorResponse(
	message: string,
	status: number,
	cors: Record<string, string>,
	code?: string,
	extra?: Record<string, unknown>,
): Response {
	// Surface the error code on the request-scoped log context so the
	// access-log envelope picks it up automatically — handlers don't have
	// to log error_code themselves.
	if (code) setErrorCode(code);
	const body: Record<string, unknown> = { error: message };
	if (code) body.code = code;
	if (extra) Object.assign(body, extra);
	return jsonResponse(body, status, cors);
}

// Parse + validate a JSON request body against a Valibot schema, returning a
// discriminated union the caller can branch on. Shared by the tournament
// admin/player handlers (and available to any JSON endpoint).
//
// Defense-in-depth against CSRF: SameSite=Lax already blocks cross-origin POST
// in modern browsers, but an explicit Content-Type check rejects form-encoded
// submissions that could otherwise reach a JSON endpoint with a non-empty body.
export async function parseJsonBody<T>(
	request: Request,
	schema: v.GenericSchema<unknown, T>,
	cors: Record<string, string>,
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
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

// True if the inbound request was made over HTTPS. Determines whether we
// can set the Secure cookie attribute (browsers reject Secure cookies on
// non-HTTPS, including localhost dev).
export function isSecureRequest(request: Request): boolean {
	return new URL(request.url).protocol === "https:";
}

// Trusted client IP for rate-limit / blocklist paths. Returns null when
// the request didn't traverse Cloudflare's edge (CF-RAY absent), so
// per-IP buckets don't silently collapse onto a shared null/"unknown" key
// in a misconfigured topology. Rate-limit callers should fall back to
// global/per-user limits when this returns null and treat the warn line
// as a misconfiguration signal.
export function getClientIp(request: Request): string | null {
	if (!request.headers.get("CF-RAY")) {
		logWarn("cf_ray_missing");
		return null;
	}
	return request.headers.get("CF-Connecting-IP");
}

// base64url encoding of an ArrayBuffer or Uint8Array, no padding.
export function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

// Decompress gzipped data with a size limit to prevent gzip bombs. Used by
// both legacy /v1/share uploads and new /v1/games uploads.
export async function decompressWithLimit(
	compressed: ArrayBuffer,
	maxBytes: number,
): Promise<Uint8Array> {
	const ds = new DecompressionStream("gzip");
	const writer = ds.writable.getWriter();
	const reader = ds.readable.getReader();

	writer.write(compressed);
	writer.close();

	const chunks: Uint8Array[] = [];
	let totalSize = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalSize += value.byteLength;
		if (totalSize > maxBytes) {
			reader.cancel();
			throw new Error("Decompressed payload too large");
		}
		chunks.push(value);
	}

	const result = new Uint8Array(totalSize);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

// Hex-encoded SHA-256 of an ArrayBuffer. Used for the games dedup key
// (file_hash). Server-side authority — we never trust a client-supplied hash.
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", buffer);
	const bytes = new Uint8Array(digest);
	let hex = "";
	for (const b of bytes) hex += b.toString(16).padStart(2, "0");
	return hex;
}
