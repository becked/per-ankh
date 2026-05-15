// Behavior tests for GET /v1/users/me/matches.
//
// Covers:
//   #5   MyMatchEntry was changed from `extends TournamentMatch` to a
//        hand-rolled shape that matches the SELECT exactly. This test pins
//        the response key set so future SELECT drift fails loudly.
//   regression: auth required, empty-array for users with no slots,
//                multi-tournament aggregation.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// The fields handleMyMatches SELECTs. Keep this in sync with
// cloud/src/tournament/player.ts:handleMyMatches. The "exposes exactly"
// test below uses this as the contract.
const EXPECTED_MY_MATCH_KEYS = [
	"division",
	"game_id",
	"map_script",
	"match_id",
	"phase",
	"reported_at",
	"round_id",
	"round_number",
	"round_status",
	"slot_a_id",
	"slot_b_id",
	"status",
	"tournament_id",
	"tournament_name",
	"tournament_slug",
	"winner_slot_id",
].sort();

describe("GET /v1/users/me/matches", () => {
	it("returns 401 to an unauthenticated request", async () => {
		const res = await request.get({ path: "/v1/users/me/matches" });
		await expectErrorCode(res, { status: 401, code: "UNAUTHORIZED" });
	});

	it("returns an empty array for a user with no claimed slots", async () => {
		const lonely = await makeUser();
		const res = await request.get({
			path: "/v1/users/me/matches",
			as: lonely,
		});
		const body = await expectOk<{ matches: unknown[] }>(res);
		expect(body.matches).toEqual([]);
	});

	it("returns matches for the caller's claimed slots across multiple tournaments", async () => {
		const player = await makeUser({ discordUsername: "multi-tournament-player" });
		const t1 = await makeTournament({
			slotsPerDivision: 4,
			slotOwners: { A: [player] },
			advanceTo: "swiss-round-1-generated",
		});
		const t2 = await makeTournament({
			slotsPerDivision: 4,
			slotOwners: { B: [player] },
			advanceTo: "swiss-round-1-generated",
		});

		const res = await request.get({
			path: "/v1/users/me/matches",
			as: player,
		});
		const body = await expectOk<{
			matches: Array<Record<string, unknown>>;
		}>(res);

		expect(body.matches).toHaveLength(2);
		const tournamentIds = new Set(body.matches.map((m) => m.tournament_id));
		expect(tournamentIds).toEqual(
			new Set([t1.tournamentId, t2.tournamentId]),
		);
	});

	it("deduplicates when the caller owns both slots of a single match (#23)", async () => {
		// No DB constraint prevents one user from claiming both slots of a
		// match (an admin error, but reachable). The OR-join in handleMyMatches
		// would produce two rows for the same match; SELECT DISTINCT guards
		// against that. Construct the edge case by direct UPDATE.
		const dupOwner = await makeUser({ discordUsername: "owns-both-slots" });
		const t = await makeTournament({
			slotsPerDivision: 4,
			advanceTo: "swiss-round-1-generated",
		});
		const match = (await t.matches()).find(
			(m) => m.slot_b_id !== null && m.status === "pending",
		);
		expect(match).toBeDefined();
		if (!match || !match.slot_b_id) return;
		await env.SHARE_DB.prepare(
			`UPDATE tournament_slots SET user_id = ? WHERE slot_id IN (?, ?)`,
		)
			.bind(dupOwner.userId, match.slot_a_id, match.slot_b_id)
			.run();

		const res = await request.get({
			path: "/v1/users/me/matches",
			as: dupOwner,
		});
		const body = await expectOk<{
			matches: Array<Record<string, unknown>>;
		}>(res);
		const ownedRows = body.matches.filter(
			(m) => m.match_id === match.match_id,
		);
		expect(ownedRows).toHaveLength(1);
	});

	it("exposes exactly the fields handleMyMatches selects (no more, no less)", async () => {
		const player = await makeUser({ discordUsername: "shape-check-player" });
		await makeTournament({
			slotsPerDivision: 4,
			slotOwners: { A: [player] },
			advanceTo: "swiss-round-1-generated",
		});

		const res = await request.get({
			path: "/v1/users/me/matches",
			as: player,
		});
		const body = await expectOk<{
			matches: Array<Record<string, unknown>>;
		}>(res);
		expect(body.matches).toHaveLength(1);

		const actualKeys = Object.keys(body.matches[0]).sort();
		expect(actualKeys).toEqual(EXPECTED_MY_MATCH_KEYS);
	});
});
