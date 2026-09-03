// Per-IP read limits on the challenge surface. Two independent budgets:
//
//   challenge_view       — the challenge pages: GET /v1/challenges and
//                          GET /v1/challenges/:number.
//   challenge_link_view  — GET /v1/games/:id/challenge-link, called on every
//                          /games/[id] render.
//
// The split is the tournament-link lesson (tournament/rate-limit-view.test.ts,
// #196): a read a high-traffic page makes on every render must not share a
// budget with the pages it can take down. These pin that each budget is
// enforced and recorded on its own path, and that draining the link one
// leaves the pages up.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import {
	CHALLENGE_LINK_VIEW_PER_HOUR,
	CHALLENGE_VIEW_PER_HOUR,
	challengeLinkViewPerHour,
	challengeViewPerHour,
} from "../../../src/challenges/handlers";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

type ReadEventType = "challenge_view" | "challenge_link_view";

// One recursive-CTE statement per bucket, for the reason the tournament
// sibling gives: per-row seeding is enough extra work to tip other files'
// timing-sensitive tests into timeouts.
async function seedEvents(
	eventType: ReadEventType,
	ip: string,
	count: number,
): Promise<void> {
	await env.SHARE_DB.prepare(
		`INSERT INTO events (event_type, ip_address)
		 WITH RECURSIVE seq(i) AS (
		   SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?
		 )
		 SELECT ?, ? FROM seq`,
	)
		.bind(count, eventType, ip)
		.run();
}

