// GET /v1/home-summary — the home page's stats panels.
//
// The trim itself is pinned by src/stats/home-summary.test.ts, which calls
// homeSummaryFrom directly. What is left to this file is everything that is
// only true of the endpoint: that it answers anonymously where /v1/stats does
// not, that it reads the precomputed entry and never builds one, which of the
// three answers a request gets (current, stale, nothing), and the budget it
// spends getting there.
//
// No corpus is uploaded here, deliberately. Every sibling stats file seeds
// games because its endpoint computes; this one cannot, so the only state that
// matters is what is in KV — and a file that never uploads is also a file that
// would fail loudly if the handler ever grew a path to D1.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { CURRENT_PARSER_VERSION } from "../../../src/schemas/game";
import {
	BUNDLE_SCHEMA_VERSION,
	cacheKeyToString,
} from "../../../src/stats/cache";
import {
	HOME_ARCHETYPE_MIN_GAMES,
	HOME_SUMMARY_VIEW_PER_HOUR,
	type HomeSummaryResponse,
} from "../../../src/stats/handlers";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// The entry every case here seeds or clears: the unfaceted `duel` slice over
// the all-time window, which is the one selection this endpoint can read and
// the /stats default. Spelled out rather than defaulted, because a key field
// this file gets wrong is one both the seed and the read get wrong together —
// which is a green suite over an endpoint that finds nothing in production.
const duelKey = (parser_version = CURRENT_PARSER_VERSION): string =>
	cacheKeyToString({
		kind: "global",
		slice: "duel",
		nations: [],
		period: "all",
		parser_version,
	});

// A cached bundle carrying the three fields home draws AND the bulk it doesn't
// — wonderStats/yieldCurves/lawTiming are the reason the trim exists, so they
// have to be in the seeded entry for their absence downstream to mean anything.
function seedBundle(over: Record<string, unknown> = {}): string {
	return JSON.stringify({
		meta: { game_count: 603, parser_version: CURRENT_PARSER_VERSION },
		summary: { total_games: 603, avg_total_turns: 118 },
		nationWinRate: [
			{ nation: "NATION_ROME", games: 200, wins: 110, rate: 0.55 },
		],
		capitalFamilyWinRate: [
			{
				family_class: "FAMILYCLASS_CHAMPIONS",
				games: 180,
				wins: 95,
				rate: 0.528,
			},
		],
		startingArchetypeWinRate: [
			{ archetype: "ARCHETYPE_COMMANDER", games: 400, wins: 210, rate: 0.525 },
		],
		wonderStats: [{ wonder: "IMPROVEMENT_PYRAMIDS", built: 40 }],
		yieldCurves: {
			turns: [1, 2],
			counts: [603, 600],
			series: {},
			outcome: null,
		},
		lawTiming: [{ nation: "__all__", law: "LAW_TYRANNY", median_turn: 30 }],
		...over,
	});
}

const putBundle = (key: string, body: string): Promise<void> =>
	env.SESSIONS_KV.put(key, body, { expirationTtl: 3600 });

// getClientIp ignores CF-Connecting-IP without CF-RAY, and without it every
// case in this file would share the "untrusted" budget and 429 its neighbours.
const fetchSummary = (
	ip: string,
	extra: Record<string, string> = {},
): Promise<Response> =>
	SELF.fetch("http://test/v1/home-summary", {
		headers: { "CF-Connecting-IP": ip, "CF-RAY": "test-ray", ...extra },
	});

const summary = async (ip: string): Promise<HomeSummaryResponse> =>
	expectOk<HomeSummaryResponse>(await fetchSummary(ip));

