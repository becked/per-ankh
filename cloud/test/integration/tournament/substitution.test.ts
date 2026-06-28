// End-to-end substitution flow. The pieces (admin slot edit, login claim,
// my-matches by slot.user_id) are tested in isolation elsewhere; this pins the
// composition: an admin substitutes a claimed slot → the original occupant
// loses it → the new occupant logs in and claims → match participation
// (what standings key off — the slot's live user_id) follows the slot.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { devLogin, request } from "../../helpers/requests";
import type { TestUser } from "../../helpers/builders";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface MyMatch {
	match_id: string;
}

async function myMatchIds(user: TestUser): Promise<string[]> {
	const res = await request.get({ path: "/v1/users/me/matches", as: user });
	const body = await expectOk<{ matches: MyMatch[] }>(res);
	return body.matches.map((m) => m.match_id);
}

async function loadSlotUserId(slotId: string): Promise<string | null> {
	const row = await env.SHARE_DB.prepare(
		"SELECT user_id FROM tournament_slots WHERE slot_id = ?",
	)
		.bind(slotId)
		.first<{ user_id: string | null }>();
	return row?.user_id ?? null;
}

interface SlotIdentity {
	user_id: string | null;
	discord_id: string | null;
	discord_username: string | null;
	signup_answer: string | null;
}

async function loadSlotIdentity(slotId: string): Promise<SlotIdentity> {
	const row = await env.SHARE_DB.prepare(
		"SELECT user_id, discord_id, discord_username, signup_answer FROM tournament_slots WHERE slot_id = ?",
	)
		.bind(slotId)
		.first<SlotIdentity>();
	if (!row) throw new Error(`Slot ${slotId} not found`);
	return row;
}

describe("end-to-end slot substitution", () => {
	it("transfers a claimed slot's match participation from the original to the substituted occupant", async () => {
		// Original occupant owns division-A slot 0 (claimed); the other slots
		// are unclaimed free-text. Round 1 is generated so a real match exists.
		const original = await makeUser({ discordUsername: "orig-occupant" });
		const t = await makeTournament({
			name: "Substitution Cup",
			slotOwners: { A: [original] },
			advanceTo: "swiss-round-1-generated",
		});
		const slot = t.slotsByDivision.A[0];
		expect(slot.owner?.userId).toBe(original.userId);

		// The original occupant's round-1 match (4 slots/division → no byes).
		const origMatch = (await t.matches()).find(
			(m) => m.slot_a_id === slot.slotId || m.slot_b_id === slot.slotId,
		)!;
		expect(await myMatchIds(original)).toContain(origMatch.match_id);

		// Admin substitutes a new free-text occupant — clears the prior link.
		const newUsername = "subbed-occupant";
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/slots/${slot.slotId}`,
				as: t.admin,
				body: { discord_username: newUsername },
			}),
		);
		expect(await loadSlotUserId(slot.slotId)).toBeNull();
		// Original occupant no longer participates in the match.
		expect(await myMatchIds(original)).not.toContain(origMatch.match_id);

		// The original user logging back in cannot reclaim (username changed,
		// discord_id pin cleared).
		await devLogin({
			discordId: original.discordId,
			username: original.discordUsername,
		});
		expect(await loadSlotUserId(slot.slotId)).toBeNull();

		// The new occupant logs in and claims. Using makeUser for the session
		// first, then devLogin with the SAME discord_id, means the claim links
		// to a user we hold a session for (devLogin's ON CONFLICT(discord_id)
		// upsert keeps the same user_id) so we can read their my-matches.
		const replacement = await makeUser({ discordUsername: newUsername });
		await devLogin({
			discordId: replacement.discordId,
			username: newUsername,
		});
		expect(await loadSlotUserId(slot.slotId)).toBe(replacement.userId);

		// Participation followed the slot: the new occupant now sees the match,
		// the original still does not.
		expect(await myMatchIds(replacement)).toContain(origMatch.match_id);
		expect(await myMatchIds(original)).not.toContain(origMatch.match_id);
	});
});

// A slot's occupant link (user_id/discord_id) must only be cleared by a genuine
// occupant change. These pin the invariant the slots-panel answer-edit bug
// violated: editing other fields, or re-sending the same handle, must not unlink.
describe("slot PATCH occupant-link invariants", () => {
	it("editing only the signup answer leaves the occupant link intact", async () => {
		const owner = await makeUser({ discordUsername: "answer-editor" });
		const t = await makeTournament({ slotOwners: { A: [owner] } });
		const slot = t.slotsByDivision.A[0];
		const before = await loadSlotIdentity(slot.slotId);
		expect(before.user_id).toBe(owner.userId);
		expect(before.discord_id).toBe(owner.discordId);

		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/slots/${slot.slotId}`,
				as: t.admin,
				body: { signup_answer: "I main Babylonia" },
			}),
		);

		const after = await loadSlotIdentity(slot.slotId);
		// The link survives; only the answer changed.
		expect(after.user_id).toBe(owner.userId);
		expect(after.discord_id).toBe(owner.discordId);
		expect(after.discord_username).toBe(before.discord_username);
		expect(after.signup_answer).toBe("I main Babylonia");
	});

	it("re-sending the current handle (unchanged) leaves the occupant link intact", async () => {
		const owner = await makeUser({ discordUsername: "same-handle" });
		const t = await makeTournament({ slotOwners: { A: [owner] } });
		const slot = t.slotsByDivision.A[0];
		const before = await loadSlotIdentity(slot.slotId);
		expect(before.user_id).toBe(owner.userId);
		expect(before.discord_username).toBe(owner.discordUsername);

		// Post-fix #2 the editor seeds from the real handle, so a no-op-ish save
		// can re-send the same handle — it must not be treated as a substitution.
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/slots/${slot.slotId}`,
				as: t.admin,
				body: { discord_username: owner.discordUsername },
			}),
		);

		const after = await loadSlotIdentity(slot.slotId);
		expect(after.user_id).toBe(owner.userId);
		expect(after.discord_id).toBe(owner.discordId);
	});
});
