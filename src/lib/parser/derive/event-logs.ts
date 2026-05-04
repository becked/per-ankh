// derive/event-logs.ts — port of get_event_logs (match_data.rs:277–310).
//
// Dedups events that have the same (turn, log_type, stripped-description).
// For groups with > 1 row, player_name is set to null (the SQL `CASE` clause
// at line 287); for single-row groups it resolves the player name.

import type { EventLog as ParsedEventLog } from "../parsers/events.js";
import type { Player } from "../parsers/players.js";
import type { EventLog } from "../types.js";
import { playerByXmlId, stripMarkup } from "./_helpers.js";

interface Bucket {
	min_log_id: number; // surrogate id; we use array order as proxy
	log_type: string;
	turn: number;
	rowCount: number;
	soloPlayerXmlId: number | null;
	descriptions: string[];
}

export function deriveEventLogs(
	eventLogs: ParsedEventLog[],
	players: Player[],
): EventLog[] {
	const playerMap = playerByXmlId(players);

	// Group by (turn, log_type, stripped-description).
	const groups = new Map<string, Bucket>();
	let nextSurrogateId = 1;

	for (const log of eventLogs) {
		const stripped = log.description ? stripMarkup(log.description) : "";
		// `\x01` separator — mirrors the SQL `GROUP BY el.turn, el.log_type, ...`
		// triple. Plain concatenation collides on edge cases like
		// (turn=12, type="X") vs (turn=1, type="2X").
		const key = `${log.turn}\x01${log.logType}\x01${stripped}`;
		let bucket = groups.get(key);
		if (!bucket) {
			bucket = {
				min_log_id: nextSurrogateId++,
				log_type: log.logType,
				turn: log.turn,
				rowCount: 0,
				soloPlayerXmlId: log.playerXmlId,
				descriptions: [],
			};
			groups.set(key, bucket);
		}
		bucket.rowCount++;
		if (log.description !== null) bucket.descriptions.push(log.description);
	}

	const out: EventLog[] = [];
	for (const b of groups.values()) {
		// MIN(description) — JS string compare via sort.
		const description =
			b.descriptions.length > 0 ? [...b.descriptions].sort()[0] : null;

		// SQL `WHEN COUNT(*) > 1 THEN NULL`. Counts ALL rows in the group,
		// not distinct players — two events from the same player at the same
		// turn with the same stripped description still trip the multi-row
		// branch.
		let playerName: string | null = null;
		if (b.rowCount === 1 && b.soloPlayerXmlId !== null) {
			playerName = playerMap.get(b.soloPlayerXmlId)?.playerName ?? "Player";
		}

		out.push({
			log_id: b.min_log_id,
			log_type: b.log_type,
			turn: b.turn,
			player_name: playerName,
			description,
		});
	}

	// ORDER BY el.turn DESC, MIN(el.log_id) DESC.
	out.sort((a, b) => b.turn - a.turn || b.log_id - a.log_id);
	return out;
}
