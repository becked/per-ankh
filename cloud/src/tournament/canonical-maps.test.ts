import { describe, expect, it } from "vitest";
import { canonicalMapScript, CANONICAL_MAP_SCRIPTS } from "./canonical-maps";

describe("canonicalMapScript", () => {
	it("reconciles the two spellings the same script arrives in", () => {
		// Left: what a tournament match stores. Right: what a save says.
		const pairs: [string, string][] = [
			["MAPCLASS_MapScriptCoastalRainBasin", "MAPCLASS_CoastalRainBasin"],
			["MAPCLASS_MapScriptAridPlateau", "MAPCLASS_AridPlateau"],
			["MAPCLASS_MapscriptMountainPass", "MAPCLASS_MapScriptMountainPass"],
			["MAPCLASS_MapscriptWetlands", "MAPCLASS_Wetlands"],
		];
		for (const [a, b] of pairs) {
			expect(canonicalMapScript(a)).toBe(canonicalMapScript(b));
		}
	});

	it("keeps distinct scripts distinct", () => {
		const canonical = CANONICAL_MAP_SCRIPTS.map(canonicalMapScript);
		expect(new Set(canonical).size).toBe(canonical.length);
	});

	it("is idempotent", () => {
		const once = canonicalMapScript("MAPCLASS_MapScriptDota");
		expect(canonicalMapScript(once)).toBe(once);
	});
});
