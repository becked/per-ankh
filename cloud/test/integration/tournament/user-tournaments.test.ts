// Behavior tests for GET /v1/users/:user_id/tournaments — the payload behind
// the player profile's Tournaments tab (issue #154).
//
// Four things this endpoint has to get right, each a way the obvious
// implementation is wrong:
//   1. Attribution prefers the report-time occupant snapshot for a DECIDED
//      match and the live slot only for a PENDING one. A live-slot-only join
//      (what the deleted /v1/users/me/matches did) hands a substituted-out
//      player's played matches to the substitute.
//   2. Pending rows resolve their occupants from the live slot — those are the
//      tab's "upcoming" rows, and they have no snapshot to read.
//   3. The setup gate: a setup-phase tournament with signups closed is hidden
//      from non-admins, per tournament (not one global admin check).
//   4. The four admin-only slot_a/b_discord_* keys are ABSENT, not null.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { devLogin, request } from "../../helpers/requests";
import type { TestUser } from "../../helpers/builders";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// Two sitting times for the split-match cast case below.
const WHEN = "2026-08-01T18:00:00.000Z";
const LATER = "2026-08-03T18:00:00.000Z";

const ADMIN_ONLY_KEYS = [
	"slot_a_discord_username",
	"slot_a_discord_id",
	"slot_b_discord_username",
	"slot_b_discord_id",
] as const;

interface UserTournamentsBody {
	user_id: string;
	tournaments: {
		tournament_id: string;
		slug: string;
		name: string;
		status: string;
		division_a_name: string;
		division_b_name: string;
		map_pool: { id: string; script: string }[];
		slots: {
			slot_id: string;
			phase: string;
			division: string | null;
			swiss_seed: number | null;
			championship_seed: number | null;
		}[];
	}[];
	matches: Record<string, unknown>[];
	casts: Record<string, unknown>[];
	slot_labels: Record<string, string>;
	slot_avatars: Record<string, string | null>;
}

// `as` omitted → anonymous, which is the tab's normal (public) caller.
async function fetchRecord(
	userId: string,
	as?: TestUser,
): Promise<UserTournamentsBody> {
	const res = await request.get({
		path: `/v1/users/${userId}/tournaments`,
		...(as ? { as } : {}),
	});
	return expectOk<UserTournamentsBody>(res);
}

