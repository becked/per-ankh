// Tournament-view rate limit: 600/hour/IP across the eight tournament
// read endpoints. The limit applies to every caller — anonymous and
// signed-in alike — but during the private beta only signed-in beta
// users can reach the rate-limit check at all; everyone else gets a 404
// from the beta gate first. The tests below all act as a beta user.
//
// Scraper User-Agents (Discord/Slack/Twitter previewers) bypass the
// rate-limit gate in production, but the beta gate sits in front of
// that bypass — so during the beta, scrapers also get 404.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, it } from "vitest";
import { expectErrorCode } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
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

describe("tournament view rate limit", () => {
	it("returns 429 once the per-IP limit is reached", async () => {
		const t = await makeTournament({ slug: "rl-view-test-a" });
		const ip = "203.0.113.10";
		await seedViewEvents(ip, TOURNAMENT_VIEW_PER_HOUR);

		const res = await SELF.fetch(`http://test/v1/tournaments/${t.slug}`, {
			headers: {
				"CF-Connecting-IP": ip,
				"CF-RAY": "test-ray",
				Cookie: `session=${t.admin.sessionToken}`,
			},
		});
		await expectErrorCode(res, {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_VIEW",
		});
	});

	it("scraper User-Agent is blocked by the beta gate before the rate-limit bypass", async () => {
		const t = await makeTournament({ slug: "rl-view-test-b" });
		const ip = "203.0.113.11";
		await seedViewEvents(ip, TOURNAMENT_VIEW_PER_HOUR);

		// No session cookie — scraper request is unauthed. Pre-beta the
		// scraper UA would bypass the rate limit and 200; post-beta the
		// gate fires first and we 404 to keep the feature unlisted.
		const res = await SELF.fetch(`http://test/v1/tournaments/${t.slug}`, {
			headers: {
				"CF-Connecting-IP": ip,
				"CF-RAY": "test-ray",
				"User-Agent": "Twitterbot/1.0",
			},
		});
		await expectErrorCode(res, {
			status: 404,
			code: "TOURNAMENT_NOT_FOUND",
		});
	});

	it("limit applies to GET /v1/tournaments (list) too", async () => {
		// List endpoint doesn't take a tournament context, so any beta user
		// suffices as the caller.
		const viewer = await makeUser();
		const ip = "203.0.113.12";
		await seedViewEvents(ip, TOURNAMENT_VIEW_PER_HOUR);
		const res = await SELF.fetch(`http://test/v1/tournaments`, {
			headers: {
				"CF-Connecting-IP": ip,
				"CF-RAY": "test-ray",
				Cookie: `session=${viewer.sessionToken}`,
			},
		});
		await expectErrorCode(res, {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_VIEW",
		});
	});
});
