// Behavior tests for the "pre-link" path in POST /v1/tournaments/:id/slots:
// when the admin's request includes a user_id per slot (selected via the
// /v1/users/search autocomplete), the handler resolves the canonical
// discord_id + discord_username from the users table and creates a slot
// that's "claimed" from the start — no OAuth-callback round trip needed.
//
// Covers:
//   * Happy path: slot row has user_id, discord_id, discord_username populated
//   * Body's discord_username is IGNORED when user_id is present (canonical wins)
//   * Bogus user_id → 400 INVALID_USER_ID
//   * Existing slot username collision is detected via canonical name
//   * Free-text path (no user_id) still works unchanged

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface CreatedResponse {
	created: Array<{ slot_id: string; division: "A" | "B"; swiss_seed: number }>;
}

describe("POST /v1/tournaments/:id/slots — pre-link via user_id", () => {
	it("creates a slot with user_id, discord_id, canonical discord_username", async () => {
		const target = await makeUser({ discordUsername: "prelink-target" });
		const t = await makeTournament({ slotsPerDivision: 0 });

		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/slots`,
			as: t.admin,
			body: [
				{
					division: "A",
					discord_username: "prelink-target",
					user_id: target.userId,
				},
			],
		});
		const body = await expectOk<CreatedResponse>(res);
		expect(body.created.length).toBe(1);

		const row = await env.SHARE_DB.prepare(
			`SELECT user_id, discord_id, discord_username, phase, division
			 FROM tournament_slots WHERE slot_id = ?`,
		)
			.bind(body.created[0].slot_id)
			.first<{
				user_id: string;
				discord_id: string;
				discord_username: string;
				phase: string;
				division: string;
			}>();
		expect(row).toBeTruthy();
		expect(row!.user_id).toBe(target.userId);
		expect(row!.discord_id).toBe(target.discordId);
		expect(row!.discord_username).toBe("prelink-target");
		expect(row!.phase).toBe("swiss");
		expect(row!.division).toBe("A");
	});

	it("uses the canonical discord_username even when the body sends a different one", async () => {
		const target = await makeUser({ discordUsername: "canonical-handle" });
		const t = await makeTournament({ slotsPerDivision: 0 });

		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/slots`,
			as: t.admin,
			body: [
				{
					division: "A",
					// Body lies about the handle. Handler must override it.
					discord_username: "spoofed-handle",
					user_id: target.userId,
				},
			],
		});
		const body = await expectOk<CreatedResponse>(res);

		const row = await env.SHARE_DB.prepare(
			"SELECT discord_username FROM tournament_slots WHERE slot_id = ?",
		)
			.bind(body.created[0].slot_id)
			.first<{ discord_username: string }>();
		expect(row!.discord_username).toBe("canonical-handle");
	});

	it("returns 400 INVALID_USER_ID for a bogus user_id", async () => {
		const t = await makeTournament({ slotsPerDivision: 0 });

		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/slots`,
			as: t.admin,
			body: [
				{
					division: "A",
					discord_username: "anything",
					// 21-char shape but no such user.
					user_id: "AAAAAAAAAAAAAAAAAAAAA",
				},
			],
		});
		await expectErrorCode(res, { status: 400, code: "INVALID_USER_ID" });
	});

	it("detects dup against the canonical username, not the body's", async () => {
		// Existing slot with discord_username 'collide-test'. New slot with
		// a different body username but a user_id whose canonical handle is
		// 'collide-test' should 409.
		const target = await makeUser({ discordUsername: "collide-test" });
		const t = await makeTournament({ slotsPerDivision: 0 });

		// Seed an existing slot (free-text path) with the canonical handle.
		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/slots`,
				as: t.admin,
				body: [{ division: "A", discord_username: "collide-test" }],
			}),
		);

		// Now try to add the same user via user_id, lying about the handle.
		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/slots`,
			as: t.admin,
			body: [
				{
					division: "B",
					discord_username: "different-handle",
					user_id: target.userId,
				},
			],
		});
		await expectErrorCode(res, { status: 409, code: "DUPLICATE_USERNAME" });
	});

	it("free-text path (no user_id) is unchanged: slot row has user_id NULL", async () => {
		const t = await makeTournament({ slotsPerDivision: 0 });

		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/slots`,
			as: t.admin,
			body: [{ division: "A", discord_username: "freetext-only" }],
		});
		const body = await expectOk<CreatedResponse>(res);
		const row = await env.SHARE_DB.prepare(
			`SELECT user_id, discord_id, discord_username
			 FROM tournament_slots WHERE slot_id = ?`,
		)
			.bind(body.created[0].slot_id)
			.first<{
				user_id: string | null;
				discord_id: string | null;
				discord_username: string;
			}>();
		expect(row!.user_id).toBeNull();
		expect(row!.discord_id).toBeNull();
		expect(row!.discord_username).toBe("freetext-only");
	});

	it("rejects a batch with two slots sharing the same user_id", async () => {
		const target = await makeUser({ discordUsername: "same-user-twice" });
		const t = await makeTournament({ slotsPerDivision: 0 });

		// Both slots resolve to the same canonical username, so the existing
		// in-batch dup check catches it as DUPLICATE_USERNAME (400).
		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/slots`,
			as: t.admin,
			body: [
				{ division: "A", discord_username: "a", user_id: target.userId },
				{ division: "B", discord_username: "b", user_id: target.userId },
			],
		});
		await expectErrorCode(res, { status: 400, code: "DUPLICATE_USERNAME" });
	});
});
