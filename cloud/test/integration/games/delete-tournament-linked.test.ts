// Integration tests for DELETE /v1/games/:id when the game is linked to a
// tournament match. Covers two cases:
//   1. Active tournament — the owner gets a clean 409
//      LINKED_TO_ACTIVE_TOURNAMENT, mirroring the handleGamePatch lockout.
//      Without this guard the R2 deletes succeed but the FK aborts the D1
//      DELETE, leaving the games row with no R2 backing.
//   2. Completed tournament — migration 0013's BEFORE DELETE trigger nulls
//      the match's game_id, the DELETE proceeds (204), and the match's
//      winner/status are preserved.

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
	game_id: string;
}

interface MatchRow {
	match_id: string;
	status: string;
	winner_slot_id: string | null;
	game_id: string | null;
}

async function loadGame(gameId: string): Promise<GameRow | null> {
	return await env.SHARE_DB.prepare(
		"SELECT game_id FROM games WHERE game_id = ?",
	)
		.bind(gameId)
		.first<GameRow>();
}

async function loadMatch(matchId: string): Promise<MatchRow | null> {
	return await env.SHARE_DB.prepare(
		`SELECT match_id, status, winner_slot_id, game_id
		 FROM tournament_matches WHERE match_id = ?`,
	)
		.bind(matchId)
		.first<MatchRow>();
}

describe("DELETE /v1/games/:id with a tournament-linked game", () => {
	it("rejects 409 LINKED_TO_ACTIVE_TOURNAMENT when the tournament is still active", async () => {
		const playerA = await makeUser({ discordUsername: "alice-del" });
		const playerB = await makeUser({ discordUsername: "bob-del" });
		const playerC = await makeUser({ discordUsername: "carol-del" });
		const playerD = await makeUser({ discordUsername: "dave-del" });
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
		const uploadRes = await postMultipart({
			path: "/v1/games",
			form,
			as: playerA,
		});
		const { game_id } = await expectOk<{ game_id: string }>(uploadRes);

		const deleteRes = await request.delete({
			path: `/v1/games/${game_id}`,
			as: playerA,
		});
		await expectErrorCode(deleteRes, {
			status: 409,
			code: "LINKED_TO_ACTIVE_TOURNAMENT",
		});

		// Games row still present — the guard returned before any R2/D1
		// destructive work happened.
		const gameRow = await loadGame(game_id);
		expect(gameRow?.game_id).toBe(game_id);

		// Match link untouched.
		const matchRow = await loadMatch(aMatch.match_id);
		expect(matchRow?.game_id).toBe(game_id);
		expect(matchRow?.status).toBe("complete");
		expect(matchRow?.winner_slot_id).toBe(aSlot.slotId);
	});

	it("allows DELETE once the tournament is complete, nulling the match's game_id and preserving winner/status", async () => {
		const playerA = await makeUser({ discordUsername: "alice-done-del" });
		const playerB = await makeUser({ discordUsername: "bob-done-del" });
		const playerC = await makeUser({ discordUsername: "carol-done-del" });
		const playerD = await makeUser({ discordUsername: "dave-done-del" });
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
		const uploadRes = await postMultipart({
			path: "/v1/games",
			form,
			as: playerA,
		});
		const { game_id } = await expectOk<{ game_id: string }>(uploadRes);

		// Flip the tournament to 'complete' directly (the full transition
		// path would require playing through Swiss + championship — the
		// guard fires on status alone, so this is the same code path).
		await env.SHARE_DB.prepare(
			"UPDATE tournaments SET status = 'complete' WHERE tournament_id = ?",
		)
			.bind(t.tournamentId)
			.run();

		const deleteRes = await request.delete({
			path: `/v1/games/${game_id}`,
			as: playerA,
		});
		await expectStatus(deleteRes, 204);

		// Games row gone.
		const gameRow = await loadGame(game_id);
		expect(gameRow).toBeNull();

		// Match.game_id nulled by the trigger; status + winner preserved.
		const matchRow = await loadMatch(aMatch.match_id);
		expect(matchRow?.game_id).toBeNull();
		expect(matchRow?.status).toBe("complete");
		expect(matchRow?.winner_slot_id).toBe(aSlot.slotId);
	});
});
