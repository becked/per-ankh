// Player-nested data parsers. Direct port of
// src-tauri/src/parser/parsers/player_data.rs. Seven collections per
// <Player>: resources, technology progress/completed/states, council,
// laws, goals.

import { ParseError } from "../extract-zip.js";
import {
	asArray,
	collectStrictNamedInts,
	getElementChildren,
	isElement,
	optInt,
	optStr,
	requireInt,
} from "../parse-xml.js";

// ---------- Types ----------

export interface PlayerResource {
	playerXmlId: number;
	yieldType: string;
	amount: number;
}

export interface TechnologyProgress {
	playerXmlId: number;
	tech: string;
	progress: number;
}

export interface TechnologyCompleted {
	playerXmlId: number;
	tech: string;
	completedTurn: number | null;
}

export interface TechnologyState {
	playerXmlId: number;
	tech: string;
	state: string;
}

export interface PlayerCouncil {
	playerXmlId: number;
	position: string;
	characterXmlId: number;
	appointedTurn: number | null;
}

export interface Law {
	playerXmlId: number;
	lawCategory: string;
	law: string;
	adoptedTurn: number;
	changeCount: number;
}

export interface PlayerGoal {
	playerXmlId: number;
	goalXmlId: number;
	goalType: string;
	leaderCharacterXmlId: number | null;
	startedTurn: number;
	completedTurn: number | null;
	failedTurn: number | null;
	maxTurns: number | null;
	progress: number;
	goalState: string | null;
}

// ---------- Helpers ----------

function* eachPlayer(
	root: Record<string, unknown>,
): Generator<[number, Record<string, unknown>]> {
	for (const node of asArray(root.Player) as unknown[]) {
		if (!isElement(node)) continue;
		const playerXmlId = requireInt(node["@_ID"], "Player.ID");
		yield [playerXmlId, node];
	}
}

// State name mapping for parseTechnologyStates. Order matters: Rust walks
// these in this exact sequence (player_data.rs:218–224).
const TECH_STATE_MAPPINGS: ReadonlyArray<[string, string]> = [
	["TechAvailable", "available"],
	["TechPassed", "passed"],
	["TechTrashed", "trashed"],
	["TechLocked", "locked"],
	// Note: TechTarget → "targeted" (not "target") per Rust source.
	["TechTarget", "targeted"],
];

// ---------- Player resources (player_data.rs:71–108) ----------

export function parsePlayerResources(
	root: Record<string, unknown>,
): PlayerResource[] {
	const out: PlayerResource[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		for (const { name, value } of collectStrictNamedInts(
			node.YieldStockpile,
			"YieldStockpile",
		)) {
			out.push({ playerXmlId, yieldType: name, amount: value });
		}
	}
	return out;
}

// ---------- Technology progress (player_data.rs:119–150) ----------

export function parseTechnologyProgress(
	root: Record<string, unknown>,
): TechnologyProgress[] {
	const out: TechnologyProgress[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		for (const { name, value } of collectStrictNamedInts(
			node.TechProgress,
			"TechProgress",
		)) {
			out.push({ playerXmlId, tech: name, progress: value });
		}
	}
	return out;
}

// ---------- Technologies completed (player_data.rs:163–197) ----------

export function parseTechnologiesCompleted(
	root: Record<string, unknown>,
): TechnologyCompleted[] {
	const out: TechnologyCompleted[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		for (const { name, value } of collectStrictNamedInts(
			node.TechCount,
			"TechCount",
		)) {
			// Rust filter: only emit if count > 0. Skip TECH_X with 0.
			if (value <= 0) continue;
			out.push({
				playerXmlId,
				tech: name,
				// Hardcoded null — not available at this XML location.
				completedTurn: null,
			});
		}
	}
	return out;
}

// ---------- Technology states (player_data.rs:211–244) ----------

export function parseTechnologyStates(
	root: Record<string, unknown>,
): TechnologyState[] {
	const out: TechnologyState[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		for (const [elementName, state] of TECH_STATE_MAPPINGS) {
			const stateNode = node[elementName];
			if (!isElement(stateNode)) continue;
			// Just collect element child names — values are ignored (children
			// are typically self-closing like <TECH_FORESTRY/>).
			for (const [tech] of getElementChildren(stateNode)) {
				out.push({ playerXmlId, tech, state });
			}
		}
	}
	return out;
}

// ---------- Player council (player_data.rs:255–293) ----------

export function parsePlayerCouncil(
	root: Record<string, unknown>,
): PlayerCouncil[] {
	const out: PlayerCouncil[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		for (const { name, value } of collectStrictNamedInts(
			node.CouncilCharacter,
			"CouncilCharacter",
		)) {
			out.push({
				playerXmlId,
				position: name,
				characterXmlId: value,
				// Hardcoded null — not available at this XML location.
				appointedTurn: null,
			});
		}
	}
	return out;
}

