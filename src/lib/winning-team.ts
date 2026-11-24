// Who won a game — the one answer every outcome test reads.
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
