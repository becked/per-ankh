// Client-side helpers for working with a tournament's map_pool instances.
// Mostly thin wrappers around the baked manifests at
// $lib/generated/{map-option-defs,map-script-options}.

import type { MapPoolEntry } from "$lib/api-cloud";
import {
	MAP_OPTION_DEFS,
	type MapOptionDef,
} from "$lib/generated/map-option-defs";
import { MAP_SCRIPT_OPTIONS } from "$lib/generated/map-script-options";
import { mapOptionChoiceLabel, mapOptionLabel } from "$lib/map-settings";
import { mapScriptLabel } from "$lib/tournament/map-scripts";

// The generic option-label helpers live in $lib/map-settings (shared with the
// game-detail Settings tab and save cards); re-export them so existing
// tournament call sites keep importing from here.
export { mapOptionChoiceLabel, mapOptionLabel };

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

// Options whose effective value differs from the XML default, as label/value
// pairs in display order. Used by the read-only pool summary to surface only
// the settings an organizer deliberately changed. Options not in the baked
// manifest are skipped (no default to compare against).
export function nonDefaultOptions(
	options: Record<string, string | boolean> | undefined,
	script: string,
): { option: string; label: string; value: string }[] {
	const out: { option: string; label: string; value: string }[] = [];
	for (const opt of optionsForScript(script)) {
		const def = MAP_OPTION_DEFS[opt];
		if (!def) continue;
		const value = effectiveOptionValue(options, opt);
		if (value === def.default) continue;
		out.push({
			option: opt,
			label: mapOptionLabel(opt),
			value: mapOptionChoiceLabel(opt, value),
		});
	}
	return out;
}

// Full descriptive name of a map instance, as bare space-joined words:
// "<aspect> <size> <script> <non-default option values>" — e.g. "Square Duel
// Continent Mirror Map". Aspect ratio always leads, then size, then the script
// name; then every remaining option whose value differs from its XML default,
// in manifest order. Aspect and size always render their current value (even
// at default); toggles render as their option label (they default off, so a
// non-default toggle is on); selects render as the chosen value's label.
export function mapFullName(
	options: Record<string, string | boolean> | undefined,
	script: string,
): string {
	const parts: string[] = [
		mapOptionChoiceLabel(
			"MAPASPECTRATIO",
			effectiveOptionValue(options, "MAPASPECTRATIO"),
		),
		mapOptionChoiceLabel("MAPSIZE", effectiveOptionValue(options, "MAPSIZE")),
		mapScriptLabel(script),
	];
	for (const opt of optionsForScript(script)) {
		// aspect ratio and size are already the leading words
		if (opt === "MAPSIZE" || opt === "MAPASPECTRATIO") continue;
		const def = MAP_OPTION_DEFS[opt];
		if (!def) continue;
		const value = effectiveOptionValue(options, opt);
		if (value === def.default) continue; // only non-default settings
		parts.push(
			def.kind === "toggle" ? def.label : mapOptionChoiceLabel(opt, value),
		);
	}
	return parts.join(" ");
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
