// derive/player-wonders.ts — port of get_player_wonders (match_data.rs:178–216).
//
// Wonder completion fires WONDER_ACTIVITY events for every player; we
// dedupe by wonder name (data2) and keep the earliest turn. The builder
// nation is resolved by finding the wonder's improvement on the map and
// looking up the owning tile.

import type { EventLog as ParsedEventLog } from "../parsers/events.js";
import type { Player } from "../parsers/players.js";
import type { Tile } from "../parsers/tiles.js";
import type { PlayerWonder } from "../types.js";
import { playerByXmlId, strCmp } from "./_helpers.js";

export function derivePlayerWonders(
	eventLogs: ParsedEventLog[],
	tiles: Tile[],
	players: Player[],
): PlayerWonder[] {
	const playerMap = playerByXmlId(players);

	// Map improvement → tile → owner_player_xml_id (for builder lookup).
	const builderByImprovement = new Map<string, number>();
	for (const t of tiles) {
		if (t.improvement === null) continue;
		if (t.ownerPlayerXmlId === null) continue;
		// Only set the first tile carrying this improvement (LEFT JOIN
		// behavior — first match wins). Real wonders are unique per game so
		// this is effectively deterministic.
		if (!builderByImprovement.has(t.improvement)) {
			builderByImprovement.set(t.improvement, t.ownerPlayerXmlId);
		}
	}

	// Group WONDER_ACTIVITY/"completed" events by wonder, take MIN(turn).
	const wonderTurns = new Map<string, number>();
	for (const log of eventLogs) {
		if (log.logType !== "WONDER_ACTIVITY") continue;
		if (log.data2 === null) continue;
		if (log.description === null) continue;
		if (!log.description.includes("completed")) continue;
		const prev = wonderTurns.get(log.data2);
		if (prev === undefined || log.turn < prev) {
			wonderTurns.set(log.data2, log.turn);
		}
	}

	const out: PlayerWonder[] = [];
	for (const [wonder, completedTurn] of wonderTurns) {
		const builderXmlId = builderByImprovement.get(wonder);
		const builder =
			builderXmlId !== undefined ? playerMap.get(builderXmlId) : undefined;
		out.push({
			player_id: builder?.xmlId ?? 0,
			player_name: builder?.playerName ?? "Unknown",
			nation: builder?.nation ?? null,
			wonder,
			completed_turn: completedTurn,
		});
	}

	// ORDER BY p.nation, cw.completed_turn, cw.wonder.
	out.sort(
		(a, b) =>
			strCmp(a.nation ?? "", b.nation ?? "") ||
			a.completed_turn - b.completed_turn ||
			strCmp(a.wonder, b.wonder),
	);
	return out;
}
