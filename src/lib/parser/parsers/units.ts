// Unit entity + 5 sub-entity parsers. Direct port of
// src-tauri/src/parser/parsers/units.rs and unit_production.rs.
//
// Units are nested inside Tile elements. The first 4 parsers walk
// tiles → units; the last 2 (player_units_produced, city_units_produced)
// iterate Players and Cities directly for aggregate counts.

import { ParseError } from "../extract-zip.js";
import {
	asArray,
	getElementChildren,
	isElement,
	optAttrStr,
	optI64Str,
	optInt,
	optStr,
	requireInt,
	requireStr,
} from "../parse-xml.js";

// ---------- Types ----------

export interface Unit {
	xmlId: number;
	tileXmlId: number;
	unitType: string;
	playerXmlId: number | null;
	tribe: string | null;
	xp: number | null;
	level: number | null;
	createTurn: number | null;
	facing: string | null;
	originalPlayerXmlId: number | null;
	turnsSinceLastMove: number | null;
	gender: string | null;
	isSleeping: boolean;
	currentFormation: string | null;
	// i64 seed; kept as string at the dump boundary to dodge JS Number
	// precision loss. Null when absent.
	seed: string | null;
}

export interface UnitPromotion {
	unitXmlId: number;
	promotion: string;
	isAcquired: boolean;
}

export interface UnitEffect {
	unitXmlId: number;
	effect: string;
	stacks: number;
}

export interface UnitFamily {
	unitXmlId: number;
	playerXmlId: number;
	familyName: string;
}

export interface PlayerUnitProduction {
	playerXmlId: number;
	unitType: string;
	count: number;
}

export interface CityUnitProduction {
	cityXmlId: number;
	unitType: string;
	count: number;
}

// ---------- Helpers ----------

/**
 * Yield [unitXmlId, tileXmlId, unitNode] for every <Unit> nested under a
 * <Tile>. Mirrors the two-level Rust iteration in units.rs:23–26.
 */
function* eachUnit(
	root: Record<string, unknown>,
): Generator<[number, number, Record<string, unknown>]> {
	for (const tileNode of asArray(root.Tile) as unknown[]) {
		if (!isElement(tileNode)) continue;
		const tileXmlId = requireInt(tileNode["@_ID"], "Tile.ID");
		for (const unitNode of asArray(tileNode.Unit) as unknown[]) {
			if (!isElement(unitNode)) continue;
			const unitXmlId = requireInt(unitNode["@_ID"], "Unit.ID");
			yield [unitXmlId, tileXmlId, unitNode];
		}
	}
}

/**
 * Strict-mode parser for `<UnitsProduced>` / `<UnitProductionCounts>` —
 * named-int-children where missing text or unparseable values throw.
 * Mirrors unit_production.rs:26–31 (uses `?` to propagate errors).
 */
function parseStrictUnitCounts(
	node: unknown,
	parentLabel: string,
): Array<{ unitType: string; count: number }> {
	const out: Array<{ unitType: string; count: number }> = [];
	if (!isElement(node)) return out;
	for (const [unitType, value] of getElementChildren(node)) {
		if (typeof value !== "string" || value === "") {
			throw new ParseError(`${parentLabel}/${unitType} text`, "MISSING_FIELD");
		}
		const count = parseInt(value, 10);
		if (Number.isNaN(count)) {
			throw new ParseError(
				`${parentLabel}/${unitType} not parseable as int: ${value}`,
				"INVALID_FORMAT",
			);
		}
		out.push({ unitType, count });
	}
	return out;
}

// ---------- Units core (units.rs:23–80) ----------

export function parseUnits(root: Record<string, unknown>): Unit[] {
	const units: Unit[] = [];

	for (const [xmlId, tileXmlId, node] of eachUnit(root)) {
		const unitType = requireStr(node["@_Type"], "Unit.Type");

		// Player attribute, sentinel-filtered (-1 → null).
		const playerRaw = optInt(node["@_Player"]);
		const playerXmlId = playerRaw === null || playerRaw < 0 ? null : playerRaw;

		// OriginalPlayer is a child element, NOT an attribute.
		const originalPlayerRaw = optInt(node.OriginalPlayer);
		const originalPlayerXmlId =
			originalPlayerRaw === null || originalPlayerRaw < 0
				? null
				: originalPlayerRaw;

		units.push({
			xmlId,
			tileXmlId,
			unitType,
			playerXmlId,
			tribe: optAttrStr(node["@_Tribe"]),
			xp: optInt(node.XP),
			level: optInt(node.Level),
			createTurn: optInt(node.CreateTurn),
			facing: optStr(node.Facing),
			originalPlayerXmlId,
			turnsSinceLastMove: optInt(node.TurnsSinceLastMove),
			gender: optStr(node.Gender),
			isSleeping: "Sleep" in node,
			currentFormation: optStr(node.CurrentFormation),
			// Seed is an i64 attribute (not a child element).
			seed: optI64Str(node["@_Seed"]),
		});
	}

	return units;
}

// ---------- Unit promotions (units.rs:83–105) ----------

