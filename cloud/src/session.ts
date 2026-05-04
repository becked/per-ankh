// Session management. Sessions live in KV under `session:<token>`, with a
// 30-day TTL that's refreshed on each successful read. The cookie carries
// the opaque token; nothing else is stored client-side.
//
// Keys:
//   session:<nanoid(32)>  → SessionData     (30-day TTL)
//   oauth:<nanoid(21)>    → OAuthPending   (5-min TTL, see auth.ts)

import { nanoid } from "nanoid";
import { isSecureRequest, parseCookies } from "./util";

export interface SessionEnv {
	SESSIONS_KV: KVNamespace;
}

export interface SessionData {
	user_id: string;
}

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function sessionKey(token: string): string {
	return `session:${token}`;
}

export async function createSession(env: SessionEnv, userId: string): Promise<string> {
	const token = nanoid(32);
	const data: SessionData = { user_id: userId };
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
			typeof (parsed as Record<string, unknown>).user_id === "string"
		) {
			return parsed as SessionData;
		}
		return null;
	} catch {
		return null;
	}
}

export async function deleteSession(env: SessionEnv, token: string): Promise<void> {
	await env.SESSIONS_KV.delete(sessionKey(token));
}

// Read session token from cookie + look up in KV. Returns null if cookie
// missing or KV entry expired/missing. Caller turns null into 401.
export async function sessionFromRequest(
	env: SessionEnv,
	request: Request,
): Promise<{ token: string; data: SessionData } | null> {
	const cookies = parseCookies(request.headers.get("Cookie"));
	const token = cookies[SESSION_COOKIE];
	if (!token) return null;
	const data = await readSession(env, token);
	if (!data) return null;
	return { token, data };
}

// Build a Set-Cookie value for the session token. Secure flag conditional
// on the request being HTTPS so localhost dev (HTTP) works.
export function sessionCookie(token: string, request: Request): string {
	const parts = [
		`${SESSION_COOKIE}=${token}`,
		"HttpOnly",
		"SameSite=Lax",
		"Path=/",
		`Max-Age=${SESSION_TTL_SECONDS}`,
	];
	if (isSecureRequest(request)) parts.push("Secure");
	return parts.join("; ");
}

export function clearSessionCookie(request: Request): string {
	const parts = [
		`${SESSION_COOKIE}=`,
		"HttpOnly",
		"SameSite=Lax",
		"Path=/",
		"Max-Age=0",
	];
	if (isSecureRequest(request)) parts.push("Secure");
	return parts.join("; ");
}
