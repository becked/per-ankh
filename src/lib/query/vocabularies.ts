// Value rosters and display names for the catalog's enum columns.
//
// The Worker's catalog names a vocabulary; this resolves it. The split is
// where the data already is: the Worker has no name table for a tech or a law,
// and the baked rosters it would have to ship are ones this bundle already
// carries ($lib/generated). So the allowlist stays server-side — a value is
// bound either way, and a token that names nothing selects nothing — and only
// the labels live here.
//
// Two sources, because that is where the data already is. A zType roster is
// baked into this bundle and resolved here. A tournament's name is in D1 and
// nowhere in $lib/generated, so the Worker serves that roster with the catalog
// (`rosters`, cloud/src/query/catalog.ts) and `vocabularyFor` reads it from
// there — the same rule, applied the other way round.
//
// `options: null` means the vocabulary has a name wrapper but no roster worth
// offering: the builder falls back to a typed token for it. Nothing is in that
// state today.

import { CULTURE_LEVELS, WONDER_CULTURE_PREREQ } from "$lib/generated/wonders";
import { BASE_NATIONS } from "$lib/generated/civilization-colors";
import { FAMILY_CLASSES } from "$lib/generated/family-classes";
import { SETUP_VALUE_ORDER } from "$lib/generated/setup-value-order";
import { LAW_CLASSES } from "$lib/generated/law-classes";
import { LEADER_TRAITS } from "$lib/generated/leader-traits";
import { MAP_OPTION_DEFS } from "$lib/generated/map-option-defs";
import { TREE_TECHS } from "$lib/generated/tech-tree";
import { VICTORY_ORDERING } from "$lib/generated/victory-ordering";
import {
	GAME_MODE_NAMES,
	gameModeLabel,
	mapScriptLabel,
	mapSizeLabel,
	prosperityName,
	setupValueName,
} from "$lib/map-settings";
import { KNOWN_MAP_SCRIPTS } from "$lib/tournament/map-scripts-table";
import { improvementDisplayName, techName } from "$lib/game-detail/helpers";
import { formatArchetype, formatEnum, nationName } from "$lib/utils/formatting";
import type { CatalogRosterOption, ValueType } from "./types";

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
const familyClassLabel = (value: string): string =>
	formatEnum(value, "FAMILYCLASS_");
// The setup screen's own name for an AI Aggression tier, which matches
// formatEnum for all five — opponentLevel.xml names each one TEXT_<zType> and
// the text is the word in the zType ("Peaceful", "Competitive"). Routed
// through `setupValueName` anyway, so a tier the game renames is relabelled by
// a re-bake rather than by an edit here.
const opponentLevelLabel = (value: string): string =>
	setupValueName(value, "OPPONENTLEVEL_");

// The map sizes the game declares, in its own ascending order. Narrowed
// because MapOptionDef is a union and only the `select` arm has choices.
const MAPSIZE_DEF = MAP_OPTION_DEFS.MAPSIZE;
const MAP_SIZES =
	MAPSIZE_DEF?.kind === "select" ? MAPSIZE_DEF.choices.map((c) => c.value) : [];

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
	// Affluent to Fragile, as the setup screen lists them — descending
	// prosperity, which is ascending difficulty. The roster's own order is the
	// meaningful one for a scale, so it is not re-sorted by name.
	prosperity: {
		options: [...(SETUP_VALUE_ORDER["DIFFICULTY_"] ?? [])],
		label: prosperityName,
	},
	// Info-list order, which is the order the victory screen lists them in.
	victory_type: { options: [...VICTORY_ORDERING], label: victoryLabel },
	// The techs on the tech tree. `tech_events` also records the bonus and
	// upgrade cards a tech hands out — 71 of the 121 distinct values and
	// 10,727 of the 78,733 rows in the 2026-11-10 snapshot — and those are not
	// offered: they are not a research choice, and the game keeps them off the
	// tree itself (`isTechShown`, Game.cs:8274). They stay typable, the way an
	// aliased map script does. One tree tech is out of the picker for the
	// mirror-image reason the aliases are: TECH_CARTHAGINIAN_TRAINING is in the
	// corpus and not in the build this table was baked from.
	tech: { options: byLabel(TREE_TECHS, techName), label: techName },
	family_class: {
		options: byLabel(FAMILY_CLASSES, familyClassLabel),
		label: familyClassLabel,
	},
	// Passive to Competitive, as the setup screen lists them — the roster's own
	// order is the meaningful one for a scale, so it is not re-sorted by name.
	opponent_level: {
		options: [...(SETUP_VALUE_ORDER["OPPONENTLEVEL_"] ?? [])],
		label: opponentLevelLabel,
	},
};

/** The rosters the Worker served with the catalog, as `QueryCatalog.rosters`. */
export type ServedRosters = Readonly<
	Record<string, readonly CatalogRosterOption[]>
>;

/**
 * The vocabulary a column names, from whichever side holds its values.
 *
 * The baked table wins where there is one, so a `vocabulary` the Worker starts
 * serving a roster for does not silently change which labels a zType column
 * reads under. `served` is only consulted for a name no baked table has.
 */
export function vocabularyFor(
	name: string | undefined,
	served: ServedRosters = {},
): Vocabulary | null {
	if (name === undefined) return null;
	const baked = VOCABULARIES[name];
	if (baked) return baked;
	const roster = served[name];
	if (!roster) return null;
	// Order is the Worker's — TOURNAMENT_ROSTER_SQL hands them over newest
	// first, which is the order a tournament picker is read in.
	const labels = new Map(roster.map((o) => [o.value, o.label]));
	return {
		options: roster.map((o) => o.value),
		// A value the roster no longer carries is still the value a shared link
		// asked about, so it labels itself rather than disappearing from the
		// chip that holds it.
		label: (value) => labels.get(value) ?? value,
	};
}

/**
 * The label for one value of a column — the game's own name where the column
 * has a vocabulary, the zType formatted where it is a zType without one, and
 * the value itself where the column is free text.
 *
 * A null is the row a question could not name: a leader whose archetype the
 * save doesn't record, a game with no recorded mode. Those rows are kept
 * rather than dropped, so they need a label that says what they are.
 *
 * An identity dimension has no such row — the Worker drops the seats that
 * resolve to no account (PLAYER_USER_ID_SQL, cloud/src/query/catalog.ts) — so
 * `nullLabel` is only ever reached for a value column.
 */
export function valueLabel(
	value: string | number | null,
	type: ValueType | "number",
	vocabulary: string | undefined,
	nullLabel: string,
	served: ServedRosters = {},
): string {
	if (value === null) return nullLabel;
	if (type === "boolean") return value === 1 || value === "1" ? "Yes" : "No";
	if (typeof value === "number") return String(value);
	// `text` and `identity` are the columns whose value is somebody's words —
	// a seat's in-save name, an account's display name. Formatting those would
	// cut a name containing an underscore in half.
	if (type !== "enum") return value;
	const vocab = vocabularyFor(vocabulary, served);
	if (vocab) return vocab.label(value);
	// A zType with no roster: its prefix is its own first token
	// (OCCURRENCELEVEL_, …), so strip up to the first underscore rather than
	// keeping a list of prefixes in step with the catalog. Every column this
	// still reaches spells its prefix that way; the ones that did not —
	// game_mode's bare NETWORK, SINGLE_PLAYER's two-word prefix — are the ones
	// that now have a vocabulary above. It also still catches a value a roster
	// is missing, which is why it is not an exhaustiveness check.
	const underscore = value.indexOf("_");
	return underscore === -1
		? value
		: formatEnum(value, value.slice(0, underscore + 1));
}
