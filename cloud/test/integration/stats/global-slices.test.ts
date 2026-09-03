// Composition slices over the public corpus.
//
// buildGlobalSliceWhere returns constant SQL, so what needs proving is what
// that SQL selects from real rows: four fixture games, one per composition
// the public corpus actually holds, run through the real upload path so
// player_summaries carries the seats the predicates group over.
//
// The case the shared helper exists for is the fourth — a two-human game with
// an AI seat. It is a duel to a predicate that filters humans and then
// counts, and it is not one here.
//
// The fifth is a challenge run: single-human like `single_player`, and out of
// every slice ("all" included) because it was played to a rule set, not to
// the end. Its submission row is inserted directly — the real submit path
// needs a challenge and a scorable save, and what's under test here is the
// predicate, not the scorer.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { buildGlobalSliceWhere } from "../../../src/games-scope";
import type { GlobalSlice } from "../../../src/stats/types";
import { makeUser, type TestUser } from "../../helpers/builders";
import { postMultipart } from "../../helpers/requests";
import {
	buildUploadFormData,
	type UploadFixtureOpts,
} from "../../helpers/save-blob";

// One game per composition. The first three are named for the slice they
// belong to; `duel_with_ai` and `challenge_run` belong to none, which is the
// point of seeding them. 3 players / 2 humans is one of the four such
// compositions the public corpus holds (the others seat 4, 5 and 6 players).
const CORPUS = {
	duel: { winnerIndex: 0, humans: 2 },
	ffa: { winnerIndex: 0, humans: 3 },
	single_player: { winnerIndex: 0, humans: 1, aiPlayer: true },
	duel_with_ai: { winnerIndex: 0, humans: 2, aiPlayer: true },
	challenge_run: { winnerIndex: 0, humans: 1, aiPlayer: true },
} satisfies Record<string, UploadFixtureOpts>;

type Label = keyof typeof CORPUS;

const gameIds = new Map<Label, string>();
let uploader: TestUser;

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	uploader = await makeUser();
	for (const [label, opts] of Object.entries(CORPUS) as Array<
		[Label, UploadFixtureOpts]
	>) {
		const res = await postMultipart({
			path: "/v1/games",
			form: await buildUploadFormData(opts),
			as: uploader,
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { game_id: string };
		gameIds.set(label, body.game_id);
	}
	await env.SHARE_DB.prepare(
		`INSERT INTO challenges (challenge_id, number, title, created_by, closes_at, setup, objectives, criteria, map_r2_key, map_file_hash, map_size_bytes)
		 VALUES ('ch_test', 27, 'Slice fixture', ?, datetime('now', '+30 days'), '{}', '[]', '[]', 'challenges/ch_test/map.zip', 'hash', 1)`,
	)
		.bind(uploader.userId)
		.run();
	await env.SHARE_DB.prepare(
		`INSERT INTO challenge_submissions (submission_id, challenge_id, game_id, user_id, score_turn, verdict)
		 VALUES ('sub_test', 'ch_test', ?, ?, 50, '{}')`,
	)
		.bind(gameIds.get("challenge_run"), uploader.userId)
		.run();
});

// The query shape a global resolver runs: a base clause the fragment appends
// to. The base scopes to the fixture's uploader rather than to is_public,
// because visibility is the resolver's half of the predicate and not the
// slice's — these four games answer the same way whoever can see them.
async function slice(s: GlobalSlice): Promise<Set<string>> {
	const rows = await env.SHARE_DB.prepare(
		`SELECT game_id FROM games WHERE user_id = ?${buildGlobalSliceWhere(s)}`,
	)
		.bind(uploader.userId)
		.all<{ game_id: string }>();
	return new Set((rows.results ?? []).map((r) => r.game_id));
}

const idOf = (label: Label): string => {
	const id = gameIds.get(label);
	if (id === undefined) throw new Error(`fixture ${label} never uploaded`);
	return id;
};

const expected = (...labels: Label[]): Set<string> => new Set(labels.map(idOf));

describe("global composition slices", () => {
	it("filters only challenge runs for the all slice", async () => {
		expect(buildGlobalSliceWhere("all")).toBe(
			" AND game_id NOT IN (SELECT game_id FROM challenge_submissions)",
		);
		expect(await slice("all")).toEqual(
			expected("duel", "ffa", "single_player", "duel_with_ai"),
		);
	});

	it("counts players for a duel, so an AI seat disqualifies one", async () => {
		expect(await slice("duel")).toEqual(expected("duel"));
	});

	it("takes three or more humans as FFA", async () => {
		expect(await slice("ffa")).toEqual(expected("ffa"));
	});

	it("takes exactly one human as single-player, AI seats and all", async () => {
		expect(await slice("single_player")).toEqual(expected("single_player"));
	});

	it("leaves a two-human game with an AI out of every composition", async () => {
		const composed = new Set([
			...(await slice("duel")),
			...(await slice("ffa")),
			...(await slice("single_player")),
		]);
		expect(composed.has(idOf("duel_with_ai"))).toBe(false);
		// So the all slice is a strict superset of the three, not their union.
		expect(composed.size).toBe((await slice("all")).size - 1);
	});
});
