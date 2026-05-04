// Reconstruct historical MapTile[] for the map turn slider in cloud /
// browser-parser flows. Mirrors desktop's `get_map_tiles_at_turn` SQL
// (src-tauri/src/db/queries/map.rs:82–228) but runs synchronously over
// in-memory FullGameData — there's no DuckDB hop on the cloud path.
//
// Inputs (all already in FullGameData):
//   - map_tiles[]                final-turn snapshot (per-tile static + final state)
//   - tile_ownership_history[]   sparse per-turn owner transitions
//   - player_nations[]           player_xml_id → nation (cloud-only sidecar)
//   - city_statistics.cities[]   cities with founded_turn (city_id == xmlId
//                                in the cloud parser; see derive/city-statistics.ts:69)
//   - game_details.map_width     for x,y → tile_xml_id (parser uses
//                                xml_id = y*width + x at parsers/tiles.ts:149–150)
//
// Parity gaps from desktop's SQL — intentional for v1:
//   - Religion filtering by founded_turn / acquired_turn is NOT applied;
//     religions show as final-state when the tile is owned at turn. The
//     desktop applies a complex per-religion filter we'd need additional
//     parser fields to reproduce.

import type { FullGameData, MapTile } from "$lib/parser/types";

export function reconstructMapTiles(
	data: FullGameData,
	turn: number,
): MapTile[] {
	// Fast path: at or beyond the final turn the snapshot is correct as-is.
	if (turn >= data.game_details.total_turns) {
		return data.map_tiles;
	}

	const mapWidth = data.game_details.map_width;
	if (mapWidth == null) {
		// Without map_width we can't map (x,y) → tile_xml_id, so we can't
		// join with tile_ownership_history. Fall back to the snapshot.
		return data.map_tiles;
	}

	// 1. owner_player_xml_id at the requested turn, per tile_xml_id.
	//    Latest tile_ownership_history entry with entry.turn <= turn.
	const ownerAtTurn = new Map<number, number | null>();
	const latestTurnSeen = new Map<number, number>();
	for (const entry of data.tile_ownership_history) {
		if (entry.turn > turn) continue;
		const prev = latestTurnSeen.get(entry.tile_xml_id);
		if (prev === undefined || entry.turn > prev) {
			latestTurnSeen.set(entry.tile_xml_id, entry.turn);
			ownerAtTurn.set(entry.tile_xml_id, entry.owner_player_xml_id);
		}
	}

	// 2. player_xml_id → nation.
	const playerNation = new Map<number, string | null>();
	for (const p of data.player_nations) {
		playerNation.set(p.player_xml_id, p.nation);
	}

	// 3. city_name → founded_turn (and is_capital). Cities with duplicate
	//    names across players are rare in OW; the first match wins, matching
	//    the desktop's first-row behavior on a non-deterministic JOIN.
	const cityByName = new Map<
		string,
		{ founded_turn: number; is_capital: boolean }
	>();
	for (const c of data.city_statistics.cities) {
		if (!cityByName.has(c.city_name)) {
			cityByName.set(c.city_name, {
				founded_turn: c.founded_turn,
				is_capital: c.is_capital,
			});
		}
	}

	// 4. Project each final-turn tile through the per-turn gate.
	const out: MapTile[] = data.map_tiles.map((t) => {
		const tileXmlId = t.y * mapWidth + t.x;
		const ownerXmlId = ownerAtTurn.get(tileXmlId) ?? null;
		const owned = ownerXmlId !== null;

		const cityInfo =
			t.owner_city !== null ? cityByName.get(t.owner_city) : undefined;
		const cityFoundedByTurn =
			cityInfo !== undefined && cityInfo.founded_turn <= turn;

		// owner_city, religions, and city-center flags are visible only when
		// the tile is owned at this turn AND the (final-turn) territory city
		// existed by this turn. Mirrors desktop's gated LEFT JOINs at
		// map.rs:166–169.
		const showCityChrome = owned && cityFoundedByTurn;

		return {
			x: t.x,
			y: t.y,
			// Static across turns.
			terrain: t.terrain,
			height: t.height,
			vegetation: t.vegetation,
			resource: t.resource,
			tribe_site: t.tribe_site,
			river_w: t.river_w,
			river_sw: t.river_sw,
			river_se: t.river_se,
			// Owned-at-turn gated.
			improvement: owned ? t.improvement : null,
			improvement_pillaged: owned ? t.improvement_pillaged : false,
			has_road: owned ? t.has_road : false,
			specialist: owned ? t.specialist : null,
			owner_nation: owned ? (playerNation.get(ownerXmlId) ?? null) : null,
			// City-chrome gated.
			owner_city: showCityChrome ? t.owner_city : null,
			religions: showCityChrome ? t.religions : [],
			is_city_center: t.is_city_center && cityFoundedByTurn,
			is_capital: t.is_capital && cityFoundedByTurn,
		};
	});

	// Match desktop ORDER BY t.y, t.x.
	out.sort((a, b) => a.y - b.y || a.x - b.x);
	return out;
}
