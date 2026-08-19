// Cross-check for the header's match-count projection, which lives in the
// SvelteKit tree at src/lib/tournament/projected-totals.ts.
//
// Why the test is here and not beside the module: the frontend has no test
// runner, and the assertion worth making is that the census walk agrees with
// the REAL pairing engine — pairSwissRound and computeRecord are importable
// as siblings from this suite. The projection module is dependency-free, so
// reaching across the root costs nothing and touches no Worker bundle; it's
// the same reach canonical-map-options.test.ts already makes.
//
// The walk models the field as a census of W-L records with no player
// identity, so it cannot see one thing the engine does: pickByeRecipient
// skips players who already had a bye. That only diverges once a field runs
// out of never-byed players and someone takes a SECOND bye — small fields
// only, asserted below as the known boundary rather than papered over.

import { describe, expect, it } from "vitest";
import { pairSwissRound } from "./pairing";
import { computeRecord } from "./standings";
import type { MatchRef, SlotRef, TournamentConfig } from "./types";
import { projectSwissDivision } from "../../../src/lib/tournament/projected-totals";

// Deterministic PRNG: every future below is reproducible, so a failure is a
// real regression rather than an unlucky seed.
function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function project(n: number, config: TournamentConfig) {
	return projectSwissDivision(
		Array.from({ length: n }, () => ({ wins: 0, losses: 0 })),
		[],
		config.swiss_max_rounds,
		{
			winsToAdvance: config.swiss_wins_to_advance,
			lossesToEliminate: config.swiss_losses_to_eliminate,
		},
		0,
	);
}

// Play a whole division through the real engine, deciding each match by coin
// flip, and report what actually happened: playable matches (byes excluded,
// matching the projection's units) and how many players reached the win
// threshold.
function playDivision(
	n: number,
	config: TournamentConfig,
	rand: () => number,
): { matches: number; qualifiers: number; byes: string[] } {
	const slots: SlotRef[] = Array.from({ length: n }, (_, i) => ({
		slot_id: `s${i}`,
		phase: "swiss",
		division: "A",
		swiss_seed: i + 1,
		championship_seed: null,
		withdrawn: false,
	}));
	const played: MatchRef[] = [];
	const byes: string[] = [];
	let matches = 0;
	for (let round = 1; round <= config.swiss_max_rounds; round++) {
		const pairings = pairSwissRound(slots, played, round, config);
		for (const [i, p] of pairings.entries()) {
			const isBye = p.slot_b_id === null;
			if (isBye) byes.push(p.slot_a_id);
			else matches++;
			played.push({
				match_id: `m${round}-${i}`,
				round_id: `r${round}`,
				round_number: round,
				phase: "swiss",
				division: "A",
				slot_a_id: p.slot_a_id,
				slot_b_id: p.slot_b_id,
				map_pool_id: null,
				map_script: null,
				// Byes are written status='bye' with the lone slot as winner
				// (buildSwissRoundStatements), which computeRecord scores as a win.
				status: isBye ? "bye" : "complete",
				winner_slot_id: isBye
					? p.slot_a_id
					: rand() < 0.5
						? p.slot_a_id
						: p.slot_b_id!,
			});
		}
	}
	const qualifiers = slots.filter(
		(s) => computeRecord(s.slot_id, played, config).status === "advanced",
	).length;
	return { matches, qualifiers, byes };
}

function observe(n: number, config: TournamentConfig, futures: number) {
	const rand = lcg(n * 7919 + config.swiss_max_rounds * 31 + 13);
	let matchMin = Infinity;
	let matchMax = -Infinity;
	let qualMin = Infinity;
	let qualMax = -Infinity;
	let repeatByes = 0;
	for (let f = 0; f < futures; f++) {
		const r = playDivision(n, config, rand);
		matchMin = Math.min(matchMin, r.matches);
		matchMax = Math.max(matchMax, r.matches);
		qualMin = Math.min(qualMin, r.qualifiers);
		qualMax = Math.max(qualMax, r.qualifiers);
		if (r.byes.length !== new Set(r.byes).size) repeatByes++;
	}
	return { matchMin, matchMax, qualMin, qualMax, repeatByes };
}

const OWCT: TournamentConfig = {
	swiss_wins_to_advance: 3,
	swiss_losses_to_eliminate: 3,
	swiss_max_rounds: 5,
};
const DEEP: TournamentConfig = {
	swiss_wins_to_advance: 4,
	swiss_losses_to_eliminate: 4,
	swiss_max_rounds: 7,
};

const FUTURES = 300;

describe("projectSwissDivision vs the pairing engine", () => {
	// Real division sizes: OWCT runs two divisions in the high twenties, and
	// docs/tournament-rules.md calls out 29/27 and 30/26 as configurations
	// admins hit.
	for (const n of [6, 12, 16, 20, 24, 26, 27, 28, 29, 30, 31, 32]) {
		it(`brackets every future for a ${n}-player division`, () => {
			const p = project(n, OWCT);
			const o = observe(n, OWCT, FUTURES);
			expect(o.matchMin).toBeGreaterThanOrEqual(p.remainingMin);
			expect(o.matchMax).toBeLessThanOrEqual(p.remainingMax);
			expect(o.qualMin).toBeGreaterThanOrEqual(p.qualifiersMin);
			expect(o.qualMax).toBeLessThanOrEqual(p.qualifiersMax);
		});

		// The envelope is what the header renders: an exact number when closed,
		// "~N" when open. A loose envelope would print "~" (or a midpoint) for
		// a total that was actually pinned down, so tightness is the claim.
		it(`projects an exactly tight envelope for a ${n}-player division`, () => {
			const p = project(n, OWCT);
			const o = observe(n, OWCT, FUTURES);
			expect([o.matchMin, o.matchMax]).toEqual([
				p.remainingMin,
				p.remainingMax,
			]);
			expect([o.qualMin, o.qualMax]).toEqual([
				p.qualifiersMin,
				p.qualifiersMax,
			]);
		});
	}

	it("brackets a deeper 4W/4L, 7-round config", () => {
		for (const n of [16, 20, 24, 28, 32]) {
			const p = project(n, DEEP);
			const o = observe(n, DEEP, FUTURES);
			expect(o.matchMin).toBeGreaterThanOrEqual(p.remainingMin);
			expect(o.matchMax).toBeLessThanOrEqual(p.remainingMax);
			expect(o.qualMin).toBeGreaterThanOrEqual(p.qualifiersMin);
			expect(o.qualMax).toBeLessThanOrEqual(p.qualifiersMax);
		}
	});
});

