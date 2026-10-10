// The local-only image route (issue #289).
//
// Its job is unglamorous — stream an object out of the dev bucket — and the
// part worth pinning is that it is DARK IN PRODUCTION. It reads a
// caller-supplied key, so the gate is the whole security story: both
// conditions, independently.
//
// No D1 and no classifier here: the route reads R2 and nothing else, so the
// fixtures are plain puts rather than uploads through the endpoint.

import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCREENSHOT_KEY_ROOT } from "../../../src/screenshots/storage";

const KEY = `${SCREENSHOT_KEY_ROOT}jbnaiOVEB-LhyWGpw8ul0/RTwCtAku3jmm1Gc1.webp`;
const BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04]);

// The thumbnail URL's extra segment, exactly as storage.ts builds it.
const THUMB_SEGMENT = "cdn-cgi/image/width=640,height=400,fit=cover";

function devImage(path: string, scheme = "http"): Promise<Response> {
	return SELF.fetch(`${scheme}://test/v1/dev/images/${path}`);
}

beforeEach(async () => {
	await env.SCREENSHOT_BUCKET.put(KEY, BYTES, {
		httpMetadata: { contentType: "image/webp" },
	});
});

afterEach(async () => {
	await env.SCREENSHOT_BUCKET.delete(KEY);
});

describe("GET /v1/dev/images/*", () => {
	it("streams the stored object, typed from its R2 metadata", async () => {
		const res = await devImage(KEY);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/webp");
		// Not an imitation of the zone's Cache Rule: a cached dev image would
		// outlive a delete and make the gallery disagree with local D1.
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
	});

	it("serves a thumbnail URL the ORIGINAL bytes, options discarded", async () => {
		// Deliberately no transformation locally — the tile's shape is the
		// grid's CSS box either way, so the only difference is bytes on the
		// wire, and a WebP re-encoder here would be production-shaped code
		// serving a dev-only path.
		const res = await devImage(`${THUMB_SEGMENT}/${KEY}`);
		expect(res.status).toBe(200);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
	});

	it("is dark without DEV_LOGIN", async () => {
		const configured = env.DEV_LOGIN;
		try {
			delete (env as { DEV_LOGIN?: string }).DEV_LOGIN;
			expect((await devImage(KEY)).status).toBe(404);
		} finally {
			(env as { DEV_LOGIN?: string }).DEV_LOGIN = configured;
		}
	});

	it("is dark over HTTPS even with the flag set", async () => {
		// The second condition carries its own weight: the flag alone would
		// mean a mis-set var serves the bucket over the open internet.
		expect(env.DEV_LOGIN).toBeTruthy();
		expect((await devImage(KEY, "https")).status).toBe(404);
	});

	it("serves nothing outside the screenshots prefix", async () => {
		await env.SCREENSHOT_BUCKET.put("elsewhere/secret.webp", BYTES);
		try {
			expect((await devImage("elsewhere/secret.webp")).status).toBe(404);
		} finally {
			await env.SCREENSHOT_BUCKET.delete("elsewhere/secret.webp");
		}
	});

	it("404s a key with no object", async () => {
		expect(
			(await devImage(`${SCREENSHOT_KEY_ROOT}nope/nope.webp`)).status,
		).toBe(404);
	});
});
