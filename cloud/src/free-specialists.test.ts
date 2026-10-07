// The adjacency walk behind free specialists, which lives in the SvelteKit
// tree at src/lib/parser/derive/free-specialists.ts.
//
// Why the test is here and not beside the module: the frontend has no test
// runner. The module is dependency-free apart from a generated table and
// src/lib/utils/hex, so reaching across the root costs nothing and touches no
// Worker bundle — the same reach projected-totals.test.ts and
// canonical-map-options.test.ts already make. It is not mirrored into the
// Worker the way the challenge scorer is: nothing server-side parses a save,
// so a mirror would be a cloud module with no consumer.
//
// The walk's whole job is the predicate, and the parity of the hex offsets is
// the part a second hand-rolled copy gets silently wrong on half the rows —
// hence the two parity cases below, which pin the result against the
// neighbours the OTHER row parity would have produced.
import { describe, expect, it } from "vitest";
import { deriveFreeSpecialists } from "../../src/lib/parser/derive/free-specialists";
import type { Tile } from "../../src/lib/parser/parsers/tiles";

const MAP_WIDTH = 16;
const AQUEDUCT = "IMPROVEMENT_JERWAN_AQUEDUCT";
const FARM = "IMPROVEMENT_FARM";
const FARMER = "SPECIALIST_FARMER";

// Player 0 on team 0, player 1 on team 1 — the shape every save in
// test-data/saves/ has (<Team><PlayerTeam>, GameParameters.cs:663).
const RIVALS = [0, 1];

function tile(x: number, y: number, over: Partial<Tile> = {}): Tile {
	return {
		xmlId: y * MAP_WIDTH + x,
		x,
		y,
		terrain: "TERRAIN_LUSH",
		height: null,
		vegetation: null,
		riverW: false,
		riverSw: false,
		riverSe: false,
		resource: null,
		improvement: null,
		improvementPillaged: false,
		improvementTurnsLeft: null,
		specialist: null,
		hasRoad: false,
		ownerPlayerXmlId: 0,
		cityTerritoryXmlId: 1,
		tribeSite: null,
		religion: null,
		...over,
	};
}

const aqueduct = (x: number, y: number, over: Partial<Tile> = {}): Tile =>
	tile(x, y, { improvement: AQUEDUCT, ...over });
const farm = (x: number, y: number, over: Partial<Tile> = {}): Tile =>
	tile(x, y, { improvement: FARM, ...over });

/** The tiles given a free specialist, as `x,y` strings, so a failure names
 * positions. */
function freeAt(tiles: Tile[], teams: number[] = RIVALS): string[] {
	const free = deriveFreeSpecialists(tiles, teams);
	return tiles
		.filter((t) => free.has(t.xmlId))
		.map((t) => `${t.x},${t.y}`)
		.sort();
}

