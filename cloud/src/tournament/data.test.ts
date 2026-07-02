import { describe, expect, it } from "vitest";
import { parseLinks, parseParts } from "./data";
import type { MatchRow, TournamentRow } from "./data";

// parseLinks only reads t.links; build a minimal row carrying just that column.
function rowWithLinks(links: string): TournamentRow {
	return { links } as TournamentRow;
}

// parseParts only reads m.parts; build a minimal match row carrying just that.
function rowWithParts(parts: string): MatchRow {
	return { parts } as MatchRow;
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
		expect(
			parseLinks(rowWithLinks('{"label":"x","url":"https://a.com"}')),
		).toEqual([]);
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
		expect(parseLinks(row)).toEqual([
			{ label: "safe", url: "https://safe.com" },
		]);
	});
});

describe("parseParts", () => {
	it("parses a well-formed parts array with casters and streams", () => {
		const row = rowWithParts(
			JSON.stringify([
				{
					id: "p1",
					scheduled_at: "2026-06-15T14:30:00.000Z",
					casters: [
						{ user_id: null, name: "Bob" },
						{ user_id: "u".repeat(21), name: "handle" },
					],
					streams: [
						{ url: "https://youtube.com/watch?v=a", label: "POV" },
						{ url: "https://twitch.tv/x", label: null },
					],
				},
				{
					id: "p2",
					scheduled_at: null,
					casters: [],
					streams: [],
				},
			]),
		);
		expect(parseParts(row)).toEqual([
			{
				id: "p1",
				scheduled_at: "2026-06-15T14:30:00.000Z",
				casters: [
					{ user_id: null, name: "Bob" },
					{ user_id: "u".repeat(21), name: "handle" },
				],
				streams: [
					{ url: "https://youtube.com/watch?v=a", label: "POV" },
					{ url: "https://twitch.tv/x", label: null },
				],
			},
			{
				id: "p2",
				scheduled_at: null,
				casters: [],
				streams: [],
			},
		]);
	});

	it("drops empty caster entries (neither user_id nor name)", () => {
		const row = rowWithParts(
			JSON.stringify([
				{
					id: "p1",
					casters: [
						{ user_id: null, name: null }, // empty → dropped
						{ user_id: null, name: "Keeper" },
						"nope", // non-object → dropped
					],
					streams: [],
				},
			]),
		);
		expect(parseParts(row)[0].casters).toEqual([
			{ user_id: null, name: "Keeper" },
		]);
	});

	it("returns [] for the empty-array default and on corruption", () => {
		expect(parseParts(rowWithParts("[]"))).toEqual([]);
		expect(parseParts(rowWithParts("{not json"))).toEqual([]);
		expect(parseParts(rowWithParts('{"id":"p1"}'))).toEqual([]);
	});

	it("skips entries without a string id and coerces bad fields to null", () => {
		const row = rowWithParts(
			JSON.stringify([
				{ scheduled_at: "x", streams: [] }, // no id → dropped
				{ id: 5, streams: [] }, // non-string id → dropped
				{ id: "ok", scheduled_at: 123, casters: "nope", streams: "nope" },
			]),
		);
		expect(parseParts(row)).toEqual([
			{
				id: "ok",
				scheduled_at: null,
				casters: [],
				streams: [],
			},
		]);
	});

	it("drops streams whose url isn't http(s) — defense-in-depth", () => {
		const row = rowWithParts(
			JSON.stringify([
				{
					id: "p1",
					streams: [
						{ url: "https://safe.com", label: null },
						// eslint-disable-next-line no-script-url
						{ url: "javascript:alert(1)", label: "xss" },
						{ url: "data:text/html,x", label: null },
						{ label: "no url" },
					],
				},
			]),
		);
		expect(parseParts(row)[0].streams).toEqual([
			{ url: "https://safe.com", label: null },
		]);
	});
});
