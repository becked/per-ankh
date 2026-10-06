// Wonder-granted specialists — the ones the save never records.
//
// The Jerwan Aqueduct staffs every adjacent farm for free
// (`<AdjacentImprovementSpecialists>`, improvement.xml:6446). That grant is a
// runtime adjacency effect, not tile state: `Tile.changeImprovement`
// (Tile.cs:6626) walks the six directions when an improvement becomes active
// and calls `pAdjacent.changeImprovementFreeSpecialists(IMPROVEMENT_FARM, +1)`,
// which lands in a per-tile dict keyed by improvement TYPE rather than as a
// specialist. `Tile.writeGameXML` (Tile.cs:1507) guards its `<Specialist>`
// element on the STORED `getCurrentSpecialist()` while writing
// `getSpecialist()`'s zType — so a tile whose only specialist is the free one
// fails that guard and no element is written at all. The dict itself appears
// nowhere in `writeGameXML`; the game rebuilds it from adjacency on load, and
// so do we.
//
// Why at parse time rather than at read time: the predicate needs each
// player's team, and the blob carries no player→team mapping (only
// `WinnerInfo.winner_team_id`). The save does, as `<Team><PlayerTeam>`
// (GameParameters.cs:663), which `parseTeamAssignments` reads.
//
// The predicate, read off the game rather than inferred from the XML. A tile
// holds a free specialist iff ALL of:
//
//   - it is one of the six hex neighbours of a tile whose ACTIVE improvement
//     declares `AdjacentImprovementSpecialists` containing this tile's own
//     improvement;
//   - the two tiles are on the same TEAM — not the same city and not merely
//     the same owner. `Tile.changeImprovement` (Tile.cs:6633) tests
//     `pAdjacent.getTeam() == pCityTerritory.getTeam()`, and `Tile.changeOwner`
//     (Tile.cs:7782) — the walk that reconciles after any ownership change —
//     tests `pAdjacent.getTeam() == getTeam() && pAdjacent.hasActiveImprovement()`.
//     A farm in a DIFFERENT city of the same player qualifies, so a same-city
//     predicate would be wrong: in test-data/saves/match_426504745_save the
//     aqueduct sits in CityTerritory 10 with qualifying farms in territories 5
//     and 8, two of its five;
//   - it carries no stored specialist. The grant is still recorded on an
//     already-staffed farm but has no effect — `getSpecialist` (Tile.cs:6993)
//     returns the stored one and never reaches the fallback. One specialist,
//     not two;
//   - BOTH tiles' improvements are active. `Tile.getActiveImprovement`
//     (Tile.cs:5167) answers NONE for an unfinished or pillaged improvement,
//     which gates the granting tile, and `hasImprovementFreeSpecialist`
//     (Tile.cs:10933) gates the receiving one on `hasActiveImprovement()` too;
//   - the receiving tile's improvement is CURRENTLY the granted-to one.
//     `hasImprovementFreeSpecialist` keys the dict lookup on
//     `getImprovement()`, so the entry persists but goes inert if the farm is
//     replaced. Pure adjacency reproduces that; no history is needed.
//
// `deriveMapTiles` and `deriveImprovementData` both consume the one result —
// the adjacency walk is not duplicated between them.

import {
	ADJACENT_IMPROVEMENT_SPECIALISTS,
	ELIGIBLE_IMPROVEMENTS,
} from "../../generated/specialists.js";
import { hexNeighbors } from "../../utils/hex.js";
import type { Tile } from "../parsers/tiles.js";

/**
 * The improvement the game would actually read off this tile, or null —
 * `Tile.getActiveImprovement` (Tile.cs:5167), which answers NONE for a
 * pillaged OR a still-building improvement. Parallel to `activeImprovement`
 * in game-detail/science-techs.ts rather than shared with it: that one reads
 * the blob's `MapTile` (`improvement_pillaged` / `improvement_turns_left`),
 * this one the parser's `Tile`, and the two field namings don't meet.
 */
function activeImprovement(t: Tile): string | null {
	if (t.improvementPillaged) return null;
	if ((t.improvementTurnsLeft ?? 0) > 0) return null;
	return t.improvement;
}

/**
 * Tile xml_id → the specialist zType a neighbouring wonder staffs it with.
 *
 * `teamAssignments` is the save's `<Team><PlayerTeam>` list, indexed by player
 * xml id (`parseTeamAssignments`). A tile whose owner has no entry — including
 * every tile when the element is absent — is treated as having no team and
 * never qualifies on either side, the same answer `Tile.getTeam()`
 * (Tile.cs:7239) gives for an unowned tile. That fails closed: the cost is a
 * grant we don't derive, where comparing two unknown teams as equal would
 * staff farms across an enemy border.
 */
export function deriveGrantedSpecialists(
	tiles: Tile[],
	teamAssignments: number[],
): Map<number, string> {
	const granted = new Map<number, string>();

	// Each granting tile paired with what it staffs. One improvement in the
	// whole catalogue declares the rule, so most saves have none of these and
	// skip the lookup below entirely.
	const granters: { tile: Tile; grantsTo: readonly string[] }[] = [];
	for (const tile of tiles) {
		const improvement = activeImprovement(tile);
		if (improvement === null) continue;
		const grantsTo = ADJACENT_IMPROVEMENT_SPECIALISTS[improvement];
		if (grantsTo === undefined) continue;
		granters.push({ tile, grantsTo });
	}
	if (granters.length === 0) return granted;

	// (x, y) → tile, the lookup `hexNeighbors` answers into — the same keying
	// the Techs tab's adjacency science uses.
	const tileAt = new Map<string, Tile>();
	for (const t of tiles) tileAt.set(`${t.x},${t.y}`, t);

	const teamOf = (t: Tile): number | null => {
		if (t.ownerPlayerXmlId === null) return null;
		return teamAssignments[t.ownerPlayerXmlId] ?? null;
	};

	for (const { tile: granter, grantsTo } of granters) {
		const granterTeam = teamOf(granter);
		if (granterTeam === null) continue;

		for (const [nx, ny] of hexNeighbors(granter.x, granter.y)) {
			const neighbour = tileAt.get(`${nx},${ny}`);
			if (neighbour === undefined) continue;
			// A stored specialist shadows the grant entirely.
			if (neighbour.specialist !== null) continue;
			if (teamOf(neighbour) !== granterTeam) continue;
			const improvement = activeImprovement(neighbour);
			if (improvement === null) continue;
			if (!grantsTo.includes(improvement)) continue;
			const specialist = ELIGIBLE_IMPROVEMENTS[improvement]?.specialist;
			if (specialist === undefined) continue;
			granted.set(neighbour.xmlId, specialist);
		}
	}

	return granted;
}
