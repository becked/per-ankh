// Combines match metadata + the resolved winner (player_name, nation, victory
// type) + a player roster. The `difficulty` field carries the save owner's
// PROSPERITY tier (already derived in MatchMetadata); each PlayerInfo carries
// its own, plus its starting development, so the Settings tab's Players table
// can show every seat's per-player setup rather than collapsing them.
//
// The three `setup_*` arrays are indexed by player xml id, which is NOT the
// index into `players` below — that is sorted by name.
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

	const playerInfos: PlayerInfo[] = players
		.map((p) => ({
			player_id: p.xmlId,
			player_name: p.playerName,
			nation: p.nation,
			dynasty: p.dynasty,
			is_human: p.isHuman,
			legitimacy: p.legitimacy,
			state_religion: p.stateReligion,
			difficulty: p.difficulty,
			development: p.development,
			leader_character_xml_id: p.leaderCharacterXmlId,
			chosen_heir_xml_id: p.chosenHeirXmlId,
			succession_gender: p.successionGender,
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
		map_aspect_ratio: metadata.map_aspect_ratio,
		map_options: metadata.map_options,
		game_options: metadata.game_options,
		disabled_improvements: metadata.disabled_improvements,
		game_mode: metadata.game_mode,
		difficulty: metadata.difficulty,
		setup_parameters: metadata.setup_parameters ?? null,
		occurrence_levels: metadata.occurrence_levels ?? null,
		setup_nations: metadata.setup_nations ?? null,
		setup_archetypes: metadata.setup_archetypes ?? null,
		setup_dynasties: metadata.setup_dynasties ?? null,
		setup_humans: metadata.setup_humans ?? null,
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
