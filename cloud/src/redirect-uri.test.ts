import { describe, expect, it } from "vitest";
import { isAllowedRedirectUri, parseAllowedOrigins } from "./util";

// Prod config: ALLOWED_ORIGINS = "https://per-ankh.app,http://localhost:1420".
const ORIGINS = parseAllowedOrigins(
	"https://per-ankh.app,http://localhost:1420",
);

describe("parseAllowedOrigins", () => {
	it("splits, trims, and drops empties", () => {
		expect(parseAllowedOrigins(" https://a.test , http://b.test ,")).toEqual([
			"https://a.test",
			"http://b.test",
		]);
	});

	it("returns [] for an empty string", () => {
		expect(parseAllowedOrigins("")).toEqual([]);
	});
});

describe("isAllowedRedirectUri", () => {
	it("accepts /auth/callback on an allowed origin", () => {
		expect(
			isAllowedRedirectUri("https://per-ankh.app/auth/callback", ORIGINS),
		).toBe(true);
		expect(
			isAllowedRedirectUri("http://localhost:1420/auth/callback", ORIGINS),
		).toBe(true);
	});

	it("rejects a disallowed origin", () => {
		expect(
			isAllowedRedirectUri("https://evil.test/auth/callback", ORIGINS),
		).toBe(false);
	});

	it("rejects the right origin with the wrong path", () => {
		expect(
			isAllowedRedirectUri("https://per-ankh.app/somewhere-else", ORIGINS),
		).toBe(false);
		// Trailing junk on the callback path is not an exact match.
		expect(
			isAllowedRedirectUri("https://per-ankh.app/auth/callback/x", ORIGINS),
		).toBe(false);
	});

	it("rejects a scheme/port mismatch on an allowed host", () => {
		// http where only https is allowed for this host.
		expect(
			isAllowedRedirectUri("http://per-ankh.app/auth/callback", ORIGINS),
		).toBe(false);
		// Unlisted port.
		expect(
			isAllowedRedirectUri("http://localhost:9999/auth/callback", ORIGINS),
		).toBe(false);
	});

	it("rejects a malformed URL", () => {
		expect(isAllowedRedirectUri("not-a-url", ORIGINS)).toBe(false);
		expect(isAllowedRedirectUri("/auth/callback", ORIGINS)).toBe(false);
	});

	it("ignores query/fragment when matching path + origin", () => {
		expect(
			isAllowedRedirectUri("https://per-ankh.app/auth/callback?x=1#y", ORIGINS),
		).toBe(true);
	});
});
