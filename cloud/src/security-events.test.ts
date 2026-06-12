import { describe, expect, it } from "vitest";
import {
	resolveSecurityEvent,
	SECURITY_REASONS,
	type SecurityEventInput,
} from "./security-events";

// resolveSecurityEvent is the pure classifier behind the tee — precedence,
// synthetic patterns, and the no-row case. The DB write + response isolation
// live in test/integration/events/security-events.test.ts.

function input(overrides: Partial<SecurityEventInput>): SecurityEventInput {
	return {
		method: "GET",
		path: "/v1/games",
		route: "GET /v1/games",
		securityReason: null,
		...overrides,
	};
}

describe("resolveSecurityEvent", () => {
	it("emits no row for an ordinary 200 with no handler reason", () => {
		expect(resolveSecurityEvent(input({}), 200)).toBeNull();
	});

	it("emits no row for a generic 404 outside /v1/admin/*", () => {
		expect(
			resolveSecurityEvent(input({ path: "/v1/bogus", route: null }), 404),
		).toBeNull();
	});

	describe("handler-set reason (signup)", () => {
		it("wins even on a 200 the status rules would ignore", () => {
			expect(
				resolveSecurityEvent(
					input({
						method: "POST",
						path: "/v1/auth/discord/callback",
						route: "POST /v1/auth/discord/callback",
						securityReason: "signup",
					}),
					200,
				),
			).toEqual({
				reason: "signup",
				route: "POST /v1/auth/discord/callback",
				rawPath: null,
			});
		});

		it("ignores an unknown handler reason but still applies status rules", () => {
			expect(
				resolveSecurityEvent(input({ securityReason: "bogus" }), 200),
			).toBeNull();
			expect(
				resolveSecurityEvent(input({ securityReason: "bogus" }), 403)?.reason,
			).toBe("auth_fail");
		});
	});

	describe("route-scoped reasons (any status)", () => {
		it("classifies a matched dev-login hit", () => {
			expect(
				resolveSecurityEvent(
					input({
						path: "/v1/auth/dev/login",
						route: "GET /v1/auth/dev/login",
					}),
					404,
				),
			).toEqual({
				reason: "dev_login_probe",
				route: "GET /v1/auth/dev/login",
				rawPath: null,
			});
		});

		it("synthesizes a pattern + raw_path for a non-GET dev-login probe", () => {
			expect(
				resolveSecurityEvent(
					input({ method: "POST", path: "/v1/auth/dev/login", route: null }),
					404,
				),
			).toEqual({
				reason: "dev_login_probe",
				route: "POST /v1/auth/dev/login",
				rawPath: "/v1/auth/dev/login",
			});
		});

		it("classifies POST /v1/share at any status (wins over 403/429/5xx)", () => {
			for (const status of [201, 403, 429, 500]) {
				expect(
					resolveSecurityEvent(
						input({
							method: "POST",
							path: "/v1/share",
							route: "POST /v1/share",
						}),
						status,
					)?.reason,
					`status ${status}`,
				).toBe("legacy_share_write");
			}
		});

		it("does not treat GET /v1/share/:id (download) as a legacy write", () => {
			expect(
				resolveSecurityEvent(
					input({
						method: "GET",
						path: "/v1/share/abc",
						route: "GET /v1/share/:id",
					}),
					200,
				),
			).toBeNull();
		});
	});

	describe("status-scoped reasons", () => {
		it("429 → rate_limited", () => {
			expect(resolveSecurityEvent(input({}), 429)?.reason).toBe("rate_limited");
		});
		it("5xx → server_error", () => {
			expect(resolveSecurityEvent(input({}), 500)?.reason).toBe("server_error");
			expect(resolveSecurityEvent(input({}), 503)?.reason).toBe("server_error");
		});
		it("401/403 → auth_fail", () => {
			expect(resolveSecurityEvent(input({}), 401)?.reason).toBe("auth_fail");
			expect(resolveSecurityEvent(input({}), 403)?.reason).toBe("auth_fail");
		});
	});

	describe("admin_probe", () => {
		it("emits the matched pattern for a 404 on a real admin route", () => {
			expect(
				resolveSecurityEvent(
					input({
						method: "GET",
						path: "/v1/admin/games/all",
						route: "GET /v1/admin/games/all",
					}),
					404,
				),
			).toEqual({
				reason: "admin_probe",
				route: "GET /v1/admin/games/all",
				rawPath: null,
			});
		});

		it("synthesizes a coarse pattern + raw_path for an unmatched admin path", () => {
			expect(
				resolveSecurityEvent(
					input({
						method: "GET",
						path: "/v1/admin/secret-backdoor",
						route: null,
					}),
					404,
				),
			).toEqual({
				reason: "admin_probe",
				route: "GET /v1/admin/*",
				rawPath: "/v1/admin/secret-backdoor",
			});
		});

		it("treats a 5xx under /v1/admin/* as server_error, not admin_probe", () => {
			expect(
				resolveSecurityEvent(
					input({
						path: "/v1/admin/games/all",
						route: "GET /v1/admin/games/all",
					}),
					500,
				)?.reason,
			).toBe("server_error");
		});
	});

	it("truncates an over-long raw path to 128 chars", () => {
		const r = resolveSecurityEvent(
			input({
				method: "GET",
				path: `/v1/admin/${"x".repeat(300)}`,
				route: null,
			}),
			404,
		);
		expect(r?.rawPath?.length).toBe(128);
		expect(r?.route).toBe("GET /v1/admin/*");
	});

	it("only ever emits a reason from the published vocabulary", () => {
		const cases: Array<[SecurityEventInput, number]> = [
			[input({ securityReason: "signup" }), 200],
			[input({ path: "/v1/auth/dev/login", route: null }), 404],
			[
				input({ method: "POST", path: "/v1/share", route: "POST /v1/share" }),
				201,
			],
			[input({}), 429],
			[input({}), 500],
			[input({ path: "/v1/admin/x", route: null }), 404],
			[input({}), 401],
		];
		for (const [inp, status] of cases) {
			const r = resolveSecurityEvent(inp, status);
			expect(r).not.toBeNull();
			expect(SECURITY_REASONS).toContain(r!.reason);
		}
	});
});
