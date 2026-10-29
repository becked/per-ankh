// The scheduling timezone, end to end: where it is collected, who may read it,
// and the order the worker resolves it in.
//
// The resolution order is the whole point of the pair of columns (migration
// 0055) — `users.timezone` via the slot's user_id, then the slot's own — so
// the cases that matter are the ones where the two disagree, and the
// substitution that makes them disagree. The DM's last two steps (the freeform
// signup answer, then "(timezone TBD)") are client-side and live in
// src/lib/tournament/slot-identity.ts.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import type { TestUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

async function openSignups(tournamentId: string): Promise<void> {
	await env.SHARE_DB.prepare(
		"UPDATE tournaments SET signups_open = 1 WHERE tournament_id = ?",
	)
		.bind(tournamentId)
		.run();
}

// The account zone, set the way the user would: through the settings endpoint,
// so the canonicalization on the way in is part of what these tests cover.
async function setAccountZone(
	user: TestUser,
	timezone: string | null,
): Promise<void> {
	await expectOk(
		await request.post({
			path: "/v1/auth/settings",
			as: user,
			body: { timezone },
		}),
	);
}

async function slotColumn(
	slotId: string,
	column: "timezone" | "signup_answer",
): Promise<string | null> {
	const row = await env.SHARE_DB.prepare(
		`SELECT ${column} AS value FROM tournament_slots WHERE slot_id = ?`,
	)
		.bind(slotId)
		.first<{ value: string | null }>();
	return row?.value ?? null;
}

interface StandingsRow {
	slot_id: string;
	timezone: string | null;
	// The seat's own column, unresolved — what the roster's Zone editor
	// seeds from, as opposed to `timezone`, which is what the DM prints.
	slot_timezone: string | null;
	signup_answer: string | null;
}

// Every Swiss standings row, flattened across divisions — the admin-visible
// payload the "Copy DM" template is built from.
async function standingsRows(
	tournamentId: string,
	as?: TestUser,
): Promise<StandingsRow[]> {
	const res = await request.get({
		path: `/v1/tournaments/${tournamentId}/standings`,
		...(as ? { as } : {}),
	});
	const body = await expectOk<{
		divisions: Record<"A" | "B", { standings: StandingsRow[] }>;
	}>(res);
	return [...body.divisions.A.standings, ...body.divisions.B.standings];
}

async function zoneForSlot(
	tournamentId: string,
	slotId: string,
	as?: TestUser,
): Promise<string | null> {
	const rows = await standingsRows(tournamentId, as);
	const row = rows.find((r) => r.slot_id === slotId);
	if (!row) throw new Error(`Slot ${slotId} not in standings`);
	return row.timezone;
}

describe("POST /v1/auth/settings — timezone", () => {
	it("stores a zone, canonicalizes it, and echoes the stored value", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/auth/settings",
			as: user,
			body: { timezone: "america/new_york" },
		});
		const body = await expectOk<{ timezone: string | null }>(res);
		expect(body.timezone).toBe("America/New_York");

		const me = await expectOk<{ timezone: string | null }>(
			await request.get({ path: "/v1/auth/me", as: user }),
		);
		expect(me.timezone).toBe("America/New_York");
	});

	it("clears the zone on an explicit null", async () => {
		const user = await makeUser();
		await setAccountZone(user, "Europe/Berlin");
		const body = await expectOk<{ timezone: string | null }>(
			await request.post({
				path: "/v1/auth/settings",
				as: user,
				body: { timezone: null },
			}),
		);
		expect(body.timezone).toBeNull();
	});

	it("leaves the zone untouched when the patch omits it", async () => {
		const user = await makeUser();
		await setAccountZone(user, "Europe/Berlin");
		const body = await expectOk<{ timezone: string | null }>(
			await request.post({
				path: "/v1/auth/settings",
				as: user,
				body: { open_to_matches: false },
			}),
		);
		expect(body.timezone).toBe("Europe/Berlin");
	});

	it("rejects a string that isn't a zone", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/auth/settings",
			as: user,
			body: { timezone: "GMT-4" },
		});
		expect(res.status).toBe(400);
	});
});

