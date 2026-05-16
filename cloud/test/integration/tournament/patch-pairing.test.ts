// Behavior tests for PATCH /v1/tournaments/:id/matches/:match_id/pairing.
//
// Covers the authz + slot-validation work from the May review:
//   #1   cross-tournament check (loaded match must belong to URL tournament)
//   #2   slot_a_id / slot_b_id / pick_order_winner_slot_id all validated:
//        belong to this tournament, match round phase/division,
//        pick_order_winner is one of {slot_a, slot_b} post-patch
//   #7   PatchPairingSchema.slot_b_id no longer accepts null
//
// Test names describe behavior; bug numbers in side-comments are
// historical traceability to the May 2026 review punch list.

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

describe("PATCH /v1/tournaments/:id/matches/:match_id/pairing", () => {
	describe("happy path", () => {
		it("allows the admin to change just the map on a pending match", async () => {
			const t = await makeTournament({
				advanceTo: "swiss-round-1-generated",
				allowedMaps: ["MAP_SEASIDE", "MAP_RIVER", "MAP_CONTINENTS"],
			});
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/pairing`,
				as: t.admin,
				body: { map_script: "MAP_CONTINENTS" },
			});

			const body = await expectOk<{ match: { map_script: string } }>(res);
			expect(body.match.map_script).toBe("MAP_CONTINENTS");
		});
	});

	describe("cross-tournament authz (#1)", () => {
		it("rejects a patch when the match belongs to a different tournament", async () => {
			const a = await makeTournament({
				advanceTo: "swiss-round-1-generated",
			});
			const b = await makeTournament({
				advanceTo: "swiss-round-1-generated",
				admin: a.admin, // same admin so authz isn't what trips
			});
			const bMatch = await firstPendingMatchOf(b);

			const res = await request.patch({
				path: `/v1/tournaments/${a.tournamentId}/matches/${bMatch.match_id}/pairing`,
				as: a.admin,
				body: { map_script: "MAP_RIVER" },
			});

			await expectErrorCode(res, { status: 404, code: "MATCH_NOT_FOUND" });
		});

		it("rejects a patch for a non-existent match", async () => {
			const t = await makeTournament();
			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/aaaaaaaaaaaaaaaaaaaaa/pairing`,
				as: t.admin,
				body: { map_script: "MAP_SEASIDE" },
			});
			await expectErrorCode(res, { status: 404, code: "MATCH_NOT_FOUND" });
		});

		it("rejects a patch on a match whose status is already 'reported'", async () => {
			const t = await makeTournament({
				advanceTo: "swiss-round-1-reported",
			});
			const reported = (await t.matches()).find(
				(m) => m.status === "reported",
			);
			expect(reported).toBeDefined();
			if (!reported) return;

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${reported.match_id}/pairing`,
				as: t.admin,
				body: { map_script: "MAP_RIVER" },
			});

			await expectErrorCode(res, { status: 409, code: "MATCH_NOT_PENDING" });
		});
	});

	describe("slot validation (#2)", () => {
		it.each([
			"slot_a_id" as const,
			"slot_b_id" as const,
			"pick_order_winner_slot_id" as const,
		])("rejects %s when the slot belongs to a different tournament", async (field) => {
			const a = await makeTournament({
				advanceTo: "swiss-round-1-generated",
			});
			const b = await makeTournament({ admin: a.admin });
			const aMatch = await firstPendingMatchOf(a);
			const foreignSlot = b.slotsByDivision.A[0];

			const res = await request.patch({
				path: `/v1/tournaments/${a.tournamentId}/matches/${aMatch.match_id}/pairing`,
				as: a.admin,
				body: { [field]: foreignSlot.slotId },
			});

			await expectErrorCode(res, {
				status: 400,
				code: "SLOT_NOT_IN_TOURNAMENT",
			});
		});

		it("rejects slot_a_id from the wrong division (same tournament)", async () => {
			const t = await makeTournament({
				advanceTo: "swiss-round-1-generated",
			});
			// Find a pending div-A match, then pass a div-B slot as slot_a_id.
			const matches = await t.matches();
			const divAMatch = matches.find((m) =>
				t.slotsByDivision.A.some((s) => s.slotId === m.slot_a_id),
			);
			expect(divAMatch).toBeDefined();
			if (!divAMatch) return;
			const divBSlot = t.slotsByDivision.B[0];

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${divAMatch.match_id}/pairing`,
				as: t.admin,
				body: { slot_a_id: divBSlot.slotId },
			});

			await expectErrorCode(res, {
				status: 400,
				code: "SLOT_PHASE_MISMATCH",
			});
		});
	});

	describe("schema tightening (#7)", () => {
		it("rejects null slot_b_id at schema validation", async () => {
			const t = await makeTournament({
				advanceTo: "swiss-round-1-generated",
			});
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/pairing`,
				as: t.admin,
				body: { slot_b_id: null },
			});

			await expectErrorCode(res, { status: 400, code: "INVALID_BODY" });
		});
	});

	describe("post-patch pick_order_winner_slot_id membership (#2)", () => {
		it("rejects pick_order_winner_slot_id that isn't slot_a or slot_b after the patch", async () => {
			const t = await makeTournament({
				advanceTo: "swiss-round-1-generated",
			});
			const m = await firstPendingMatchOf(t);
			// Pick a slot from this tournament & division but not in this match.
			const slotsInMatch = new Set([m.slot_a_id, m.slot_b_id]);
			const otherSlot = t.slotsByDivision.A.find(
				(s) => !slotsInMatch.has(s.slotId),
			);
			expect(otherSlot).toBeDefined();
			if (!otherSlot) return;

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/pairing`,
				as: t.admin,
				body: { pick_order_winner_slot_id: otherSlot.slotId },
			});

			await expectErrorCode(res, {
				status: 400,
				code: "PICK_ORDER_WINNER_NOT_IN_MATCH",
			});
		});

		it("accepts pick_order_winner_slot_id that matches the new slot_b after a slot_b_id swap", async () => {
			// Build a tournament with a 5th slot in division A so we have a
			// spare to swap in. Default slotsPerDivision=4 gives 2 matches in
			// div A; we need a slot NOT currently in our chosen match.
			const t = await makeTournament({
				slotsPerDivision: 4,
				advanceTo: "swiss-round-1-generated",
			});
			const matches = await t.matches();
			const divAMatch = matches.find((m) =>
				t.slotsByDivision.A.some((s) => s.slotId === m.slot_a_id),
			);
			expect(divAMatch).toBeDefined();
			if (!divAMatch) return;

			// Find a div-A slot not in this match (must exist; div A has 4
			// slots and the match only consumes 2).
			const inMatch = new Set([divAMatch.slot_a_id, divAMatch.slot_b_id]);
			const newSlotB = t.slotsByDivision.A.find(
				(s) => !inMatch.has(s.slotId),
			);
			expect(newSlotB).toBeDefined();
			if (!newSlotB) return;

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${divAMatch.match_id}/pairing`,
				as: t.admin,
				body: {
					slot_b_id: newSlotB.slotId,
					pick_order_winner_slot_id: newSlotB.slotId,
				},
			});

			const body = await expectOk<{
				match: {
					slot_b_id: string;
					pick_order_winner_slot_id: string | null;
				};
			}>(res);
			expect(body.match.slot_b_id).toBe(newSlotB.slotId);
			expect(body.match.pick_order_winner_slot_id).toBe(newSlotB.slotId);
		});
	});

	describe("authentication & authorization regression", () => {
		it("returns 401 to an unauthenticated request", async () => {
			const t = await makeTournament({
				advanceTo: "swiss-round-1-generated",
			});
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/pairing`,
				body: { map_script: "MAP_RIVER" },
			});

			await expectErrorCode(res, { status: 401, code: "UNAUTHORIZED" });
		});

		it("returns 403 to an admin of a different tournament", async () => {
			const t = await makeTournament({
				advanceTo: "swiss-round-1-generated",
			});
			const otherAdmin = await makeUser();
			// Give otherAdmin admin rights on a different tournament so they
			// have a session, but not on `t`.
			await makeTournament({ admin: otherAdmin });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/pairing`,
				as: otherAdmin,
				body: { map_script: "MAP_RIVER" },
			});

			await expectErrorCode(res, {
				status: 403,
				code: "NOT_TOURNAMENT_ADMIN",
			});
		});
	});
});
