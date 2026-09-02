import { describe, expect, it } from "vitest";
import { LAW_CLASSES } from "../generated/law-classes";
import {
	OPENING_LAWS_TOP_N,
	type PlayerGameRecord,
	boundOpeningLaws,
	dedupePlayerGames,
	emptyPlayerGame,
	foldRecordRow,
	rankRecords,
} from "./aggregate";

// Openings drawn from the real civic laws — succession laws never reach this
// field — as sorted windows over the sorted law list, so each set has the shape
// the aggregator builds: four names, order dropped, ascending.
const CIVIC_LAWS = Object.values(LAW_CLASSES)
	.filter((c) => !c.succession)
	.flatMap((c) => c.laws)
	.sort();
const opening = (i: number) => CIVIC_LAWS.slice(i, i + 4);

const EGYPT = "NATION_EGYPT";
const ROME = "NATION_ROME";

// One row per distinct opening, all for the same nation.
const egyptRows = (n: number, count: (i: number) => number) =>
	Array.from({ length: n }, (_, i) => ({
		nation: EGYPT,
		laws: opening(i),
		count: count(i),
	}));

describe("boundOpeningLaws", () => {
	// The windows have to outnumber the cap for any of this to bite.
	it("has enough distinct openings to exceed the cap", () => {
		expect(CIVIC_LAWS.length - 3).toBeGreaterThan(OPENING_LAWS_TOP_N + 4);
	});

	it("passes a nation through untouched while it is under the cap", () => {
		const rows = egyptRows(OPENING_LAWS_TOP_N, () => 1);
		expect(boundOpeningLaws(rows)).toEqual(rows);
	});

	it("keeps a nation's most played openings and drops its tail", () => {
		// Strictly descending counts, so the cut needs no tiebreak to be read.
		const rows = egyptRows(OPENING_LAWS_TOP_N + 2, (i) => 100 - i);
		expect(boundOpeningLaws(rows)).toEqual(rows.slice(0, OPENING_LAWS_TOP_N));
	});

	it("keeps a row under its nation's cut when the set places once summed", () => {
		const shared = opening(OPENING_LAWS_TOP_N + 1);
		// Egypt's least played opening — 16th of 16, so its own ranking drops it
		// — is the one Rome plays most, which makes the summed set the corpus's
		// most common opening and the aggregate view's top row.
		const egyptOnly = egyptRows(OPENING_LAWS_TOP_N, () => 4);
		const egyptShared = { nation: EGYPT, laws: shared, count: 1 };
		const rows = [
			...egyptOnly,
			egyptShared,
			{ nation: ROME, laws: shared, count: 20 },
		];

		expect(boundOpeningLaws(rows)).toEqual(rows);
		// Without Rome's copies the same row places in no ranking at all.
		expect(boundOpeningLaws([...egyptOnly, egyptShared])).toEqual(egyptOnly);
	});

	it("cuts the same rows whatever order they arrive in", () => {
		// Every count equal, which is the corpus's common case: two thirds of
		// the rows are singletons, so the tiebreak decides the whole cut.
		const rows = egyptRows(OPENING_LAWS_TOP_N + 5, () => 1);
		const kept = (rs: typeof rows) =>
			boundOpeningLaws(rs).map((r) => r.laws.join("|"));

		expect(kept(rows)).toHaveLength(OPENING_LAWS_TOP_N);
		expect(kept([...rows].reverse()).sort()).toEqual(kept(rows).sort());
	});
});

