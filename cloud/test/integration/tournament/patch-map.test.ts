// Behavior tests for PATCH /v1/tournaments/:id/matches/:match_id/map.
//
// The endpoint is a narrow map-only edit. Slot identity is deliberately
// not patchable here — the substitute-username flow (patchSlot) covers
// player changes at the slot level. See PatchMatchMapSchema for rationale.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import {
	makeTournament,
	makeUser,
	type TestTournament,
} from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

async function firstPendingMatchOf(t: TestTournament) {
	const m = (await t.matches()).find((row) => row.status === "pending");
	if (!m) throw new Error("expected a pending match in fixture tournament");
	return m;
}

describe("PATCH /v1/tournaments/:id/matches/:match_id/map", () => {
	describe("happy path", () => {
		it("changes the map_script on a pending match", async () => {
			const t = await makeTournament({
				advanceTo: "swiss-round-1-generated",
				allowedMaps: ["MAP_SEASIDE", "MAP_RIVER", "MAP_CONTINENTS"],
			});
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/map`,
				as: t.admin,
				body: { map_script: "MAP_CONTINENTS" },
			});

			const body = await expectOk<{ match: { map_script: string } }>(res);
			expect(body.match.map_script).toBe("MAP_CONTINENTS");
		});

		it("returns the current match unchanged when map_script is omitted", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/map`,
				as: t.admin,
				body: {},
			});

			const body = await expectOk<{ match: { map_script: string | null } }>(
				res,
			);
			expect(body.match.map_script).toBe(m.map_script);
		});
	});

	describe("cross-tournament authz", () => {
		it("rejects a patch when the match belongs to a different tournament", async () => {
			const a = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const b = await makeTournament({
				advanceTo: "swiss-round-1-generated",
				admin: a.admin,
			});
			const bMatch = await firstPendingMatchOf(b);

			const res = await request.patch({
				path: `/v1/tournaments/${a.tournamentId}/matches/${bMatch.match_id}/map`,
				as: a.admin,
				body: { map_script: "MAP_RIVER" },
			});

			await expectErrorCode(res, { status: 404, code: "MATCH_NOT_FOUND" });
		});

		it("rejects a patch for a non-existent match", async () => {
			const t = await makeTournament();
			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/aaaaaaaaaaaaaaaaaaaaa/map`,
				as: t.admin,
				body: { map_script: "MAP_SEASIDE" },
			});
			await expectErrorCode(res, { status: 404, code: "MATCH_NOT_FOUND" });
		});

		it("rejects a patch on a match whose status is already 'complete'", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-complete" });
			const reported = (await t.matches()).find((m) => m.status === "complete");
			expect(reported).toBeDefined();
			if (!reported) return;

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${reported.match_id}/map`,
				as: t.admin,
				body: { map_script: "MAP_RIVER" },
			});

			await expectErrorCode(res, { status: 409, code: "MATCH_NOT_PENDING" });
		});
	});

	describe("authentication & authorization regression", () => {
		it("returns 404 to an unauthenticated request (beta gate hides existence)", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/map`,
				body: { map_script: "MAP_RIVER" },
			});

			await expectErrorCode(res, {
				status: 404,
				code: "TOURNAMENT_NOT_FOUND",
			});
		});

		it("returns 403 to an admin of a different tournament", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const otherAdmin = await makeUser();
			// Give otherAdmin admin rights on a different tournament so they
			// have a session, but not on `t`.
			await makeTournament({ admin: otherAdmin });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/map`,
				as: otherAdmin,
				body: { map_script: "MAP_RIVER" },
			});

			await expectErrorCode(res, { status: 403, code: "NOT_TOURNAMENT_ADMIN" });
		});
	});
});
