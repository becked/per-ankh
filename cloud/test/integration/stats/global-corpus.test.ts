// The global corpus — visibility, composition, and the nation facet.
//
// resolveGlobalCorpus is the one place the public /stats corpus is decided, so
// what needs proving is what it selects from real rows: that is_public is the
// whole visibility rule, that a composition slice composes with it, and that a
// nation narrows *twice*.
//
// The second narrowing is the one worth a test. Selecting Rome and filtering
// games alone would qualify an Egypt-vs-Rome duel and then feed both seats'
// rows into the yield bands — including the Egyptian's, which is not what
// anyone means by "Rome stats". It is only observable through a bundle, so
// those cases resolve a corpus and run the aggregator over it.

import { applyD1Migrations, env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildChartBundle } from "../../../src/stats/aggregate";
import {
	resolveGlobalCorpus,
	type StatsCorpus,
} from "../../../src/stats/resolve";
import type { GlobalPeriod, GlobalSlice } from "../../../src/stats/types";
import { makeUser } from "../../helpers/builders";
import { postMultipart } from "../../helpers/requests";
import {
	buildUploadFormData,
	type UploadFixtureOpts,
} from "../../helpers/save-blob";

// The version the fixture blobs carry (test/helpers/save-blob.ts).
// buildChartBundle only echoes it into meta.parser_version.
const PARSER_VERSION = "2.4.0";

// Nations follow the roster seat (test/helpers/save-blob.ts): seat 0 is Egypt,
// seat 1 Rome, seat 2 Greece — the AI seat included, which is what lets
// `ai_rome` below seat an AI Rome by seating a single human.
const EGYPT = "NATION_EGYPT";
const ROME = "NATION_ROME";
const GREECE = "NATION_GREECE";

// Turns per seat. Small: the yield rows are counted here, not read.
const TURNS = 3;
const turnsFor = (seats: number): UploadFixtureOpts["turns"] =>
	Array.from({ length: seats }, (_, player) => ({
		player,
		values: Array.from({ length: TURNS }, (_, t) => 10 + player * 5 + t),
	}));

const CORPUS = {
	// Egypt against Rome, and the only public duel.
	duel: { winnerIndex: 0, turns: turnsFor(2) },
	// The same composition, made private below — the visibility half of the
	// resolver's base clause, which no slice can override.
	duel_private: { winnerIndex: 1, turns: turnsFor(2) },
	// Egypt, Rome and Greece.
	ffa: { winnerIndex: 0, humans: 3, turns: turnsFor(3) },
	// One human Egypt against an AI Rome. A nation facet must not admit it for
	// a seat that no focal set can hold.
	ai_rome: { winnerIndex: 0, humans: 1, aiPlayer: true, turns: turnsFor(1) },
} satisfies Record<string, UploadFixtureOpts>;

type Label = keyof typeof CORPUS;

const gameIds = new Map<Label, string>();

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	const user = await makeUser();
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
	// defaults to public; this one opts back out.
	await env.SHARE_DB.prepare("UPDATE games SET is_public = 0 WHERE game_id = ?")
		.bind(idOf("duel_private"))
		.run();
});

const idOf = (label: Label): string => {
	const id = gameIds.get(label);
	if (id === undefined) throw new Error(`fixture ${label} never uploaded`);
	return id;
};

const expected = (...labels: Label[]): Set<string> => new Set(labels.map(idOf));

const resolve = (
	slice: GlobalSlice,
	nations: string[] = [],
	period: GlobalPeriod = "all",
): Promise<StatsCorpus> => resolveGlobalCorpus(env, slice, { nations, period });

const gamesIn = async (
	slice: GlobalSlice,
	nations: string[] = [],
	period: GlobalPeriod = "all",
): Promise<Set<string>> =>
	new Set((await resolve(slice, nations, period)).gameIds);

// Date a fixture's save, so the recency window has something to cut on.
// save_date is what the window reads — when the game was PLAYED — not
// created_at, which is when it happened to be uploaded.
const setSaveDate = (label: Label, date: string | null) =>
	env.SHARE_DB.prepare("UPDATE games SET save_date = ? WHERE game_id = ?")
		.bind(date, idOf(label))
		.run();

const monthsAgo = (n: number): string => {
	const d = new Date();
	d.setUTCMonth(d.getUTCMonth() - n);
	return d.toISOString().slice(0, 10);
};

