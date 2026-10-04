// Integration tests for the uploader_player_index branch of
// PATCH /v1/games/:id — the owner correcting which player they were on a
// save that was uploaded under the wrong pick.
//
// The pick decides three stored things, and the branch is only right if all
// three move together: games.user_nation, games.user_won, and the
// player_summaries.is_uploader flag the duel ratings attribute a seat by
// (cloud/src/ratings/duels.ts). The fixture seats two humans — player 0 on
// Egypt, player 1 on Rome — plus an AI, and records player 0 as the winner,
// so a correction to player 1 has to flip the nation and the win at once.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
	expectErrorCode,
	expectOk,
	expectStatus,
} from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { postMultipart, request } from "../../helpers/requests";
import { buildUploadFormData } from "../../helpers/save-blob";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface GameRow {
	user_nation: string | null;
	user_won: number | null;
}

async function loadGame(gameId: string): Promise<GameRow | null> {
	return await env.SHARE_DB.prepare(
		"SELECT user_nation, user_won FROM games WHERE game_id = ?",
	)
		.bind(gameId)
		.first<GameRow>();
}

// The seat player_summaries currently flags as the uploader's, or null for an
// observer upload (no flagged row at all).
async function loadUploaderSeat(gameId: string): Promise<number | null> {
	const row = await env.SHARE_DB.prepare(
		"SELECT player_index FROM player_summaries WHERE game_id = ? AND is_uploader = 1",
	)
		.bind(gameId)
		.first<{ player_index: number }>();
	return row?.player_index ?? null;
}

async function loadOnlineIds(userId: string): Promise<string[]> {
	const rows = await env.SHARE_DB.prepare(
		"SELECT online_id FROM user_online_ids WHERE user_id = ? ORDER BY online_id",
	)
		.bind(userId)
		.all<{ online_id: string }>();
	return (rows.results ?? []).map((r) => r.online_id);
}

async function loadAuditMetadata(gameId: string): Promise<string[]> {
	const rows = await env.SHARE_DB.prepare(
		`SELECT metadata FROM events
		 WHERE game_id = ? AND event_type = 'uploader_change' ORDER BY id`,
	)
		.bind(gameId)
		.all<{ metadata: string | null }>();
	return (rows.results ?? []).map((r) => r.metadata ?? "");
}

// Upload the two-human fixture claiming player 0, and return its game_id.
async function uploadAsPlayerZero(
	as: { sessionToken: string },
): Promise<string> {
	const form = await buildUploadFormData({ winnerIndex: 0, aiPlayer: true });
	const res = await postMultipart({ path: "/v1/games", form, as });
	const { game_id } = await expectOk<{ game_id: string }>(res);
	return game_id;
}

