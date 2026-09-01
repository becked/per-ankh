// Player-nested data parsers. Seven collections per <Player>: resources,
// technology progress/completed/states, council, laws, goals.

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

// One tech a player chose, with the others that were on offer in the same
// draw. See parseTechChoices.
export interface TechChoice {
	playerXmlId: number;
	tech: string;
	alternates: string[];
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
// these in this exact sequence.
const TECH_STATE_MAPPINGS: ReadonlyArray<[string, string]> = [
	["TechAvailable", "available"],
	["TechPassed", "passed"],
	["TechTrashed", "trashed"],
	["TechLocked", "locked"],
	// Note: TechTarget → "targeted" (not "target") per Rust source.
	["TechTarget", "targeted"],
];

// ---------- Player resources ----------

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

// ---------- Projects produced (Player.ProjectsProduced) ----------
//
// Name-keyed int map on the Player node — every project the player ever
// completed, with counts, city projects and player projects alike. The
// per-City <ProjectCount> carries the same data split by city; this is the
// authoritative whole-game total (a city lost to conquest keeps its projects
// here but not there). No Rust counterpart: first parsed at 2.13.0.

export interface PlayerProjectProduced {
	playerXmlId: number;
	project: string;
	count: number;
}

export function parseProjectsProduced(
	root: Record<string, unknown>,
): PlayerProjectProduced[] {
	const out: PlayerProjectProduced[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		for (const { name, value } of collectStrictNamedInts(
			node.ProjectsProduced,
			"ProjectsProduced",
		)) {
			out.push({ playerXmlId, project: name, count: value });
		}
	}
	return out;
}

// ---------- Technology progress ----------

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

// ---------- Technologies completed ----------

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

// ---------- Technology states ----------

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

// ---------- Tech choices (Player.TechPathHistory) ----------
//
// Old World deals a hand of techs and the player takes one; the rest stay in
// the deck. <TechPathHistory> is the record of those draws, one child element
// per (chosen, passed-over) pair, named for the pair itself:
//
//   <TechPathHistory>
//     <TECH_IRONWORKING.TECH_DRAMA />
//     <TECH_IRONWORKING.TECH_MILITARY_DRILL />
//
// reading as "when Ironworking was taken, Drama and Military Drill were the
// other cards". Element ORDER is the order the draws happened in, and is
// preserved — it is the only ordering the save gives, since no turn is
// recorded against a choice.
//
// A tech the player holds that appears as no key here was never drafted: it
// was granted (a nation's starting techs, a Sages seat's random tech, an event
// reward). The consumer separates those using the baked starting-tech table.
//
// The dot in the element name is what makes this parseable at all — tech
// zTypes never contain one, so a single split recovers both halves. A name
// that doesn't split in two is skipped rather than guessed at.

export function parseTechChoices(root: Record<string, unknown>): TechChoice[] {
	const out: TechChoice[] = [];
	for (const [playerXmlId, node] of eachPlayer(root)) {
		const history = node.TechPathHistory;
		if (!isElement(history)) continue;
		// Keyed by chosen tech, insertion-ordered — the draws come out in the
		// order they happened.
		const byTech = new Map<string, string[]>();
		for (const [name] of getElementChildren(history)) {
			const dot = name.indexOf(".");
			if (dot <= 0 || dot === name.length - 1) continue;
			const chosen = name.slice(0, dot);
			const alternate = name.slice(dot + 1);
			if (alternate.includes(".")) continue;
			const alternates = byTech.get(chosen) ?? [];
			alternates.push(alternate);
			byTech.set(chosen, alternates);
		}
		for (const [tech, alternates] of byTech) {
			out.push({ playerXmlId, tech, alternates });
		}
	}
	return out;
}

// ---------- Player council ----------

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

// ---------- Laws ----------

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
				// adoption-turn or change-count data. NOT null. Match Rust.
				adoptedTurn: 0,
				changeCount: 1,
			});
		}
	}
	return out;
}

// ---------- Player goals ----------

export function parsePlayerGoals(root: Record<string, unknown>): PlayerGoal[] {
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
			// hack). NOT a separate read.
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

// ---------- ToRow mappers (snake_case wire format) ----------

export function playerResourceToRow(
	r: PlayerResource,
): Record<string, unknown> {
	return {
		player_xml_id: r.playerXmlId,
		yield_type: r.yieldType,
		amount: r.amount,
	};
}

export function techChoiceToRow(c: TechChoice): Record<string, unknown> {
	return {
		player_xml_id: c.playerXmlId,
		tech: c.tech,
		alternates: c.alternates,
	};
}

export function projectProducedToRow(
	r: PlayerProjectProduced,
): Record<string, unknown> {
	return {
		player_xml_id: r.playerXmlId,
		project: r.project,
		count: r.count,
	};
}

export function playerGoalToRow(g: PlayerGoal): Record<string, unknown> {
	return {
		player_xml_id: g.playerXmlId,
		goal_xml_id: g.goalXmlId,
		goal_type: g.goalType,
		leader_character_xml_id: g.leaderCharacterXmlId,
		started_turn: g.startedTurn,
		completed_turn: g.completedTurn,
		failed_turn: g.failedTurn,
		max_turns: g.maxTurns,
		progress: g.progress,
		goal_state: g.goalState,
	};
}
