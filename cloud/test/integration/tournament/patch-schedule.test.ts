// Behavior tests for PATCH /v1/tournaments/:id/matches/:match_id/schedule.
//
// Unlike the other match mutations, this endpoint is open to a tournament
// admin OR either participant in the match (authedMatchScheduler). It replaces
// the match's scheduled "parts" (migration 0029) — each part carries its own
// time, caster, and stream links — on pending matches only. Caster is modeled like
// a slot occupant: a linked Per-Ankh user pre-links (server snapshots the
// canonical username) or free text. Replace-all over the parts list.

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
const LATER = "2026-06-17T18:00:00.000Z";
const STREAM = "https://twitch.tv/perankh";
const POV = "https://youtube.com/watch?v=abc";

interface CasterPayload {
	user_id: string | null;
	name: string | null;
}
interface PartPayload {
	id?: string;
	scheduled_at: string | null;
	casters: CasterPayload[];
	streams: { url: string; label?: string | null }[];
}
interface CasterResponse {
	user_id: string | null;
	name: string | null;
	display_name: string | null;
}
interface PartResponse {
	id: string;
	scheduled_at: string | null;
	casters: CasterResponse[];
	streams: { url: string; label: string | null }[];
}

function part(overrides: Partial<PartPayload> = {}): PartPayload {
	return {
		scheduled_at: null,
		casters: [],
		streams: [],
		...overrides,
	};
}

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
		it("an admin sets a part's time, streams, and a free-text caster", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				as: t.admin,
				body: {
					parts: [
						part({
							scheduled_at: WHEN,
							casters: [{ user_id: null, name: "CasterBob" }],
							streams: [{ url: STREAM, label: "Cast" }],
						}),
					],
				},
			});

			const body = await expectOk<{ match: { parts: PartResponse[] } }>(res);
			expect(body.match.parts).toHaveLength(1);
			const p = body.match.parts[0];
			expect(p.id).toBeTruthy();
			expect(p.scheduled_at).toBe(WHEN);
			expect(p.casters).toHaveLength(1);
			expect(p.casters[0].user_id).toBeNull();
			expect(p.casters[0].name).toBe("CasterBob");
			expect(p.streams).toEqual([{ url: STREAM, label: "Cast" }]);
		});

		it("supports a streamer plus co-casters, streamer first", async () => {
			const streamer = await makeUser({ discordUsername: "streamer_sam" });
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				as: t.admin,
				body: {
					parts: [
						part({
							scheduled_at: WHEN,
							casters: [
								{ user_id: streamer.userId, name: "ignored" },
								{ user_id: null, name: "Coco" },
							],
						}),
					],
				},
			});

			const body = await expectOk<{ match: { parts: PartResponse[] } }>(res);
			const casters = body.match.parts[0].casters;
			expect(casters).toHaveLength(2);
			// Streamer first, canonical handle snapshotted; co-caster free text.
			expect(casters[0].user_id).toBe(streamer.userId);
			expect(casters[0].name).toBe("streamer_sam");
			expect(casters[1].user_id).toBeNull();
			expect(casters[1].name).toBe("Coco");
		});

		it("supports several parts, each scheduled separately, with multiple streams", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				as: t.admin,
				body: {
					parts: [
						part({
							scheduled_at: WHEN,
							streams: [
								{ url: POV, label: "P1 POV" },
								{ url: STREAM, label: "Cast" },
							],
						}),
						part({ scheduled_at: LATER }),
					],
				},
			});

			const body = await expectOk<{ match: { parts: PartResponse[] } }>(res);
			expect(body.match.parts).toHaveLength(2);
			expect(body.match.parts[0].scheduled_at).toBe(WHEN);
			expect(body.match.parts[0].streams).toHaveLength(2);
			expect(body.match.parts[1].scheduled_at).toBe(LATER);
			// Distinct minted ids so later edits can target each part.
			expect(body.match.parts[0].id).not.toBe(body.match.parts[1].id);
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
				body: { parts: [part({ scheduled_at: WHEN })] },
			});

			const body = await expectOk<{ match: { parts: PartResponse[] } }>(res);
			expect(body.match.parts[0].scheduled_at).toBe(WHEN);
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
				body: {
					parts: [
						part({ casters: [{ user_id: caster.userId, name: "ignored" }] }),
					],
				},
			});

			const body = await expectOk<{ match: { parts: PartResponse[] } }>(res);
			expect(body.match.parts[0].casters[0].user_id).toBe(caster.userId);
			expect(body.match.parts[0].casters[0].name).toBe("official_caster");
		});

		it("public match payloads label a linked caster by display name, a free-text caster as typed", async () => {
			const caster = await makeUser({
				discordUsername: "caster_handle",
				displayName: "The Caster",
			});
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			// Linked caster: name stores the canonical handle, but the rendered
			// label is the linked user's display name.
			await expectOk(
				await request.patch({
					path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
					as: t.admin,
					body: {
						parts: [
							part({ casters: [{ user_id: caster.userId, name: "ignored" }] }),
						],
					},
				}),
			);
			const linked = await expectOk<{ parts: PartResponse[] }>(
				await request.get({
					path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
					as: t.admin,
				}),
			);
			expect(linked.parts[0].casters[0].name).toBe("caster_handle");
			expect(linked.parts[0].casters[0].display_name).toBe("The Caster");

			// Free-text caster: the typed name is both stored value and label.
			await expectOk(
				await request.patch({
					path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
					as: t.admin,
					body: {
						parts: [
							part({ casters: [{ user_id: null, name: "Freetext Fred" }] }),
						],
					},
				}),
			);
			const freetext = await expectOk<{ parts: PartResponse[] }>(
				await request.get({
					path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
					as: t.admin,
				}),
			);
			expect(freetext.parts[0].casters[0].display_name).toBe("Freetext Fred");
		});

		it("clears all parts when sent an empty list", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			await expectOk(
				await request.patch({
					path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
					as: t.admin,
					body: {
						parts: [
							part({
								scheduled_at: WHEN,
								casters: [{ user_id: null, name: "Bob" }],
							}),
						],
					},
				}),
			);
			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				as: t.admin,
				body: { parts: [] },
			});

			const body = await expectOk<{ match: { parts: PartResponse[] } }>(res);
			expect(body.match.parts).toEqual([]);
		});

		it("attaches streams to a COMPLETED match (post-game)", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-complete" });
			const reported = (await t.matches()).find(
				(mm) => mm.status === "complete",
			);
			expect(reported).toBeDefined();
			if (!reported) return;

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${reported.match_id}/schedule`,
				as: t.admin,
				body: {
					parts: [
						part({
							scheduled_at: WHEN,
							streams: [{ url: POV, label: "P1 POV" }],
						}),
					],
				},
			});

			const body = await expectOk<{ match: { parts: PartResponse[] } }>(res);
			expect(body.match.parts[0].streams).toEqual([
				{ url: POV, label: "P1 POV" },
			]);
		});

		it("rejects a PARTICIPANT editing a decided match (admin-only archive)", async () => {
			// A losing player must not be able to wipe the streams/caster credits
			// attached to a match after it was played.
			const player = await makeUser();
			const t = await makeTournament({
				advanceTo: "swiss-round-1-complete",
				slotOwners: { A: [player] },
			});
			const reported = (await t.matches()).find(
				(mm) =>
					mm.status === "complete" &&
					(mm.slot_a_user_id === player.userId ||
						mm.slot_b_user_id === player.userId),
			);
			expect(reported).toBeDefined();
			if (!reported) return;

			await expectErrorCode(
				await request.patch({
					path: `/v1/tournaments/${t.tournamentId}/matches/${reported.match_id}/schedule`,
					as: player,
					body: { parts: [] },
				}),
				{ status: 403, code: "NOT_TOURNAMENT_ADMIN" },
			);
		});

		it("409s a stale expected_rev instead of erasing a concurrent write", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			// First writer bumps parts_rev 0 → 1.
			await expectOk(
				await request.patch({
					path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
					as: t.admin,
					body: { parts: [part({ scheduled_at: WHEN })], expected_rev: 0 },
				}),
			);
			// Second writer still holds rev 0 — conflict, nothing overwritten.
			await expectErrorCode(
				await request.patch({
					path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
					as: t.admin,
					body: { parts: [], expected_rev: 0 },
				}),
				{ status: 409, code: "CONFLICT" },
			);
			const after = (await t.matches()).find(
				(mm) => mm.match_id === m.match_id,
			);
			// Raw row: parts is the JSON string column.
			expect(JSON.parse(after?.parts ?? "[]")).toHaveLength(1);
		});
	});

	describe("validation", () => {
		it("rejects a non-youtube/twitch stream host", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				as: t.admin,
				body: {
					parts: [part({ streams: [{ url: "https://example.com/watch" }] })],
				},
			});
			await expectErrorCode(res, { status: 400, code: "INVALID_BODY" });
		});

		it("rejects a caster_user_id that doesn't exist", async () => {
			const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
			const m = await firstPendingMatchOf(t);

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
				as: t.admin,
				body: {
					parts: [
						part({
							casters: [{ user_id: "aaaaaaaaaaaaaaaaaaaaa", name: null }],
						}),
					],
				},
			});
			await expectErrorCode(res, { status: 400, code: "INVALID_USER_ID" });
		});

		it("rejects scheduling a bye match", async () => {
			// Odd division size → round 1 leaves one player on a bye.
			const t = await makeTournament({
				advanceTo: "swiss-round-1-generated",
				slotsPerDivision: 3,
			});
			const bye = (await t.matches()).find((mm) => mm.status === "bye");
			expect(bye).toBeDefined();
			if (!bye) return;

			const res = await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${bye.match_id}/schedule`,
				as: t.admin,
				body: { parts: [part({ scheduled_at: WHEN })] },
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
				body: { parts: [part({ scheduled_at: WHEN })] },
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
				body: { parts: [part({ scheduled_at: WHEN })] },
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
				body: { parts: [part({ scheduled_at: WHEN })] },
			});
			await expectErrorCode(res, { status: 404, code: "MATCH_NOT_FOUND" });
		});
	});
});
