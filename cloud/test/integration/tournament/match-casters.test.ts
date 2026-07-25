// Behavior tests for tournament_match_casters (migration 0034) — the derived
// index behind the profile's cast list and the Tournaments-tab visibility gate.
//
// The blob (`tournament_matches.parts`) stays the source of truth; this table is
// re-derived from it by syncMatchCasters after each `parts` writer's parts_rev
// CAS lands. There are exactly two such writers — the admin schedule PATCH and
// caster self-service — and every test here asserts the table matches the blob
// afterwards, since a writer that forgets the sync is the failure mode.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

const WHEN = "2026-08-01T18:00:00.000Z";
const LATER = "2026-08-03T18:00:00.000Z";

type T = Awaited<ReturnType<typeof makeTournament>>;

// The table's rows for a match, as "partId|userId" strings.
async function tableRows(matchId: string): Promise<string[]> {
	const res = await env.SHARE_DB.prepare(
		`SELECT part_id, user_id FROM tournament_match_casters
		 WHERE match_id = ? ORDER BY part_id, user_id`,
	)
		.bind(matchId)
		.all<{ part_id: string; user_id: string }>();
	return (res.results ?? []).map((r) => `${r.part_id}|${r.user_id}`);
}

// The same set derived independently from the stored blob — linked casters only.
// Every assertion below compares the table against this, so "consistent with the
// blob" is checked rather than a hand-written expectation of it.
async function blobRows(t: T, matchId: string): Promise<string[]> {
	const m = (await t.matches()).find((row) => row.match_id === matchId);
	const parts = JSON.parse((m?.parts as string) ?? "[]") as {
		id: string;
		casters: { user_id: string | null }[];
	}[];
	const out = new Set<string>();
	for (const p of parts) {
		for (const c of p.casters) {
			if (c.user_id) out.add(`${p.id}|${c.user_id}`);
		}
	}
	return [...out].sort();
}

async function expectConsistent(t: T, matchId: string): Promise<string[]> {
	const rows = await tableRows(matchId);
	expect(rows).toEqual(await blobRows(t, matchId));
	return rows;
}

// A pending match with `partCount` scheduled sittings, via the admin endpoint.
async function setup(partCount = 1) {
	const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
	const m = (await t.matches()).find((row) => row.status === "pending")!;
	const times = [WHEN, LATER].slice(0, partCount);
	const scheduled = await expectOk<{ match: { parts: { id: string }[] } }>(
		await request.patch({
			path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
			as: t.admin,
			body: {
				parts: times.map((scheduled_at) => ({
					scheduled_at,
					casters: [],
					streams: [],
				})),
			},
		}),
	);
	return {
		t,
		matchId: m.match_id,
		partIds: scheduled.match.parts.map((p) => p.id),
	};
}

function castPath(tid: string, mid: string, pid: string) {
	return `/v1/tournaments/${tid}/matches/${mid}/parts/${pid}/casters/me`;
}

describe("tournament_match_casters — self-service caster writes", () => {
	it("indexes a cast sign-up and clears it again on drop", async () => {
		const { t, matchId, partIds } = await setup();
		const caster = await makeUser({ discordUsername: "solo-caster" });

		expect(await expectConsistent(t, matchId)).toEqual([]);

		expect(
			(
				await request.post({
					path: castPath(t.tournamentId, matchId, partIds[0]),
					as: caster,
					body: {},
				})
			).status,
		).toBe(204);
		expect(await expectConsistent(t, matchId)).toEqual([
			`${partIds[0]}|${caster.userId}`,
		]);

		expect(
			(
				await request.delete({
					path: castPath(t.tournamentId, matchId, partIds[0]),
					as: caster,
				})
			).status,
		).toBe(204);
		expect(await expectConsistent(t, matchId)).toEqual([]);
	});

	it("keeps a co-caster alongside the streamer, one row each", async () => {
		const { t, matchId, partIds } = await setup();
		const streamer = await makeUser({ discordUsername: "the-streamer" });
		const coCaster = await makeUser({ discordUsername: "the-co-caster" });

		for (const who of [streamer, coCaster]) {
			await request.post({
				path: castPath(t.tournamentId, matchId, partIds[0]),
				as: who,
				body: {},
			});
		}
		const rows = await expectConsistent(t, matchId);
		expect(rows).toHaveLength(2);
		expect(new Set(rows)).toEqual(
			new Set([
				`${partIds[0]}|${streamer.userId}`,
				`${partIds[0]}|${coCaster.userId}`,
			]),
		);
	});

	it("is per-sitting: casting one part of a split match indexes only that part", async () => {
		// The grain that makes casts their own profile section — a player can cast
		// one sitting of a two-sitting match.
		const { t, matchId, partIds } = await setup(2);
		expect(partIds).toHaveLength(2);
		const caster = await makeUser({ discordUsername: "part-two-only" });

		await request.post({
			path: castPath(t.tournamentId, matchId, partIds[1]),
			as: caster,
			body: {},
		});
		expect(await expectConsistent(t, matchId)).toEqual([
			`${partIds[1]}|${caster.userId}`,
		]);
	});
});

