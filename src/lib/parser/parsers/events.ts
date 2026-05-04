// Event parsers. Direct port of src-tauri/src/parser/parsers/events.rs.
// Three collections: event_stories (3 sources), event_logs, memory_data
// (with 2025 → 2024 fallback).

import {
	asArray,
	getElementChildren,
	isElement,
	optInt,
	optStr,
	requireInt,
} from "../parse-xml.js";

// ---------- Types ----------

export interface EventStory {
	eventType: string;
	playerXmlId: number;
	occurredTurn: number;
	primaryCharacterXmlId: number | null;
	cityXmlId: number | null;
}

export interface EventLog {
	playerXmlId: number;
	logType: string;
	turn: number;
	description: string | null;
	data1: string | null;
	data2: string | null;
	data3: string | null;
}

export interface MemoryData {
	playerXmlId: number;
	memoryType: string;
	turn: number;
	targetPlayerXmlId: number | null;
	targetCharacterXmlId: number | null;
	targetFamily: string | null;
	targetTribe: string | null;
	targetReligion: string | null;
}

// ---------- Helpers ----------

/**
 * Walk a `<...EventStoryTurn>`-style container. Each child's tag name is the
 * event_type; text is parsed as occurred_turn (lenient — defaults to 0 on
 * missing/unparseable per Rust unwrap_or(0) at events.rs:84, 115, 145).
 */
function collectEventTurns(
	node: unknown,
): Array<{ eventType: string; occurredTurn: number }> {
	const out: Array<{ eventType: string; occurredTurn: number }> = [];
	if (!isElement(node)) return out;
	for (const [eventType, value] of getElementChildren(node)) {
		out.push({ eventType, occurredTurn: optInt(value) ?? 0 });
	}
	return out;
}

// Fixed sequence Rust walks for player-level event stories
// (events.rs:69–75).
const PLAYER_EVENT_STORY_ELEMENTS: ReadonlyArray<string> = [
	"AllEventStoryTurn",
	"FamilyEventStoryTurn",
	"ReligionEventStoryTurn",
	"TribeEventStoryTurn",
	"PlayerEventStoryTurn",
];

// Filter for event_log Data1/Data2/Data3 — drop the literal string "None"
// and empty values (events.rs:191, 198, 205).
function logDataField(val: unknown): string | null {
	const s = optStr(val);
	if (s === null) return null;
	return s === "None" ? null : s;
}

// ---------- Event stories (events.rs:65–159) ----------

export function parseEventStories(
	root: Record<string, unknown>,
): EventStory[] {
	const out: EventStory[] = [];

	// 1. Player-level: walk 5 event-story containers per player in fixed
	//    order. These have no character/city association.
	for (const playerNode of asArray(root.Player) as unknown[]) {
		if (!isElement(playerNode)) continue;
		const playerXmlId = requireInt(playerNode["@_ID"], "Player.ID");
		for (const elementName of PLAYER_EVENT_STORY_ELEMENTS) {
			for (const { eventType, occurredTurn } of collectEventTurns(
				playerNode[elementName],
			)) {
				out.push({
					eventType,
					playerXmlId,
					occurredTurn,
					primaryCharacterXmlId: null,
					cityXmlId: null,
				});
			}
		}
	}

	// 2. Character-level: only emit if the character carries a parseable
	//    `player` ATTRIBUTE (note the lowercase — `@_player`, NOT
	//    `@_Player`; mirrors opt_attr("player") at events.rs:41).
	for (const charNode of asArray(root.Character) as unknown[]) {
		if (!isElement(charNode)) continue;
		const charXmlId = requireInt(charNode["@_ID"], "Character.ID");
		const playerXmlId = optInt(charNode["@_player"]);
		if (playerXmlId === null) continue;
		for (const { eventType, occurredTurn } of collectEventTurns(
			charNode.EventStoryTurn,
		)) {
			out.push({
				eventType,
				playerXmlId,
				occurredTurn,
				primaryCharacterXmlId: charXmlId,
				cityXmlId: null,
			});
		}
	}

	// 3. City-level: same lowercase `@_player` attribute pattern.
	for (const cityNode of asArray(root.City) as unknown[]) {
		if (!isElement(cityNode)) continue;
		const cityXmlId = requireInt(cityNode["@_ID"], "City.ID");
		const playerXmlId = optInt(cityNode["@_player"]);
		if (playerXmlId === null) continue;
		for (const { eventType, occurredTurn } of collectEventTurns(
			cityNode.EventStoryTurn,
		)) {
			out.push({
				eventType,
				playerXmlId,
				occurredTurn,
				primaryCharacterXmlId: null,
				cityXmlId,
			});
		}
	}

	return out;
}