describe("GET /v1/home-summary answers", () => {
	// Every other case here seeds through duelKey and reads through the
	// endpoint, so a key this file spells wrong is one both halves spell wrong
	// together and the suite stays green over an endpoint that finds nothing in
	// production. Pinning the literal is what breaks that symmetry: the same
	// string is asserted from the other end by src/stats/cache.test.ts, whose
	// unfaceted case is this exact selection, so the two cannot drift apart
	// without one of them failing.
	it("reads the key the crons write", () => {
		expect(duelKey("2.15.0")).toBe(
			`stats:v${BUNDLE_SCHEMA_VERSION}-p2.15.0:global:duel::all`,
		);
	});

	it("serves the precomputed entry, trimmed to the fields home draws", async () => {
		await putBundle(duelKey(), seedBundle());

		const body = await summary("203.0.113.60");
		expect(Object.keys(body.summary ?? {}).sort()).toEqual([
			"capitalFamilyWinRate",
			"nationWinRate",
			"startingArchetypeWinRate",
		]);
		// The bulk the trim exists for, and `meta` with it: seeded above, absent
		// here. This is the assertion that would fail if the endpoint ever
		// started forwarding the bundle whole.
		expect(body.summary).not.toHaveProperty("wonderStats");
		expect(body.summary).not.toHaveProperty("yieldCurves");
		expect(body.summary).not.toHaveProperty("lawTiming");
		expect(body.summary).not.toHaveProperty("meta");
		expect(body.summary?.nationWinRate).toEqual([
			{ nation: "NATION_ROME", games: 200, wins: 110, rate: 0.55 },
		]);
	});

	it("floors the archetype rows server-side", async () => {
		// The frontend never sees the thin row, which is the point of putting
		// the floor here rather than in the panel: home can't render an
		// unfloored rate by slicing differently.
		await putBundle(
			duelKey(),
			seedBundle({
				startingArchetypeWinRate: [
					{
						archetype: "ARCHETYPE_DIPLOMAT",
						games: HOME_ARCHETYPE_MIN_GAMES - 1,
						wins: 8,
						rate: 0.727,
					},
					{
						archetype: "ARCHETYPE_COMMANDER",
						games: HOME_ARCHETYPE_MIN_GAMES,
						wins: 26,
						rate: 0.52,
					},
				],
			}),
		);

		const body = await summary("203.0.113.61");
		expect(
			body.summary?.startingArchetypeWinRate.map((r) => r.archetype),
		).toEqual(["ARCHETYPE_COMMANDER"]);
	});

	it("answers a cold key with null rather than building a bundle", async () => {
		// The whole reason this endpoint exists rather than an anonymous door
		// onto /v1/stats. Nothing is written back: an anonymous caller must not
		// be able to trigger a whole-corpus aggregation, and the env type is
		// what enforces it — this is the behaviour that property buys.
		const key = duelKey();
		await env.SESSIONS_KV.delete(key);

		const body = await summary("203.0.113.62");
		expect(body).toEqual({ summary: null });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await env.SESSIONS_KV.get(key)).toBeNull();
	});

	it("serves last night's bundle across a parser bump", async () => {
		// A Worker deploy that bumps CURRENT_PARSER_VERSION orphans the key at
		// once, and the warm that rebuilds it runs hourly. Without this reach,
		// home would drop its whole stats region for up to an hour while
		// /v1/stats, which does reach across, kept serving.
		await env.SESSIONS_KV.delete(duelKey());
		await putBundle(
			duelKey("0.0.1-stale"),
			seedBundle({
				nationWinRate: [
					{ nation: "NATION_CARTHAGE", games: 12, wins: 7, rate: 0.583 },
				],
			}),
		);

		const body = await summary("203.0.113.63");
		expect(body.summary?.nationWinRate).toEqual([
			{ nation: "NATION_CARTHAGE", games: 12, wins: 7, rate: 0.583 },
		]);
	});

	it("starts no rebuild behind the stale answer", async () => {
		// Where /v1/stats kicks off a refresh under ctx.waitUntil, this handler
		// structurally cannot — so the warm cron is what ends the stale window,
		// and the current-version key stays absent until it runs.
		const fresh = duelKey();
		await env.SESSIONS_KV.delete(fresh);
		await putBundle(
			duelKey("0.0.1-stale"),
			seedBundle({
				nationWinRate: [
					{ nation: "NATION_BABYLONIA", games: 9, wins: 4, rate: 0.444 },
				],
			}),
		);

		// Asserted together: a stale answer was served AND nothing was written
		// back. Without the first half this case would pass for the wrong
		// reason — a handler that reached for no stale entry at all writes
		// nothing either.
		const body = await summary("203.0.113.64");
		expect(body.summary?.nationWinRate[0].nation).toBe("NATION_BABYLONIA");
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(await env.SESSIONS_KV.get(fresh)).toBeNull();
	});

	it("lets the edge cache the response and keeps it out of the browser's", async () => {
		await putBundle(duelKey(), seedBundle());
		const res = await fetchSummary("203.0.113.65");
		expect(res.headers.get("Cache-Control")).toBe(
			"public, max-age=0, s-maxage=60",
		);
	});
});

