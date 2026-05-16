// Behavior tests for GET /v1/users/me/admin-tournaments.
//
// Covers: auth required, empty-array for users with no admin rows,
// multi-tournament aggregation, response field shape.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

const EXPECTED_KEYS = ["name", "slug", "status", "tournament_id"].sort();

describe("GET /v1/users/me/admin-tournaments", () => {
	it("returns 401 to an unauthenticated request", async () => {
		const res = await request.get({ path: "/v1/users/me/admin-tournaments" });
		await expectErrorCode(res, { status: 401, code: "UNAUTHORIZED" });
	});

	it("returns an empty array for a user with no admin rows", async () => {
		const lonely = await makeUser();
		const res = await request.get({
			path: "/v1/users/me/admin-tournaments",
			as: lonely,
		});
		const body = await expectOk<{ tournaments: unknown[] }>(res);
		expect(body.tournaments).toEqual([]);
	});

	it("returns tournaments the caller admins across multiple", async () => {
		const admin = await makeUser({ discordUsername: "multi-admin" });
		const t1 = await makeTournament({ admin });
		const t2 = await makeTournament({ admin });
		// Third tournament administered by someone else — must not appear.
		await makeTournament();

		const res = await request.get({
			path: "/v1/users/me/admin-tournaments",
			as: admin,
		});
		const body = await expectOk<{
			tournaments: Array<Record<string, unknown>>;
		}>(res);

		expect(body.tournaments).toHaveLength(2);
		const ids = new Set(body.tournaments.map((t) => t.tournament_id));
		expect(ids).toEqual(new Set([t1.tournamentId, t2.tournamentId]));
	});

	it("does not return tournaments where the caller is only a slot owner", async () => {
		const player = await makeUser({ discordUsername: "player-only" });
		await makeTournament({ slotOwners: { A: [player] } });

		const res = await request.get({
			path: "/v1/users/me/admin-tournaments",
			as: player,
		});
		const body = await expectOk<{ tournaments: unknown[] }>(res);
		expect(body.tournaments).toEqual([]);
	});

	it("exposes exactly the fields handleMyAdminTournaments selects", async () => {
		const admin = await makeUser({ discordUsername: "shape-check-admin" });
		await makeTournament({ admin });

		const res = await request.get({
			path: "/v1/users/me/admin-tournaments",
			as: admin,
		});
		const body = await expectOk<{
			tournaments: Array<Record<string, unknown>>;
		}>(res);
		expect(body.tournaments).toHaveLength(1);
		expect(Object.keys(body.tournaments[0]).sort()).toEqual(EXPECTED_KEYS);
	});
});
