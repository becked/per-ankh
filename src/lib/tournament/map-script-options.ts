// Client-side helpers for working with a tournament's map_pool instances.
// Mostly thin wrappers around the baked manifests at
// $lib/generated/{map-option-defs,map-script-options}.

import type { MapPoolEntry } from "$lib/api-cloud";
import {
	LOW_CITY_SITES_THRESHOLD,
	MAP_MIN_CITY_SITES,
} from "$lib/generated/map-caveats";
import {
	MAP_OPTION_DEFS,
	type MapOptionDef,
} from "$lib/generated/map-option-defs";
import { MAP_SCRIPT_OPTIONS } from "$lib/generated/map-script-options";
import { mapOptionChoiceLabel, mapOptionLabel } from "$lib/map-settings";
import { mapScriptAbbrev, mapScriptLabel } from "$lib/tournament/map-scripts";
import { slugify } from "$lib/utils/slug";

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

// Map-pool label spec (mirrors owtournamentatlas' canonical cfgLabel):
//   [Aspect] [Size] [Map Script] [Option] [PS]
// Two forms share everything but the Map Script (full name vs abbreviation)
// and aspect ("Square" vs "Sq"); see mapPoolLabel below.

const POINT_SYMMETRY_OPTION = "MAP_OPTIONS_SINGLE_POINT_SYMMETRY";

// DOTA is point-symmetry-locked in-game (a fixed default, not a toggle), so
// "PS" is implied and never shown for it — matching the atlas spec.
const DOTA_SCRIPT = "MAPCLASS_MapScriptDota";

// The label uses the atlas' script names, which match per-ankh's friendly
// labels everywhere except DOTA: the atlas (and the community) call it "DOTA"
// rather than its in-game name "Duel of the Ancients".
const POOL_FULL_NAME_OVERRIDES: Record<string, string> = {
	[DOTA_SCRIPT]: "DOTA",
};

// The single "variant" option that identifies a map within its script family —
// the only non-aspect/size option the label ever surfaces (everything else,
// e.g. resource density or city sites, is deliberately omitted as noise). The
// option is shown only when its value actually varies across the pool (see
// distinguishingOptions), so single-variant scripts like Archipelago stay bare.
//
// Listed current spelling first, superseded spellings after. The 2026-07-01
// game patch renamed DOTA's terrain axis (BOUNDARY_TERRAIN → INNER_TERRAIN)
// with a parallel rename of its values, but pools configured before the patch
// still store the old key and can't be rewritten while a tournament is running
// (issue #115). The label reads whichever spelling an instance actually carries
// and maps both onto the same wording, so pre- and post-patch pools read alike
// and resolve to the same atlas anchor.
const VARIANT_OPTIONS_BY_SCRIPT: Record<string, readonly string[]> = {
	[DOTA_SCRIPT]: [
		"MAP_OPTIONS_MULTI_DOTA_INNER_TERRAIN",
		"MAP_OPTIONS_MULTI_DOTA_BOUNDARY_TERRAIN",
	],
	MAPCLASS_MapScriptAridPlateau: ["MAP_OPTIONS_MULTI_ARID_WATER_SIZE"],
	MAPCLASS_MapScriptDesert: ["MAP_OPTIONS_DESERT_COAST"],
};

// The option a script's variant is tracked under everywhere the label machinery
// keys by it (the distinguishing set, labelConsumedOptions, atlasAnchor): the
// current spelling, whichever one a given instance happens to store. Keying on
// one spelling is what lets a pool that mixes pre- and post-patch instances
// compare their variants against each other.
function variantOptionFor(script: string): string | undefined {
	return VARIANT_OPTIONS_BY_SCRIPT[script]?.[0];
}

// The option to read an instance's variant value from: whichever spelling the
// instance actually carries, falling back to the current one (an instance that
// leans on the XML default stores neither).
function storedVariantOption(entry: MapPoolEntry): string | undefined {
	const candidates = VARIANT_OPTIONS_BY_SCRIPT[entry.script];
	if (!candidates) return undefined;
	return (
		candidates.find((o) => entry.options?.[o] !== undefined) ?? candidates[0]
	);
}

