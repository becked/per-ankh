// The nightly /stats precompute, the hourly warm, and the serve-stale read
// that covers the gap a version bump opens in them.
//
// Three things need proving here that the resolver tests don't reach. The
// first is that the precompute writes the *faceted* bundle under a faceted key
// — the plausible bug is one loop variable wide, caching the slice's bundle
// under every nation's key, and the resulting page would look right until
// someone compared a nation against itself. The second is that the warm stays
// inside its brief: the four unfaceted bundles, only the ones missing. Warming
// wider is ~856 queries against a 1,000 ceiling; warming unconditionally is a
// day's D1 budget spent overwriting correct entries. The third is the
// dispatch: `scheduled` matches cron patterns by exact table and exact
// constant with no fallback, because staging declares these patterns and not
// the retention sweep's, and a fall-through would delete staging's events the
// first time the two drifted.

import {
	applyD1Migrations,
	createExecutionContext,
	createScheduledController,
	env,
	waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../../../src/index";
import { RETENTION_CRON } from "../../../src/retention";
import { buildChartBundle } from "../../../src/stats/aggregate";
import {
	BUNDLE_SCHEMA_VERSION,
	cacheKeyToString,
	getCached,
	getStaleGlobalCached,
	putCached,
} from "../../../src/stats/cache";
import { CURRENT_PARSER_VERSION } from "../../../src/schemas/game";
import {
	STATS_PRECOMPUTE_CRONS,
	STATS_WARM_CRON,
	precomputeGlobalSlice,
	warmGlobalSlices,
} from "../../../src/stats/precompute";
import { resolveGlobalCorpus } from "../../../src/stats/resolve";
import type {
	ChartBundleCore,
	GlobalPeriod,
	GlobalSlice,
} from "../../../src/stats/types";
import { makeUser } from "../../helpers/builders";
import { postMultipart } from "../../helpers/requests";
import {
	buildUploadFormData,
	type UploadFixtureOpts,
} from "../../helpers/save-blob";

// buildChartBundle only echoes the version into meta.parser_version, so these
// are free to be whatever keeps one test's keys clear of another's. The three
// below are all clear of CURRENT_PARSER_VERSION, which the cron tests write
// under.
const PARSER = "2.4.0";
const STALE_PARSER = "2.13.0";
const FRESH_PARSER = "2.14.0";
// One per warm case, so neither leans on what the other left in KV.
const WARM_COLD_PARSER = "2.5.0";
const WARM_PRESENT_PARSER = "2.6.0";

// Nations follow the roster seat (test/helpers/save-blob.ts): seat 0 is Egypt,
// seat 1 Rome, seat 2 Greece.
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
	// Egypt against Rome — the corpus's only duel.
	duel: { winnerIndex: 0, turns: turnsFor(2) },
	// Egypt, Rome and Greece. Never precomputed: the serve-stale cases below
	// own the `ffa` slice's keys, which is what keeps them independent of
	// whatever the precompute cases leave in KV.
	ffa: { winnerIndex: 0, humans: 3, turns: turnsFor(3) },
	// One human Egypt against an AI Rome. The single-player slice seats a Rome
	// that no focal set can hold, so no Rome bundle should be built for it.
	ai_rome: { winnerIndex: 0, humans: 1, aiPlayer: true, turns: turnsFor(1) },
} satisfies Record<string, UploadFixtureOpts>;

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	// The retention-cron case runs the real sweep, which touches both DBs.
	await applyD1Migrations(env.SECURITY_DB, env.TEST_SECURITY_MIGRATIONS);
	const user = await makeUser();
	for (const opts of Object.values(CORPUS) as UploadFixtureOpts[]) {
		const res = await postMultipart({
			path: "/v1/games",
			form: await buildUploadFormData(opts),
			as: user,
		});
		expect(res.status).toBe(201);
	}
});

