// Tile entity + tile_visibility + tile_changes parsers. Direct port of
// src-tauri/src/parser/parsers/tiles.rs and tile_data.rs.

import { ParseError } from "../extract-zip.js";
import {
	asArray,
	getElementChildren,
	isElement,
	optI64Str,
	optInt,
	optStr,
	parsePrefixedKeyedIntMap,
	requireInt,
} from "../parse-xml.js";

// ---------- Types ----------

export interface Tile {
	xmlId: number;
	x: number;
	y: number;
	terrain: string | null;
	height: string | null;
	vegetation: string | null;
	riverW: boolean;
	riverSw: boolean;
	riverSe: boolean;
	resource: string | null;
	improvement: string | null;
	improvementPillaged: boolean;
	improvementDisabled: boolean;
	improvementTurnsLeft: number | null;
	specialist: string | null;
	hasRoad: boolean;
	ownerPlayerXmlId: number | null;
	tribeSite: string | null;
	religion: string | null;
	// i64 in Rust — kept as JSON string at the dump boundary to dodge
	// JS Number precision loss. Null when absent.
	initSeed: string | null;
	turnSeed: string | null;
}

export interface TileVisibility {
	tileXmlId: number;
	teamId: number;
	revealedTurn: number;
	visibleOwnerPlayerXmlId: number | null;
}

export interface TileChange {
	tileXmlId: number;
	turn: number;
	changeType: "terrain" | "vegetation";
	newValue: string;
}

// ---------- Helpers ----------

function* eachTile(
	root: Record<string, unknown>,
): Generator<[number, Record<string, unknown>]> {
	for (const node of asArray(root.Tile) as unknown[]) {
		if (!isElement(node)) continue;
		const tileXmlId = requireInt(node["@_ID"], "Tile.ID");
		yield [tileXmlId, node];
	}
}

/**
 * Lenient parse of `<OwnerHistory>` returning the latest non-negative owner.
 *
 * Mirrors tiles.rs:70–96 — silently skips:
 *   - tags that don't start with `T`
 *   - tags whose `T`-stripped suffix isn't a parseable int
 *   - text values that aren't parseable ints
 * The latest-by-turn owner wins; values < 0 (the "unowned" sentinel) filter
 * to null.
 */
function parseLatestOwnerFromHistory(node: unknown): number | null {
	if (!isElement(node)) return null;
	let maxTurn = -1;
	let latestOwner: number | null = null;
	for (const [tag, value] of getElementChildren(node)) {
		if (!tag.startsWith("T")) continue;
		const turn = parseInt(tag.slice(1), 10);
		if (Number.isNaN(turn)) continue;
		if (typeof value !== "string" || value === "") continue;
		const owner = parseInt(value, 10);
		if (Number.isNaN(owner)) continue;
		if (turn > maxTurn) {
			maxTurn = turn;
			latestOwner = owner;
		}
	}
	return latestOwner !== null && latestOwner >= 0 ? latestOwner : null;
}

/**
 * Strict parse of a `TerrainHistory`/`VegetationHistory` section.
 * Mirrors tile_data.rs:121–146 — errors on bad turn tags or missing text.
 * Non-`T`-prefixed tags are silently skipped (Rust does the same via the
 * `if let Some(turn_str) = ...strip_prefix('T')` early-out).
 */
function collectTileHistory(
	node: unknown,
	tileXmlId: number,
	changeType: "terrain" | "vegetation",
	parentLabel: string,
): TileChange[] {
	if (!isElement(node)) return [];
	const out: TileChange[] = [];
	for (const [tag, value] of getElementChildren(node)) {
		if (!tag.startsWith("T")) continue;
		const turnSuffix = tag.slice(1);
		if (turnSuffix === "") {
			throw new ParseError(`Invalid turn tag: ${tag}`, "INVALID_FORMAT");
		}
		const turn = parseInt(turnSuffix, 10);
		if (Number.isNaN(turn)) {
			throw new ParseError(`Invalid turn tag: ${tag}`, "INVALID_FORMAT");
		}
		if (typeof value !== "string" || value === "") {
			throw new ParseError(
				`Missing text at ${parentLabel}.${tag}`,
				"MISSING_FIELD",
			);
		}
		out.push({
			tileXmlId,
			turn,
			changeType,
			newValue: value,
		});
	}
	return out;
}

// ---------- Tiles core (tiles.rs) ----------

export function parseTiles(root: Record<string, unknown>): Tile[] {
	const mapWidth = requireInt(root["@_MapWidth"], "Root.MapWidth");
	const tiles: Tile[] = [];

	for (const [xmlId, node] of eachTile(root)) {
		// Tiles are indexed sequentially: id = y * width + x.
		const x = xmlId % mapWidth;
		const y = Math.floor(xmlId / mapWidth);

		tiles.push({
			xmlId,
			x,
			y,
			terrain: optStr(node.Terrain),
			height: optStr(node.Height),
			vegetation: optStr(node.Vegetation),
			riverW: optStr(node.RiverW) === "true",
			riverSw: optStr(node.RiverSW) === "true",
			riverSe: optStr(node.RiverSE) === "true",
			resource: optStr(node.Resource),
			improvement: optStr(node.Improvement),
			improvementPillaged: optStr(node.ImprovementPillaged) === "true",
			improvementDisabled: optStr(node.ImprovementDisabled) === "true",
			improvementTurnsLeft: optInt(node.ImprovementTurnsLeft),
			specialist: optStr(node.Specialist),
			// fast-xml-parser represents <Road/> as `Road: ""`, so the key
			// presence check correctly distinguishes "has road" from "no road".
			hasRoad: "Road" in node,
			ownerPlayerXmlId: parseLatestOwnerFromHistory(node.OwnerHistory),
			tribeSite: optStr(node.TribeSite),
			religion: optStr(node.Religion),
			initSeed: optI64Str(node.InitSeed),
			turnSeed: optI64Str(node.TurnSeed),
		});
	}

	return tiles;
}

