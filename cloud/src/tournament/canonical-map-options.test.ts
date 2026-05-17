// Drift-guard: assert the hand-maintained cloud-side mirror in
// canonical-map-options.ts matches the bake-generated SvelteKit module
// at src/lib/generated/{map-option-defs,map-script-options}.ts exactly.
//
// When the bake regenerates the SvelteKit modules (new DLC, refreshed
// XML), the cloud mirror must be hand-updated to match. This test catches
// any drift at CI/test time.

import { describe, expect, it } from "vitest";
import {
	CANONICAL_MAP_OPTIONS,
	CANONICAL_MAP_OPTION_DEFAULTS,
	CANONICAL_SCRIPT_OPTIONS,
} from "./canonical-map-options";
import { MAP_OPTION_DEFS } from "../../../src/lib/generated/map-option-defs";
import { MAP_SCRIPT_OPTIONS } from "../../../src/lib/generated/map-script-options";

describe("canonical-map-options mirror", () => {
	it("covers every option zType from the generated module", () => {
		const generatedKeys = new Set(Object.keys(MAP_OPTION_DEFS));
		const mirrorKeys = new Set(Object.keys(CANONICAL_MAP_OPTIONS));
		expect(mirrorKeys).toEqual(generatedKeys);
	});

	it("matches kind + choices for every option", () => {
		for (const [key, def] of Object.entries(MAP_OPTION_DEFS)) {
			const mirror = CANONICAL_MAP_OPTIONS[key];
			expect(mirror, `missing in cloud mirror: ${key}`).toBeDefined();
			expect(mirror.kind).toBe(def.kind);
			if (def.kind === "select" && mirror.kind === "select") {
				expect(mirror.choices).toEqual(def.choices.map((c) => c.value));
			}
		}
	});

	it("covers every default value from the generated module", () => {
		for (const [key, def] of Object.entries(MAP_OPTION_DEFS)) {
			if (def.kind === "select") {
				expect(CANONICAL_MAP_OPTION_DEFAULTS[key]).toBe(def.default);
			} else {
				expect(CANONICAL_MAP_OPTION_DEFAULTS[key]).toBe(false);
			}
		}
	});

	it("covers every script from the generated MAP_SCRIPT_OPTIONS", () => {
		const generatedKeys = new Set(Object.keys(MAP_SCRIPT_OPTIONS));
		const mirrorKeys = new Set(Object.keys(CANONICAL_SCRIPT_OPTIONS));
		expect(mirrorKeys).toEqual(generatedKeys);
	});

	it("matches per-script option arrays (order-sensitive)", () => {
		for (const [script, opts] of Object.entries(MAP_SCRIPT_OPTIONS)) {
			expect(CANONICAL_SCRIPT_OPTIONS[script]).toEqual(opts);
		}
	});
});