describe("global corpus", () => {
	it("takes every public game and no private one", async () => {
		expect(await gamesIn("all")).toEqual(expected("duel", "ffa", "ai_rome"));
	});

	it("composes a composition slice with visibility", async () => {
		// Both fixtures are duels by composition; only the public one resolves.
		expect(await gamesIn("duel")).toEqual(expected("duel"));
		expect(await gamesIn("single_player")).toEqual(expected("ai_rome"));
	});

	it("narrows to the games a nation was played in", async () => {
		expect(await gamesIn("all", [ROME])).toEqual(expected("duel", "ffa"));
		expect(await gamesIn("all", [GREECE])).toEqual(expected("ffa"));
	});

	it("qualifies a game on a human seat, not an AI one", async () => {
		// ai_rome seats a Rome, and it is the AI's — so the game is in the
		// unfaceted corpus and out of the Rome one.
		expect((await gamesIn("all")).has(idOf("ai_rome"))).toBe(true);
		expect((await gamesIn("all", [ROME])).has(idOf("ai_rome"))).toBe(false);
	});

	it("unions the selected nations rather than intersecting them", async () => {
		// No fixture seats both, so an intersection would resolve to nothing.
		expect(await gamesIn("all", [GREECE, ROME])).toEqual(
			expected("duel", "ffa"),
		);
		expect(await gamesIn("all", [EGYPT, GREECE])).toEqual(
			expected("duel", "ffa", "ai_rome"),
		);
	});

	describe("the recency window", () => {
		// Restored after each case so the window tests don't reorder the rest.
		let saved: Array<[Label, string | null]> = [];
		beforeEach(async () => {
			const rows = await env.SHARE_DB.prepare(
				"SELECT game_id, save_date FROM games",
			).all<{ game_id: string; save_date: string | null }>();
			const byId = new Map(
				(rows.results ?? []).map((r) => [r.game_id, r.save_date]),
			);
			saved = (["duel", "ffa", "ai_rome"] as Label[]).map((l) => [
				l,
				byId.get(idOf(l)) ?? null,
			]);
		});
		afterEach(async () => {
			for (const [label, date] of saved) await setSaveDate(label, date);
		});

		it("keeps a game played inside the window and drops one outside it", async () => {
			// Every fixture dated explicitly: the blobs carry their own save_date
			// and a test that leaned on it would pass or fail by fixture vintage.
			await setSaveDate("duel", monthsAgo(1));
			await setSaveDate("ffa", monthsAgo(9));
			await setSaveDate("ai_rome", monthsAgo(1));
			expect(await gamesIn("all", [], "6m")).toEqual(
				expected("duel", "ai_rome"),
			);
			expect(await gamesIn("all", [], "12m")).toEqual(
				expected("duel", "ffa", "ai_rome"),
			);
		});

		it("drops an undatable game from every window but keeps it in all-time", async () => {
			await setSaveDate("duel", null);
			expect((await gamesIn("all")).has(idOf("duel"))).toBe(true);
			expect((await gamesIn("all", [], "6m")).has(idOf("duel"))).toBe(false);
		});

		it("ANDs the window with the slice and the nation", async () => {
			await setSaveDate("duel", monthsAgo(9));
			await setSaveDate("ffa", monthsAgo(1));
			// In the Rome corpus all-time, out of it once the window closes.
			expect(await gamesIn("duel", [ROME])).toEqual(expected("duel"));
			expect(await gamesIn("duel", [ROME], "6m")).toEqual(new Set());
		});

		it("leaves the focal seats alone — a window narrows games, not seats", async () => {
			// Every seat of a recent game is a recent seat, so unlike a nation
			// selection the window says nothing about which rows are focal.
			expect((await resolve("all", [], "6m")).focalNations).toBeUndefined();
		});
	});

	it("ANDs the nation with the slice", async () => {
		expect(await gamesIn("duel", [ROME])).toEqual(expected("duel"));
		// Greece plays only the FFA, so the duel slice holds none of its games.
		expect((await resolve("duel", [GREECE])).gameIds).toEqual([]);
	});

	it("carries one canonical form of the nation set", async () => {
		// Sorted and deduped, so a single-select value is a one-element list and
		// the cache key that stringifies it has one spelling per selection.
		expect((await resolve("all", [ROME, EGYPT, ROME])).focalNations).toEqual([
			EGYPT,
			ROME,
		]);
		expect((await resolve("all")).focalNations).toBeUndefined();
	});
});

const bundleFor = async (corpus: StatsCorpus) =>
	buildChartBundle(env, corpus, PARSER_VERSION, "humans");

describe("the nation facet narrows the focal set", () => {
	it("keeps only the selected nation's seats", async () => {
		const rome = await bundleFor(await resolve("all", [ROME]));
		expect(rome.nations).toEqual([{ nation: ROME, games_played: 2 }]);

		// Unfaceted, the same corpus puts every nation side by side.
		const everyone = await bundleFor(await resolve("all"));
		expect(everyone.nations.map((n) => n.nation).sort()).toEqual([
			EGYPT,
			GREECE,
			ROME,
		]);
	});

	it("feeds only that nation's rows to the yield bands", async () => {
		const corpus = await resolve("all", [ROME]);
		const faceted = await bundleFor(corpus);
		// The same games with the focal half of the narrowing dropped — the
		// shape a games-only filter would produce, kept as the contrast.
		const gamesOnly = await bundleFor({ gameIds: corpus.gameIds });

		expect(faceted.yieldCurves.turns).toHaveLength(TURNS);
		// One Rome seat in each of the two games...
		expect(faceted.yieldCurves.counts).toEqual(Array(TURNS).fill(2));
		// ...against all five human seats those games hold.
		expect(gamesOnly.yieldCurves.counts).toEqual(Array(TURNS).fill(5));
	});

	it("leaves the per-game facts to the corpus", async () => {
		// game_count follows the id list, so the control moves the headline
		// number: the whole corpus is three games, Rome's half of it two.
		expect((await bundleFor(await resolve("all"))).meta.game_count).toBe(3);

		const rome = await bundleFor(await resolve("all", [ROME]));
		expect(rome.meta.game_count).toBe(2);
		expect(rome.summary.total_games).toBe(2);
	});
});
