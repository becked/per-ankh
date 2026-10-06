// One row per tile with a non-null improvement, joined against the tile's
// owning city + player. The city is resolved via `tile.cityTerritoryXmlId`
// (the tile's `<CityTerritory>` field) and the player via the owning
// city's `playerXmlId`. ORDER BY p.nation, c.city_name, t.improvement.
//
// `specialist` is the specialist the GAME reads off the tile —
// `Tile.getSpecialist` (Tile.cs:6993), the stored one when there is one and a
// neighbouring wonder's free one otherwise. `specialist_granted` says which,
// because the save records only the stored kind (see derive/granted-specialists.ts).

import type { City } from "../parsers/cities.js";
import type { Player } from "../parsers/players.js";
import type { Tile } from "../parsers/tiles.js";
import type { ImprovementData, ImprovementInfo } from "../types.js";
import { playerByXmlId, strCmp } from "./_helpers.js";

export function deriveImprovementData(
	tiles: Tile[],
	cities: City[],
	players: Player[],
	grantedSpecialists: Map<number, string>,
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
		// A stored specialist shadows the grant, so the walk never records one
		// for a tile that has its own; `??` is ordering, not a tie-break.
		const grantedSpecialist = grantedSpecialists.get(t.xmlId) ?? null;
		improvements.push({
			nation: owner?.nation ?? null,
			owner_player_xml_id: city?.playerXmlId ?? null,
			city_name: city?.cityName ?? null,
			city_xml_id: city?.xmlId ?? null,
			improvement: t.improvement,
			specialist: t.specialist ?? grantedSpecialist,
			specialist_granted: t.specialist === null && grantedSpecialist !== null,
			resource: t.resource,
			build_turns_left: t.improvementTurnsLeft,
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
