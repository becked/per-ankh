// Behavior tests for the caster self-service endpoints:
//   POST   /v1/tournaments/:id/matches/:match_id/parts/:part_id/casters/me
//   DELETE /v1/tournaments/:id/matches/:match_id/parts/:part_id/casters/me
//
// Any logged-in user may add/move/remove THEMSELVES on a scheduled part's
// caster list (index 0 = streamer, the rest co-casters), scoped so they only
// ever touch their own entry — never the whole list like the admin schedule
// endpoint. Casting is pending-only; self-removal also works on decided
// matches. Both respond 204 (no body) — state is asserted from the row.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

const WHEN = "2026-07-05T18:00:00.000Z";

type T = Awaited<ReturnType<typeof makeTournament>>;

async function castersOf(
	t: T,
	matchId: string,
	partId: string,
): Promise<{ user_id: string | null; name: string | null }[]> {
	const m = (await t.matches()).find((row) => row.match_id === matchId);
	const parts = JSON.parse((m?.parts as string) ?? "[]") as {
		id: string;
		casters: { user_id: string | null; name: string | null }[];
	}[];
	return parts.find((p) => p.id === partId)?.casters ?? [];
}

// Create a scheduled part on the first pending match (admin), returning ids.
async function setup() {
	const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
	const m = (await t.matches()).find((row) => row.status === "pending")!;
	const scheduled = await expectOk<{ match: { parts: { id: string }[] } }>(
		await request.patch({
			path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
			as: t.admin,
			body: { parts: [{ scheduled_at: WHEN, casters: [], streams: [] }] },
		}),
	);
	return { t, match: m, partId: scheduled.match.parts[0].id };
}

function castPath(tid: string, mid: string, pid: string) {
	return `/v1/tournaments/${tid}/matches/${mid}/parts/${pid}/casters/me`;
}

describe("caster self-service", () => {
	it("first caster becomes the streamer; second becomes a co-caster", async () => {
		const { t, match, partId } = await setup();
		const alice = await makeUser({ discordUsername: "alice_caster" });
		const bob = await makeUser({ discordUsername: "bob_caster" });

		const r1 = await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
			body: {},
		});
		expect(r1.status).toBe(204);
		expect(await castersOf(t, match.match_id, partId)).toEqual([
			{ user_id: alice.userId, name: "alice_caster" },
		]);

		const r2 = await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: bob,
			body: {},
		});
		expect(r2.status).toBe(204);
		expect(
			(await castersOf(t, match.match_id, partId)).map((c) => c.user_id),
		).toEqual([
			alice.userId, // streamer stays first
			bob.userId, // appended as co-caster
		]);
	});

	it("a co-caster can promote themselves to streamer, bumping the current one", async () => {
		const { t, match, partId } = await setup();
		const alice = await makeUser({ discordUsername: "alice_caster" });
		const bob = await makeUser({ discordUsername: "bob_caster" });
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
			body: {},
		});
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: bob,
			body: {},
		});

		const res = await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: bob,
			body: { role: "streamer" },
		});
		expect(res.status).toBe(204);
		// Bob to the front; alice (former streamer) demoted; no duplicates.
		expect(
			(await castersOf(t, match.match_id, partId)).map((c) => c.user_id),
		).toEqual([bob.userId, alice.userId]);
	});

	it("dropping removes only the caller, leaving others", async () => {
		const { t, match, partId } = await setup();
		const alice = await makeUser({ discordUsername: "alice_caster" });
		const bob = await makeUser({ discordUsername: "bob_caster" });
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
			body: {},
		});
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: bob,
			body: {},
		});

		const res = await request.delete({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: bob,
		});
		expect(res.status).toBe(204);
		expect(
			(await castersOf(t, match.match_id, partId)).map((c) => c.user_id),
		).toEqual([alice.userId]);
	});

	it("returns 401 to an anonymous caller", async () => {
		const { t, match, partId } = await setup();
		await expectErrorCode(
			await request.post({
				path: castPath(t.tournamentId, match.match_id, partId),
				body: {},
			}),
			{ status: 401, code: "UNAUTHORIZED" },
		);
	});

	it("returns 404 for an unknown part", async () => {
		const { t, match } = await setup();
		const alice = await makeUser();
		await expectErrorCode(
			await request.post({
				path: castPath(t.tournamentId, match.match_id, "nope"),
				as: alice,
				body: {},
			}),
			{ status: 404, code: "PART_NOT_FOUND" },
		);
	});

	it("rejects CASTING a decided match but allows self-REMOVAL", async () => {
		const { t, match, partId } = await setup();
		const alice = await makeUser({ discordUsername: "alice_caster" });
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
			body: {},
		});
		// Decide the match (admin retro-edit).
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${match.match_id}`,
				as: t.admin,
				body: { winner_slot_id: match.slot_a_id, status: "complete" },
			}),
		);
		// New casting is closed…
		await expectErrorCode(
			await request.post({
				path: castPath(t.tournamentId, match.match_id, partId),
				as: alice,
				body: {},
			}),
			{ status: 409, code: "MATCH_NOT_PENDING" },
		);
		// …but removing YOURSELF still works — a caster who signed up and never
		// actually cast shouldn't stay credited on the archive.
		const res = await request.delete({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
		});
		expect(res.status).toBe(204);
		expect(await castersOf(t, match.match_id, partId)).toEqual([]);
	});
});
