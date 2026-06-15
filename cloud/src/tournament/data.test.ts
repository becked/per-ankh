import { describe, expect, it } from "vitest";
import { parseLinks } from "./data";
import type { TournamentRow } from "./data";

// parseLinks only reads t.links; build a minimal row carrying just that column.
function rowWithLinks(links: string): TournamentRow {
	return { links } as TournamentRow;
}

describe("parseLinks", () => {
	it("parses a well-formed array", () => {
		const row = rowWithLinks(
			JSON.stringify([
				{ label: "Map pics", url: "https://old-world-map-pics.com" },
				{ label: "Discord", url: "http://discord.gg/x" },
			]),
		);
		expect(parseLinks(row)).toEqual([
			{ label: "Map pics", url: "https://old-world-map-pics.com" },
			{ label: "Discord", url: "http://discord.gg/x" },
		]);
	});

	it("returns [] for the empty-array default", () => {
		expect(parseLinks(rowWithLinks("[]"))).toEqual([]);
	});

	it("returns [] on corrupt JSON", () => {
		expect(parseLinks(rowWithLinks("{not json"))).toEqual([]);
	});

	it("returns [] when the JSON isn't an array", () => {
		expect(parseLinks(rowWithLinks('{"label":"x","url":"https://a.com"}'))).toEqual(
			[],
		);
	});

	it("skips malformed entries (missing/non-string fields)", () => {
		const row = rowWithLinks(
			JSON.stringify([
				{ label: "ok", url: "https://ok.com" },
				{ label: "no url" },
				{ url: "https://no-label.com" },
				{ label: 5, url: "https://bad-label-type.com" },
				null,
				"string entry",
			]),
		);
		expect(parseLinks(row)).toEqual([{ label: "ok", url: "https://ok.com" }]);
	});

	it("drops entries whose url isn't http(s) — defense-in-depth", () => {
		const row = rowWithLinks(
			JSON.stringify([
				{ label: "safe", url: "https://safe.com" },
				// eslint-disable-next-line no-script-url
				{ label: "xss", url: "javascript:alert(1)" },
				{ label: "data", url: "data:text/html,<script>1</script>" },
				{ label: "not a url", url: "not a url at all" },
			]),
		);
		expect(parseLinks(row)).toEqual([{ label: "safe", url: "https://safe.com" }]);
	});
});
