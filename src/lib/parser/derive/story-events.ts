// derive/story-events.ts — port of get_story_events (match_data.rs:219–251).
//
// Parsed event_stories carry XML ids; resolve to player_name + first_name +
// city_name. ORDER BY occurred_turn DESC, event_id DESC, LIMIT 100.

import type { Character } from "../parsers/characters.js";
import type { City } from "../parsers/cities.js";
import type { EventStory } from "../parsers/events.js";
import type { Player } from "../parsers/players.js";
import type { StoryEvent } from "../types.js";
import { playerByXmlId } from "./_helpers.js";

const STORY_EVENT_LIMIT = 100;

export function deriveStoryEvents(
	eventStories: EventStory[],
	players: Player[],
	characters: Character[],
	cities: City[],
): StoryEvent[] {
	const playerMap = playerByXmlId(players);
	const charMap = new Map<number, Character>();
	for (const c of characters) charMap.set(c.xmlId, c);
	const cityMap = new Map<number, City>();
	for (const c of cities) cityMap.set(c.xmlId, c);

	const out: StoryEvent[] = [];
	let surrogateId = 1;

	for (const e of eventStories) {
		const player = playerMap.get(e.playerXmlId);
		if (!player) continue;
		out.push({
			event_id: surrogateId++,
			event_type: e.eventType,
			player_name: player.playerName,
			occurred_turn: e.occurredTurn,
			primary_character_name:
				e.primaryCharacterXmlId !== null
					? (charMap.get(e.primaryCharacterXmlId)?.firstName ?? null)
					: null,
			city_name:
				e.cityXmlId !== null
					? (cityMap.get(e.cityXmlId)?.cityName ?? null)
					: null,
		});
	}

	out.sort(
		(a, b) =>
			b.occurred_turn - a.occurred_turn || b.event_id - a.event_id,
	);

	return out.slice(0, STORY_EVENT_LIMIT);
}
