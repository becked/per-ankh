// derive/current-laws.ts — port of get_current_laws (match_data.rs:80–134).
//
// Each non-succession law in `laws` becomes a PlayerLaw. The adopted_turn
// comes from the most recent LAW_ADOPTED event_log for that (player, law);
// falls back to 0 if no event found (matches the SQL COALESCE). Succession
// laws (LAWCLASS_ORDER — Primogeniture etc.) are realm defaults, not civic
// adoptions, so they're excluded here (and from law-adoption-history) — a
// deliberate divergence from the Rust port.

import type { EventLog as ParsedEventLog } from "../parsers/events.js";
import type { Law } from "../parsers/player-data.js";
import type { Player } from "../parsers/players.js";
import type { PlayerLaw } from "../types.js";
import {
	extractLawName,
	isSuccessionLaw,
	playerByXmlId,
	strCmp,
} from "./_helpers.js";

export function deriveCurrentLaws(
	laws: Law[],
	eventLogs: ParsedEventLog[],
	players: Player[],
): PlayerLaw[] {
	const playerMap = playerByXmlId(players);

	// Build (player_xml_id, law) → MAX(turn) of LAW_ADOPTED events. Mirrors
	// the `latest_adoptions` CTE.
	const latestByKey = new Map<string, number>();
	for (const log of eventLogs) {
		if (log.logType !== "LAW_ADOPTED") continue;
		if (log.description === null) continue;
		const law = extractLawName(log.description);
		if (law === null) continue;
		const key = `${log.playerXmlId}:${law}`;
		const prev = latestByKey.get(key);
		if (prev === undefined || log.turn > prev) latestByKey.set(key, log.turn);
	}

	const out: PlayerLaw[] = [];
	for (const l of laws) {
		// Succession laws (LAWCLASS_ORDER) are realm defaults, not adoptions —
		// keep them out of the table (mirrors law-adoption-history).
		if (isSuccessionLaw(l.law)) continue;
		const player = playerMap.get(l.playerXmlId);
		if (!player) continue;
		const adoptedFromEvents = latestByKey.get(`${l.playerXmlId}:${l.law}`) ?? 0;
		out.push({
			player_id: l.playerXmlId,
			player_name: player.playerName,
			nation: player.nation,
			law_category: l.lawCategory,
			law: l.law,
			adopted_turn: adoptedFromEvents,
			change_count: l.changeCount,
		});
	}

	// ORDER BY p.nation, l.law_category.
	out.sort(
		(a, b) =>
			strCmp(a.nation ?? "", b.nation ?? "") ||
			strCmp(a.law_category, b.law_category),
	);
	return out;
}
