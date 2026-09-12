// Per-IP read limits on the tournament surface. Three independent budgets:
//
//   tournament_view       — a tournament page load: the detail read plus
//                           standings, bracket, rounds, matches and stats.
//                           Ceiling from the TOURNAMENT_VIEW_PER_HOUR var,
//                           defaulting to the constant of the same name.
//   tournament_list_view  — GET /v1/tournaments, which the *home page* fetches
//                           on every render as well as /tournaments.
//   tournament_link_view  — GET /v1/games/:id/tournament-link, called on every
//                           /games/[id] render.
//
// The splits are the fix for the 2026-08-05 outage (#196) and its sibling: a
// read that a high-traffic page makes on every render must not share a budget
// with the pages it can take down. The link read charged the tournament budget,
// so a crawl of ~270 game pages a minute spent the tournament pages' whole
// hourly allowance and 429'd them; the list read had the same relationship to
// the home page. The tests below pin all three — that each budget is enforced
// *and recorded* on its own path, and that draining one leaves the others
// alone.
//
// Every limit applies to every caller — anonymous and signed-in alike. Scraper
// User-Agents (Discord/Slack/Twitter previewers) are exempt so link unfurls
// always resolve.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament } from "../../helpers/builders";
import { seedEvents, type ReadEventType } from "../../helpers/rate-limit";
import {
	TOURNAMENT_LINK_VIEW_PER_HOUR,
	TOURNAMENT_LIST_VIEW_PER_HOUR,
	TOURNAMENT_VIEW_PER_HOUR,
	tournamentViewPerHour,
} from "../../../src/tournament/limits";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

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

// The audit INSERT that spends a budget slot is fire-and-forget — the handler
// starts it and returns without awaiting, so it can land after the response.
// Poll rather than assert once.
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

// getClientIp ignores CF-Connecting-IP unless CF-RAY is present (an untrusted
// topology collapses to one shared bucket, which would make these tests
// interfere), so every request here carries both.
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

// An unlinked game still exercises the whole gate: the link handler charges
// the budget before it knows whether the game is linked, which is the property
// that made the shared budget an outage.
const linkPath = () => `/v1/games/${nanoid(21)}/tournament-link`;

describe("tournament view rate limit", () => {
	it("returns 429 once the per-IP limit is reached (anonymous caller)", async () => {
		const t = await makeTournament({ slug: "rl-view-test-a" });
		const ip = "203.0.113.10";
		await seedEvents("tournament_view", ip, TOURNAMENT_VIEW_PER_HOUR);

		// The rate-limit check runs before the setup-visibility check, so an
		// over-limit anonymous request 429s regardless of the tournament phase.
		await expectErrorCode(await get(`/v1/tournaments/${t.slug}`, { ip }), {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_VIEW",
		});
	});

	it("scraper User-Agent is exempt from the limit (200 despite the IP being over)", async () => {
		const t = await makeTournament({
			slug: "rl-view-test-b",
			advanceTo: "swiss-round-1-generated",
		});
		const ip = "203.0.113.11";
		await seedEvents("tournament_view", ip, TOURNAMENT_VIEW_PER_HOUR);

		// Scraper UAs bypass the limit, so the public read proceeds even though
		// this IP is over the cap.
		await expectOk(
			await get(`/v1/tournaments/${t.slug}`, { ip, ua: "Twitterbot/1.0" }),
		);
	});

	it("limit applies to the sub-resource reads behind a page load too", async () => {
		const t = await makeTournament({
			slug: "rl-view-test-c",
			advanceTo: "swiss-round-1-generated",
		});
		const ip = "203.0.113.12";
		await seedEvents("tournament_view", ip, TOURNAMENT_VIEW_PER_HOUR);

		// Riders are gated for anyone who isn't our SSR Worker, so a spent budget
		// is met the same way whichever read of the page arrives first.
		await expectErrorCode(
			await get(`/v1/tournaments/${t.tournamentId}/standings`, { ip }),
			{ status: 429, code: "RATE_LIMIT_TOURNAMENT_VIEW" },
		);
	});
});

