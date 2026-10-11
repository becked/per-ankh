// The purge call's own behaviour (issue #289).
//
// Worth a test of its own because it is the one step of a removal with no
// other symptom: the row is gone, the object is gone, and a failure here means
// the picture is still being served. So what is pinned is the request shape,
// the chunking, and that nothing it can go wrong with throws into the caller.

import { afterEach, describe, expect, it, vi } from "vitest";
import { purgeUrls } from "./purge";

const CONFIGURED = {
	CLOUDFLARE_ZONE_ID: "zone123",
	CLOUDFLARE_PURGE_TOKEN: "tok_abc",
};

interface Captured {
	url: string;
	auth: string | null;
	files: string[];
}

function stubFetch(respond: (call: number) => Response): { calls: Captured[] } {
	const calls: Captured[] = [];
	vi.stubGlobal(
		"fetch",
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { files: string[] };
			calls.push({
				url: String(input),
				auth: new Headers(init?.headers).get("Authorization"),
				files: body.files,
			});
			return respond(calls.length);
		},
	);
	return { calls };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

function urls(n: number): string[] {
	return Array.from(
		{ length: n },
		(_, i) => `https://img.per-ankh.app/screenshots/g/${i}.webp`,
	);
}

describe("purgeUrls", () => {
	it("posts the zone's purge_cache endpoint with the files and the token", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		await purgeUrls(CONFIGURED, urls(2), { screenshot_id: "s1" });

		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(
			"https://api.cloudflare.com/client/v4/zones/zone123/purge_cache",
		);
		expect(calls[0].auth).toBe("Bearer tok_abc");
		expect(calls[0].files).toEqual(urls(2));
	});

	it("chunks at the API's 30-URL ceiling", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		await purgeUrls(CONFIGURED, urls(31), {});

		expect(calls).toHaveLength(2);
		expect(calls[0].files).toHaveLength(30);
		expect(calls[1].files).toHaveLength(1);
	});

	it("makes no call at all without a zone or a token", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		// Unconfigured is a FAILED purge in effect, not a no-op — it logs. What
		// it must not do is send a request with no credentials.
		await purgeUrls({}, urls(1), {});
		await purgeUrls({ CLOUDFLARE_ZONE_ID: "zone123" }, urls(1), {});
		await purgeUrls({ CLOUDFLARE_PURGE_TOKEN: "tok_abc" }, urls(1), {});
		expect(calls).toHaveLength(0);
	});

	it("does not throw on a refusal or a network error", async () => {
		// The removal this follows has already happened and is not undoable, so
		// the caller is never failed. Both failure shapes, and a later chunk
		// still goes out after an earlier one is refused.
		const { calls } = stubFetch((call) =>
			call === 1
				? new Response("forbidden", { status: 403 })
				: new Response("{}"),
		);
		await expect(purgeUrls(CONFIGURED, urls(31), {})).resolves.toBeUndefined();
		expect(calls).toHaveLength(2);

		vi.unstubAllGlobals();
		vi.stubGlobal("fetch", async () => {
			throw new Error("dns");
		});
		await expect(purgeUrls(CONFIGURED, urls(1), {})).resolves.toBeUndefined();
	});

	it("sends nothing for an empty list", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		await purgeUrls(CONFIGURED, [], {});
		expect(calls).toHaveLength(0);
	});
});
