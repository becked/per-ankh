// GET /v1/stats — the chart bundle over the whole public corpus.
//
// The corpus itself is pinned by global-corpus.test.ts and the nightly warm by
// precompute.test.ts. What is left to this file is the endpoint: who may call
// it, how a URL becomes a selection, which of the three answers a request gets
// (cached, stale, computed), and the budget it spends getting there.
//
// "Public corpus" is about which games are in it, not who may read it: the
// endpoint requires a session, so every case below signs in. `is_public = 1`
// is still the whole visibility rule, and a signed-in caller sees exactly that
// and nothing of their own.
//
// The selection cases matter because both params are parsed forgivingly. A
// slice or nation that doesn't parse degrades to a neighbouring view rather
// than 400ing, which is the right behaviour for a bookmark that outlived a
// deploy — and also the behaviour that would hide a parser wired to the wrong
// param, since every answer still looks like a bundle.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { CURRENT_PARSER_VERSION } from "../../../src/schemas/game";
import {
	BUNDLE_SCHEMA_VERSION,
	cacheKeyToString,
	getCached,
} from "../../../src/stats/cache";
import { GLOBAL_STATS_VIEW_PER_HOUR } from "../../../src/stats/handlers";
import type {
	ChartBundleCore,
	GlobalPeriod,
	GlobalSlice,
} from "../../../src/stats/types";
import { makeUser, type TestUser } from "../../helpers/builders";
import { postMultipart } from "../../helpers/requests";
import {
	buildUploadFormData,
	type UploadFixtureOpts,
} from "../../helpers/save-blob";

// Nations follow the roster seat (test/helpers/save-blob.ts): seat 0 is Egypt,
// seat 1 Rome, seat 2 Greece — the AI seat included.
const EGYPT = "NATION_EGYPT";
const ROME = "NATION_ROME";
const GREECE = "NATION_GREECE";

const TURNS = 3;
const turnsFor = (seats: number): UploadFixtureOpts["turns"] =>
	Array.from({ length: seats }, (_, player) => ({
		player,
		values: Array.from({ length: TURNS }, (_, t) => 10 + player * 5 + t),
	}));

const CORPUS = {
	// Egypt against Rome — the corpus's only public duel, and so the whole of
	// the slice this endpoint defaults to.
	duel: { winnerIndex: 0, turns: turnsFor(2) },
	// The same composition, made private below. Nothing here should ever see
	// it: is_public = 1 is the endpoint's whole visibility rule.
	duel_private: { winnerIndex: 1, turns: turnsFor(2) },
	// Egypt, Rome and Greece.
	ffa: { winnerIndex: 0, humans: 3, turns: turnsFor(3) },
	// One human Egypt against an AI Rome.
	ai_rome: { winnerIndex: 0, humans: 1, aiPlayer: true, turns: turnsFor(1) },
} satisfies Record<string, UploadFixtureOpts>;

// The corpus's uploader, and the signed-in viewer every read below is made as.
// One user for both: the endpoint reads nothing off the session but its
// existence, so who is holding it makes no difference to the payload.
let viewer: TestUser;

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	const user = await makeUser();
	viewer = user;
	const ids: string[] = [];
	for (const opts of Object.values(CORPUS) as UploadFixtureOpts[]) {
		const res = await postMultipart({
			path: "/v1/games",
			form: await buildUploadFormData(opts),
			as: user,
		});
		expect(res.status).toBe(201);
		const { game_id } = await res.json<{ game_id: string }>();
		ids.push(game_id);
	}
	// A first upload takes its visibility from users.default_game_public, which
	// defaults to public; the second fixture opts back out.
	await env.SHARE_DB.prepare("UPDATE games SET is_public = 0 WHERE game_id = ?")
		.bind(ids[1])
		.run();
});

// getClientIp ignores CF-Connecting-IP unless CF-RAY is present, and without it
// every case in this file would share the "untrusted" budget and start 429ing
// its neighbours. Each case passes its own address.
//
// `session` is omitted only by the gate cases below; every other read carries
// the viewer's, because without one the handler never reaches a selection.
const fetchStats = (
	query: string,
	ip: string,
	extra: Record<string, string> = {},
): Promise<Response> =>
	SELF.fetch(`http://test/v1/stats${query}`, {
		headers: { "CF-Connecting-IP": ip, "CF-RAY": "test-ray", ...extra },
	});