// The ceiling is read off env on every request so an operator can retune it
// during a live event with `wrangler secret put TOURNAMENT_VIEW_PER_HOUR`
// instead of a redeploy. Substituting the binding here is what that does.
describe("tournament view ceiling is env-tunable", () => {
	const configured = env.TOURNAMENT_VIEW_PER_HOUR;
	afterEach(() => {
		env.TOURNAMENT_VIEW_PER_HOUR = configured;
	});

	it("gates at the env value rather than the compiled-in default", async () => {
		const t = await makeTournament({
			slug: "rl-view-tune-a",
			advanceTo: "swiss-round-1-generated",
		});
		env.TOURNAMENT_VIEW_PER_HOUR = "5";

		// One below the override — far below the constant either way.
		const under = "203.0.113.30";
		await seedEvents("tournament_view", under, 4);
		await expectOk(await get(`/v1/tournaments/${t.slug}`, { ip: under }));

		const at = "203.0.113.31";
		await seedEvents("tournament_view", at, 5);
		await expectErrorCode(await get(`/v1/tournaments/${t.slug}`, { ip: at }), {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_VIEW",
		});
	});

	it("falls back to the constant when the var doesn't parse", async () => {
		// Neither open (a NaN ceiling that never fires) nor shut (a 0 ceiling
		// that 429s everyone) — a mangled value must land exactly where the
		// unset var does.
		const t = await makeTournament({
			slug: "rl-view-tune-b",
			advanceTo: "swiss-round-1-generated",
		});
		env.TOURNAMENT_VIEW_PER_HOUR = "600 per hour";

		const under = "203.0.113.32";
		await seedEvents("tournament_view", under, TOURNAMENT_VIEW_PER_HOUR - 1);
		await expectOk(await get(`/v1/tournaments/${t.slug}`, { ip: under }));

		const at = "203.0.113.33";
		await seedEvents("tournament_view", at, TOURNAMENT_VIEW_PER_HOUR);
		await expectErrorCode(await get(`/v1/tournaments/${t.slug}`, { ip: at }), {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_VIEW",
		});
	});

	it("wrangler.toml's configured value is what the gate uses by default", async () => {
		// The var ships set in both [vars] blocks, so the deployed ceiling is
		// that number, not the constant. They agree today; this fails if the two
		// are ever changed apart.
		//
		// Asserted on the binding, not through tournamentViewPerHour(): every
		// way the var can be missing or mangled resolves to the constant, so
		// routing this through the fallback would pass with no var at all —
		// which is the one thing it exists to catch. Same shape as the link
		// budget's below.
		expect(env.TOURNAMENT_VIEW_PER_HOUR).toBe(String(TOURNAMENT_VIEW_PER_HOUR));
		expect(tournamentViewPerHour(env)).toBe(TOURNAMENT_VIEW_PER_HOUR);
	});
});

describe("tournament list rate limit", () => {
	it("records a tournament_list_view for a served read", async () => {
		const ip = "203.0.113.50";

		await expectOk(await get("/v1/tournaments", { ip }));

		await expectEventsToReach("tournament_list_view", ip, 1);
		// And nothing of the tournament pages' budget — the whole point of the
		// split, since the home page makes this read on every render.
		expect(await countEvents("tournament_view", ip)).toBe(0);
	});

	it("429s once its own per-IP limit is reached", async () => {
		const ip = "203.0.113.51";
		await seedEvents("tournament_list_view", ip, TOURNAMENT_LIST_VIEW_PER_HOUR);

		await expectErrorCode(await get("/v1/tournaments", { ip }), {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_LIST",
		});
	});

	it("leaves the tournament pages up when the list budget is drained", async () => {
		const t = await makeTournament({
			slug: "rl-list-test",
			advanceTo: "swiss-round-1-generated",
		});
		const ip = "203.0.113.52";
		await seedEvents("tournament_list_view", ip, TOURNAMENT_LIST_VIEW_PER_HOUR);

		// A visitor who has exhausted the home page's read...
		await expectErrorCode(await get("/v1/tournaments", { ip }), {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_LIST",
		});
		// ...can still open a tournament.
		await expectOk(await get(`/v1/tournaments/${t.slug}`, { ip }));
	});

	it("serves the list read on an IP whose tournament budget is spent", async () => {
		const ip = "203.0.113.53";
		await seedEvents("tournament_view", ip, TOURNAMENT_VIEW_PER_HOUR);

		await expectOk(await get("/v1/tournaments", { ip }));
	});

	it("scraper User-Agent is exempt from the limit", async () => {
		const ip = "203.0.113.54";
		await seedEvents("tournament_list_view", ip, TOURNAMENT_LIST_VIEW_PER_HOUR);

		await expectOk(await get("/v1/tournaments", { ip, ua: "Twitterbot/1.0" }));
	});

	describe("ceiling is env-tunable", () => {
		const configured = env.TOURNAMENT_LIST_VIEW_PER_HOUR;
		afterEach(() => {
			env.TOURNAMENT_LIST_VIEW_PER_HOUR = configured;
		});

		it("gates at its own env value, leaving the view ceiling alone", async () => {
			const t = await makeTournament({
				slug: "rl-list-tune",
				advanceTo: "swiss-round-1-generated",
			});
			env.TOURNAMENT_LIST_VIEW_PER_HOUR = "5";

			const ip = "203.0.113.55";
			await seedEvents("tournament_list_view", ip, 5);
			await expectErrorCode(await get("/v1/tournaments", { ip }), {
				status: 429,
				code: "RATE_LIMIT_TOURNAMENT_LIST",
			});

			// Same IP, same moment: the tournament pages are gated by the other
			// var, which this override didn't touch.
			await expectOk(await get(`/v1/tournaments/${t.slug}`, { ip }));
		});

		it("wrangler.toml's configured value is what the gate uses by default", async () => {
			expect(env.TOURNAMENT_LIST_VIEW_PER_HOUR).toBe(
				String(TOURNAMENT_LIST_VIEW_PER_HOUR),
			);
		});
	});
});

