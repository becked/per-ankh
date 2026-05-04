// Religion entity parser. Direct port of
// src-tauri/src/parser/parsers/religions.rs.
//
// Religions don't appear as discrete <Religion> elements in saves. Instead,
// the <Game> element holds four name-keyed-integer containers:
// ReligionFounded, ReligionHeadID, ReligionHolyCity, ReligionFounder. Each
// child element is named after a religion (e.g. RELIGION_CHRISTIANITY) with
// integer text content. The parser unions the keys across all four to form
// the row set.

import { isElement, parseNameKeyedIntMap } from "../parse-xml.js";

export interface Religion {
	religionName: string;
	foundedTurn: number | null;
	founderPlayerXmlId: number | null;
	headCharacterXmlId: number | null;
	holyCityXmlId: number | null;
}

export function parseReligions(root: Record<string, unknown>): Religion[] {
	const gameNode = root.Game;
	if (!isElement(gameNode)) return [];

	const founded = parseNameKeyedIntMap(gameNode.ReligionFounded);
	const founder = parseNameKeyedIntMap(gameNode.ReligionFounder);
	const heads = parseNameKeyedIntMap(gameNode.ReligionHeadID);
	const holyCity = parseNameKeyedIntMap(gameNode.ReligionHolyCity);

	const names = new Set<string>([
		...founded.keys(),
		...founder.keys(),
		...heads.keys(),
		...holyCity.keys(),
	]);

	const religions: Religion[] = [];
	for (const religionName of names) {
		religions.push({
			religionName,
			foundedTurn: founded.get(religionName) ?? null,
			founderPlayerXmlId: founder.get(religionName) ?? null,
			headCharacterXmlId: heads.get(religionName) ?? null,
			holyCityXmlId: holyCity.get(religionName) ?? null,
		});
	}

	return religions;
}

export function religionToRow(r: Religion): Record<string, unknown> {
	return {
		religion_name: r.religionName,
		founded_turn: r.foundedTurn,
		founder_player_xml_id: r.founderPlayerXmlId,
		head_character_xml_id: r.headCharacterXmlId,
		holy_city_xml_id: r.holyCityXmlId,
	};
}
