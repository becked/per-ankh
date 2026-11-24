// `winningSeats`, which lives in the SvelteKit tree at
// src/lib/winning-team.ts.
//
// Why the test is here and not beside the module: the frontend has no test
// runner, and the module is the one answer both packages read — the Worker's
// `games.user_won` and `player_summaries.is_winner`, and the frontend's upload
// picker. Same reach free-specialists.test.ts already makes.
//
// What is worth pinning is the FALLBACK, not the happy path. Old World decides
// a win per team and the blob resolves it to the lowest seat on the winning
// team, so a seat compared against that id alone reads as a loss (#384). The
// cases below are the four shapes the blob arrives in: a team the roster can
// name, a team it cannot, no team at all, and a roster from before team ids
// were parsed. The last three must all keep answering what the single
// resolved id answered, because a blob only gets a team id by being reparsed
// and nothing may change outcome while that is in flight.
import { describe, expect, it } from "vitest";
import { winningSeats } from "../../src/lib/winning-team";

// The issue's worked case: a 2v2 where Juljette (seat 0) and Larrrik (seat 1)
// share team 0, and `resolveWinner`'s `indexOf` picks seat 0.
const TEAM_2V2 = [
	{ player_index: 0, team_id: 0 },
	{ player_index: 1, team_id: 0 },
	{ player_index: 2, team_id: 1 },
	{ player_index: 3, team_id: 1 },
];

const DUEL = [
	{ player_index: 0, team_id: 0 },
	{ player_index: 1, team_id: 1 },
];

describe("winningSeats", () => {
	it("names every seat on the winning team", () => {
		const seats = winningSeats(
			{ winner_player_xml_id: 0, winner_team_id: 0 },
			TEAM_2V2,
		);
		expect([...seats]).toEqual([0, 1]);
	});

	it("names one seat when every team holds one player", () => {
		const seats = winningSeats(
			{ winner_player_xml_id: 1, winner_team_id: 1 },
			DUEL,
		);
		expect([...seats]).toEqual([1]);
	});

	it("is empty for a game that recorded no winner", () => {
		expect(winningSeats(null, TEAM_2V2).size).toBe(0);
		expect(winningSeats(undefined, TEAM_2V2).size).toBe(0);
	});

	it("falls back to the resolved seat when the winner carries no team", () => {
		// The `<Victory winner="…">` root form names a player and no team.
		const seats = winningSeats(
			{ winner_player_xml_id: 1, winner_team_id: null },
			TEAM_2V2,
		);
		expect([...seats]).toEqual([1]);
	});

	it("falls back to the resolved seat on a roster with no team ids", () => {
		// Every blob below PARSER_VERSION 2.31.0. Its answer must not move
		// before it is reparsed.
		const seats = winningSeats({ winner_player_xml_id: 0, winner_team_id: 0 }, [
			{ player_index: 0 },
			{ player_index: 1 },
		]);
		expect([...seats]).toEqual([0]);
	});

	it("falls back to the resolved seat when no roster entry is on that team", () => {
		// `resolveWinner`'s two later strategies can name a seat for a team the
		// `<Team><PlayerTeam>` list doesn't hold. An empty set would read as
		// "nobody won"; the resolved seat is what the blob actually claims.
		const seats = winningSeats(
			{ winner_player_xml_id: 0, winner_team_id: 7 },
			TEAM_2V2,
		);
		expect([...seats]).toEqual([0]);
	});
});
