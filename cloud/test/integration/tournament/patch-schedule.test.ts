// Behavior tests for PATCH /v1/tournaments/:id/matches/:match_id/schedule.
//
// Unlike the other match mutations, this endpoint is open to a tournament
// admin OR either participant in the match (authedMatchScheduler). It sets
// scheduling metadata (scheduled time, stream link, caster) on pending
// matches only. Caster is modeled like a slot occupant: a linked Per-Ankh
// user pre-links (server snapshots the canonical username) or free text.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import {
	makeTournament,
	makeUser,
	type TestTournament,
	type TestUser,
} from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

const WHEN = "2026-06-15T14:30:00.000Z";
const STREAM = "https://twitch.tv/perankh";

async function firstPendingMatchOf(t: TestTournament) {
	const m = (await t.matches()).find((row) => row.status === "pending");
	if (!m) throw new Error("expected a pending match in fixture tournament");
	return m;
}

// The round-1 match that the given owner is playing in (slot_a or slot_b).
async function matchForOwner(t: TestTournament, owner: TestUser) {
	const slotId = t.slotsByDivision.A.find(
		(s) => s.owner?.userId === owner.userId,
	)?.slotId;
	if (!slotId) throw new Error("owner has no slot in division A");
	const m = (await t.matches()).find(
		(row) =>
			row.status === "pending" &&
			(row.slot_a_id === slotId || row.slot_b_id === slotId),
	);
	if (!m) throw new Error("owner has no pending match");
	return m;
}

describe("PATCH /v1/tournaments/:id/matches/:match_id/schedule", () => {
	describe("happy path", () => {
		it("an admin sets time, stream, and a free-text caster", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				as: t.admin,
				body: {
					scheduled_at: WHEN,
					stream_url: STREAM,
					caster_user_id: null,
					caster_name: "CasterBob",
				},
			});

			const body = await expectOk<{
				match: {
					scheduled_at: string;
					stream_url: string;
					caster_user_id: string | null;
					caster_name: string | null;
				};
			}>(res);
			expect(body.match.scheduled_at).toBe(WHEN);
			expect(body.match.stream_url).toBe(STREAM);
			expect(body.match.caster_user_id).toBeNull();
			expect(body.match.caster_name).toBe("CasterBob");
		});

		it("a participant can schedule their own match", async () => {
			const player = await makeUser();
			const t = await makeTournament({
				advanceTo: "swiss-round-1-generated",
				slotOwners: { A: [player] },
			});
			const m = await matchForOwner(t, player);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				as: player,
				body: { scheduled_at: WHEN },
			});

			const body = await expectOk<{ match: { scheduled_at: string } }>(res);
			expect(body.match.scheduled_at).toBe(WHEN);
		});

		it("links a caster by user_id and snapshots the canonical username", async () => {
			const caster = await makeUser({ discordUsername: "official_caster" });
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				as: t.admin,
				// Client-sent name is deliberately wrong — the server must overwrite
				// it with the linked user's canonical handle.
				body: { caster_user_id: caster.userId, caster_name: "ignored" },
			});

			const body = await expectOk<{
				match: { caster_user_id: string | null; caster_name: string | null };
			}>(res);
			expect(body.match.caster_user_id).toBe(caster.userId);
			expect(body.match.caster_name).toBe("official_caster");
		});

		it("clears scheduling fields when sent null", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			await expectOk(
				await request.patch({
					path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
					as: t.admin,
					body: { scheduled_at: WHEN, stream_url: STREAM, caster_name: "Bob" },
				}),
			);
			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				as: t.admin,
				body: { scheduled_at: null, stream_url: null, caster_name: null },
			});

			const body = await expectOk<{
				match: {
					scheduled_at: string | null;
					stream_url: string | null;
					caster_name: string | null;
				};
			}>(res);
			expect(body.match.scheduled_at).toBeNull();
			expect(body.match.stream_url).toBeNull();
			expect(body.match.caster_name).toBeNull();
		});
	});

	describe("validation", () => {
		it("rejects a non-youtube/twitch stream host", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				as: t.admin,
				body: { stream_url: "https://example.com/watch" },
			});
			await expectErrorCode(res, { status: 400, code: "INVALID_BODY" });
		});

		it("rejects a caster_user_id that doesn't exist", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				as: t.admin,
				body: { caster_user_id: "aaaaaaaaaaaaaaaaaaaaa" },
			});
			await expectErrorCode(res, { status: 400, code: "INVALID_USER_ID" });
		});

		it("rejects scheduling a non-pending match", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-complete" });
			const reported = (await t.matches()).find(
				(mm) => mm.status === "complete",
			);
			expect(reported).toBeDefined();
			if (!reported) return;

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${reported.match_id}/schedule`,
				as: t.admin,
				body: { scheduled_at: WHEN },
			});
			await expectErrorCode(res, { status: 409, code: "MATCH_NOT_PENDING" });
		});
	});

	describe("authentication & authorization", () => {
		it("returns 401 to an unauthenticated request", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				body: { scheduled_at: WHEN },
			});
			await expectErrorCode(res, { status: 401, code: "UNAUTHORIZED" });
		});

		it("returns 403 to a beta user who is neither admin nor participant", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const outsider = await makeUser(); // beta-seeded, but unrelated to t
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				as: outsider,
				body: { scheduled_at: WHEN },
			});
			await expectErrorCode(res, {
				status: 403,
				code: "NOT_MATCH_PARTICIPANT",
			});
		});

		it("returns 404 when the match belongs to a different tournament", async () => {
			const a = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const b = await makeTournament({
				advanceTo: "swiss-round-1-generated",
				admin: a.admin,
			});
			const bMatch = await firstPendingMatchOf(b);

			const res = await request.patch({
				path: `/v1/tournaments/${a.tournamentId}/matches/${bMatch.match_id}/schedule`,
				as: a.admin,
				body: { scheduled_at: WHEN },
			});
			await expectErrorCode(res, { status: 404, code: "MATCH_NOT_FOUND" });
		});
	});
});
