// Admin-initiated mid-tournament withdrawal. Pins the composition the unit
// tests can't reach: the withdraw endpoint sets withdrawn_at, forfeits the
// player's in-flight match to their opponent, and — once the round closes —
// the auto-generated next round excludes them. Plus the authz/phase gates and
// the reinstate path.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";
import type { MatchRow, RoundRow } from "../../../src/tournament/data";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

async function withdrawnAt(slotId: string): Promise<string | null> {
	const row = await env.SHARE_DB.prepare(
		"SELECT withdrawn_at FROM tournament_slots WHERE slot_id = ?",
	)
		.bind(slotId)
		.first<{ withdrawn_at: string | null }>();
	return row?.withdrawn_at ?? null;
}

describe("admin withdraw slot", () => {
	it("forfeits the in-flight match to the opponent and excludes the player from the next round", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const aIds = new Set(t.slotsByDivision.A.map((s) => s.slotId));
		const matches = (await t.matches()) as MatchRow[];

		// Two division-A round-1 matches (4 slots/division → no byes). Withdraw
		// slot_a of one; report the other to close the round.
		const divAMatches = matches.filter(
			(m) => m.status === "pending" && aIds.has(m.slot_a_id),
		);
		expect(divAMatches).toHaveLength(2);
		const target = divAMatches[0];
		const other = divAMatches[1];
		const withdrawnSlot = target.slot_a_id;
		const opponent = target.slot_b_id!;

		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/slots/${withdrawnSlot}/withdraw`,
				as: t.admin,
			}),
		);

		// withdrawn_at stamped, and the in-flight match forfeited to the opponent.
		expect(await withdrawnAt(withdrawnSlot)).not.toBeNull();
		const afterWithdraw = (await t.matches()) as MatchRow[];
		const forfeited = afterWithdraw.find(
			(m) => m.match_id === target.match_id,
		)!;
		expect(forfeited.status).toBe("forfeit");
		expect(forfeited.winner_slot_id).toBe(opponent);

		// Audit row written.
		const audit = await env.SHARE_DB.prepare(
			`SELECT COUNT(*) AS n FROM events
			 WHERE event_type = 'tournament_admin'
			   AND metadata LIKE '%slot_withdrawn%'`,
		).first<{ n: number }>();
		expect(audit?.n ?? 0).toBeGreaterThan(0);

		// Report the other division-A match so round 1 closes and round 2 spawns.
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${other.match_id}`,
				as: t.admin,
				body: { winner_slot_id: other.slot_a_id, status: "complete" },
			}),
		);

		// Round 2 (division A) was generated; the withdrawn slot appears in none
		// of its matches (including the bye), proving it left the pairing pool.
		const rounds = (await t.rounds()) as RoundRow[];
		const r2 = rounds.find(
			(r) => r.phase === "swiss" && r.division === "A" && r.round_number === 2,
		);
		expect(r2).toBeDefined();
		const r2Matches = ((await t.matches()) as MatchRow[]).filter(
			(m) => m.round_id === r2!.round_id,
		);
		expect(r2Matches.length).toBeGreaterThan(0);
		for (const m of r2Matches) {
			expect(m.slot_a_id).not.toBe(withdrawnSlot);
			expect(m.slot_b_id).not.toBe(withdrawnSlot);
		}
	});

	it("reinstate clears the withdrawn flag", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const slotId = t.slotsByDivision.A[0].slotId;

		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/slots/${slotId}/withdraw`,
				as: t.admin,
			}),
		);
		expect(await withdrawnAt(slotId)).not.toBeNull();

		await expectOk(
			await request.delete({
				path: `/v1/tournaments/${t.tournamentId}/slots/${slotId}/withdraw`,
				as: t.admin,
			}),
		);
		expect(await withdrawnAt(slotId)).toBeNull();
	});

	it("rejects a non-admin with 403", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const outsider = await makeUser();
		await expectErrorCode(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/slots/${t.slotsByDivision.A[0].slotId}/withdraw`,
				as: outsider,
			}),
			{ status: 403, code: "NOT_TOURNAMENT_ADMIN" },
		);
	});

	it("rejects withdrawal during setup (delete the slot instead)", async () => {
		const t = await makeTournament(); // status='setup'
		await expectErrorCode(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/slots/${t.slotsByDivision.A[0].slotId}/withdraw`,
				as: t.admin,
			}),
			{ status: 409, code: "INVALID_PHASE" },
		);
	});
});
