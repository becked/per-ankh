import { describe, expect, it } from "vitest";
import { BUNDLE_SCHEMA_VERSION, cacheKeyToString } from "./cache";
import type { GlobalPeriod, GlobalSlice } from "./types";

const EGYPT = "NATION_EGYPT";
const ROME = "NATION_ROME";

const PARSER = "2.15.0";

const globalKey = (
	nations: string[],
	slice: GlobalSlice = "duel",
	period: GlobalPeriod = "all",
) =>
	({
		kind: "global",
		slice,
		nations,
		period,
		parser_version: PARSER,
	}) as const;

describe("the global cache key", () => {
	it("carries both version segments the other corpora key on", () => {
		// The schema version is what a serve-stale walk pins and the parser
		// version is what it reaches across, so the two have to be here and in
		// this order for §12's rule to be expressible at all.
		expect(cacheKeyToString(globalKey([]))).toBe(
			`stats:v${BUNDLE_SCHEMA_VERSION}-p${PARSER}:global:duel::all`,
		);
	});

	it("gives one selection one spelling however it was ordered", () => {
		// The resolver takes a set so multi-select stays a UI change rather than
		// a key migration. That only holds if the key normalizes too — otherwise
		// one selection caches under as many keys as it has orderings.
		expect(cacheKeyToString(globalKey([ROME, EGYPT]))).toBe(
			cacheKeyToString(globalKey([EGYPT, ROME, EGYPT])),
		);
	});

	it("keeps a faceted selection out of its own slice's suffix", () => {
		// getStaleGlobalCached matches candidates by suffix. The empty nation
		// set leaves the trailing colon that makes the two distinguishable; drop
		// it and a Rome bundle answers a lookup for the whole slice.
		expect(
			cacheKeyToString(globalKey([ROME])).endsWith(":global:duel::all"),
		).toBe(false);
	});

	it("keeps one nation out of another's suffix", () => {
		// Same match, the multi-select case: ",NATION_ROME" must not read as
		// the Rome selection.
		expect(
			cacheKeyToString(globalKey([EGYPT, ROME])).endsWith(
				":global:duel:NATION_ROME:all",
			),
		).toBe(false);
	});

	it("separates the slices", () => {
		expect(cacheKeyToString(globalKey([], "all"))).not.toBe(
			cacheKeyToString(globalKey([], "duel")),
		);
	});

	it("separates the recency windows", () => {
		// The window changes which games are in the corpus, so it changes what
		// the bundle is OF — two windows sharing a key would serve one as the
		// other for up to a day.
		expect(cacheKeyToString(globalKey([], "duel", "6m"))).not.toBe(
			cacheKeyToString(globalKey([], "duel", "12m")),
		);
	});

	it("keeps one window out of another's suffix", () => {
		// The same suffix match the nation cases guard: "12m" must not read as
		// a lookup for "2m", nor "all" for a longer token ending in it.
		const six = cacheKeyToString(globalKey([], "duel", "6m"));
		expect(six.endsWith(":global:duel::12m")).toBe(false);
		expect(six.endsWith(":global:duel::all")).toBe(false);
	});
});
