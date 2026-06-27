// Canonical Old World map_script identifiers with friendly display labels.
// Source: Mohawk's Reference/XML.
//
// Several identifiers carry quirks from the game source that are preserved
// verbatim — saves and tournament rows will contain these exact strings, so
// the lookup must match byte-for-byte:
//   - MapScriptInlandSea2:        trailing digit
//   - MapScripLakesAndGulfs:      missing trailing 't' in "MapScript"
//   - MapScriptMediterrancean:    misspelling in source
//   - Mapscript<X> (Indus DLC):   lowercase 's' in "Mapscript"
//
// Update this list when a new DLC ships or Mohawk renames an entry.

import { formatMapClass } from "$lib/utils/formatting";

export type MapScriptDlc = "base" | "wrath_of_gods" | "empires_of_the_indus";

export interface MapScriptInfo {
	value: string;
	label: string;
	// Short form for the compact map-pool label (e.g. "CRB", "AridP", "DOTA").
	// Kept terse but recognizable so a pool reads at a glance; the full `label`
	// is still shown in tooltips and the read-only summary.
	abbrev: string;
	dlc: MapScriptDlc;
}

export const DLC_GROUP_LABELS: Record<MapScriptDlc, string> = {
	base: "Base game",
	wrath_of_gods: "Wrath of Gods",
	empires_of_the_indus: "Empires of the Indus",
};

export const KNOWN_MAP_SCRIPTS: MapScriptInfo[] = [
	{
		value: "MAPCLASS_MapScriptArchipelago",
		label: "Archipelago",
		abbrev: "Arch",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptAridPlateau",
		label: "Arid Plateau",
		abbrev: "AridP",
		dlc: "base",
	},
	{ value: "MAPCLASS_MapScriptBay", label: "Bay", abbrev: "Bay", dlc: "base" },
	{
		value: "MAPCLASS_MapScriptCoastalRainBasin",
		label: "Coastal Rain Basin",
		abbrev: "CRB",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptContinent",
		label: "Continent",
		abbrev: "Cont",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptDesert",
		label: "Desert",
		abbrev: "Desert",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptDisjunction",
		label: "Disjunction",
		abbrev: "Disj",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptDonut",
		label: "Donut",
		abbrev: "Donut",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptHardwoodForest",
		label: "Hardwood Forest",
		abbrev: "Hardwood",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptHighlands",
		label: "Highlands",
		abbrev: "Highlands",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptInlandSea2",
		label: "Inland Sea",
		abbrev: "InlSea",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScripLakesAndGulfs",
		label: "Lakes and Gulfs",
		abbrev: "L&G",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptMediterrancean",
		label: "Mediterranean",
		abbrev: "Med",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptContinents",
		label: "Multiple Continents",
		abbrev: "MultiC",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptNorthernOcean",
		label: "Northern Ocean",
		abbrev: "NOcean",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptPlayerIslands",
		label: "Player Islands",
		abbrev: "Islands",
		dlc: "base",
	},
	{
		value: "MAPCLASS_MapScriptSeaside",
		label: "Seaside",
		abbrev: "Seaside",
		dlc: "base",
	},

	{
		value: "MAPCLASS_MapScriptDesolation",
		label: "Desolation",
		abbrev: "Desol",
		dlc: "wrath_of_gods",
	},
	{
		value: "MAPCLASS_MapScriptEbbingSea",
		label: "Ebbing Sea",
		abbrev: "Ebbing",
		dlc: "wrath_of_gods",
	},
	{
		value: "MAPCLASS_MapScriptRejuvenation",
		label: "Rejuvenation",
		abbrev: "Rejuv",
		dlc: "wrath_of_gods",
	},
	{
		value: "MAPCLASS_MapScriptTumblingMountain",
		label: "Tumbling Mountain",
		abbrev: "Tumbling",
		dlc: "wrath_of_gods",
	},

	{
		value: "MAPCLASS_MapscriptJungle",
		label: "Deep Jungle",
		abbrev: "Jungle",
		dlc: "empires_of_the_indus",
	},
	{
		value: "MAPCLASS_MapScriptDota",
		label: "Duel of the Ancients",
		abbrev: "DOTA",
		dlc: "empires_of_the_indus",
	},
	{
		value: "MAPCLASS_MapscriptMountainPass",
		label: "Mountain Pass",
		abbrev: "MtnPass",
		dlc: "empires_of_the_indus",
	},
	{
		value: "MAPCLASS_MapscriptWetlands",
		label: "Wetlands",
		abbrev: "Wetlands",
		dlc: "empires_of_the_indus",
	},
];

const labelByValue: Record<string, string> = Object.fromEntries(
	KNOWN_MAP_SCRIPTS.map((s) => [s.value, s.label]),
);

const abbrevByValue: Record<string, string> = Object.fromEntries(
	KNOWN_MAP_SCRIPTS.map((s) => [s.value, s.abbrev]),
);

// Friendly display name for any map_script. Falls back to the generic
// PascalCase-split formatter for unknown values (legacy data, future DLCs
// not yet added to this table).
export function mapScriptLabel(value: string | null | undefined): string {
	if (!value) return "Unknown";
	return labelByValue[value] ?? formatMapClass(value);
}

// Short form of a map_script name for compact pool labels (e.g. "CRB").
// Falls back to the full friendly label for unknown values, so a future
// DLC script still renders something sensible until it's added above.
export function mapScriptAbbrev(value: string | null | undefined): string {
	if (!value) return "Unknown";
	return abbrevByValue[value] ?? mapScriptLabel(value);
}

// Returns map scripts grouped by DLC, with already-allowed values excluded.
// Used to populate the "Add map" dropdown so admins can only pick maps not
// already in the tournament's list.
export function unaddedMapScriptsByDlc(
	allowed: readonly string[],
): { dlc: MapScriptDlc; entries: MapScriptInfo[] }[] {
	const allowedSet = new Set(allowed);
	const groups: { dlc: MapScriptDlc; entries: MapScriptInfo[] }[] = [
		{ dlc: "base", entries: [] },
		{ dlc: "wrath_of_gods", entries: [] },
		{ dlc: "empires_of_the_indus", entries: [] },
	];
	for (const s of KNOWN_MAP_SCRIPTS) {
		if (allowedSet.has(s.value)) continue;
		const group = groups.find((g) => g.dlc === s.dlc);
		if (group) group.entries.push(s);
	}
	return groups.filter((g) => g.entries.length > 0);
}

// All known map scripts grouped by DLC. Used by the maps panel's "Add a map"
// picker — with the map_pool model the same script can be added multiple times
// (with different options), so the picker never excludes already-added scripts.
export function allMapScriptsByDlc(): {
	dlc: MapScriptDlc;
	entries: MapScriptInfo[];
}[] {
	return unaddedMapScriptsByDlc([]);
}
