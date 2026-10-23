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

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeSiteAdmin, makeUser, type TestUser } from "../../helpers/builders";
import { seedGame, seedSeats } from "../../helpers/games";
import { request } from "../../helpers/requests";

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
