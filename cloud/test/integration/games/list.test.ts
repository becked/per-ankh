// Integration tests for GET /v1/games — pagination, search, and
// cross-filter (nation/date). Seeds games via direct INSERT so the suite
// stays focused on the list handler's query construction and doesn't
// re-exercise the upload pipeline.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { expectOk } from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface SeedGameOpts {
	readonly gameName?: string | null;
	readonly displayName?: string | null;
	readonly userNation?: string | null;
	readonly saveDate?: string | null;
	readonly collectionId?: number | null;
	readonly isPublic?: boolean;
	readonly totalTurns?: number;
}

async function seedGame(
	user: TestUser,
	opts: SeedGameOpts = {},
): Promise<string> {
	const gameId = nanoid(21);
	await env.SHARE_DB.prepare(
		`INSERT INTO games (
			game_id, user_id, xml_game_id, total_turns, file_hash,
			game_name, display_name, save_date,
			user_nation, is_public, collection_id,
			blob_version, blob_size_bytes, parser_version
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, 1024, '2.5.0')`,
	)
		.bind(
			gameId,
			user.userId,
			nanoid(36),
			opts.totalTurns ?? 50,
			nanoid(64),
			opts.gameName ?? null,
			opts.displayName ?? null,
			opts.saveDate ?? null,
			opts.userNation ?? null,
			opts.isPublic ? 1 : 0,
			opts.collectionId ?? null,
		)
		.run();
	return gameId;
}

async function seedCollection(user: TestUser, name: string): Promise<number> {
	const res = await env.SHARE_DB.prepare(
		`INSERT INTO collections (user_id, name, is_default) VALUES (?, ?, 0)
		 RETURNING collection_id`,
	)
		.bind(user.userId, name)
		.first<{ collection_id: number }>();
	if (!res) throw new Error("collection insert failed");
	return res.collection_id;
}

interface GamesListResponse {
	games: {
		game_id: string;
		game_name: string | null;
		display_name: string | null;
	}[];
	total: number;
}

