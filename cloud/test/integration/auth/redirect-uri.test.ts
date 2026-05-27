// Behavior tests for the redirect_uri allowlist on POST /v1/auth/discord/start.
//
// Defense in depth: the Worker only forwards redirect_uris it owns to Discord,
// rather than trusting the client and relying solely on Discord's own
// registered-redirect-URI list. The allowlist is derived from ALLOWED_ORIGINS
// ("https://per-ankh.app,http://localhost:1420" in wrangler.toml); the callback
// path is fixed at /auth/callback.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode } from "../../helpers/assertions";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

describe("POST /v1/auth/discord/start redirect_uri allowlist", () => {
	it("accepts the prod callback URL", async () => {
		const res = await request.post({
			path: "/v1/auth/discord/start",
			body: { redirect_uri: "https://per-ankh.app/auth/callback" },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { authorize_url?: string };
		expect(body.authorize_url).toMatch(
			/^https:\/\/discord\.com\/api\/oauth2\/authorize/,
		);
	});

	it("accepts the local-dev callback URL", async () => {
		const res = await request.post({
			path: "/v1/auth/discord/start",
			body: { redirect_uri: "http://localhost:1420/auth/callback" },
		});
		expect(res.status).toBe(200);
	});

	it("rejects a disallowed origin", async () => {
		const res = await request.post({
			path: "/v1/auth/discord/start",
			body: { redirect_uri: "https://evil.test/auth/callback" },
		});
		await expectErrorCode(res, { status: 400, code: "INVALID_REDIRECT_URI" });
	});

	it("rejects an allowed origin with the wrong path", async () => {
		const res = await request.post({
			path: "/v1/auth/discord/start",
			body: { redirect_uri: "https://per-ankh.app/somewhere-else" },
		});
		await expectErrorCode(res, { status: 400, code: "INVALID_REDIRECT_URI" });
	});

	it("rejects a malformed redirect_uri", async () => {
		const res = await request.post({
			path: "/v1/auth/discord/start",
			body: { redirect_uri: "not-a-url" },
		});
		await expectErrorCode(res, { status: 400, code: "INVALID_REDIRECT_URI" });
	});

	it("still requires redirect_uri to be present", async () => {
		const res = await request.post({
			path: "/v1/auth/discord/start",
			body: {},
		});
		await expectErrorCode(res, { status: 400, code: "MISSING_REDIRECT_URI" });
	});
});
