// The shared countVP recomputation (src/lib/game-detail/victory-points.ts),
// tested from here because cloud/ is the only package in the repo with a test
// runner — the same reason free-specialists.test.ts lives beside this one.

import { describe, expect, it } from "vitest";
import {
	victoryPointsByPlayer,
	type VictoryPointSources,
} from "../../src/lib/game-detail/victory-points";

const CURRENT = "2.29.0";

/** The seat list — `countVP` is summed for the seats the history names. */
const HISTORY = [
	{ player_id: 0, history: [{ points: 3 }] },
	{ player_id: 1, history: [{ points: 0 }] },
];

function sources(over: Partial<VictoryPointSources> = {}): VictoryPointSources {
	return {
		parserVersion: CURRENT,
		victoryConditions: "VICTORY_POINTS+VICTORY_AMBITION",
		playerHistory: HISTORY,
		cities: [],
		mapTiles: [],
		completedTechs: [],
		...over,
	};
}

const TILE = {
	owner_player_xml_id: 0,
	owner_city: "Memphis",
	improvement: "IMPROVEMENT_PYRAMIDS",
	improvement_pillaged: false,
	improvement_turns_left: null,
};

describe("victoryPointsByPlayer — culture", () => {
	it("pays each owned city its own tier", () => {
		const vp = victoryPointsByPlayer(
			sources({
				cities: [
					{ owner_player_xml_id: 0, culture_level: "CULTURE_STRONG" },
					{ owner_player_xml_id: 0, culture_level: "CULTURE_DEVELOPING" },
					{ owner_player_xml_id: 1, culture_level: "CULTURE_WEAK" },
				],
			}),
		);
		expect(vp?.get(0)).toBe(5);
		expect(vp?.get(1)).toBe(1);
	});

	it("adds one per culture step past the top tier", () => {
		const vp = victoryPointsByPlayer(
			sources({
				cities: [
					{
						owner_player_xml_id: 0,
						culture_level: "CULTURE_LEGENDARY",
						culture_step: 2,
					},
				],
			}),
		);
		expect(vp?.get(0)).toBe(6);
	});

	it("pays nothing for a city with no culture level, step or not", () => {
		const vp = victoryPointsByPlayer(
			sources({
				cities: [
					{ owner_player_xml_id: 0, culture_level: null, culture_step: 3 },
				],
			}),
		);
		expect(vp?.get(0)).toBe(0);
	});

	it("credits nobody for an unowned city", () => {
		const vp = victoryPointsByPlayer(
			sources({
				cities: [
					{ owner_player_xml_id: null, culture_level: "CULTURE_LEGENDARY" },
				],
			}),
		);
		expect([...(vp?.values() ?? [])]).toEqual([0, 0]);
	});
});

describe("victoryPointsByPlayer — improvements", () => {
	it("credits the tile's owner, not the territory city's player", () => {
		const vp = victoryPointsByPlayer(sources({ mapTiles: [TILE] }));
		expect(vp?.get(0)).toBe(2);
		expect(vp?.get(1)).toBe(0);
	});

	it("pays nothing for a pillaged or unfinished improvement", () => {
		const vp = victoryPointsByPlayer(
			sources({
				mapTiles: [
					{ ...TILE, improvement_pillaged: true },
					{
						...TILE,
						improvement: "IMPROVEMENT_ORACLE",
						improvement_turns_left: 4,
					},
				],
			}),
		);
		expect(vp?.get(0)).toBe(0);
	});

	it("pays nothing for an improvement outside a city's territory", () => {
		const vp = victoryPointsByPlayer(
			sources({ mapTiles: [{ ...TILE, owner_city: null }] }),
		);
		expect(vp?.get(0)).toBe(0);
	});

	it("ignores an improvement that grants no victory point", () => {
		const vp = victoryPointsByPlayer(
			sources({ mapTiles: [{ ...TILE, improvement: "IMPROVEMENT_FARM" }] }),
		);
		expect(vp?.get(0)).toBe(0);
	});
});

describe("victoryPointsByPlayer — techs and projects", () => {
	it("keeps a tech's point after the seat has lost every city", () => {
		const vp = victoryPointsByPlayer(
			sources({
				completedTechs: [
					{ player_id: 0, tech: "TECH_ECONOMIC_REFORM" },
					{ player_id: 0, tech: "TECH_TRAPPING" },
				],
			}),
		);
		expect(vp?.get(0)).toBe(1);
	});

	it("pays a point per city holding the project", () => {
		const vp = victoryPointsByPlayer(
			sources({
				cities: [
					{
						owner_player_xml_id: 0,
						culture_level: null,
						project_counts: [
							{ project: "PROJECT_LAVISH_LIFESTYLE", count: 1 },
							{ project: "PROJECT_COUNCIL_1", count: 1 },
						],
					},
					{
						owner_player_xml_id: 0,
						culture_level: null,
						project_counts: [{ project: "PROJECT_LAVISH_LIFESTYLE", count: 1 }],
					},
				],
			}),
		);
		expect(vp?.get(0)).toBe(2);
	});
});

describe("victoryPointsByPlayer — when the blob cannot answer", () => {
	it("returns null below the parser floor", () => {
		expect(
			victoryPointsByPlayer(
				sources({ parserVersion: "2.16.0", mapTiles: [TILE] }),
			),
		).toBeNull();
	});

	it("answers at the parser floor itself", () => {
		expect(
			victoryPointsByPlayer(
				sources({ parserVersion: "2.17.0", mapTiles: [TILE] }),
			)?.get(0),
		).toBe(2);
	});

	it("returns null for a game that cannot be won on points", () => {
		expect(
			victoryPointsByPlayer(
				sources({
					victoryConditions: "VICTORY_AMBITION+VICTORY_CONQUEST",
					mapTiles: [TILE],
				}),
			),
		).toBeNull();
	});

	it("answers on Double alone, which carries a points threshold", () => {
		expect(
			victoryPointsByPlayer(
				sources({
					victoryConditions: "VICTORY_DOUBLE+VICTORY_CONQUEST",
					mapTiles: [TILE],
				}),
			)?.get(0),
		).toBe(2);
	});

	it("answers a points game whose series recorded nothing", () => {
		// An empty `<PointsHistory>` is an old build or a game too short to
		// have written one, not a victory setting.
		expect(
			victoryPointsByPlayer(
				sources({
					playerHistory: [{ player_id: 0, history: [{ points: null }] }],
					mapTiles: [TILE],
				}),
			)?.get(0),
		).toBe(2);
	});

	it("gives every seat a number, one that scored nothing included", () => {
		const vp = victoryPointsByPlayer(sources());
		expect([...(vp?.keys() ?? [])]).toEqual([0, 1]);
		expect(vp?.get(1)).toBe(0);
	});
});
