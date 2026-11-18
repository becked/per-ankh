import { describe, expect, it } from "vitest";
import { askCostUsd, RESERVED_QUESTION_USAGE, settledUsage } from "./ask-usage";

describe("settledUsage", () => {
	it("sums a question's calls", () => {
		expect(
			settledUsage([
				{ inputTokens: 9000, cachedInputTokens: 8800, outputTokens: 120 },
				{ inputTokens: 9300, cachedInputTokens: 9000, outputTokens: 90 },
			]),
		).toEqual({
			inputTokens: 18300,
			cachedInputTokens: 17800,
			outputTokens: 210,
		});
	});

	it("counts a call that reported no input tokens at the reservation", () => {
		const settled = settledUsage([
			{ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
		]);
		expect(settled.inputTokens * 2).toBe(RESERVED_QUESTION_USAGE.inputTokens);
		expect(settled.outputTokens * 2).toBe(RESERVED_QUESTION_USAGE.outputTokens);
		expect(settled.cachedInputTokens).toBe(0);
	});

	it("clamps cached tokens to input tokens", () => {
		expect(
			settledUsage([
				{ inputTokens: 100, cachedInputTokens: 500, outputTokens: 10 },
			]).cachedInputTokens,
		).toBe(100);
	});
});

describe("askCostUsd", () => {
	it("prices uncached input, cached input and output separately", () => {
		// 9,750 uncached at $0.30/M and 120 out at $1.20/M.
		expect(
			askCostUsd({
				inputTokens: 9750,
				cachedInputTokens: 0,
				outputTokens: 120,
			}),
		).toBeCloseTo(0.003069, 6);
		// The same call with 9,500 of its input cached at $0.006/M.
		expect(
			askCostUsd({
				inputTokens: 9750,
				cachedInputTokens: 9500,
				outputTokens: 120,
			}),
		).toBeCloseTo(0.000075 + 0.000057 + 0.000144, 6);
	});

	it("reserves about $0.012 a question", () => {
		expect(askCostUsd(RESERVED_QUESTION_USAGE)).toBeCloseTo(0.0121, 4);
	});
});