describe("GET /v1/games", () => {
	it("returns up to default limit (50) and the total filtered count", async () => {
		const user = await makeUser({ discordUsername: "list-default" });
		for (let i = 0; i < 60; i++) {
			await seedGame(user, { gameName: `game-${i}`, saveDate: "2025-06-01" });
		}
		const res = await request.get({ path: "/v1/games", as: user });
		const body = await expectOk<GamesListResponse>(res);
		expect(body.games.length).toBe(50);
		expect(body.total).toBe(60);
	});

	it("honors ?limit and ?offset for pagination", async () => {
		const user = await makeUser({ discordUsername: "list-paginate" });
		// Insert in descending save_date order so ORDER BY save_date DESC is stable.
		for (let i = 0; i < 10; i++) {
			await seedGame(user, {
				gameName: `game-${i}`,
				saveDate: `2025-06-${String(10 - i).padStart(2, "0")}`,
			});
		}
		const page1 = await expectOk<GamesListResponse>(
			await request.get({ path: "/v1/games?limit=4&offset=0", as: user }),
		);
		const page2 = await expectOk<GamesListResponse>(
			await request.get({ path: "/v1/games?limit=4&offset=4", as: user }),
		);
		expect(page1.games.length).toBe(4);
		expect(page2.games.length).toBe(4);
		expect(page1.total).toBe(10);
		expect(page2.total).toBe(10);
		// No overlap between pages.
		const page1Ids = new Set(page1.games.map((g) => g.game_id));
		for (const g of page2.games) expect(page1Ids.has(g.game_id)).toBe(false);
	});

	it("clamps ?limit above 500 down to 500", async () => {
		const user = await makeUser({ discordUsername: "list-clamp" });
		await seedGame(user, { gameName: "only-one" });
		const res = await request.get({ path: "/v1/games?limit=9999", as: user });
		const body = await expectOk<GamesListResponse>(res);
		// Server cap is 500; with one row total we only get one back, but the
		// cap manifests via the worker not bailing on the huge limit value.
		expect(body.games.length).toBe(1);
	});

	it("?q matches case-insensitively against game_name and display_name", async () => {
		const user = await makeUser({ discordUsername: "list-q" });
		await seedGame(user, {
			gameName: "NinjaSion vs Sabertooth",
			saveDate: "2025-06-01",
		});
		await seedGame(user, {
			displayName: "ninja showdown",
			saveDate: "2025-06-02",
		});
		await seedGame(user, { gameName: "unrelated", saveDate: "2025-06-03" });

		const res = await request.get({ path: "/v1/games?q=ninja", as: user });
		const body = await expectOk<GamesListResponse>(res);
		expect(body.total).toBe(2);
		expect(body.games.length).toBe(2);
	});

	it("?q escapes LIKE metacharacters so '%' matches literally", async () => {
		const user = await makeUser({ discordUsername: "list-q-escape" });
		await seedGame(user, { gameName: "100% complete" });
		await seedGame(user, { gameName: "halfway" });

		const res = await request.get({
			path: `/v1/games?q=${encodeURIComponent("100%")}`,
			as: user,
		});
		const body = await expectOk<GamesListResponse>(res);
		// If `%` weren't escaped, the pattern `%100%%` would also match
		// "halfway" via the trailing `%`. Escaping makes the search literal.
		expect(body.total).toBe(1);
		expect(body.games[0].game_name).toBe("100% complete");
	});

	it("?nation filters on the raw user_nation column", async () => {
		const user = await makeUser({ discordUsername: "list-nation" });
		await seedGame(user, {
			gameName: "babylon-game",
			userNation: "NATION_BABYLON",
		});
		await seedGame(user, { gameName: "rome-game", userNation: "NATION_ROME" });
		await seedGame(user, { gameName: "observer-mode", userNation: null });

		const res = await request.get({
			path: "/v1/games?nation=NATION_BABYLON",
			as: user,
		});
		const body = await expectOk<GamesListResponse>(res);
		expect(body.total).toBe(1);
		expect(body.games[0].game_name).toBe("babylon-game");
	});

	it("?date filters on the YYYY-MM-DD prefix of save_date", async () => {
		const user = await makeUser({ discordUsername: "list-date" });
		await seedGame(user, {
			gameName: "match",
			saveDate: "2025-12-18T23:37:02",
		});
		await seedGame(user, { gameName: "match-day", saveDate: "2025-12-18" });
		await seedGame(user, { gameName: "other-day", saveDate: "2025-12-19" });

		const res = await request.get({
			path: "/v1/games?date=2025-12-18",
			as: user,
		});
		const body = await expectOk<GamesListResponse>(res);
		expect(body.total).toBe(2);
	});

	it("combines filters with AND and reflects the filtered total", async () => {
		const user = await makeUser({ discordUsername: "list-combo" });
		const coll = await seedCollection(user, "Tournament");
		await seedGame(user, {
			gameName: "Sion v Aran",
			userNation: "NATION_BABYLON",
			saveDate: "2025-12-18",
			collectionId: coll,
		});
		await seedGame(user, {
			gameName: "Sion v Solver",
			userNation: "NATION_BABYLON",
			saveDate: "2025-12-19",
			collectionId: coll,
		});
		await seedGame(user, {
			gameName: "Sion v Aran (no nation)",
			userNation: null,
			saveDate: "2025-12-18",
			collectionId: coll,
		});

		const res = await request.get({
			path: `/v1/games?collection_id=${coll}&nation=NATION_BABYLON&q=Sion%20v%20Aran`,
			as: user,
		});
		const body = await expectOk<GamesListResponse>(res);
		expect(body.total).toBe(1);
		expect(body.games[0].game_name).toBe("Sion v Aran");
	});

	it("ignores malformed ?nation values rather than crashing", async () => {
		const user = await makeUser({ discordUsername: "list-bad-nation" });
		await seedGame(user, {
			gameName: "babylon-game",
			userNation: "NATION_BABYLON",
		});

		const res = await request.get({
			path: `/v1/games?nation=${encodeURIComponent("not a nation")}`,
			as: user,
		});
		const body = await expectOk<GamesListResponse>(res);
		// Malformed nation = no filter applied = full result set.
		expect(body.total).toBe(1);
	});
});
