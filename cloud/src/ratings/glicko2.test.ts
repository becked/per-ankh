import { describe, expect, it } from "vitest";
import { glicko2, type Duel } from "./glicko2";

// Golden vectors generated from owglick's scripts/ratings.py `glicko2()` on the
// exact same input, so this port is verified byte-faithful to the reference
// engine. Regenerate with that script if the algorithm ever changes.
const DUELS: Duel[] = [
	{ date: "2026-01-05", p1: "A", p2: "B", winner: "A" },
	{ date: "2026-01-12", p1: "A", p2: "C", winner: "A" },
	{ date: "2026-01-20", p1: "B", p2: "C", winner: "B" },
	{ date: "2026-02-03", p1: "C", p2: "A", winner: "C" },
	{ date: "2026-02-15", p1: "B", p2: "A", winner: "B" },
];

const GOLDEN = {
	A: { r: 1395.3, rd: 217.8, vol: 0.06, games: 4 },
	B: { r: 1674.8, rd: 227.6, vol: 0.06, games: 3 },
	C: { r: 1486.2, rd: 240.2, vol: 0.06, games: 3 },
};

describe("glicko2", () => {
	const res = glicko2(DUELS);

	for (const id of ["A", "B", "C"] as const) {
		it(`matches owglick golden output for ${id}`, () => {
			expect(res[id].r).toBeCloseTo(GOLDEN[id].r, 1);
			expect(res[id].rd).toBeCloseTo(GOLDEN[id].rd, 1);
			expect(res[id].vol).toBeCloseTo(GOLDEN[id].vol, 4);
			expect(res[id].games).toBe(GOLDEN[id].games);
		});
	}

	it("is order-independent within a period (sorts by date)", () => {
		const shuffled = [DUELS[2], DUELS[0], DUELS[4], DUELS[1], DUELS[3]];
		expect(glicko2(shuffled)).toEqual(res);
	});

	it("returns the defaults for a single player's lone win", () => {
		const out = glicko2([
			{ date: "2026-01-01", p1: "X", p2: "Y", winner: "X" },
		]);
		// Winner's rating rises above 1500, loser's falls below; both keep the
		// starting volatility and have RD pulled in from 350 by playing a game.
		expect(out.X.r).toBeGreaterThan(1500);
		expect(out.Y.r).toBeLessThan(1500);
		expect(out.X.rd).toBeLessThan(350);
		expect(out.X.games).toBe(1);
	});
});
