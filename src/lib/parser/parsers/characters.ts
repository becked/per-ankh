// Character entity parser. Direct port of
// src-tauri/src/parser/parsers/characters.rs.

import {
	asArray,
	getElementChildren,
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
	suffix: number;
	archetype: string | null;
	portrait: string | null;
	xp: number;
	level: number;
	// The four Old World character ratings (RATING_WISDOM/CHARISMA/COURAGE/
	// DISCIPLINE), read from the character's <Rating> block. Null when absent.
	wisdom: number | null;
	charisma: number | null;
	courage: number | null;
	discipline: number | null;
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

// A character's archetype is recorded as a self-named trait ending in
// `_ARCHETYPE` (e.g. TRAIT_SCHOLAR_ARCHETYPE) inside <TraitTurn>, not as a
// dedicated element. Returns the raw trait token, or null if none.
function archetypeFromTraits(node: Record<string, unknown>): string | null {
	const traitTurn = node.TraitTurn;
	if (!isElement(traitTurn)) return null;
	for (const [name] of getElementChildren(traitTurn)) {
		if (name.endsWith("_ARCHETYPE")) return name;
	}
	return null;
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

		// Ratings live in a <Rating> block keyed by RATING_*; read the four
		// fixed character ratings when present.
		const ratingNode = isElement(node.Rating) ? node.Rating : null;

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
			// Regnal numeral (the "II" in "Meera II"). Old World serializes
			// <Suffix> only when > 1, so an absent tag means first-of-the-name.
			suffix: optInt(node.Suffix) ?? 1,
			// Archetype is encoded as a *_ARCHETYPE trait; <Archetype> is a
			// fallback for any save format that carries it as an element.
			archetype: archetypeFromTraits(node) ?? optStr(node.Archetype),
			portrait: optStr(node.Portrait),
			xp: optInt(node.XP) ?? 0,
			level: optInt(node.Level) ?? 1,
			wisdom: ratingNode ? optInt(ratingNode.RATING_WISDOM) : null,
			charisma: ratingNode ? optInt(ratingNode.RATING_CHARISMA) : null,
			courage: ratingNode ? optInt(ratingNode.RATING_COURAGE) : null,
			discipline: ratingNode ? optInt(ratingNode.RATING_DISCIPLINE) : null,
			// Presence flag: <Royal/> marks royalty (any dynasty member), not
			// just rulers — leaders are identified by becameLeaderTurn.
			isRoyal: "Royal" in node,
			isInfertile: optStr(node.IsInfertile) === "true",
			// Accession turn: the real tag is <LeaderTurn> (not BecameLeaderTurn).
			becameLeaderTurn: optInt(node.LeaderTurn),
			abdicatedTurn: optInt(node.AbdicateTurn),
			// Still hardcoded — these aren't extracted from XML.
			wasReligionHead: false,
			wasFamilyHead: false,
			nationJoinedTurn: optInt(node.NationTurn),
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
		suffix: c.suffix,
		archetype: c.archetype,
		portrait: c.portrait,
		xp: c.xp,
		level: c.level,
		wisdom: c.wisdom,
		charisma: c.charisma,
		courage: c.courage,
		discipline: c.discipline,
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
