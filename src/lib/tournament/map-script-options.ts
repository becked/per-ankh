// Client-side helpers for working with a tournament's map_pool instances.
// Mostly thin wrappers around the baked manifests at
// $lib/generated/{map-option-defs,map-script-options}.

import type { MapPoolEntry } from "$lib/api-cloud";
import {
	MAP_OPTION_DEFS,
	type MapOptionDef,
} from "$lib/generated/map-option-defs";
import { MAP_SCRIPT_OPTIONS } from "$lib/generated/map-script-options";
import { formatEnum } from "$lib/utils/formatting";

// Find a map_pool entry by id. Returns undefined for a null/unknown id (e.g.
// a bye match, or a match whose instance no longer exists in the pool).
export function poolEntryById(
	pool: readonly MapPoolEntry[],
	id: string | null | undefined,
): MapPoolEntry | undefined {
	if (!id) return undefined;
	return pool.find((e) => e.id === id);
}

// Option zTypes that apply to a given script, in display order (globals
// first, then script-specific). Empty array for unknown scripts (e.g.
// legacy data from a tournament whose MAPCLASS is no longer baked).
export function optionsForScript(script: string): readonly string[] {
	return MAP_SCRIPT_OPTIONS[script] ?? [];
}

// Definition record for an option zType, or undefined if unknown.
export function optionDef(option: string): MapOptionDef | undefined {
	return MAP_OPTION_DEFS[option];
}

// Effective value for an option within an instance's options — instance-set if
// present, otherwise the XML default from the manifest, otherwise false for
// unknown toggles. Accepts undefined options (treated as all-unset).
export function effectiveOptionValue(
	options: Record<string, string | boolean> | undefined,
	option: string,
): string | boolean {
	const set = options?.[option];
	if (set !== undefined) return set;
	const def = MAP_OPTION_DEFS[option];
	if (!def) return false;
	return def.default;
}

// Human label for an option's group name. Falls back to formatEnum on
// unknown option zTypes (legacy data from a script whose options aren't
// in the current bake).
export function mapOptionLabel(option: string): string {
	const def = MAP_OPTION_DEFS[option];
	if (def) return def.label;
	return formatEnum(option, "MAP_OPTIONS_");
}

// Human label for a select choice value, scoped to a particular option
// (so labels can vary by parent option — e.g. SEASIDE_TRIBES_FOUR is
// "Four Tribes" but HARDWOOD_FOREST_TRIBES_FOREST is "Forest"). Falls
// back to formatEnum on unknowns.
export function mapOptionChoiceLabel(
	option: string,
	value: string | boolean,
): string {
	if (typeof value === "boolean") return value ? "On" : "Off";
	const def = MAP_OPTION_DEFS[option];
	if (def?.kind === "select") {
		const hit = def.choices.find((c) => c.value === value);
		if (hit) return hit.label;
	}
	return formatEnum(value, "MAP_OPTION_");
}

// Pre-fill a partial options object with XML defaults for a script.
// Used when the UI needs to show every option (selects + toggles) for a
// just-added script that the server hasn't reconciled yet (e.g. between
// an optimistic add and the invalidateAll re-fetch).
export function defaultsForScript(
	script: string,
): Record<string, string | boolean> {
	const out: Record<string, string | boolean> = {};
	for (const opt of optionsForScript(script)) {
		const def = MAP_OPTION_DEFS[opt];
		if (def) out[opt] = def.default;
	}
	return out;
}

// Compact human-readable summary of an instance's options, one "Label: Value"
// per line. Used in bracket-card tooltips. Empty string when the script has no
// options or isn't in the baked manifest.
export function summarizeOptions(
	options: Record<string, string | boolean> | undefined,
	script: string,
): string {
	const opts = optionsForScript(script);
	if (opts.length === 0) return "";
	const lines: string[] = [];
	for (const opt of opts) {
		const value = effectiveOptionValue(options, opt);
		lines.push(`${mapOptionLabel(opt)}: ${mapOptionChoiceLabel(opt, value)}`);
	}
	return lines.join("\n");
}
