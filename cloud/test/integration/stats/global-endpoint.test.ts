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
// The selection cases matter because all three params are parsed forgivingly.
// A slice, nation or period that doesn't parse degrades to a neighbouring view
// rather than 400ing, which is the right behaviour for a bookmark that outlived
// a deploy — and also the behaviour that would hide a parser wired to the wrong
// param, since every answer still looks like a bundle.
//
// Both of the endpoint's payloads are read here, not just the bundle: the
// selection is parsed once for the two of them (handleGlobalStatsPayload), so a
// facet that reached one and not the other would put the Records tab on a
// different corpus from the charts beside it.

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
	RecordsBundle,
} from "../../../src/stats/types";
import { makeUser, type TestUser } from "../../helpers/builders";
import { postMultipart } from "../../helpers/requests";
import {
	buildUploadFormData,
	daysAgo,
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

// Each fixture is dated explicitly, because the recency window cuts on
// save_date and DEFAULT_SAVE_DATE is a literal whose vintage would decide the
// window cases (helpers/save-blob.ts — daysAgo).
//
// Three bands, one per window, so each window is observably its own rather than
// agreeing with its neighbour by accident: RECENT is inside both, MIDDLE inside
// 12m only, ANCIENT outside both. Each clears its boundary by nearly three
// months, so nothing here turns on which month the suite runs in.
const RECENT = daysAgo(30);
const MIDDLE = daysAgo(270);
const ANCIENT = daysAgo(540);

const CORPUS = {
	// Egypt against Rome — the corpus's only public duel, and so the whole of
	// the slice this endpoint defaults to. Recent, so every case that reads the
	// default slice reads the same one game whatever window it asks for.
	duel: { winnerIndex: 0, turns: turnsFor(2), saveDate: RECENT },
	// The same composition, made private below. Nothing here should ever see
	// it: is_public = 1 is the endpoint's whole visibility rule.
	duel_private: { winnerIndex: 1, turns: turnsFor(2), saveDate: RECENT },
	// Egypt, Rome and Greece.
	ffa: { winnerIndex: 0, humans: 3, turns: turnsFor(3), saveDate: MIDDLE },
	// One human Egypt against an AI Rome.
	ai_rome: {
		winnerIndex: 0,
		humans: 1,
		aiPlayer: true,
		turns: turnsFor(1),
		saveDate: ANCIENT,
	},
} satisfies Record<string, UploadFixtureOpts>;

// The corpus's uploader, and the signed-in viewer every read below is made as.
// One user for both: the endpoint reads nothing off the session but its
// existence, so who is holding it makes no difference to the payload.
let viewer: TestUser;

// game_id per fixture, so a case can say which games a selection kept rather
// than only how many — which is the difference between pinning the window and
// pinning a count two different windows could both produce.
type Label = keyof typeof CORPUS;
const gameIds = new Map<Label, string>();
const idOf = (label: Label): string => {
	const id = gameIds.get(label);
	if (id === undefined) throw new Error(`no fixture uploaded for ${label}`);
	return id;
};

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	const user = await makeUser();
	viewer = user;
	for (const [label, opts] of Object.entries(CORPUS) as Array<
		[Label, UploadFixtureOpts]
	>) {
		const res = await postMultipart({
			path: "/v1/games",
			form: await buildUploadFormData(opts),
			as: user,
		});
		expect(res.status).toBe(201);
		const { game_id } = await res.json<{ game_id: string }>();
		gameIds.set(label, game_id);
	}
	// A first upload takes its visibility from users.default_game_public, which
	// defaults to public; this fixture opts back out.
	await env.SHARE_DB.prepare("UPDATE games SET is_public = 0 WHERE game_id = ?")
		.bind(idOf("duel_private"))
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

// The records sibling. Same preamble, same selection parse, its own payload and
// its own key — so reading it here is how a facet is shown to reach both halves
// of what one page renders.
const records = async (query: string, ip: string): Promise<RecordsBundle> =>
	expectOk<RecordsBundle>(
		await SELF.fetch(`http://test/v1/stats/records${query}`, {
			headers: {
				"CF-Connecting-IP": ip,
				"CF-RAY": "test-ray",
				Cookie: `session=${viewer.sessionToken}`,
			},
		}),
	);

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

// Clear an entry, so a case that needs one absent *establishes* that rather
// than inheriting it.
//
// Storage is shared across the cases in an integration file — nothing here
// isolates it per test — so a bare `toBeNull()` precondition asserts only that
// no earlier case happened to write the key. That reserves a selection to one
// case by a convention nothing enforces, and the day it is broken the case
// fails as a confusing "expected {...} to be null" rather than as a statement
// about caching. Deleting first costs one call and owes the rest of the file
// nothing.
const clearCached = async (
	key: Parameters<typeof cacheKeyToString>[0],
	payload?: Parameters<typeof cacheKeyToString>[1],
): Promise<void> => {
	await env.SESSIONS_KV.delete(cacheKeyToString(key, payload));
};

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

describe("GET /v1/stats recency window", () => {
	// The corpus holds three public games, one in each date band, so the three
	// windows read 3 / 2 / 1 over the "all" slice. Distinct counts rather than a
	// shared one: a window wired to the wrong token, or to no token at all,
	// would still answer every request with a plausible-looking bundle.
	it("narrows the corpus to the games played inside the window", async () => {
		expect((await bundle("?slice=all", "203.0.113.50")).meta.game_count).toBe(
			3,
		);
		expect(
			(await bundle("?slice=all&period=12m", "203.0.113.51")).meta.game_count,
		).toBe(2);
		expect(
			(await bundle("?slice=all&period=6m", "203.0.113.52")).meta.game_count,
		).toBe(1);
	});

	it("keeps the seats of the games it kept", async () => {
		// The window narrows the games and nothing else (design §4.4), so the
		// surviving duel contributes both of its seats. A window that had
		// narrowed the focal set too would band one row here and report 1.
		const six = await bundle("?slice=all&period=6m", "203.0.113.53");
		expect(six.yieldCurves.counts).toEqual(Array(TURNS).fill(2));
		expect(six.nations.map((n) => n.nation).sort()).toEqual([EGYPT, ROME]);
	});

	it("falls back to all time on a period it doesn't know", async () => {
		// Same forgiveness as ?slice= and ?nation=: a bookmark that outlived a
		// rename degrades to the widest window rather than 400ing.
		expect(
			(await bundle("?slice=all&period=6mo", "203.0.113.54")).meta.game_count,
		).toBe(3);
	});

	it("ANDs the window with the slice and the nation", async () => {
		// Greece is seated only in the FFA, which is inside the 12-month window
		// and outside the 6-month one — so the same selection is one game under
		// the wider window and none under the narrower.
		expect(
			(
				await bundle(
					"?slice=ffa&nation=NATION_GREECE&period=12m",
					"203.0.113.55",
				)
			).meta.game_count,
		).toBe(1);
		expect(
			(
				await bundle(
					"?slice=ffa&nation=NATION_GREECE&period=6m",
					"203.0.113.56",
				)
			).meta.game_count,
		).toBe(0);
	});

	it("does not serve the all-time entry to a narrowed window", async () => {
		// The windows are separate keys (stats/cache.ts), and this is that
		// separation seen from outside: a sentinel under the all-time key must
		// not answer a ?period= request, or the facet would read as a control
		// that does nothing for up to a cache lifetime.
		await env.SESSIONS_KV.put(
			cacheKeyToString(globalKey("single_player", [])),
			JSON.stringify({ tag: "all time" }),
			{ expirationTtl: 3600 },
		);
		expect(
			await expectOk(await get("?slice=single_player", "203.0.113.57")),
		).toEqual({ tag: "all time" });

		const windowed = await bundle(
			"?slice=single_player&period=12m",
			"203.0.113.58",
		);
		expect(windowed.meta.parser_version).toBe(CURRENT_PARSER_VERSION);
		// ai_rome is the only single-player game and it is outside both windows.
		expect(windowed.meta.game_count).toBe(0);
	});

	it("caches a narrowed window beside the all-time entry, not over it", async () => {
		// The crons warm the all-time window only (precompute.ts), so a narrowed
		// one is built on the first request that asks for it and then lives 24h
		// like any other entry.
		//
		// Egypt in the "all" slice, because it is seated in all three public
		// games — so the two windows hold observably different payloads (3 and 2)
		// and "beside, not over" is a claim the counts can carry. A selection
		// both windows counted the same could not distinguish the entries.
		const windowed = globalKey("all", [EGYPT], CURRENT_PARSER_VERSION, "12m");
		const allTime = globalKey("all", [EGYPT]);
		await clearCached(windowed);
		await clearCached(allTime);
		expect(await getCached<ChartBundleCore>(env, windowed)).toBeNull();
		expect(await getCached<ChartBundleCore>(env, allTime)).toBeNull();

		// Egypt is seated in all three public games, one per date band.
		expect(
			(
				await bundle(
					"?slice=all&nation=NATION_EGYPT&period=12m",
					"203.0.113.59",
				)
			).meta.game_count,
		).toBe(2);
		expect(
			(await bundle("?slice=all&nation=NATION_EGYPT", "203.0.113.60")).meta
				.game_count,
		).toBe(3);

		expect(
			(await getCached<ChartBundleCore>(env, windowed))?.meta.game_count,
		).toBe(2);
		expect(
			(await getCached<ChartBundleCore>(env, allTime))?.meta.game_count,
		).toBe(3);
	});
});

describe("GET /v1/stats/records honours the selection", () => {
	// The records are a second payload off one preamble, so the window has to
	// reach them as well — a Records tab on the all-time corpus under a
	// six-month heading is the charts beside it disagreeing with it.
	it("narrows the record boards by the same window", async () => {
		const all = await records("?slice=all", "203.0.113.70");
		expect(Object.keys(all.recordGames).sort()).toEqual(
			[idOf("duel"), idOf("ffa"), idOf("ai_rome")].sort(),
		);

		const six = await records("?slice=all&period=6m", "203.0.113.71");
		expect(Object.keys(six.recordGames)).toEqual([idOf("duel")]);
	});

	it("falls back to all time on a period it doesn't know", async () => {
		const body = await records("?slice=all&period=6mo", "203.0.113.72");
		expect(Object.keys(body.recordGames).sort()).toEqual(
			[idOf("duel"), idOf("ffa"), idOf("ai_rome")].sort(),
		);
	});

	it("keys its own payload per window", async () => {
		// The records live at the bundle's key plus a ":records" segment, so the
		// period has to be in the part they share — otherwise the two windows'
		// boards collide on one entry.
		const six = cacheKeyToString(
			globalKey("all", [], CURRENT_PARSER_VERSION, "6m"),
			"records",
		);
		const allTime = cacheKeyToString(globalKey("all", []), "records");
		expect(six).not.toBe(allTime);
		await records("?slice=all&period=6m", "203.0.113.73");
		expect(await kvHas(six)).toBe(true);
	});
});

describe("GET /v1/stats caching", () => {
	it("caches what it computed on a miss", async () => {
		await clearCached(globalKey("ffa", [GREECE]));
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
		await clearCached(globalKey("all", [GREECE]));
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
		// after the night's precompute is bounded by the shared cache's 60s
		// rather than by a browser TTL.
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
