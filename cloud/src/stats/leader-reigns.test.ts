import { describe, expect, it } from "vitest";
import {
	buildArchetypeThroneTime,
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
	end_turn: number,
): ReignInput {
	return { game_id, player_index, archetype, start_turn, end_turn };
}

const share = (
	bands: ReturnType<typeof buildArchetypeThroneTime>,
	i: number,
	archetype: string,
) => {
	const band = bands[i];
	const row = band.rows.find((r) => r.archetype === archetype);
	return row ? row.turns / (band.turns - band.unattributed_turns) : 0;
};

describe("buildArchetypeThroneTime", () => {
	it("always returns the three bands, in turn order", () => {
		const bands = buildArchetypeThroneTime([], []);

		expect(bands.map((b) => [b.from, b.to])).toEqual([
			[1, 40],
			[41, 70],
			[71, null],
		]);
		expect(bands.every((b) => b.turns === 0 && b.rows.length === 0)).toBe(true);
	});

	it("splits a reign that straddles a band edge, counting each turn once", () => {
		// One leader from turn 1 to the end of a 100-turn game. The bands are
		// inclusive on both bounds, so turns 1-40, 41-70 and 71-99 fall out —
		// 99 and not 100, because the reign is half-open at its end.
		const bands = buildArchetypeThroneTime(
			[reign("g1", 0, JUDGE, 1, 100)],
			[seat("g1", 0, 100)],
		);

		expect(bands.map((b) => b.turns)).toEqual([40, 30, 29]);
		expect(bands.reduce((a, b) => a + b.turns, 0)).toBe(99);
	});

	it("weights by leader-turns, not by reigns", () => {
		// The distortion the chart exists to remove: inside one band a seat
		// holds a 2-turn Zealot and a 28-turn Judge. Counted per reign they
		// would tie at 50% each.
		const bands = buildArchetypeThroneTime(
			[reign("g1", 0, ZEALOT, 41, 43), reign("g1", 0, JUDGE, 43, 71)],
			[seat("g1", 0, 100)],
		);

		expect(share(bands, 1, ZEALOT)).toBeCloseTo(2 / 30, 6);
		expect(share(bands, 1, JUDGE)).toBeCloseTo(28 / 30, 6);
	});

	it("counts the games that reach a band, so the last band's survivorship shows", () => {
		// Two short games and one long one. The 71+ band describes the long
		// game alone, and `games` is what says so.
		const bands = buildArchetypeThroneTime(
			[
				reign("short1", 0, JUDGE, 1, 50),
				reign("short2", 0, JUDGE, 1, 50),
				reign("long", 0, ZEALOT, 1, 120),
			],
			[seat("short1", 0, 50), seat("short2", 0, 50), seat("long", 0, 120)],
		);

		expect(bands.map((b) => b.games)).toEqual([3, 3, 1]);
		// And the band's rows follow: only the long game held a throne past 71.
		expect(bands[2].rows.map((r) => r.archetype)).toEqual([ZEALOT]);
	});

	it("reports throne-time with no archetype rather than dropping it", () => {
		// 12-14% of the local corpus's throne-time per band. Left out of `turns`
		// it would vanish; folded into the rows it would be a tenth archetype
		// that does not exist. It is its own number, and the shares divide by
		// what is left.
		const bands = buildArchetypeThroneTime(
			[reign("g1", 0, null, 1, 21), reign("g1", 0, JUDGE, 21, 41)],
			[seat("g1", 0, 100)],
		);

		expect(bands[0].turns).toBe(40);
		expect(bands[0].unattributed_turns).toBe(20);
		expect(bands[0].rows).toEqual([
			{ archetype: JUDGE, turns: 20, win_turns: 0, rate: 0 },
		]);
		expect(share(bands, 0, JUDGE)).toBe(1);
	});

	it("credits win_turns to the seat's outcome, in the same unit as the bar", () => {
		const bands = buildArchetypeThroneTime(
			[reign("g1", 0, JUDGE, 1, 41), reign("g1", 1, JUDGE, 1, 41)],
			[seat("g1", 0, 100, true), seat("g1", 1, 100)],
		);

		expect(bands[0].rows).toEqual([
			{ archetype: JUDGE, turns: 80, win_turns: 40, rate: 0.5 },
		]);
	});

	it("ignores a reign whose seat is not focal", () => {
		// An opponent's seat on a profile corpus, or a nation the global facet
		// excluded: the reign row comes back from the join, and the seat it
		// belongs to is what decides whether it counts.
		const bands = buildArchetypeThroneTime(
			[reign("g1", 0, JUDGE, 1, 41), reign("g1", 1, ZEALOT, 1, 41)],
			[seat("g1", 0, 100)],
		);

		expect(bands[0].rows.map((r) => r.archetype)).toEqual([JUDGE]);
		expect(bands[0].turns).toBe(40);
	});

	it("drops a zero-length reign without drawing an empty row", () => {
		// 16 of the corpus's 742 reigns are zero-length (7 of them two
		// accessions on one turn). They hold no throne-time, so an archetype
		// held only in one of them earns no bar.
		const bands = buildArchetypeThroneTime(
			[reign("g1", 0, ZEALOT, 20, 20), reign("g1", 0, JUDGE, 20, 41)],
			[seat("g1", 0, 100)],
		);

		expect(bands[0].rows.map((r) => r.archetype)).toEqual([JUDGE]);
	});
});