describe("GET /v1/users/:user_id/tournaments", () => {
	it("returns empty sections for a user with no tournament history", async () => {
		const lonely = await makeUser();
		const body = await fetchRecord(lonely.userId);
		expect(body.user_id).toBe(lonely.userId);
		expect(body.tournaments).toEqual([]);
		expect(body.matches).toEqual([]);
		expect(body.casts).toEqual([]);
	});

	it("lists enrollment with division and seed, plus the match table's context", async () => {
		const player = await makeUser({ discordUsername: "enrolled-player" });
		const t = await makeTournament({
			name: "Enrollment Cup",
			slotsPerDivision: 4,
			slotOwners: { B: [player] },
		});
		// Signups open, so the setup-phase tournament is publicly visible — the
		// state this section exists for: enrolled, but no round generated yet.
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}`,
				as: t.admin,
				body: { signups_open: true },
			}),
		);

		const body = await fetchRecord(player.userId);
		expect(body.tournaments).toHaveLength(1);
		const entry = body.tournaments[0];
		expect(entry.tournament_id).toBe(t.tournamentId);
		expect(entry.slug).toBe(t.slug);
		expect(entry.name).toBe("Enrollment Cup");
		expect(entry.status).toBe("setup");
		// The four fields the shared match table reads off its tournament.
		expect(entry.division_a_name).toBeTypeOf("string");
		expect(entry.division_b_name).toBeTypeOf("string");
		expect(entry.map_pool.map((m) => m.script)).toEqual([
			"MAP_SEASIDE",
			"MAP_RIVER",
		]);
		expect(entry.slots).toHaveLength(1);
		expect(entry.slots[0]).toMatchObject({
			slot_id: t.slotsByDivision.B[0].slotId,
			phase: "swiss",
			division: "B",
			swiss_seed: 1,
		});
		// Setup tournaments have no rounds, so nothing to play yet — the whole
		// point of the Enrollment section.
		expect(body.matches).toEqual([]);
	});

	it("attributes a pending match to the live slot occupant and fills their name", async () => {
		const player = await makeUser({ discordUsername: "pending-player" });
		const t = await makeTournament({
			slotsPerDivision: 4,
			slotOwners: { A: [player] },
			advanceTo: "swiss-round-1-generated",
		});
		const slotId = t.slotsByDivision.A[0].slotId;
		const expected = (await t.matches()).find(
			(m) => m.slot_a_id === slotId || m.slot_b_id === slotId,
		)!;

		const body = await fetchRecord(player.userId);
		expect(body.matches.map((m) => m.match_id)).toEqual([expected.match_id]);
		expect(body.matches[0].status).toBe("pending");
		// serializeMatch leaves the snapshot labels null for pending matches; the
		// live slot identity arrives in slot_labels instead, which is what the
		// render layer falls through to.
		expect(body.matches[0].slot_a_display_name).toBeNull();
		expect(body.slot_labels[slotId]).toBe(player.displayName);
	});

	it("keeps a DECIDED match with the player who actually played it after a substitution", async () => {
		// The bug the report-time snapshot exists to prevent: the original
		// occupant plays and reports a match, an admin then substitutes their
		// slot, and a live-slot-only join would move the played match to the
		// substitute and drop it from the person who played.
		const original = await makeUser({ discordUsername: "played-then-subbed" });
		const t = await makeTournament({
			slotsPerDivision: 4,
			slotOwners: { A: [original] },
			advanceTo: "swiss-round-1-generated",
		});
		const slot = t.slotsByDivision.A[0];
		const match = (await t.matches()).find(
			(m) => m.slot_a_id === slot.slotId || m.slot_b_id === slot.slotId,
		)!;

		// Report it, which stamps the occupant snapshot.
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${match.match_id}`,
				as: t.admin,
				body: { winner_slot_id: slot.slotId, status: "complete" },
			}),
		);
		expect(
			(await fetchRecord(original.userId)).matches.map((m) => m.match_id),
		).toContain(match.match_id);

		// Substitute the slot, and let the replacement claim it for real.
		const newUsername = "the-substitute";
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/slots/${slot.slotId}`,
				as: t.admin,
				body: { discord_username: newUsername },
			}),
		);
		const replacement = await makeUser({ discordUsername: newUsername });
		await devLogin({
			discordId: replacement.discordId,
			username: newUsername,
		});

		// The played match stays with the original occupant and never appears on
		// the substitute's record.
		const afterOriginal = await fetchRecord(original.userId);
		const afterReplacement = await fetchRecord(replacement.userId);
		expect(afterOriginal.matches.map((m) => m.match_id)).toContain(
			match.match_id,
		);
		expect(afterReplacement.matches.map((m) => m.match_id)).not.toContain(
			match.match_id,
		);
		// The original no longer holds a seat, so they drop out of Enrollment while
		// keeping the match; the substitute is the reverse.
		expect(afterOriginal.tournaments[0].slots).toEqual([]);
		expect(afterReplacement.tournaments[0].slots.map((s) => s.slot_id)).toEqual(
			[slot.slotId],
		);
	});

	it("attributes a match decided BEFORE the player claimed their slot", async () => {
		// The other half of the snapshot rule. The snapshot writers store
		// `slot?.user_id ?? null`, so a match reported while its occupant hadn't
		// yet logged in pins a NULL user_id — and the login auto-claim never
		// backfills it. Reading the snapshot alone would drop the match from that
		// player's record forever, even though the tournament page renders their
		// name on it. The per-side live fallthrough is what keeps it visible.
		const t = await makeTournament({
			slotsPerDivision: 4,
			advanceTo: "swiss-round-1-generated",
		});
		const slot = t.slotsByDivision.A[0];
		const match = (await t.matches()).find(
			(m) => m.slot_a_id === slot.slotId || m.slot_b_id === slot.slotId,
		)!;

		// Decide it while the slot is still unclaimed → NULL snapshot user_id.
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${match.match_id}`,
				as: t.admin,
				body: { winner_slot_id: slot.slotId, status: "complete" },
			}),
		);

		// The occupant logs in for the first time and auto-claims the seat.
		const latecomer = await makeUser({
			discordUsername: slot.discordUsername,
		});
		await devLogin({
			discordId: latecomer.discordId,
			username: slot.discordUsername,
		});

		const body = await fetchRecord(latecomer.userId);
		expect(body.matches.map((m) => m.match_id)).toContain(match.match_id);
		expect(body.tournaments[0].slots.map((s) => s.slot_id)).toEqual([
			slot.slotId,
		]);
	});

	it("hides a setup-phase tournament with signups closed from non-admins", async () => {
		const player = await makeUser({ discordUsername: "secret-signup" });
		const t = await makeTournament({
			name: "Unannounced Cup",
			slotsPerDivision: 4,
			slotOwners: { A: [player] },
		});
		// makeTournament leaves signups_open at its default 0.
		expect((await t.refresh()).signups_open).toBe(0);

		// Anonymous and a signed-in stranger see nothing — not even the name/slug,
		// which would link to a 404.
		const stranger = await makeUser();
		for (const viewer of [undefined, stranger]) {
			const body = await fetchRecord(player.userId, viewer);
			expect(body.tournaments).toEqual([]);
		}

		// The tournament's own admin sees it: the gate is per tournament.
		const asAdmin = await fetchRecord(player.userId, t.admin);
		expect(asAdmin.tournaments.map((x) => x.tournament_id)).toEqual([
			t.tournamentId,
		]);

		// Opening signups makes it public, same as every per-tournament read.
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}`,
				as: t.admin,
				body: { signups_open: true },
			}),
		);
		const reopened = await fetchRecord(player.userId);
		expect(reopened.tournaments.map((x) => x.tournament_id)).toEqual([
			t.tournamentId,
		]);
	});

	it("omits the admin-only slot_a/b_discord_* keys entirely, for every viewer", async () => {
		// Not "returns them as null": a null-valued key leaves the field in this
		// public endpoint's contract, so a later change that threaded the admin
		// handle map through would populate real Discord handles with no type
		// error and no failing test (issue #110's shape). Absent by construction.
		const player = await makeUser({ discordUsername: "shape-check" });
		const t = await makeTournament({
			slotsPerDivision: 4,
			slotOwners: { A: [player] },
			advanceTo: "swiss-round-1-generated",
		});

		// Including the tournament admin, who DOES get these fields from the
		// per-tournament matches endpoint.
		for (const viewer of [undefined, t.admin]) {
			const body = await fetchRecord(player.userId, viewer);
			expect(body.matches.length).toBeGreaterThan(0);
			for (const m of body.matches) {
				for (const key of ADMIN_ONLY_KEYS) {
					expect(Object.keys(m)).not.toContain(key);
				}
			}
		}

		// Control: the per-tournament read still carries them (as nulls for a
		// non-admin), so the change above didn't quietly narrow that contract.
		const perTournament = await expectOk<{
			matches: Record<string, unknown>[];
		}>(
			await request.get({
				path: `/v1/tournaments/${t.tournamentId}/matches`,
			}),
		);
		for (const key of ADMIN_ONLY_KEYS) {
			expect(Object.keys(perTournament.matches[0])).toContain(key);
			expect(perTournament.matches[0][key]).toBeNull();
		}
	});

	it("lists a cast at part granularity for a caster who holds no slot", async () => {
		// The union case: a cast can name a tournament the player has no seat in,
		// so the tournament index is the union of all three sections rather than
		// the enrollment set. The tab has a branch for exactly this shape — an
		// entry with `slots: []` that still renders a Casts group.
		const caster = await makeUser({ discordUsername: "slotless-caster" });
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const match = (await t.matches()).find((m) => m.status === "pending")!;

		// Two sittings, so "one row per part the caster appears on" is a real
		// claim rather than one that a single-part match would satisfy anyway.
		const scheduled = await expectOk<{ match: { parts: { id: string }[] } }>(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${match.match_id}/schedule`,
				as: t.admin,
				body: {
					parts: [
						{ scheduled_at: WHEN, casters: [], streams: [] },
						{ scheduled_at: LATER, casters: [], streams: [] },
					],
				},
			}),
		);
		const partIds = scheduled.match.parts.map((p) => p.id);
		expect(
			(
				await request.post({
					path: `/v1/tournaments/${t.tournamentId}/matches/${match.match_id}/parts/${partIds[0]}/casters/me`,
					as: caster,
					body: {},
				})
			).status,
		).toBe(204);

		const body = await fetchRecord(caster.userId);
		// The tournament is present for the cast alone, with an empty Enrollment.
		expect(body.tournaments.map((x) => x.tournament_id)).toEqual([
			t.tournamentId,
		]);
		expect(body.tournaments[0].slots).toEqual([]);
		expect(body.matches).toEqual([]);
		// One row, naming the sitting actually cast — not the other one.
		expect(body.casts).toHaveLength(1);
		expect(body.casts[0].match_id).toBe(match.match_id);
		expect(body.casts[0].part_id).toBe(partIds[0]);
	});

	it("excludes byes and spans tournaments", async () => {
		// 5 slots per division → one bye per round. Byes auto-resolve and were
		// never played or scheduled, so they'd only produce an empty table group.
		const player = await makeUser({ discordUsername: "bye-getter" });
		const t = await makeTournament({
			slotsPerDivision: 5,
			slotOwners: { A: [player] },
			advanceTo: "swiss-round-1-generated",
		});
		const t2 = await makeTournament({
			slotsPerDivision: 4,
			slotOwners: { B: [player] },
			advanceTo: "swiss-round-1-generated",
		});

		const body = await fetchRecord(player.userId);
		const byeIds = new Set(
			(await t.matches())
				.filter((m) => m.status === "bye")
				.map((m) => m.match_id),
		);
		expect(byeIds.size).toBeGreaterThan(0);
		for (const m of body.matches) {
			expect(byeIds.has(m.match_id as string)).toBe(false);
		}
		expect(new Set(body.tournaments.map((x) => x.tournament_id))).toEqual(
			new Set([t.tournamentId, t2.tournamentId]),
		);
	});
});
