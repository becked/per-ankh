// `winningSeats` / `winnerTileLabel`, which live in the SvelteKit tree at
// src/lib/winning-team.ts.
//
// Why the test is here and not beside the module: the frontend has no test
// runner, and the module is the one answer both packages read — the Worker's
// `games.user_won` / `player_summaries.is_winner`, the upload picker, the game
// page's Winner card and Nations badges, and both renderings of the
// link-preview card. Same reach free-specialists.test.ts already makes.
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
import { winnerTileLabel, winningSeats } from "../../src/lib/winning-team";

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

describe("winnerTileLabel", () => {
	const seat = (player_name: string, nation: string, is_winner: boolean) => ({
		player_name,
		nation,
		is_winner,
	});

	it("names the leader and nation for a single winner", () => {
		expect(
			winnerTileLabel({
				winner_name: "Scipio",
				winner_nation: "NATION_ROME",
				players: [
					seat("Scipio", "NATION_ROME", true),
					seat("Hanno", "NATION_CARTHAGE", false),
				],
			}),
		).toBe("Scipio (Rome)");
	});

	it("names the nations alone for a team win", () => {
		// Two leader names do not fit the hard-clipped tile; which nations won
		// is what it carries. `winner_name` / `winner_nation` still name the
		// representative seat and are ignored here.
		expect(
			winnerTileLabel({
				winner_name: "Juljette",
				winner_nation: "NATION_AKSUM",
				players: [
					seat("Juljette", "NATION_AKSUM", true),
					seat("Larrrik", "NATION_BABYLONIA", true),
					seat("ShaunMcNamee", "NATION_HITTITE", false),
					seat("professorcurly", "NATION_KUSH", false),
				],
			}),
		).toBe("Aksum + Babylonia");
	});

	it("falls back to the nation when the save wrote no leader name", () => {
		// Old World writes "" for a solo save whose player never named a
		// leader, which the Worker stores as a NULL winner_name.
		expect(
			winnerTileLabel({
				winner_name: null,
				winner_nation: "NATION_ROME",
				players: [{ player_name: "", nation: "NATION_ROME", is_winner: true }],
			}),
		).toBe("Rome");
	});

	it("is a dash for a game with no recorded winner", () => {
		expect(
			winnerTileLabel({
				winner_name: null,
				winner_nation: null,
				players: [seat("Scipio", "NATION_ROME", false)],
			}),
		).toBe("—");
	});

	it("keeps the single-winner form when a team winner has no nation", () => {
		// A seat the save wrote no `Nation` for cannot be named by nation, so
		// the team form has nothing to join and the representative seat stands.
		expect(
			winnerTileLabel({
				winner_name: "Juljette",
				winner_nation: null,
				players: [
					{ player_name: "Juljette", nation: null, is_winner: true },
					{ player_name: "Larrrik", nation: null, is_winner: true },
				],
			}),
		).toBe("—");
	});
});
