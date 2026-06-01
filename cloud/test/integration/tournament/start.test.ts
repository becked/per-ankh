// Start-transition error contracts. The happy path (setup → swiss + round 1)
// is covered by flow.test.ts; this pins the map-pool corruption case:
// parseMapPool throws MapConfigError on a structurally bad map_pool column,
// which parseMapPoolOrError surfaces as a 500 MAP_CONFIG_INVALID on the
// /start request path (cloud/src/tournament/admin.ts handleStartTournament).
//
// The corruption is only reachable via direct-DB tampering — schema-validated
// writes always produce a well-formed pool — so the test corrupts the column
// directly, the same way production would have to be broken to hit it.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode } from "../../helpers/assertions";
import { makeTournament } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

async function corruptMapPool(
	tournamentId: string,
	value: string,
): Promise<void> {
	await env.SHARE_DB.prepare(
		"UPDATE tournaments SET map_pool = ? WHERE tournament_id = ?",
	)
		.bind(value, tournamentId)
		.run();
}

describe("POST /v1/tournaments/:id/start map-pool validation", () => {
	it("rejects 500 MAP_CONFIG_INVALID when map_pool is not valid JSON", async () => {
		const t = await makeTournament({ slotsPerDivision: 4 });
		await corruptMapPool(t.tournamentId, "not json");

		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/start`,
			as: t.admin,
		});
		await expectErrorCode(res, { status: 500, code: "MAP_CONFIG_INVALID" });

		// No transition — the tournament is still in setup.
		expect((await t.refresh()).status).toBe("setup");
	});

	it("rejects 500 MAP_CONFIG_INVALID when map_pool is valid JSON but not an array", async () => {
		const t = await makeTournament({ slotsPerDivision: 4 });
		await corruptMapPool(t.tournamentId, "{}");

		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/start`,
			as: t.admin,
		});
		await expectErrorCode(res, { status: 500, code: "MAP_CONFIG_INVALID" });
		expect((await t.refresh()).status).toBe("setup");
	});
});