// ---------- Event logs (events.rs:162–221) ----------

export function parseEventLogs(root: Record<string, unknown>): EventLog[] {
	const out: EventLog[] = [];

	for (const playerNode of asArray(root.Player) as unknown[]) {
		if (!isElement(playerNode)) continue;
		const playerXmlId = requireInt(playerNode["@_ID"], "Player.ID");

		const logListNode = playerNode.PermanentLogList;
		if (!isElement(logListNode)) continue;

		for (const logData of asArray(logListNode.LogData) as unknown[]) {
			if (!isElement(logData)) continue;

			out.push({
				playerXmlId,
				// All lenient defaults — Rust uses unwrap_or("") / unwrap_or(0)
				// throughout this section.
				logType: optStr(logData.Type) ?? "",
				turn: optInt(logData.Turn) ?? 0,
				description: optStr(logData.Text),
				data1: logDataField(logData.Data1),
				data2: logDataField(logData.Data2),
				data3: logDataField(logData.Data3),
			});
		}
	}

	return out;
}

// ---------- Memory data (events.rs:224–323) ----------

export function parseMemoryData(
	root: Record<string, unknown>,
): MemoryData[] {
	const out: MemoryData[] = [];

	for (const playerNode of asArray(root.Player) as unknown[]) {
		if (!isElement(playerNode)) continue;
		const playerXmlId = requireInt(playerNode["@_ID"], "Player.ID");

		// Try 2025+ format first.
		const memoryListNode = playerNode.MemoryList;
		const playerMemories: MemoryData[] = [];
		if (isElement(memoryListNode)) {
			for (const md of asArray(memoryListNode.MemoryData) as unknown[]) {
				if (!isElement(md)) continue;
				const parsed = parseSingleMemory(md, playerXmlId);
				if (parsed !== null) playerMemories.push(parsed);
			}
		}

		// Fall back to 2024 legacy if 2025 yielded nothing — mirrors
		// `if memories.is_empty()` at events.rs:237.
		if (playerMemories.length === 0) {
			playerMemories.push(...parseLegacyMemoryLists(playerNode, playerXmlId));
		}

		out.push(...playerMemories);
	}

	return out;
}

// 2024 legacy lists — five separate Memory{Type}List/Memory{Type}Data pairs.
const LEGACY_MEMORY_LISTS: ReadonlyArray<[string, string]> = [
	["MemoryPlayerList", "MemoryPlayerData"],
	["MemoryFamilyList", "MemoryFamilyData"],
	["MemoryCharacterList", "MemoryCharacterData"],
	["MemoryTribeList", "MemoryTribeData"],
	["MemoryReligionList", "MemoryReligionData"],
];

function parseLegacyMemoryLists(
	playerNode: Record<string, unknown>,
	playerXmlId: number,
): MemoryData[] {
	const out: MemoryData[] = [];
	for (const [listName, dataElementName] of LEGACY_MEMORY_LISTS) {
		const listNode = playerNode[listName];
		if (!isElement(listNode)) continue;
		for (const md of asArray(listNode[dataElementName]) as unknown[]) {
			if (!isElement(md)) continue;
			const parsed = parseSingleMemory(md, playerXmlId);
			if (parsed !== null) out.push(parsed);
		}
	}
	return out;
}

/**
 * Parse one memory record. Missing `<Type>` text returns null (skip the row
 * silently — mirrors Rust's `match ... { Some => ..., None => return Ok(None) }`
 * at events.rs:246–249).
 */
function parseSingleMemory(
	node: Record<string, unknown>,
	playerXmlId: number,
): MemoryData | null {
	const memoryType = optStr(node.Type);
	if (memoryType === null) return null;

	return {
		playerXmlId,
		memoryType,
		turn: optInt(node.Turn) ?? 0,
		targetPlayerXmlId: optInt(node.Player),
		targetCharacterXmlId: optInt(node.CharacterID),
		targetFamily: optStr(node.Family),
		targetTribe: optStr(node.Tribe),
		targetReligion: optStr(node.Religion),
	};
}
