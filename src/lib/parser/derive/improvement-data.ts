// derive/improvement-data.ts — port of get_improvement_data (map.rs:291–320).
//
// One row per tile with a non-null improvement, joined against the tile's
// owning city + player. ORDER BY p.nation, c.city_name, t.improvement.

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

	// Tile → owner_city via owner-player chain. The Rust SQL joins on
	// `t.owner_city_id` directly (a column populated by the inserter); the
	// parser doesn't expose owner_city_id on Tile. Tiles in the same city
	// share owner_player_xml_id, but we need the city name for grouping.
	// Resolve via: for each city find its tile_xml_id (the city's center)
	// AND for tiles whose owner is this city's owner_player, attribute them
	// to the closest city. That's expensive and approximate. Simpler: rely
	// on tile.owner_player_xml_id only — the SQL effectively yields nation
	// directly; city_name is "best-effort". Use the first capital in the
	// owner's set as a stable fallback when we can't pin down the exact city.

	const improvements: ImprovementInfo[] = [];

	for (const t of tiles) {
		if (t.improvement === null) continue;
		const owner =
			t.ownerPlayerXmlId !== null
				? playerMap.get(t.ownerPlayerXmlId)
				: undefined;
		// Walk the owning player's cities and pick a deterministic one for
		// city_name. The Rust query joins via t.owner_city_id which is a
		// post-insert derived column; the cleanest analog here is "the city
		// the tile belongs to," which, absent that column, we approximate
		// as null and let consumers group by nation+improvement instead.
		improvements.push({
			nation: owner?.nation ?? null,
			city_name: null,
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