// ---------- Tile visibility (tile_data.rs:18–93) ----------

export function parseTileVisibility(
	root: Record<string, unknown>,
): TileVisibility[] {
	const out: TileVisibility[] = [];

	for (const [tileXmlId, node] of eachTile(root)) {
		const revealedTurns = parsePrefixedKeyedIntMap(node.RevealedTurn, "TEAM_");
		const revealedOwners = parsePrefixedKeyedIntMap(
			node.RevealedOwner,
			"TEAM_",
		);

		// Asymmetric union: emit one row per RevealedTurn entry only.
		// RevealedOwner entries without a matching RevealedTurn produce no
		// row. Mirrors tile_data.rs:80–90.
		for (const [teamId, revealedTurn] of revealedTurns) {
			out.push({
				tileXmlId,
				teamId,
				revealedTurn,
				visibleOwnerPlayerXmlId: revealedOwners.get(teamId) ?? null,
			});
		}
	}

	return out;
}

// ---------- Tile ownership history (entities/tiles.rs:343–404) ----------
//
// Each `<OwnerHistory>` block holds `<TX>player_xml_id</TX>` children
// recording every change of ownership. Owner = -1 means "unowned" — emitted
// as null. Cloud-blob equivalent of the desktop's `tile_ownership_history`
// table. Mirrors `parse_tile_ownership_history` in
// src-tauri/src/parser/entities/tiles.rs.

export interface TileOwnership {
	tileXmlId: number;
	turn: number;
	ownerPlayerXmlId: number | null;
}

export function parseTileOwnershipHistory(
	root: Record<string, unknown>,
): TileOwnership[] {
	const out: TileOwnership[] = [];

	for (const [tileXmlId, node] of eachTile(root)) {
		const historyNode = node.OwnerHistory;
		if (!isElement(historyNode)) continue;

		for (const [tag, value] of getElementChildren(historyNode)) {
			if (!tag.startsWith("T")) continue;
			const turnSuffix = tag.slice(1);
			if (turnSuffix === "") continue;
			const turn = parseInt(turnSuffix, 10);
			if (Number.isNaN(turn)) continue;
			if (typeof value !== "string" || value === "") continue;
			const ownerRaw = parseInt(value, 10);
			if (Number.isNaN(ownerRaw)) continue;

			out.push({
				tileXmlId,
				turn,
				ownerPlayerXmlId: ownerRaw >= 0 ? ownerRaw : null,
			});
		}
	}

	return out;
}

// ---------- Tile changes (tile_data.rs:99–179) ----------

export function parseTileChanges(
	root: Record<string, unknown>,
): TileChange[] {
	const out: TileChange[] = [];

	for (const [tileXmlId, node] of eachTile(root)) {
		out.push(
			...collectTileHistory(
				node.TerrainHistory,
				tileXmlId,
				"terrain",
				"TerrainHistory",
			),
		);
		out.push(
			...collectTileHistory(
				node.VegetationHistory,
				tileXmlId,
				"vegetation",
				"VegetationHistory",
			),
		);
	}

	return out;
}

// ---------- ToRow mappers (snake_case wire format) ----------

export function tileToRow(t: Tile): Record<string, unknown> {
	return {
		xml_id: t.xmlId,
		x: t.x,
		y: t.y,
		terrain: t.terrain,
		height: t.height,
		vegetation: t.vegetation,
		river_w: t.riverW,
		river_sw: t.riverSw,
		river_se: t.riverSe,
		resource: t.resource,
		improvement: t.improvement,
		improvement_pillaged: t.improvementPillaged,
		improvement_disabled: t.improvementDisabled,
		improvement_turns_left: t.improvementTurnsLeft,
		specialist: t.specialist,
		has_road: t.hasRoad,
		owner_player_xml_id: t.ownerPlayerXmlId,
		tribe_site: t.tribeSite,
		religion: t.religion,
		// i64 fields: pre-stringified by the parser via optI64Str.
		init_seed: t.initSeed,
		turn_seed: t.turnSeed,
	};
}

export function tileVisibilityToRow(
	v: TileVisibility,
): Record<string, unknown> {
	return {
		tile_xml_id: v.tileXmlId,
		team_id: v.teamId,
		revealed_turn: v.revealedTurn,
		visible_owner_player_xml_id: v.visibleOwnerPlayerXmlId,
	};
}

export function tileChangeToRow(c: TileChange): Record<string, unknown> {
	return {
		tile_xml_id: c.tileXmlId,
		turn: c.turn,
		change_type: c.changeType,
		new_value: c.newValue,
	};
}

export function tileOwnershipToRow(o: TileOwnership): Record<string, unknown> {
	return {
		tile_xml_id: o.tileXmlId,
		turn: o.turn,
		owner_player_xml_id: o.ownerPlayerXmlId,
	};
}
