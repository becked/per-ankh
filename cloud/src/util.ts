// Shared helpers used across the cloud auth/games endpoints.

import * as v from "valibot";
import { logWarn, setErrorCode } from "./log";

export interface CommonEnv {
	ALLOWED_ORIGINS: string;
}

// Constant-time string comparison to prevent timing attacks on secret tokens.
// Used for OAuth state verification.
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

// The default response shape for every JSON endpoint — and, with it, the
// default *cache* posture for the whole API.
//
// `private, no-store` is here rather than at the call sites because omitting
// a `Cache-Control` is not an opt-out of caching: Workers Cache sits in front
// of the Worker (`[cache]` in cloud/wrangler.toml), and a `200` that says
// nothing gets RFC 9111 heuristic freshness — 7200 seconds. `Cookie` is not
// in the cache key and our session *is* a cookie, so a signed-in GET is
// indistinguishable from an anonymous one to that cache: a header-less
// response is a response shared between viewers. `GET /v1/auth/me` and
// `GET /v1/users/me/online-ids` return `discord_id` and `online_id` through
// here and say nothing about caching, which is the shape of the argument —
// the default has to be the safe one, and opting *in* the deliberate act.
//
// A route that wants to be shared declares it by building its own Response
// with a `public, …` directive, and says so in the ROUTES table — see
// `sharedCache` in cloud/src/index.ts and the guard in
// cloud/src/shared-cache-routes.test.ts.
export function jsonResponse(
	body: Record<string, unknown>,
	status: number,
	cors: Record<string, string>,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "private, no-store",
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

// Escape a user-supplied value for use inside a LIKE pattern.
//
// Binding a value as a parameter keeps it out of the SQL *text*, but LIKE
// reads `%` (any run) and `_` (one char) as wildcards inside the value
// itself — so an unescaped parameter is a pattern, not a literal, and a
// caller can turn a prefix search into a full-table sweep by typing `%`.
// Escape here and pair every use with `ESCAPE '\\'`, which is what opts the
// pattern into backslash-escaping; without the clause the backslashes are
// just characters and the wildcards stay live.
export function escapeLikeValue(value: string): string {
	return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// A timestamp column as an ISO instant, for a payload whose reader will parse
// it as a date.
//
// Every timestamp in this schema is written as D1's `datetime('now')` text
// ("YYYY-MM-DD HH:MM:SS", always UTC), and the `Date` parser reads that shape
// as LOCAL time — so a column sent raw arrives shifted by the reader's own
// offset, which within a day of midnight is the wrong date. Normalised in SQL
// rather than in TS so the stored format stays untouched (a mixed format in
// one column would break ordering on it) while what travels is the ISO
// instant the client date helpers document taking.
//
// The caller names the alias, as displayNameSql's callers do:
//   `SELECT ${isoInstantSql("created_at")} AS created_at …`
export function isoInstantSql(column: string): string {
	return `strftime('%Y-%m-%dT%H:%M:%SZ', ${column})`;
}

// True when `e` is D1 reporting a violated UNIQUE index on `qualified`
// (a `table.column`, e.g. "users.slug").
//
// Matching the message text is the only handle available: D1 surfaces the
// SQLite constraint failure as an Error with no structured code to switch
// on. Callers rely on this to turn the race-safe write — insert/update and
// let the index arbitrate — into a 409, so the qualified name has to be
// passed explicitly; a bare "UNIQUE constraint failed" check would also
// swallow a collision on some *other* index in the same statement and
// report it as the wrong conflict.
export function isUniqueViolation(e: unknown, qualified: string): boolean {
	const msg = e instanceof Error ? e.message : String(e);
	return msg.includes("UNIQUE constraint failed") && msg.includes(qualified);
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
//
// For a server-rendered page load this reads the visitor's address rather than
// the frontend Worker's, because `adoptTrustedFrontend` has already replaced
// CF-Connecting-IP on requests that proved they came from our SSR Worker. Call
// sites need no branch for it — see the block below for why.
//
// A trusted request skips the CF-RAY test rather than failing it. That test
// asks "did this reach us through the edge, or is someone calling the Worker
// directly and setting whatever address they like" — a question the shared key
// already answers, and answers better. Keeping the test would leave the whole
// of forwarding hostage to a header on Worker-to-Worker subrequests that we
// don't control and can't assert here.
export function getClientIp(request: Request): string | null {
	if (!isTrustedFrontend(request) && !request.headers.get("CF-RAY")) {
		logWarn("cf_ray_missing");
		return null;
	}
	return request.headers.get("CF-Connecting-IP");
}

// === Trusted frontend (SSR) requests ===
//
// per-ankh.app is server-rendered by our own Worker, and its subrequests to
// this API don't carry the visitor: SvelteKit's server-side fetch is a fresh
// request out of Cloudflare's egress, so CF-Connecting-IP on it is one address
// standing in for every SSR visitor at once (on 2026-08-05, every
// server-rendered request in production arrived from 2a06:98c0:3600::103).
// Every per-IP budget here — anon_read, the tournament budgets, uploads,
// downloads, search — was therefore counting the whole site into a single
// bucket for that traffic, which is how a crawl of /games/* spent the
// tournament pages' hourly allowance and 429'd them.
//
// The frontend Worker fixes the attribution at the source: it forwards the
// visitor's edge address and proves it is us with a shared key (`handleFetch`
// in src/hooks.server.ts). This is the only place that key is checked and the
// only place the forwarded address is believed — every reader downstream keeps
// calling getClientIp and gets the right answer.
//
// The address is *all* that's forwarded, deliberately. The visitor's
// User-Agent doesn't survive the hop either, and carrying it would switch on
// the scraper exemption in games.ts (isScraperUA) for site traffic — an
// exemption keyed on a string the caller picks, granted before both the gate
// and the audit INSERT. Anyone sending `User-Agent: Discordbot/2.0` to
// per-ankh.app would then be unmetered *and* absent from the `events` table
// the bucket query in docs/cloudflare-waf.md reads during an incident. The
// exemption has never applied to an unfurl in the first place — every unfurl
// arrives as a page fetch that this Worker only ever sees as an SSR
// subrequest, so isScraperUA has seen `null` for the whole SSR era and
// preview cards have worked regardless. With the address forwarded, a
// link-preview crawler is now metered against its own IP rather than pooled
// on the egress, which is strictly better than what it had.
//
// Both sides must have the key for any of it to take effect, so the two
// Workers can be deployed in either order: until both are set, forwarding is
// ignored and every counter behaves exactly as it did before.

// Presented by the caller.
export const SSR_KEY_HEADER = "X-SSR-Key";
export const SSR_CLIENT_IP_HEADER = "X-SSR-Client-IP";
// Our own verdict, never believed from the wire: adoptTrustedFrontend strips
// this off every inbound request and re-adds it only after the key checks out,
// so a handler reading it is reading this module's conclusion and not the
// caller's claim.
const SSR_TRUSTED_HEADER = "X-SSR-Trusted";

export interface TrustedFrontendEnv {
	// Shared key proving a request is our SSR Worker's subrequest. Set with
	// `wrangler secret put SSR_TRUSTED_KEY` on both Workers; unset disables
	// forwarding rather than failing anything.
	SSR_TRUSTED_KEY?: string;
}

// A forwarded address becomes a rate-limit bucket key and an `events` row, so
// it gets a shape check before either. Deliberately loose — IPv4, IPv6, and
// nothing else long enough to be a payload.
const FORWARDED_IP_RE = /^[0-9a-fA-F:.]{3,45}$/;

// Whether this isolate has already reported each of the two ways forwarding
// can be misconfigured — see the warns below for why one line is the whole
// signal, and why a second state needs a second flag rather than sharing one.
let rejectionLogged = false;
let missingIpLogged = false;

// Resolve the trust question once, at the top of `fetch`, and hand the rest of
// the Worker a request whose CF-Connecting-IP is the visitor's. Returns the
// request untouched when no SSR headers are in play (all browser traffic).
export function adoptTrustedFrontend(
	request: Request,
	env: TrustedFrontendEnv,
): Request {
	const presented = request.headers.get(SSR_KEY_HEADER);
	const forwarded = request.headers.get(SSR_CLIENT_IP_HEADER);
	const claimed = request.headers.get(SSR_TRUSTED_HEADER);
	if (presented === null && forwarded === null && claimed === null) {
		return request;
	}

	// A blank secret is an unset secret, and normalising it here is what keeps
	// every `key !== undefined` test below honest. Empty is how a secret gets
	// half-set — a `wrangler secret put` with nothing pasted, a `.dev.vars` line
	// left as `SSR_TRUSTED_KEY=` — and treating it as configured would make
	// timingSafeEqual("", "") true for anyone sending a bare `X-SSR-Key:`, so
	// the empty value that means "off" would instead trust the whole internet.
	// The frontend already reads it this way (`if (ssrKey)` in
	// src/hooks.server.ts); this is what makes the two sides agree on what
	// "configured" means.
	const configured = env.SSR_TRUSTED_KEY;
	const key = configured === "" ? undefined : configured;
	const trusted =
		key !== undefined && presented !== null && timingSafeEqual(key, presented);

	// Strip first, unconditionally: a request that arrives claiming to be
	// trusted must lose that claim before any handler can read it, whatever the
	// key check then decides.
	const headers = new Headers(request.headers);
	headers.delete(SSR_KEY_HEADER);
	headers.delete(SSR_CLIENT_IP_HEADER);
	headers.delete(SSR_TRUSTED_HEADER);

	if (trusted) {
		headers.set(SSR_TRUSTED_HEADER, "1");
		if (forwarded !== null && FORWARDED_IP_RE.test(forwarded)) {
			headers.set("CF-Connecting-IP", forwarded);
		} else if (!missingIpLogged) {
			// Keyed, but carrying no address we can use: CF-Connecting-IP stays
			// the SSR egress, so every server-rendered visitor pools into one
			// bucket again — the 2026-08-05 outage, and previously it arrived
			// with no line at all because the warn below only fires on a
			// mismatch. Only a holder of the key reaches this branch, so what
			// it reports is our own frontend, not a caller.
			missingIpLogged = true;
			logWarn("ssr_forward_no_client_ip");
		}
	} else if (key !== undefined && !rejectionLogged) {
		// A key is configured and this one didn't match: a botched rotation, or
		// someone probing the header. Worth a line either way.
		//
		// Once per isolate, not once per request: every header that reaches this
		// branch is caller-supplied, so a per-request line is a log-flood lever
		// for anyone who notices it — and it would bury the rotation case in
		// noise at the moment an operator is grepping for exactly that. What
		// this reports is a configuration state rather than an event, so the
		// first line says everything the thousandth would.
		//
		// No line when the key is unset — that's the feature switched off, and
		// it's also the window where the frontend has shipped forwarding and this
		// Worker hasn't yet, which is a supported deploy order and not an event.
		rejectionLogged = true;
		logWarn("ssr_forward_rejected");
	}

	// `cf` is carried across explicitly: the Request constructor does not
	// inherit it from the request being copied, and the rewrite above happens
	// for *any* caller that presents an SSR header — including a junk one. So
	// without this, `X-SSR-Key: anything` is a one-header way for a caller to
	// delete its own edge metadata (country, ASN, bot score) before a handler
	// can read it. Nothing downstream reads `request.cf` today — log.ts builds
	// its context from the inbound request, before this runs — which is exactly
	// why it has to be preserved now rather than after something starts.
	// Pinned by "preserves the edge cf metadata" in test/integration/
	// ssr-trust.test.ts.
	return new Request(request, { headers, cf: request.cf });
}

// Whether this request is our SSR Worker's subrequest, as decided above.
export function isTrustedFrontend(request: Request): boolean {
	return request.headers.get(SSR_TRUSTED_HEADER) === "1";
}

// Standard base64 of an ArrayBuffer or Uint8Array, padded — what a JSON API
// that takes bytes expects (the Clef call in screenshots/clef.ts embeds the
// image this way, since remote URLs aren't accepted).
export function base64Encode(buffer: ArrayBuffer | Uint8Array): string {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

// base64url encoding of an ArrayBuffer or Uint8Array, no padding.
export function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
	return base64Encode(buffer)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

// Decompress gzipped data with a size limit to prevent gzip bombs. Used by
// /v1/games uploads.
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
