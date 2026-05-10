// Structured JSON logging primitive for the API Worker.
//
// All output is emitted as one JSON object per console.log line so Logpush
// can ship it to a sink unchanged once a destination is wired in Phase D
// (see docs/cloud-productionization-plan.md §7). Two log shapes:
//
//   - Access log (type=access). One per request, emitted by the fetch
//     envelope after dispatch returns. Fields: ts, level, request_id,
//     cf_ray, method, route, path, status, duration_ms, user_id,
//     error_code, error_class + handler-attached fields via setLogField.
//
//   - Event log (type=event). Emitted mid-handler by logError / logWarn /
//     logEvent. Correlated to the access log via request_id.
//
// Request-scoped state flows via AsyncLocalStorage (gated by the
// nodejs_als compatibility flag in cloud/wrangler.toml). Handlers don't
// take a context argument; they call setRoute / setUserId / setLogField
// from anywhere in the call frame.
//
// PII deny-list: any field key in PII_KEYS is replaced with "[REDACTED]"
// before stringify, and the line gets pii_redaction: true. Discord IDs and
// platform OnlineIDs are PII per the cutover plan; the deny-list is the
// last line of defense. Handlers shouldn't be putting PII in fields in
// the first place.

// AsyncLocalStorage from node:async_hooks. @cloudflare/workers-types
// doesn't ship Node module declarations, so we declare just the surface
// we use in cloud/src/types/node-async-hooks.d.ts rather than pulling in
// @types/node and risking globals collisions.
import { AsyncLocalStorage } from "node:async_hooks";

export const PII_KEYS = new Set([
	"online_id",
	"discord_id",
	"username",
	"email",
	"access_token",
	"code_verifier",
	"session_token",
	"app_key",
	"body",
]);

export type LogLevel = "info" | "warn" | "error";

export interface LogContext {
	request_id: string;
	cf_ray: string | null;
	method: string;
	path: string;
	route: string | null;
	user_id: string | null;
	error_code: string | null;
	started_at: number;
	fields: Record<string, unknown>;
}

const als = new AsyncLocalStorage<LogContext>();

function newContext(request: Request): LogContext {
	const url = new URL(request.url);
	return {
		request_id: crypto.randomUUID(),
		cf_ray: request.headers.get("CF-RAY"),
		method: request.method,
		path: url.pathname,
		route: null,
		user_id: null,
		error_code: null,
		started_at: performance.now(),
		fields: {},
	};
}

export function runWithLogContext<T>(
	request: Request,
	fn: () => Promise<T>,
): Promise<T> {
	return als.run(newContext(request), fn);
}

export function getLogContext(): LogContext | undefined {
	return als.getStore();
}

export function getRequestId(): string | null {
	return als.getStore()?.request_id ?? null;
}

export function setRoute(route: string): void {
	const ctx = als.getStore();
	if (ctx) ctx.route = route;
}

export function setUserId(userId: string): void {
	const ctx = als.getStore();
	if (ctx) ctx.user_id = userId;
}

export function setErrorCode(code: string): void {
	const ctx = als.getStore();
	if (ctx) ctx.error_code = code;
}

export function setLogField(key: string, value: unknown): void {
	const ctx = als.getStore();
	if (ctx) ctx.fields[key] = value;
}

// Shallow-clone fields, replacing any deny-listed key whose value isn't
// already null/undefined with "[REDACTED]". Returns a flag the emitter
// uses to mark the line.
function scrubPii(fields: Record<string, unknown>): {
	scrubbed: Record<string, unknown>;
	redacted: boolean;
} {
	let redacted = false;
	const scrubbed: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(fields)) {
		if (PII_KEYS.has(k) && v !== null && v !== undefined) {
			scrubbed[k] = "[REDACTED]";
			redacted = true;
		} else {
			scrubbed[k] = v;
		}
	}
	return { scrubbed, redacted };
}

function emit(line: Record<string, unknown>): void {
	// Errors that snuck into fields serialize to {} by default — coerce to
	// { name, message } so the log line carries something useful.
	console.log(
		JSON.stringify(line, (_, v) =>
			v instanceof Error ? { name: v.name, message: v.message } : v,
		),
	);
}

export function logEvent(
	level: LogLevel,
	event: string,
	fields?: Record<string, unknown>,
): void {
	const ctx = als.getStore();
	const { scrubbed, redacted } = scrubPii(fields ?? {});
	emit({
		ts: new Date().toISOString(),
		level,
		type: "event",
		event,
		request_id: ctx?.request_id ?? null,
		user_id: ctx?.user_id ?? null,
		...(redacted ? { pii_redaction: true } : {}),
		...scrubbed,
	});
}

export function logWarn(event: string, fields?: Record<string, unknown>): void {
	logEvent("warn", event, fields);
}

export function logError(
	event: string,
	err: unknown,
	fields?: Record<string, unknown>,
): void {
	const errFields: Record<string, unknown> = { ...(fields ?? {}) };
	if (err !== null && err !== undefined) {
		if (err instanceof Error) {
			errFields.error_class = err.name;
			errFields.error_message = err.message;
		} else {
			errFields.error_class = "UnknownError";
			errFields.error_message = String(err);
		}
	}
	logEvent("error", event, errFields);
}

// Emit the access log line for the just-completed request. Called by the
// fetch envelope after dispatch returns (or after the safety-net 500).
export function emitAccessLog(response: Response): void {
	const ctx = als.getStore();
	if (!ctx) return;
	const status = response.status;
	const level: LogLevel =
		status >= 500 ? "error" : status >= 400 ? "warn" : "info";
	const { scrubbed, redacted } = scrubPii(ctx.fields);
	emit({
		ts: new Date().toISOString(),
		level,
		type: "access",
		request_id: ctx.request_id,
		cf_ray: ctx.cf_ray,
		method: ctx.method,
		route: ctx.route,
		path: ctx.path,
		status,
		duration_ms: Math.round(performance.now() - ctx.started_at),
		user_id: ctx.user_id,
		error_code: ctx.error_code,
		...(redacted ? { pii_redaction: true } : {}),
		...scrubbed,
	});
}
