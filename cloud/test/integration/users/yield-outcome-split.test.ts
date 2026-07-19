// Regression pin for the yieldCurves winner/loser split.
//
// `player_summaries.is_winner` is NOT NULL DEFAULT FALSE, so a game that never
// resolved (nobody flagged a winner) is byte-identical to one everybody lost.
// The split therefore runs only over games with a winner row — otherwise an
// undecided game would be swept wholesale into the loser cohort and drag its
// median. These tests pin that exclusion and the cohorts' index alignment.

import { applyD1Migrations, env } from "cloudflare:test";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

type Band = { p25: (number | null)[]; p50: (number | null)[] };
type Cohort = {
	counts: number[];
	series: Record<string, { rate: Band; cumulative: Band }>;
};
type StatsBody = {
	yieldCurves: {
		turns: number[];
		counts: number[];
		series: Record<string, { rate: Band; cumulative: Band }>;
		outcome: { winners: Cohort; losers: Cohort } | null;
	};
};

// One uploader-owned game over `turns` turns. `winnerIndex` is the player
// flagged is_winner; pass null to leave the game undecided (every row 0).
// The uploader's science rate is `science`, flat across all turns.
async function seedGame(opts: {
	userId: string;
	science: number;
	turns: number;
	winnerIndex: 0 | 1 | null;
}): Promise<void> {
	const gameId = nanoid(21);
	await env.SHARE_DB.prepare(
		`INSERT INTO games (game_id, user_id, xml_game_id, total_turns,
		                    file_hash, is_public, parser_version, user_nation, user_won)
		 VALUES (?, ?, 'xml', ?, ?, 1, '2.9.1', 'NATION_ROME', ?)`,
	)
		.bind(
			gameId,
			opts.userId,
			opts.turns,
			nanoid(16),
			opts.winnerIndex === 0 ? 1 : 0,
		)
		.run();

	for (const idx of [0, 1] as const) {
		await env.SHARE_DB.prepare(
			`INSERT INTO player_summaries
			   (game_id, player_index, player_name, nation, is_human, is_uploader,
			    is_winner, final_points)
			 VALUES (?, ?, ?, 'NATION_ROME', 1, ?, ?, 100)`,
		)
			.bind(
				gameId,
				idx,
				`Player ${idx}`,
				idx === 0 ? 1 : 0,
				opts.winnerIndex === idx ? 1 : 0,
			)
			.run();
	}

	// Only the uploader (index 0) gets per-turn rows — the user corpus is
	// focal = "uploader", so that's the row the curves are built from.
	for (let turn = 1; turn <= opts.turns; turn++) {
		await env.SHARE_DB.prepare(
			`INSERT INTO game_player_turn (game_id, player_index, turn, science_per_turn)
			 VALUES (?, 0, ?, ?)`,
		)
			.bind(gameId, turn, opts.science)
			.run();
	}
}

async function getCurves(user: Awaited<ReturnType<typeof makeUser>>) {
	const body = await expectOk<StatsBody>(
		await request.get({ path: `/v1/users/${user.userId}/stats`, as: user }),
	);
	return body.yieldCurves;
}

describe("yieldCurves.outcome", () => {
	it("splits decided games into winner and loser cohorts", async () => {
		const user = await makeUser();
		await seedGame({
			userId: user.userId,
			science: 50,
			turns: 3,
			winnerIndex: 0,
		});
		await seedGame({
			userId: user.userId,
			science: 10,
			turns: 3,
			winnerIndex: 1,
		});

		const curves = await getCurves(user);
		expect(curves.outcome).not.toBeNull();

		const { winners, losers } = curves.outcome!;
		// The won game's uploader row is the winner cohort; the lost game's is
		// the loser cohort. Pooled median sits between them.
		expect(winners.series.science_per_turn.rate.p50[0]).toBe(50);
		expect(losers.series.science_per_turn.rate.p50[0]).toBe(10);
		expect(curves.series.science_per_turn.rate.p50[0]).toBe(30);
		expect(winners.counts[0]).toBe(1);
		expect(losers.counts[0]).toBe(1);
	});

	it("excludes undecided games from both cohorts but keeps them pooled", async () => {
		const user = await makeUser();
		await seedGame({
			userId: user.userId,
			science: 50,
			turns: 3,
			winnerIndex: 0,
		});
		// No winner row: without the guard this lands in `losers` and its 10
		// becomes the loser median.
		await seedGame({
			userId: user.userId,
			science: 10,
			turns: 3,
			winnerIndex: null,
		});

		const curves = await getCurves(user);
		const { winners, losers } = curves.outcome!;

		expect(winners.series.science_per_turn.rate.p50[0]).toBe(50);
		expect(winners.counts[0]).toBe(1);
		// The undecided game contributes to neither cohort...
		expect(losers.counts[0]).toBe(0);
		expect(losers.series.science_per_turn.rate.p50[0]).toBeNull();
		// ...but still counts toward the pooled curve.
		expect(curves.counts[0]).toBe(2);
		expect(curves.series.science_per_turn.rate.p50[0]).toBe(30);
	});

	it("is null when no game in the corpus has a winner", async () => {
		const user = await makeUser();
		await seedGame({
			userId: user.userId,
			science: 25,
			turns: 2,
			winnerIndex: null,
		});

		const curves = await getCurves(user);
		expect(curves.outcome).toBeNull();
		expect(curves.counts[0]).toBe(1);
	});

	it("aligns cohort arrays to the shared turn axis", async () => {
		const user = await makeUser();
		// Different lengths: the winner's game runs longer than the loser's, so
		// the loser cohort must pad with nulls rather than shift left.
		await seedGame({
			userId: user.userId,
			science: 50,
			turns: 5,
			winnerIndex: 0,
		});
		await seedGame({
			userId: user.userId,
			science: 10,
			turns: 2,
			winnerIndex: 1,
		});

		const curves = await getCurves(user);
		const { winners, losers } = curves.outcome!;
		const n = curves.turns.length;

		expect(n).toBe(5);
		for (const cohort of [winners, losers]) {
			expect(cohort.counts).toHaveLength(n);
			expect(cohort.series.science_per_turn.rate.p50).toHaveLength(n);
		}
		// Turn 3+ exists only in the winner's game.
		expect(losers.series.science_per_turn.rate.p50[2]).toBeNull();
		expect(winners.series.science_per_turn.rate.p50[4]).toBe(50);
	});
});
