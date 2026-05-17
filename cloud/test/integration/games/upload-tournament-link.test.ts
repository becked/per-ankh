// Integration tests for /v1/games uploads that carry a
// tournament_match_id. Covers the central "upload-is-the-report"
// flow (games.ts handleGameUpload tournament block) and the
// `is_public=false` lockout on linked games (handleGamePatch).

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { postMultipart, request } from "../../helpers/requests";
import { buildUploadFormData } from "../../helpers/save-blob";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface GameRow {
	game_id: string;
	is_public: number;
	collection_id: number | null;
}

interface MatchRow {
	match_id: string;
	slot_a_id: string;
	slot_b_id: string | null;
	status: string;
	winner_slot_id: string | null;
	game_id: string | null;
	reported_by_user_id: string | null;
}

async function loadGame(gameId: string): Promise<GameRow | null> {
	return await env.SHARE_DB.prepare(
		"SELECT game_id, is_public, collection_id FROM games WHERE game_id = ?",
	)
		.bind(gameId)
		.first<GameRow>();
}

async function loadMatch(matchId: string): Promise<MatchRow | null> {
	return await env.SHARE_DB.prepare(
		`SELECT match_id, slot_a_id, slot_b_id, status, winner_slot_id,
		        game_id, reported_by_user_id
		 FROM tournament_matches WHERE match_id = ?`,
	)
		.bind(matchId)
		.first<MatchRow>();
}

async function loadCollectionName(
	collectionId: number,
): Promise<string | null> {
	const row = await env.SHARE_DB.prepare(
		"SELECT name FROM collections WHERE collection_id = ?",
	)
		.bind(collectionId)
		.first<{ name: string }>();
	return row?.name ?? null;
}

