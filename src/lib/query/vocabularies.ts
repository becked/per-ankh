// Value rosters, display names and icons for the catalog's enum columns.
//
// The Worker's catalog names a vocabulary; this resolves it. The split is
// where the data already is: the Worker has no name table for a tech or a law,
// and the baked rosters it would have to ship are ones this bundle already
// carries ($lib/generated). So the allowlist stays server-side — a value is
// bound either way, and a token that names nothing selects nothing — and the
// names and the pictures live here.
//
// Two sources, because that is where the data already is. A zType roster is
// baked into this bundle and resolved here. A tournament's name is in D1 and
// nowhere in $lib/generated, so the Worker serves that roster with the catalog
// (`rosters`, cloud/src/query/catalog.ts) and `vocabularyFor` reads it from
// there — the same rule, applied the other way round.
//
// Every vocabulary here carries a roster, and a served one with no entries is
// not a vocabulary at all (vocabularyFor): either way, the builder offers a
// picker where a vocabulary resolves and a typed token where none does.

import { CULTURE_LEVELS, WONDER_CULTURE_PREREQ } from "$lib/generated/wonders";
import { BASE_NATIONS } from "$lib/generated/civilization-colors";
import { FAMILY_CLASSES } from "$lib/generated/family-classes";
import { SETUP_VALUE_ORDER } from "$lib/generated/setup-value-order";
import { LAW_CLASSES } from "$lib/generated/law-classes";
import { LEADER_TRAITS } from "$lib/generated/leader-traits";
import { MAP_OPTION_DEFS } from "$lib/generated/map-option-defs";
import { TREE_TECHS } from "$lib/generated/tech-tree";
import { UNIT_STATS } from "$lib/generated/unit-stats";
import { VICTORY_ORDERING } from "$lib/generated/victory-ordering";
import {
	mapScriptLabel,
	mapSizeLabel,
	prosperityName,
	setupValueName,
} from "$lib/map-settings";
import { compositionLabel, GAME_COMPOSITIONS } from "$lib/stats/global-facets";
import { KNOWN_MAP_SCRIPTS } from "$lib/tournament/map-scripts-table";
import {
	getSpritePath,
	improvementDisplayName,
	techName,
} from "$lib/game-detail/helpers";
import {
	archetypeSpriteKey,
	formatArchetype,
	formatEnum,
	nationName,
	unitName,
} from "$lib/utils/formatting";
import type { CatalogRosterOption, ValueType } from "./types";