const globalKey = (
	slice: GlobalSlice,
	nations: string[],
	parser_version: string,
	// The nightly and the request path both key on the all-time window;
	// a narrowed one is only ever built on demand (precompute.ts).
	period: GlobalPeriod = "all",
) => ({ kind: "global", slice, nations, period, parser_version }) as const;

const cachedBundle = (
	slice: GlobalSlice,
	nations: string[],
	parser_version = PARSER,
): Promise<ChartBundleCore | null> =>
	getCached<ChartBundleCore>(env, globalKey(slice, nations, parser_version));

// Every stats key currently in KV, so a case can assert on what an invocation
// added rather than on the whole namespace.
const statsKeys = async (): Promise<Set<string>> => {
	const names = new Set<string>();
	let cursor: string | undefined;
	do {
		const res = await env.SESSIONS_KV.list({ prefix: "stats:", cursor });
		for (const k of res.keys) names.add(k.name);
		cursor = res.list_complete ? undefined : res.cursor;
	} while (cursor);
	return names;
};

describe("precomputeGlobalSlice", () => {
	it("writes the unfaceted slice plus one bundle per nation seated in it", async () => {
		const before = await statsKeys();
		const result = await precomputeGlobalSlice(env, "duel", PARSER);

		expect(result).toEqual({ selections: 3, games: 1 });
		const added = [...(await statsKeys())].filter((k) => !before.has(k));
		expect(new Set(added)).toEqual(
			new Set(
				[[], [EGYPT], [ROME]].map((nations) =>
					cacheKeyToString(globalKey("duel", nations, PARSER)),
				),
			),
		);
	});

	it("writes the faceted bundle under the faceted key", async () => {
		// The whole slice holds both seats of the duel; Rome's selection holds
		// one. A precompute that built the slice's bundle once and wrote it
		// under every key would report 2 here for Rome.
		const slice = await cachedBundle("duel", []);
		expect(slice?.yieldCurves.counts).toEqual(Array(TURNS).fill(2));

		const rome = await cachedBundle("duel", [ROME]);
		expect(rome?.yieldCurves.counts).toEqual(Array(TURNS).fill(1));
		expect(rome?.nations).toEqual([{ nation: ROME, games_played: 1 }]);
	});

	it("stamps the bundle with the version it keyed on", async () => {
		expect((await cachedBundle("duel", []))?.meta.parser_version).toBe(PARSER);
	});

	it("builds no bundle for a nation only an AI is seated as", async () => {
		const before = await statsKeys();
		const result = await precomputeGlobalSlice(env, "single_player", PARSER);

		// Egypt and the unfaceted slice — the AI's Rome contributes no seat any
		// focal set could hold, so there is nothing to put under a Rome key.
		expect(result).toEqual({ selections: 2, games: 1 });
		const added = [...(await statsKeys())].filter((k) => !before.has(k));
		expect(new Set(added)).toEqual(
			new Set(
				[[], [EGYPT]].map((nations) =>
					cacheKeyToString(globalKey("single_player", nations, PARSER)),
				),
			),
		);
	});
});

// The Rome-in-FFA bundle, cached under STALE_PARSER for the case below to
// find. Built through the real path rather than hand-written, so what
// serve-stale hands back is a bundle and not a stand-in shaped like one.
const cacheStaleFfaRome = async (): Promise<ChartBundleCore> => {
	const corpus = await resolveGlobalCorpus(env, "ffa", {
		nations: [ROME],
		period: "all",
	});
	const bundle = (await buildChartBundle(
		env,
		corpus,
		STALE_PARSER,
		"humans",
	)) as ChartBundleCore;
	await putCached(env, globalKey("ffa", [ROME], STALE_PARSER), bundle);
	return bundle;
};