// Label wording for variant-option values, per the atlas spec — terser than
// the editor's choice labels ("Small Jagged Seas" → "Small Seas", "None" →
// "No Coast"). `short` is the compressed-form trim ("Large Seas" → "Lg Seas",
// "No Coast" → "NoCst"); when a value has no distinct short form the two match.
// Falls through to the canonical choice label for anything not listed.
const VARIANT_VALUE_LABELS: Record<string, { full: string; short: string }> = {
	MAP_OPTION_TERRAIN_JUNGLE: { full: "Jungle", short: "Jungle" },
	MAP_OPTION_TERRAIN_SAND: { full: "Sand", short: "Sand" },
	MAP_OPTION_TERRAIN_WATER: { full: "Water", short: "Water" },
	MAP_OPTION_TERRAIN_MOUNTAINS: { full: "Mountain", short: "Mountain" },
	// Post-2026-07-01 spellings of the four above. Deliberately the same wording
	// as their pre-patch counterparts: the atlas kept its terrain vocabulary
	// across the patch, so both spellings have to land on the same word for a
	// mixed pool to read consistently and for atlasAnchor to stay stable.
	MAP_OPTION_TERRAIN_INNER_JUNGLE: { full: "Jungle", short: "Jungle" },
	MAP_OPTION_TERRAIN_INNER_SAND: { full: "Sand", short: "Sand" },
	MAP_OPTION_TERRAIN_INNER_WATER: { full: "Water", short: "Water" },
	MAP_OPTION_TERRAIN_INNER_MOUNTAINS: { full: "Mountain", short: "Mountain" },
	MAP_OPTION_TERRAIN_INNER_RANDOM: { full: "Random", short: "Random" },
	MAP_OPTION_ARID_WATER_SIZE_LARGE: { full: "Large Seas", short: "Lg Seas" },
	MAP_OPTION_ARID_WATER_SIZE_SMALL: { full: "Small Seas", short: "Sm Seas" },
	MAP_OPTION_DESERT_COAST_LUSH: { full: "Lush", short: "Lush" },
	MAP_OPTION_DESERT_COAST_DRY: { full: "Dry", short: "Dry" },
	MAP_OPTION_DESERT_COAST_NONE: { full: "No Coast", short: "NoCst" },
	MAP_OPTION_DESERT_COAST_RANDOM: { full: "Random Coast", short: "Random" },
};

// The set of variant options whose value is not constant across the pool — the
// settings that actually tell two maps in a script family apart. Computed over
// the whole pool so a uniform tournament-wide choice stays out of the label
// while a genuine per-map axis (DOTA terrain, Arid sea size, Desert coast)
// shows up. Only the curated VARIANT_OPTIONS_BY_SCRIPT options are considered.
//
// Variants are compared by their rendered wording rather than their raw zType,
// so the two spellings of one terrain (pre- and post-2026-07-01) count as the
// same variant instead of reading as a difference the player can't see.
export function distinguishingOptions(
	pool: readonly MapPoolEntry[],
): Set<string> {
	const valuesByOption = new Map<string, Set<string>>();
	for (const entry of pool) {
		const opt = variantOptionFor(entry.script);
		if (!opt || !MAP_OPTION_DEFS[opt]) continue;
		let seen = valuesByOption.get(opt);
		if (!seen) {
			seen = new Set();
			valuesByOption.set(opt, seen);
		}
		seen.add(variantValueLabel(entry, false));
	}
	const out = new Set<string>();
	for (const [opt, values] of valuesByOption) {
		if (values.size > 1) out.add(opt);
	}
	return out;
}

// The option zTypes that mapPoolLabel already surfaces for an entry: aspect
// and size (always), point symmetry (when it renders "PS"), and the script's
// variant option (when it's distinguishing). Detail views like the pool
// summary subtract these so they don't repeat what the headline label shows.
export function labelConsumedOptions(
	entry: MapPoolEntry,
	distinguishing: ReadonlySet<string>,
): Set<string> {
	const consumed = new Set<string>(["MAPASPECTRATIO", "MAPSIZE"]);
	if (
		entry.script !== DOTA_SCRIPT &&
		effectiveOptionValue(entry.options, POINT_SYMMETRY_OPTION) === true
	) {
		consumed.add(POINT_SYMMETRY_OPTION);
	}
	const variantOption = variantOptionFor(entry.script);
	if (variantOption && distinguishing.has(variantOption)) {
		consumed.add(variantOption);
	}
	return consumed;
}

// Label wording for a variant option's current value on an instance. `compact`
// picks the trimmed form ("Large Seas" → "Lg Seas"). Reads whichever option
// spelling the instance carries, so pre- and post-patch DOTA both resolve.
function variantValueLabel(entry: MapPoolEntry, compact: boolean): string {
	const option = storedVariantOption(entry);
	if (!option) return "";
	const value = effectiveOptionValue(entry.options, option);
	if (typeof value === "string" && VARIANT_VALUE_LABELS[value]) {
		const forms = VARIANT_VALUE_LABELS[value];
		return compact ? forms.short : forms.full;
	}
	return mapOptionChoiceLabel(option, value);
}

