// Integration tests for the uploader's seat across the four surfaces that
// serve it — GET /v1/games, GET /v1/games/out-of-date,
// GET /v1/admin/games/out-of-date and GET /v1/games/:id. All four select it
// through one helper (uploaderPlayerIndexSql, cloud/src/games.ts) and all four
// feed a reparse that posts the value straight back, so every case here is
// asserted against all of them: a surface that served a different seat would
// show up as a reparse that changed whose game it is.
//
// A nation can't stand in for the seat, which is what the mirror-matchup case
// pins. Old World lets two humans claim one nation —
// `Game.IsValidNationForIndex` returns true outright under
// TEAMNATION_ALLOW_DUPLICATES, and under the multi-human default
// TEAMNATION_TEAM_UNIQUE rejects a duplicate only when the two share a team,
// so a 1v1 on opposite teams is legal — and `games.user_nation` then names two
// seats rather than one.
//
// Games are seeded by direct INSERT: the subject is what the four queries
// serve, not the upload pipeline.
//
// The seat those four serve is only worth anything if it survives the round
// trip, so two more cases sit below. A re-import that posts no seat for a game
// that records one is refused rather than written — the posted value is the
// stored one coming back, so a null there is a lost claim and not an observer
// upload (UPLOADER_CLAIM_DROPPED, handleGameUpload). And one game carries at
// most one claimed seat, which is what lets the subquery read the seat back
// without a LIMIT; migration 0053 is what holds every writer to it.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeSiteAdmin, makeUser, type TestUser } from "../../helpers/builders";
import { seedGame, seedSeats } from "../../helpers/games";
import { postMultipart, request } from "../../helpers/requests";
import { buildUploadFormData } from "../../helpers/save-blob";

// One site admin for the file: users.discord_id is unique and the Worker
// recognizes exactly one. Seeded in beforeAll so it survives per-test storage
// isolation.
let admin: TestUser;

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	admin = await makeSiteAdmin();
});

// seedGame stores parser_version 1.0.0, so both out-of-date lists see every
// seeded game against this.
const CURRENT = "3.0.0";

interface SeatRow {
	game_id: string;
	uploader_player_index: number | null;
}

// The seat each surface reports for one game, keyed by endpoint so a failure
// names the surface that disagreed. A game missing from a list reads back as
// `undefined`, which fails against both an index and the observer null.
async function seatsServed(
	owner: TestUser,
	gameId: string,
): Promise<Record<string, number | null | undefined>> {
	const list = await expectOk<{ games: SeatRow[] }>(
		await request.get({ path: "/v1/games", as: owner }),
	);
	const outOfDate = await expectOk<{ games: SeatRow[] }>(
		await request.get({
			path: `/v1/games/out-of-date?version=${CURRENT}`,
			as: owner,
		}),
	);
	const adminOutOfDate = await expectOk<{ games: SeatRow[] }>(
		await request.get({
			path: `/v1/admin/games/out-of-date?version=${CURRENT}`,
			as: admin,
		}),
	);
	const detail = await expectOk<SeatRow>(
		await request.get({ path: `/v1/games/${gameId}`, as: owner }),
	);
	const seatIn = (rows: SeatRow[]): number | null | undefined =>
		rows.find((g) => g.game_id === gameId)?.uploader_player_index;
	return {
		"GET /v1/games": seatIn(list.games),
		"GET /v1/games/out-of-date": seatIn(outOfDate.games),
		"GET /v1/admin/games/out-of-date": seatIn(adminOutOfDate.games),
		"GET /v1/games/:id": detail.uploader_player_index,
	};
}

describe("uploader seat on the reparse read surfaces", () => {
	it("serves the claimed seat, which a shared nation can't identify", async () => {
		const owner = await makeUser({ discordUsername: "seat-mirror" });
		const gameId = await seedGame(owner, {
			isPublic: false,
			gameName: "mirror-duel",
		});
		await seedSeats(gameId, [
			{ index: 0, nation: "NATION_EGYPT", uploader: false },
			{ index: 1, nation: "NATION_EGYPT", uploader: true },
		]);

		expect(await seatsServed(owner, gameId)).toEqual({
			"GET /v1/games": 1,
			"GET /v1/games/out-of-date": 1,
			"GET /v1/admin/games/out-of-date": 1,
			"GET /v1/games/:id": 1,
		});
	});

	it("serves a null seat for an observer upload", async () => {
		const owner = await makeUser({ discordUsername: "seat-observer" });
		const gameId = await seedGame(owner, {
			isPublic: false,
			gameName: "observer-archive",
		});
		await seedSeats(gameId, [
			{ index: 0, nation: "NATION_ROME", uploader: false },
			{ index: 1, nation: "NATION_GREECE", uploader: false },
		]);

		expect(await seatsServed(owner, gameId)).toEqual({
			"GET /v1/games": null,
			"GET /v1/games/out-of-date": null,
			"GET /v1/admin/games/out-of-date": null,
			"GET /v1/games/:id": null,
		});
	});
});

describe("the claim a re-import has to re-send", () => {
	it("refuses a re-import that posts no seat where the game records one", async () => {
		const owner = await makeUser({ discordUsername: "seat-demotion" });
		// Shared nonce pins the ZIP bytes, so the second post dedups onto the
		// first game by (user_id, file_hash) and takes the re-import branch.
		const nonce = "reimport-drops-the-claim";
		const first = await expectOk<{ game_id: string }>(
			await postMultipart({
				path: "/v1/games",
				form: await buildUploadFormData({
					winnerIndex: 0,
					uploaderIndex: 0,
					nonce,
				}),
				as: owner,
			}),
		);

		const res = await postMultipart({
			path: "/v1/games",
			form: await buildUploadFormData({
				winnerIndex: 0,
				uploaderIndex: null,
				nonce,
				parserVersion: "2.4.1",
			}),
			as: owner,
		});
		await expectErrorCode(res, {
			status: 409,
			code: "UPLOADER_CLAIM_DROPPED",
		});

		// Refused before the batch: the claim, the columns derived from it and
		// the stored parse are all as the first upload left them.
		const row = await env.SHARE_DB.prepare(
			`SELECT g.user_nation, g.user_won, g.parser_version,
			        (SELECT ps.player_index FROM player_summaries ps
			          WHERE ps.game_id = g.game_id AND ps.is_uploader = 1)
			          AS uploader_player_index
			   FROM games g WHERE g.game_id = ?`,
		)
			.bind(first.game_id)
			.first();
		expect(row).toMatchObject({
			user_nation: "NATION_EGYPT",
			user_won: 1,
			parser_version: "2.4.0",
			uploader_player_index: 0,
		});
	});

	it("refuses a second claimed seat on one game", async () => {
		const owner = await makeUser({ discordUsername: "seat-cardinality" });
		const gameId = await seedGame(owner, {
			isPublic: false,
			gameName: "two-claims",
		});

		// The subquery above reads the seat back with no LIMIT, so two flagged
		// rows would make the surfaces disagree about whose game it is. The
		// schema is what rules it out, not the writers' care.
		await expect(
			seedSeats(gameId, [
				{ index: 0, nation: "NATION_EGYPT", uploader: true },
				{ index: 1, nation: "NATION_ROME", uploader: true },
			]),
		).rejects.toThrow(/UNIQUE constraint failed/);
	});
});
