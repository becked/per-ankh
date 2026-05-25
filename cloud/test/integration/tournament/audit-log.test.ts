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

// System-triggered events (auto-advance round generation, auto-complete)
// land in events with event_type='tournament_system' and user_id=NULL.
// Filtered by tournament_id since there's no per-user attribution.
async function systemEventsForTournament(
	tournamentId: string,
): Promise<AdminEventRow[]> {
	const res = await env.SHARE_DB.prepare(
		`SELECT event_type, user_id, metadata FROM events
		 WHERE event_type = 'tournament_system'
		 ORDER BY id ASC`,
	).all<AdminEventRow>();
	return (res.results ?? []).filter((row) => {
		if (!row.metadata) return false;
		const meta = JSON.parse(row.metadata) as { tournament_id?: string };
		return meta.tournament_id === tournamentId;
	});
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

	it("POST /tournaments/:id/start emits tournament_started", async () => {
		const t = await makeTournament();
		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/start`,
			as: t.admin,
		});
		await expectOk(res);
		expect(actionsFor(await adminEventsForUser(t.admin.userId))).toContain(
			"tournament_started",
		);
	});

	it("auto-generated next round emits a tournament_system round_generated event", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-complete" });
		// Builder reported every Round 1 match; auto-advance generated R2
		// in both divisions. Two system events expected (one per division).
		const actions = actionsFor(await systemEventsForTournament(t.tournamentId));
		const generated = actions.filter((a) => a === "round_generated");
		expect(generated).toHaveLength(2);
	});

	it("PATCH /tournaments/:id/matches/:match_id/map emits match_map_patched", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
			allowedMaps: ["MAP_SEASIDE", "MAP_RIVER", "MAP_CONTINENTS"],
		});
		const matches = await t.matches();
		const target = matches.find((m) => m.status === "pending");
		expect(target).toBeDefined();
		// Builder assigns ids map-0/1/2 to the maps in order; pick a different
		// instance from the one currently assigned.
		const newPoolId = target!.map_pool_id === "map-2" ? "map-1" : "map-2";
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}/matches/${target!.match_id}/map`,
			as: t.admin,
			body: { map_pool_id: newPoolId },
		});
		await expectOk(res);
		expect(actionsFor(await adminEventsForUser(t.admin.userId))).toContain(
			"match_map_patched",
		);
	});

	it("PATCH /tournaments/:id/matches/:match_id (retro edit) emits match_retro_edited", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-complete" });
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

	it("auto-completing the tournament on the championship final emits a tournament_system tournament_completed event", async () => {
		// Drive a 4-slot swiss → transition → championship semis → final.
		// Final report fires auto-advance, which auto-completes the
		// tournament — no admin /complete call exists.
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

		expect(
			actionsFor(await systemEventsForTournament(t.tournamentId)),
		).toContain("tournament_completed");
	});
});

// Drives a single swiss round: /start + report every non-bye match with
// slot_a as the winner. swiss_max_rounds=1 keeps auto-advance from
// generating a Round 2.
async function driveSwissOneRound(t: TestTournament): Promise<void> {
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
				body: { winner_slot_id: m.slot_a_id, status: "complete" },
			}),
		);
	}
}

// Drives the championship from "semifinals generated" through to
// "final reported". Caller transitioned to championship already; the
// final auto-spawns when the semis report and auto-completes when the
// final reports.
async function driveChampionshipToFinal(t: TestTournament): Promise<void> {
	const champR1 = (await t.rounds()).find(
		(r) => r.phase === "championship" && r.round_number === 1,
	)!;
	for (const m of (await t.matches()).filter(
		(m) => m.round_id === champR1.round_id,
	)) {
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
				as: t.admin,
				body: { winner_slot_id: m.slot_a_id, status: "complete" },
			}),
		);
	}
	const champR2 = (await t.rounds()).find(
		(r) => r.phase === "championship" && r.round_number === 2,
	)!;
	const finals = (await t.matches()).filter(
		(m) => m.round_id === champR2.round_id,
	);
	expect(finals).toHaveLength(1);
	await expectOk(
		await request.patch({
			path: `/v1/tournaments/${t.tournamentId}/matches/${finals[0].match_id}`,
			as: t.admin,
			body: { winner_slot_id: finals[0].slot_a_id, status: "complete" },
		}),
	);
}