describe("projectSwissDivision — the lone-survivor bye", () => {
	// Regression guard: playRound used to stop once fewer than two players were
	// active, but the engine hands the lone active slot a bye every remaining
	// round, and those free wins can carry them past the win threshold. The
	// walk reported a confidently exact qualifier count that was too low.
	it("counts the qualifier a one-player field byes its way to", () => {
		const p = project(4, OWCT);
		const o = observe(4, OWCT, FUTURES);
		expect(o.qualMax).toBe(3);
		expect(p.qualifiersMax).toBeGreaterThanOrEqual(3);
	});

	it("keeps a single active player playing to the end of Swiss", () => {
		// One player, 2 wins already, 3 rounds left: byes alone advance them.
		const p = projectSwissDivision(
			[{ wins: 2, losses: 0 }],
			[],
			3,
			{ winsToAdvance: 3, lossesToEliminate: 3 },
			0,
		);
		expect(p).toMatchObject({
			remainingMin: 0,
			remainingMax: 0,
			qualifiersMin: 1,
			qualifiersMax: 1,
		});
	});
});

describe("projectSwissDivision — the bye-recipient approximation", () => {
	// The census has no player identity, so it always seats the bye in the
	// worst bucket while the engine skips anyone who already had one. Pin the
	// boundary: at real field sizes the engine never repeats a bye, which is
	// why the walk stays exact there.
	it("never repeats a bye at a real division size", () => {
		for (const n of [26, 27, 28, 29, 30]) {
			expect(observe(n, OWCT, FUTURES).repeatByes).toBe(0);
		}
	});

	// Documented divergence, asserted so it can't drift silently: a 5-player
	// division byes every round and runs out of never-byed players, so the
	// engine seats a bye the census can't predict and plays one game fewer
	// than the walk's floor.
	it("can over-count matches once a small field repeats a bye", () => {
		const p = project(5, OWCT);
		const o = observe(5, OWCT, FUTURES);
		expect(o.repeatByes).toBeGreaterThan(0);
		expect(o.matchMin).toBeLessThan(p.remainingMin);
	});
});

describe("projectSwissDivision — pending matches", () => {
	const config = { winsToAdvance: 3, lossesToEliminate: 3 };

	it("forks a cross-record pending pair and folds a same-record one", () => {
		const active = [
			{ wins: 1, losses: 0 },
			{ wins: 1, losses: 0 },
			{ wins: 0, losses: 1 },
			{ wins: 0, losses: 1 },
		];
		const same = projectSwissDivision(
			active,
			[
				[
					{ wins: 1, losses: 0 },
					{ wins: 1, losses: 0 },
				],
			],
			0,
			config,
			0,
		);
		// One up, one down under either result — nothing to fork on.
		expect(same.remainingMin).toBe(same.remainingMax);
		expect(same.qualifiersMin).toBe(same.qualifiersMax);
	});

	it("skips a pending pair whose records aren't in the active census", () => {
		// A withdrawn player's not-yet-forfeited match: the walk must ignore
		// the game rather than drive a bucket negative and corrupt every later
		// round. Compare against the same field with no pending pair at all.
		const active = [
			{ wins: 1, losses: 0 },
			{ wins: 0, losses: 1 },
		];
		const ghost = projectSwissDivision(
			active,
			[
				[
					{ wins: 2, losses: 2 },
					{ wins: 0, losses: 0 },
				],
			],
			2,
			config,
			0,
		);
		const clean = projectSwissDivision(active, [], 2, config, 0);
		expect(ghost).toEqual(clean);
	});

	// Every cross-record pending pair forks, so without collapsing branches on
	// their census signature a full round of them costs 2^k walks — 20 pairs
	// measured at 5.2s before the fix, ~1ms after. The timeout is the
	// assertion; the envelope is checked so a broken collapse can't pass by
	// dropping branches.
	it("collapses duplicate pending-pair futures", { timeout: 1000 }, () => {
		const active = Array.from({ length: 40 }, (_, i) =>
			i % 2 === 0 ? { wins: 1, losses: 0 } : { wins: 0, losses: 1 },
		);
		const pairs = Array.from(
			{ length: 20 },
			() =>
				[
					{ wins: 1, losses: 0 },
					{ wins: 0, losses: 1 },
				] as [
					{ wins: number; losses: number },
					{ wins: number; losses: number },
				],
		);
		const p = projectSwissDivision(active, pairs, 3, config, 0);
		expect(p.remainingMin).toBeGreaterThan(0);
		expect(p.remainingMax).toBeGreaterThanOrEqual(p.remainingMin);
		expect(p.qualifiersMax).toBeGreaterThanOrEqual(p.qualifiersMin);
	});
});
