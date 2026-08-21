// Religion entity parser.
//
// Religions don't appear as discrete <Religion> elements in saves. Instead,
// the <Game> element holds four name-keyed-integer containers:
// ReligionFounded, ReligionHeadID, ReligionHolyCity, ReligionFounder. Each
// child element is named after a religion (e.g. RELIGION_CHRISTIANITY) with
// integer text content. The parser unions the keys across all four to form
// the row set.

import {
	getElementChildren,
	isElement,
	parseNameKeyedIntMap,
} from "../parse-xml.js";

export interface Religion {
	religionName: string;
	foundedTurn: number | null;
	founderPlayerXmlId: number | null;
	headCharacterXmlId: number | null;
	holyCityXmlId: number | null;
	// Theologies the religion has established, from the <Game> element's
	// <ReligionTheology> presence list of dotted composite tags
	// (<RELIGION_X.THEOLOGY_Y />).
	theologies: string[];
}

export function parseReligions(root: Record<string, unknown>): Religion[] {
	const gameNode = root.Game;
	if (!isElement(gameNode)) return [];

	const founded = parseNameKeyedIntMap(gameNode.ReligionFounded);
	const founder = parseNameKeyedIntMap(gameNode.ReligionFounder);
	const heads = parseNameKeyedIntMap(gameNode.ReligionHeadID);
	const holyCity = parseNameKeyedIntMap(gameNode.ReligionHolyCity);

	const theologies = new Map<string, string[]>();
	if (isElement(gameNode.ReligionTheology)) {
		for (const [tag] of getElementChildren(gameNode.ReligionTheology)) {
			const dot = tag.indexOf(".");
			if (dot < 0) continue;
			const religion = tag.slice(0, dot);
			const list = theologies.get(religion) ?? [];
			list.push(tag.slice(dot + 1));
			theologies.set(religion, list);
		}
	}

	const names = new Set<string>([
		...founded.keys(),
		...founder.keys(),
		...heads.keys(),
		...holyCity.keys(),
		...theologies.keys(),
	]);

	const religions: Religion[] = [];
	for (const religionName of names) {
		religions.push({
			religionName,
			foundedTurn: founded.get(religionName) ?? null,
			founderPlayerXmlId: founder.get(religionName) ?? null,
			headCharacterXmlId: heads.get(religionName) ?? null,
			holyCityXmlId: holyCity.get(religionName) ?? null,
			theologies: theologies.get(religionName) ?? [],
		});
	}

	return religions;
}