describe("signup — the per-tournament switch is the gate", () => {
	it("stores the zone when the tournament asked for one", async () => {
		const player = await makeUser();
		const t = await makeTournament({ slotsPerDivision: 0 });
		await openSignups(t.tournamentId);
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}`,
				as: t.admin,
				body: { collect_timezone: true },
			}),
		);

		const body = await expectOk<{ slot: { slot_id: string } }>(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/signup`,
				as: player,
				body: { division: "A", timezone: "Europe/London" },
			}),
		);
		expect(await slotColumn(body.slot.slot_id, "timezone")).toBe(
			"Europe/London",
		);
	});

	it("drops a zone a tournament that never asked still received", async () => {
		const player = await makeUser();
		const t = await makeTournament({ slotsPerDivision: 0 });
		await openSignups(t.tournamentId);

		const body = await expectOk<{ slot: { slot_id: string } }>(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/signup`,
				as: player,
				body: { division: "A", timezone: "Europe/London" },
			}),
		);
		expect(await slotColumn(body.slot.slot_id, "timezone")).toBeNull();
	});

	it("rejects a zone the runtime doesn't recognize", async () => {
		const player = await makeUser();
		const t = await makeTournament({ slotsPerDivision: 0 });
		await openSignups(t.tournamentId);
		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/signup`,
			as: player,
			body: { division: "A", timezone: "America/Nowhere" },
		});
		expect(res.status).toBe(400);
	});
});