describe("records", () => {
	// A player-game's rows, folded in turn order the way loadYieldCurves does.
	function play(
		gameId: string,
		playerIndex: number,
		turns: Array<[turn: number, science: number]>,
	): PlayerGameRecord {
		const acc = emptyPlayerGame(gameId, playerIndex);
		for (const [turn, science] of turns) {
			foldRecordRow(acc, turn, new Map([["science_per_turn", science]]));
		}
		return acc;
	}

	const seats = new Map([
		["a|0", { nation: "NATION_EGYPT", name: "one" }],
		["a|1", { nation: "NATION_KUSH", name: "two" }],
	]);

	describe("foldRecordRow", () => {
		it("keeps the best value and the turn it happened on", () => {
			const acc = play("a", 0, [
				[10, 5],
				[20, 9],
				[30, 7],
			]);
			expect(acc.peak.get("science_per_turn")).toEqual({ value: 9, turn: 20 });
		});

		it("takes the last turn seen as the end of the game", () => {
			const acc = play("a", 0, [
				[10, 5],
				[30, 7],
				[20, 9],
			]);
			expect(acc.lastTurn).toBe(30);
			expect(acc.final.get("science_per_turn")).toBe(7);
		});

		it("captures a checkpoint only on the checkpoint turn", () => {
			const acc = play("a", 0, [
				[19, 1],
				[20, 2],
				[21, 3],
			]);
			expect(acc.at.get(20)?.get("science_per_turn")).toBe(2);
			expect(acc.at.has(40)).toBe(false);
		});
	});

	describe("dedupePlayerGames", () => {
		// Both players upload the same duel: two game_ids, one xml_game_id,
		// and the same two seats inside each.
		const twoUploads = new Map([
			["a|0", play("a", 0, [[10, 5]])],
			["a|1", play("a", 1, [[10, 3]])],
			["b|0", play("b", 0, [[10, 5]])],
			["b|1", play("b", 1, [[10, 3]])],
		]);
		const xml = new Map([
			["a", "save-1"],
			["b", "save-1"],
		]);

		it("collapses the two uploads of one match to one row per seat", () => {
			const kept = dedupePlayerGames(twoUploads, xml);
			expect(kept).toHaveLength(2);
			expect(kept.map((k) => k.playerIndex).sort()).toEqual([0, 1]);
		});

		it("keeps the upload that saw more of the game", () => {
			const uneven = new Map([
				[
					"a|0",
					play("a", 0, [
						[10, 5],
						[50, 5],
					]),
				],
				["b|0", play("b", 0, [[10, 5]])],
			]);
			expect(dedupePlayerGames(uneven, xml)[0].gameId).toBe("a");
		});

		it("leaves distinct matches alone", () => {
			const kept = dedupePlayerGames(
				twoUploads,
				new Map([
					["a", "save-1"],
					["b", "save-2"],
				]),
			);
			expect(kept).toHaveLength(4);
		});
	});

	describe("rankRecords", () => {
		const turns = new Map([["a", 60]]);

		it("orders a board by value, biggest first", () => {
			const { records } = rankRecords(
				[play("a", 0, [[10, 5]]), play("a", 1, [[10, 9]])],
				seats,
				turns,
			);
			expect(records.science_per_turn.peak.map((r) => r.value)).toEqual([9, 5]);
		});

		it("counts the population each board drew on, not the rows it kept", () => {
			// Twelve player-games, a ten-row board.
			const many = Array.from({ length: 12 }, (_, i) =>
				play("a", i, [[10, i]]),
			);
			const { records, recordCounts } = rankRecords(many, seats, turns);
			expect(records.science_per_turn.peak).toHaveLength(10);
			expect(recordCounts.peak).toBe(12);
		});

		it("counts a checkpoint board only over the games that reached it", () => {
			const { recordCounts } = rankRecords(
				[
					play("a", 0, [
						[20, 1],
						[40, 1],
					]),
					play("a", 1, [[20, 1]]),
				],
				seats,
				turns,
			);
			expect(recordCounts.t20).toBe(2);
			expect(recordCounts.t40).toBe(1);
		});

		it("ships every seat of a game that made a board, not just the holder", () => {
			const { recordGames } = rankRecords(
				[play("a", 0, [[10, 5]])],
				seats,
				turns,
			);
			expect(Object.keys(recordGames.a.seats).sort()).toEqual(["0", "1"]);
			expect(recordGames.a.turns).toBe(60);
		});

		it("has no board for a game that set no record", () => {
			const { recordGames } = rankRecords(
				[play("a", 0, [[10, 5]])],
				seats,
				turns,
			);
			expect(recordGames.b).toBeUndefined();
		});
	});
});
