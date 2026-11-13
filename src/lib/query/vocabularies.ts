// Value rosters and display names for the catalog's enum columns.
//
// The Worker's catalog names a vocabulary; this resolves it. The split is
// where the data already is: the Worker has no name table for a tech or a law,
// and the baked rosters it would have to ship are ones this bundle already
// carries ($lib/generated). So the allowlist stays server-side — a value is
// bound either way, and a token that names nothing selects nothing — and only
// the labels live here.
//
// `options: null` means the vocabulary has a name wrapper but no roster worth
// offering: the builder falls back to a typed token for it.
//
// TECH_NAMES is that case, and not for the reason this comment gave before
// (#373): it is a DIVERGENCE table, the shape SETUP_VALUE_NAMES has, not a
// roster. 66 of its 67 keys carry a `_BONUS` token and TECH_BATTLELINE is the
// only researchable tech in it, which is why `techName` falls through to
// formatEnum for TECH_IRONWORKING and every other real tech. No roster of
// researchable techs exists in $lib/generated — baking one over tech.xml is
// what a picker here needs.

import { CULTURE_LEVELS, WONDER_CULTURE_PREREQ } from "$lib/generated/wonders";
import { BASE_NATIONS } from "$lib/generated/civilization-colors";
import { SETUP_VALUE_NAMES } from "$lib/generated/game-setup";
import { LAW_CLASSES } from "$lib/generated/law-classes";
import { LEADER_TRAITS } from "$lib/generated/leader-traits";
import { MAP_OPTION_DEFS } from "$lib/generated/map-option-defs";
import { VICTORY_ORDERING } from "$lib/generated/victory-ordering";
import {
	GAME_MODE_NAMES,
	gameModeLabel,
	mapScriptLabel,
	mapSizeLabel,
	prosperityName,
} from "$lib/map-settings";
import { KNOWN_MAP_SCRIPTS } from "$lib/tournament/map-scripts-table";
import { improvementDisplayName, techName } from "$lib/game-detail/helpers";
import { formatArchetype, formatEnum, nationName } from "$lib/utils/formatting";
import type { ValueType } from "./types";

export interface Vocabulary {
	// The values to offer, or null where there is no roster to offer.
	options: string[] | null;
	label: (value: string) => string;
}

// Sorted by the name they display under, not by zType: a picker is read in the
// order it is shown.
const byLabel = (
	values: readonly string[],
	label: (value: string) => string,
): string[] => [...values].sort((a, b) => label(a).localeCompare(label(b)));

const lawLabel = (value: string): string => formatEnum(value, "LAW_");
const cultureLabel = (value: string): string => formatEnum(value, "CULTURE_");
const victoryLabel = (value: string): string => formatEnum(value, "VICTORY_");

// The map sizes the game declares, in its own ascending order. Narrowed
// because MapOptionDef is a union and only the `select` arm has choices.
const MAPSIZE_DEF = MAP_OPTION_DEFS.MAPSIZE;
const MAP_SIZES =
	MAPSIZE_DEF?.kind === "select" ? MAPSIZE_DEF.choices.map((c) => c.value) : [];

// The Prosperity tiers. SETUP_VALUE_NAMES is a divergence table, so reading a
// roster off it only holds while every tier diverges — which all seven do,
// and not by accident: the game renamed the setting and every tier with it, so
// the enum tokens (ABLE, MAGNIFICENT) and the display names (Affluent, Modest)
// are disjoint word-sets. A tier Mohawk renamed back to its enum would drop
// out of this list silently; baking difficulty.xml is what makes it a roster.
// That bake is also where the tier ORDER would come from — it is not in this
// table, so the picker falls back to alphabetical by display name.
const PROSPERITY_TIERS = Object.keys(SETUP_VALUE_NAMES).filter((k) =>
	k.startsWith("DIFFICULTY_"),
);