// The admin's seat-zone editor. It exists because the signup picker needs
// status=setup AND signups_open: a tournament already in swiss has no other
// writer, so without this an organiser holding 60-odd freeform answers has no
// way to turn any of them into a zone the DM can state an offset from.
describe("PATCH /v1/tournaments/:id/slots/:slotId — timezone", () => {
	async function patchZone(
		t: Awaited<ReturnType<typeof makeTournament>>,
		slotId: string,
		body: Record<string, unknown>,
	): Promise<Response> {
		return request.patch({
			path: `/v1/tournaments/${t.tournamentId}/slots/${slotId}`,
			as: t.admin,
			body,
		});
	}

	it("stores the zone on the seat and canonicalizes it", async () => {
		const t = await makeTournament({ slotsPerDivision: 1 });
		const slot = t.slotsByDivision.A[0];
		await expectOk(await patchZone(t, slot.slotId, { timezone: "us/eastern" }));
		expect(await slotColumn(slot.slotId, "timezone")).toBe("America/New_York");
	});

	it("clears the zone on an explicit null", async () => {
		const t = await makeTournament({ slotsPerDivision: 1 });
		const slot = t.slotsByDivision.A[0];
		await expectOk(await patchZone(t, slot.slotId, { timezone: "Asia/Tokyo" }));
		await expectOk(await patchZone(t, slot.slotId, { timezone: null }));
		expect(await slotColumn(slot.slotId, "timezone")).toBeNull();
	});

	// The occupant editor and the zone editor are separate controls on the same
	// row; neither may write the other's column.
	it("leaves the zone untouched when the patch omits it", async () => {
		const t = await makeTournament({ slotsPerDivision: 1 });
		const slot = t.slotsByDivision.A[0];
		await expectOk(await patchZone(t, slot.slotId, { timezone: "Asia/Tokyo" }));
		await expectOk(
			await patchZone(t, slot.slotId, { signup_answer: "evenings" }),
		);
		expect(await slotColumn(slot.slotId, "timezone")).toBe("Asia/Tokyo");
		expect(await slotColumn(slot.slotId, "signup_answer")).toBe("evenings");
	});

	it("rejects a zone the runtime doesn't recognize", async () => {
		const t = await makeTournament({ slotsPerDivision: 1 });
		const slot = t.slotsByDivision.A[0];
		const res = await patchZone(t, slot.slotId, { timezone: "UTC+3" });
		expect(res.status).toBe(400);
		expect(await slotColumn(slot.slotId, "timezone")).toBeNull();
	});

	// The case the editor exists for: config locks after setup, and the zone
	// deliberately isn't part of that lock.
	it("writes the zone after the tournament has left setup", async () => {
		const t = await makeTournament({ slotsPerDivision: 2, advanceTo: "swiss" });
		const slot = t.slotsByDivision.A[0];
		await expectOk(
			await patchZone(t, slot.slotId, { timezone: "Europe/Lisbon" }),
		);
		expect(await slotColumn(slot.slotId, "timezone")).toBe("Europe/Lisbon");
	});

	it("is refused for a signed-in non-admin", async () => {
		const outsider = await makeUser();
		const t = await makeTournament({ slotsPerDivision: 1 });
		const slot = t.slotsByDivision.A[0];
		await expectErrorCode(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/slots/${slot.slotId}`,
				as: outsider,
				body: { timezone: "Asia/Tokyo" },
			}),
			{ status: 403, code: "NOT_TOURNAMENT_ADMIN" },
		);
		expect(await slotColumn(slot.slotId, "timezone")).toBeNull();
	});

	// What the Zone cell needs to be able to say: the admin's write landed, and
	// the DM is still printing something else because the player set their own.
	it("stays behind the occupant's account zone, and the payload shows both", async () => {
		const player = await makeUser();
		await setAccountZone(player, "Europe/Berlin");
		const t = await makeTournament({
			slotsPerDivision: 1,
			slotOwners: { A: [player] },
		});
		const slot = t.slotsByDivision.A[0];
		await expectOk(await patchZone(t, slot.slotId, { timezone: "Asia/Tokyo" }));

		const row = (await standingsRows(t.tournamentId, t.admin)).find(
			(r) => r.slot_id === slot.slotId,
		);
		expect(row?.slot_timezone).toBe("Asia/Tokyo");
		expect(row?.timezone).toBe("Europe/Berlin");
	});

	it("hides the seat's own zone from a non-admin viewer", async () => {
		const outsider = await makeUser();
		const t = await makeTournament({ slotsPerDivision: 1 });
		const slot = t.slotsByDivision.A[0];
		await expectOk(await patchZone(t, slot.slotId, { timezone: "Asia/Tokyo" }));
		// Open signups so the setup gate doesn't 404 the non-admin read.
		await openSignups(t.tournamentId);

		const row = (await standingsRows(t.tournamentId, outsider)).find(
			(r) => r.slot_id === slot.slotId,
		);
		expect(row?.slot_timezone).toBeNull();
		expect(row?.timezone).toBeNull();
	});
});

describe("PATCH /v1/tournaments/:id — collect_timezone", () => {
	it("round-trips the switch through the 0/1 column", async () => {
		const t = await makeTournament({ slotsPerDivision: 0 });
		expect((await t.refresh()).collect_timezone).toBe(0);
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}`,
				as: t.admin,
				body: { collect_timezone: true },
			}),
		);
		expect((await t.refresh()).collect_timezone).toBe(1);

		// Read as the admin: a setup-phase tournament with signups closed is
		// hidden from everyone else by the setup gate (setupGateHides).
		const detail = await expectOk<{ collect_timezone: boolean }>(
			await request.get({
				path: `/v1/tournaments/${t.tournamentId}`,
				as: t.admin,
			}),
		);
		expect(detail.collect_timezone).toBe(true);
	});
});

