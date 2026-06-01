// Idempotency of maybeAdvanceAfterMatchReport — the safety property behind
// "parallel last-match reports". When the last pending match of a round/phase
// reports, auto-advance closes the round and (for swiss) generates the next one
// or (for the championship final) completes the tournament. If two reports race
// to close the same round, both advance calls can pass the
// `roundMatches.some(pending)` gate; the second must be a no-op.
//
// The integration runner is single-threaded, so this can't reproduce a true
// race. Instead it pins the guards that make a race safe: the downstream-exists
// check and the status-scoped WHERE clauses. The DB-level backstop — the
// UNIQUE(tournament_id, phase, division, round_number) index on
// tournament_rounds combined with the transactional batch in advance — is what
// makes a genuinely concurrent duplicate-insert fail atomically.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeTournament } from "../../helpers/builders";
import { request } from "../../helpers/requests";
import { maybeAdvanceAfterMatchReport } from "../../../src/tournament/admin";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

async function reportMatch(
	tournamentId: string,
	matchId: string,
	winnerSlotId: string,
	as: { sessionToken: string },
): Promise<void> {
	await expectOk(
		await request.patch({
			path: `/v1/tournaments/${tournamentId}/matches/${matchId}`,
			as,
			body: { winner_slot_id: winnerSlotId, status: "complete" },
		}),
	);
}

describe("idempotent auto-advance (parallel last-match reports)", () => {
	it("re-running advance after a swiss round closes does not generate a duplicate next round", async () => {
		const t = await makeTournament({
			slotsPerDivision: 4,
			advanceTo: "swiss-round-1-generated",
		});

		// Division-A round 1 (4 slots → 2 matches, no byes).
		const aR1 = (await t.rounds()).find(
			(r) => r.phase === "swiss" && r.division === "A" && r.round_number === 1,
		)!;
		const aMatches = (await t.matches()).filter(
			(m) => m.round_id === aR1.round_id && m.status !== "bye",
		);
		expect(aMatches.length).toBeGreaterThan(0);

		// Report every division-A match; the last one's report fires advance,
		// closing round 1 and generating round 2 for division A.
		for (const m of aMatches) {
			await reportMatch(t.tournamentId, m.match_id, m.slot_a_id, t.admin);
		}
		const lastMatch = aMatches[aMatches.length - 1];

		const aRoundsAfter = (await t.rounds()).filter(
			(r) => r.phase === "swiss" && r.division === "A",
		);
		expect(aRoundsAfter.filter((r) => r.round_number === 2)).toHaveLength(1);
		expect(aRoundsAfter.find((r) => r.round_id === aR1.round_id)?.status).toBe(
			"complete",
		);

		// Re-run advance for the same final match — simulates a second racing
		// report's advance call landing after round 1 is already closed and
		// round 2 already exists. Must be a no-op.
		await maybeAdvanceAfterMatchReport(env, lastMatch.match_id);

		const aRoundsFinal = (await t.rounds()).filter(
			(r) => r.phase === "swiss" && r.division === "A",
		);
		expect(aRoundsFinal.filter((r) => r.round_number === 2)).toHaveLength(1);
		expect(aRoundsFinal).toHaveLength(aRoundsAfter.length);
	});

	it("re-running advance after the championship final does not un-complete or duplicate", async () => {
		// Drive a full 1-round-swiss → championship, mirroring flow.test.ts.
		const t = await makeTournament({ slotsPerDivision: 4 });
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
			await reportMatch(t.tournamentId, m.match_id, m.slot_a_id, t.admin);
		}
		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/transition-championship`,
				as: t.admin,
			}),
		);

		// Report the semifinals; auto-advance spawns the final.
		const champR1 = (await t.rounds()).find(
			(r) => r.phase === "championship" && r.round_number === 1,
		)!;
		for (const m of (await t.matches()).filter(
			(m) => m.round_id === champR1.round_id,
		)) {
			await reportMatch(t.tournamentId, m.match_id, m.slot_a_id, t.admin);
		}

		const champR2 = (await t.rounds()).find(
			(r) => r.phase === "championship" && r.round_number === 2,
		)!;
		const finals = (await t.matches()).filter(
			(m) => m.round_id === champR2.round_id,
		);
		expect(finals).toHaveLength(1);
		const final = finals[0];

		// Report the final → tournament completes.
		await reportMatch(t.tournamentId, final.match_id, final.slot_a_id, t.admin);
		expect((await t.refresh()).status).toBe("complete");
		const roundCountBefore = (await t.rounds()).length;

		// Re-run advance for the final — must not add a round or change status.
		await maybeAdvanceAfterMatchReport(env, final.match_id);
		expect((await t.refresh()).status).toBe("complete");
		expect((await t.rounds()).length).toBe(roundCountBefore);
	});
});