// A readable one-line label for a map-pool entry, in the shape
// "[Aspect] [Size] [Option] [Map Script] [PS]" — e.g. "Square Duel Large Seas
// Arid Plateau PS" (full) or "Sq Duel Lg Seas AridP PS" (compact). The Option
// (the script's variant trait) reads as an adjective on the script noun, and
// appears only when it varies across `distinguishing` (the pool-wide set from
// distinguishingOptions). `compact` abbreviates the script name, renders aspect
// "Square" as "Sq", and trims the trait; size and PS are identical in both
// forms. "PS" is appended when point symmetry is on, except for DOTA (point-
// sym-locked, so it's implied). Mirror is always on and never shown.
export function mapPoolLabel(
	entry: MapPoolEntry,
	distinguishing: ReadonlySet<string>,
	compact = false,
): string {
	const aspectValue = effectiveOptionValue(entry.options, "MAPASPECTRATIO");
	const aspect =
		compact && aspectValue === "MAPASPECTRATIO_SQUARE"
			? "Sq"
			: mapOptionChoiceLabel("MAPASPECTRATIO", aspectValue);
	const size = mapOptionChoiceLabel(
		"MAPSIZE",
		effectiveOptionValue(entry.options, "MAPSIZE"),
	);
	const script = compact
		? mapScriptAbbrev(entry.script)
		: (POOL_FULL_NAME_OVERRIDES[entry.script] ?? mapScriptLabel(entry.script));

	const parts: string[] = [aspect, size];
	// Option (trait) sits before the script so the label reads as an adjective
	// on the script noun: "Large Seas Arid Plateau", "Jungle DOTA".
	const variantOption = variantOptionFor(entry.script);
	if (variantOption && distinguishing.has(variantOption)) {
		parts.push(variantValueLabel(entry, compact));
	}
	parts.push(script);
	if (
		entry.script !== DOTA_SCRIPT &&
		effectiveOptionValue(entry.options, POINT_SYMMETRY_OPTION) === true
	) {
		parts.push("PS");
	}
	return parts.join(" ");
}

// Base URL of the community map atlas (owtournamentatlas). The map anchor is
// appended as a `#fragment`. Kept as a constant so a fork can repoint it.
export const ATLAS_BASE_URL = "https://alcaras.github.io/owtournamentatlas/";

// The owtournamentatlas URL anchor for a map instance: its canonical compact
// label, slugged — matching the atlas' own `slugify(cfgLabel(short))` — e.g.
// "Sq Duel Sm Seas AridP PS" → "sq-duel-sm-seas-aridp-ps". The variant trait is
// forced in so the anchor carries it even for a script whose trait doesn't vary
// elsewhere in the pool. slugify is the same function the map-caveat bake keys
// its table with, so an anchor here and a baked key can't diverge on slugging.
export function atlasAnchor(entry: MapPoolEntry): string {
	const variant = variantOptionFor(entry.script);
	const forced = variant ? new Set([variant]) : new Set<string>();
	return slugify(mapPoolLabel(entry, forced, true));
}

// A deep link to a map instance on owtournamentatlas (base + #anchor).
export function atlasMapUrl(entry: MapPoolEntry): string {
	return `${ATLAS_BASE_URL}#${atlasAnchor(entry)}`;
}

// Whether the map is covered by owtournamentatlas (its anchor resolves to a
// real section). Keyed off the baked caveat table, which enumerates exactly the
// atlas' PUBLISHED pool — the only maps the atlas index page creates anchors
// for — so a map outside it never links to a dead anchor. Re-bake
// (scripts/bake-map-caveats.ts) when the atlas pool changes.
export function mapInAtlas(entry: MapPoolEntry): boolean {
	return atlasAnchor(entry) in MAP_MIN_CITY_SITES;
}

const ARCHIPELAGO_SCRIPT = "MAPCLASS_MapScriptArchipelago";

// A one-line generation caveat for the scheduling DM, or "" when the map has
// none. Two independent risks (see map-caveats): Archipelago can spawn with the
// capitals on separate landmasses (no land connection), and any map whose
// observed minimum city sites is ≤ the threshold can spawn short on sites.
// Either or both fold into a single "…if that happens, a caster will let you
// know and you can reroll (or play on)" note, matching how casters handle it.
export function mapCaveatNote(entry: MapPoolEntry): string {
	const landRisk = entry.script === ARCHIPELAGO_SCRIPT;
	const min = MAP_MIN_CITY_SITES[atlasAnchor(entry)];
	const siteRisk = min != null && min <= LOW_CITY_SITES_THRESHOLD;
	if (!landRisk && !siteRisk) return "";
	const lowSites = `with ${LOW_CITY_SITES_THRESHOLD} or fewer city sites`;
	const cause =
		landRisk && siteRisk
			? `without a land connection between capitals or ${lowSites}`
			: landRisk
				? "without a land connection between capitals"
				: lowSites;
	return (
		`(this map can sometimes spawn ${cause} -- if that happens, a caster ` +
		"will let you know and you can reroll the map. Or, if both players want " +
		"to play on, you can play on)"
	);
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
