// Character extended data parsers. Direct port of
// src-tauri/src/parser/parsers/character_data.rs. Four collections:
// stats, traits, relationships, marriages.

import { ParseError } from "../extract-zip.js";
import {
	asArray,
	collectStrictNamedInts,
	isElement,
	optInt,
	optStr,
	requireInt,
} from "../parse-xml.js";

// ---------- Types ----------

export interface CharacterStat {
	characterXmlId: number;
	statName: string;
	statValue: number;
}

export interface CharacterTrait {
	characterXmlId: number;
	traitName: string;
	acquiredTurn: number;
	removedTurn: number | null;
}

export interface CharacterRelationship {
	characterXmlId: number;
	relatedCharacterXmlId: number;
	relationshipType: string;
	relationshipValue: number | null;
	startedTurn: number | null;
	endedTurn: number | null;
}

export interface CharacterMarriage {
	characterXmlId: number;
	spouseXmlId: number;
	marriedTurn: number;
	divorcedTurn: number | null;
}

// ---------- Helpers ----------

function* eachCharacter(
	root: Record<string, unknown>,
): Generator<[number, Record<string, unknown>]> {
	for (const node of asArray(root.Character) as unknown[]) {
		if (!isElement(node)) continue;
		const characterXmlId = requireInt(node["@_ID"], "Character.ID");
		yield [characterXmlId, node];
	}
}

// ---------- Character stats (character_data.rs:20–70) ----------

export function parseCharacterStats(
	root: Record<string, unknown>,
): CharacterStat[] {
	const out: CharacterStat[] = [];

	for (const [characterXmlId, node] of eachCharacter(root)) {
		// Rating elements (RATING_WISDOM, RATING_CHARISMA, etc.) — Rust walks
		// these first.
		for (const { name, value } of collectStrictNamedInts(
			node.Rating,
			"Rating",
		)) {
			out.push({ characterXmlId, statName: name, statValue: value });
		}
		// Then Stat elements (STAT_KILLS, STAT_CITY_FOUNDED, etc.).
		for (const { name, value } of collectStrictNamedInts(node.Stat, "Stat")) {
			out.push({ characterXmlId, statName: name, statValue: value });
		}
	}

	return out;
}

// ---------- Character traits (character_data.rs:76–109) ----------

export function parseCharacterTraits(
	root: Record<string, unknown>,
): CharacterTrait[] {
	const out: CharacterTrait[] = [];

	for (const [characterXmlId, node] of eachCharacter(root)) {
		for (const { name, value } of collectStrictNamedInts(
			node.TraitTurn,
			"TraitTurn",
		)) {
			out.push({
				characterXmlId,
				traitName: name,
				acquiredTurn: value,
				// Hardcoded null in the Rust parser — would require historical
				// tracking to populate.
				removedTurn: null,
			});
		}
	}

	return out;
}

// ---------- Character relationships (character_data.rs:115–188) ----------

export function parseCharacterRelationships(
	root: Record<string, unknown>,
): CharacterRelationship[] {
	const out: CharacterRelationship[] = [];

	for (const [characterXmlId, node] of eachCharacter(root)) {
		const relList = node.RelationshipList;
		if (!isElement(relList)) continue;

		for (const rel of asArray(relList.RelationshipData) as unknown[]) {
			if (!isElement(rel)) continue;

			// Type is required; missing/empty → error.
			const relationshipType = optStr(rel.Type);
			if (relationshipType === null) {
				throw new ParseError("RelationshipData.Type", "MISSING_FIELD");
			}

			// CharacterID has hybrid semantics: missing → silent skip of the
			// entire row (mirrors Rust `None => continue`); present but
			// unparseable → error.
			const charIdRaw = optStr(rel.CharacterID);
			if (charIdRaw === null) continue;
			const relatedCharacterXmlId = parseInt(charIdRaw, 10);
			if (Number.isNaN(relatedCharacterXmlId)) {
				throw new ParseError(
					`Invalid character ID in relationship: ${charIdRaw}`,
					"INVALID_FORMAT",
				);
			}

			// Turn and Value are lenient optional ints.
			const startedTurn = optInt(rel.Turn);
			const relationshipValue = optInt(rel.Value);

			out.push({
				characterXmlId,
				relatedCharacterXmlId,
				relationshipType,
				relationshipValue,
				startedTurn,
				// Hardcoded null in the Rust parser.
				endedTurn: null,
			});
		}
	}

	return out;
}

// ---------- Character marriages (character_data.rs:194–225) ----------

export function parseCharacterMarriages(
	root: Record<string, unknown>,
): CharacterMarriage[] {
	const out: CharacterMarriage[] = [];

	for (const [characterXmlId, node] of eachCharacter(root)) {
		const spousesNode = node.Spouses;
		if (!isElement(spousesNode)) continue;

		// Each <ID>X</ID> child carries a spouse's XML ID. asArray normalizes
		// single vs multi-spouse shapes (leaf-text elements aren't auto-
		// wrapped by my isArray predicate, so we get string | string[]).
		for (const idVal of asArray(spousesNode.ID) as unknown[]) {
			if (typeof idVal !== "string" || idVal === "") {
				throw new ParseError("Spouses.ID text", "MISSING_FIELD");
			}
			const spouseXmlId = parseInt(idVal, 10);
			if (Number.isNaN(spouseXmlId)) {
				throw new ParseError(`Invalid spouse ID: ${idVal}`, "INVALID_FORMAT");
			}
			out.push({
				characterXmlId,
				spouseXmlId,
				// Literal -1 sentinel: the parse layer doesn't have marriage-
				// turn data; downstream code interprets -1 as "unknown turn".
				// NOT null — keep parity with Rust character_data.rs:219.
				marriedTurn: -1,
				divorcedTurn: null,
			});
		}
	}

	return out;
}

// ---------- ToRow mappers (snake_case wire format) ----------

export function characterStatToRow(s: CharacterStat): Record<string, unknown> {
	return {
		character_xml_id: s.characterXmlId,
		stat_name: s.statName,
		stat_value: s.statValue,
	};
}

export function characterTraitToRow(
	t: CharacterTrait,
): Record<string, unknown> {
	return {
		character_xml_id: t.characterXmlId,
		trait_name: t.traitName,
		acquired_turn: t.acquiredTurn,
		removed_turn: t.removedTurn,
	};
}

export function characterRelationshipToRow(
	r: CharacterRelationship,
): Record<string, unknown> {
	return {
		character_xml_id: r.characterXmlId,
		related_character_xml_id: r.relatedCharacterXmlId,
		relationship_type: r.relationshipType,
		relationship_value: r.relationshipValue,
		started_turn: r.startedTurn,
		ended_turn: r.endedTurn,
	};
}

export function characterMarriageToRow(
	m: CharacterMarriage,
): Record<string, unknown> {
	return {
		character_xml_id: m.characterXmlId,
		spouse_xml_id: m.spouseXmlId,
		married_turn: m.marriedTurn,
		divorced_turn: m.divorcedTurn,
	};
}