describe("GET /v1/home-summary auth", () => {
	it("serves an anonymous caller", async () => {
		// The difference from /v1/stats, which 401s here. The session gate there
		// is about who may spend a whole-corpus aggregation, and this endpoint
		// cannot spend one — so there is nothing for a gate to protect, and home
		// is anonymous.
		await putBundle(duelKey(), seedBundle());
		const res = await fetchSummary("203.0.113.70");
		expect(res.status).toBe(200);
	});
});

// Fill an IP's hourly bucket without firing N real reads — the same recursive
// CTE the sibling budget tests use (stats/global-endpoint.test.ts,
// tournament/rate-limit-view.test.ts).
async function seedEvents(
	eventType: "home_summary_view" | "anon_read" | "global_stats_view",
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

async function countEvents(eventType: string, ip: string): Promise<number> {
	const row = await env.SHARE_DB.prepare(
		`SELECT COUNT(*) AS n FROM events
		 WHERE event_type = ? AND ip_address = ?`,
	)
		.bind(eventType, ip)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

describe("GET /v1/home-summary rate limit", () => {
	it("charges a home_summary_view for a served read", async () => {
		const ip = "203.0.113.80";
		await putBundle(duelKey(), seedBundle());
		await summary(ip);
		// The audit insert is fire-and-forget, so it can land after the response.
		for (let i = 0; i < 50; i++) {
			if ((await countEvents("home_summary_view", ip)) >= 1) break;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(await countEvents("home_summary_view", ip)).toBe(1);
	});

	it("returns 429 once the per-IP ceiling is reached", async () => {
		const ip = "203.0.113.81";
		await seedEvents("home_summary_view", ip, HOME_SUMMARY_VIEW_PER_HOUR);
		await expectErrorCode(await fetchSummary(ip), {
			status: 429,
			code: "RATE_LIMIT_HOME_SUMMARY",
		});
	});

	it("spends its own budget, not anon_read's", async () => {
		// One home page load spends both — the discovery feed takes anon_read —
		// so pooling them would halve the page's headroom against itself.
		const ip = "203.0.113.82";
		await putBundle(duelKey(), seedBundle());
		await seedEvents("home_summary_view", ip, HOME_SUMMARY_VIEW_PER_HOUR);

		await expectErrorCode(await fetchSummary(ip), {
			status: 429,
			code: "RATE_LIMIT_HOME_SUMMARY",
		});
		const games = await SELF.fetch("http://test/v1/games/public-recent", {
			headers: { "CF-Connecting-IP": ip, "CF-RAY": "test-ray" },
		});
		expect(games.status).toBe(200);
	});

	it("does not spend global_stats_view's budget either", async () => {
		// The other direction of the same rule: /stats is session-gated where
		// this is anonymous, so a crawl of the landing page must not decide when
		// signed-in visitors stop getting charts.
		const ip = "203.0.113.83";
		await putBundle(duelKey(), seedBundle());
		await seedEvents("global_stats_view", ip, HOME_SUMMARY_VIEW_PER_HOUR);
		expect((await fetchSummary(ip)).status).toBe(200);
	});

	it("does not charge the budget for a refused read", async () => {
		const ip = "203.0.113.84";
		await seedEvents("home_summary_view", ip, HOME_SUMMARY_VIEW_PER_HOUR + 5);
		await fetchSummary(ip);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await countEvents("home_summary_view", ip)).toBe(
			HOME_SUMMARY_VIEW_PER_HOUR + 5,
		);
	});
});