const get = (query: string, ip: string): Promise<Response> =>
	fetchStats(query, ip, { Cookie: `session=${viewer.sessionToken}` });

const bundle = async (query: string, ip: string): Promise<ChartBundleCore> =>
	expectOk<ChartBundleCore>(await get(query, ip));

const globalKey = (
	slice: GlobalSlice,
	nations: string[],
	parser_version = CURRENT_PARSER_VERSION,
	// The nightly and the request path both key on the all-time window;
	// a narrowed one is only ever built on demand (precompute.ts).
	period: GlobalPeriod = "all",
) => ({ kind: "global", slice, nations, period, parser_version }) as const;

const cachedBundle = (
	slice: GlobalSlice,
	nations: string[],
): Promise<ChartBundleCore | null> =>
	getCached<ChartBundleCore>(env, globalKey(slice, nations));

const kvHas = async (name: string): Promise<boolean> =>
	(await env.SESSIONS_KV.get(name)) !== null;

describe("GET /v1/stats selection", () => {
	it("defaults to the duel slice", async () => {
		// The corpus holds three public games and one public duel, so the
		// default is observable in the count alone. "all" would read 3.
		const body = await bundle("", "203.0.113.1");
		expect(body.meta.game_count).toBe(1);
		expect(body.meta.parser_version).toBe(CURRENT_PARSER_VERSION);
	});

	it("falls back to the duel default on a slice it doesn't know", async () => {
		// A bookmark that outlived a rename, or a hand-edited URL.
		const body = await bundle("?slice=teams", "203.0.113.2");
		expect(body.meta.game_count).toBe(1);
	});

	it("serves the slice that was asked for", async () => {
		// Three public games; the private duel is in none of them.
		expect((await bundle("?slice=all", "203.0.113.3")).meta.game_count).toBe(3);
		expect((await bundle("?slice=ffa", "203.0.113.4")).meta.game_count).toBe(1);
		expect(
			(await bundle("?slice=single_player", "203.0.113.5")).meta.game_count,
		).toBe(1);
	});

	it("narrows both the games and the seats on ?nation=", async () => {
		// The unfaceted duel holds both seats; Rome's selection holds one. A
		// facet that narrowed only the games would still band the Egyptian's
		// rows and report 2 here.
		const all = await bundle("?slice=duel", "203.0.113.6");
		expect(all.yieldCurves.counts).toEqual(Array(TURNS).fill(2));

		const rome = await bundle("?slice=duel&nation=NATION_ROME", "203.0.113.7");
		expect(rome.meta.game_count).toBe(1);
		expect(rome.yieldCurves.counts).toEqual(Array(TURNS).fill(1));
		expect(rome.nations).toEqual([{ nation: ROME, games_played: 1 }]);
	});

	it("ignores a nation that isn't a zType", async () => {
		const body = await bundle("?slice=duel&nation=rome", "203.0.113.8");
		expect(body.yieldCurves.counts).toEqual(Array(TURNS).fill(2));
		expect(body.nations.map((n) => n.nation).sort()).toEqual([EGYPT, ROME]);
	});

	it("returns the empty bundle for a nation nobody is seated as", async () => {
		// Shape-valid, so it reaches the resolver and selects nothing. The
		// bundle still arrives fully shaped — the frontend dereferences its
		// fields directly.
		const body = await bundle(
			"?slice=duel&nation=NATION_NOWHERE",
			"203.0.113.9",
		);
		expect(body.meta.game_count).toBe(0);
		expect(body.summary.total_games).toBe(0);
		expect(body.nations).toEqual([]);
	});

	it("does not cache a selection that resolves to nothing", async () => {
		// One KV write per distinct string anyone can mint from the URL bar,
		// and the entry saves nothing: an empty corpus short-circuits the
		// aggregator without a query.
		expect(await cachedBundle("duel", ["NATION_NOWHERE"])).toBeNull();
	});

	it("does not reach for a stale entry when the selection has no games", async () => {
		// Never cached and therefore missing forever, so the serve-stale lookup
		// would walk every stats key in the namespace on every request — and
		// find nothing, because an empty selection was never written under any
		// parser version either. The handler resolves first and skips it.
		//
		// Planting an entry under exactly the suffix the walk matches is how the
		// skip is observable from outside: reached for, it would be served.
		await env.SESSIONS_KV.put(
			cacheKeyToString(globalKey("duel", ["NATION_NOWHERE"], "0.0.1-stale")),
			JSON.stringify({ tag: "would have been served" }),
			{ expirationTtl: 3600 },
		);
		const body = await bundle(
			"?slice=duel&nation=NATION_NOWHERE",
			"203.0.113.11",
		);
		expect(body.meta.game_count).toBe(0);
		expect(body.meta.parser_version).toBe(CURRENT_PARSER_VERSION);
	});

	it("excludes the AI's nation from a slice it is only seated in by an AI", async () => {
		// The single-player fixture seats an AI Rome. No focal set can hold it,
		// so the facet finds no game.
		const body = await bundle(
			"?slice=single_player&nation=NATION_ROME",
			"203.0.113.10",
		);
		expect(body.meta.game_count).toBe(0);
	});
});