describe("POST /v1/games with tournament_match_id", () => {
	it("participant report flips the match to reported, marks the game public, and moves it into the Tournament collection", async () => {
		const playerA = await makeUser({ discordUsername: "alice-up" });
		const playerB = await makeUser({ discordUsername: "bob-up" });
		const playerC = await makeUser({ discordUsername: "carol-up" });
		const playerD = await makeUser({ discordUsername: "dave-up" });
		const t = await makeTournament({
			name: "Spring Cup",
			slotOwners: { A: [playerA, playerB, playerC, playerD] },
			advanceTo: "swiss-round-1-generated",
		});
		const aSlot = t.slotsByDivision.A[0];
		const matches = await t.matches();
		const aMatch = matches.find(
			(m) => m.slot_a_id === aSlot.slotId || m.slot_b_id === aSlot.slotId,
		);
		expect(aMatch).toBeDefined();

		const form = await buildUploadFormData({ winnerIndex: 0 });
		form.set("tournament_match_id", aMatch!.match_id);
		const res = await postMultipart({
			path: "/v1/games",
			form,
			as: playerA,
		});
		const body = await expectOk<{ game_id: string }>(res);
		expect(res.status).toBe(201);

		const matchAfter = await loadMatch(aMatch!.match_id);
		expect(matchAfter?.status).toBe("reported");
		expect(matchAfter?.winner_slot_id).toBe(aSlot.slotId);
		expect(matchAfter?.game_id).toBe(body.game_id);
		expect(matchAfter?.reported_by_user_id).toBe(playerA.userId);

		const gameRow = await loadGame(body.game_id);
		expect(gameRow?.is_public).toBe(1);
		expect(gameRow?.collection_id).not.toBeNull();
		const collectionName = await loadCollectionName(gameRow!.collection_id!);
		expect(collectionName).toBe("Tournament: Spring Cup");
	});

	it("second participant uploading the same match keeps the original report (first-upload-wins) but still stores their save in the Tournament collection", async () => {
		const playerA = await makeUser({ discordUsername: "alice-fw" });
		const playerB = await makeUser({ discordUsername: "bob-fw" });
		const playerC = await makeUser({ discordUsername: "carol-fw" });
		const playerD = await makeUser({ discordUsername: "dave-fw" });
		const t = await makeTournament({
			name: "First-Wins Cup",
			slotOwners: { A: [playerA, playerB, playerC, playerD] },
			advanceTo: "swiss-round-1-generated",
		});
		const aSlot = t.slotsByDivision.A[0];
		const matches = await t.matches();
		const aMatch = matches.find(
			(m) => m.slot_a_id === aSlot.slotId || m.slot_b_id === aSlot.slotId,
		)!;
		const opponentSlotId =
			aMatch.slot_a_id === aSlot.slotId ? aMatch.slot_b_id : aMatch.slot_a_id;
		const opponentSlot = t.slotsByDivision.A.find(
			(s) => s.slotId === opponentSlotId,
		)!;
		const opponentPlayer = opponentSlot.owner;
		expect(opponentPlayer).not.toBeNull();

		// First upload — playerA reports a win.
		const formA = await buildUploadFormData({ winnerIndex: 0 });
		formA.set("tournament_match_id", aMatch.match_id);
		const resA = await postMultipart({
			path: "/v1/games",
			form: formA,
			as: playerA,
		});
		const bodyA = await expectOk<{ game_id: string }>(resA);

		// Second upload — opponent uploads same match. winnerIndex from
		// their roster perspective is still 0 (their own player_index),
		// which the handler maps to their slot regardless of A/B side.
		const formB = await buildUploadFormData({ winnerIndex: 0 });
		formB.set("tournament_match_id", aMatch.match_id);
		const resB = await postMultipart({
			path: "/v1/games",
			form: formB,
			as: opponentPlayer!,
		});
		const bodyB = await expectOk<{ game_id: string }>(resB);
		expect(resB.status).toBe(201);
		expect(bodyB.game_id).not.toBe(bodyA.game_id);

		// Match link is still pointing at playerA's game and winner.
		const matchAfter = await loadMatch(aMatch.match_id);
		expect(matchAfter?.game_id).toBe(bodyA.game_id);
		expect(matchAfter?.winner_slot_id).toBe(aSlot.slotId);
		expect(matchAfter?.reported_by_user_id).toBe(playerA.userId);

		// Opponent's save still lands in the Tournament collection.
		const gameRowB = await loadGame(bodyB.game_id);
		expect(gameRowB?.is_public).toBe(1);
		const collectionName = await loadCollectionName(gameRowB!.collection_id!);
		expect(collectionName).toBe("Tournament: First-Wins Cup");
	});

	it("admin observer upload (uploader_player_index=null + explicit slot mapping) reports a pending match", async () => {
		const t = await makeTournament({
			name: "Observer Cup",
			advanceTo: "swiss-round-1-generated",
		});
		const matches = await t.matches();
		const target = matches.find((m) => m.status === "pending")!;

		const form = await buildUploadFormData({
			winnerIndex: 0,
			uploaderIndex: null,
		});
		form.set("tournament_match_id", target.match_id);
		form.set("tournament_slot_a_player_index", "0");
		form.set("tournament_slot_b_player_index", "1");
		const res = await postMultipart({
			path: "/v1/games",
			form,
			as: t.admin,
		});
		const body = await expectOk<{ game_id: string }>(res);
		expect(res.status).toBe(201);

		const matchAfter = await loadMatch(target.match_id);
		expect(matchAfter?.status).toBe("reported");
		// winnerIndex=0 mapped to slot_a via the explicit mapping above.
		expect(matchAfter?.winner_slot_id).toBe(target.slot_a_id);
		expect(matchAfter?.game_id).toBe(body.game_id);
		expect(matchAfter?.reported_by_user_id).toBe(t.admin.userId);
	});

	it("dedup-link: admin observer uploads a save already in their library, match is still reported using the existing game_id", async () => {
		const t = await makeTournament({
			name: "Dedup Cup",
			advanceTo: "swiss-round-1-generated",
		});
		const target = (await t.matches()).find((m) => m.status === "pending")!;

		// First upload: admin lands the save in their own library, no
		// tournament context. The bytes are pinned via a shared nonce so
		// the second upload produces a matching file_hash for dedup.
		const sharedNonce = "dedup-relink-fixture";
		const firstForm = await buildUploadFormData({
			winnerIndex: 0,
			uploaderIndex: null,
			nonce: sharedNonce,
		});
		const firstRes = await postMultipart({
			path: "/v1/games",
			form: firstForm,
			as: t.admin,
		});
		const firstBody = await expectOk<{ game_id: string }>(firstRes);
		expect(firstRes.status).toBe(201);

		// Match should still be pending — the first upload had no tournament
		// context.
		const matchBefore = await loadMatch(target.match_id);
		expect(matchBefore?.status).toBe("pending");
		expect(matchBefore?.game_id).toBeNull();

		// Second upload: same bytes (shared nonce), now with tournament
		// context. Server hits dedup-by-file_hash but should still run the
		// match-link block and return 200 with the existing game_id.
		const secondForm = await buildUploadFormData({
			winnerIndex: 0,
			uploaderIndex: null,
			nonce: sharedNonce,
		});
		secondForm.set("tournament_match_id", target.match_id);
		secondForm.set("tournament_slot_a_player_index", "0");
		secondForm.set("tournament_slot_b_player_index", "1");
		const secondRes = await postMultipart({
			path: "/v1/games",
			form: secondForm,
			as: t.admin,
		});
		const secondBody = await expectOk<{
			game_id: string;
			tournament_match_reported: boolean;
		}>(secondRes);
		expect(secondRes.status).toBe(200);
		expect(secondBody.game_id).toBe(firstBody.game_id);
		expect(secondBody.tournament_match_reported).toBe(true);

		// Match should now be reported, pointing at the existing game.
		const matchAfter = await loadMatch(target.match_id);
		expect(matchAfter?.status).toBe("reported");
		expect(matchAfter?.game_id).toBe(firstBody.game_id);
		expect(matchAfter?.winner_slot_id).toBe(target.slot_a_id);
		expect(matchAfter?.reported_by_user_id).toBe(t.admin.userId);

		// The reused game should now be public and live in the tournament's
		// collection (the link block applies to dedup-link too).
		const gameAfter = await loadGame(firstBody.game_id);
		expect(gameAfter?.is_public).toBe(1);
		const collName =
			gameAfter?.collection_id !== null &&
			gameAfter?.collection_id !== undefined
				? await loadCollectionName(gameAfter.collection_id)
				: null;
		expect(collName).toBe("Tournament: Dedup Cup");
	});

	it("rejects 403 NOT_MATCH_PARTICIPANT when a non-participant non-admin uploads with a tournament_match_id", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});
		const target = (await t.matches()).find((m) => m.status === "pending")!;
		const stranger = await makeUser({ discordUsername: "stranger" });

		const form = await buildUploadFormData({ winnerIndex: 0 });
		form.set("tournament_match_id", target.match_id);
		const res = await postMultipart({
			path: "/v1/games",
			form,
			as: stranger,
		});
		await expectErrorCode(res, {
			status: 403,
			code: "NOT_MATCH_PARTICIPANT",
		});

		// Match still pending.
		const matchAfter = await loadMatch(target.match_id);
		expect(matchAfter?.status).toBe("pending");
		expect(matchAfter?.game_id).toBeNull();
	});

	it("rejects 409 LINKED_TO_ACTIVE_TOURNAMENT when the owner tries to flip a tournament-linked game private", async () => {
		const playerA = await makeUser({ discordUsername: "alice-lock" });
		const playerB = await makeUser({ discordUsername: "bob-lock" });
		const playerC = await makeUser({ discordUsername: "carol-lock" });
		const playerD = await makeUser({ discordUsername: "dave-lock" });
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

		const patchRes = await request.patch({
			path: `/v1/games/${game_id}`,
			as: playerA,
			body: { is_public: false },
		});
		await expectErrorCode(patchRes, {
			status: 409,
			code: "LINKED_TO_ACTIVE_TOURNAMENT",
		});

		// is_public unchanged.
		const gameRow = await loadGame(game_id);
		expect(gameRow?.is_public).toBe(1);
	});

	it("rejects 409 TOURNAMENT_COMPLETE when uploading to a match whose tournament is already complete", async () => {
		const playerA = await makeUser({ discordUsername: "alice-done" });
		const playerB = await makeUser({ discordUsername: "bob-done" });
		const playerC = await makeUser({ discordUsername: "carol-done" });
		const playerD = await makeUser({ discordUsername: "dave-done" });
		const t = await makeTournament({
			slotOwners: { A: [playerA, playerB, playerC, playerD] },
			advanceTo: "swiss-round-1-generated",
		});
		const aSlot = t.slotsByDivision.A[0];
		const aMatch = (await t.matches()).find(
			(m) => m.slot_a_id === aSlot.slotId || m.slot_b_id === aSlot.slotId,
		)!;

		// The handler's gate fires on tournament_status alone (games.ts:887),
		// before any participant check. Setting status directly is enough
		// to exercise the gate without driving the full championship.
		await env.SHARE_DB.prepare(
			"UPDATE tournaments SET status = 'complete' WHERE tournament_id = ?",
		)
			.bind(t.tournamentId)
			.run();

		const form = await buildUploadFormData({ winnerIndex: 0 });
		form.set("tournament_match_id", aMatch.match_id);
		const res = await postMultipart({
			path: "/v1/games",
			form,
			as: playerA,
		});
		await expectErrorCode(res, {
			status: 409,
			code: "TOURNAMENT_COMPLETE",
		});
	});
});
