// Regression pin for the user /stats endpoint's focal = "uploader" behavior,
// which the tournament-stats work threaded a focal parameter through. The user
// corpus must still count ONLY the uploader's own row per game (not every human)
// and still carry the Overview fields (win_rate, games_with_outcome,
// summary.top_nation) that the tournament core omits.

import { applyD1Migrations, env } from "cloudflare:test";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// A game owned by `userId` with two human players: the uploader (index 0, won)
// and an opponent (index 1). The opponent is a real is_human row, so a "humans"
// focal would count it — the user path must not.
async function seedGame(
	userId: string,
	nations: [string, string],
): Promise<void> {
	const gameId = nanoid(21);
	await env.SHARE_DB.prepare(
		`INSERT INTO games (game_id, user_id, xml_game_id, total_turns,
		                    file_hash, is_public, parser_version, user_nation, user_won)
		 VALUES (?, ?, 'xml', 60, ?, 1, '2.9.1', ?, 1)`,
	)
		.bind(gameId, userId, nanoid(16), nations[0])
		.run();
	for (const idx of [0, 1] as const) {
		await env.SHARE_DB.prepare(
			`INSERT INTO player_summaries
			   (game_id, player_index, player_name, nation, is_human, is_uploader,
			    is_winner, final_points)
			 VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
		)
			.bind(
				gameId,
				idx,
				`Player ${idx}`,
				nations[idx],
				idx === 0 ? 1 : 0, // uploader = index 0
				idx === 0 ? 1 : 0, // uploader won
				120 + idx * 10,
			)
			.run();
	}
}

describe("GET /v1/users/:user_id/stats (focal = uploader, unchanged)", () => {
	it("counts only the uploader row and keeps the Overview fields", async () => {
		const user = await makeUser();
		await seedGame(user.userId, ["NATION_ROME", "NATION_PERSIA"]);

		const body = await expectOk<{
			meta: { game_count: number };
			summary: { top_nation: { nation: string } | null };
			win_rate: number | null;
			games_with_outcome: number;
			nationWinRate: Array<{ nation: string; games: number; wins: number }>;
		}>(
			await request.get({
				path: `/v1/users/${user.userId}/stats`,
				as: user,
			}),
		);

		expect(body.meta.game_count).toBe(1);

		// Uploader-only: just the uploader's nation, not the opponent's.
		const byNation = new Map(body.nationWinRate.map((r) => [r.nation, r]));
		expect(byNation.get("NATION_ROME")).toMatchObject({ games: 1, wins: 1 });
		expect(byNation.has("NATION_PERSIA")).toBe(false);

		// Overview fields present and correct (one self row per game → ~100%,
		// not the ~50%-by-construction a widened 1v1 corpus would produce).
		expect(body.win_rate).toBe(1);
		expect(body.games_with_outcome).toBe(1);
		expect(body.summary.top_nation?.nation).toBe("NATION_ROME");
	});
});