describe("GET /v1/stats caching", () => {
	it("caches what it computed on a miss", async () => {
		expect(await cachedBundle("ffa", [GREECE])).toBeNull();
		const served = await bundle(
			"?slice=ffa&nation=NATION_GREECE",
			"203.0.113.20",
		);
		expect((await cachedBundle("ffa", [GREECE]))?.yieldCurves.counts).toEqual(
			served.yieldCurves.counts,
		);
	});

	it("serves the cached entry rather than recomputing", async () => {
		// A sentinel under the key the request will build: if the response
		// carries it, the cache was read and the aggregator never ran.
		await env.SESSIONS_KV.put(
			cacheKeyToString(globalKey("ffa", [EGYPT])),
			JSON.stringify({ tag: "precomputed" }),
			{ expirationTtl: 3600 },
		);
		const res = await get("?slice=ffa&nation=NATION_EGYPT", "203.0.113.21");
		expect(await expectOk(res)).toEqual({ tag: "precomputed" });
	});

	it("serves last night's bundle across a parser bump and refreshes behind it", async () => {
		// A parser bump orphans every key without changing the bundle's shape,
		// so the previous entry is merely stale. The response must not wait on
		// the rebuild.
		const stale = cacheKeyToString(globalKey("all", [GREECE], "0.0.1-stale"));
		await env.SESSIONS_KV.put(stale, JSON.stringify({ tag: "last night" }), {
			expirationTtl: 3600,
		});

		const fresh = cacheKeyToString(globalKey("all", [GREECE]));
		expect(await kvHas(fresh)).toBe(false);

		const res = await get("?slice=all&nation=NATION_GREECE", "203.0.113.22");
		expect(await expectOk(res)).toEqual({ tag: "last night" });

		// The rebuild runs behind ctx.waitUntil, so it lands after the response.
		for (let i = 0; i < 50 && !(await kvHas(fresh)); i++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(
			(await getCached<ChartBundleCore>(env, globalKey("all", [GREECE])))?.meta
				.parser_version,
		).toBe(CURRENT_PARSER_VERSION);
	});

	it("recomputes rather than reaching across a bundle-schema bump", async () => {
		// The shape changed, so the pre-bump entry is unreadable and not merely
		// stale — the walk pins the schema segment and leaves only the parser
		// open.
		await env.SESSIONS_KV.put(
			`stats:v${BUNDLE_SCHEMA_VERSION - 1}-p0.0.1-stale:global:ffa:${ROME}`,
			JSON.stringify({ tag: "previous schema" }),
			{ expirationTtl: 3600 },
		);
		const body = await bundle("?slice=ffa&nation=NATION_ROME", "203.0.113.23");
		expect(body.meta.parser_version).toBe(CURRENT_PARSER_VERSION);
	});

	it("lets the edge cache the response and keeps it out of the browser's", async () => {
		// Byte-identical for every viewer and at most nightly fresh, so it takes
		// the same header the other public reads carry. max-age=0 so a reload
		// after the night's precompute shows the new numbers.
		const res = await get("?slice=duel", "203.0.113.24");
		expect(res.headers.get("Cache-Control")).toBe(
			"public, max-age=0, s-maxage=60",
		);
		expect(res.headers.get("Vary")).toBe("Origin");
	});
});

// Fill an IP's hourly bucket without firing N real reads — one statement, the
// same recursive CTE the sibling budget tests use (tournament/
// rate-limit-view.test.ts, games/anon-read-rate-limit.test.ts).
async function seedEvents(
	eventType: "global_stats_view" | "anon_read",
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

describe("GET /v1/stats rate limit", () => {
	it("charges a global_stats_view for a served read", async () => {
		const ip = "203.0.113.30";
		await bundle("?slice=duel", ip);
		// The audit insert is fire-and-forget, so it can land after the response.
		for (let i = 0; i < 50; i++) {
			if ((await countEvents("global_stats_view", ip)) >= 1) break;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(await countEvents("global_stats_view", ip)).toBe(1);
	});

	it("returns 429 once the per-IP ceiling is reached", async () => {
		const ip = "203.0.113.31";
		await seedEvents("global_stats_view", ip, GLOBAL_STATS_VIEW_PER_HOUR);
		await expectErrorCode(await get("?slice=duel", ip), {
			status: 429,
			code: "RATE_LIMIT_GLOBAL_STATS",
		});
	});

	it("spends its own budget, not anon_read's", async () => {
		// Its own budget is the whole point: pooled with the game reads, a crawl
		// of /games/* would decide when /stats starts refusing, and the abuse
		// ceiling would be the same knob as the cold-start ceiling.
		const ip = "203.0.113.32";
		await seedEvents("global_stats_view", ip, GLOBAL_STATS_VIEW_PER_HOUR);

		await expectErrorCode(await get("?slice=duel", ip), {
			status: 429,
			code: "RATE_LIMIT_GLOBAL_STATS",
		});
		const games = await SELF.fetch("http://test/v1/games/public-recent", {
			headers: { "CF-Connecting-IP": ip, "CF-RAY": "test-ray" },
		});
		expect(games.status).toBe(200);
	});

	it("does not charge the budget for a refused read", async () => {
		const ip = "203.0.113.33";
		await seedEvents("global_stats_view", ip, GLOBAL_STATS_VIEW_PER_HOUR + 5);
		await get("?slice=duel", ip);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await countEvents("global_stats_view", ip)).toBe(
			GLOBAL_STATS_VIEW_PER_HOUR + 5,
		);
	});

	it("exempts scraper User-Agents from the budget and the count", async () => {
		// A signed-in scraper, which is the only kind that gets this far — the
		// exemption is about not counting a link-preview fan-out, never about
		// authentication (see the auth block above).
		const ip = "203.0.113.34";
		await seedEvents("global_stats_view", ip, GLOBAL_STATS_VIEW_PER_HOUR);
		const res = await fetchStats("?slice=duel", ip, {
			Cookie: `session=${viewer.sessionToken}`,
			"User-Agent": "Discordbot/2.0",
		});
		expect(res.status).toBe(200);
		expect(await countEvents("global_stats_view", ip)).toBe(
			GLOBAL_STATS_VIEW_PER_HOUR,
		);
	});
});

describe("GET /v1/stats auth", () => {
	it("refuses an anonymous read", async () => {
		// The payload is the same bytes for every viewer, so the gate isn't
		// hiding anything — it is who may spend a whole-corpus aggregation.
		await expectErrorCode(await fetchStats("?slice=duel", "203.0.113.40"), {
			status: 401,
			code: "UNAUTHORIZED",
		});
	});

	it("refuses an anonymous scraper too", async () => {
		// enforceReadRateLimit lets scraper User-Agents past the budget. That
		// exemption never covered authentication, so a link-preview bot with no
		// session is refused like any other anonymous caller — which is why a
		// shared /stats link unfurls as the home page.
		const res = await fetchStats("?slice=duel", "203.0.113.41", {
			"User-Agent": "Discordbot/2.0",
		});
		expect(res.status).toBe(401);
	});

	it("does not spend the budget on a read it refuses", async () => {
		// The session is checked before the rate limit, so an anonymous flood
		// can't drain a shared address's allowance out from under the people
		// signed in behind it.
		const ip = "203.0.113.42";
		await fetchStats("?slice=duel", ip);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await countEvents("global_stats_view", ip)).toBe(0);
	});
});
