// Audit log: every admin mutation writes one `tournament_admin` row to
// `events` with the action name + tournament_id in JSON metadata. Drives
// the live admin mutations through the public handlers (not a unit test
// of logTournamentAdminAction) so it catches refactors that move the log
// site outside the happy path.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeTournament, type TestTournament } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface AdminEventRow {
	event_type: string;
	user_id: string | null;
	metadata: string | null;
}

async function adminEventsForUser(userId: string): Promise<AdminEventRow[]> {
	const res = await env.SHARE_DB.prepare(
		`SELECT event_type, user_id, metadata FROM events
		 WHERE event_type = 'tournament_admin' AND user_id = ?
		 ORDER BY id ASC`,
	)
		.bind(userId)
		.all<AdminEventRow>();
	return res.results ?? [];
}

function actionsFor(rows: AdminEventRow[]): string[] {
	return rows.map((r) => {
		const meta = r.metadata
			? (JSON.parse(r.metadata) as { action?: string })
			: {};
		return meta.action ?? "";
	});
}

describe("tournament admin audit log", () => {
	it("PATCH /tournaments/:id emits tournament_patched", async () => {
		const t = await makeTournament();
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: { description: "audit-log test description" },
		});
		await expectOk(res);
		const rows = await adminEventsForUser(t.admin.userId);
		expect(actionsFor(rows)).toContain("tournament_patched");
		const meta = JSON.parse(rows[rows.length - 1].metadata!) as {
			tournament_id: string;
		};
		expect(meta.tournament_id).toBe(t.tournamentId);
	});

	it("POST /tournaments/:id/slots emits slots_bulk_created", async () => {
		// makeTournament itself calls the bulk-create endpoint, so a fresh
		// tournament is enough to assert the event was logged.
		const t = await makeTournament();
		expect(actionsFor(await adminEventsForUser(t.admin.userId))).toContain(
			"slots_bulk_created",
		);
	});

	it("PATCH /tournaments/:id/slots/:slot_id emits slot_patched", async () => {
		const t = await makeTournament();
		const slot = t.slotsByDivision.A[0];
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}/slots/${slot.slotId}`,
			as: t.admin,
			body: { discord_username: "audit_renamed" },
		});
		await expectOk(res);
		expect(actionsFor(await adminEventsForUser(t.admin.userId))).toContain(
			"slot_patched",
		);
	});

	it("DELETE /tournaments/:id/slots/:slot_id emits slot_deleted", async () => {
		const t = await makeTournament();
		const slot = t.slotsByDivision.A[0];
		const res = await request.delete({
			path: `/v1/tournaments/${t.tournamentId}/slots/${slot.slotId}`,
			as: t.admin,
		});
		expect(res.status).toBe(204);
		expect(actionsFor(await adminEventsForUser(t.admin.userId))).toContain(
			"slot_deleted",
		);
	});

	it("POST /tournaments/:id/start-swiss emits swiss_started", async () => {
		const t = await makeTournament();
		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/start-swiss`,
			as: t.admin,
		});
		await expectOk(res);
		expect(actionsFor(await adminEventsForUser(t.admin.userId))).toContain(
			"swiss_started",
		);
	});

	it("POST /tournaments/:id/rounds + start emits round_generated and round_started", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const actions = actionsFor(await adminEventsForUser(t.admin.userId));
		expect(actions).toContain("round_generated");
		expect(actions).toContain("round_started");
	});

	it("PATCH /tournaments/:id/matches/:match_id/pairing emits pairing_patched", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const matches = await t.matches();
		const target = matches.find((m) => m.status === "pending");
		expect(target).toBeDefined();
		// Swap slot_a and slot_b — both are valid swiss slots in the same
		// division as the round.
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}/matches/${target!.match_id}/pairing`,
			as: t.admin,
			body: {
				slot_a_id: target!.slot_b_id,
				slot_b_id: target!.slot_a_id,
			},
		});
		await expectOk(res);
		expect(actionsFor(await adminEventsForUser(t.admin.userId))).toContain(
			"pairing_patched",
		);
	});

	it("PATCH /tournaments/:id/matches/:match_id (retro edit) emits match_retro_edited", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-reported" });
		// The advance-to helper already reported every match, but it did so by
		// PATCH /matches/:id — which is the same retro-edit endpoint we're
		// auditing. The audit-log events were emitted then.
		expect(actionsFor(await adminEventsForUser(t.admin.userId))).toContain(
			"match_retro_edited",
		);
	});

	it("audit log is emitted only on success, not on validation failure", async () => {
		const t = await makeTournament();
		const before = (await adminEventsForUser(t.admin.userId)).length;
		// Wrong-status patch will 400.
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: { description: 12345 }, // wrong type — Valibot rejects
		});
		expect(res.status).toBe(400);
		const after = (await adminEventsForUser(t.admin.userId)).length;
		expect(after).toBe(before);
	});

	it("POST /tournaments/:id/transition-championship emits championship_transitioned", async () => {
		// 4-slot swiss configured to wrap in one round, mirroring the flow
		// test's setup. The builder's advanceTo doesn't accept config
		// overrides, so we drive setup inline.
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
		await driveSwissOneRound(t);
		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/transition-championship`,
				as: t.admin,
			}),
		);

		expect(actionsFor(await adminEventsForUser(t.admin.userId))).toContain(
			"championship_transitioned",
		);
	});

	it("POST /tournaments/:id/complete emits tournament_completed", async () => {
		// Drive a 4-slot swiss → championship semis → final → complete.
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
		await driveSwissOneRound(t);
		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/transition-championship`,
				as: t.admin,
			}),
		);
		await driveChampionshipToFinal(t);
		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/complete`,
				as: t.admin,
			}),
		);

		expect(actionsFor(await adminEventsForUser(t.admin.userId))).toContain(
			"tournament_completed",
		);
	});
});

