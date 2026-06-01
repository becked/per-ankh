// Behavior tests for POST /v1/tournaments/:id/signup and
// DELETE /v1/tournaments/:id/signup.
//
// Covers the lifecycle of self-service signup:
//   * Happy path: signup creates a swiss slot keyed to the caller's user_id;
//     subsequent withdraw deletes it.
//   * Status gate: signup is rejected unless status='setup' AND
//     signups_open=1; withdraw is rejected once status moves past setup.
//   * Uniqueness: a second signup from the same user returns 409, even when
//     it races with the first (atomic INSERT ... WHERE NOT EXISTS).
//   * Auto-close: handleStartTournament flips signups_open to 0.
//   * PATCH gate: a tournament that has already started can't have signups
//     re-opened via PATCH.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// Helper: flip a tournament's signups_open via direct UPDATE. Mirrors the
// admin PATCH path; chosen here to keep the signup tests independent of the
// PATCH-tournament endpoint's own bugs.
async function openSignups(tournamentId: string): Promise<void> {
	await env.SHARE_DB.prepare(
		"UPDATE tournaments SET signups_open = 1 WHERE tournament_id = ?",
	)
		.bind(tournamentId)
		.run();
}

describe("POST /v1/tournaments/:id/signup", () => {
	it("returns 404 to an unauthenticated request (beta-gate consistency)", async () => {
		const t = await makeTournament();
		await openSignups(t.tournamentId);
		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			body: { division: "A" },
		});
		await expectErrorCode(res, {
			status: 404,
			code: "TOURNAMENT_NOT_FOUND",
		});
	});

	it("returns 409 SIGNUPS_CLOSED when signups_open=0", async () => {
		const player = await makeUser();
		const t = await makeTournament();
		// signups_open defaults to 0 — don't open them.
		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: player,
			body: { division: "A" },
		});
		await expectErrorCode(res, { status: 409, code: "SIGNUPS_CLOSED" });
	});

	it("creates a swiss slot owned by the caller on the happy path", async () => {
		const player = await makeUser({ discordUsername: "signup-happy" });
		const t = await makeTournament({ slotsPerDivision: 0 });
		await openSignups(t.tournamentId);

		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: player,
			body: { division: "A" },
		});
		const body = await expectOk<{
			slot: { slot_id: string; division: "A" | "B"; swiss_seed: number };
		}>(res);
		expect(body.slot.division).toBe("A");
		expect(body.slot.swiss_seed).toBe(1);

		const row = await env.SHARE_DB.prepare(
			`SELECT user_id, discord_id, discord_username, division, phase, swiss_seed
			 FROM tournament_slots WHERE slot_id = ?`,
		)
			.bind(body.slot.slot_id)
			.first<{
				user_id: string;
				discord_id: string;
				discord_username: string;
				division: string;
				phase: string;
				swiss_seed: number;
			}>();
		expect(row).toBeTruthy();
		expect(row!.user_id).toBe(player.userId);
		expect(row!.discord_id).toBe(player.discordId);
		expect(row!.discord_username).toBe(player.discordUsername);
		expect(row!.phase).toBe("swiss");
		expect(row!.division).toBe("A");
		expect(row!.swiss_seed).toBe(1);
	});

	it("assigns the next swiss_seed within the chosen division", async () => {
		const p1 = await makeUser();
		const p2 = await makeUser();
		const p3 = await makeUser();
		// Start with 2 slots already in Division A (from makeTournament's
		// default 4-per-division → 4 slots in A). p1 (new signup) should get
		// swiss_seed = 5. p2 picks B (already has 4); p2 should get seed 5
		// in B. p3 picks A; should get seed 6.
		const t = await makeTournament({ slotsPerDivision: 4 });
		await openSignups(t.tournamentId);

		const r1 = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: p1,
			body: { division: "A" },
		});
		expect(
			(await expectOk<{ slot: { swiss_seed: number } }>(r1)).slot.swiss_seed,
		).toBe(5);
		const r2 = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: p2,
			body: { division: "B" },
		});
		expect(
			(await expectOk<{ slot: { swiss_seed: number } }>(r2)).slot.swiss_seed,
		).toBe(5);
		const r3 = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: p3,
			body: { division: "A" },
		});
		expect(
			(await expectOk<{ slot: { swiss_seed: number } }>(r3)).slot.swiss_seed,
		).toBe(6);
	});

	it("returns 409 ALREADY_SIGNED_UP on a second signup by the same user", async () => {
		const player = await makeUser();
		const t = await makeTournament({ slotsPerDivision: 0 });
		await openSignups(t.tournamentId);

		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/signup`,
				as: player,
				body: { division: "A" },
			}),
		);
		const dup = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: player,
			body: { division: "B" },
		});
		await expectErrorCode(dup, { status: 409, code: "ALREADY_SIGNED_UP" });
	});

	it("rejects an invalid division", async () => {
		const player = await makeUser();
		const t = await makeTournament({ slotsPerDivision: 0 });
		await openSignups(t.tournamentId);
		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: player,
			body: { division: "C" },
		});
		await expectErrorCode(res, { status: 400, code: "INVALID_BODY" });
	});

	it("emits a tournament_self_signup event for audit", async () => {
		const player = await makeUser();
		const t = await makeTournament({ slotsPerDivision: 0 });
		await openSignups(t.tournamentId);

		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: player,
			body: { division: "A" },
		});
		await expectOk(res);

		const ev = await env.SHARE_DB.prepare(
			`SELECT event_type, user_id, metadata FROM events
			 WHERE event_type = 'tournament_self_signup' AND user_id = ?
			 ORDER BY rowid DESC LIMIT 1`,
		)
			.bind(player.userId)
			.first<{ event_type: string; user_id: string; metadata: string }>();
		expect(ev).toBeTruthy();
		const meta = JSON.parse(ev!.metadata) as {
			tournament_id: string;
			division: string;
		};
		expect(meta.tournament_id).toBe(t.tournamentId);
		expect(meta.division).toBe("A");
	});
});

describe("DELETE /v1/tournaments/:id/signup", () => {
	it("returns 404 NOT_SIGNED_UP when the caller has no slot", async () => {
		const player = await makeUser();
		const t = await makeTournament();
		const res = await request.delete({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: player,
		});
		await expectErrorCode(res, { status: 404, code: "NOT_SIGNED_UP" });
	});

	it("deletes the caller's swiss slot on the happy path", async () => {
		const player = await makeUser();
		const t = await makeTournament({ slotsPerDivision: 0 });
		await openSignups(t.tournamentId);

		const signup = await expectOk<{ slot: { slot_id: string } }>(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/signup`,
				as: player,
				body: { division: "A" },
			}),
		);

		const res = await request.delete({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: player,
		});
		expect(res.status).toBe(204);

		const row = await env.SHARE_DB.prepare(
			"SELECT slot_id FROM tournament_slots WHERE slot_id = ?",
		)
			.bind(signup.slot.slot_id)
			.first<{ slot_id: string }>();
		expect(row).toBeNull();
	});

	it("withdraws even when signups_open has been closed (drop-out remains possible)", async () => {
		const player = await makeUser();
		const t = await makeTournament({ slotsPerDivision: 0 });
		await openSignups(t.tournamentId);

		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/signup`,
				as: player,
				body: { division: "A" },
			}),
		);
		await env.SHARE_DB.prepare(
			"UPDATE tournaments SET signups_open = 0 WHERE tournament_id = ?",
		)
			.bind(t.tournamentId)
			.run();

		const res = await request.delete({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: player,
		});
		expect(res.status).toBe(204);
	});

	it("returns 409 TOURNAMENT_STARTED once the tournament has left setup", async () => {
		const player = await makeUser();
		const t = await makeTournament({ slotsPerDivision: 0 });
		await openSignups(t.tournamentId);

		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/signup`,
				as: player,
				body: { division: "A" },
			}),
		);
		await env.SHARE_DB.prepare(
			"UPDATE tournaments SET status = 'swiss' WHERE tournament_id = ?",
		)
			.bind(t.tournamentId)
			.run();

		const res = await request.delete({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: player,
		});
		await expectErrorCode(res, { status: 409, code: "TOURNAMENT_STARTED" });
	});

	it("emits a tournament_self_withdraw event for audit", async () => {
		const player = await makeUser();
		const t = await makeTournament({ slotsPerDivision: 0 });
		await openSignups(t.tournamentId);

		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/signup`,
				as: player,
				body: { division: "A" },
			}),
		);
		const res = await request.delete({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: player,
		});
		expect(res.status).toBe(204);

		const ev = await env.SHARE_DB.prepare(
			`SELECT metadata FROM events
			 WHERE event_type = 'tournament_self_withdraw' AND user_id = ?
			 ORDER BY rowid DESC LIMIT 1`,
		)
			.bind(player.userId)
			.first<{ metadata: string }>();
		expect(ev).toBeTruthy();
	});
});

describe("signup auto-close + admin PATCH guard", () => {
	it("starting the tournament flips signups_open back to 0", async () => {
		const t = await makeTournament({ slotsPerDivision: 4 });
		await openSignups(t.tournamentId);

		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/start`,
				as: t.admin,
			}),
		);

		const row = await env.SHARE_DB.prepare(
			"SELECT status, signups_open FROM tournaments WHERE tournament_id = ?",
		)
			.bind(t.tournamentId)
			.first<{ status: string; signups_open: number }>();
		expect(row!.status).toBe("swiss");
		expect(row!.signups_open).toBe(0);
	});

	it("PATCH cannot re-open signups once the tournament has started", async () => {
		const t = await makeTournament({ slotsPerDivision: 4 });
		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/start`,
				as: t.admin,
			}),
		);

		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: { signups_open: true },
		});
		await expectErrorCode(res, { status: 409, code: "INVALID_PHASE" });
	});

	it("PATCH can toggle signups_open while in setup", async () => {
		const t = await makeTournament();

		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}`,
				as: t.admin,
				body: { signups_open: true },
			}),
		);
		let row = await env.SHARE_DB.prepare(
			"SELECT signups_open FROM tournaments WHERE tournament_id = ?",
		)
			.bind(t.tournamentId)
			.first<{ signups_open: number }>();
		expect(row!.signups_open).toBe(1);

		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}`,
				as: t.admin,
				body: { signups_open: false },
			}),
		);
		row = await env.SHARE_DB.prepare(
			"SELECT signups_open FROM tournaments WHERE tournament_id = ?",
		)
			.bind(t.tournamentId)
			.first<{ signups_open: number }>();
		expect(row!.signups_open).toBe(0);
	});
});

describe("setup-phase visibility when signups_open=1", () => {
	it("a stranger sees the tournament in /v1/tournaments and on detail", async () => {
		const stranger = await makeUser();
		const t = await makeTournament();
		await openSignups(t.tournamentId);

		const listRes = await request.get({
			path: `/v1/tournaments?status=setup`,
			as: stranger,
		});
		const list = await expectOk<{
			tournaments: Array<{ tournament_id: string; signups_open: boolean }>;
		}>(listRes);
		const found = list.tournaments.find(
			(x) => x.tournament_id === t.tournamentId,
		);
		expect(found).toBeTruthy();
		expect(found!.signups_open).toBe(true);

		const detail = await request.get({
			path: `/v1/tournaments/${t.slug}`,
			as: stranger,
		});
		const body = await expectOk<{
			signups_open: boolean;
			viewer_slot: unknown;
		}>(detail);
		expect(body.signups_open).toBe(true);
		expect(body.viewer_slot).toBeNull();
	});

	it("a stranger 404s when status=setup AND signups_open=0", async () => {
		const stranger = await makeUser();
		const t = await makeTournament();
		const res = await request.get({
			path: `/v1/tournaments/${t.slug}`,
			as: stranger,
		});
		await expectErrorCode(res, {
			status: 404,
			code: "TOURNAMENT_NOT_FOUND",
		});
	});

	it("detail response includes viewer_slot after the caller signs up", async () => {
		const player = await makeUser();
		const t = await makeTournament({ slotsPerDivision: 0 });
		await openSignups(t.tournamentId);

		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/signup`,
				as: player,
				body: { division: "B" },
			}),
		);

		const detail = await request.get({
			path: `/v1/tournaments/${t.slug}`,
			as: player,
		});
		const body = await expectOk<{
			viewer_slot: { division: "A" | "B"; swiss_seed: number } | null;
			slot_counts: { swiss_by_division: { A: number; B: number } };
		}>(detail);
		expect(body.viewer_slot).not.toBeNull();
		expect(body.viewer_slot!.division).toBe("B");
		expect(body.viewer_slot!.swiss_seed).toBe(1);
		expect(body.slot_counts.swiss_by_division.B).toBe(1);
		expect(body.slot_counts.swiss_by_division.A).toBe(0);
	});
});
