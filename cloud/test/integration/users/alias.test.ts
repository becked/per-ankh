// Behavior tests for the operator display alias (users.alias). When set, it
// overrides display_name everywhere the API renders a user's name; resolution
// is server-side via COALESCE(alias, display_name) — see cloud/src/identity.ts.
// The alias column is operator-set (admin CLI); these tests write it directly,
// mirroring `./per-ankh admin set-alias`.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import {
	makeTournament,
	makeUser,
	type TestUser,
} from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

async function setAlias(user: TestUser, alias: string | null): Promise<void> {
	await env.SHARE_DB.prepare(`UPDATE users SET alias = ? WHERE user_id = ?`)
		.bind(alias, user.userId)
		.run();
}

interface ProfileResponse {
	user_id: string;
	display_name: string;
}

describe("users.alias — profile endpoint", () => {
	it("overrides display_name when set, and reverts when cleared", async () => {
		const u = await makeUser({ displayName: "Real Name" });

		const before = await expectOk<ProfileResponse>(
			await request.get({ path: `/v1/users/${u.userId}` }),
		);
		expect(before.display_name).toBe("Real Name");

		await setAlias(u, "Aliased");
		const aliased = await expectOk<ProfileResponse>(
			await request.get({ path: `/v1/users/${u.userId}` }),
		);
		expect(aliased.display_name).toBe("Aliased");

		await setAlias(u, null);
		const reverted = await expectOk<ProfileResponse>(
			await request.get({ path: `/v1/users/${u.userId}` }),
		);
		expect(reverted.display_name).toBe("Real Name");
	});
});

interface SearchResponse {
	users: Array<{ user_id: string; display_name: string }>;
}

describe("users.alias — search endpoint", () => {
	it("matches a user by alias text and returns the alias as display_name", async () => {
		const caller = await makeUser();
		const target = await makeUser({ displayName: "Display Only" });
		// Distinct prefix so the query targets this user specifically.
		await setAlias(target, "Zaliasname");

		const body = await expectOk<SearchResponse>(
			await request.get({ path: "/v1/users/search?q=zalias", as: caller }),
		);
		const hit = body.users.find((x) => x.user_id === target.userId);
		expect(hit).toBeTruthy();
		expect(hit!.display_name).toBe("Zaliasname");
	});
});

interface StandingsResponse {
	divisions: {
		A: { standings: Array<{ slot_id: string; display_name: string | null }> };
		B: { standings: Array<{ slot_id: string; display_name: string | null }> };
	};
}

describe("users.alias — tournament standings", () => {
	it("renders the alias for a claimed slot's occupant", async () => {
		const owner = await makeUser({ displayName: "Owner Real" });
		const t = await makeTournament({
			slotOwners: { A: [owner] },
			advanceTo: "swiss-round-1-generated",
		});
		await setAlias(owner, "OwnerAlias");

		const slot = t.slotsByDivision.A.find(
			(s) => s.owner?.userId === owner.userId,
		);
		expect(slot).toBeTruthy();

		// Tournament reads are beta-gated (non-members 404); call as a beta user.
		const body = await expectOk<StandingsResponse>(
			await request.get({
				path: `/v1/tournaments/${t.tournamentId}/standings`,
				as: owner,
			}),
		);
		const entry = body.divisions.A.standings.find(
			(e) => e.slot_id === slot!.slotId,
		);
		expect(entry).toBeTruthy();
		expect(entry!.display_name).toBe("OwnerAlias");
	});
});
