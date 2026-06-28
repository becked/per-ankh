// derive/law-adoption-history.ts — port of get_law_adoption_history
// (history.rs:211–325).
//
// Per player, walk LAW_ADOPTED events with their law name extracted from
// description, look up each law's law_category from the static LAW_TO_CLASS
// table, and emit a series with running cumulative-distinct-class count.
// Prepend a turn 0 starting point and append a final-turn endpoint.

import type { EventLog as ParsedEventLog } from "../parsers/events.js";
import type { Player } from "../parsers/players.js";
import type { LawAdoptionDataPoint, LawAdoptionHistory } from "../types.js";
import { LAW_TO_CLASS } from "../../generated/law-classes.js";
import {
	extractLawName,
	isSuccessionLaw,
	playersOrderedByName,
} from "./_helpers.js";

export function deriveLawAdoptionHistory(
	eventLogs: ParsedEventLog[],
	players: Player[],
	totalTurns: number,
): LawAdoptionHistory[] {
	const result: LawAdoptionHistory[] = [];

	for (const player of playersOrderedByName(players)) {
		// Pull this player's LAW_ADOPTED events with extracted law name +
		// resolved category. Skip rows where the law isn't in the mapping.
		interface Event {
			turn: number;
			law_name: string;
			law_category: string;
			seq: number; // log_id surrogate for ordering
		}

		const events: Event[] = [];
		let seq = 0;
		for (const log of eventLogs) {
			if (log.playerXmlId !== player.xmlId) continue;
			if (log.logType !== "LAW_ADOPTED") continue;
			if (log.description === null) continue;
			const lawName = extractLawName(log.description);
			if (lawName === null) continue;
			// Succession laws (LAWCLASS_ORDER) are realm defaults, not civic
			// adoptions — keep them out of the adoption series entirely.
			if (isSuccessionLaw(lawName)) continue;
			// Resolve via the static LAW→class table, not this game's active
			// laws: a law the player later switched away from (e.g. Epics →
			// Exploration, same class) is gone from <ActiveLaw>, so a per-game
			// map would drop its LAW_ADOPTED event and mis-date the class's
			// first adoption. An unmapped law (future DLC not yet in Reference)
			// falls through and is skipped.
			const category = LAW_TO_CLASS[lawName];
			if (category === undefined) continue;
			events.push({
				turn: log.turn,
				law_name: lawName,
				law_category: category,
				seq: seq++,
			});
		}

		// First-class-adoption per category — earliest turn each unique
		// category was adopted.
		const firstAdoptionByCategory = new Map<string, number>();
		for (const e of events) {
			const prev = firstAdoptionByCategory.get(e.law_category);
			if (prev === undefined || e.turn < prev) {
				firstAdoptionByCategory.set(e.law_category, e.turn);
			}
		}

		// For each event, count distinct categories whose first_adoption is ≤
		// this event's turn. Mirrors the SQL subquery at history.rs:277.
		events.sort((a, b) => a.turn - b.turn || a.seq - b.seq);
		const data: LawAdoptionDataPoint[] = events.map((e) => {
			let count = 0;
			for (const firstTurn of firstAdoptionByCategory.values()) {
				if (firstTurn <= e.turn) count++;
			}
			return {
				turn: e.turn,
				law_count: count,
				law_name: e.law_name,
			};
		});

		// Prepend turn-0 starting point.
		data.unshift({ turn: 0, law_count: 0, law_name: null });

		// Append final-turn endpoint if last data point isn't already there.
		const last = data[data.length - 1];
		if (last.turn < totalTurns) {
			data.push({
				turn: totalTurns,
				law_count: last.law_count,
				law_name: null,
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
