// Integration test for the stats-cache invalidation on POST
// /v1/admin/games/:id/reindex.
//
// Reindex is the backfill tool: it rebuilds game_player_turn from the stored
// blob so a column added after upload gets filled. That makes it a writer of
// exactly the rows every corpus's bundle aggregates, and those bundles are
// cached for 24h under keys that do not drift on a re-derivation at the same
// parser version — the user key has no per-game segment, the tournament key
// moves only on a tournament mutation, and the global keys carry no game at
// all. So without an explicit invalidation a sweep's whole point is invisible
// until the TTL runs out. Worse than merely late: the Yields panel drops a band
// that is entirely null, so a corpus the sweep hasn't reached is
// indistinguishable from one with nothing to show.
//
// The subject is that invalidation, asserted through the effect rather than the
// mechanism: a reader sees pre-backfill values, the sweep runs, and the next
// read sees the backfilled ones — on the owner's corpus and the tournament's
// alike, since one reindexed game is in both.
//
// `games.updated_at` is the second cache a reindex has to move, for the same
// reason and one layer out: it is what the link-preview card's URL is versioned
// on (GET /v1/games/:id/card.png), and a reindex is what backfills vp_series
// and momentum_series — so the operation most likely to turn "no sparkline"
// into "sparkline" is exactly the one that must not leave the old card stored.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import {
	makeSiteAdmin,
	makeTournament,
	makeUser,
	type TestUser,
} from "../../helpers/builders";
import { postMultipart, request } from "../../helpers/requests";
import { buildUploadFormData } from "../../helpers/save-blob";

// One site admin for the file: users.discord_id is unique and the Worker
// recognizes exactly one. Seeded in beforeAll so it survives per-test
// storage isolation.
let admin: TestUser;

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	admin = await makeSiteAdmin();
});

// The save stores market prices as money ×10,000.
const RAW = 10_000;

// Priced, so a rebuild has a GDP to compute at all; rates and prices are both
// constant, which keeps every assertion about presence rather than value.
const pricedUpload = () =>
	buildUploadFormData({
		winnerIndex: 0,
		turns: [{ player: 0, values: [10, 10, 10] }],
		prices: [
			{ turn: 1, yieldType: "YIELD_FOOD", price: 4 * RAW },
			{ turn: 1, yieldType: "YIELD_WOOD", price: 4 * RAW },
			{ turn: 1, yieldType: "YIELD_STONE", price: 4 * RAW },
			{ turn: 1, yieldType: "YIELD_IRON", price: 4 * RAW },
		],
	});

// Non-null GDP medians on a bundle's rate band. Empty is the pre-backfill
// state; the band itself is always present, nulls and all.
function gdpValues(body: {
	yieldCurves: {
		series: Record<string, { rate: { p50: Array<number | null> } }>;
	};
}): Array<number | null> {
	return body.yieldCurves.series.gdp_per_turn.rate.p50.filter((v) => v != null);
}

type BundleBody = Parameters<typeof gdpValues>[0];

async function statsKeys(): Promise<string[]> {
	const listed = await env.SESSIONS_KV.list({ prefix: "stats:" });
	return listed.keys.map((k) => k.name);
}

describe("admin reindex", () => {
	it("drops every corpus's cached bundle, so a backfill is visible at once", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const matches = await t.matches();
		const owner = t.admin;

		const res = await postMultipart({
			path: "/v1/games",
			form: await pricedUpload(),
			as: owner,
		});
		expect(res.status).toBe(201);
		const { game_id } = await res.json<{ game_id: string }>();

		// Link the uploaded game to a completed match so the tournament corpus
		// counts it — resolveTournamentCorpus takes status='complete' only.
		await env.SHARE_DB.prepare(
			`UPDATE tournament_matches
			 SET status = 'complete', game_id = ?, winner_slot_id = slot_a_id,
			     slot_a_player_index = 0, slot_b_player_index = 1
			 WHERE match_id = ?`,
		)
			.bind(game_id, matches[0].match_id)
			.run();

		// Model the state a column migration leaves behind: the rows exist and
		// the column is NULL because no sweep has run over them yet.
		await env.SHARE_DB.prepare(
			`UPDATE game_player_turn
			 SET gdp_per_turn = NULL, gdp_cumulative = NULL
			 WHERE game_id = ?`,
		)
			.bind(game_id)
			.run();

		const readUser = async () =>
			gdpValues(
				await expectOk<BundleBody>(
					await request.get({
						path: `/v1/users/${owner.userId}/stats`,
						as: owner,
					}),
				),
			);
		const readTournament = async () =>
			gdpValues(
				await expectOk<BundleBody>(
					await request.get({
						path: `/v1/tournaments/${t.tournamentId}/stats/games`,
						as: owner,
					}),
				),
			);

		// The pre-backfill reads: each band is present and entirely null, and
		// both are now cached that way.
		expect(await readUser()).toEqual([]);
		expect(await readTournament()).toEqual([]);
		const before = await statsKeys();
		expect(before.some((k) => k.includes(`:user:${owner.userId}:`))).toBe(true);
		expect(
			before.some((k) => k.includes(`:tournament:${t.tournamentId}:`)),
		).toBe(true);

		// The sweep.
		await expectOk(
			await request.post({
				path: `/v1/admin/games/${game_id}/reindex`,
				as: admin,
			}),
		);
		expect(await statsKeys()).toEqual([]);

		// …so the next read of either recomputes rather than serving a stale
		// all-null band for the rest of the TTL.
		expect((await readUser()).length).toBeGreaterThan(0);
		expect((await readTournament()).length).toBeGreaterThan(0);
	});

	it("bumps games.updated_at, so the link-preview card is re-rendered", async () => {
		const owner = await makeUser({ discordUsername: "reindex-card-owner" });
		const res = await postMultipart({
			path: "/v1/games",
			form: await pricedUpload(),
			as: owner,
		});
		expect(res.status).toBe(201);
		const { game_id } = await res.json<{ game_id: string }>();

		// Backdate it, because the upload and the reindex land in the same
		// second and `datetime('now')` has one-second resolution — without this
		// the assertion would be about the clock rather than about the write.
		await env.SHARE_DB.prepare(
			"UPDATE games SET updated_at = '2020-01-01 00:00:00' WHERE game_id = ?",
		)
			.bind(game_id)
			.run();

		await expectOk(
			await request.post({
				path: `/v1/admin/games/${game_id}/reindex`,
				as: admin,
			}),
		);

		const row = await env.SHARE_DB.prepare(
			"SELECT updated_at FROM games WHERE game_id = ?",
		)
			.bind(game_id)
			.first<{ updated_at: string }>();
		expect(row?.updated_at).not.toBe("2020-01-01 00:00:00");

		// And the detail read is what carries it to the page that builds the
		// card URL.
		const detail = await expectOk<{ updated_at?: string }>(
			await request.get({ path: `/v1/games/${game_id}`, as: owner }),
		);
		expect(detail.updated_at).toBe(row?.updated_at);
	});
});
