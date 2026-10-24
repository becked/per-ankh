// The VOCABULARY of a game's SETUP — the name Old World displays for a map
// option, a map size, a game mode and every setup value whose display name
// diverges from its zType — built on the baked MAP_OPTION_DEFS and game-setup
// manifests ($lib/generated/). Shared by the game-detail Settings tab, the
// save cards, the challenge map summaries and the tournament map-pool UI; the
// two generic map-option label helpers (mapOptionLabel / mapOptionChoiceLabel)
// are re-exported from $lib/tournament/map-script-options so tournament call
// sites are unchanged.
//
// The Settings tab's row model — `gameSetupSections` and the Difficulty preset
// behind it — is $lib/game-detail/setup-sections, which reaches every
// game-setup export where this module reaches one. Keeping the two apart is
// what keeps the whole setup vocabulary out of the eager chunk the home page's
// save cards load.

import { SETUP_VALUE_NAMES } from "$lib/generated/game-setup";
import { MAP_OPTION_DEFS } from "$lib/generated/map-option-defs";
import { mapScriptLabel } from "$lib/tournament/map-scripts";
import { formatEnum } from "$lib/utils/formatting";

// Canonical map-script display name (e.g. MAPCLASS_MapScriptInlandSea2 →
// "Inland Sea"). The curated KNOWN_MAP_SCRIPTS table strips OW source quirks
// like the trailing version digit that formatMapClass can't; re-exported here
// so map_class is labelled the same way everywhere, including the Settings
// tab's Map Script row ($lib/game-detail/setup-sections).
export { mapScriptLabel };

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
// the literal "Network" formatEnum would produce). All 7 of GameModeType's
// values (Enums.cs:1100) less NONE are here, so nothing falls through to
// formatEnum: LAN and SERVER read as the multiplayer wizard's own mode buttons
// name them (TEXT_MP_WIZARD_SCREEN_LAN_MODE_BUTTON "LAN",
// TEXT_MP_WIZARD_SCREEN_SERVER_MODE_BUTTON "Server Mode"), where formatEnum
// produced "Lan" and "Server".
const GAME_MODE_NAMES: Readonly<Record<string, string>> = {
	SINGLE_PLAYER: "Single Player",
	SINGLE_PLAYER_SIMPLE: "Single Player (Simple)",
	NETWORK: "Multiplayer",
	LAN: "LAN",
	PLAY_BY_CLOUD: "Play By Cloud",
	HOTSEAT: "Hotseat",
	SERVER: "Server Mode",
};

export function gameModeLabel(value: string | null | undefined): string {
	if (!value) return "Unknown";
	return GAME_MODE_NAMES[value] ?? formatEnum(value, "");
}

// ─── Setup values ─────────────────────────────────────────────────────────

/**
 * The name Old World displays for a setup value, from its zType.
 *
 * The baked table first, then `formatEnum` — the standing shape, because the
 * table holds only the values whose display name DIVERGES from the enum. Six
 * of the thirteen setup lists diverge wholesale (`ADVANTAGE_PENALTY_HIGH` is
 * "High Penalty", `OCCURRENCELEVEL_CALAMITIES_LOW` is "Rare"), and
 * `VICTORYPOINT_HIGH` is "Very High", so `formatEnum` alone is off by a tier
 * there rather than merely ugly.
 */
export function setupValueName(
	zType: string | null | undefined,
	prefix: string,
): string {
	return (
		(zType ? SETUP_VALUE_NAMES[zType] : undefined) ?? formatEnum(zType, prefix)
	);
}

/**
 * The name Old World gives a PROSPERITY tier, from its `DIFFICULTY_*` token —
 * the label to use everywhere that setting is shown.
 *
 * The token is an internal id and the setting was renamed around it, twice
 * over: the game calls the setting Prosperity (`TEXT_SP_SETUP_ADVANCED_
 * DIFFICULTY`) and every one of the seven tiers displays as a word the enum
 * does not contain — `DIFFICULTY_MAGNIFICENT` is "Modest",
 * `DIFFICULTY_GREAT` is "Fragile". Not to be confused with the headline
 * Difficulty, which is `difficultyPreset` ($lib/game-detail/setup-sections).
 */
export function prosperityName(zType: string | null | undefined): string {
	return setupValueName(zType, "DIFFICULTY_");
}
