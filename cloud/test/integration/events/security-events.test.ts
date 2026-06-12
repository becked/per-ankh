// Integration tests for the Skiff security_events tee (issue #71). Two angles:
//
//  - DB content (each reason → one row, patterns, meta, actor_ip, id-ordering):
//    driven by calling emitSecurityEvent directly with the REAL SECURITY_DB and
//    awaiting the ctx.waitUntil task, so assertions are deterministic rather
//    than racing the post-response write. setRoute mimics what dispatch() does.
//
//  - Wiring + isolation: a real SELF.fetch proves the fetch envelope invokes the
//    tee, and a throwing fake env proves a tee failure never touches the
//    response.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
	emitSecurityEvent,
	type SecurityEventsEnv,
} from "../../../src/security-events";
import {
	runWithLogContext,
	setRoute,
	setSecurityReason,
} from "../../../src/log";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	await applyD1Migrations(env.SECURITY_DB, env.TEST_SECURITY_MIGRATIONS);
});

interface SecRow {
	id: number;
	route: string;
	status: number;
	reason: string;
	actor_ip: string | null;
	request_id: string;
	meta: string | null;
}

async function allRows(): Promise<SecRow[]> {
	const r = await env.SECURITY_DB.prepare(
		`SELECT id, route, status, reason, actor_ip, request_id, meta
		 FROM security_events ORDER BY id`,
	).all<SecRow>();
	return r.results;
}

// Drive the tee with the real SECURITY_DB and await the deferred write, so the
// row is committed by the time the helper returns.
async function emitAndFlush(opts: {
	method: string;
	path: string;
	status: number;
	route?: string | null; // matched route, or omit/null for an unmatched probe
	securityReason?: string; // handler-set, e.g. "signup"
	cfRay?: boolean; // request traversed the edge
	ip?: string;
}): Promise<void> {
	const headers: Record<string, string> = {};
	if (opts.cfRay) headers["CF-RAY"] = "test-ray";
	if (opts.ip) headers["CF-Connecting-IP"] = opts.ip;
	const req = new Request(`http://test${opts.path}`, {
		method: opts.method,
		headers,
	});
	const res = new Response(null, { status: opts.status });
	const tasks: Promise<unknown>[] = [];
	const ctx = {
		waitUntil(p: Promise<unknown>) {
			tasks.push(p);
		},
	} as unknown as ExecutionContext;
	await runWithLogContext(req, async () => {
		if (opts.route) setRoute(opts.route);
		if (opts.securityReason) setSecurityReason(opts.securityReason);
		emitSecurityEvent(req, res, env, ctx);
	});
	await Promise.all(tasks);
}

// Emit one event and return the row it wrote, asserting exactly one was added.
async function emitOne(
	opts: Parameters<typeof emitAndFlush>[0],
): Promise<SecRow> {
	const before = (await allRows()).length;
	await emitAndFlush(opts);
	const after = await allRows();
	expect(after.length).toBe(before + 1);
	return after[after.length - 1];
}

describe("security_events tee — reason classification", () => {
	it("auth_fail for a 401 on a matched route", async () => {
		const row = await emitOne({
			method: "GET",
			path: "/v1/users/me/matches",
			route: "GET /v1/users/me/matches",
			status: 401,
		});
		expect(row.reason).toBe("auth_fail");
		expect(row.status).toBe(401);
		expect(row.route).toBe("GET /v1/users/me/matches");
		expect(row.meta).toBeNull();
	});

	it("admin_probe with the matched pattern for a 404 on a real admin route", async () => {
		const row = await emitOne({
			method: "GET",
			path: "/v1/admin/games/all",
			route: "GET /v1/admin/games/all",
			status: 404,
		});
		expect(row.reason).toBe("admin_probe");
		expect(row.route).toBe("GET /v1/admin/games/all");
		expect(row.meta).toBeNull();
	});

	it("admin_probe with a synthetic pattern + raw_path for an unmatched probe", async () => {
		const row = await emitOne({
			method: "GET",
			path: "/v1/admin/secret-backdoor",
			status: 404, // no route → unmatched
		});
		expect(row.reason).toBe("admin_probe");
		expect(row.route).toBe("GET /v1/admin/*");
		expect(JSON.parse(row.meta!)).toEqual({
			raw_path: "/v1/admin/secret-backdoor",
		});
	});

	it("legacy_share_write for a blocklist 403 on POST /v1/share (status preserved)", async () => {
		const row = await emitOne({
			method: "POST",
			path: "/v1/share",
			route: "POST /v1/share",
			status: 403,
		});
		expect(row.reason).toBe("legacy_share_write");
		expect(row.status).toBe(403);
	});

	it("dev_login_probe for a non-GET probe at the dev-login path", async () => {
		const row = await emitOne({
			method: "POST",
			path: "/v1/auth/dev/login",
			status: 404,
		});
		expect(row.reason).toBe("dev_login_probe");
		expect(row.route).toBe("POST /v1/auth/dev/login");
	});

	it("rate_limited for a 429", async () => {
		const row = await emitOne({
			method: "POST",
			path: "/v1/games",
			route: "POST /v1/games",
			status: 429,
		});
		expect(row.reason).toBe("rate_limited");
	});

	it("server_error for a 5xx", async () => {
		const row = await emitOne({
			method: "GET",
			path: "/v1/games/abc",
			route: "GET /v1/games/:id",
			status: 500,
		});
		expect(row.reason).toBe("server_error");
	});

	it("signup for a handler-tagged new-account callback (200 wouldn't emit otherwise)", async () => {
		const row = await emitOne({
			method: "POST",
			path: "/v1/auth/discord/callback",
			route: "POST /v1/auth/discord/callback",
			status: 200,
			securityReason: "signup",
		});
		expect(row.reason).toBe("signup");
		expect(row.status).toBe(200);
	});

	it("writes no row for an ordinary 200", async () => {
		const before = (await allRows()).length;
		await emitAndFlush({
			method: "GET",
			path: "/v1/games/public-recent",
			route: "GET /v1/games/public-recent",
			status: 200,
		});
		expect((await allRows()).length).toBe(before);
	});
});

