// derive/yield-history.ts — port of get_yield_history (history.rs:106–206).
//
// Per (player, yield_type), generate a complete turn sequence and forward-
// fill rate from yield_rate_history and cumulative from yield_total_history.
// Both raw values are divided by 10 (the game stores yields scaled by 10).
// When no cumulative data is present for that pair, compute cumulative as
// running-sum of the forward-filled rate.

import type { Player } from "../parsers/players.js";
import type {
	YieldRateHistory,
	YieldTotalHistory,
} from "../parsers/timeseries.js";
import type { YieldDataPoint, YieldHistory } from "../types.js";
import { playersOrderedByName } from "./_helpers.js";

/** Yield types included in the share blob. Mirrors `SHARE_YIELD_TYPES` in share.rs:12. */
export const SHARE_YIELD_TYPES = [
	"YIELD_SCIENCE",
	"YIELD_CIVICS",
	"YIELD_TRAINING",
	"YIELD_GROWTH",
	"YIELD_CULTURE",
	"YIELD_HAPPINESS",
	"YIELD_ORDERS",
	"YIELD_FOOD",
	"YIELD_MONEY",
	"YIELD_DISCONTENT",
	"YIELD_IRON",
	"YIELD_STONE",
	"YIELD_WOOD",
	"YIELD_MAINTENANCE",
] as const;

export function deriveYieldHistory(
	yieldRateHistory: YieldRateHistory[],
	yieldTotalHistory: YieldTotalHistory[],
	players: Player[],
	totalTurns: number,
	yieldTypes: readonly string[] = SHARE_YIELD_TYPES,
): YieldHistory[] {
	const result: YieldHistory[] = [];

	for (const player of playersOrderedByName(players)) {
		for (const yieldType of yieldTypes) {
			const rateRows = yieldRateHistory.filter(
				(h) => h.playerXmlId === player.xmlId && h.yieldType === yieldType,
			);
			const totalRows = yieldTotalHistory.filter(
				(h) => h.playerXmlId === player.xmlId && h.yieldType === yieldType,
			);

			// turn → raw value
			const rateByTurn = new Map<number, number>();
			for (const r of rateRows) rateByTurn.set(r.turn, r.amount);
			const totalByTurn = new Map<number, number>();
			for (const r of totalRows) totalByTurn.set(r.turn, r.amount);

			const hasTotals = totalRows.length > 0;

			const data: YieldDataPoint[] = [];
			let lastRate: number | null = null;
			let lastCumul: number | null = null;
			let runningSum = 0;
			for (let t = 1; t <= totalTurns; t++) {
				const r = rateByTurn.get(t);
				if (r !== undefined) lastRate = r / 10;
				const c = totalByTurn.get(t);
				if (c !== undefined) lastCumul = c / 10;

				if (lastRate !== null) runningSum += lastRate;

				const cumulative = hasTotals ? lastCumul : runningSum;
				data.push({
					turn: t,
					rate: lastRate,
					cumulative,
				});
			}

			result.push({
				player_id: player.xmlId,
				player_name: player.playerName,
				nation: player.nation,
				yield_type: yieldType,
				data,
			});
		}
	}

	return result;
}
