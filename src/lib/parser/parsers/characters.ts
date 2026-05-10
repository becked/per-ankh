// Character entity parser. Direct port of
// src-tauri/src/parser/parsers/characters.rs.

import {
	asArray,
	isElement,
	optAttrStr,
	optInt,
	optStr,
	requireInt,
} from "../parse-xml.js";

export interface Character {
	xmlId: number;
	firstName: string | null;
	gender: string | null;
	playerXmlId: number | null;
	tribe: string | null;
	family: string | null;
	nation: string | null;
	religion: string | null;
	birthTurn: number;
	deathTurn: number | null;
	deathReason: string | null;
	birthFatherXmlId: number | null;
	birthMotherXmlId: number | null;
	birthCityXmlId: number | null;
	cognomen: string | null;
	archetype: string | null;
	portrait: string | null;
	xp: number;
	level: number;
	isRoyal: boolean;
	isInfertile: boolean;
	becameLeaderTurn: number | null;
	abdicatedTurn: number | null;
	wasReligionHead: boolean;
	wasFamilyHead: boolean;
	nationJoinedTurn: number | null;
	// i64 in Rust; emitted as a JSON string at the dump boundary when set.
	// The Rust parser currently hardcodes None, so this is always null here.
	seed: string | null;
}

export function parseCharacters(root: Record<string, unknown>): Character[] {
	const characters: Character[] = [];

	for (const node of asArray(root.Character) as unknown[]) {
		if (!isElement(node)) continue;

		const xmlId = requireInt(node["@_ID"], "Character.ID");
		const birthTurn = requireInt(node["@_BirthTurn"], "Character.BirthTurn");

		// Player="-1" means tribal/unowned; preserve null for those.
		const playerRaw = optInt(node["@_Player"]);
		const playerXmlId = playerRaw === null || playerRaw < 0 ? null : playerRaw;

		characters.push({
			xmlId,
			firstName: optAttrStr(node["@_FirstName"]),
			gender: optAttrStr(node["@_Gender"]),
			playerXmlId,
			tribe: optStr(node.Tribe),
			family: optStr(node.Family),
			nation: optStr(node.Nation),
			religion: optStr(node.Religion),
			birthTurn,
			deathTurn: optInt(node.DeathTurn),
			deathReason: optStr(node.DeathReason),
			birthFatherXmlId: optInt(node.BirthFatherID),
			birthMotherXmlId: optInt(node.BirthMotherID),
			birthCityXmlId: optInt(node.BirthCityID),
			cognomen: optStr(node.Cognomen),
			archetype: optStr(node.Archetype),
			portrait: optStr(node.Portrait),
			xp: optInt(node.XP) ?? 0,
			level: optInt(node.Level) ?? 1,
			isRoyal: optStr(node.IsRoyal) === "true",
			isInfertile: optStr(node.IsInfertile) === "true",
			becameLeaderTurn: optInt(node.BecameLeaderTurn),
			// Hardcoded in the Rust parser — these fields exist on the struct
			// but aren't extracted from XML.
			abdicatedTurn: null,
			wasReligionHead: false,
			wasFamilyHead: false,
			nationJoinedTurn: null,
			seed: null,
		});
	}

	return characters;
}

export function characterToRow(c: Character): Record<string, unknown> {
	return {
		xml_id: c.xmlId,
		first_name: c.firstName,
		gender: c.gender,
		player_xml_id: c.playerXmlId,
		tribe: c.tribe,
		family: c.family,
		nation: c.nation,
		religion: c.religion,
		birth_turn: c.birthTurn,
		death_turn: c.deathTurn,
		death_reason: c.deathReason,
		birth_father_xml_id: c.birthFatherXmlId,
		birth_mother_xml_id: c.birthMotherXmlId,
		birth_city_xml_id: c.birthCityXmlId,
		cognomen: c.cognomen,
		archetype: c.archetype,
		portrait: c.portrait,
		xp: c.xp,
		level: c.level,
		is_royal: c.isRoyal,
		is_infertile: c.isInfertile,
		became_leader_turn: c.becameLeaderTurn,
		abdicated_turn: c.abdicatedTurn,
		was_religion_head: c.wasReligionHead,
		was_family_head: c.wasFamilyHead,
		nation_joined_turn: c.nationJoinedTurn,
		// seed is i64 in Rust; emit as JSON string when set, null when unset.
		seed: c.seed,
	};
}