describe("security_events tee — actor_ip distrust rule", () => {
	it("records CF-Connecting-IP when the request traversed the edge", async () => {
		const row = await emitOne({
			method: "GET",
			path: "/v1/admin/x",
			status: 404,
			cfRay: true,
			ip: "203.0.113.7",
		});
		expect(row.actor_ip).toBe("203.0.113.7");
	});

	it("records NULL actor_ip when CF-RAY is absent (off-edge)", async () => {
		const row = await emitOne({
			method: "GET",
			path: "/v1/admin/x",
			status: 404,
			ip: "203.0.113.7", // present but untrusted without CF-RAY
		});
		expect(row.actor_ip).toBeNull();
	});
});

describe("security_events tee — cursor invariant", () => {
	it("assigns strictly ascending ids (drain cursor)", async () => {
		await emitAndFlush({ method: "GET", path: "/v1/admin/a", status: 404 });
		await emitAndFlush({ method: "GET", path: "/v1/admin/b", status: 404 });
		await emitAndFlush({ method: "GET", path: "/v1/admin/c", status: 404 });
		const ids = (await allRows()).map((r) => r.id);
		for (let i = 1; i < ids.length; i++) {
			expect(ids[i]).toBeGreaterThan(ids[i - 1]);
		}
	});
});

describe("security_events tee — failure isolation", () => {
	it("swallows a synchronous throw without propagating", async () => {
		const throwingEnv = {
			SECURITY_DB: {
				prepare() {
					throw new Error("sync boom");
				},
			},
		} as unknown as SecurityEventsEnv;
		const req = new Request("http://test/v1/admin/x", {
			headers: { "CF-RAY": "r" },
		});
		const res = new Response(null, { status: 404 });
		const ctx = { waitUntil() {} } as unknown as ExecutionContext;
		await runWithLogContext(req, async () => {
			expect(() => emitSecurityEvent(req, res, throwingEnv, ctx)).not.toThrow();
		});
	});

	it("swallows an async insert rejection inside waitUntil", async () => {
		const rejectingEnv = {
			SECURITY_DB: {
				prepare() {
					return {
						bind() {
							return {
								run() {
									return Promise.reject(new Error("async boom"));
								},
							};
						},
					};
				},
			},
		} as unknown as SecurityEventsEnv;
		const req = new Request("http://test/v1/admin/x", {
			headers: { "CF-RAY": "r" },
		});
		const res = new Response(null, { status: 404 });
		let captured: Promise<unknown> | undefined;
		const ctx = {
			waitUntil(p: Promise<unknown>) {
				captured = p;
			},
		} as unknown as ExecutionContext;
		await runWithLogContext(req, async () => {
			emitSecurityEvent(req, res, rejectingEnv, ctx);
		});
		// The .catch inside the tee turns the rejection into a clean resolve.
		await expect(captured).resolves.toBeUndefined();
	});
});

describe("security_events tee — end-to-end wiring", () => {
	it("the fetch envelope emits a row for a real admin probe", async () => {
		const res = await SELF.fetch("http://test/v1/admin/probe-me-123", {
			headers: { "CF-RAY": "edge" },
		});
		// Response is the normal 404 — the tee can't change it.
		expect(res.status).toBe(404);

		// The write is deferred via waitUntil; poll until it lands. Rows
		// accumulate across tests, so identify this one by its unique probe path.
		let found: SecRow | undefined;
		for (let i = 0; i < 50; i++) {
			const rows = await allRows();
			found = rows.find((r) => r.meta?.includes("probe-me-123"));
			if (found) break;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(
			found,
			"expected an admin_probe row from the real fetch path",
		).toBeTruthy();
		expect(found!.reason).toBe("admin_probe");
		expect(found!.route).toBe("GET /v1/admin/*");
		expect(JSON.parse(found!.meta!)).toEqual({
			raw_path: "/v1/admin/probe-me-123",
		});
	});
});
