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
import { beforeAll, describe, expect, it } from "vitest";
import { buildChartBundle } from "../../../src/stats/aggregate";
import {
	listGlobalSliceNations,
	resolveGlobalCorpus,
	type StatsCorpus,
} from "../../../src/stats/resolve";
import type { GlobalSlice } from "../../../src/stats/types";
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
): Promise<StatsCorpus> => resolveGlobalCorpus(env, slice, { nations });

const gamesIn = async (
	slice: GlobalSlice,
	nations: string[] = [],
): Promise<Set<string>> => new Set((await resolve(slice, nations)).gameIds);

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

	it("ANDs the nation with the slice", async () => {
		expect(await gamesIn("duel", [ROME])).toEqual(expected("duel"));
		// Greece plays only the FFA, so the duel slice holds none of its games.
		expect((await resolve("duel", [GREECE])).gameIds).toEqual([]);
	});

	// The nations the nightly precompute builds a faceted bundle for. Every one
	// of them ends up in a cache key, and the request path's own parser is what
	// keeps that key spellable — so this list asks the same question of the same
	// vocabulary, and a seat the parser wouldn't accept never reaches a key.
	it("offers only the nations the facet could select", async () => {
		expect(await listGlobalSliceNations(env, "duel")).toEqual([EGYPT, ROME]);

		// The upload schema takes any string for a seat's nation, so a doctored
		// save can seat one carrying the cache key's own punctuation. Restored
		// in place, because the cases below read these rows.
		const restore = async (nation: string) =>
			env.SHARE_DB.prepare(
				"UPDATE player_summaries SET nation = ? WHERE game_id = ? AND player_index = 1",
			)
				.bind(nation, idOf("duel"))
				.run();
		try {
			// Every token ending in the payload segment collides, not only a bare
			// one: ":records" spells the unfaceted slice's records key and
			// "NATION_ROME:records" the Rome facet's, which is a key the request
			// path really does ask for.
			for (const doctored of [":records", `${ROME}:records`]) {
				await restore(doctored);
				expect(await listGlobalSliceNations(env, "duel")).toEqual([EGYPT]);
			}
		} finally {
			// finally, so a regression here fails this case alone instead of
			// leaving a doctored seat for every case below it.
			await restore(ROME);
		}
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
	(await buildChartBundle(env, corpus, PARSER_VERSION, "humans")).bundle;

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