describe("deriveFreeSpecialists", () => {
	it("gives the improvement's own specialist to each adjacent farm", () => {
		const tiles = [aqueduct(5, 4), farm(6, 4), farm(4, 4)];
		const free = deriveFreeSpecialists(tiles, RIVALS);
		expect(free.get(farm(6, 4).xmlId)).toBe(FARMER);
		expect(free.get(farm(4, 4).xmlId)).toBe(FARMER);
		expect(free.size).toBe(2);
	});

	// Even row: NE/SE are (x+1, y±1). Farms at (4,3) and (4,5) are the
	// neighbours the ODD offsets would have picked, and must get nothing.
	it("uses even-row hex offsets on an even row", () => {
		const tiles = [
			aqueduct(5, 4),
			farm(6, 5),
			farm(6, 4),
			farm(6, 3),
			farm(5, 3),
			farm(4, 4),
			farm(5, 5),
			farm(4, 3),
			farm(4, 5),
		];
		expect(freeAt(tiles)).toEqual(["4,4", "5,3", "5,5", "6,3", "6,4", "6,5"]);
	});

	// Odd row: NE/SE are (x, y±1). Farms at (6,2) and (6,4) are the neighbours
	// the EVEN offsets would have picked.
	it("uses odd-row hex offsets on an odd row", () => {
		const tiles = [
			aqueduct(5, 3),
			farm(5, 4),
			farm(6, 3),
			farm(5, 2),
			farm(4, 2),
			farm(4, 3),
			farm(4, 4),
			farm(6, 2),
			farm(6, 4),
		];
		expect(freeAt(tiles)).toEqual(["4,2", "4,3", "4,4", "5,2", "5,4", "6,3"]);
	});

	it("leaves a farm two tiles away alone", () => {
		expect(freeAt([aqueduct(5, 4), farm(7, 4)])).toEqual([]);
	});

	// Tile.getSpecialist (Tile.cs:6993) returns the stored specialist and never
	// reaches the free-specialist fallback — one specialist, not two.
	it("is shadowed by a stored specialist", () => {
		const tiles = [aqueduct(5, 4), farm(6, 4, { specialist: FARMER })];
		expect(deriveFreeSpecialists(tiles, RIVALS).size).toBe(0);
	});

	it("reaches across cities of the same player", () => {
		const tiles = [
			aqueduct(5, 4, { cityTerritoryXmlId: 10 }),
			farm(6, 4, { cityTerritoryXmlId: 5 }),
			farm(4, 4, { cityTerritoryXmlId: 8 }),
		];
		expect(freeAt(tiles)).toEqual(["4,4", "6,4"]);
	});

	it("reaches across players of the same team", () => {
		const tiles = [aqueduct(5, 4), farm(6, 4, { ownerPlayerXmlId: 1 })];
		// Both players on team 0.
		expect(freeAt(tiles, [0, 0])).toEqual(["6,4"]);
	});

	it("gives nothing to a rival's farm", () => {
		const tiles = [aqueduct(5, 4), farm(6, 4, { ownerPlayerXmlId: 1 })];
		expect(freeAt(tiles)).toEqual([]);
	});

	// Tile.getTeam() (Tile.cs:7239) is NONE when the tile has no owner, so an
	// unowned tile on either side never matches a team.
	it("gives nothing when either tile is unowned", () => {
		expect(
			freeAt([aqueduct(5, 4), farm(6, 4, { ownerPlayerXmlId: null })]),
		).toEqual([]);
		expect(
			freeAt([aqueduct(5, 4, { ownerPlayerXmlId: null }), farm(6, 4)]),
		).toEqual([]);
	});

	// getActiveImprovement (Tile.cs:5167) answers NONE for an unfinished or
	// pillaged improvement, and hasImprovementFreeSpecialist (Tile.cs:10933)
	// gates the receiving tile on hasActiveImprovement() as well — so either
	// side being inactive means no free specialist.
	it("requires the source improvement to be active", () => {
		expect(
			freeAt([aqueduct(5, 4, { improvementTurnsLeft: 3 }), farm(6, 4)]),
		).toEqual([]);
		expect(
			freeAt([aqueduct(5, 4, { improvementPillaged: true }), farm(6, 4)]),
		).toEqual([]);
	});

	it("requires the receiving improvement to be active", () => {
		expect(
			freeAt([aqueduct(5, 4), farm(6, 4, { improvementTurnsLeft: 2 })]),
		).toEqual([]);
		expect(
			freeAt([aqueduct(5, 4), farm(6, 4, { improvementPillaged: true })]),
		).toEqual([]);
	});

	// The dict lookup is keyed on getImprovement(), so the entry goes inert if
	// the farm is replaced by something the rule doesn't name.
	it("only reaches the improvements the rule names", () => {
		const tiles = [
			aqueduct(5, 4),
			tile(6, 4, { improvement: "IMPROVEMENT_MINE" }),
		];
		expect(deriveFreeSpecialists(tiles, RIVALS).size).toBe(0);
	});

	it("gives nothing when no improvement declares the rule", () => {
		const tiles = [
			tile(5, 4, { improvement: "IMPROVEMENT_BATHS_1" }),
			farm(6, 4),
		];
		expect(deriveFreeSpecialists(tiles, RIVALS).size).toBe(0);
	});

	// Failing closed: without the mapping every tile's team is unknown, and
	// treating two unknowns as equal would place a free specialist across an
	// enemy border.
	it("gives nothing when the save carries no team mapping", () => {
		expect(freeAt([aqueduct(5, 4), farm(6, 4)], [])).toEqual([]);
	});

	it("gives a farm adjacent to two aqueducts one specialist", () => {
		const tiles = [aqueduct(5, 4), aqueduct(7, 4), farm(6, 4)];
		const free = deriveFreeSpecialists(tiles, RIVALS);
		expect([...free.entries()]).toEqual([[farm(6, 4).xmlId, FARMER]]);
	});
});
