// Behavior tests for POST /v1/tournaments/:id/transition-championship.
//
// Covers:
//   #10  override_ranks slot validation: each override id must exist in
//        this tournament, be a swiss-phase slot, and match the named division.
//   regression: clean transition, championship_seed assignment.

import { applyD1Migrations, env } from "cloudflare:test";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, type TestTournament } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// Drive a tournament to "swiss complete" so transition is eligible.
// Configuration: 1 round, win threshold 1, loss threshold 1 → swiss wraps
// after a single round.
async function makeSwissDoneTournament(opts?: {
	slotsPerDivision?: number;
}): Promise<TestTournament> {
	const t = await makeTournament({
		slotsPerDivision: opts?.slotsPerDivision ?? 4,
	});
	await expectOk(
		await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				swiss_wins_to_advance: 1,
				swiss_losses_to_eliminate: 1,
				swiss_max_rounds: 1,
			},
		}),
	);
	await expectOk(
		await request.post({
			path: `/v1/tournaments/${t.tournamentId}/start`,
			as: t.admin,
		}),
	);
	for (const m of await t.matches()) {
		if (m.status === "bye") continue;
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
				as: t.admin,
				body: { winner_slot_id: m.slot_a_id, status: "reported" },
			}),
		);
	}
	return t;
}

