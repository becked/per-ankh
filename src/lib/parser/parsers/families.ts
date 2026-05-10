// Family entity parser. Direct port of
// src-tauri/src/parser/parsers/families.rs.
//
// Families have no XML ID — they're identified by name (e.g. "FAMILY_FABIUS").
// Per-player family state is encoded as three sibling elements on each Player:
// FamilyHeadID, FamilySeatCityID, FamilyTurnsNoLeader. The global FamilyClass
// element maps family names to their class (e.g. FAMILYCLASS_CHAMPIONS).

import {
	asArray,
	findDescendant,
	getElementChildren,
	isElement,
	parseNameKeyedIntMap,
	requireInt,
} from "../parse-xml.js";

export interface Family {
	familyName: string;
	familyClass: string;
	playerXmlId: number;
	headCharacterXmlId: number | null;
	seatCityXmlId: number | null;
	turnsWithoutLeader: number;
}

export function parseFamilies(root: Record<string, unknown>): Family[] {
	const familyClasses = parseFamilyClasses(root);
	const families: Family[] = [];

	for (const player of asArray(root.Player) as unknown[]) {
		if (!isElement(player)) continue;
		const playerXmlId = requireInt(player["@_ID"], "Player.ID");

		const heads = parseNameKeyedIntMap(player.FamilyHeadID);
		const seats = parseNameKeyedIntMap(player.FamilySeatCityID);
		const turnsNoLeader = parseNameKeyedIntMap(player.FamilyTurnsNoLeader);

		const playerFamilies = new Set<string>([
			...heads.keys(),
			...seats.keys(),
			...turnsNoLeader.keys(),
		]);

		for (const familyName of playerFamilies) {
			families.push({
				familyName,
				familyClass: familyClasses.get(familyName) ?? "",
				playerXmlId,
				headCharacterXmlId: heads.get(familyName) ?? null,
				seatCityXmlId: seats.get(familyName) ?? null,
				turnsWithoutLeader: turnsNoLeader.get(familyName) ?? 0,
			});
		}
	}

	return families;
}

/**
 * Parse the global `<FamilyClass>` element into a name → class map.
 *
 * Looks for a direct child of the root first, falling back to a depth-first
 * descendant search. Mirrors families.rs lines 95–116, where the fallback
 * exists because real saves may nest FamilyClass under unexpected wrappers.
 */
function parseFamilyClasses(
	root: Record<string, unknown>,
): Map<string, string> {
	const classes = new Map<string, string>();
	const classNode = findDescendant(root, "FamilyClass");
	if (!isElement(classNode)) return classes;

	for (const [familyName, value] of getElementChildren(classNode)) {
		if (typeof value === "string" && value !== "") {
			classes.set(familyName, value);
		}
	}
	return classes;
}

export function familyToRow(f: Family): Record<string, unknown> {
	return {
		family_name: f.familyName,
		family_class: f.familyClass,
		player_xml_id: f.playerXmlId,
		head_character_xml_id: f.headCharacterXmlId,
		seat_city_xml_id: f.seatCityXmlId,
		turns_without_leader: f.turnsWithoutLeader,
	};
}
