// Direct projection over parsed Tile[] resolving owner metadata. Three
// distinct tile→entity relationships are used (mirroring the Rust query's
// three LEFT JOINs):
//
//   - `tile.ownerPlayerXmlId` (from OwnerHistory's latest entry) →
//     player.nation = `owner_nation`. Tile-level player ownership.
//   - `tile.cityTerritoryXmlId` → city.cityName = `owner_city`. City-level
//     territory attribution; can diverge from owner_nation when a tile is
//     in a city's territory but separately conquered/unowned.
//   - `tile.xmlId === city.tileXmlId` → city center; drives is_city_center
//     + is_capital flags.
//
// `specialist` comes from `tileSpecialist` (derive/free-specialists.ts),
// which is also what improvement_data reads.

import type { City } from "../parsers/cities.js";
import type { Player } from "../parsers/players.js";
import type { Tile } from "../parsers/tiles.js";
import type { MapTile } from "../types.js";
import { playerByXmlId } from "./_helpers.js";
import { tileSpecialist } from "./free-specialists.js";

export function deriveMapTiles(
	tiles: Tile[],
	cities: City[],
	players: Player[],
	freeSpecialists: Map<number, string>,
): MapTile[] {
	const playerMap = playerByXmlId(players);

	// city_center tile lookup: tile_xml_id → City
	const cityCenterByTile = new Map<number, City>();
	for (const c of cities) cityCenterByTile.set(c.tileXmlId, c);

	// Build city-by-xml-id map for territory lookups.
	const cityByXmlId = new Map<number, (typeof cities)[number]>();
	for (const c of cities) cityByXmlId.set(c.xmlId, c);

	const out: MapTile[] = tiles.map((t) => {
		const territoryCity =
			t.cityTerritoryXmlId !== null
				? cityByXmlId.get(t.cityTerritoryXmlId)
				: undefined;
		// owner_nation chains via the tile's direct player ownership
		// (latest OwnerHistory entry), NOT via the city. Mirrors the Rust
		// `LEFT JOIN players p ON t.owner_player_id = p.player_id` clause —
		// these can diverge from territory city attribution (e.g. a tile in
		// a city's territory may be temporarily unowned during a war).
		const tilePlayer =
			t.ownerPlayerXmlId !== null
				? playerMap.get(t.ownerPlayerXmlId)
				: undefined;
		const center = cityCenterByTile.get(t.xmlId);
		return {
			x: t.x,
			y: t.y,
			terrain: t.terrain,
			height: t.height,
			vegetation: t.vegetation,
			resource: t.resource,
			improvement: t.improvement,
			improvement_pillaged: t.improvementPillaged,
			improvement_turns_left: t.improvementTurnsLeft,
			has_road: t.hasRoad,
			specialist: tileSpecialist(t, freeSpecialists),
			tribe_site: t.tribeSite,
			river_w: t.riverW,
			river_sw: t.riverSw,
			river_se: t.riverSe,
			owner_nation: tilePlayer?.nation ?? null,
			owner_player_xml_id: t.ownerPlayerXmlId,
			owner_city: territoryCity?.cityName ?? null,
			is_city_center: center !== undefined,
			is_capital: center?.isCapital ?? false,
		};
	});

	// ORDER BY t.y, t.x.
	out.sort((a, b) => a.y - b.y || a.x - b.x);
	return out;
}
