// Content-Type hardening for admin JSON endpoints (security review F-04
// defense-in-depth). All POST/PATCH handlers that decode a JSON body go
// through `parseJsonBody`, which now refuses anything other than
// `application/json` with a 415.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament } from "../../helpers/builders";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

describe("Content-Type enforcement on admin JSON endpoints", () => {
	it("rejects POST with text/plain Content-Type as 415", async () => {
		const t = await makeTournament();
		const res = await SELF.fetch(
			`http://test/v1/tournaments/${t.tournamentId}/slots`,
			{
				method: "POST",
				headers: {
					Origin: "http://localhost:1420",
					Cookie: `session=${t.admin.sessionToken}`,
					"Content-Type": "text/plain",
				},
				body: JSON.stringify([{ division: "A", discord_username: "x" }]),
			},
		);
		await expectErrorCode(res, { status: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
	});

	it("rejects POST with no Content-Type as 415", async () => {
		const t = await makeTournament();
		const res = await SELF.fetch(
			`http://test/v1/tournaments/${t.tournamentId}/slots`,
			{
				method: "POST",
				headers: {
					Origin: "http://localhost:1420",
					Cookie: `session=${t.admin.sessionToken}`,
				},
				body: JSON.stringify([{ division: "A", discord_username: "x" }]),
			},
		);
		await expectErrorCode(res, { status: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
	});

	it("accepts POST with application/json Content-Type", async () => {
		const t = await makeTournament();
		const res = await SELF.fetch(
			`http://test/v1/tournaments/${t.tournamentId}/slots`,
			{
				method: "POST",
				headers: {
					Origin: "http://localhost:1420",
					Cookie: `session=${t.admin.sessionToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify([
					{ division: "A", discord_username: "ct_test_user" },
				]),
			},
		);
		await expectOk(res);
	});

	it("accepts POST with application/json; charset=utf-8 (params after the base type)", async () => {
		const t = await makeTournament();
		const res = await SELF.fetch(
			`http://test/v1/tournaments/${t.tournamentId}/slots`,
			{
				method: "POST",
				headers: {
					Origin: "http://localhost:1420",
					Cookie: `session=${t.admin.sessionToken}`,
					"Content-Type": "application/json; charset=utf-8",
				},
				body: JSON.stringify([
					{ division: "A", discord_username: "ct_test_user2" },
				]),
			},
		);
		await expectOk(res);
	});
});
