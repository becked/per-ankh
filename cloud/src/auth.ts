// Discord OAuth 2.0 (authorization code + PKCE) + session lifecycle.
//
// Flow (spec §5):
//   POST /v1/auth/discord/start
//     Worker generates state + PKCE verifier, stores under `oauth:<key>` in
//     KV (5min TTL), returns authorize_url + sets oauth_pending cookie.
//
//   POST /v1/auth/discord/callback
//     SvelteKit page passes back code + state. Worker validates state
//     matches the KV entry referenced by the cookie (single-use), exchanges
//     code for token, fetches user, upserts D1 user row, creates session.
//
//   GET  /v1/auth/me        → return current user info (401 if no session)
//   POST /v1/auth/logout    → delete session + clear cookie

import { nanoid } from "nanoid";
import {
	base64UrlEncode,
	cloudCorsHeaders,
	errorResponse,
	jsonResponse,
	parseCookies,
	timingSafeEqual,
} from "./util";
import {
	clearSessionCookie,
	createSession,
	deleteSession,
	sessionCookie,
	sessionFromRequest,
} from "./session";
import type { SessionEnv } from "./session";

export interface AuthEnv extends SessionEnv {
	SHARE_DB: D1Database;
	ALLOWED_ORIGINS: string;
	DISCORD_CLIENT_ID: string;
	DISCORD_CLIENT_SECRET: string;
}

const DISCORD_AUTHORIZE_URL = "https://discord.com/api/oauth2/authorize";
const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_USER_URL = "https://discord.com/api/users/@me";
const OAUTH_SCOPE = "identify email"; // identify = profile, email = user email
const OAUTH_PENDING_COOKIE = "oauth_pending";
const OAUTH_PENDING_TTL_SECONDS = 300; // 5 minutes

interface OAuthPending {
	state: string;
	code_verifier: string;
	redirect_uri: string;
	// Internal post-login redirect target (e.g. "/games/abc"). Always a
	// same-origin path; validated by safeNext before storage.
	next: string;
}

const DEFAULT_NEXT = "/dashboard";

// Server-side mirror of src/lib/utils/safe-next.ts. Anything that isn't a
// relative same-origin path collapses to /dashboard, neutralizing
// open-redirect attempts via `?next=...`.
function safeNext(raw: unknown): string {
	if (typeof raw !== "string" || !raw) return DEFAULT_NEXT;
	let decoded: string;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return DEFAULT_NEXT;
	}
	if (!decoded.startsWith("/")) return DEFAULT_NEXT;
	if (decoded.startsWith("//")) return DEFAULT_NEXT;
	if (decoded.includes("\\")) return DEFAULT_NEXT;
	return decoded;
}

interface DiscordTokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token?: string;
	scope: string;
}

interface DiscordUser {
	id: string;
	username: string;
	global_name: string | null;
	avatar: string | null;
	email?: string | null;
	verified?: boolean;
}

