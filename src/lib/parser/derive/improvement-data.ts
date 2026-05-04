// derive/improvement-data.ts — port of get_improvement_data (map.rs:291–320).
//
// One row per tile with a non-null improvement, joined against the tile's
// owning city + player. The city is resolved via `tile.cityTerritoryXmlId`
// (the tile's `<CityTerritory>` field) and the player via the owning
// city's `playerXmlId`. ORDER BY p.nation, c.city_name, t.improvement.

import type { City } from "../parsers/cities.js";
import type { Player } from "../parsers/players.js";
import type { Tile } from "../parsers/tiles.js";
import type { ImprovementData, ImprovementInfo } from "../types.js";
import { playerByXmlId, strCmp } from "./_helpers.js";

export function deriveImprovementData(
	tiles: Tile[],
	cities: City[],
	players: Player[],
): ImprovementData {
	const playerMap = playerByXmlId(players);
	const cityMap = new Map<number, City>();
	for (const c of cities) cityMap.set(c.xmlId, c);

	const improvements: ImprovementInfo[] = [];

	for (const t of tiles) {
		if (t.improvement === null) continue;
		const city =
			t.cityTerritoryXmlId !== null
				? cityMap.get(t.cityTerritoryXmlId)
				: undefined;
		const owner =
			city?.playerXmlId !== null && city?.playerXmlId !== undefined
				? playerMap.get(city.playerXmlId)
				: undefined;
		improvements.push({
			nation: owner?.nation ?? null,
			city_name: city?.cityName ?? null,
			improvement: t.improvement,
			specialist: t.specialist,
			resource: t.resource,
		});
	}

	improvements.sort(
		(a, b) =>
			strCmp(a.nation ?? "", b.nation ?? "") ||
			strCmp(a.city_name ?? "", b.city_name ?? "") ||
			strCmp(a.improvement, b.improvement),
	);

	return { improvements };
}
