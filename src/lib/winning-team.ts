// Who won a game — the one answer every outcome test and winner label reads.
//
// Old World decides a win per TEAM, not per player. `Game.isWinnerTeam`
// (`Game.cs:4541`) tests a `TeamType` against `mdTeamVictory`,
// `Player.updatePlayerDead` asks it as `game().isWinnerTeam(getTeam())`
// (`Player.cs:6695`), and `Game.writeGameXML` persists the winning *team* id
// (`Game.cs:1298`) — no player id is written. `Player.getTeam()`
// (`Player.cs:7386`) reads `lPlayerParameters[player].Team`, which is the
// `<Team><PlayerTeam>` setup list (`GameParameters.cs:666`) the parser keeps as
// `PlayerRosterEntry.team_id`.
//
// `MatchMetadata.winner` collapses that team to one seat — the lowest player
// index on it — so comparing a seat against `winner_player_xml_id` alone marks
// every other teammate a loser (#384). Compare against this module instead.

import { nationName } from "./utils/formatting";

/** The blob's resolved winner, as `MatchMetadata.winner` carries it. */
export interface WinnerRecord {
	winner_player_xml_id: number;
	// Optional because the subset types the call sites pass are structural;
	// `WinnerInfo` itself always carries it. Null for the `<Victory winner>`
	// root form, which names a player and no team.
	winner_team_id?: number | null;
}

/** A roster seat, as `PlayerRosterEntry` carries it. */
export interface RosterSeat {
	player_index: number;
	// Absent on a blob parsed before PARSER_VERSION 2.31.0.
	team_id?: number | null;
}

/**
 * Every seat on the winning team, by player index. Empty when the game
 * recorded no winner.
 *
 * Falls back to the single resolved seat when the blob cannot name the team —
 * no `winner_team_id` (the `<Victory winner>` form), a pre-2.31.0 blob whose
 * roster carries no `team_id`, or a winner the two fallback strategies in
 * `resolveWinner` picked without a matching `<PlayerTeam>` entry. That
 * fallback is today's behaviour, and it is the correct reading of every
 * one-player-per-team game, so an un-reparsed blob keeps the answer it has.
 */
export function winningSeats(
	winner: WinnerRecord | null | undefined,
	roster: readonly RosterSeat[],
): ReadonlySet<number> {
	if (!winner) return new Set();
	const team = winner.winner_team_id;
	if (team == null) return new Set([winner.winner_player_xml_id]);
	const mates = roster
		.filter((p) => p.team_id === team)
		.map((p) => p.player_index);
	return mates.length > 0
		? new Set(mates)
		: new Set([winner.winner_player_xml_id]);
}

/** A game row + roster as the two link-preview card surfaces read it. */
export interface WinnerTileGame {
	winner_name: string | null;
	winner_nation: string | null;
	players: readonly {
		player_name: string;
		nation: string | null;
		is_winner: boolean;
	}[];
}

/**
 * The "Winner" stat-tile value, shared by the home feed's card
 * (`RecentSaveCard.svelte`) and the Worker's rendering of the same card
 * (`cloud/src/og-card/card-svg.ts`) so the two cannot drift.
 *
 * One winner reads "<leader name> (<Nation>)", falling back to the nation
 * alone and then a dash. A team win names the nations and nothing else: the
 * tile is hard-clipped by a `clipPath` with no ellipsis, so two leader names
 * do not fit, and which nations won is what the tile is there to carry.
 * `games.winner_name` / `winner_nation` stay single-valued — they name the
 * representative seat — so the team form reads the roster's `is_winner` rows,
 * which the Worker sets for every seat on the winning team.
 */
export function winnerTileLabel(game: WinnerTileGame): string {
	const winners = game.players.filter((p) => p.is_winner);
	if (winners.length > 1) {
		const nations = winners
			.map((p) => p.nation)
			.filter((n): n is string => n !== null);
		if (nations.length > 0) return nations.map(nationName).join(" + ");
	}
	const winning = game.players.find(
		(p) => p.is_winner || p.nation === game.winner_nation,
	);
	const name = game.winner_name ?? winning?.player_name ?? null;
	if (name && game.winner_nation) {
		return `${name} (${nationName(game.winner_nation)})`;
	}
	if (game.winner_nation) return nationName(game.winner_nation);
	return "—";
}
