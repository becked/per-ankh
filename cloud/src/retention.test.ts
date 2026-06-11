import { describe, expect, it } from "vitest";
import { KEEP_FOREVER, RETENTION_BUCKETS } from "./retention";

// An event type appearing in two lists would make the policy ambiguous
// (first-bucket-wins by iteration order, or deleted despite KEEP_FOREVER).
// Nothing at runtime catches an overlap, so pin it here.
describe("retention policy", () => {
	const lists = [
		...RETENTION_BUCKETS.map((b) => ({ name: b.name, types: b.types })),
		{ name: "KEEP_FOREVER", types: KEEP_FOREVER },
	];

	it("every list is non-empty", () => {
		for (const list of lists) {
			expect(list.types.length, list.name).toBeGreaterThan(0);
		}
	});

	it("no event type appears in more than one list", () => {
		const seen = new Map<string, string>();
		for (const list of lists) {
			for (const type of list.types) {
				const existing = seen.get(type);
				expect(
					existing,
					`"${type}" is in both ${existing} and ${list.name}`,
				).toBeUndefined();
				seen.set(type, list.name);
			}
		}
	});

	it("no list contains duplicates", () => {
		for (const list of lists) {
			expect(new Set(list.types).size, list.name).toBe(list.types.length);
		}
	});
});

describe("retention windows", () => {
	// A malformed modifier fails safe — datetime('now', ?) returns NULL and
	// the DELETE matches nothing — but a sign flip ("+24 hours") would put
	// the cutoff in the future and delete every live row of the bucket's
	// types. Pin the shape: negative, whole hours or days.
	const WINDOW_SHAPE = /^-(\d+) (hours|days)$/;

	function windowInHours(olderThan: string): number {
		const match = WINDOW_SHAPE.exec(olderThan);
		if (!match) return NaN;
		return match[2] === "days" ? Number(match[1]) * 24 : Number(match[1]);
	}

	function bucket(name: string) {
		const found = RETENTION_BUCKETS.find((b) => b.name === name);
		expect(found, name).toBeDefined();
		return found!;
	}

	it("every window is a negative whole hours/days modifier", () => {
		for (const b of RETENTION_BUCKETS) {
			expect(b.olderThan, b.name).toMatch(WINDOW_SHAPE);
		}
	});

	it("windows clear the longest reader of each bucket's types", () => {
		// Rate-limit reads span 1 hour (countEventsSince in games.ts,
		// enforceTournamentViewRateLimit in tournament/public.ts).
		expect(
			windowInHours(bucket("rate_limit_counters").olderThan),
		).toBeGreaterThan(1);
		// `./per-ankh admin stats` computes 30-day activity from
		// upload/login/delete events.
		expect(
			windowInHours(bucket("general_audit").olderThan),
		).toBeGreaterThanOrEqual(30 * 24);
	});
});
