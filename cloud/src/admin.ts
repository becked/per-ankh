// Site-admin gate. Single-admin model: a Discord ID stored in the
// ADMIN_DISCORD_ID wrangler secret. Handlers call isSiteAdmin at the top
// and return 404 (not 403) on failure to avoid leaking endpoint existence.

import type { SessionData } from "./session";
import type { QueryableD1 } from "./d1";
import { logWarn } from "./log";
import { timingSafeEqual } from "./util";

export interface AdminAuthEnv {
	SHARE_DB: QueryableD1;
	ADMIN_DISCORD_ID?: string;
}

export async function isSiteAdmin(
	env: AdminAuthEnv,
	session: { data: SessionData } | null,
): Promise<boolean> {
	if (!session) return false;
	if (!env.ADMIN_DISCORD_ID) return false;
	const row = await env.SHARE_DB.prepare(
		"SELECT discord_id FROM users WHERE user_id = ?",
	)
		.bind(session.data.user_id)
		.first<{ discord_id: string }>();
	return row?.discord_id === env.ADMIN_DISCORD_ID;
}

// ---------- Headless admin (the CLI's credential) ----------
//
// The admin surface is otherwise session-only, which makes every admin sweep a
// browser tab. `./per-ankh admin reparse-all` is the first sweep that runs
// headless — it parses saves under tsx and needs the Worker to do the writes
// — and the CLI has no session: it authenticates to Cloudflare, not to the
// app. So one bearer token, scoped to the one endpoint that sweep posts to
// (POST /v1/admin/games/:user_id/reparse-upload). Every other /v1/admin/*
// handler stays session-only; a token that opens the whole admin surface
// would be a standing credential for reads and deletes nothing asks for.
//
// Unset means off, exactly as ADMIN_DISCORD_ID does: the endpoint is then
// reachable only by a logged-in admin, which is the state before this existed.
export const ADMIN_CLI_TOKEN_SCHEME = "Bearer ";

export interface AdminCliAuthEnv extends AdminAuthEnv {
	// Shared secret proving a request is the operator's CLI. Set with
	// `wrangler secret put ADMIN_CLI_TOKEN` per environment; unset disables
	// the token path rather than failing anything.
	ADMIN_CLI_TOKEN?: string;
}

// Whether this isolate has already reported a presented-but-wrong token. Once
// per isolate, not once per request: the header is caller-supplied, so a
// per-request line is a log-flood lever, and what this reports is a
// configuration state (a half-landed rotation) rather than an event — the
// first line says everything the thousandth would. The same reasoning, and
// the same flag shape, as `rejectionLogged` in util.ts.
let cliTokenRejectionLogged = false;

/**
 * The site admin's `user_id` when the request carries the CLI token, else
 * null. Resolved from ADMIN_DISCORD_ID rather than carried in the token, so
 * the audit row a token sweep writes names the same principal a browser sweep
 * would (`acting_user_id`) and joins to `users` the same way.
 *
 * Null covers every failure identically — no header, token unset, wrong token,
 * admin never logged in — because the caller turns all of them into the same
 * 404. A wrong token therefore tees to Skiff as `admin_probe` (status 404
 * under /v1/admin/*, see security-events.ts) with nothing extra to wire.
 */
export async function siteAdminFromCliToken(
	env: AdminCliAuthEnv,
	request: Request,
): Promise<string | null> {
	const header = request.headers.get("Authorization");
	if (header === null || !header.startsWith(ADMIN_CLI_TOKEN_SCHEME)) {
		return null;
	}
	// A blank secret is an unset secret. Empty is how a secret gets half-set —
	// a `wrangler secret put` with nothing pasted, a `.dev.vars` line left as
	// `ADMIN_CLI_TOKEN=` — and treating it as configured would make
	// timingSafeEqual("", "") true for anyone sending a bare `Bearer `, so the
	// value that means "off" would instead admit the whole internet.
	const configured = env.ADMIN_CLI_TOKEN;
	if (configured === undefined || configured === "") return null;
	if (!env.ADMIN_DISCORD_ID) return null;

	const presented = header.slice(ADMIN_CLI_TOKEN_SCHEME.length);
	if (!timingSafeEqual(configured, presented)) {
		if (!cliTokenRejectionLogged) {
			cliTokenRejectionLogged = true;
			logWarn("admin_cli_token_rejected");
		}
		return null;
	}

	const row = await env.SHARE_DB.prepare(
		"SELECT user_id FROM users WHERE discord_id = ?",
	)
		.bind(env.ADMIN_DISCORD_ID)
		.first<{ user_id: string }>();
	// A correct token with no admin row is a real deployment state: the secret
	// is set but that Discord account has never signed in, so there is no
	// user_id to audit the writes as. Refuse rather than invent one — every
	// write this authorizes runs *as* a target user and is only traceable
	// through `acting_user_id`.
	if (!row) {
		logWarn("admin_cli_token_no_admin_user");
		return null;
	}
	return row.user_id;
}
