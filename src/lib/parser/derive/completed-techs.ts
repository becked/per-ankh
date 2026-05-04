// derive/completed-techs.ts — port of get_completed_techs (match_data.rs:139–170).
//
// Reads TECH_DISCOVERED event_logs (data1 carries the tech name); resolves
// player_name + nation. ORDER BY p.nation, e.turn, e.data1.

import type { EventLog as ParsedEventLog } from "../parsers/events.js";
import type { Player } from "../parsers/players.js";
import type { PlayerTech } from "../types.js";
import { playerByXmlId, strCmp } from "./_helpers.js";

export function deriveCompletedTechs(
	eventLogs: ParsedEventLog[],
	players: Player[],
): PlayerTech[] {
	const playerMap = playerByXmlId(players);
	const out: PlayerTech[] = [];

	for (const log of eventLogs) {
		if (log.logType !== "TECH_DISCOVERED") continue;
		if (log.data1 === null) continue;
		const player = playerMap.get(log.playerXmlId);
		if (!player) continue;

		out.push({
			player_id: player.xmlId,
			player_name: player.playerName,
			nation: player.nation,
			tech: log.data1,
			completed_turn: log.turn,
		});
	}

	out.sort(
		(a, b) =>
			strCmp(a.nation ?? "", b.nation ?? "") ||
			a.completed_turn - b.completed_turn ||
			strCmp(a.tech, b.tech),
	);
	return out;
}
