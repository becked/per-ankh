// derive/map-tiles.ts — port of get_map_tiles (map.rs:12–76).
//
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
// religions attach by city territory (the city the tile belongs to).

import type { City, CityReligion } from "../parsers/cities.js";
import type { Player } from "../parsers/players.js";
import type { Religion } from "../parsers/religions.js";
import type { Tile } from "../parsers/tiles.js";
import type { MapTile, ReligionInfo } from "../types.js";
import { playerByXmlId, strCmp } from "./_helpers.js";

export function deriveMapTiles(
	tiles: Tile[],
	cities: City[],
	cityReligions: CityReligion[],
	religions: Religion[],
	players: Player[],
): MapTile[] {
	const playerMap = playerByXmlId(players);

	// city_center tile lookup: tile_xml_id → City
	const cityCenterByTile = new Map<number, City>();
	for (const c of cities) cityCenterByTile.set(c.tileXmlId, c);

	// religion → founder_nation
	const founderNation = new Map<string, string | null>();
	for (const r of religions) {
		founderNation.set(
			r.religionName,
			r.founderPlayerXmlId !== null
				? (playerMap.get(r.founderPlayerXmlId)?.nation ?? null)
				: null,
		);
	}

	// city_xml_id → ReligionInfo[] (state religion first, then alphabetical
	// — simplified vs the Rust query's adoption-event ordering, since we
	// don't yet have story_events resolution wired here).
	const religionsByCity = new Map<number, ReligionInfo[]>();
	for (const cr of cityReligions) {
		const arr = religionsByCity.get(cr.cityXmlId) ?? [];
		arr.push({
			religion_name: cr.religion,
			founder_nation: founderNation.get(cr.religion) ?? null,
		});
		religionsByCity.set(cr.cityXmlId, arr);
	}
	for (const [cityXmlId, list] of religionsByCity) {
		const city = cities.find((c) => c.xmlId === cityXmlId);
		const stateReligion =
			city?.playerXmlId !== null && city?.playerXmlId !== undefined
				? (playerMap.get(city.playerXmlId)?.stateReligion ?? null)
				: null;
		list.sort((a, b) => {
			const aIsState =
				stateReligion !== null && a.religion_name === stateReligion ? 0 : 1;
			const bIsState =
				stateReligion !== null && b.religion_name === stateReligion ? 0 : 1;
			return aIsState - bIsState || strCmp(a.religion_name, b.religion_name);
		});
	}

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
		const tileReligions =
			territoryCity !== undefined
				? (religionsByCity.get(territoryCity.xmlId) ?? [])
				: [];
		return {
			x: t.x,
			y: t.y,
			terrain: t.terrain,
			height: t.height,
			vegetation: t.vegetation,
			resource: t.resource,
			improvement: t.improvement,
			improvement_pillaged: t.improvementPillaged,
			has_road: t.hasRoad,
			specialist: t.specialist,
			tribe_site: t.tribeSite,
			religions: tileReligions,
			river_w: t.riverW,
			river_sw: t.riverSw,
			river_se: t.riverSe,
			owner_nation: tilePlayer?.nation ?? null,
			owner_city: territoryCity?.cityName ?? null,
			is_city_center: center !== undefined,
			is_capital: center?.isCapital ?? false,
		};
	});

	// ORDER BY t.y, t.x.
	out.sort((a, b) => a.y - b.y || a.x - b.x);
	return out;
}
