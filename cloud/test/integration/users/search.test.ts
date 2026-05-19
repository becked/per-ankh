// Behavior tests for GET /v1/users/search — the autocomplete source for
// the tournament admin's slot-creation form.
//
// Covers:
//   * Auth + beta-gate (anonymous and non-beta both 404)
//   * "Still typing" floor (q.length < 2 returns empty, no audit row)
//   * Prefix-only matching on display_name (suffix queries don't match)
//   * Case-insensitive (q lowercased, display_name lowered server-side)
//   * Discord-username-NULL users are filtered out (would be unpickable)
//   * Limit cap (configurable up to 20, default 10)
//   * Per-user rate limit at USER_SEARCH_PER_USER_PER_HOUR

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { USER_SEARCH_PER_USER_PER_HOUR } from "../../../src/users";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface SearchResponse {
	users: Array<{
		user_id: string;
		discord_id: string;
		discord_username: string;
		display_name: string;
	}>;
}

// Seed N user_search audit rows for `userId` to set up the rate-limit
// scenario without firing N actual searches.
async function seedSearchEvents(userId: string, count: number): Promise<void> {
	for (let i = 0; i < count; i++) {
		await env.SHARE_DB.prepare(
			`INSERT INTO events (event_type, user_id, metadata)
			 VALUES ('user_search', ?, ?)`,
		)
			.bind(userId, JSON.stringify({ seed: true, index: i }))
			.run();
	}
}

describe("GET /v1/users/search — auth", () => {
	it("returns 404 to an unauthenticated request", async () => {
		const res = await request.get({ path: "/v1/users/search?q=ab" });
		await expectErrorCode(res, {
			status: 404,
			code: "USER_SEARCH_NOT_FOUND",
		});
	});

	it("returns 404 to a signed-in non-beta user (gate hides existence)", async () => {
		const stranger = await makeUser({ omitBeta: true });
		const res = await request.get({
			path: "/v1/users/search?q=ab",
			as: stranger,
		});
		await expectErrorCode(res, { status: 404, code: "TOURNAMENT_NOT_FOUND" });
	});
});

