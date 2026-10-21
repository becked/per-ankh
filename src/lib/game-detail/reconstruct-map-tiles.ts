// Reconstruct historical MapTile[] for the map turn slider in cloud /
// browser-parser flows. Runs synchronously over in-memory FullGameData.
//
// Inputs (all already in FullGameData):
//   - map_tiles[]                final-turn snapshot (per-tile static + final state)
//   - tile_ownership_history[]   sparse per-turn owner transitions
//   - player_nations[]           player_xml_id → nation (cloud-only sidecar)
//   - city_statistics.cities[]   cities with founded_turn (city_id == xmlId
//                                in the cloud parser; see derive/city-statistics.ts:69)
//   - game_details.map_width     for x,y → tile_xml_id (parser uses
//                                xml_id = y*width + x at parsers/tiles.ts:149–150)

import { ownershipChangeTurn } from "$lib/parser/types";
import type { FullGameData, MapTile } from "$lib/parser/types";

/**
 * The save's id for a grid position. The parser writes `xml_id = y * width + x`
 * (parsers/tiles.ts:149–150), and `tile_ownership_history` keys off it — so any
 * join from an (x, y) tile to its ownership rows goes through here.
 */
export function tileXmlId(x: number, y: number, mapWidth: number): number {
	return y * mapWidth + x;
}

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
	//    Latest tile_ownership_history entry that changed hands at or before
	//    the turn — `ownershipChangeTurn`, because the save keys each entry to
	//    the turn after the change.
	//
	//    Three states, and the map below keeps them apart by presence as well
	//    as by value: no entry is land no player has ever held, an entry with
	//    an owner id is land someone holds, and an entry whose owner is null is
	//    land a player held and then RELEASED. The third is what a capture
	//    writes — `City.setPlayer` re-sets every territory tile to the city's
	//    new holder (`City.cs:3479`), and a capture's holder is nobody
	//    (`Unit.doCityCapture`, Unit.cs:2004), so each tile takes
	//    `Tile.setOwner(PlayerType.NONE, TRIBE_ANARCHY, getID())` and keeps
	//    its city territory while losing its owning player. Released is not
	//    the same state as never-held, so `.get()` alone — which answers
	//    `undefined` for both — can't be the gate.
	const ownerAtTurn = new Map<number, number | null>();
	const latestTurnSeen = new Map<number, number>();
	for (const entry of data.tile_ownership_history) {
		const changedTurn = ownershipChangeTurn(entry.turn);
		if (changedTurn > turn) continue;
		const prev = latestTurnSeen.get(entry.tile_xml_id);
		if (prev === undefined || changedTurn > prev) {
			latestTurnSeen.set(entry.tile_xml_id, changedTurn);
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
		const xmlId = tileXmlId(t.x, t.y, mapWidth);
		const row = ownerAtTurn.get(xmlId);
		const ownerXmlId = row ?? null;
		const held = ownerXmlId !== null;
		// A row whose owner is null: see the three states above. The tile is
		// standing territory of a city nobody holds, so everything built on it
		// stays — `Tile.setOwner` only clears an improvement under
		// `hasOwner()` (Tile.cs:7588), and the game keeps drawing the city,
		// because it colours territory from the CITY rather than from the
		// tile's owning player (`Game.getBorderColors`, Game.cs:21782).
		const released = row === null;
		const developed = held || released;

		const cityInfo =
			t.owner_city !== null ? cityByName.get(t.owner_city) : undefined;
		const cityFoundedByTurn =
			cityInfo !== undefined && cityInfo.founded_turn <= turn;

		// owner_city and the city-center flags are visible whenever the tile is
		// held or released at this turn AND the (final-turn) territory city
		// existed by this turn.
		const showCityChrome = developed && cityFoundedByTurn;

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
			// Held-or-released gated: what a player built on the tile, which
			// survives the owner.
			improvement: developed ? t.improvement : null,
			improvement_pillaged: developed ? t.improvement_pillaged : false,
			improvement_turns_left: developed ? t.improvement_turns_left : null,
			has_road: developed ? t.has_road : false,
			// Carried through the same ownership gate as `improvement`, so a free
			// specialist inherits this module's existing final-state
			// approximation rather than a new one: the aqueduct and the farm are
			// shown as of the final turn for any turn the tile was developed,
			// exactly as the improvement itself is.
			specialist: developed ? t.specialist : null,
			// Null on a released tile, and deliberately: nobody owns it. That
			// null is what the render side keys the unowned-city treatment on.
			owner_nation: held ? (playerNation.get(ownerXmlId) ?? null) : null,
			owner_player_xml_id: held ? ownerXmlId : null,
			// City-chrome gated.
			owner_city: showCityChrome ? t.owner_city : null,
			is_city_center: t.is_city_center && cityFoundedByTurn,
			is_capital: t.is_capital && cityFoundedByTurn,
		};
	});

	// Match desktop ORDER BY t.y, t.x.
	out.sort((a, b) => a.y - b.y || a.x - b.x);
	return out;
}
