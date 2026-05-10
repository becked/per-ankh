// derive/player-history.ts — port of get_player_history (history.rs:13–99).
//
// Per player, generate a complete turn sequence [1..total_turns] and
// forward-fill points / military_power / legitimacy from the sparse
// time-series. Mirrors DuckDB's `LAST_VALUE(... IGNORE NULLS)` window.

import type { Player } from "../parsers/players.js";
import type {
	LegitimacyHistory,
	MilitaryPowerHistory,
	PointsHistory,
} from "../parsers/timeseries.js";
import type { PlayerHistory, PlayerHistoryPoint } from "../types.js";
import { playersOrderedByName } from "./_helpers.js";

export function derivePlayerHistory(
	pointsHistory: PointsHistory[],
	militaryPowerHistory: MilitaryPowerHistory[],
	legitimacyHistory: LegitimacyHistory[],
	players: Player[],
	totalTurns: number,
): PlayerHistory[] {
	const result: PlayerHistory[] = [];

	for (const player of playersOrderedByName(players)) {
		// Build sparse turn → value maps.
		const points = sparseMap(
			pointsHistory.filter((h) => h.playerXmlId === player.xmlId),
			(h) => h.points,
		);
		const military = sparseMap(
			militaryPowerHistory.filter((h) => h.playerXmlId === player.xmlId),
			(h) => h.militaryPower,
		);
		const legit = sparseMap(
			legitimacyHistory.filter((h) => h.playerXmlId === player.xmlId),
			(h) => h.legitimacy,
		);

		const history: PlayerHistoryPoint[] = [];
		let lastP: number | null = null;
		let lastM: number | null = null;
		let lastL: number | null = null;
		for (let t = 1; t <= totalTurns; t++) {
			const p = points.get(t);
			const m = military.get(t);
			const l = legit.get(t);
			if (p !== undefined) lastP = p;
			if (m !== undefined) lastM = m;
			if (l !== undefined) lastL = l;
			history.push({
				turn: t,
				points: lastP,
				military_power: lastM,
				legitimacy: lastL,
			});
		}

		result.push({
			player_id: player.xmlId,
			player_name: player.playerName,
			nation: player.nation,
			history,
		});
	}

	return result;
}

function sparseMap<T extends { turn: number }>(
	rows: T[],
	pick: (r: T) => number,
): Map<number, number> {
	const m = new Map<number, number>();
	for (const r of rows) m.set(r.turn, pick(r));
	return m;
}
