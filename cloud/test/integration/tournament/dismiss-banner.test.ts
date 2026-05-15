// Behavior tests for POST /v1/users/me/tournaments/:id/dismiss-banner.
//
// Covers:
//   #24  404 when the caller has no slot in the tournament. First dismiss
//        returns 200/dismissed=1; subsequent calls return 200/dismissed=0
//        (idempotent).

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

describe("POST /v1/users/me/tournaments/:id/dismiss-banner", () => {
	it("returns 401 to an unauthenticated request", async () => {
		const t = await makeTournament();
		const res = await request.post({
			path: `/v1/users/me/tournaments/${t.tournamentId}/dismiss-banner`,
		});
		await expectErrorCode(res, { status: 401, code: "UNAUTHORIZED" });
	});

	it("returns 404 when the caller has no slot in the tournament", async () => {
		const stranger = await makeUser();
		const t = await makeTournament();

		const res = await request.post({
			path: `/v1/users/me/tournaments/${t.tournamentId}/dismiss-banner`,
			as: stranger,
		});
		await expectErrorCode(res, { status: 404, code: "NO_SLOT_IN_TOURNAMENT" });
	});

	it("dismisses on first call (dismissed=1) and is idempotent on second (dismissed=0)", async () => {
		const player = await makeUser({ discordUsername: "dismiss-test-player" });
		const t = await makeTournament({
			slotsPerDivision: 4,
			slotOwners: { A: [player] },
		});

		const first = await request.post({
			path: `/v1/users/me/tournaments/${t.tournamentId}/dismiss-banner`,
			as: player,
		});
		const firstBody = await expectOk<{ dismissed: number }>(first);
		expect(firstBody.dismissed).toBe(1);

		const second = await request.post({
			path: `/v1/users/me/tournaments/${t.tournamentId}/dismiss-banner`,
			as: player,
		});
		const secondBody = await expectOk<{ dismissed: number }>(second);
		expect(secondBody.dismissed).toBe(0);
	});
});
