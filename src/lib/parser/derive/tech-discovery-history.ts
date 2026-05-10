// derive/tech-discovery-history.ts — port of get_tech_discovery_history
// (history.rs:330–409).
//
// Per player, walk TECH_DISCOVERED events with running cumulative count.
// Prepend a turn 0 starting point and append a final-turn endpoint.

import type { EventLog as ParsedEventLog } from "../parsers/events.js";
import type { Player } from "../parsers/players.js";
import type { TechDiscoveryDataPoint, TechDiscoveryHistory } from "../types.js";
import { playersOrderedByName } from "./_helpers.js";

export function deriveTechDiscoveryHistory(
	eventLogs: ParsedEventLog[],
	players: Player[],
	totalTurns: number,
): TechDiscoveryHistory[] {
	const result: TechDiscoveryHistory[] = [];

	for (const player of playersOrderedByName(players)) {
		// Filter to this player's TECH_DISCOVERED events with non-null
		// data1, sort by turn (ROW_NUMBER over ORDER BY turn, log_id; we
		// preserve insertion order as the log_id proxy).
		interface Event {
			turn: number;
			tech_name: string;
			seq: number;
		}
		const events: Event[] = [];
		let seq = 0;
		for (const log of eventLogs) {
			if (log.playerXmlId !== player.xmlId) continue;
			if (log.logType !== "TECH_DISCOVERED") continue;
			if (log.data1 === null) continue;
			events.push({ turn: log.turn, tech_name: log.data1, seq: seq++ });
		}

		events.sort((a, b) => a.turn - b.turn || a.seq - b.seq);
		const data: TechDiscoveryDataPoint[] = events.map((e, i) => ({
			turn: e.turn,
			tech_count: i + 1,
			tech_name: e.tech_name,
		}));

		// Prepend turn-0 starting point.
		data.unshift({ turn: 0, tech_count: 0, tech_name: null });

		// Append final-turn endpoint.
		const last = data[data.length - 1];
		if (last.turn < totalTurns) {
			data.push({
				turn: totalTurns,
				tech_count: last.tech_count,
				tech_name: null,
			});
		}

		result.push({
			player_id: player.xmlId,
			player_name: player.playerName,
			nation: player.nation,
			data,
		});
	}

	return result;
}
