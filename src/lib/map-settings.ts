// Display helpers for map + game settings, built on the baked MAP_OPTION_DEFS
// manifest ($lib/generated/map-option-defs). Shared by the game-detail Settings
// tab, the save cards, and the tournament map-pool UI — the two generic label
// helpers (mapOptionLabel / mapOptionChoiceLabel) are re-exported from
// $lib/tournament/map-script-options so tournament call sites are unchanged.

import { MAP_OPTION_DEFS } from "$lib/generated/map-option-defs";
import { formatEnum } from "$lib/utils/formatting";

// Canonical map-script display name (e.g. MAPCLASS_MapScriptInlandSea2 →
// "Inland Sea"). The curated KNOWN_MAP_SCRIPTS table strips OW source quirks
// like the trailing version digit that formatMapClass can't; re-exported here
// so map_class is labelled the same way everywhere.
export { mapScriptLabel } from "$lib/tournament/map-scripts";

// Human label for an option's group name. Falls back to formatEnum on unknown
// option zTypes (legacy data from a script whose options aren't in the current
// bake).
export function mapOptionLabel(option: string): string {
	const def = MAP_OPTION_DEFS[option];
	if (def) return def.label;
	return formatEnum(option, "MAP_OPTIONS_");
}

// Human label for a select choice value, scoped to a particular option (so
// labels can vary by parent option — e.g. SEASIDE_TRIBES_FOUR is "Four Tribes"
// but HARDWOOD_FOREST_TRIBES_FOREST is "Forest"). Falls back to formatEnum on
// unknowns.
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

// In-game display name for a map size zType (e.g. MAPSIZE_SMALLEST → "Duel").
// The internal enum name (SMALLEST) diverges from the display name (Duel), so
// this resolves through the baked MAPSIZE choices rather than formatEnum.
export function mapSizeLabel(zType: string): string {
	return mapOptionChoiceLabel("MAPSIZE", zType);
}

// In-game display name for a map aspect-ratio zType
// (e.g. MAPASPECTRATIO_ULTRAWIDE → "Ultra-wide").
export function mapAspectRatioLabel(zType: string): string {
	return mapOptionChoiceLabel("MAPASPECTRATIO", zType);
}

// game_mode in a save is the GameModeType enum, which has no zType→name table
// in the reference XML to bake from. Curate the handful of values by hand;
// NETWORK is the standard multiplayer mode and reads "Multiplayer" in-game (not
// the literal "Network" formatEnum would produce).
const GAME_MODE_NAMES: Readonly<Record<string, string>> = {
	SINGLE_PLAYER: "Single Player",
	SINGLE_PLAYER_SIMPLE: "Single Player (Simple)",
	NETWORK: "Multiplayer",
	PLAY_BY_CLOUD: "Play By Cloud",
	HOTSEAT: "Hotseat",
};

export function gameModeLabel(value: string | null | undefined): string {
	if (!value) return "Unknown";
	return GAME_MODE_NAMES[value] ?? formatEnum(value, "");
}

// Non-default map options stored on a game save, as { label, value } pairs in
// save order. Unlike the tournament `nonDefaultOptions` (which walks a script's
// declared option list), this iterates the concrete options the save recorded
// and compares each to its baked default — so it needs no MapClass→script
// matching. Toggles default off, so any present toggle is non-default when true.
// Map size + aspect ratio are surfaced as their own panel rows (and live as root
// attributes in a save), so they're skipped here. Options absent from the
// current bake (legacy/DLC) are skipped.
export function nonDefaultMapOptions(
	options: Record<string, string | boolean> | null | undefined,
): { option: string; label: string; value: string }[] {
	if (!options) return [];
	const out: { option: string; label: string; value: string }[] = [];
	for (const [opt, value] of Object.entries(options)) {
		if (opt === "MAPSIZE" || opt === "MAPASPECTRATIO") continue;
		const def = MAP_OPTION_DEFS[opt];
		if (!def) continue;
		const isDefault =
			def.kind === "toggle" ? value === false : value === def.default;
		if (isDefault) continue;
		out.push({
			option: opt,
			label: mapOptionLabel(opt),
			value: mapOptionChoiceLabel(opt, value),
		});
	}
	return out;
}
