// Drift test: cloud/src/momentum.ts must stay a mirror of the frontend's
// src/lib/game-detail/momentum.ts (same pattern as canonical-map-options —
// the two sides must not evolve separately). Compares the exported functions'
// source text and their behaviour on a synthetic duel; helper drift shows up
// in the behavioural comparison.
import { describe, expect, it } from "vitest";
import { momentumCurve as cloudCurve, type MomentumInput } from "./momentum";
import { momentumCurve as frontCurve } from "../../src/lib/game-detail/momentum";

function fixture(): MomentumInput {
	const data = (base: number) =>
		Array.from({ length: 30 }, (_, i) => ({
			turn: i + 2,
			rate: base + i * 0.5,
		}));
	return {
		a: 0,
		b: 1,
		finalTurn: 31,
		yieldHistory: [
			{ player_id: 0, yield_type: "YIELD_ORDERS", data: data(10) },
			{ player_id: 1, yield_type: "YIELD_ORDERS", data: data(8) },
			{ player_id: 0, yield_type: "YIELD_SCIENCE", data: data(12) },
			{ player_id: 1, yield_type: "YIELD_SCIENCE", data: data(12) },
			{ player_id: 0, yield_type: "YIELD_MONEY", data: data(5) },
			{ player_id: 1, yield_type: "YIELD_MONEY", data: data(4) },
			{ player_id: 0, yield_type: "YIELD_GROWTH", data: data(20) },
			{ player_id: 1, yield_type: "YIELD_GROWTH", data: data(15) },
		],
		playerHistory: [
			{
				player_id: 0,
				history: Array.from({ length: 30 }, (_, i) => ({
					turn: i + 2,
					military_power: 40 + i * 6,
				})),
			},
			{
				player_id: 1,
				history: Array.from({ length: 30 }, (_, i) => ({
					turn: i + 2,
					military_power: 40 + i * 5,
				})),
			},
		],
		mapTiles: [{ is_city_center: true }, { is_city_center: true }, {}],
		tileOwnership: [
			{ tile_xml_id: 0, turn: 2, owner_player_xml_id: 0 },
			{ tile_xml_id: 1, turn: 2, owner_player_xml_id: 1 },
		],
	};
}

describe("momentum mirror", () => {
	it("exports byte-identical function source", () => {
		expect(cloudCurve.toString()).toBe(frontCurve.toString());
	});

	it("scores a synthetic duel identically", () => {
		const a = cloudCurve(fixture());
		const b = frontCurve(fixture());
		expect(a).not.toBeNull();
		expect(a).toEqual(b);
	});

	it("is antisymmetric — swapping sides gives 1 − p", () => {
		const f = fixture();
		const swapped = { ...f, a: f.b, b: f.a };
		const pa = cloudCurve(f)!.points;
		const pb = cloudCurve(swapped)!.points;
		for (let i = 0; i < pa.length; i++) {
			expect(pa[i].p + pb[i].p).toBeCloseTo(1, 9);
		}
	});

	it("an unchanged stat contributes exactly zero change", () => {
		// Science is identical for both sides every turn → its ch is 0.00.
		const curve = cloudCurve(fixture())!;
		const sci = curve.dims.indexOf("science");
		for (const pt of curve.points.slice(1)) {
			expect(pt.ch[sci]).toBe(0);
		}
	});

	it("level decomposition sums to the log-odds", () => {
		const curve = cloudCurve(fixture())!;
		for (const pt of curve.points) {
			const logOdds = Math.log(pt.p / (1 - pt.p));
			const sum = pt.lv.reduce((s, v) => s + v, 0);
			// lv is rounded to 2dp per dimension for display.
			expect(sum).toBeCloseTo(logOdds, 1);
		}
	});
});
