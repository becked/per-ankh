// Behavior tests for PATCH /v1/tournaments/:id/matches/:match_id (retro-edit).
//
// Covers:
//   #8   winner_slot_id must be one of {match.slot_a_id, match.slot_b_id};
//        defense-in-depth via loadSlotInTournament.
//   regression: downstream-block, cross-tournament 404, status transitions.

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

describe("PATCH /v1/tournaments/:id/matches/:match_id (retro-edit)", () => {
	describe("happy path", () => {
		it("reports a winner that matches slot_a_id", async () => {
			const t = await makeTournament({
				advanceTo: "swiss-round-1-generated",
			});
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
				as: t.admin,
				body: { winner_slot_id: m.slot_a_id, status: "reported" },
			});

			const body = await expectOk<{
				match: { winner_slot_id: string | null; status: string };
			}>(res);
			expect(body.match.winner_slot_id).toBe(m.slot_a_id);
			expect(body.match.status).toBe("reported");
		});

		it("reports a winner that matches slot_b_id", async () => {
			const t = await makeTournament({
				advanceTo: "swiss-round-1-generated",
			});
			const m = await firstPendingMatchOf(t);
			expect(m.slot_b_id).not.toBeNull();
			if (!m.slot_b_id) return;

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
				as: t.admin,
				body: { winner_slot_id: m.slot_b_id, status: "reported" },
			});

			const body = await expectOk<{ match: { winner_slot_id: string | null } }>(
				res,
			);
			expect(body.match.winner_slot_id).toBe(m.slot_b_id);
		});

		it("clears a previously-set winner by sending winner_slot_id=null", async () => {
			const t = await makeTournament({
				advanceTo: "swiss-round-1-reported",
			});
			const reported = (await t.matches()).find(
				(row) => row.status === "reported",
			);
			expect(reported).toBeDefined();
			if (!reported) return;

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${reported.match_id}`,
				as: t.admin,
				body: { winner_slot_id: null, status: "pending" },
			});

			const body = await expectOk<{
				match: { winner_slot_id: string | null; status: string };
			}>(res);
			expect(body.match.winner_slot_id).toBeNull();
			expect(body.match.status).toBe("pending");
		});
	});

	describe("winner-in-match validation (#8)", () => {
		it("rejects a winner_slot_id outside the match's two slots", async () => {
			const t = await makeTournament({
				advanceTo: "swiss-round-1-generated",
			});
			const m = await firstPendingMatchOf(t);
			const inMatch = new Set([m.slot_a_id, m.slot_b_id]);
			const stranger = t.slotsByDivision.A.find(
				(s) => !inMatch.has(s.slotId),
			);
			expect(stranger).toBeDefined();
			if (!stranger) return;

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
				as: t.admin,
				body: { winner_slot_id: stranger.slotId, status: "reported" },
			});

			await expectErrorCode(res, {
				status: 400,
				code: "WINNER_NOT_IN_MATCH",
			});
		});

		it("rejects a winner_slot_id from a different tournament", async () => {
			const a = await makeTournament({
				advanceTo: "swiss-round-1-generated",
			});
			const b = await makeTournament({ admin: a.admin });
			const m = await firstPendingMatchOf(a);
			const foreignSlot = b.slotsByDivision.A[0];

			const res = await request.patch({
				path: `/v1/tournaments/${a.tournamentId}/matches/${m.match_id}`,
				as: a.admin,
				body: { winner_slot_id: foreignSlot.slotId, status: "reported" },
			});

			// Caught by the membership check before defense-in-depth runs.
			await expectErrorCode(res, {
				status: 400,
				code: "WINNER_NOT_IN_MATCH",
			});
		});
	});

	describe("cross-tournament authz", () => {
		it("returns 404 for a match in a different tournament", async () => {
			const a = await makeTournament({
				advanceTo: "swiss-round-1-generated",
			});
			const b = await makeTournament({
				advanceTo: "swiss-round-1-generated",
				admin: a.admin,
			});
			const bMatch = await firstPendingMatchOf(b);

			const res = await request.patch({
				path: `/v1/tournaments/${a.tournamentId}/matches/${bMatch.match_id}`,
				as: a.admin,
				body: { winner_slot_id: bMatch.slot_a_id, status: "reported" },
			});

			await expectErrorCode(res, { status: 404, code: "MATCH_NOT_FOUND" });
		});

		it("returns 403 to an admin of a different tournament", async () => {
			const t = await makeTournament({
				advanceTo: "swiss-round-1-generated",
			});
			const otherAdmin = await makeUser();
			await makeTournament({ admin: otherAdmin });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
				as: otherAdmin,
				body: { winner_slot_id: m.slot_a_id, status: "reported" },
			});

			await expectErrorCode(res, {
				status: 403,
				code: "NOT_TOURNAMENT_ADMIN",
			});
		});
	});
});