interface UserRow {
	user_id: string;
	discord_id: string;
	display_name: string;
	avatar_hash: string | null;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function oauthKey(id: string): string {
	return `oauth:${id}`;
}

// Build the public avatar URL from the stored hash. Default avatar
// (animated_id >> 22) % 6 used when the user has no custom avatar.
// Spec §5 step 12.
function buildAvatarUrl(discordId: string, avatarHash: string | null): string {
	if (avatarHash) {
		const ext = avatarHash.startsWith("a_") ? "gif" : "png";
		return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.${ext}`;
	}
	// Default avatar uses (snowflake >> 22) % 6 in the "new username system"
	// (post-2023). Pre-2023 used discriminator % 5; we follow current docs.
	const idBig = BigInt(discordId);
	const index = Number((idBig >> 22n) % 6n);
	return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

// Generate a PKCE pair: a high-entropy random verifier and its
// SHA-256 challenge, both base64url with no padding (RFC 7636).
async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
	const verifierBytes = new Uint8Array(32);
	crypto.getRandomValues(verifierBytes);
	const verifier = base64UrlEncode(verifierBytes);
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	const challenge = base64UrlEncode(digest);
	return { verifier, challenge };
}

function generateState(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return base64UrlEncode(bytes);
}

function readJsonBody<T>(request: Request): Promise<T> {
	return request.json() as Promise<T>;
}

// ------------------------------------------------------------------
// Handlers
// ------------------------------------------------------------------

export async function handleDiscordStart(
	request: Request,
	env: AuthEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	let body: { redirect_uri?: string; next?: string };
	try {
		body = await readJsonBody<{ redirect_uri?: string; next?: string }>(request);
	} catch {
		return errorResponse("Invalid JSON body", 400, cors, "INVALID_BODY");
	}

	const redirectUri = body.redirect_uri;
	if (!redirectUri || typeof redirectUri !== "string") {
		return errorResponse("redirect_uri required", 400, cors, "MISSING_REDIRECT_URI");
	}
	const next = safeNext(body.next);

	const state = generateState();
	const { verifier, challenge } = await generatePkce();
	const kvId = nanoid(21);

	const pending: OAuthPending = {
		state,
		code_verifier: verifier,
		redirect_uri: redirectUri,
		next,
	};
	await env.SESSIONS_KV.put(oauthKey(kvId), JSON.stringify(pending), {
		expirationTtl: OAUTH_PENDING_TTL_SECONDS,
	});

	const authorizeUrl = new URL(DISCORD_AUTHORIZE_URL);
	authorizeUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
	authorizeUrl.searchParams.set("redirect_uri", redirectUri);
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set("scope", OAUTH_SCOPE);
	authorizeUrl.searchParams.set("state", state);
	authorizeUrl.searchParams.set("code_challenge", challenge);
	authorizeUrl.searchParams.set("code_challenge_method", "S256");
	// prompt=none would skip the consent screen on returning users; we keep
	// the default behavior so the first authorization is explicit.

	const isHttps = new URL(request.url).protocol === "https:";
	const cookieParts = [
		`${OAUTH_PENDING_COOKIE}=${kvId}`,
		"HttpOnly",
		"SameSite=Lax",
		"Path=/",
		`Max-Age=${OAUTH_PENDING_TTL_SECONDS}`,
	];
	if (isHttps) cookieParts.push("Secure");

	return new Response(JSON.stringify({ authorize_url: authorizeUrl.toString() }), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Set-Cookie": cookieParts.join("; "),
			...cors,
		},
	});
}

export async function handleDiscordCallback(
	request: Request,
	env: AuthEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	let body: { code?: string; state?: string; redirect_uri?: string };
	try {
		body = await readJsonBody(request);
	} catch {
		return errorResponse("Invalid JSON body", 400, cors, "INVALID_BODY");
	}

	const { code, state, redirect_uri: redirectUri } = body;
	if (!code || !state || !redirectUri) {
		return errorResponse(
			"code, state, and redirect_uri required",
			400,
			cors,
			"MISSING_FIELDS",
		);
	}

	const cookies = parseCookies(request.headers.get("Cookie"));
	const pendingId = cookies[OAUTH_PENDING_COOKIE];
	if (!pendingId) {
		return errorResponse(
			"Missing oauth_pending cookie",
			400,
			cors,
			"MISSING_PENDING",
		);
	}

	// Read + delete the pending entry (single-use) regardless of validation
	// outcome, so a leaked code can't be reused. KV has no atomic
	// compare-and-delete, so two parallel callbacks with the same
	// oauth_pending cookie can both pass state validation here; the race
	// is gated downstream by Discord rejecting the second `code` exchange
	// (Discord enforces single-use authorization codes), so at most one
	// session is ever issued. If we ever swap auth providers, revisit.
	const pendingRaw = await env.SESSIONS_KV.get(oauthKey(pendingId));
	await env.SESSIONS_KV.delete(oauthKey(pendingId));
	if (!pendingRaw) {
		return errorResponse(
			"Pending OAuth state expired or unknown",
			400,
			cors,
			"PENDING_NOT_FOUND",
		);
	}
	let pending: OAuthPending;
	try {
		pending = JSON.parse(pendingRaw) as OAuthPending;
	} catch {
		return errorResponse("Corrupt pending state", 500, cors, "CORRUPT_PENDING");
	}

	if (!timingSafeEqual(pending.state, state)) {
		return errorResponse("State mismatch", 400, cors, "STATE_MISMATCH");
	}
	if (pending.redirect_uri !== redirectUri) {
		return errorResponse(
			"redirect_uri mismatch",
			400,
			cors,
			"REDIRECT_URI_MISMATCH",
		);
	}

	// Exchange code for access token.
	const tokenForm = new URLSearchParams();
	tokenForm.set("grant_type", "authorization_code");
	tokenForm.set("code", code);
	tokenForm.set("redirect_uri", redirectUri);
	tokenForm.set("client_id", env.DISCORD_CLIENT_ID);
	tokenForm.set("client_secret", env.DISCORD_CLIENT_SECRET);
	tokenForm.set("code_verifier", pending.code_verifier);

	const tokenRes = await fetch(DISCORD_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: tokenForm.toString(),
	});
	if (!tokenRes.ok) {
		const detail = await tokenRes.text().catch(() => "");
		console.error(`Discord token exchange failed (${tokenRes.status}): ${detail}`);
		return errorResponse(
			"Discord token exchange failed",
			502,
			cors,
			"TOKEN_EXCHANGE_FAILED",
		);
	}
	const tokenData = (await tokenRes.json()) as DiscordTokenResponse;
	if (!tokenData.access_token) {
		return errorResponse(
			"Discord did not return access_token",
			502,
			cors,
			"NO_ACCESS_TOKEN",
		);
	}

	// Fetch user profile.
	const userRes = await fetch(DISCORD_USER_URL, {
		headers: { Authorization: `Bearer ${tokenData.access_token}` },
	});
	if (!userRes.ok) {
		const detail = await userRes.text().catch(() => "");
		console.error(`Discord user fetch failed (${userRes.status}): ${detail}`);
		return errorResponse("Discord user fetch failed", 502, cors, "USER_FETCH_FAILED");
	}
	const discordUser = (await userRes.json()) as DiscordUser;
	if (!discordUser.id) {
		return errorResponse("Discord returned no user id", 502, cors, "NO_USER_ID");
	}

	const displayName = discordUser.global_name ?? discordUser.username;
	const email = discordUser.email ?? null;
	const emailVerified = discordUser.verified ?? null;

	// Upsert user. ON CONFLICT keyed on discord_id (UNIQUE).
	// New rows get a fresh nanoid; existing rows keep theirs.
	const newUserId = nanoid(21);
	const upsert = await env.SHARE_DB.prepare(
		`INSERT INTO users (user_id, discord_id, display_name, avatar_hash, email, email_verified, last_login_at)
		 VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(discord_id) DO UPDATE SET
		   display_name = excluded.display_name,
		   avatar_hash = excluded.avatar_hash,
		   email = excluded.email,
		   email_verified = excluded.email_verified,
		   last_login_at = datetime('now')
		 RETURNING user_id, discord_id, display_name, avatar_hash`,
	)
		.bind(
			newUserId,
			discordUser.id,
			displayName,
			discordUser.avatar,
			email,
			emailVerified === null ? null : emailVerified ? 1 : 0,
		)
		.first<UserRow>();

	if (!upsert) {
		return errorResponse("User upsert returned no row", 500, cors, "UPSERT_FAILED");
	}

	const sessionToken = await createSession(env, upsert.user_id);

	const headers = new Headers({
		"Content-Type": "application/json",
		...cors,
	});
	headers.append("Set-Cookie", sessionCookie(sessionToken, request));
	// Also clear the now-consumed pending cookie.
	const isHttps = new URL(request.url).protocol === "https:";
	const clearPending = [
		`${OAUTH_PENDING_COOKIE}=`,
		"HttpOnly",
		"SameSite=Lax",
		"Path=/",
		"Max-Age=0",
	];
	if (isHttps) clearPending.push("Secure");
	headers.append("Set-Cookie", clearPending.join("; "));

	// `next` is server-validated; the frontend can goto it directly. Re-run
	// safeNext as belt-and-suspenders in case an older OAuthPending shape
	// from before this field was introduced lacks it.
	const postLoginNext = safeNext(pending.next);

	return new Response(
		JSON.stringify({
			user_id: upsert.user_id,
			discord_id: upsert.discord_id,
			display_name: upsert.display_name,
			avatar_url: buildAvatarUrl(upsert.discord_id, upsert.avatar_hash),
			next: postLoginNext,
		}),
		{ status: 200, headers },
	);
}

export async function handleMe(request: Request, env: AuthEnv): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) {
		return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	}

	const row = await env.SHARE_DB.prepare(
		"SELECT user_id, discord_id, display_name, avatar_hash FROM users WHERE user_id = ?",
	)
		.bind(session.data.user_id)
		.first<UserRow>();

	if (!row) {
		// Session points at a deleted user — clean up and 401.
		await deleteSession(env, session.token);
		return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	}

	return jsonResponse(
		{
			user_id: row.user_id,
			discord_id: row.discord_id,
			display_name: row.display_name,
			avatar_url: buildAvatarUrl(row.discord_id, row.avatar_hash),
		},
		200,
		cors,
	);
}

export async function handleLogout(request: Request, env: AuthEnv): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (session) {
		await deleteSession(env, session.token);
	}

	return new Response(null, {
		status: 204,
		headers: {
			"Set-Cookie": clearSessionCookie(request),
			...cors,
		},
	});
}