export interface Vocabulary {
	// The values to offer, never empty — a vocabulary is what a picker is built
	// from, so a name with nothing to offer resolves to none at all.
	options: string[];
	label: (value: string) => string;
	// The game's own picture for one value, where the art ships: the sprite for
	// a zType, the account's avatar for a served identity roster. Null for a
	// value inside a vocabulary that has art but not for this one — the bonus
	// and upgrade cards in `tech` are the case — and the whole function is
	// absent from a vocabulary with no art at all, which is what tells a surface
	// whether to reserve room for icons in that column.
	icon?: (value: string) => string | null;
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
	nation: {
		options: byLabel(BASE_NATIONS, nationName),
		label: nationName,
		icon: (value) => getSpritePath("crests", value),
	},
	// A wonder is an improvement flagged `<bWonder>`, which is what the baked
	// culture-prereq table is keyed by.
	wonder: {
		options: byLabel(
			Object.keys(WONDER_CULTURE_PREREQ),
			improvementDisplayName,
		),
		label: improvementDisplayName,
		// A wonder's 2D icon is the improvement's, which is filed under its
		// zIconName rather than its zType — the indirection getSpritePath applies.
		icon: (value) => getSpritePath("improvements", value),
	},
	law: {
		options: byLabel(
			Object.values(LAW_CLASSES).flatMap((c) => c.laws),
			lawLabel,
		),
		label: lawLabel,
		icon: (value) => getSpritePath("laws", value),
	},
	archetype: {
		options: byLabel(LEADER_TRAITS.archetype, formatArchetype),
		label: formatArchetype,
		// The trimmed-and-squared glyph, which is the copy a tournament match row
		// draws beside a seat (MatchTable) — so an archetype reads the same here
		// as it does there. The key is the trait without its _ARCHETYPE suffix.
		icon: (value) => getSpritePath("traits-trimmed", archetypeSpriteKey(value)),
	},
	// Ascending, as the levels themselves are — the roster's own order is the
	// meaningful one here, so it is not re-sorted by name.
	culture_level: {
		options: [...CULTURE_LEVELS],
		label: cultureLabel,
		// The four level glyphs ship in the icons set, named by the level itself.
		icon: (value) => getSpritePath("icons", value),
	},
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
	// The one vocabulary that is not a zType roster. The Game mode filter's
	// values are roster compositions — single-player, duel, FFA — rather than
	// the `games.game_mode` column it replaced, which records how the players
	// connected and cannot tell a duel from an FFA (cloud/src/query/catalog.ts
	// has the counts). So the roster and the labels are the ones the /stats
	// slice selector already shows ($lib/stats/global-facets), and a duel reads
	// the same on both surfaces. Not re-sorted by label: that selector's order
	// is widest composition first, which is the order to read the list in.
	game_mode: {
		options: [...GAME_COMPOSITIONS],
		label: compositionLabel,
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
	// offered: they are not a research choice, and the game draws no tree node
	// for them (`player?.isTechHide(tech) ?? tech.mbHide`,
	// TechTreePanel.BuildTreeLayout — scripts/bake-tech-tree.ts cites it in
	// full). They stay typable, the way an aliased map script does. One tree tech is out of the picker for the
	// mirror-image reason the aliases are: TECH_CARTHAGINIAN_TRAINING is in the
	// corpus and not in the build this table was baked from.
	tech: {
		options: byLabel(TREE_TECHS, techName),
		label: techName,
		// Null for the bonus and upgrade cards the picker doesn't offer but a
		// grouping still returns — 14 of the 121 values and 347 of the 78,733 rows
		// in the 2026-11-10 snapshot ship no art of their own.
		icon: (value) => getSpritePath("techs", value),
	},
	// The units the game's own roster declares — all 91 of UNIT_STATS, which is
	// the full base-game list out of unit.xml. No baker of its own, unlike
	// `tech`: TECH_NAMES covers the display names and not the roster, which is
	// what bake-tech-tree exists for, while UNIT_STATS is already keyed by
	// every unit.
	//
	// Not narrowed to the units a given nation or tech can build: which units a
	// player could have trained is a game rules question, and Reference/Source
	// does not resolve in a fresh checkout (OLD_WORLD_REFERENCE_DIR covers
	// Reference/XML alone), so it is not answerable under the citation rule.
	//
	// Measured over the 116 saves in test-data/saves/: 62 of the 91 appear in
	// the corpus, and 10 unit types in the corpus are outside the roster — the
	// Carthage and Kush DLC units, which ship in Reference/XML/Mods/ and not in
	// the base Infos/ that bake-unit-stats reads. Those are 25 of the corpus's
	// 3,996 production rows. They stay typable and label themselves through
	// `unitName`'s formatEnum fallback, which is the same shape the `tech`
	// vocabulary carries for TECH_CARTHAGINIAN_TRAINING.
	unit: {
		options: byLabel(Object.keys(UNIT_STATS), unitName),
		label: unitName,
		// The painted portrait rather than the `__ICON` glyph. The glyph is the
		// Military rail's marker, where it replaces a colored dot and 3 of the
		// 91 units ship none; here the box is a value's picture beside its name,
		// which is the slot a crest and an improvement icon fill too, and 90 of
		// the 91 have a portrait.
		icon: (value) => getSpritePath("units", value),
	},
	family_class: {
		options: byLabel(FAMILY_CLASSES, familyClassLabel),
		label: familyClassLabel,
		// A class's crest is filed under the archetype of the same name
		// (FAMILYCLASS_LANDOWNERS → crests/CREST_ARCHETYPE_LANDOWNERS), which is
		// the key the family charts on /stats read it under too.
		icon: (value) =>
			getSpritePath("crests", value.replace(/^FAMILYCLASS_/, "ARCHETYPE_")),
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
	// An empty roster is a failed read on the Worker's side — handleQueryCatalog
	// serves the columns with one rather than a 500 — so it resolves to no
	// vocabulary and that filter falls back to the typed token, which is what
	// every one of them took before it had a roster at all.
	if (!roster || roster.length === 0) return null;
	// Order is the Worker's — TOURNAMENT_ROSTER_SQL hands them over newest
	// first, which is the order a tournament picker is read in.
	const byValue = new Map(roster.map((o) => [o.value, o]));
	// Icons only where the Worker sent some. The player roster carries an avatar
	// per account; the tournament roster carries none, and leaving `icon` off
	// there is what keeps a column of tournament names from reserving room for a
	// picture that never arrives.
	const hasIcons = roster.some((o) => o.icon !== undefined);
	return {
		options: roster.map((o) => o.value),
		// A value the roster no longer carries is still the value a shared link
		// asked about, so it labels itself rather than disappearing from the
		// chip that holds it.
		label: (value) => byValue.get(value)?.label ?? value,
		icon: hasIcons ? (value) => byValue.get(value)?.icon ?? null : undefined,
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
 *
 * Takes the vocabulary already resolved rather than the name of one, because
 * resolving a served roster's vocabulary builds a Map over the whole roster
 * and the answer is the same for every row of a column. The caller resolves
 * one per column.
 */
export function valueLabel(
	value: string | number | null,
	type: ValueType | "number",
	vocab: Vocabulary | null,
	nullLabel: string,
): string {
	if (value === null) return nullLabel;
	if (type === "boolean") return value === 1 || value === "1" ? "Yes" : "No";
	if (typeof value === "number") return String(value);
	// `text` and `identity` are the columns whose value is somebody's words —
	// a seat's in-save name, an account's display name. Formatting those would
	// cut a name containing an underscore in half.
	if (type !== "enum") return value;
	if (vocab) return vocab.label(value);
	// A zType with no roster: its prefix is its own first token
	// (OCCURRENCELEVEL_, …), so strip up to the first underscore rather than
	// keeping a list of prefixes in step with the catalog. Every column this
	// still reaches spells its prefix that way; a column whose values did not —
	// the bare NETWORK and two-word SINGLE_PLAYER the old `games.game_mode`
	// filter offered — is one to give a vocabulary above rather than a case
	// here. It also still catches a value a roster is missing, which is why it
	// is not an exhaustiveness check.
	const underscore = value.indexOf("_");
	return underscore === -1
		? value
		: formatEnum(value, value.slice(0, underscore + 1));
}