async function countEvents(
	eventType: ReadEventType,
	ip: string,
): Promise<number> {
	const row = await env.SHARE_DB.prepare(
		`SELECT COUNT(*) AS n FROM events
		 WHERE event_type = ? AND ip_address = ?`,
	)
		.bind(eventType, ip)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

// The audit INSERT that spends a slot is fire-and-forget; poll.
async function expectEventsToReach(
	eventType: ReadEventType,
	ip: string,
	expected: number,
): Promise<void> {
	for (let i = 0; i < 50; i++) {
		if ((await countEvents(eventType, ip)) >= expected) break;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(await countEvents(eventType, ip)).toBe(expected);
}

// getClientIp trusts CF-Connecting-IP only alongside CF-RAY.
function get(
	path: string,
	opts: { ip: string; ua?: string },
): Promise<Response> {
	const headers: Record<string, string> = {
		"CF-Connecting-IP": opts.ip,
		"CF-RAY": "test-ray",
	};
	if (opts.ua) headers["User-Agent"] = opts.ua;
	return SELF.fetch(`http://test${path}`, { headers });
}

// An unlinked game exercises the whole gate: the budget is charged before
// the handler knows whether the game is a run.
const linkPath = () => `/v1/games/${nanoid(21)}/challenge-link`;

describe("challenge view rate limit", () => {
	it("records a challenge_view for a served list read", async () => {
		const ip = "203.0.113.70";
		await expectOk(await get("/v1/challenges", { ip }));
		await expectEventsToReach("challenge_view", ip, 1);
		expect(await countEvents("challenge_link_view", ip)).toBe(0);
	});

	it("429s once the per-IP limit is reached", async () => {
		const ip = "203.0.113.71";
		await seedEvents("challenge_view", ip, CHALLENGE_VIEW_PER_HOUR);
		await expectErrorCode(await get("/v1/challenges", { ip }), {
			status: 429,
			code: "RATE_LIMIT_CHALLENGE_VIEW",
		});
		// The detail read draws on the same budget: the check runs before
		// the lookup, so an unknown number 429s rather than 404s.
		await expectErrorCode(await get("/v1/challenges/27", { ip }), {
			status: 429,
			code: "RATE_LIMIT_CHALLENGE_VIEW",
		});
	});

	it("scraper User-Agent is exempt from the limit", async () => {
		const ip = "203.0.113.72";
		await seedEvents("challenge_view", ip, CHALLENGE_VIEW_PER_HOUR);
		await expectOk(await get("/v1/challenges", { ip, ua: "Twitterbot/1.0" }));
	});
});

describe("game challenge-link rate limit", () => {
	it("records a challenge_link_view for a served read, and nothing of the page budget", async () => {
		const ip = "203.0.113.80";
		const body = await expectOk<{ link: null }>(await get(linkPath(), { ip }));
		expect(body.link).toBeNull();
		await expectEventsToReach("challenge_link_view", ip, 1);
		expect(await countEvents("challenge_view", ip)).toBe(0);
	});

	it("429s once its own per-IP limit is reached", async () => {
		const ip = "203.0.113.81";
		await seedEvents("challenge_link_view", ip, CHALLENGE_LINK_VIEW_PER_HOUR);
		await expectErrorCode(await get(linkPath(), { ip }), {
			status: 429,
			code: "RATE_LIMIT_CHALLENGE_LINK",
		});
	});

	it("leaves the challenge pages up when the link budget is drained", async () => {
		const ip = "203.0.113.82";
		await seedEvents("challenge_link_view", ip, CHALLENGE_LINK_VIEW_PER_HOUR);
		// A crawl of game pages has spent the link budget...
		await expectErrorCode(await get(linkPath(), { ip }), {
			status: 429,
			code: "RATE_LIMIT_CHALLENGE_LINK",
		});
		// ...and /challenges still answers.
		await expectOk(await get("/v1/challenges", { ip }));
	});

	it("serves the link read on an IP whose page budget is spent", async () => {
		const ip = "203.0.113.83";
		await seedEvents("challenge_view", ip, CHALLENGE_VIEW_PER_HOUR);
		await expectOk(await get(linkPath(), { ip }));
	});
});

// Both ceilings are wrangler vars with the constants as defaults — the
// tournament lever, so a crawl mid-event is retuned with `wrangler secret put`
// rather than a redeploy. Substituting the binding here is what that does.
describe("challenge ceilings are env-tunable", () => {
	const configured = {
		view: env.CHALLENGE_VIEW_PER_HOUR,
		link: env.CHALLENGE_LINK_VIEW_PER_HOUR,
	};
	afterEach(() => {
		env.CHALLENGE_VIEW_PER_HOUR = configured.view;
		env.CHALLENGE_LINK_VIEW_PER_HOUR = configured.link;
	});

	it("gates the pages at the env value rather than the compiled-in default", async () => {
		env.CHALLENGE_VIEW_PER_HOUR = "5";
		const under = "203.0.113.90";
		await seedEvents("challenge_view", under, 4);
		await expectOk(await get("/v1/challenges", { ip: under }));
		const at = "203.0.113.91";
		await seedEvents("challenge_view", at, 5);
		await expectErrorCode(await get("/v1/challenges", { ip: at }), {
			status: 429,
			code: "RATE_LIMIT_CHALLENGE_VIEW",
		});
	});

	it("gates the link read at its own env value", async () => {
		env.CHALLENGE_LINK_VIEW_PER_HOUR = "5";
		const under = "203.0.113.92";
		await seedEvents("challenge_link_view", under, 4);
		await expectOk(await get(linkPath(), { ip: under }));
		const at = "203.0.113.93";
		await seedEvents("challenge_link_view", at, 5);
		await expectErrorCode(await get(linkPath(), { ip: at }), {
			status: 429,
			code: "RATE_LIMIT_CHALLENGE_LINK",
		});
	});

	it("falls back to the constants when the var doesn't parse", async () => {
		env.CHALLENGE_VIEW_PER_HOUR = "600 per hour";
		const under = "203.0.113.94";
		await seedEvents("challenge_view", under, CHALLENGE_VIEW_PER_HOUR - 1);
		await expectOk(await get("/v1/challenges", { ip: under }));
		const at = "203.0.113.95";
		await seedEvents("challenge_view", at, CHALLENGE_VIEW_PER_HOUR);
		await expectErrorCode(await get("/v1/challenges", { ip: at }), {
			status: 429,
			code: "RATE_LIMIT_CHALLENGE_VIEW",
		});
	});

	it("the configured vars are the constants", () => {
		// Pins that wrangler.toml carries both vars: a test that only exercised
		// the fallback would pass with no var at all.
		expect(env.CHALLENGE_VIEW_PER_HOUR).toBe(String(CHALLENGE_VIEW_PER_HOUR));
		expect(env.CHALLENGE_LINK_VIEW_PER_HOUR).toBe(
			String(CHALLENGE_LINK_VIEW_PER_HOUR),
		);
		expect(challengeViewPerHour(env)).toBe(CHALLENGE_VIEW_PER_HOUR);
		expect(challengeLinkViewPerHour(env)).toBe(CHALLENGE_LINK_VIEW_PER_HOUR);
	});
});