// Drives a single swiss round: generate + start in both divisions, then
// report every non-bye match with slot_a as the winner. Used to set up
// the championship-transition audit assertions; mirrors flow.test.ts.
async function driveSwissOneRound(t: TestTournament): Promise<void> {
	await expectOk(
		await request.post({
			path: `/v1/tournaments/${t.tournamentId}/start-swiss`,
			as: t.admin,
		}),
	);
	for (const division of ["A", "B"] as const) {
		const roundRes = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/rounds`,
			as: t.admin,
			body: { division },
		});
		const { round_id } = await expectOk<{ round_id: string }>(roundRes);
		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/rounds/${round_id}/start`,
				as: t.admin,
			}),
		);
	}
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
}

// Drives the championship from "semifinals generated" through to
// "final reported". Caller is responsible for the surrounding
// transition-championship call and the terminal /complete call.
async function driveChampionshipToFinal(t: TestTournament): Promise<void> {
	// Semifinal round was auto-generated by transition-championship.
	const champRounds = (await t.rounds()).filter((r) => r.phase === "championship");
	expect(champRounds).toHaveLength(1);
	await expectOk(
		await request.post({
			path: `/v1/tournaments/${t.tournamentId}/rounds/${champRounds[0].round_id}/start`,
			as: t.admin,
		}),
	);
	const semis = (await t.matches()).filter(
		(m) => m.round_id === champRounds[0].round_id,
	);
	for (const m of semis) {
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
				as: t.admin,
				body: { winner_slot_id: m.slot_a_id, status: "reported" },
			}),
		);
	}

	// Final round (championship follow-up — no division/round body).
	const finalRoundRes = await request.post({
		path: `/v1/tournaments/${t.tournamentId}/rounds`,
		as: t.admin,
	});
	const { round_id: finalRoundId } = await expectOk<{ round_id: string }>(
		finalRoundRes,
	);
	await expectOk(
		await request.post({
			path: `/v1/tournaments/${t.tournamentId}/rounds/${finalRoundId}/start`,
			as: t.admin,
		}),
	);
	const finals = (await t.matches()).filter((m) => m.round_id === finalRoundId);
	expect(finals).toHaveLength(1);
	await expectOk(
		await request.patch({
			path: `/v1/tournaments/${t.tournamentId}/matches/${finals[0].match_id}`,
			as: t.admin,
			body: { winner_slot_id: finals[0].slot_a_id, status: "reported" },
		}),
	);
}