const VOCABULARIES: Readonly<Record<string, Vocabulary>> = {
	nation: { options: byLabel(BASE_NATIONS, nationName), label: nationName },
	// A wonder is an improvement flagged `<bWonder>`, which is what the baked
	// culture-prereq table is keyed by.
	wonder: {
		options: byLabel(
			Object.keys(WONDER_CULTURE_PREREQ),
			improvementDisplayName,
		),
		label: improvementDisplayName,
	},
	law: {
		options: byLabel(
			Object.values(LAW_CLASSES).flatMap((c) => c.laws),
			lawLabel,
		),
		label: lawLabel,
	},
	archetype: {
		options: byLabel(LEADER_TRAITS.archetype, formatArchetype),
		label: formatArchetype,
	},
	// Ascending, as the levels themselves are — the roster's own order is the
	// meaningful one here, so it is not re-sorted by name.
	culture_level: { options: [...CULTURE_LEVELS], label: cultureLabel },
	// Only the canonical zType of each script is offered, never an alias. The
	// table keeps a superseded spelling so both READ alike, and offering both
	// would put two "Inland Sea" entries in one picker. Two consequences,
	// measured over the 992 public games with a map script in the 2026-11-10
	// snapshot:
	//
	//   * 14 games are outside the picker — 10 on
	//     MAPCLASS_MapScriptInlandSea (the alias) and 4 on MAPCLASS_RANDOM,
	//     which is the "pick a script" setting rather than a script. Both are
	//     still typable, and both were equally unreachable when this column
	//     took a typed token under one spelling.
	//   * grouping by Map script puts the two Inland Sea spellings in two rows
	//     under one name. They are two tokens in the data; merging them is a
	//     question for the compiler, not for a label.
	map_class: {
		options: byLabel(
			KNOWN_MAP_SCRIPTS.map((s) => s.value),
			mapScriptLabel,
		),
		label: mapScriptLabel,
	},
	// Smallest to largest, as the setup screen lists them.
	map_size: { options: MAP_SIZES, label: mapSizeLabel },
	game_mode: {
		options: byLabel(Object.keys(GAME_MODE_NAMES), gameModeLabel),
		label: gameModeLabel,
	},
	prosperity: {
		options: byLabel(PROSPERITY_TIERS, prosperityName),
		label: prosperityName,
	},
	// Info-list order, which is the order the victory screen lists them in.
	victory_type: { options: [...VICTORY_ORDERING], label: victoryLabel },
	tech: { options: null, label: techName },
};

export function vocabularyFor(name: string | undefined): Vocabulary | null {
	return name === undefined ? null : (VOCABULARIES[name] ?? null);
}

/**
 * The label for one value of a column — the game's own name where the column
 * has a vocabulary, the zType formatted where it is a zType without one, and
 * the value itself where the column is free text.
 *
 * A null is the row a question could not name: a seat with no resolved
 * account, a leader whose archetype the save doesn't record, a game with no
 * recorded mode. Those rows are kept rather than dropped, so they need a label
 * that says what they are.
 */
export function valueLabel(
	value: string | number | null,
	type: ValueType | "number",
	vocabulary: string | undefined,
	nullLabel: string,
): string {
	if (value === null) return nullLabel;
	if (type === "boolean") return value === 1 || value === "1" ? "Yes" : "No";
	if (typeof value === "number") return String(value);
	// `text` and `identity` are the columns whose value is somebody's words —
	// a seat's in-save name, an account's display name. Formatting those would
	// cut a name containing an underscore in half.
	if (type !== "enum") return value;
	const vocab = vocabularyFor(vocabulary);
	if (vocab) return vocab.label(value);
	// A zType with no roster: its prefix is its own first token (FAMILYCLASS_,
	// OPPONENTLEVEL_, …), so strip up to the first underscore rather than
	// keeping a list of prefixes in step with the catalog. Every column this
	// still reaches spells its prefix that way; the ones that did not —
	// game_mode's bare NETWORK, SINGLE_PLAYER's two-word prefix — are the ones
	// that now have a vocabulary above.
	const underscore = value.indexOf("_");
	return underscore === -1
		? value
		: formatEnum(value, value.slice(0, underscore + 1));
}
