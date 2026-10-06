// Free specialists — the ones the save never records.
//
// The Jerwan Aqueduct gives a free specialist to each adjacent farm
// (`<AdjacentImprovementSpecialists>`, improvement.xml:6446). "Free" is the
// game's own word for it: `Tile.getFreeSpecialist`, the per-tile
// `mapFreeImprovementSpecialists` dict, and the wonder's bonus text, "Free
// {0_specialist} in adjacent {1,2_improvement}"
// (TEXT_HELPTEXT_BONUS_FREE_IMPROVEMENT_SPECIALIST_ADJACENT). It is an
// ordinary specialist on the tile — the game draws no further distinction —
// and this module exists only because the save file does not write it.
//
// The effect is runtime adjacency, not tile state: `Tile.changeImprovement`
// (Tile.cs:6626) walks the six directions when an improvement becomes active
// and calls `pAdjacent.changeImprovementFreeSpecialists(IMPROVEMENT_FARM, +1)`,
// which lands in that dict keyed by improvement TYPE rather than as a
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
//   - it is one of the six hex neighbours of a SOURCE tile — one whose ACTIVE
//     improvement declares `AdjacentImprovementSpecialists` containing this
//     tile's own improvement;
//   - the two tiles are on the same TEAM — not the same city and not merely
//     the same nation. `Tile.changeImprovement` (Tile.cs:6633) tests
//     `pAdjacent.getTeam() == pCityTerritory.getTeam()`, and `Tile.changeOwner`
//     (Tile.cs:7782) — the walk that reconciles after any ownership change —
//     tests `pAdjacent.getTeam() == getTeam() && pAdjacent.hasActiveImprovement()`.
//     Team is wider than nation (teammates qualify; a mirror match's two
//     players of one nation do not) and wider than the city: a farm in a
//     DIFFERENT city of the same player qualifies, so a same-city predicate
//     would be wrong. In test-data/saves/match_426504745_save the aqueduct
//     sits in CityTerritory 10 and three of its five adjacent farms lie
//     outside it, two in territory 5 and one in 8;
//   - it carries no stored specialist. The dict entry is still recorded on a
//     farm that already has one, but has no effect — `getSpecialist`
//     (Tile.cs:6993) returns the stored one and never reaches the free
//     fallback. One specialist, not two;
//   - BOTH tiles' improvements are active. `Tile.getActiveImprovement`
//     (Tile.cs:5167) answers NONE for an unfinished or pillaged improvement,
//     which gates the source tile, and `hasImprovementFreeSpecialist`
//     (Tile.cs:10933) gates the receiving one on `hasActiveImprovement()` too;
//   - the receiving tile's improvement is CURRENTLY one the source names.
//     `hasImprovementFreeSpecialist` keys the dict lookup on
//     `getImprovement()`, so the entry persists but goes inert if the farm is
//     replaced. Pure adjacency reproduces that; no history is needed.
//
// `deriveMapTiles` and `deriveImprovementData` both consume the one result
// through `tileSpecialist` below — neither the walk nor the shadowing rule is
// written twice.

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
 * Tile xml_id → the specialist zType a neighbouring improvement gives it for
 * free.
 *
 * `teamAssignments` is the save's `<Team><PlayerTeam>` list, indexed by player
 * xml id (`parseTeamAssignments`). A tile whose owner has no entry — including
 * every tile when the element is absent — is treated as having no team and
 * never qualifies on either side, the same answer `Tile.getTeam()`
 * (Tile.cs:7239) gives for an unowned tile. That fails closed: the cost is a
 * free specialist we don't derive, where comparing two unknown teams as equal
 * would place one across an enemy border.
 */
export function deriveFreeSpecialists(
	tiles: Tile[],
	teamAssignments: number[],
): Map<number, string> {
	const free = new Map<number, string>();

	// Each source tile paired with the improvements it names. One improvement
	// in the whole catalogue declares the rule, so most saves have no source
	// tiles and skip the walk below entirely.
	const sources: { tile: Tile; givesTo: readonly string[] }[] = [];
	for (const tile of tiles) {
		const improvement = activeImprovement(tile);
		if (improvement === null) continue;
		const givesTo = ADJACENT_IMPROVEMENT_SPECIALISTS[improvement];
		if (givesTo === undefined) continue;
		sources.push({ tile, givesTo });
	}
	if (sources.length === 0) return free;

	// (x, y) → tile, the lookup `hexNeighbors` answers into — the same keying
	// the Techs tab's adjacency science uses.
	const tileAt = new Map<string, Tile>();
	for (const t of tiles) tileAt.set(`${t.x},${t.y}`, t);

	const teamOf = (t: Tile): number | null => {
		if (t.ownerPlayerXmlId === null) return null;
		return teamAssignments[t.ownerPlayerXmlId] ?? null;
	};

	for (const { tile: source, givesTo } of sources) {
		const sourceTeam = teamOf(source);
		if (sourceTeam === null) continue;

		for (const [nx, ny] of hexNeighbors(source.x, source.y)) {
			const neighbour = tileAt.get(`${nx},${ny}`);
			if (neighbour === undefined) continue;
			// A stored specialist shadows the free one entirely.
			if (neighbour.specialist !== null) continue;
			if (teamOf(neighbour) !== sourceTeam) continue;
			const improvement = activeImprovement(neighbour);
			if (improvement === null) continue;
			if (!givesTo.includes(improvement)) continue;
			const specialist = ELIGIBLE_IMPROVEMENTS[improvement]?.specialist;
			if (specialist === undefined) continue;
			free.set(neighbour.xmlId, specialist);
		}
	}

	return free;
}

/**
 * The specialist the GAME reads off a tile — `Tile.getSpecialist`
 * (Tile.cs:6993) — plus the flag saying whether it is the free one, for the
 * blob rows that carry both. `deriveMapTiles` and `deriveImprovementData` each
 * spread this so the shadowing rule has one home.
 */
export function tileSpecialist(
	t: Tile,
	freeSpecialists: Map<number, string>,
): { specialist: string | null; specialist_free: boolean } {
	// A stored specialist shadows the free one, so the walk never records one
	// for a tile that has its own; `??` is ordering, not a tie-break.
	const free = freeSpecialists.get(t.xmlId) ?? null;
	return {
		specialist: t.specialist ?? free,
		specialist_free: t.specialist === null && free !== null,
	};
}