describe("game tournament-link rate limit", () => {
	it("records a tournament_link_view for a served read", async () => {
		const ip = "203.0.113.40";

		const body = await expectOk<{ link: null }>(await get(linkPath(), { ip }));
		expect(body.link).toBeNull();

		// Reading consumes a slot of its own budget — the guard that keeps the
		// limit from being a no-op on this route now that it no longer records
		// to the tournament one.
		await expectEventsToReach("tournament_link_view", ip, 1);
		// ...and it consumes nothing of the tournament budget. This is the
		// outage: 600 of these used to leave the tournament pages with none.
		expect(await countEvents("tournament_view", ip)).toBe(0);
	});

	it("429s once its own per-IP limit is reached", async () => {
		const ip = "203.0.113.41";
		await seedEvents("tournament_link_view", ip, TOURNAMENT_LINK_VIEW_PER_HOUR);

		await expectErrorCode(await get(linkPath(), { ip }), {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_LINK",
		});
	});

	it("serves the link read on an IP whose tournament budget is spent", async () => {
		const ip = "203.0.113.42";
		await seedEvents("tournament_view", ip, TOURNAMENT_VIEW_PER_HOUR);

		await expectOk(await get(linkPath(), { ip }));
	});

	it("leaves the tournament pages up when the link budget is drained", async () => {
		const t = await makeTournament({
			slug: "rl-link-test",
			advanceTo: "swiss-round-1-generated",
		});
		const ip = "203.0.113.43";
		await seedEvents("tournament_link_view", ip, TOURNAMENT_LINK_VIEW_PER_HOUR);

		// The crawler's own endpoint is capped...
		await expectErrorCode(await get(linkPath(), { ip }), {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_LINK",
		});
		// ...and the tournament page it used to take down still serves.
		await expectOk(await get(`/v1/tournaments/${t.slug}`, { ip }));
	});

	it("scraper User-Agent is exempt from the limit", async () => {
		const ip = "203.0.113.44";
		await seedEvents("tournament_link_view", ip, TOURNAMENT_LINK_VIEW_PER_HOUR);

		await expectOk(await get(linkPath(), { ip, ua: "Twitterbot/1.0" }));
	});

	// Its own knob, not the view one: the incident that drains this budget is
	// the incident an operator is retuning during, and the two must move
	// independently or the split they're built on is undone by the fix.
	describe("ceiling is env-tunable", () => {
		const configured = env.TOURNAMENT_LINK_VIEW_PER_HOUR;
		afterEach(() => {
			env.TOURNAMENT_LINK_VIEW_PER_HOUR = configured;
		});

		it("gates at its own env value, leaving the view ceiling alone", async () => {
			env.TOURNAMENT_LINK_VIEW_PER_HOUR = "5";

			const ip = "203.0.113.45";
			await seedEvents("tournament_link_view", ip, 5);
			await expectErrorCode(await get(linkPath(), { ip }), {
				status: 429,
				code: "RATE_LIMIT_TOURNAMENT_LINK",
			});

			// Same IP, same moment: the tournament pages are gated by another
			// var, which this override didn't touch.
			const t = await makeTournament({
				slug: "rl-link-tune",
				advanceTo: "swiss-round-1-generated",
			});
			await expectOk(await get(`/v1/tournaments/${t.slug}`, { ip }));
		});

		it("wrangler.toml's configured value is what the gate uses by default", async () => {
			expect(env.TOURNAMENT_LINK_VIEW_PER_HOUR).toBe(
				String(TOURNAMENT_LINK_VIEW_PER_HOUR),
			);
		});
	});
});
