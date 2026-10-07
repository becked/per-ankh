import { describe, expect, it } from "vitest";
import { LAW_CLASSES } from "../generated/law-classes";
import {
	OPENING_LAWS_TOP_N,
	RECORD_KEYS,
	type SeatRecord,
	boundOpeningLaws,
	buildTurnLength,
	dedupeSeatRecords,
	emptySeatRecord,
	foldRecordRow,
	rankRecords,
} from "./aggregate";
import { TURN_LENGTH_BUCKET } from "./types";

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
	// The accumulators are RECORD_KEYS-indexed, so a test that wants to talk
	// about one series has to say which slot it is.
	const SCIENCE = RECORD_KEYS.indexOf("science_per_turn");

	// One seat's rows, folded in turn order the way loadYieldCurves does —
	// through one scratch buffer, as the real pass does, which is also what
	// pins that foldRecordRow doesn't retain it.
	function play(
		gameId: string,
		playerIndex: number,
		turns: Array<[turn: number, science: number]>,
	): SeatRecord {
		const acc = emptySeatRecord(gameId, playerIndex);
		const row = new Float64Array(RECORD_KEYS.length);
		for (const [turn, science] of turns) {
			row.fill(NaN);
			row[SCIENCE] = science;
			foldRecordRow(acc, turn, row);
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
			expect(acc.peakValue[SCIENCE]).toBe(9);
			expect(acc.peakTurn[SCIENCE]).toBe(20);
		});

		it("takes the first value a slot sees, negative or not", () => {
			// The incumbent starts absent, and `>` is false against it — so a
			// slot whose only values are below zero still has to record one.
			const acc = play("a", 0, [[10, -4]]);
			expect(acc.peakValue[SCIENCE]).toBe(-4);
			expect(acc.peakTurn[SCIENCE]).toBe(10);
		});

		it("leaves a slot no row filled absent", () => {
			const acc = play("a", 0, [[10, 5]]);
			const untouched = RECORD_KEYS.indexOf("money_per_turn");
			expect(acc.peakValue[untouched]).toBeNaN();
			expect(acc.final[untouched]).toBeNaN();
		});

		it("takes the last turn seen as the end of the game", () => {
			const acc = play("a", 0, [
				[10, 5],
				[30, 7],
				[20, 9],
			]);
			expect(acc.lastTurn).toBe(30);
			expect(acc.final[SCIENCE]).toBe(7);
		});

		it("captures a checkpoint only on the checkpoint turn", () => {
			const acc = play("a", 0, [
				[19, 1],
				[20, 2],
				[21, 3],
			]);
			expect(acc.at.get(20)?.[SCIENCE]).toBe(2);
			expect(acc.at.has(40)).toBe(false);
		});
	});

	describe("dedupeSeatRecords", () => {
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
			const kept = dedupeSeatRecords(twoUploads, xml);
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
			expect(dedupeSeatRecords(uneven, xml)[0].gameId).toBe("a");
		});

		it("picks the same upload whichever order the rows arrived in", () => {
			// Both uploads of a finished duel saw every turn, so the
			// more-turns rule doesn't decide — the common case, not the edge
			// one. Insertion order here is D1's row order under a query with
			// no ORDER BY, so a survivor that depended on it would make the
			// cached payload a function of the row order rather than of the
			// corpus.
			const forwards = dedupeSeatRecords(twoUploads, xml);
			const backwards = dedupeSeatRecords(
				new Map([...twoUploads].reverse()),
				xml,
			);
			expect(forwards.map((k) => k.gameId)).toEqual(
				backwards.map((k) => k.gameId),
			);
			expect(new Set(forwards.map((k) => k.gameId))).toEqual(new Set(["a"]));
		});

		it("leaves distinct matches alone", () => {
			const kept = dedupeSeatRecords(
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

		it("breaks a tie on the seat, whichever order the seats arrived in", () => {
			// Three seats tied at the top — the shape of an early checkpoint,
			// where the field is tight and the values are small integers.
			const tied = [
				play("c", 1, [[10, 7]]),
				play("a", 0, [[10, 7]]),
				play("b", 0, [[10, 7]]),
			];
			const order = (accs: SeatRecord[]) =>
				rankRecords(accs, seats, turns).records.science_per_turn.peak.map(
					(r) => `${r.game_id}|${r.player_index}`,
				);
			expect(order(tied)).toEqual(["a|0", "b|0", "c|1"]);
			expect(order([...tied].reverse())).toEqual(["a|0", "b|0", "c|1"]);
		});

		it("counts the population each board drew on, not the rows it kept", () => {
			// Twelve seats, a ten-row board.
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

		it("carries the record holder's seat and nobody else's", () => {
			// Seat 1 is in the same game and in `seats`, and never made a
			// board — an FFA's other players and a single-player game's AI
			// arrive exactly this way.
			const { recordGames } = rankRecords(
				[play("a", 0, [[10, 5]])],
				seats,
				turns,
			);
			expect(Object.keys(recordGames.a.seats)).toEqual(["0"]);
			expect(recordGames.a.seats[0]).toEqual({
				nation: "NATION_EGYPT",
				name: "one",
			});
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

describe("buildTurnLength", () => {
	it("has no distribution for an empty corpus", () => {
		expect(buildTurnLength([])).toBeNull();
	});

	it("reports one game as its own every statistic", () => {
		const only = buildTurnLength([73]);
		expect(only).toMatchObject({
			games: 1,
			min: 73,
			p25: 73,
			median: 73,
			mean: 73,
			p75: 73,
			max: 73,
		});
	});

	it("takes the turn counts in any order", () => {
		const ascending = [4, 40, 60, 73, 90, 180];
		const shuffled = [90, 4, 180, 60, 73, 40];
		expect(buildTurnLength(shuffled)).toEqual(buildTurnLength(ascending));
	});

	it("separates the mean from the median on a right-skewed corpus", () => {
		// The shape the real corpus has: a mound with a long thin right tail,
		// which is the whole reason both numbers are served.
		const turns = [50, 50, 50, 50, 50, 50, 50, 50, 50, 500];
		const stats = buildTurnLength(turns);
		expect(stats?.median).toBe(50);
		expect(stats?.mean).toBe(95);
	});

	it("brackets the median with the middle half", () => {
		const stats = buildTurnLength([10, 20, 30, 40, 50, 60, 70, 80]);
		expect(stats).not.toBeNull();
		expect(stats!.p25).toBeLessThan(stats!.median);
		expect(stats!.median).toBeLessThan(stats!.p75);
		expect(stats!.min).toBeLessThanOrEqual(stats!.p25);
		expect(stats!.p75).toBeLessThanOrEqual(stats!.max);
	});

	it("buckets every game exactly once", () => {
		const turns = [4, 19, 20, 39, 40, 73, 90, 119, 180];
		const stats = buildTurnLength(turns);
		expect(stats!.histogram.reduce((a, b) => a + b.count, 0)).toBe(
			turns.length,
		);
		expect(stats!.games).toBe(turns.length);
	});

	it("spans from the bucket holding min to the one holding max", () => {
		// 180 is a bucket boundary, so the last bucket is 180's own and not the
		// 160 one it would fall in if the range were treated as exclusive.
		const stats = buildTurnLength([4, 180]);
		expect(stats!.bucket_turns).toBe(TURN_LENGTH_BUCKET);
		expect(stats!.histogram[0].start).toBe(0);
		expect(stats!.histogram.at(-1)).toEqual({ start: 180, count: 1 });
	});

	it("keeps an interior bucket with no game, and leaves no empty end", () => {
		// 0–19 and 100–119 are occupied; everything between is a real gap in
		// the distribution, and dropping it would draw the two as neighbours.
		const stats = buildTurnLength([4, 110]);
		expect(stats!.histogram).toEqual([
			{ start: 0, count: 1 },
			{ start: 20, count: 0 },
			{ start: 40, count: 0 },
			{ start: 60, count: 0 },
			{ start: 80, count: 0 },
			{ start: 100, count: 1 },
		]);
	});

	it("gives a corpus inside one bucket a single bucket", () => {
		expect(buildTurnLength([61, 73, 79])!.histogram).toEqual([
			{ start: 60, count: 3 },
		]);
	});
});
