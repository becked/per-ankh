// Display helpers over the Old World map-script table: friendly labels, the
// compact pool abbreviations, and the DLC grouping the "Add map" pickers use.
//
// The table itself — every script's zType, and the key it takes in the baked
// options manifest — is map-scripts-table.ts, which imports nothing so the
// Worker package's tests can read it. Everything here needs formatMapClass,
// which is why the two are separate files.

import { formatMapClass } from "../utils/formatting";
import {
	KNOWN_MAP_SCRIPTS,
	type MapScriptDlc,
	type MapScriptInfo,
} from "./map-scripts-table";

export const DLC_GROUP_LABELS: Record<MapScriptDlc, string> = {
	base: "Base game",
	wrath_of_gods: "Wrath of Gods",
	empires_of_the_indus: "Empires of the Indus",
};

// Every spelling a script answers to — its zType and any superseded ones —
// mapped to the one entry that describes it. Aliases are folded in here rather
// than at each call site so a legacy token labels itself correctly wherever it
// surfaces, instead of relying on formatMapClass landing on the right words by
// coincidence of the prefix strip.
const infoBySpelling: Record<string, MapScriptInfo> = Object.fromEntries(
	KNOWN_MAP_SCRIPTS.flatMap((s) => [
		[s.value, s] as const,
		...(s.aliases ?? []).map((a) => [a, s] as const),
	]),
);

// Friendly display name for any map_script. Falls back to the generic
// PascalCase-split formatter for unknown values (future DLCs not yet in
// map-scripts-table, and the zType of a new script we guessed wrong).
export function mapScriptLabel(value: string | null | undefined): string {
	if (!value) return "Unknown";
	return infoBySpelling[value]?.label ?? formatMapClass(value);
}

// Short form of a map_script name for compact pool labels (e.g. "CRB").
// Falls back to the full friendly label for unknown values, so a future
// DLC script still renders something sensible until it reaches the table.
export function mapScriptAbbrev(value: string | null | undefined): string {
	if (!value) return "Unknown";
	return infoBySpelling[value]?.abbrev ?? mapScriptLabel(value);
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