describe("standings — resolution order and who may read it", () => {
	it("prefers the occupant's account zone over the slot's own", async () => {
		const player = await makeUser();
		await setAccountZone(player, "Europe/Berlin");
		const t = await makeTournament({
			slotsPerDivision: 1,
			slotOwners: { A: [player] },
		});
		const slot = t.slotsByDivision.A[0];
		await env.SHARE_DB.prepare(
			"UPDATE tournament_slots SET timezone = ? WHERE slot_id = ?",
		)
			.bind("Asia/Tokyo", slot.slotId)
			.run();

		expect(await zoneForSlot(t.tournamentId, slot.slotId, t.admin)).toBe(
			"Europe/Berlin",
		);
	});

	it("falls back to the slot's zone when the occupant has no account zone", async () => {
		const t = await makeTournament({ slotsPerDivision: 1 });
		const slot = t.slotsByDivision.A[0];
		await env.SHARE_DB.prepare(
			"UPDATE tournament_slots SET timezone = ? WHERE slot_id = ?",
		)
			.bind("Asia/Tokyo", slot.slotId)
			.run();

		expect(await zoneForSlot(t.tournamentId, slot.slotId, t.admin)).toBe(
			"Asia/Tokyo",
		);
	});

	it("is null for a non-admin viewer, whatever is stored", async () => {
		const player = await makeUser();
		await setAccountZone(player, "Europe/Berlin");
		const outsider = await makeUser();
		const t = await makeTournament({
			slotsPerDivision: 1,
			slotOwners: { A: [player] },
		});
		const slot = t.slotsByDivision.A[0];
		// Open signups so the setup gate doesn't 404 the non-admin reads below
		// before they can assert on the payload.
		await openSignups(t.tournamentId);

		expect(await zoneForSlot(t.tournamentId, slot.slotId, outsider)).toBeNull();
		expect(await zoneForSlot(t.tournamentId, slot.slotId)).toBeNull();
	});

	// The complaint this whole feature answers: a zone stored on the seat
	// describes whoever signed up for it, and substituting the occupant does
	// not touch it. Reading through user_id is what makes the seat re-describe
	// itself.
	it("follows a substituted occupant without the slot's own zone changing", async () => {
		const original = await makeUser({ discordUsername: "tz-original" });
		const substitute = await makeUser({ discordUsername: "tz-substitute" });
		await setAccountZone(substitute, "Pacific/Auckland");
		const t = await makeTournament({
			slotsPerDivision: 1,
			slotOwners: { A: [original] },
		});
		const slot = t.slotsByDivision.A[0];
		// The zone the original registrant gave, left on the seat.
		await env.SHARE_DB.prepare(
			"UPDATE tournament_slots SET timezone = ? WHERE slot_id = ?",
		)
			.bind("America/Chicago", slot.slotId)
			.run();
		expect(await zoneForSlot(t.tournamentId, slot.slotId, t.admin)).toBe(
			"America/Chicago",
		);

		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/slots/${slot.slotId}`,
				as: t.admin,
				body: {
					discord_username: substitute.discordUsername,
					user_id: substitute.userId,
				},
			}),
		);

		// The substitution left the column alone — that is the bug — and the
		// read corrects for it anyway.
		expect(await slotColumn(slot.slotId, "timezone")).toBe("America/Chicago");
		expect(await zoneForSlot(t.tournamentId, slot.slotId, t.admin)).toBe(
			"Pacific/Auckland",
		);
	});
});

describe("slot swap — the zone travels with the occupant", () => {
	it("moves each seat's stored zone along with its identity", async () => {
		const t = await makeTournament({ slotsPerDivision: 2 });
		const [a, b] = t.slotsByDivision.A;
		await env.SHARE_DB.batch([
			env.SHARE_DB.prepare(
				"UPDATE tournament_slots SET timezone = ? WHERE slot_id = ?",
			).bind("America/Chicago", a.slotId),
			env.SHARE_DB.prepare(
				"UPDATE tournament_slots SET timezone = ? WHERE slot_id = ?",
			).bind("Asia/Tokyo", b.slotId),
		]);

		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/slots/swap`,
				as: t.admin,
				body: { slot_a_id: a.slotId, slot_b_id: b.slotId },
			}),
		);

		expect(await slotColumn(a.slotId, "timezone")).toBe("Asia/Tokyo");
		expect(await slotColumn(b.slotId, "timezone")).toBe("America/Chicago");
	});
});
