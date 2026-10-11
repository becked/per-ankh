// What the Worker says about caching on the way out — the posture a shared
// cache in front of it reads (`[cache]` in cloud/wrangler.toml).
//
// The declarations themselves are guarded as source
// (cloud/src/shared-cache-routes.test.ts: which routes a reviewer cleared,
// `jsonResponse`'s default, the predicate). What that file cannot reach is the
// response an undeclared handler actually serves, which is the half the
// tournament CSV export got wrong: it built its own `Response`, inherited no
// default, and so would have been stored for 7200s under a key with no cookie
// in it. The wrapper in cloud/src/index.ts closes that by applying the
// invariant rather than describing it, and these are the two directions of it:
//
//   1. A response that declares nothing, on a route that declared nothing,
//      leaves as `private, no-store`.
//   2. A route that *did* declare `sharedCache` keeps the directive its
//      handler built — enforcement is a floor, not a clamp.
//
// Plus the consequence for `X-Request-Id`: a stored entry outlives the request
// that filled it, so the header goes on responses that belong to one caller
// and nowhere else.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { request } from "../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

describe("cache posture on the way out", () => {
	it("forces private, no-store on a response that declares nothing", async () => {
		// POST /v1/csp-report returns a bare 204 built by hand, with no header
		// block at all — the shape the export route had. Nothing in the handler
		// has to change for this to be safe.
		const res = await request.post({ path: "/v1/csp-report" });
		expect(res.status).toBe(204);
		expect(res.headers.get("Cache-Control")).toBe("private, no-store");
	});

	it("forces private, no-store on a route that matched nothing", async () => {
		const res = await request.get({ path: "/v1/not-a-route" });
		expect(res.status).toBe(404);
		expect(res.headers.get("Cache-Control")).toBe("private, no-store");
	});

	it("keeps the directive a declared route's handler built", async () => {
		// GET /v1/featured-videos is flagged sharedCache and builds its own
		// `public, …`. Enforcement must not touch it, or the nine reviewed
		// routes would all quietly stop being cacheable.
		const res = await request.get({ path: "/v1/featured-videos" });
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe(
			"public, max-age=0, s-maxage=60",
		);
	});
});

describe("X-Request-Id", () => {
	it("is on a response that belongs to one caller", async () => {
		// An anonymous /v1/auth/me — 401, `private, no-store`, and the id an
		// operator greps for. This is the flow the header exists for.
		const res = await SELF.fetch("http://test/v1/auth/me");
		expect(res.status).toBe(401);
		expect(res.headers.get("X-Request-Id")).toMatch(/\S/);
	});

	it("is absent from a response a shared cache may store", async () => {
		// Were it set here, the stored entry would replay one request's id to
		// every later caller for the whole s-maxage — and a hit emits no access
		// line, so the id they'd report resolves to no log entry of their own.
		const res = await request.get({ path: "/v1/featured-videos" });
		expect(res.status).toBe(200);
		expect(res.headers.has("X-Request-Id")).toBe(false);
	});
});