describe("tournament_match_casters — admin parts writes", () => {
	it("follows an admin replace-all: added, removed, and free-text casters", async () => {
		const { t, matchId, partIds } = await setup();
		const alice = await makeUser({ discordUsername: "admin-set-alice" });
		const bob = await makeUser({ discordUsername: "admin-set-bob" });

		// Admin sets two linked casters plus one free-text name.
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${matchId}/schedule`,
				as: t.admin,
				body: {
					parts: [
						{
							id: partIds[0],
							scheduled_at: WHEN,
							casters: [
								{ user_id: alice.userId, name: null },
								{ user_id: bob.userId, name: null },
								{ user_id: null, name: "SomeGuestOnDiscord" },
							],
							streams: [],
						},
					],
				},
			}),
		);
		// The free-text caster has no user_id and so no row — only linked casters
		// can be attributed to a profile. expectConsistent proves the table equals
		// the blob's LINKED set, not its whole caster list.
		const withBoth = await expectConsistent(t, matchId);
		expect(new Set(withBoth)).toEqual(
			new Set([`${partIds[0]}|${alice.userId}`, `${partIds[0]}|${bob.userId}`]),
		);

		// Removal is the case an in-memory diff gets wrong: re-derive from the
		// stored blob and Bob's row has to disappear.
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${matchId}/schedule`,
				as: t.admin,
				body: {
					parts: [
						{
							id: partIds[0],
							scheduled_at: WHEN,
							casters: [{ user_id: alice.userId, name: null }],
							streams: [],
						},
					],
				},
			}),
		);
		expect(await expectConsistent(t, matchId)).toEqual([
			`${partIds[0]}|${alice.userId}`,
		]);

		// Deleting the part entirely (replace-all with an empty list) clears it.
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${matchId}/schedule`,
				as: t.admin,
				body: { parts: [] },
			}),
		);
		expect(await expectConsistent(t, matchId)).toEqual([]);
	});

	it("stays consistent when a self-service cast and an admin edit interleave", async () => {
		const { t, matchId, partIds } = await setup();
		const caster = await makeUser({ discordUsername: "interleaved-caster" });
		const admin2 = await makeUser({
			discordUsername: "interleaved-admin-pick",
		});

		await request.post({
			path: castPath(t.tournamentId, matchId, partIds[0]),
			as: caster,
			body: {},
		});
		await expectConsistent(t, matchId);

		// Admin replaces the list wholesale — the sync re-derives, so the
		// self-service row goes and the admin's pick lands.
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${matchId}/schedule`,
				as: t.admin,
				body: {
					parts: [
						{
							id: partIds[0],
							scheduled_at: WHEN,
							casters: [{ user_id: admin2.userId, name: null }],
							streams: [],
						},
					],
				},
			}),
		);
		expect(await expectConsistent(t, matchId)).toEqual([
			`${partIds[0]}|${admin2.userId}`,
		]);
	});
});

describe("profile tournament_participant flag", () => {
	async function participatesFlag(userId: string): Promise<boolean> {
		const body = await expectOk<{ tournament_participant: boolean }>(
			await request.get({ path: `/v1/users/${userId}` }),
		);
		return body.tournament_participant;
	}

	it("is false for a user with neither a slot nor a cast", async () => {
		const nobody = await makeUser();
		expect(await participatesFlag(nobody.userId)).toBe(false);
	});

	it("is true for a slot holder", async () => {
		const player = await makeUser({ discordUsername: "flag-player" });
		await makeTournament({ slotsPerDivision: 4, slotOwners: { A: [player] } });
		expect(await participatesFlag(player.userId)).toBe(true);
	});

	it("is true for a dedicated caster who holds no slot", async () => {
		// The persona the "has a slot OR has cast" gate exists for — a slots-only
		// gate would deny them the tab entirely.
		const { t, matchId, partIds } = await setup();
		const caster = await makeUser({ discordUsername: "never-plays" });
		expect(await participatesFlag(caster.userId)).toBe(false);

		await request.post({
			path: castPath(t.tournamentId, matchId, partIds[0]),
			as: caster,
			body: {},
		});
		expect(await participatesFlag(caster.userId)).toBe(true);

		// And their cast shows up as a part-granularity row on their record.
		const record = await expectOk<{
			casts: { match_id: string; part_id: string }[];
			matches: unknown[];
		}>(await request.get({ path: `/v1/users/${caster.userId}/tournaments` }));
		expect(record.casts).toHaveLength(1);
		expect(record.casts[0]).toMatchObject({
			match_id: matchId,
			part_id: partIds[0],
		});
		// They never played, so the Matches section is empty — the two sections
		// don't interleave.
		expect(record.matches).toEqual([]);
	});
});
