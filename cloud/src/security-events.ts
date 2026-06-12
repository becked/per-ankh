// Security-event tee for Skiff (issue #71).
//
// Skiff is external, read-only triage tooling that drains one D1 row per
// security-relevant request over the D1 REST API, cursoring on the AUTOINCREMENT
// `id`. We emit matched ROUTE PATTERNS only (never raw paths); mapping patterns
// to anything else happens on Skiff's side.
//
// The tee hangs off the fetch envelope right after emitAccessLog (index.ts),
// reading the request-scoped log context for route/request_id. It writes to a
// DEDICATED D1 (SECURITY_DB), not SHARE_DB, so a probe flood can't contend with
// live app queries on D1's single-threaded-per-database engine. The write is
// deferred via ctx.waitUntil and fully wrapped: a throw here can never alter or
// fail the response.

import { getLogContext, logError } from "./log";

export interface SecurityEventsEnv {
	SECURITY_DB: D1Database;
}

// The classification vocabulary. Skiff doesn't key on specific values (the
// reason rides through as data), but the set is fixed so a typo surfaces in
// review. Order here is documentation only — precedence lives in
// resolveSecurityEvent.
export const SECURITY_REASONS = [
	"signup", // new account created — handler-set (setSecurityReason), not derivable here
	"dev_login_probe", // any request to /v1/auth/dev/login
	"legacy_share_write", // POST /v1/share, any status
	"rate_limited", // status 429
	"server_error", // status 5xx
	"admin_probe", // status 404 under /v1/admin/*
	"auth_fail", // status 401 or 403
] as const;

export type SecurityReason = (typeof SECURITY_REASONS)[number];

function isSecurityReason(value: string): value is SecurityReason {
	return (SECURITY_REASONS as readonly string[]).includes(value);
}

// The subset of the log context resolveSecurityEvent needs, lifted to a plain
// struct so the function stays pure (no AsyncLocalStorage) and unit-testable.
export interface SecurityEventInput {
	method: string;
	path: string;
	route: string | null;
	securityReason: string | null;
}

export interface ResolvedSecurityEvent {
	reason: SecurityReason;
	// Always a pattern, never a raw path.
	route: string;
	// Truncated raw path, only when we had to synthesize a pattern (unmatched
	// probe) — null otherwise. Goes into meta.raw_path for triage.
	rawPath: string | null;
}

const RAW_PATH_MAX = 128;

// Coarse pattern for an unmatched probe (ctx.route is null). We never store the
// raw path in `route`; the exact probed path travels in meta.raw_path instead.
function synthPattern(reason: SecurityReason, method: string): string {
	switch (reason) {
		case "admin_probe":
			return `${method} /v1/admin/*`;
		case "dev_login_probe":
			return `${method} /v1/auth/dev/login`;
		default:
			// auth_fail / server_error / rate_limited normally come from matched
			// handlers (route set), so this is a defensive fallback only.
			return `${method} <unmatched>`;
	}
}

function build(
	reason: SecurityReason,
	input: SecurityEventInput,
): ResolvedSecurityEvent {
	if (input.route) {
		return { reason, route: input.route, rawPath: null };
	}
	return {
		reason,
		route: synthPattern(reason, input.method),
		rawPath: input.path.slice(0, RAW_PATH_MAX),
	};
}

// Classify a finished request. Returns null for requests that aren't security-
// relevant (no row emitted). One reason per request — precedence is:
//
//   1. handler-set reason (signup) — can't be inferred from status+route
//   2. route-scoped, "any status" (dev_login_probe, legacy_share_write)
//   3. status-scoped (rate_limited 429, server_error 5xx, admin_probe 404,
//      auth_fail 401/403) — mutually exclusive by status code
//
// Route-scoped must precede status-scoped so a 429/403/5xx on those routes is
// attributed to the route, not the status (Skiff carries `status` separately,
// so a blocklist 403 on /v1/share still reads as 403/legacy_share_write).
export function resolveSecurityEvent(
	input: SecurityEventInput,
	status: number,
): ResolvedSecurityEvent | null {
	const { method, path, securityReason } = input;

	if (securityReason && isSecurityReason(securityReason)) {
		return build(securityReason, input);
	}

	if (path === "/v1/auth/dev/login") return build("dev_login_probe", input);
	if (method === "POST" && path === "/v1/share") {
		return build("legacy_share_write", input);
	}

	if (status === 429) return build("rate_limited", input);
	if (status >= 500) return build("server_error", input);
	if (status === 404 && path.startsWith("/v1/admin/")) {
		return build("admin_probe", input);
	}
	if (status === 401 || status === 403) return build("auth_fail", input);

	return null;
}

async function insertSecurityEvent(
	db: D1Database,
	row: {
		ts: string;
		route: string;
		status: number;
		reason: string;
		actorIp: string | null;
		requestId: string;
		meta: string | null;
	},
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO security_events (ts, route, status, reason, actor_ip, request_id, meta)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			row.ts,
			row.route,
			row.status,
			row.reason,
			row.actorIp,
			row.requestId,
			row.meta,
		)
		.run();
}

// Emit a security_events row for the just-finished request, if it matches the
// vocabulary. Called from the fetch envelope after emitAccessLog. Never throws,
// never blocks: the synchronous classification is wrapped in try/catch and the
// D1 write is deferred via ctx.waitUntil with its own .catch. A failure here
// (including a missing table or unavailable DB) is logged and dropped — the
// response is already built and unaffected.
export function emitSecurityEvent(
	request: Request,
	response: Response,
	env: SecurityEventsEnv,
	ctx: ExecutionContext,
): void {
	try {
		const log = getLogContext();
		if (!log) return;

		const resolved = resolveSecurityEvent(
			{
				method: log.method,
				path: log.path,
				route: log.route,
				securityReason: log.security_reason,
			},
			response.status,
		);
		if (!resolved) return;

		// Trust CF-Connecting-IP only when the request traversed the edge
		// (CF-RAY present) — mirrors getClientIp's distrust rule, but without its
		// duplicate cf_ray_missing warn since the access log already emitted one.
		const actorIp = log.cf_ray ? request.headers.get("CF-Connecting-IP") : null;

		const meta = resolved.rawPath
			? JSON.stringify({ raw_path: resolved.rawPath })
			: null;

		ctx.waitUntil(
			insertSecurityEvent(env.SECURITY_DB, {
				ts: new Date().toISOString(),
				route: resolved.route,
				status: response.status,
				reason: resolved.reason,
				actorIp,
				requestId: log.request_id,
				meta,
			}).catch((err) =>
				logError("security_event_emit_failed", err, {
					reason: resolved.reason,
				}),
			),
		);
	} catch (err) {
		// The tee must never affect the response. Swallow everything.
		logError("security_event_tee_error", err);
	}
}