export function parseUnitPromotions(
	root: Record<string, unknown>,
): UnitPromotion[] {
	const out: UnitPromotion[] = [];

	for (const [unitXmlId, , node] of eachUnit(root)) {
		// Acquired promotions first.
		const promosNode = node.Promotions;
		if (isElement(promosNode)) {
			for (const [promotion] of getElementChildren(promosNode)) {
				out.push({ unitXmlId, promotion, isAcquired: true });
			}
		}

		// Then available promotions.
		const availNode = node.PromotionsAvailable;
		if (isElement(availNode)) {
			for (const [promotion] of getElementChildren(availNode)) {
				out.push({ unitXmlId, promotion, isAcquired: false });
			}
		}
	}

	return out;
}

// ---------- Unit effects (units.rs:108–123) ----------

export function parseUnitEffects(root: Record<string, unknown>): UnitEffect[] {
	const out: UnitEffect[] = [];

	for (const [unitXmlId, , node] of eachUnit(root)) {
		const effectsNode = node.BonusEffectUnits;
		if (!isElement(effectsNode)) continue;

		for (const [effect, value] of getElementChildren(effectsNode)) {
			// Default 1 (not 0) per units.rs:116 unwrap_or(1).
			const stacks = optInt(value) ?? 1;
			out.push({ unitXmlId, effect, stacks });
		}
	}

	return out;
}

// ---------- Unit families (units.rs:126–145) ----------

export function parseUnitFamilies(root: Record<string, unknown>): UnitFamily[] {
	const out: UnitFamily[] = [];

	for (const [unitXmlId, , node] of eachUnit(root)) {
		const familyNode = node.PlayerFamily;
		if (!isElement(familyNode)) continue;

		// <P.X>FAMILY_NAME</P.X> shape; same inline pattern as
		// city_culture's TeamCulture parse. Skip non-P.* tags, unparseable
		// player IDs, and empty values (the empty-value filter mirrors
		// Rust's `if let Some(family_name) = child.text()` short-circuit).
		for (const [tag, value] of getElementChildren(familyNode)) {
			if (!tag.startsWith("P.")) continue;
			const playerXmlId = parseInt(tag.slice(2), 10);
			if (Number.isNaN(playerXmlId)) continue;
			if (typeof value !== "string" || value === "") continue;
			out.push({ unitXmlId, playerXmlId, familyName: value });
		}
	}

	return out;
}

// ---------- Player units produced (unit_production.rs:10–43) ----------

export function parsePlayerUnitsProduced(
	root: Record<string, unknown>,
): PlayerUnitProduction[] {
	const out: PlayerUnitProduction[] = [];

	for (const playerNode of asArray(root.Player) as unknown[]) {
		if (!isElement(playerNode)) continue;
		const playerXmlId = requireInt(playerNode["@_ID"], "Player.ID");

		const unitsProducedNode = playerNode.UnitsProduced;
		const counts = parseStrictUnitCounts(unitsProducedNode, "UnitsProduced");
		for (const { unitType, count } of counts) {
			out.push({ playerXmlId, unitType, count });
		}
	}

	return out;
}

// ---------- City units produced (unit_production.rs:48–84) ----------

export function parseCityUnitsProduced(
	root: Record<string, unknown>,
): CityUnitProduction[] {
	const out: CityUnitProduction[] = [];

	for (const cityNode of asArray(root.City) as unknown[]) {
		if (!isElement(cityNode)) continue;
		const cityXmlId = requireInt(cityNode["@_ID"], "City.ID");

		const productionNode = cityNode.UnitProductionCounts;
		const counts = parseStrictUnitCounts(
			productionNode,
			"UnitProductionCounts",
		);
		for (const { unitType, count } of counts) {
			out.push({ cityXmlId, unitType, count });
		}
	}

	return out;
}

// ---------- ToRow mappers (snake_case wire format) ----------

export function unitToRow(u: Unit): Record<string, unknown> {
	return {
		xml_id: u.xmlId,
		tile_xml_id: u.tileXmlId,
		unit_type: u.unitType,
		player_xml_id: u.playerXmlId,
		tribe: u.tribe,
		xp: u.xp,
		level: u.level,
		create_turn: u.createTurn,
		facing: u.facing,
		original_player_xml_id: u.originalPlayerXmlId,
		turns_since_last_move: u.turnsSinceLastMove,
		gender: u.gender,
		is_sleeping: u.isSleeping,
		current_formation: u.currentFormation,
		// i64 seed: pre-stringified by the parser via optI64Str.
		seed: u.seed,
	};
}

export function unitPromotionToRow(p: UnitPromotion): Record<string, unknown> {
	return {
		unit_xml_id: p.unitXmlId,
		promotion: p.promotion,
		is_acquired: p.isAcquired,
	};
}

export function unitEffectToRow(e: UnitEffect): Record<string, unknown> {
	return {
		unit_xml_id: e.unitXmlId,
		effect: e.effect,
		stacks: e.stacks,
	};
}

export function unitFamilyToRow(f: UnitFamily): Record<string, unknown> {
	return {
		unit_xml_id: f.unitXmlId,
		player_xml_id: f.playerXmlId,
		family_name: f.familyName,
	};
}

export function playerUnitProductionToRow(
	p: PlayerUnitProduction,
): Record<string, unknown> {
	return {
		player_xml_id: p.playerXmlId,
		unit_type: p.unitType,
		count: p.count,
	};
}

export function cityUnitProductionToRow(
	c: CityUnitProduction,
): Record<string, unknown> {
	return {
		city_xml_id: c.cityXmlId,
		unit_type: c.unitType,
		count: c.count,
	};
}
