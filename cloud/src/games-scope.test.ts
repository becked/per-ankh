// periodCutoff is pure date arithmetic — no rows to select from, so it is a
// unit test beside the source rather than an integration one like the SQL
// fragments in this file (test/integration/stats/global-slices.test.ts).

import { describe, expect, it } from "vitest";
import { parsePeriodParam, periodCutoff } from "./games-scope";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("periodCutoff", () => {
	it("opens no window for all time", () => {
		expect(periodCutoff("all", at("2026-08-31"))).toBeNull();
	});

	it("subtracts whole months in the ordinary case", () => {
		expect(periodCutoff("6m", at("2026-08-15"))).toBe("2026-02-15");
		expect(periodCutoff("12m", at("2026-08-15"))).toBe("2025-08-15");
	});

	it("crosses the year boundary", () => {
		expect(periodCutoff("6m", at("2026-02-10"))).toBe("2025-08-10");
	});

	it("clamps to the target month's last day rather than rolling forward", () => {
		// The defect this pins: setting the month alone would make these
		// 31 February, 31 November and 31 September, which JS normalizes
		// FORWARD — 2026-03-03, 2025-12-01, 2025-10-01 — silently opening the
		// window days late.
		expect(periodCutoff("6m", at("2026-08-31"))).toBe("2026-02-28");
		expect(periodCutoff("6m", at("2026-05-31"))).toBe("2025-11-30");
		expect(periodCutoff("6m", at("2026-03-31"))).toBe("2025-09-30");
	});

	it("clamps to 29 February in a leap year", () => {
		expect(periodCutoff("6m", at("2028-08-31"))).toBe("2028-02-29");
	});

	it("never returns a date after the one it was asked about", () => {
		// The window can only ever open in the past. Every day of a 31-day
		// month is where the forward-roll used to break this.
		for (let day = 1; day <= 31; day++) {
			const now = at(`2026-08-${String(day).padStart(2, "0")}`);
			for (const period of ["6m", "12m"] as const) {
				const cutoff = periodCutoff(period, now);
				expect(cutoff).not.toBeNull();
				expect(cutoff! <= now.toISOString().slice(0, 10)).toBe(true);
			}
		}
	});
});

describe("parsePeriodParam", () => {
	it("passes a known token through", () => {
		expect(parsePeriodParam("6m")).toBe("6m");
		expect(parsePeriodParam("12m")).toBe("12m");
	});

	it("falls back to all time rather than rejecting", () => {
		// Same forgiveness as parseSliceParam: a stale bookmark degrades to a
		// neighbouring view instead of 400ing, and the widest window is the
		// safest thing to degrade to.
		expect(parsePeriodParam("6mo")).toBe("all");
		expect(parsePeriodParam(null)).toBe("all");
		expect(parsePeriodParam("")).toBe("all");
	});
});
