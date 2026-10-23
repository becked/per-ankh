// Display helpers for a game's SETUP — the map settings, the game options and
// the rest of what the player chose before turn 1 — built on the baked
// MAP_OPTION_DEFS and game-setup manifests ($lib/generated/). Shared by the
// game-detail Settings tab, the save cards, the challenge map summaries and the
// tournament map-pool UI; the two generic map-option label helpers
// (mapOptionLabel / mapOptionChoiceLabel) are re-exported from
// $lib/tournament/map-script-options so tournament call sites are unchanged.
//
// `gameSetupSections` at the bottom is the Settings tab's whole row model: it
// turns a GameDetails into the seven sections Old World's own setup screens
// declare, each with its rows already labelled and formatted.

import {
	DIFFICULTY_MODES,
	GAME_OPTIONS,
	OCCURRENCE_CLASSES,
	SETUP_PARAMETERS,
	SETUP_SECTIONS,
	SETUP_VALUE_NAMES,
	VICTORY_POINT_VICTORIES,
	VICTORY_TOGGLES,
} from "$lib/generated/game-setup";
import { MAP_OPTION_DEFS } from "$lib/generated/map-option-defs";
import { mapScriptLabel } from "$lib/tournament/map-scripts";
import type { GameDetails } from "$lib/types/GameDetails";
import { formatEnum } from "$lib/utils/formatting";

// Canonical map-script display name (e.g. MAPCLASS_MapScriptInlandSea2 →
// "Inland Sea"). The curated KNOWN_MAP_SCRIPTS table strips OW source quirks
// like the trailing version digit that formatMapClass can't; re-exported here
// so map_class is labelled the same way everywhere, and used below by the Map
// Script row.
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

// In-game display name for a game-option zType. About half the options carry a
// setup-screen label that diverges from their internal enum — sometimes naming a
// different thing entirely (GAMEOPTION_NO_BONUS_IMPROVEMENTS is "No Ancient
// Ruins") — so this resolves through the baked GAME_OPTIONS table and only falls
// back to formatEnum for an option from game content newer than the bake.
function gameOptionLabel(zType: string): string {
	return GAME_OPTIONS[zType]?.label ?? formatEnum(zType, "GAMEOPTION_");
}

