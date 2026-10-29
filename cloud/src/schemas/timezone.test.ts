import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { TimeZoneSchema } from "./timezone";

// The zone id reaches two columns (users.timezone, tournament_slots.timezone)
// and is read back by a formatter that states an offset, so the two things
// worth pinning are which strings get in and what spelling gets stored.

function parse(input: unknown): v.SafeParseResult<typeof TimeZoneSchema> {
	return v.safeParse(TimeZoneSchema, input);
}

describe("TimeZoneSchema — what it accepts", () => {
	it.each([
		["America/New_York", "a DST-observing zone"],
		["Europe/London", "a zone whose abbreviation is its offset"],
		["Asia/Kolkata", "a half-hour offset"],
		["UTC", "the id with no region"],
		["Etc/GMT+5", "a fixed-offset id"],
		["US/Eastern", "a legacy tzdata link"],
	])("accepts %j — %s", (input) => {
		expect(parse(input).success).toBe(true);
	});

	it.each([
		["America/Nowhere", "a region that exists with a city that doesn't"],
		["GMT-4", "an offset written the way a player would type it"],
		["", "the empty string"],
		["Pacific/Auckland Pacific/Auckland", "two ids in one field"],
	])("rejects %j — %s", (input) => {
		expect(parse(input).success).toBe(false);
	});

	it("rejects a non-string", () => {
		expect(parse(42).success).toBe(false);
	});

	it("rejects a string past the length bound before asking Intl", () => {
		expect(parse(`America/${"x".repeat(100)}`).success).toBe(false);
	});
});

describe("TimeZoneSchema — what it stores", () => {
	// Intl matches ids case-insensitively, so without the transform the same
	// zone would land in the column spelled several ways — and the account
	// page compares the stored value against the browser's detected zone to
	// decide whether its dropdown is showing something saved.
	it("canonicalizes case", () => {
		const r = parse("america/new_york");
		expect(r.success && r.output).toBe("America/New_York");
	});

	it("trims surrounding whitespace", () => {
		const r = parse("  Europe/Berlin  ");
		expect(r.success && r.output).toBe("Europe/Berlin");
	});

	it("resolves a legacy link to the zone it points at", () => {
		const r = parse("US/Eastern");
		expect(r.success && r.output).toBe("America/New_York");
	});

	// tzdata keeps the bare abbreviations as zone ids of their own, and "EST"
	// is a fixed -05:00 that never shifts — which is exactly what the string
	// means and not what a player in New York means by it. Nothing in the app
	// offers it (both dropdowns list Intl.supportedValuesOf, which doesn't
	// include it), so this records what a direct API call gets: a real zone,
	// canonicalized to the id it is, rather than a quiet alias for
	// America/New_York.
	it("stores a bare abbreviation as the fixed-offset zone it is", () => {
		const r = parse("EST");
		expect(r.success && r.output).toBe("America/Panama");
	});
});