describe("getStaleGlobalCached", () => {
	it("does not reach across a bundle-schema version", async () => {
		// A schema bump changes the bundle's shape, and consumers dereference
		// its fields directly — so the pre-bump entry is unreadable, not merely
		// stale. Only the parser segment of the key is safe to reach across.
		await env.SESSIONS_KV.put(
			`stats:v${BUNDLE_SCHEMA_VERSION - 1}-p2.12.0:global:ffa:${GREECE}`,
			JSON.stringify({ tag: "previous schema" }),
			{ expirationTtl: 3600 },
		);
		expect(
			await getStaleGlobalCached(env, globalKey("ffa", [GREECE], FRESH_PARSER)),
		).toBeNull();
	});

	it("serves the previous parser version's entry for the same selection", async () => {
		const cached = await cacheStaleFfaRome();
		expect(
			await getCached(env, globalKey("ffa", [ROME], FRESH_PARSER)),
		).toBeNull();

		const stale = await getStaleGlobalCached<ChartBundleCore>(
			env,
			globalKey("ffa", [ROME], FRESH_PARSER),
		);
		expect(stale?.meta.parser_version).toBe(STALE_PARSER);
		expect(stale?.yieldCurves.counts).toEqual(cached.yieldCurves.counts);
	});

	it("does not serve one selection's entry for another's", async () => {
		// Greece plays the same games as Rome does, so only the key's nation
		// segment separates the two lookups.
		expect(
			await getStaleGlobalCached(env, globalKey("ffa", [GREECE], FRESH_PARSER)),
		).toBeNull();
	});

	it("serves the most recently written of several stale entries", async () => {
		// Every entry carries the same 24h TTL, so the greatest expiration is
		// the latest write. Key order would pick the wrong one: parser versions
		// are semver, where "2.9.0" sorts after "2.15.0".
		const raw = (version: string, ttl: number, tag: string) =>
			env.SESSIONS_KV.put(
				cacheKeyToString(globalKey("ffa", [], version)),
				JSON.stringify({ tag }),
				{ expirationTtl: ttl },
			);
		await raw("2.9.0", 3600, "older");
		await raw("2.15.0", 7200, "newer");

		expect(
			await getStaleGlobalCached(env, globalKey("ffa", [], FRESH_PARSER)),
		).toEqual({ tag: "newer" });
	});
});

describe("warmGlobalSlices", () => {
	// The four the nightly builds. Reading them off the cron table rather than
	// listing them again is the same coupling the warm itself has: a fifth slice
	// adds a precompute pattern and both follow it.
	const UNFACETED = Object.values(STATS_PRECOMPUTE_CRONS);

	it("builds every missing unfaceted bundle and no other", async () => {
		const before = await statsKeys();
		const result = await warmGlobalSlices(env, WARM_COLD_PARSER);

		expect(result.checked).toBe(UNFACETED.length);
		expect(new Set(result.built)).toEqual(new Set(UNFACETED));

		const added = [...(await statsKeys())].filter((k) => !before.has(k));
		expect(new Set(added)).toEqual(
			new Set(
				UNFACETED.map((slice) =>
					cacheKeyToString(globalKey(slice, [], WARM_COLD_PARSER)),
				),
			),
		);

		// Stated separately from the set above because it is the constraint, not
		// an incidental consequence of it: the nightly writes one bundle per
		// nation seated in the slice — Egypt and Rome both are, in the duel — and
		// all 56 selections in one invocation is ~856 D1 queries against a
		// 1,000-per-invocation ceiling. The warm builds four.
		expect(await cachedBundle("duel", [EGYPT], WARM_COLD_PARSER)).toBeNull();
		expect(await cachedBundle("duel", [ROME], WARM_COLD_PARSER)).toBeNull();

		// A real bundle over the real corpus, not an empty shell keyed to look
		// like one — the whole point of going through buildGlobalSelection is
		// that the cron and the request path write the same bytes.
		const all = await cachedBundle("all", [], WARM_COLD_PARSER);
		expect(all?.meta.parser_version).toBe(WARM_COLD_PARSER);
		expect(all?.meta.game_count).toBe(Object.keys(CORPUS).length);
	});

	it("leaves an entry that is already present alone", async () => {
		// Sentinels rather than real bundles: the warm has to read one to decide,
		// and anything it rebuilt would overwrite the tag. Steady state is these
		// four KV reads and nothing else.
		const keys = UNFACETED.map((slice) =>
			cacheKeyToString(globalKey(slice, [], WARM_PRESENT_PARSER)),
		);
		for (const key of keys) {
			await env.SESSIONS_KV.put(key, JSON.stringify({ tag: key }), {
				expirationTtl: 3600,
			});
		}

		const before = await statsKeys();
		const result = await warmGlobalSlices(env, WARM_PRESENT_PARSER);

		expect(result).toEqual({ checked: UNFACETED.length, built: [] });
		expect(await statsKeys()).toEqual(before);
		for (const key of keys) {
			expect(await env.SESSIONS_KV.get(key)).toBe(JSON.stringify({ tag: key }));
		}
	});
});

