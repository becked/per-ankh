// stripForeignPings is a pure blob transform — a unit test beside the source,
// like games-scope.test.ts, rather than an integration test against a request.

import { describe, expect, it } from "vitest";
import { stripForeignPings } from "./games";

const pin = (playerXmlId: number, text: string | null) => ({
	player_xml_id: playerXmlId,
	ping_type: text === null ? "PING_IMPROVEMENT" : "PING_NOTE",
	turn: 37,
	tile_xml_id: 1811,
	text,
	improvement: text === null ? "IMPROVEMENT_WATERMILL" : null,
});

const blobWith = (pings: unknown[]) => ({
	version: 2 as const,
	parser_version: "2.29.0",
	pings,
});

describe("stripForeignPings", () => {
	it("keeps only the uploader's own seat", () => {
		const blob = blobWith([pin(0, "mine"), pin(1, "theirs"), pin(0, null)]);
		const out = stripForeignPings(blob, 0) as { pings: unknown[] };
		expect(out.pings).toEqual([pin(0, "mine"), pin(0, null)]);
	});

	it("keeps none for an observer upload, which claims no seat", () => {
		const blob = blobWith([pin(0, "a"), pin(1, "b")]);
		const out = stripForeignPings(blob, null) as { pings: unknown[] };
		expect(out.pings).toEqual([]);
	});

	it("does not treat seat 0 as absent", () => {
		// The defect this pins: a falsy check on the index would send an
		// uploader who played player 0 — most single-player and hotseat saves
		// — down the observer branch and drop their own pins.
		const blob = blobWith([pin(0, "mine")]);
		const out = stripForeignPings(blob, 0) as { pings: unknown[] };
		expect(out.pings).toHaveLength(1);
	});

	it("returns the input unchanged when nothing is dropped", () => {
		const blob = blobWith([pin(2, "a"), pin(2, "b")]);
		expect(stripForeignPings(blob, 2)).toBe(blob);
	});

	it("passes a blob below 2.29.0 through untouched", () => {
		const blob = { version: 2 as const, parser_version: "2.28.0" };
		expect(stripForeignPings(blob, 0)).toBe(blob);
	});

	it("drops a row that is not an object rather than leaking it", () => {
		const blob = blobWith([pin(0, "mine"), null, "surprise", 7]);
		const out = stripForeignPings(blob, 0) as { pings: unknown[] };
		expect(out.pings).toEqual([pin(0, "mine")]);
	});

	it("leaves every other field alone", () => {
		const blob = { ...blobWith([pin(1, "theirs")]), map_tiles: [1, 2, 3] };
		const out = stripForeignPings(blob, 0) as Record<string, unknown>;
		expect(out.map_tiles).toBe(blob.map_tiles);
		expect(out.parser_version).toBe("2.29.0");
	});
});