describe("PATCH /v1/games/:id uploader_player_index", () => {
	it("moves the nation, the win, and the is_uploader flag to the new seat", async () => {
		const owner = await makeUser({ discordUsername: "alice-uploader" });
		const gameId = await uploadAsPlayerZero(owner);

		// Uploaded as the winning Egypt seat.
		expect(await loadGame(gameId)).toEqual({
			user_nation: "NATION_EGYPT",
			user_won: 1,
		});
		expect(await loadUploaderSeat(gameId)).toBe(0);

		const res = await request.patch({
			path: `/v1/games/${gameId}`,
			as: owner,
			body: { uploader_player_index: 1 },
		});
		expect(
			await expectOk<{
				uploader_player_index: number | null;
				user_nation: string | null;
				user_won: boolean | null;
			}>(res),
		).toMatchObject({
			uploader_player_index: 1,
			user_nation: "NATION_ROME",
			user_won: false,
		});

		// Player 1 is Rome and lost to player 0 — both columns follow the pick.
		expect(await loadGame(gameId)).toEqual({
			user_nation: "NATION_ROME",
			user_won: 0,
		});
		expect(await loadUploaderSeat(gameId)).toBe(1);

		// The newly claimed seat's OnlineID is linked, like an upload's pick.
		expect(await loadOnlineIds(owner.userId)).toContain(
			"steam:000000000000002",
		);

		// Audited with the index and nation, and no online_id in the metadata.
		const metadata = await loadAuditMetadata(gameId);
		expect(metadata).toHaveLength(1);
		expect(JSON.parse(metadata[0])).toEqual({
			uploader_player_index: 1,
			user_nation: "NATION_ROME",
		});
		expect(metadata[0]).not.toContain("steam:");

		// The detail response reports the new seat, which is what the owner's
		// picker checks its rows against.
		const detail = await expectOk<{ uploader_player_index: number | null }>(
			await request.get({ path: `/v1/games/${gameId}`, as: owner }),
		);
		expect(detail.uploader_player_index).toBe(1);
	});

	it("clears both columns and the flag when corrected to observer", async () => {
		const owner = await makeUser({ discordUsername: "bob-uploader" });
		const gameId = await uploadAsPlayerZero(owner);

		const res = await request.patch({
			path: `/v1/games/${gameId}`,
			as: owner,
			body: { uploader_player_index: null },
		});
		await expectStatus(res, 200);

		expect(await loadGame(gameId)).toEqual({
			user_nation: null,
			user_won: null,
		});
		expect(await loadUploaderSeat(gameId)).toBeNull();
	});

	it("rejects a seat that isn't a human in the roster, changing nothing", async () => {
		const owner = await makeUser({ discordUsername: "carol-uploader" });
		const gameId = await uploadAsPlayerZero(owner);

		// Index 2 is the fixture's AI seat — present in the roster, not human.
		await expectErrorCode(
			await request.patch({
				path: `/v1/games/${gameId}`,
				as: owner,
				body: { uploader_player_index: 2 },
			}),
			{ status: 400, code: "UNKNOWN_PLAYER_INDEX" },
		);

		expect(await loadGame(gameId)).toEqual({
			user_nation: "NATION_EGYPT",
			user_won: 1,
		});
		expect(await loadUploaderSeat(gameId)).toBe(0);
		expect(await loadAuditMetadata(gameId)).toHaveLength(0);
	});

	it("rejects a change on a tournament-linked save, changing nothing", async () => {
		const playerA = await makeUser({ discordUsername: "alice-tl-uploader" });
		const playerB = await makeUser({ discordUsername: "bob-tl-uploader" });
		const playerC = await makeUser({ discordUsername: "carol-tl-uploader" });
		const playerD = await makeUser({ discordUsername: "dave-tl-uploader" });
		const t = await makeTournament({
			slotOwners: { A: [playerA, playerB, playerC, playerD] },
			advanceTo: "swiss-round-1-generated",
		});
		const aSlot = t.slotsByDivision.A[0];
		const aMatch = (await t.matches()).find(
			(m) => m.slot_a_id === aSlot.slotId || m.slot_b_id === aSlot.slotId,
		)!;

		const form = await buildUploadFormData({ winnerIndex: 0 });
		form.set("tournament_match_id", aMatch.match_id);
		const { game_id } = await expectOk<{ game_id: string }>(
			await postMultipart({ path: "/v1/games", form, as: playerA }),
		);

		await expectErrorCode(
			await request.patch({
				path: `/v1/games/${game_id}`,
				as: playerA,
				body: { uploader_player_index: 1 },
			}),
			{ status: 409, code: "UPLOADER_LOCKED_TOURNAMENT" },
		);

		expect(await loadGame(game_id)).toEqual({
			user_nation: "NATION_EGYPT",
			user_won: 1,
		});
		expect(await loadUploaderSeat(game_id)).toBe(0);
	});

	it("404s for a signed-in non-owner, without touching the game", async () => {
		const owner = await makeUser({ discordUsername: "dave-uploader" });
		const stranger = await makeUser({ discordUsername: "erin-uploader" });
		const gameId = await uploadAsPlayerZero(owner);

		await expectErrorCode(
			await request.patch({
				path: `/v1/games/${gameId}`,
				as: stranger,
				body: { uploader_player_index: 1 },
			}),
			{ status: 404, code: "NOT_FOUND" },
		);

		expect(await loadUploaderSeat(gameId)).toBe(0);
	});
});
