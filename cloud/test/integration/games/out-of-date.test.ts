// Integration tests for GET /v1/games/out-of-date — the user-scoped,
// unpaginated list of games whose stored parser_version differs from the
// supplied current version. Drives the account-page bulk reparse, which must
// cover the user's whole library (the paginated GET /v1/games defaults to 50
// rows and so can't be used). Seeds games via direct INSERT so the suite stays
// focused on the handler's query, not the upload pipeline.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { expectOk } from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

async function seedGame(
	user: TestUser,
	parserVersion: string,
	gameName?: string,
): Promise<string> {
	const gameId = nanoid(21);
	await env.SHARE_DB.prepare(
		`INSERT INTO games (
			game_id, user_id, xml_game_id, total_turns, file_hash,
			game_name, is_public, blob_version, blob_size_bytes, parser_version
		) VALUES (?, ?, ?, ?, ?, ?, 0, 2, 1024, ?)`,
	)
		.bind(
			gameId,
			user.userId,
			nanoid(36),
			50,
			nanoid(64),
			gameName ?? null,
			parserVersion,
		)
		.run();
	return gameId;
}

interface OutOfDateResponse {
	games: { game_id: string; parser_version: string }[];
	total: number;
}

const CURRENT = "3.0.0";

describe("GET /v1/games/out-of-date", () => {
	it("requires authentication", async () => {
		const res = await request.get({
			path: `/v1/games/out-of-date?version=${CURRENT}`,
		});
		expect(res.status).toBe(401);
	});

	it("400s when ?version is missing", async () => {
		const user = await makeUser({ discordUsername: "ood-no-version" });
		const res = await request.get({ path: "/v1/games/out-of-date", as: user });
		expect(res.status).toBe(400);
	});

	it("returns every out-of-date game — no 50-row cap", async () => {
		const user = await makeUser({ discordUsername: "ood-no-cap" });
		// More than the GET /v1/games default page size, to prove this endpoint
		// isn't bounded by it (the bug this fixes: reparse only saw 50).
		for (let i = 0; i < 60; i++) {
			await seedGame(user, "2.5.0", `old-${i}`);
		}
		const body = await expectOk<OutOfDateResponse>(
			await request.get({
				path: `/v1/games/out-of-date?version=${CURRENT}`,
				as: user,
			}),
		);
		expect(body.games.length).toBe(60);
		expect(body.total).toBe(60);
		expect(body.games.every((g) => g.parser_version !== CURRENT)).toBe(true);
	});

	it("excludes games already on the current version", async () => {
		const user = await makeUser({ discordUsername: "ood-mixed" });
		await seedGame(user, "2.5.0", "old-a");
		await seedGame(user, "2.9.0", "old-b");
		await seedGame(user, CURRENT, "current-a");
		await seedGame(user, CURRENT, "current-b");

		const body = await expectOk<OutOfDateResponse>(
			await request.get({
				path: `/v1/games/out-of-date?version=${CURRENT}`,
				as: user,
			}),
		);
		expect(body.total).toBe(2);
		expect(body.games.every((g) => g.parser_version !== CURRENT)).toBe(true);
	});

	it("scopes to the session user's own games", async () => {
		const owner = await makeUser({ discordUsername: "ood-owner" });
		const other = await makeUser({ discordUsername: "ood-other" });
		await seedGame(owner, "2.5.0", "owner-old");
		await seedGame(other, "2.5.0", "other-old");

		const body = await expectOk<OutOfDateResponse>(
			await request.get({
				path: `/v1/games/out-of-date?version=${CURRENT}`,
				as: owner,
			}),
		);
		expect(body.total).toBe(1);
	});
});
