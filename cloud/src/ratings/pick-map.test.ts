import { describe, expect, it } from "vitest";
import { ATLAS_POOL, ATLAS_BASE_URL } from "../generated/atlas-pool";
import { canonicalMapScript } from "../tournament/canonical-maps";
import { pickMap } from "./pick-map";

const rng = () => 0;

describe("the baked atlas pool", () => {
	it("names every map so a message about it is unambiguous", () => {
		// The copy-paste message carries the name and the first two parts of the
		// setting, and nothing else — no anchor, no options list. So those have
		// to identify a map on their own, or two people agree to play "DOTA" and
		// turn up on different maps. Where the pool holds several of one script
		// the name carries the variant ("DOTA Jungle"); where it holds two of one
		// variant, the setting is what separates them (the two Archipelagos).
		const said = ATLAS_POOL.map(
			(m) => `${m.name} (${m.setting.split(" · ").slice(0, 2).join(" · ")})`,
		);
		expect(new Set(said).size).toBe(said.length);
	});

	it("addresses every map with a distinct atlas anchor", () => {
		const anchors = ATLAS_POOL.map((m) => m.anchor);
		expect(new Set(anchors).size).toBe(anchors.length);
		expect(ATLAS_BASE_URL).toMatch(/^https:\/\//);
	});
});

describe("pickMap", () => {
	it("prefers a script neither of them has played", () => {
		const played = canonicalMapScript(ATLAS_POOL[0].script);
		const picked = pickMap(new Map([[played, 3]]), new Map(), rng)!;
		expect(canonicalMapScript(picked.script)).not.toBe(played);
	});

	it("falls back to whatever they have played least", () => {
		// Everything played, one script less than the rest.
		const heavy = new Map<string, number>(
			ATLAS_POOL.map((m) => [canonicalMapScript(m.script), 5]),
		);
		const light = canonicalMapScript(ATLAS_POOL[3].script);
		heavy.set(light, 1);
		const picked = pickMap(heavy, new Map(), rng)!;
		expect(canonicalMapScript(picked.script)).toBe(light);
	});

	it("skips a script the rest of the list already used", () => {
		const first = pickMap(new Map(), new Map(), rng)!;
		const used = new Set([canonicalMapScript(first.script)]);
		const second = pickMap(new Map(), new Map(), rng, used)!;
		expect(canonicalMapScript(second.script)).not.toBe(
			canonicalMapScript(first.script),
		);
	});

	it("still answers when every script has been used", () => {
		const all = new Set(ATLAS_POOL.map((m) => canonicalMapScript(m.script)));
		expect(pickMap(new Map(), new Map(), rng, all)).not.toBeNull();
	});
});