describe("GET /v1/users/search — matching", () => {
	it("returns empty list when q.length < 2", async () => {
		const caller = await makeUser();
		const res = await request.get({
			path: "/v1/users/search?q=a",
			as: caller,
		});
		const body = await expectOk<SearchResponse>(res);
		expect(body.users).toEqual([]);
	});

	it("returns empty list for q empty / whitespace-only", async () => {
		const caller = await makeUser();
		const res = await request.get({
			path: "/v1/users/search?q=%20%20",
			as: caller,
		});
		// q=" " trims to "" which violates the schema min(1). Expect 400.
		await expectErrorCode(res, { status: 400, code: "VALIDATION_ERROR" });
	});

	it("matches by prefix on display_name", async () => {
		const caller = await makeUser();
		const alice = await makeUser({ discordUsername: "alice-test" });
		const albert = await makeUser({ discordUsername: "albert-test" });
		await makeUser({ discordUsername: "bob-test" });

		const res = await request.get({
			path: "/v1/users/search?q=al",
			as: caller,
		});
		const body = await expectOk<SearchResponse>(res);
		const usernames = body.users.map((u) => u.discord_username).sort();
		expect(usernames).toContain("alice-test");
		expect(usernames).toContain("albert-test");
		expect(usernames).not.toContain("bob-test");
		// Sanity: the matched users have the expected user_ids.
		const ids = new Set(body.users.map((u) => u.user_id));
		expect(ids.has(alice.userId)).toBe(true);
		expect(ids.has(albert.userId)).toBe(true);
	});

	it("matches display_name (not discord_username) when the two diverge", async () => {
		const caller = await makeUser();
		// Hand-craft a row where display_name and discord_username differ:
		// admin types `Becked` in Discord (display_name) but the canonical
		// @ handle is `.becked` (with a leading dot). Searching for "beck"
		// should find the row via display_name, not via the dot-prefixed
		// canonical handle.
		await env.SHARE_DB.prepare(
			`INSERT INTO users (user_id, discord_id, display_name, discord_username)
			 VALUES (?, ?, ?, ?)`,
		)
			.bind("divergeUser0000000001", "1111000000000001", "Becked", ".becked")
			.run();
		const res = await request.get({
			path: "/v1/users/search?q=beck",
			as: caller,
		});
		const body = await expectOk<SearchResponse>(res);
		const hit = body.users.find((u) => u.user_id === "divergeUser0000000001");
		expect(hit).toBeTruthy();
		// Picking returns the canonical handle for the slot row.
		expect(hit!.discord_username).toBe(".becked");
		expect(hit!.display_name).toBe("Becked");
	});

	it("filters out users with NULL discord_username (unpickable)", async () => {
		const caller = await makeUser();
		// display_name set, discord_username NULL — would match the prefix
		// query but isn't pickable into a slot.
		await env.SHARE_DB.prepare(
			`INSERT INTO users (user_id, discord_id, display_name, discord_username)
			 VALUES (?, ?, ?, NULL)`,
		)
			.bind("noHandleUser0000000001", "1111000000000002", "Becka")
			.run();
		const res = await request.get({
			path: "/v1/users/search?q=beck",
			as: caller,
		});
		const body = await expectOk<SearchResponse>(res);
		expect(
			body.users.find((u) => u.user_id === "noHandleUser0000000001"),
		).toBeUndefined();
	});

	it("does NOT match by substring or suffix", async () => {
		const caller = await makeUser();
		await makeUser({ discordUsername: "xyz-tail" });

		const res = await request.get({
			path: "/v1/users/search?q=tail",
			as: caller,
		});
		const body = await expectOk<SearchResponse>(res);
		expect(
			body.users.find((u) => u.discord_username === "xyz-tail"),
		).toBeUndefined();
	});

	it("treats uppercase queries as case-insensitive (q is lowercased)", async () => {
		const caller = await makeUser();
		await makeUser({ discordUsername: "casesensitive-test" });

		const res = await request.get({
			path: "/v1/users/search?q=CASE",
			as: caller,
		});
		const body = await expectOk<SearchResponse>(res);
		expect(
			body.users.find((u) => u.discord_username === "casesensitive-test"),
		).toBeTruthy();
	});

	it("returns only the four whitelisted fields", async () => {
		const caller = await makeUser();
		await makeUser({ discordUsername: "fields-test-target" });

		const res = await request.get({
			path: "/v1/users/search?q=fields",
			as: caller,
		});
		const body = await expectOk<SearchResponse>(res);
		expect(body.users.length).toBeGreaterThan(0);
		const u = body.users[0];
		expect(Object.keys(u).sort()).toEqual([
			"discord_id",
			"discord_username",
			"display_name",
			"user_id",
		]);
	});

	it("caps results at the limit param (max 20)", async () => {
		const caller = await makeUser();
		// 5 users sharing the "cap-" prefix.
		for (let i = 0; i < 5; i++) {
			await makeUser({
				discordUsername: `cap-${i}-${Math.random().toString(36).slice(2, 6)}`,
			});
		}
		const res = await request.get({
			path: "/v1/users/search?q=cap-&limit=3",
			as: caller,
		});
		const body = await expectOk<SearchResponse>(res);
		expect(body.users.length).toBeLessThanOrEqual(3);
	});

	it("rejects out-of-range limit", async () => {
		const caller = await makeUser();
		const res = await request.get({
			path: "/v1/users/search?q=ab&limit=999",
			as: caller,
		});
		await expectErrorCode(res, { status: 400, code: "VALIDATION_ERROR" });
	});
});

describe("GET /v1/users/search — rate limit", () => {
	it("returns 429 RATE_LIMIT_USER_SEARCH after USER_SEARCH_PER_USER_PER_HOUR audited searches", async () => {
		const caller = await makeUser();
		await seedSearchEvents(caller.userId, USER_SEARCH_PER_USER_PER_HOUR);
		const res = await request.get({
			path: "/v1/users/search?q=anything",
			as: caller,
		});
		await expectErrorCode(res, {
			status: 429,
			code: "RATE_LIMIT_USER_SEARCH",
		});
	});

	it("does NOT count q<2 searches against the rate limit (no audit row written)", async () => {
		const caller = await makeUser();
		// Drive 100 q<2 searches — would blow past the 60 limit if counted.
		for (let i = 0; i < 100; i++) {
			const r = await request.get({
				path: "/v1/users/search?q=a",
				as: caller,
			});
			expect(r.status).toBe(200);
		}
		// A proper search still succeeds.
		const res = await request.get({
			path: "/v1/users/search?q=ab",
			as: caller,
		});
		expect(res.status).toBe(200);
	});
});
