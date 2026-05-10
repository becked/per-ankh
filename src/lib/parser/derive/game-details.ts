// derive/game-details.ts — port of get_game_details (match_data.rs:10–75).
//
// Combines match metadata + the resolved winner (player_name, nation, victory
// type) + a player roster. The Rust query also pulls difficulty from the
// save-owner's player row; we mirror that — the parser's Player type carries
// `difficulty` but it's a per-player attribute, so we use the save-owner's
// value (or null if no save_owner is flagged at parse time).
//
// `match_id` is a desktop-DB artifact; for the cloud blob we populate 0 and
// flag the divergence here. Frontend tab components don't use match_id.

import type { Player } from "../parsers/players.js";
import type { GameDetails, MatchMetadata, PlayerInfo } from "../types.js";
import { strCmp } from "./_helpers.js";

export function deriveGameDetails(
	metadata: MatchMetadata,
	players: Player[],
): GameDetails {
	const winner = metadata.winner;
	const winnerPlayer = winner
		? players.find((p) => p.xmlId === winner.winner_player_xml_id)
		: undefined;

	const saveOwner = players.find((p) => p.isSaveOwner);

	const playerInfos: PlayerInfo[] = players
		.map((p) => ({
			player_name: p.playerName,
			nation: p.nation,
			is_human: p.isHuman,
			legitimacy: p.legitimacy,
			state_religion: p.stateReligion,
		}))
		.sort((a, b) => strCmp(a.player_name, b.player_name));

	return {
		match_id: 0,
		game_name: metadata.game_name,
		save_date: metadata.save_date,
		total_turns: metadata.total_turns,
		map_size: metadata.map_size,
		map_width: metadata.map_width,
		map_height: metadata.map_height,
		map_class: metadata.map_class,
		game_mode: metadata.game_mode,
		opponent_level: metadata.opponent_level,
		difficulty: saveOwner?.difficulty ?? null,
		victory_conditions: metadata.victory_conditions,
		enabled_mods: metadata.enabled_mods,
		enabled_dlc: metadata.enabled_dlc,
		winner_player_id: winner?.winner_player_xml_id ?? null,
		winner_name: winnerPlayer?.playerName ?? null,
		winner_civilization: winnerPlayer?.nation ?? null,
		winner_victory_type: winner?.victory_type ?? null,
		players: playerInfos,
	};
}