// ---------- Laws (player_data.rs:304–331) ----------

export function parseLaws(root: Record<string, unknown>): Law[] {
	const out: Law[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		const activeLawNode = node.ActiveLaw;
		if (!isElement(activeLawNode)) continue;

		// Strict named-string container. Each child name → law_category,
		// text → law (e.g. <LAWCLASS_ORDER>LAW_PRIMOGENITURE</LAWCLASS_ORDER>).
		// Inline rather than promoting another helper — single use.
		for (const [lawCategory, value] of getElementChildren(activeLawNode)) {
			if (typeof value !== "string" || value === "") {
				throw new ParseError(
					`ActiveLaw.${lawCategory} text content`,
					"MISSING_FIELD",
				);
			}
			out.push({
				playerXmlId,
				lawCategory,
				law: value,
				// Literal int placeholders — the parse layer doesn't have
				// adoption-turn or change-count data. NOT null. Match Rust
				// player_data.rs:324–325.
				adoptedTurn: 0,
				changeCount: 1,
			});
		}
	}
	return out;
}

// ---------- Player goals (player_data.rs:351–457) ----------

export function parsePlayerGoals(
	root: Record<string, unknown>,
): PlayerGoal[] {
	const out: PlayerGoal[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		const goalListNode = node.GoalList;
		if (!isElement(goalListNode)) continue;

		for (const goalData of asArray(goalListNode.GoalData) as unknown[]) {
			if (!isElement(goalData)) continue;

			// Required fields — error if missing.
			const goalType = optStr(goalData.Type);
			if (goalType === null) {
				throw new ParseError("GoalData.Type", "MISSING_FIELD");
			}

			const goalIdRaw = optStr(goalData.ID);
			if (goalIdRaw === null) {
				throw new ParseError("GoalData.ID", "MISSING_FIELD");
			}
			const goalXmlId = parseInt(goalIdRaw, 10);
			if (Number.isNaN(goalXmlId)) {
				throw new ParseError(
					"GoalData.ID must be an integer",
					"INVALID_FORMAT",
				);
			}

			const turnRaw = optStr(goalData.Turn);
			if (turnRaw === null) {
				throw new ParseError("GoalData.Turn", "MISSING_FIELD");
			}
			const startedTurn = parseInt(turnRaw, 10);
			if (Number.isNaN(startedTurn)) {
				throw new ParseError(
					"GoalData.Turn must be an integer",
					"INVALID_FORMAT",
				);
			}

			// Optional fields — lenient parse.
			const leaderCharacterXmlId = optInt(goalData.LeaderID);
			const maxTurns = optInt(goalData.MaxTurns);

			// <Finished/> presence check. If present, completed_turn =
			// started_turn (literal "use started_turn as placeholder" hack
			// per player_data.rs:412). NOT a separate read.
			const finished = "Finished" in goalData;
			const completedTurn = finished ? startedTurn : null;

			out.push({
				playerXmlId,
				goalXmlId,
				goalType,
				leaderCharacterXmlId,
				startedTurn,
				completedTurn,
				// Hardcoded — not available at this layer.
				failedTurn: null,
				maxTurns,
				progress: 0,
				goalState: serializeGoalStats(goalData.Stats),
			});
		}
	}
	return out;
}

/**
 * Walk `<Stats>` element children into a JSON-encoded string, with keys
 * sorted alphabetically to match Rust's `serde_json::Map` (default features
 * → `BTreeMap` → byte-lex key sort). Returns null when Stats is absent or
 * resolves to an empty map (mirrors Rust `if !stats.is_empty()` check).
 *
 * Empty-text children are silently skipped (mirrors Rust's
 * `if let Some(text)` short-circuit; fast-xml-parser surfaces empty
 * elements as `""`).
 *
 * Output format must match Rust serde_json::to_string exactly: compact
 * (no spaces), all string values, keys ASCII-sorted.
 */
function serializeGoalStats(node: unknown): string | null {
	if (!isElement(node)) return null;
	const stats: Record<string, string> = {};
	for (const [statName, statValue] of getElementChildren(node)) {
		if (typeof statValue !== "string" || statValue === "") continue;
		stats[statName] = statValue;
	}
	const keys = Object.keys(stats);
	if (keys.length === 0) return null;
	// Replacer-array second arg gates the keys AND fixes their order. For
	// our keys (ASCII), Array.prototype.sort() matches Rust's BTreeMap<String>
	// byte-lex ordering.
	return JSON.stringify(stats, keys.sort());
}
