// Anonymous tournament-view rate limit: 600/hour/IP across the eight
// public read endpoints. Scraper User-Agents bypass.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode } from "../../helpers/assertions";
import { makeTournament } from "../../helpers/builders";
import { TOURNAMENT_VIEW_PER_HOUR } from "../../../src/tournament/limits";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

async function seedViewEvents(ip: string, count: number): Promise<void> {
	for (let i = 0; i < count; i++) {
		await env.SHARE_DB.prepare(
			`INSERT INTO events (event_type, ip_address) VALUES ('tournament_view', ?)`,
		)
			.bind(ip)
			.run();
	}
}

describe("anonymous tournament view rate limit", () => {
	it("returns 429 once the per-IP limit is reached", async () => {
		const t = await makeTournament({ slug: "rl-view-test-a" });
		const ip = "203.0.113.10";
		await seedViewEvents(ip, TOURNAMENT_VIEW_PER_HOUR);

		const res = await SELF.fetch(`http://test/v1/tournaments/${t.slug}`, {
			headers: { "CF-Connecting-IP": ip, "CF-RAY": "test-ray" },
		});
		await expectErrorCode(res, {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_VIEW",
		});
	});

	it("scraper User-Agent bypasses the limit", async () => {
		const t = await makeTournament({ slug: "rl-view-test-b" });
		const ip = "203.0.113.11";
		await seedViewEvents(ip, TOURNAMENT_VIEW_PER_HOUR);

		const res = await SELF.fetch(`http://test/v1/tournaments/${t.slug}`, {
			headers: {
				"CF-Connecting-IP": ip,
				"CF-RAY": "test-ray",
				"User-Agent": "Twitterbot/1.0",
			},
		});
		expect(res.status).toBe(200);
	});

	it("limit applies to GET /v1/tournaments (list) too", async () => {
		const ip = "203.0.113.12";
		await seedViewEvents(ip, TOURNAMENT_VIEW_PER_HOUR);
		const res = await SELF.fetch(`http://test/v1/tournaments`, {
			headers: { "CF-Connecting-IP": ip, "CF-RAY": "test-ray" },
		});
		await expectErrorCode(res, {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_VIEW",
		});
	});
});