describe("POST /v1/tournaments/:id/transition-championship", () => {
	describe("happy path", () => {
		it("transitions a tournament without override when ranks are clean", async () => {
			const t = await makeSwissDoneTournament();

			const res = await request.post({
				path: `/v1/tournaments/${t.tournamentId}/transition-championship`,
				as: t.admin,
			});

			await expectOk(res);
			expect((await t.refresh()).status).toBe("championship");
		});

		it("assigns championship_seed 1..2N to the new championship slots", async () => {
			const t = await makeSwissDoneTournament();
			await expectOk(
				await request.post({
					path: `/v1/tournaments/${t.tournamentId}/transition-championship`,
					as: t.admin,
				}),
			);

			const champSlots =
				(
					await env.SHARE_DB.prepare(
						`SELECT championship_seed FROM tournament_slots
					   WHERE tournament_id = ? AND phase = 'championship'
					   ORDER BY championship_seed`,
					)
						.bind(t.tournamentId)
						.all<{ championship_seed: number }>()
				).results ?? [];

			expect(champSlots.length).toBeGreaterThan(0);
			expect(champSlots.map((s) => s.championship_seed)).toEqual(
				Array.from({ length: champSlots.length }, (_, i) => i + 1),
			);
		});
	});

	describe("override_ranks validation (#10)", () => {
		it("rejects an override slot from a different tournament", async () => {
			const t = await makeSwissDoneTournament();
			const foreign = await makeTournament({ admin: t.admin });
			const advanceCount = (await t.refresh()).swiss_advance_count!;
			const validA = t.slotsByDivision.A.slice(0, advanceCount).map(
				(s) => s.slotId,
			);
			const validB = t.slotsByDivision.B.slice(0, advanceCount).map(
				(s) => s.slotId,
			);
			// Replace the first A advancer with a slot from the foreign tournament.
			const tamperedA = [
				foreign.slotsByDivision.A[0].slotId,
				...validA.slice(1),
			];

			const res = await request.post({
				path: `/v1/tournaments/${t.tournamentId}/transition-championship`,
				as: t.admin,
				body: { override_ranks: { A: tamperedA, B: validB } },
			});

			await expectErrorCode(res, {
				status: 400,
				code: "OVERRIDE_SLOT_NOT_IN_TOURNAMENT",
			});
		});

		it("rejects an override slot from the wrong division (same tournament)", async () => {
			const t = await makeSwissDoneTournament();
			const advanceCount = (await t.refresh()).swiss_advance_count!;
			// Use a division-B slot in the A advancer list.
			const tamperedA = [
				t.slotsByDivision.B[0].slotId,
				...t.slotsByDivision.A.slice(1, advanceCount).map((s) => s.slotId),
			];
			const validB = t.slotsByDivision.B.slice(0, advanceCount).map(
				(s) => s.slotId,
			);

			const res = await request.post({
				path: `/v1/tournaments/${t.tournamentId}/transition-championship`,
				as: t.admin,
				body: { override_ranks: { A: tamperedA, B: validB } },
			});

			await expectErrorCode(res, {
				status: 400,
				code: "OVERRIDE_SLOT_WRONG_DIVISION",
			});
		});

		it("rejects an override slot that's not swiss-phase", async () => {
			// Hand-craft an unreachable state: a championship-phase slot inside
			// a still-swiss-phase tournament. The handler's defensive check
			// should catch it. Production never reaches this state via real
			// flows, so direct SQL is the only way.
			const t = await makeSwissDoneTournament();
			const advanceCount = (await t.refresh()).swiss_advance_count!;
			const sneakSlotId = nanoid(21);
			await env.SHARE_DB.prepare(
				`INSERT INTO tournament_slots
				   (slot_id, tournament_id, phase, division, championship_seed,
				    discord_username)
				 VALUES (?, ?, 'championship', NULL, 1, ?)`,
			)
				.bind(sneakSlotId, t.tournamentId, "stowaway")
				.run();

			const tamperedA = [
				sneakSlotId,
				...t.slotsByDivision.A.slice(1, advanceCount).map((s) => s.slotId),
			];
			const validB = t.slotsByDivision.B.slice(0, advanceCount).map(
				(s) => s.slotId,
			);

			const res = await request.post({
				path: `/v1/tournaments/${t.tournamentId}/transition-championship`,
				as: t.admin,
				body: { override_ranks: { A: tamperedA, B: validB } },
			});

			await expectErrorCode(res, {
				status: 400,
				code: "OVERRIDE_SLOT_WRONG_PHASE",
			});
		});

		it("accepts override_ranks composed of valid same-tournament swiss slots", async () => {
			const t = await makeSwissDoneTournament();
			const advanceCount = (await t.refresh()).swiss_advance_count!;
			const validA = t.slotsByDivision.A.slice(0, advanceCount).map(
				(s) => s.slotId,
			);
			const validB = t.slotsByDivision.B.slice(0, advanceCount).map(
				(s) => s.slotId,
			);

			const res = await request.post({
				path: `/v1/tournaments/${t.tournamentId}/transition-championship`,
				as: t.admin,
				body: { override_ranks: { A: validA, B: validB } },
			});

			await expectOk(res);
			expect((await t.refresh()).status).toBe("championship");
		});
	});

	describe("cascade-tie error shape (#25)", () => {
		it("returns 409 with division, tied_slot_ids, ranked alongside the standard error/code", async () => {
			// Engineer a cascade tie at the cutoff: 4 slots/div, 1 round, all
			// matches won by slot_a. Winners (2) tie at rank 1; losers (2) tie
			// at rank 3. With swiss_advance_count=3, ranked[2] and ranked[3]
			// share rank 3 — collectTiedAtCutoff fires.
			const t = await makeTournament({ slotsPerDivision: 4 });
			await expectOk(
				await request.patch({
					path: `/v1/tournaments/${t.tournamentId}`,
					as: t.admin,
					body: {
						swiss_wins_to_advance: 1,
						swiss_losses_to_eliminate: 1,
						swiss_max_rounds: 1,
						swiss_advance_count: 3,
					},
				}),
			);
			await expectOk(
				await request.post({
					path: `/v1/tournaments/${t.tournamentId}/start`,
					as: t.admin,
				}),
			);
			for (const m of await t.matches()) {
				if (m.status === "bye") continue;
				await expectOk(
					await request.patch({
						path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
						as: t.admin,
						body: { winner_slot_id: m.slot_a_id, status: "reported" },
					}),
				);
			}

			const res = await request.post({
				path: `/v1/tournaments/${t.tournamentId}/transition-championship`,
				as: t.admin,
			});
			expect(res.status).toBe(409);
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.code).toBe("CASCADE_TIE_AT_CUTOFF");
			expect(body.error).toBe("Cascade tied at advance cutoff");
			expect(["A", "B"]).toContain(body.division);
			expect(Array.isArray(body.tied_slot_ids)).toBe(true);
			expect((body.tied_slot_ids as string[]).length).toBeGreaterThan(0);
			expect(Array.isArray(body.ranked)).toBe(true);
			for (const r of body.ranked as Array<Record<string, unknown>>) {
				expect(r).toHaveProperty("slot_id");
				expect(r).toHaveProperty("rank");
				expect(r).toHaveProperty("wins");
				expect(r).toHaveProperty("losses");
				expect(r).toHaveProperty("median_buchholz");
				expect(r).toHaveProperty("solkoff");
			}
		});
	});
});
