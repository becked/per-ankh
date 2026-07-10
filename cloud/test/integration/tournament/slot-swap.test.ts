// Behavior tests for POST /v1/tournaments/:id/slots/swap — swapping the
// OCCUPANTS of two same-phase slots. Identity (username / discord id / linked
// user / signup answer) moves between the seats; everything that defines the
// seat (seed, division, committed pairings, history) stays. The core safety
// rule: the swap refuses once either seat has any decided match — including a
// bye — so results can never be reattributed to the wrong player.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

function swapPath(tid: string) {
	return `/v1/tournaments/${tid}/slots/swap`;
}

interface SlotResponse {
	slot_id: string;
	discord_username: string | null;
	user_id: string | null;
	swiss_seed: number | null;
	division: string | null;
}

describe("POST /v1/tournaments/:id/slots/swap", () => {
	it("swaps occupants between two pending seats; seats keep seed/division", async () => {
		const p1 = await makeUser({ discordUsername: "swap_alice" });
		const p2 = await makeUser({ discordUsername: "swap_bob" });
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
			slotOwners: { A: [p1, p2] },
		});
		const [a, b] = t.slotsByDivision.A;

		const res = await expectOk<{ slots: SlotResponse[] }>(
			await request.post({
				path: swapPath(t.tournamentId),
				as: t.admin,
				body: { slot_a_id: a.slotId, slot_b_id: b.slotId },
			}),
		);
		const bySlot = new Map(res.slots.map((s) => [s.slot_id, s]));
		const a2 = bySlot.get(a.slotId)!;
		const b2 = bySlot.get(b.slotId)!;
		// Identities crossed over…
		expect(a2.discord_username).toBe(b.discordUsername);
		expect(b2.discord_username).toBe(a.discordUsername);
		expect(a2.user_id).toBe(b.owner?.userId ?? null);
		expect(b2.user_id).toBe(a.owner?.userId ?? null);
		// …seats stayed put.
		expect(a2.swiss_seed).toBe(a.swissSeed);
		expect(b2.swiss_seed).toBe(b.swissSeed);
		expect(a2.division).toBe("A");
		expect(b2.division).toBe("A");
	});

	it("refuses once a seat has a decided match (results would reattribute)", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const [a, b] = t.slotsByDivision.A;
		// Decide the round-1 match slot A participates in.
		const m = (await t.matches()).find(
			(mm) =>
				mm.status === "pending" &&
				(mm.slot_a_id === a.slotId || mm.slot_b_id === a.slotId),
		)!;
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
				as: t.admin,
				body: { winner_slot_id: m.slot_a_id, status: "complete" },
			}),
		);

		await expectErrorCode(
			await request.post({
				path: swapPath(t.tournamentId),
				as: t.admin,
				body: { slot_a_id: a.slotId, slot_b_id: b.slotId },
			}),
			{ status: 409, code: "SLOT_HAS_RESULTS" },
		);
	});

	it("a bye counts as a decided match", async () => {
		// 3 slots in a division → round 1 has a bye. The bye recipient's seat
		// has banked a +1-win result, so it can't be swapped.
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
			slotsPerDivision: 3,
		});
		const bye = (await t.matches()).find((m) => m.status === "bye")!;
		const byeSlotId = bye.slot_a_id;
		const other = t.slotsByDivision.A.find((s) => s.slotId !== byeSlotId)!;

		await expectErrorCode(
			await request.post({
				path: swapPath(t.tournamentId),
				as: t.admin,
				body: { slot_a_id: byeSlotId, slot_b_id: other.slotId },
			}),
			{ status: 409, code: "SLOT_HAS_RESULTS" },
		);
	});

	it("locks cross-division swaps after start, allows them during setup", async () => {
		const started = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});
		await expectErrorCode(
			await request.post({
				path: swapPath(started.tournamentId),
				as: started.admin,
				body: {
					slot_a_id: started.slotsByDivision.A[0].slotId,
					slot_b_id: started.slotsByDivision.B[0].slotId,
				},
			}),
			{ status: 409, code: "TOURNAMENT_LOCKED" },
		);

		const setup = await makeTournament({ advanceTo: "setup" });
		await expectOk(
			await request.post({
				path: swapPath(setup.tournamentId),
				as: setup.admin,
				body: {
					slot_a_id: setup.slotsByDivision.A[0].slotId,
					slot_b_id: setup.slotsByDivision.B[0].slotId,
				},
			}),
		);
	});

	it("rejects a non-admin (403) and a same-slot swap (400)", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const [a, b] = t.slotsByDivision.A;
		const outsider = await makeUser();

		await expectErrorCode(
			await request.post({
				path: swapPath(t.tournamentId),
				as: outsider,
				body: { slot_a_id: a.slotId, slot_b_id: b.slotId },
			}),
			{ status: 403, code: "NOT_TOURNAMENT_ADMIN" },
		);
		await expectErrorCode(
			await request.post({
				path: swapPath(t.tournamentId),
				as: t.admin,
				body: { slot_a_id: a.slotId, slot_b_id: a.slotId },
			}),
			{ status: 400, code: "SAME_SLOT" },
		);
	});

	it("404s a slot from another tournament", async () => {
		const t1 = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const t2 = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		await expectErrorCode(
			await request.post({
				path: swapPath(t1.tournamentId),
				as: t1.admin,
				body: {
					slot_a_id: t1.slotsByDivision.A[0].slotId,
					slot_b_id: t2.slotsByDivision.A[0].slotId,
				},
			}),
			{ status: 404, code: "SLOT_NOT_FOUND" },
		);
	});
});