describe("cron dispatch", () => {
	const fire = async (cron: string): Promise<void> => {
		const ctx = createExecutionContext();
		await worker.scheduled(
			createScheduledController({ scheduledTime: new Date(), cron }),
			// The test env declares only the bindings tests touch; the worker's
			// Env also lists config vars neither job reads — cast the gap.
			env as unknown as Parameters<typeof worker.scheduled>[1],
			ctx,
		);
		await waitOnExecutionContext(ctx);
	};

	it("gives every slice its own pattern", async () => {
		const slices = Object.values(STATS_PRECOMPUTE_CRONS);
		// A duplicated slice is two patterns warming the same bundles while
		// another slice never runs at all — and the count is the only place
		// that shows.
		expect(new Set(slices).size).toBe(slices.length);
	});

	it("keeps the sweep's pattern out of the precompute table", async () => {
		// Both tables are matched by exact string, so a shared pattern would
		// silently give one job the other's trigger.
		expect(STATS_PRECOMPUTE_CRONS[RETENTION_CRON]).toBeUndefined();
	});

	it("gives the warm a pattern of its own", async () => {
		// The dispatch is a chain of exact matches that each return, so a warm
		// pattern shared with either of the other two would run whichever arm
		// comes first and leave the other job never running at all.
		expect(STATS_PRECOMPUTE_CRONS[STATS_WARM_CRON]).toBeUndefined();
		expect(STATS_WARM_CRON).not.toBe(RETENTION_CRON);
	});

	it("precomputes the slice its pattern names", async () => {
		const [cron, slice] =
			Object.entries(STATS_PRECOMPUTE_CRONS).find(
				([, value]) => value === "duel",
			) ?? [];
		expect(slice).toBe("duel");

		const before = await statsKeys();
		await fire(cron as string);

		// CURRENT_PARSER_VERSION, which nothing above writes under — so these
		// are the keys this invocation created.
		const added = [...(await statsKeys())].filter((k) => !before.has(k));
		expect(added).toHaveLength(3);
		expect(added.every((k) => k.includes(":global:duel:"))).toBe(true);
	});

	it("warms the unfaceted bundles on the warm pattern", async () => {
		const unfaceted = Object.values(STATS_PRECOMPUTE_CRONS).map((slice) =>
			cacheKeyToString(globalKey(slice, [], CURRENT_PARSER_VERSION)),
		);

		const before = await statsKeys();
		await fire(STATS_WARM_CRON);
		const after = await statsKeys();

		// Every unfaceted key is present afterwards however many were already —
		// the duel case above fired its own pattern, so that one may not have
		// been missing.
		for (const key of unfaceted) expect(after.has(key)).toBe(true);
		// And whatever it did add was unfaceted: the nation bundles belong to
		// the nightly patterns, which is what keeps this invocation's query
		// count at ~200 rather than ~856.
		const added = [...after].filter((k) => !before.has(k));
		expect(added.every((k) => unfaceted.includes(k))).toBe(true);
	});

	it("writes nothing on the sweep's pattern or an unknown one", async () => {
		for (const cron of [RETENTION_CRON, "0 0 * * *"]) {
			const before = await statsKeys();
			await fire(cron);
			expect(await statsKeys()).toEqual(before);
		}
	});
});
