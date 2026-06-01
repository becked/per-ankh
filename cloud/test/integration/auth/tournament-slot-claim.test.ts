// Integration tests for the Discord-login → tournament-slot claim flow
// (claimTournamentSlots in cloud/src/auth.ts), driven through the real
// /v1/auth/dev/login handler. The two-step UPDATE — pin by discord_id, then
// fall back to discord_username — is the only path connecting a Discord login
// to tournament participation, and was previously untested.
//
// Each case asserts on the tournament_slots row directly: claiming sets
// user_id (and pins discord_id on a first username claim).

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeTournament } from "../../helpers/builders";
import { devLogin, request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface SlotRow {
	slot_id: string;
	user_id: string | null;
	discord_id: string | null;
	discord_username: string | null;
}

async function loadSlot(slotId: string): Promise<SlotRow | null> {
	return await env.SHARE_DB.prepare(
		`SELECT slot_id, user_id, discord_id, discord_username
		 FROM tournament_slots WHERE slot_id = ?`,
	)
		.bind(slotId)
		.first<SlotRow>();
}

async function userIdForDiscord(discordId: string): Promise<string | null> {
	const row = await env.SHARE_DB.prepare(
		"SELECT user_id FROM users WHERE discord_id = ?",
	)
		.bind(discordId)
		.first<{ user_id: string }>();
	return row?.user_id ?? null;
}

describe("Discord-login tournament-slot claim flow", () => {
	it("first-time login claims an unclaimed slot by username and pins discord_id", async () => {
		const t = await makeTournament();
		const slot = t.slotsByDivision.A[0];
		expect(slot.owner).toBeNull(); // unclaimed: no slotOwners passed

		const discordId = "2000000000000000001";
		const res = await devLogin({
			discordId,
			username: slot.discordUsername,
		});
		expect(res.status).toBe(302);

		const claimed = await loadSlot(slot.slotId);
		expect(claimed?.user_id).toBe(await userIdForDiscord(discordId));
		// First username claim pins discord_id for rename-proof future logins.
		expect(claimed?.discord_id).toBe(discordId);
	});

	it("returning user re-claims by discord_id after a Discord rename (username no longer matches)", async () => {
		const t = await makeTournament();
		const slot = t.slotsByDivision.B[0];
		const discordId = "2000000000000000002";

		// First login claims + pins discord_id.
		await devLogin({ discordId, username: slot.discordUsername });
		const userId = await userIdForDiscord(discordId);

		// Simulate a prior pin that was later released (user_id cleared) while
		// the discord_id pin was kept, plus a Discord rename so the slot's
		// stored username no longer matches the user's current handle. No API
		// path produces exactly this state — the seam isolates stmt 1 (pin by
		// discord_id), which is the rename-proof half of the claim.
		await env.SHARE_DB.prepare(
			`UPDATE tournament_slots
			 SET user_id = NULL, discord_username = 'stale-old-handle'
			 WHERE slot_id = ?`,
		)
			.bind(slot.slotId)
			.run();

		// Log in again under a NEW username but the SAME discord_id.
		const res = await devLogin({
			discordId,
			username: "renamed-new-handle",
		});
		expect(res.status).toBe(302);

		// Re-claimed via discord_id despite the username mismatch.
		const reclaimed = await loadSlot(slot.slotId);
		expect(reclaimed?.user_id).toBe(userId);
	});

	it("substitution clears the claim; the original user can no longer claim and the new user can", async () => {
		const t = await makeTournament();
		const slot = t.slotsByDivision.A[0];
		const originalDiscordId = "2000000000000000003";

		// Original user claims the slot.
		await devLogin({
			discordId: originalDiscordId,
			username: slot.discordUsername,
		});
		expect((await loadSlot(slot.slotId))?.user_id).toBe(
			await userIdForDiscord(originalDiscordId),
		);

		// Admin substitutes in a new (free-text) occupant — clears user_id +
		// discord_id so the new occupant claims at their next login.
		const newUsername = "subbed-new-occupant";
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/slots/${slot.slotId}`,
				as: t.admin,
				body: { discord_username: newUsername },
			}),
		);
		const afterSub = await loadSlot(slot.slotId);
		expect(afterSub?.user_id).toBeNull();
		expect(afterSub?.discord_id).toBeNull();
		expect(afterSub?.discord_username).toBe(newUsername);

		// Original user logs back in: their old username no longer matches and
		// the discord_id pin was cleared, so they cannot reclaim.
		await devLogin({
			discordId: originalDiscordId,
			username: slot.discordUsername,
		});
		expect((await loadSlot(slot.slotId))?.user_id).toBeNull();

		// The new user logs in by the substituted username and claims it.
		const newDiscordId = "2000000000000000004";
		await devLogin({ discordId: newDiscordId, username: newUsername });
		const claimed = await loadSlot(slot.slotId);
		expect(claimed?.user_id).toBe(await userIdForDiscord(newDiscordId));
		expect(claimed?.discord_id).toBe(newDiscordId);
	});

	it("does not auto-claim slots in a completed tournament", async () => {
		const t = await makeTournament();
		const slot = t.slotsByDivision.B[0];

		await env.SHARE_DB.prepare(
			"UPDATE tournaments SET status = 'complete' WHERE tournament_id = ?",
		)
			.bind(t.tournamentId)
			.run();

		const res = await devLogin({
			discordId: "2000000000000000005",
			username: slot.discordUsername,
		});
		// Login still succeeds (claim is fire-and-forget); the slot just isn't
		// claimed — both claim UPDATEs filter tournaments with status != 'complete'.
		expect(res.status).toBe(302);
		expect((await loadSlot(slot.slotId))?.user_id).toBeNull();
	});
});
