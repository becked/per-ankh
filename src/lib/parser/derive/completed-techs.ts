// derive/completed-techs.ts — port of get_completed_techs (match_data.rs:139–170).
//
// Reads TECH_DISCOVERED event_logs (data1 carries the tech name); resolves
// player_name + nation. ORDER BY p.nation, e.turn, e.data1.
//
// Dedupe: Old World can grant the same tech to a player more than once
// (free-tech events from ruins/tribes/characters can fire alongside or
// duplicate a normal research). The wire shape `completed_techs` is
// semantically a set (one entry per tech per player), and downstream
// consumers — the cloud D1 `tech_events` PK (game_id, player_index, tech)
// and the player_summaries `techs_completed` count — require uniqueness.
// Keep the earliest turn for each (player_id, tech) pair.

import type { EventLog as ParsedEventLog } from "../parsers/events.js";
import type { Player } from "../parsers/players.js";
import type { PlayerTech } from "../types.js";
import { playerByXmlId, strCmp } from "./_helpers.js";

export function deriveCompletedTechs(
	eventLogs: ParsedEventLog[],
	players: Player[],
): PlayerTech[] {
	const playerMap = playerByXmlId(players);
	const byKey = new Map<string, PlayerTech>();

	for (const log of eventLogs) {
		if (log.logType !== "TECH_DISCOVERED") continue;
		if (log.data1 === null) continue;
		const player = playerMap.get(log.playerXmlId);
		if (!player) continue;

		const key = `${player.xmlId}:${log.data1}`;
		const existing = byKey.get(key);
		if (existing && existing.completed_turn <= log.turn) continue;

		byKey.set(key, {
			player_id: player.xmlId,
			player_name: player.playerName,
			nation: player.nation,
			tech: log.data1,
			completed_turn: log.turn,
		});
	}

	const out = Array.from(byKey.values());
	out.sort(
		(a, b) =>
			strCmp(a.nation ?? "", b.nation ?? "") ||
			a.completed_turn - b.completed_turn ||
			strCmp(a.tech, b.tech),
	);
	return out;
}
