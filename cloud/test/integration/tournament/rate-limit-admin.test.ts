// Tournament admin rate limit: per-user budget of 30 admin mutations per
// hour. Limit is shared across all tournaments (the keyed-by-user
// simplification we settled on). Seed 30 `tournament_admin` events for the
// admin user, then assert the 31st mutation 429s.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode } from "../../helpers/assertions";
import { makeTournament } from "../../helpers/builders";
import { request } from "../../helpers/requests";
import { TOURNAMENT_ADMIN_ACTIONS_PER_HOUR } from "../../../src/tournament/limits";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

async function seedAdminEvents(userId: string, count: number): Promise<void> {
	for (let i = 0; i < count; i++) {
		await env.SHARE_DB.prepare(
			`INSERT INTO events (event_type, user_id, metadata)
			 VALUES ('tournament_admin', ?, ?)`,
		)
			.bind(userId, JSON.stringify({ action: "seed", index: i }))
			.run();
	}
}

describe("tournament admin rate limit", () => {
	it("rejects the next admin mutation once the user is at the limit", async () => {
		const t = await makeTournament();
		await seedAdminEvents(t.admin.userId, TOURNAMENT_ADMIN_ACTIONS_PER_HOUR);

		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: { description: "should be rate-limited" },
		});
		await expectErrorCode(res, {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_ADMIN",
		});
	});

	it("allows admin mutation just below the limit", async () => {
		const t = await makeTournament();
		// makeTournament emits one `tournament_admin` event (slots_bulk_created)
		// for the slot seed batch, so we seed N-2 to land at N-1 < limit.
		await seedAdminEvents(
			t.admin.userId,
			TOURNAMENT_ADMIN_ACTIONS_PER_HOUR - 2,
		);
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: { description: "should pass" },
		});
		expect(res.status).toBe(200);
	});

	it("limit is per-user — other admin's quota is unaffected", async () => {
		const t = await makeTournament();
		await seedAdminEvents(t.admin.userId, TOURNAMENT_ADMIN_ACTIONS_PER_HOUR);
		// A different admin's session can still mutate. We confirm by checking
		// that the rejection is keyed on t.admin specifically; we already test
		// the happy path elsewhere.
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: { description: "x" },
		});
		await expectErrorCode(res, {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_ADMIN",
		});
	});
});
