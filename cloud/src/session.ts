// Session management. Sessions live in KV under `session:<token>` with a
// fixed 30-day TTL from creation. Reads do NOT bump expiration, so a user
// has to re-sign-in 30 days after their last login regardless of activity.
// The cookie carries the opaque token; nothing else is stored client-side.
//
// Keys:
//   session:<nanoid(32)>  → SessionData     (30-day TTL)
//   oauth:<nanoid(21)>    → OAuthPending   (5-min TTL, see auth.ts)

import { nanoid } from "nanoid";
import { setUserId } from "./log";
import { isSecureRequest, parseCookies } from "./util";

export interface SessionEnv {
	SESSIONS_KV: KVNamespace;
	// Session cookie name — a wrangler var ("session" in prod,
	// "session_staging" in staging), not a const. Both environments share
	// Domain=per-ankh.app (see sessionCookieDomain), so the NAME is the only
	// thing that keeps a staging login from clobbering the prod session in
	// the same browser.
	SESSION_COOKIE_NAME: string;
	// Optional Discord ID of the site admin. Set via `wrangler secret put
	// ADMIN_DISCORD_ID` in prod and `cloud/.dev.vars` locally. When unset,
	// isSiteAdmin returns false for everyone — admin endpoints are dark.
	ADMIN_DISCORD_ID?: string;
}

export interface SessionData {
	user_id: string;
	// Snapshot of the user's Discord username at login (lowercased).
	// Preserved on the session for future audit / debugging; no longer used
	// for an access check now that the closed-beta allowlist is lifted.
	discord_username: string;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function sessionKey(token: string): string {
	return `session:${token}`;
}

export async function createSession(
	env: SessionEnv,
	userId: string,
	discordUsername: string,
): Promise<string> {
	const token = nanoid(32);
	const data: SessionData = {
		user_id: userId,
		discord_username: discordUsername,
	};
	await env.SESSIONS_KV.put(sessionKey(token), JSON.stringify(data), {
		expirationTtl: SESSION_TTL_SECONDS,
	});
	return token;
}

export async function readSession(
	env: SessionEnv,
	token: string,
): Promise<SessionData | null> {
	const raw = await env.SESSIONS_KV.get(sessionKey(token));
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof (parsed as Record<string, unknown>).user_id === "string" &&
			typeof (parsed as Record<string, unknown>).discord_username === "string"
		) {
			return parsed as SessionData;
		}
		// Pre-username-allowlist sessions lack `discord_username`. Treating
		// them as missing forces a re-login, which is the right behavior
		// when the gate changes.
		return null;
	} catch {
		return null;
	}
}

export async function deleteSession(
	env: SessionEnv,
	token: string,
): Promise<void> {
	await env.SESSIONS_KV.delete(sessionKey(token));
}

// Read session token from cookie + look up in KV. Returns null if cookie
// missing or KV entry expired/missing. Caller turns null into 401.
//
// On success, also annotates the request-scoped log context with the
// resolved user_id so the access log + any subsequent event logs in the
// same request carry the user attribution. Single chokepoint — every
// authed handler benefits without touching its body.
export async function sessionFromRequest(
	env: SessionEnv,
	request: Request,
): Promise<{ token: string; data: SessionData } | null> {
	const cookies = parseCookies(request.headers.get("Cookie"));
	const token = cookies[env.SESSION_COOKIE_NAME];
	if (!token) return null;
	const data = await readSession(env, token);
	if (!data) return null;
	setUserId(data.user_id);
	return { token, data };
}

// Pick the cookie Domain attribute for the session cookie.
//
// In prod the API runs on api.per-ankh.app but the SSR frontend runs on
// per-ankh.app. Without an explicit Domain, the cookie is scoped to
// api.per-ankh.app only, which means the browser never sends it to
// per-ankh.app — so SSR loads of authenticated pages see no auth and
// have to redirect to /login on every hard refresh.
//
// Setting Domain=per-ankh.app shares the cookie across both subdomains.
// The SSR Worker can then read it on hard refresh and forward it to the
// API via the handleFetch hook in src/hooks.server.ts.
//
// Gate on HTTPS rather than the request URL's host: wrangler dev rewrites
// inbound localhost:8787 requests to look like they arrived at the
// production custom_domain (api.per-ankh.app, from wrangler.toml's
// `routes`), so request.url's host is unreliable as a dev/prod signal —
// it would silently apply Domain=per-ankh.app to a localhost response,
// which the browser rejects. Prod is always HTTPS; dev is HTTP.
//
// Staging uses this same domain — staging.per-ankh.app and
// api-staging.per-ankh.app are siblings, so per-ankh.app is their only
// shared ancestor. Both environments' cookies therefore travel to both
// API hosts; the per-env SESSION_COOKIE_NAME is what disambiguates.
function sessionCookieDomain(request: Request): string | null {
	if (!isSecureRequest(request)) return null;
	return "per-ankh.app";
}

// Build a Set-Cookie value for the session token. Secure flag conditional
// on the request being HTTPS so localhost dev (HTTP) works.
export function sessionCookie(
	env: SessionEnv,
	token: string,
	request: Request,
): string {
	const parts = [
		`${env.SESSION_COOKIE_NAME}=${token}`,
		"HttpOnly",
		"SameSite=Lax",
		"Path=/",
		`Max-Age=${SESSION_TTL_SECONDS}`,
	];
	const domain = sessionCookieDomain(request);
	if (domain) parts.push(`Domain=${domain}`);
	if (isSecureRequest(request)) parts.push("Secure");
	return parts.join("; ");
}

// Domain must match the original Set-Cookie or the browser treats this
// as a different cookie and won't clear the real one.
export function clearSessionCookie(env: SessionEnv, request: Request): string {
	const parts = [
		`${env.SESSION_COOKIE_NAME}=`,
		"HttpOnly",
		"SameSite=Lax",
		"Path=/",
		"Max-Age=0",
	];
	const domain = sessionCookieDomain(request);
	if (domain) parts.push(`Domain=${domain}`);
	if (isSecureRequest(request)) parts.push("Secure");
	return parts.join("; ");
}
