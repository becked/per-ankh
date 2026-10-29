import { describe, expect, it } from "vitest";
import {
	buildLeaderArchetypes,
	type ReignInput,
	type SeatInput,
} from "./leader-reigns";

const JUDGE = "TRAIT_JUDGE_ARCHETYPE";
const ZEALOT = "TRAIT_ZEALOT_ARCHETYPE";

function seat(
	game_id: string,
	player_index: number,
	total_turns: number,
	is_winner = false,
): SeatInput {
	return { game_id, player_index, total_turns, is_winner };
}

function reign(
	game_id: string,
	player_index: number,
	archetype: string | null,
	start_turn: number,
): ReignInput {
	return { game_id, player_index, archetype, start_turn };
}

describe("buildLeaderArchetypes", () => {
	it("always returns the three bands, in turn order", () => {
		const bands = buildLeaderArchetypes([], []);

		expect(bands.map((b) => [b.from, b.to])).toEqual([
			[1, 40],
			[41, 70],
			[71, null],
		]);
		expect(bands.every((b) => b.leaders === 0 && b.rows.length === 0)).toBe(
			true,
		);
	});

	it("counts a leader in the band their accession falls in, and only there", () => {
		// One leader per band, plus one on each inside edge. Every accession is
		// counted once, so the bands sum to the leaders handed in.
		const bands = buildLeaderArchetypes(
			[
				reign("g1", 0, JUDGE, 1),
				reign("g1", 0, JUDGE, 40),
				reign("g1", 0, JUDGE, 41),
				reign("g1", 0, JUDGE, 70),
				reign("g1", 0, JUDGE, 71),
				reign("g1", 0, JUDGE, 200),
			],
			[seat("g1", 0, 200)],
		);

		expect(bands.map((b) => b.leaders)).toEqual([2, 2, 2]);
		expect(bands.reduce((a, b) => a + b.leaders, 0)).toBe(6);
	});

	it("counts leaders rather than tenure, so a short reign weighs the same", () => {
		// The unit the request asks for. A leader who held the throne for two
		// turns and one who held it for twenty-eight are one leader each.
		const bands = buildLeaderArchetypes(
			[reign("g1", 0, ZEALOT, 41), reign("g1", 0, JUDGE, 43)],
			[seat("g1", 0, 100)],
		);

		expect(bands[1].rows).toEqual([
			{ archetype: ZEALOT, leaders: 1, wins: 0, rate: 0 },
			{ archetype: JUDGE, leaders: 1, wins: 0, rate: 0 },
		]);
	});

	it("counts the games that reach a band, so the last band's survivorship shows", () => {
		// Two short games and one long one. The 71+ band describes the long
		// game alone, and `games` read against the first band's is what says so.
		const bands = buildLeaderArchetypes(
			[
				reign("short1", 0, JUDGE, 1),
				reign("short2", 0, JUDGE, 1),
				reign("long", 0, ZEALOT, 1),
				reign("long", 0, ZEALOT, 90),
			],
			[seat("short1", 0, 50), seat("short2", 0, 50), seat("long", 0, 120)],
		);

		expect(bands.map((b) => b.games)).toEqual([3, 3, 1]);
		// And the band's rows follow: only the long game crowned anyone past 71.
		expect(bands[2].rows.map((r) => r.archetype)).toEqual([ZEALOT]);
	});

	it("holds a leader with no archetype in the band total but out of the rows", () => {
		// 92 of the corpus's 742 leaders. Left out of `leaders` it would vanish;
		// folded into the rows it would be an eleventh archetype that does not
		// exist. The difference is what the panel reports.
		const bands = buildLeaderArchetypes(
			[reign("g1", 0, null, 1), reign("g1", 0, JUDGE, 21)],
			[seat("g1", 0, 100)],
		);

		expect(bands[0].leaders).toBe(2);
		expect(bands[0].rows).toEqual([
			{ archetype: JUDGE, leaders: 1, wins: 0, rate: 0 },
		]);
	});

	it("credits wins to the seat's outcome, in the same unit as the bar", () => {
		const bands = buildLeaderArchetypes(
			[reign("g1", 0, JUDGE, 1), reign("g1", 1, JUDGE, 1)],
			[seat("g1", 0, 100, true), seat("g1", 1, 100)],
		);

		expect(bands[0].rows).toEqual([
			{ archetype: JUDGE, leaders: 2, wins: 1, rate: 0.5 },
		]);
	});

	it("ignores a leader whose seat is not focal", () => {
		// An opponent's seat on a profile corpus, or a nation the global facet
		// excluded: the row comes back from the join, and the seat it belongs to
		// is what decides whether it counts.
		const bands = buildLeaderArchetypes(
			[reign("g1", 0, JUDGE, 1), reign("g1", 1, ZEALOT, 1)],
			[seat("g1", 0, 100)],
		);

		expect(bands[0].rows.map((r) => r.archetype)).toEqual([JUDGE]);
		expect(bands[0].leaders).toBe(1);
	});
});
