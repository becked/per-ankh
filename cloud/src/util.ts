// Shared helpers used by both legacy share endpoints and the new cloud
// auth/games endpoints.

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
export function parseCookies(headerValue: string | null): Record<string, string> {
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
export function legacyCorsHeaders(env: Pick<CommonEnv, "ALLOWED_ORIGIN">): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
		"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, X-App-Key, X-Delete-Token",
		"Access-Control-Max-Age": "86400",
	};
}

// CORS for new /v1/auth/* and (future) /v1/games/* routes.
// Echoes the request Origin if it's in ALLOWED_ORIGINS so credentialed
// requests work. Returns null Access-Control-Allow-Origin if the origin
// isn't allowed (the browser will then block the response).
export function cloudCorsHeaders(
	env: Pick<CommonEnv, "ALLOWED_ORIGINS">,
	request: Request,
): Record<string, string> {
	const origin = request.headers.get("Origin");
	const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
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
): Response {
	const body: Record<string, unknown> = { error: message };
	if (code) body.code = code;
	return jsonResponse(body, status, cors);
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
		console.warn("getClientIp: CF-RAY missing — request not via CF edge");
		return null;
	}
	return request.headers.get("CF-Connecting-IP");
}

// base64url encoding of an ArrayBuffer or Uint8Array, no padding.
export function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
