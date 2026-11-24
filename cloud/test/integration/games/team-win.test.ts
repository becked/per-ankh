// A team game's win reaches every seat on the winning team.
//
// Old World decides a win per team: `Game.isWinnerTeam(TeamType)`
// (`Game.cs:4541`) is the predicate and `writeGameXML` persists a team id
// (`Game.cs:1298`). The blob resolves that team to the LOWEST seat on it, so
// `games.user_won` and `player_summaries.is_winner` used to be set on that one
// seat and every teammate was recorded as a loss (#384). The uploader of
// `UZo0UBaq0k61mVD8gVBtq` reported it: a 2v2 he won, shown as a loss with his
// teammate named the winner.
//
// The two rows here are the ones the reported surfaces are drawn from —
// `games.user_won` behind the result chip and the row subtitle,
// `player_summaries.is_winner` behind the featured seat and the winner tile on
// both renderings of the link-preview card.
//
// The second case is the reason the fallback exists. A blob below PARSER_VERSION
// 2.31.0 carries no `team_id` at all, and a reparse of the whole corpus is not
// instant, so an un-reparsed team game has to keep answering exactly what it
// answered before — the one resolved seat — rather than changing to something
// else wrong.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeUser } from "../../helpers/builders";
import { postMultipart } from "../../helpers/requests";
import { buildUploadFormData } from "../../helpers/save-blob";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// A 2v2: seats 0 and 1 on team 0, seats 2 and 3 on team 1. Team 0 wins, and
// `resolveWinner`'s `indexOf` resolves it to seat 0 — so seat 1 is the seat
// the defect was reported from.
const TEAMS_2V2 = [0, 0, 1, 1];

async function uploadTeamGame(opts: {
	as: { sessionToken: string };
	uploaderIndex: number;
	teams?: readonly number[];
}): Promise<string> {
	const form = await buildUploadFormData({
		winnerIndex: 0,
		humans: 4,
		uploaderIndex: opts.uploaderIndex,
		parserVersion: "2.31.0",
		...(opts.teams ? { teams: opts.teams } : {}),
	});
	const { game_id } = await expectOk<{ game_id: string }>(
		await postMultipart({ path: "/v1/games", form, as: opts.as }),
	);
	return game_id;
}

async function loadUserWon(gameId: string): Promise<number | null> {
	const row = await env.SHARE_DB.prepare(
		"SELECT user_won FROM games WHERE game_id = ?",
	)
		.bind(gameId)
		.first<{ user_won: number | null }>();
	return row?.user_won ?? null;
}

// Every seat's is_winner, in seat order.
async function loadIsWinner(gameId: string): Promise<number[]> {
	const rows = await env.SHARE_DB.prepare(
		`SELECT is_winner FROM player_summaries
		 WHERE game_id = ? ORDER BY player_index`,
	)
		.bind(gameId)
		.all<{ is_winner: number }>();
	return (rows.results ?? []).map((r) => r.is_winner);
}

describe("POST /v1/games for a team game", () => {
	it("flags every seat on the winning team, not just the resolved one", async () => {
		const owner = await makeUser({ discordUsername: "team-winner" });
		// Seat 1 — a winner the blob does not name.
		const gameId = await uploadTeamGame({
			as: owner,
			uploaderIndex: 1,
			teams: TEAMS_2V2,
		});

		expect(await loadIsWinner(gameId)).toEqual([1, 1, 0, 0]);
		expect(await loadUserWon(gameId)).toBe(1);
	});

	it("leaves the losing team's seats alone", async () => {
		const owner = await makeUser({ discordUsername: "team-loser" });
		const gameId = await uploadTeamGame({
			as: owner,
			uploaderIndex: 2,
			teams: TEAMS_2V2,
		});

		expect(await loadIsWinner(gameId)).toEqual([1, 1, 0, 0]);
		expect(await loadUserWon(gameId)).toBe(0);
	});

	it("keeps the single resolved seat for a blob with no team ids", async () => {
		const owner = await makeUser({ discordUsername: "pre-bump" });
		const gameId = await uploadTeamGame({ as: owner, uploaderIndex: 1 });

		expect(await loadIsWinner(gameId)).toEqual([1, 0, 0, 0]);
		expect(await loadUserWon(gameId)).toBe(0);
	});
});