// The game-wide option flags a save recorded, as { option, label } pairs in save
// order (which is gameOption.xml info-list order, so options stay grouped by
// setup-screen category). A save writes only the options that are ON, so the map
// is already the "non-default" set — unlike map options there's no default to
// compare against. Unknown zTypes (a newer DLC than the current bake) are kept
// and labelled by formatEnum rather than skipped: the flag is set either way, and
// dropping it would silently understate the game's rules.
function setGameOptions(
	options: Record<string, true> | null | undefined,
): { option: string; label: string; help: string }[] {
	if (!options) return [];
	return Object.keys(options).map((opt) => ({
		option: opt,
		label: gameOptionLabel(opt),
		// Every one of gameOption.xml's 36 entries carries a <zHelp>, so the only
		// empty string here is an option newer than the bake.
		help: GAME_OPTIONS[opt]?.help ?? "",
	}));
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
 * Difficulty, which is {@link difficultyPreset}.
 */
export function prosperityName(zType: string | null | undefined): string {
	return setupValueName(zType, "DIFFICULTY_");
}

/**
 * The map options a save recorded, shown the way the game shows them
 * (`buildMapOptions`, HelpText.Game.cs:3371): EVERY multi option, default or
 * not, and a single toggle only when it is on.
 *
 * The sibling of the tournament pool's `nonDefaultOptions`
 * ($lib/tournament/map-script-options), which answers a different question —
 * what an organiser deliberately changed. The two differ on the multi options:
 * a map's resource density is part of what the game was, so the setup panel
 * names it even at the default, where a pool summary would be noise. (A third
 * helper, `nonDefaultMapOptions`, asked the pool's question of a save and was
 * this panel's only caller; filtering to non-defaults is why the game-menu
 * hover had seven map rows where this tab had one.)
 *
 * Map size + aspect ratio are rows of their own (and root attributes in a
 * save), so they're skipped here. An option absent from the current bake keeps
 * its slot and labels through `formatEnum` — the save says it was set, and
 * dropping it would understate the map.
 */
export function gameMapOptions(
	options: Record<string, string | boolean> | null | undefined,
): { option: string; label: string; value: string }[] {
	if (!options) return [];
	const out: { option: string; label: string; value: string }[] = [];
	for (const [opt, value] of Object.entries(options)) {
		if (opt === "MAPSIZE" || opt === "MAPASPECTRATIO") continue;
		if (value === false) continue;
		out.push({
			option: opt,
			label: mapOptionLabel(opt),
			value: mapOptionChoiceLabel(opt, value),
		});
	}
	return out;
}

// ─── The Difficulty preset ────────────────────────────────────────────────

// TEXT_UI_OPTIONS_CUSTOM — the word the game puts in the Difficulty row when
// the settings match no preset. One string, so it is spelled here rather than
// baked.
const CUSTOM_PRESET = "Custom";

/**
 * The named difficulty preset a game's settings add up to, or "Custom".
 *
 * A reverse lookup, exactly as `GameParameters.GetDifficultyMode`
 * (GameParameters.cs:1907) does it: the first `difficultyMode.xml` row whose
 * Prosperity, AI handicap, AI development, AI aggression, tribal strength AND
 * calamity levels all match. Derived at render rather than persisted, because
 * it is a function of data the blob already carries and would go stale the
 * next time difficultyMode.xml is re-baked.
 *
 * Three outcomes, and they are different claims. A preset name is a game set
 * up from one. "Custom" (`TEXT_UI_OPTIONS_CUSTOM`) is a game whose settings
 * match no preset, which is the normal answer — 14 of the 16 saves in
 * `test-data/saves/` resolve to it. `null` is a game we cannot ask about,
 * because the preset is the SAVE OWNER's (their Prosperity is one of the six
 * components) and an observer upload of a multi-human game identifies no save
 * owner.
 *
 * The occurrence comparison walks the classes rather than the keys present,
 * because an absent class means NONE on either side — the game's own
 * `equalOccurrences`.
 */
export function difficultyPreset(
	details: Pick<
		GameDetails,
		"difficulty" | "setup_parameters" | "occurrence_levels"
	>,
): string | null {
	const prosperity = details.difficulty;
	const params = details.setup_parameters;
	if (prosperity == null || params == null) return null;
	const levels = details.occurrence_levels ?? {};
	const hit = DIFFICULTY_MODES.find(
		(mode) =>
			mode.difficulty === prosperity &&
			mode.advantage === (params.Advantage ?? "") &&
			mode.development === (params.Development ?? "") &&
			mode.opponentLevel === (params.OpponentLevel ?? "") &&
			mode.tribeLevel === (params.TribeLevel ?? "") &&
			OCCURRENCE_CLASSES.every(
				(cls) => (mode.occurrenceLevels[cls] ?? "") === (levels[cls] ?? ""),
			),
	);
	return hit?.label ?? CUSTOM_PRESET;
}

// ─── The Settings tab's row model ─────────────────────────────────────────

/**
 * One row of a setup section. Two shapes, because the game's own setup screens
 * have two: a parameter is a label and the value chosen for it, where a game
 * option is a switch that is simply on and whose interesting half is the
 * sentence explaining what it does.
 */
export type SetupRow =
	| {
			readonly kind: "parameter";
			/** Unique within its section; the `{#each}` key. */
			readonly key: string;
			readonly label: string;
			readonly value: string;
			/** True for the six components the Difficulty preset expands into. */
			readonly indent?: boolean;
	  }
	| {
			readonly kind: "option";
			readonly key: string;
			readonly label: string;
			/** The option's own help text; "" only for one newer than the bake. */
			readonly help: string;
	  };

/**
 * One of Old World's seven setup screens, with the rows this save can fill.
 * Named apart from the baked `SetupSection`, which is the heading alone.
 */
export interface SetupSectionRows {
	readonly key: string;
	readonly label: string;
	readonly rows: readonly SetupRow[];
}

// The modes the game draws a Turn Style row for (HelpText.Game.cs:3706), and
// the narrower set it draws a Turn Timer for (:3714) — a cloud game has no
// clock. Simultaneous Turns rides with Turn Style: the game draws no row for
// it at all, and it is a property of the turn style.
const TURN_STYLE_MODES = new Set(["NETWORK", "LAN", "SERVER", "PLAY_BY_CLOUD"]);
const TURN_TIMER_MODES = new Set(["NETWORK", "LAN", "SERVER"]);

// Parameters the game shows only when the game has AI players
// (`iNumAIPlayers > 0`, HelpText.Game.cs:3607).
const AI_PARAMETERS = new Set(["OpponentLevel", "Development", "Advantage"]);

// The option that suppresses the whole Characters and Events section — the
// gate that says those five parameters are one group
// (HelpText.Game.cs:3655-3679).
const NO_CHARACTERS_OPTION = "GAMEOPTION_NO_CHARACTERS";

/**
 * A game's setup as the seven sections Old World's own setup screens declare,
 * each with the rows the save can fill.
 *
 * Sections and rows come from the baked `SETUP_SECTIONS` / `SETUP_PARAMETERS`
 * tables, so their wording and order are the game's. What is hand-ported here
 * is the handful of visibility rules the XML cannot express, each cited where
 * it is applied: the AI-player gate, the no-characters gate, the
 * single-player-only Difficulty row, the multiplayer-only turn rows, the
 * points-victory gate and the one Human Development row the game never draws.
 *
 * A section with no rows is dropped, which is what hides a section the blob
 * cannot fill: `setup_parameters` is null on a blob below PARSER_VERSION
 * 2.28.0, so such a game keeps the handful of rows its own fields still answer
 * until it is reparsed — the same shape `map_options` had on pre-2.7.0 blobs.
 */
export function gameSetupSections(details: GameDetails): SetupSectionRows[] {
	const params = details.setup_parameters;
	const hasAi = details.players.some((p) => !p.is_human);
	// `Game.isMultiplayer()` is `iNumHumans > 1` (Game.cs:11957) — the human
	// count, not the game mode, so a hotseat game with one human is
	// single-player to the game and gets a Difficulty row like any other.
	const isMultiplayer = details.players.filter((p) => p.is_human).length > 1;
	// `IsGameOption` decides this in the game; a blob with no game_options at
	// all cannot say, and an unknown gate is not a reason to hide five rows.
	const noCharacters = details.game_options?.[NO_CHARACTERS_OPTION] === true;
	const enabledVictories = new Set(details.victory_conditions?.split("+"));
	const pointsVictory = VICTORY_POINT_VICTORIES.some((v) =>
		enabledVictories.has(v),
	);

	// Three of the map rows are dedicated GameDetails fields rather than bag
	// entries — they were parsed long before the bag existed and a second way
	// to read them is what the bag exists to prevent — so they join the lookup
	// here instead of in the parser.
	const value = (key: string): string | null => {
		switch (key) {
			case "MapClass":
				return details.map_class;
			case "MapSize":
				return details.map_size;
			case "MapAspectRatio":
				return details.map_aspect_ratio;
			default:
				return params?.[key] ?? null;
		}
	};

	const rowsBySection = new Map<string, SetupRow[]>();
	const add = (section: string, row: SetupRow): void => {
		const rows = rowsBySection.get(section);
		if (rows) rows.push(row);
		else rowsBySection.set(section, [row]);
	};

	// The Difficulty preset leads Opponent Setup, and the six knobs it expands
	// into sit indented under it, as the game indents them
	// (HelpText.Game.cs:3606). Single-player only, like the game's own row —
	// and the indent is gated on the row rendering, the way the game's own
	// `bIndentDifficulty` is, so the knobs are not indented under nothing.
	const preset = isMultiplayer ? null : difficultyPreset(details);
	if (preset != null) {
		add("OPPONENTS", {
			kind: "parameter",
			key: "DifficultyMode",
			label: "Difficulty",
			value: preset,
		});
	}

	// Victory conditions: every toggleable type with the word the game uses for
	// it. Conquest has no <bToggle> and so no row, as in the game. Ahead of the
	// parameter loop because Points to Win is the threshold those types are
	// measured against, and reads under them.
	for (const victory of VICTORY_TOGGLES) {
		add("VICTORY", {
			kind: "parameter",
			key: victory,
			label: formatEnum(victory, "VICTORY_"),
			value: enabledVictories.has(victory) ? "Enabled" : "Disabled",
		});
	}

	for (const p of SETUP_PARAMETERS) {
		if (AI_PARAMETERS.has(p.key) && !hasAi) continue;
		if (noCharacters && p.section === "CHARACTERS") continue;
		if (p.key === "VictoryPointModifier" && !pointsVictory) continue;
		if (
			(p.key === "TurnStyle" || p.key === "SimultaneousTurns") &&
			!TURN_STYLE_MODES.has(details.game_mode ?? "")
		) {
			continue;
		}
		if (
			p.key === "TurnTimer" &&
			!TURN_TIMER_MODES.has(details.game_mode ?? "")
		) {
			continue;
		}
		const raw = value(p.key);
		if (raw == null) continue;
		// The game never draws a Human Development row —
		// `ALLOW_HUMAN_DEVELOPMENT_OPTIONS` is 0 (globalsInt.xml:1229) — and all
		// 13 corpus saves that carry the attribute set it to NONE. Keep it
		// hidden unless a save says something else, so the row appears only when
		// it would mean something.
		if (p.key === "HumanDevelopment" && raw === "DEVELOPMENT_NONE") continue;
		add(p.section, {
			kind: "parameter",
			key: p.key,
			label: p.label,
			value: setupValue(p.key, p.prefix, raw, details),
			indent:
				preset != null && (AI_PARAMETERS.has(p.key) || p.key === "TribeLevel"),
		});
	}

	// Calamities: one row per occurrence class, beside the AI knobs because
	// `GetDifficultyMode` counts them as part of the same preset bundle. The
	// game also hides a class whose DLC is off; the blob records no content
	// ownership, so a class the save wrote is a class the game had.
	for (const [cls, level] of Object.entries(details.occurrence_levels ?? {})) {
		add("OPPONENTS", {
			kind: "parameter",
			key: cls,
			label: setupValueName(cls, "OCCURRENCECLASS_"),
			value: setupValueName(level, "OCCURRENCELEVEL_"),
			indent: preset != null,
		});
	}

	// The script's own map options, by the game's rule rather than the
	// tournament pool's — see gameMapOptions.
	for (const opt of gameMapOptions(details.map_options)) {
		add("MAP", {
			kind: "parameter",
			key: opt.option,
			label: opt.label,
			value: opt.value,
		});
	}

	// Game options land in the section their <Category> names, which is the
	// setup screen each one appears on.
	for (const opt of setGameOptions(details.game_options)) {
		// An option from content newer than the bake has no category to place it
		// by; Game Rules is where 21 of the 36 sit, so it is the safe home.
		add(GAME_OPTIONS[opt.option]?.section ?? "RULES", {
			kind: "option",
			key: opt.option,
			label: opt.label,
			help: opt.help,
		});
	}

	if (details.enabled_dlc) {
		add("DLC_MOD", {
			kind: "parameter",
			key: "DLC",
			label: "DLC Enabled",
			value: details.enabled_dlc
				.split("+")
				.map((dlc) => formatEnum(dlc, "DLC_"))
				.join(", "),
		});
	}
	if (details.enabled_mods) {
		add("DLC_MOD", {
			kind: "parameter",
			key: "Mods",
			label: "Active Mods",
			value: details.enabled_mods.split("+").join(", "),
		});
	}

	return SETUP_SECTIONS.map((section) => ({
		key: section.key,
		label: section.label,
		rows: rowsBySection.get(section.key) ?? [],
	})).filter((section) => section.rows.length > 0);
}

// One parameter's value, formatted. Most go through the baked value names;
// the four the baked table marks `prefix: null` are the ones with a label
// helper of their own or no info-list at all.
function setupValue(
	key: string,
	prefix: string | null,
	raw: string,
	details: GameDetails,
): string {
	if (prefix != null) return setupValueName(raw, prefix);
	switch (key) {
		case "MapClass":
			return mapScriptLabel(raw);
		case "MapSize":
			// The dimensions beside the size, since "Small" alone says less than
			// the game's own grid does.
			return details.map_width != null && details.map_height != null
				? `${mapSizeLabel(raw)} (${details.map_width} × ${details.map_height})`
				: mapSizeLabel(raw);
		case "MapAspectRatio":
			return mapAspectRatioLabel(raw);
		default:
			// SimultaneousTurns, the one parameter whose value is a number.
			return raw;
	}
}
