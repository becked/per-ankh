// The value rosters and display names for the catalog's enum columns: what
// each vocabulary offers, and the name each value reads under.
//
// One definition for both halves of the app. The builder's pickers offer these
// options ($lib/query/vocabularies adds the icons). The Worker's ask endpoint
// (cloud/src/query/ask.ts) lists them in its prompt and refuses a model answer
// that names a value outside them. Two copies could drift, and then the model
// would be refused a value the picker offers, or allowed one it does not.
//
// Relative imports only, because the Worker imports this module across the
// package boundary and has no `$lib` alias. cloud/tsconfig.json typechecks it
// as Worker code, so nothing reachable from here may need lib.dom.
//
// Every vocabulary here is a zType roster except `game_mode`. The tournament
// and player rosters live in D1 and the Worker serves them with the catalog
// (`rosters`, cloud/src/query/catalog.ts).

import { BASE_NATIONS } from "../generated/civilization-colors";
import { FAMILY_CLASSES } from "../generated/family-classes";
import { LAW_CLASSES } from "../generated/law-classes";
import { LEADER_TRAITS } from "../generated/leader-traits";
import { MAP_OPTION_DEFS } from "../generated/map-option-defs";
import { SETUP_VALUE_ORDER } from "../generated/setup-value-order";
import { TREE_TECHS } from "../generated/tech-tree";
import { UNIT_STATS } from "../generated/unit-stats";
import { VICTORY_ORDERING } from "../generated/victory-ordering";
import { CULTURE_LEVELS, WONDER_CULTURE_PREREQ } from "../generated/wonders";
import {
	mapScriptLabel,
	mapSizeLabel,
	prosperityName,
	setupValueName,
} from "../map-settings";
import { compositionLabel, GAME_COMPOSITIONS } from "../stats/global-facets";
import { KNOWN_MAP_SCRIPTS } from "../tournament/map-scripts-table";
import {
	formatArchetype,
	formatEnum,
	nationName,
	unitName,
} from "../utils/formatting";
import { improvementDisplayName, techName } from "../utils/game-names";

export interface VocabularyRoster {
	// The values to offer, never empty — a vocabulary is what a picker is built
	// from, so a name with nothing to offer resolves to none at all.
	options: string[];
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

export const VOCABULARY_ROSTERS: Readonly<Record<string, VocabularyRoster>> = {
	nation: {
		options: byLabel(BASE_NATIONS, nationName),
		label: nationName,
	},
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
	culture_level: {
		options: [...CULTURE_LEVELS],
		label: cultureLabel,
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
	// 3,996 production rows. They are not reachable from the builder at all:
	// a resolved vocabulary replaces the filter's text input with the picker
	// (QueryBuilder.svelte), so a value off the roster cannot be typed either,
	// and only a hand-written URL selects one. A grouping on `unit` still
	// returns their rows, labelled through `unitName`'s formatEnum fallback —
	// the same shape the `tech` vocabulary carries for
	// TECH_CARTHAGINIAN_TRAINING.
	unit: {
		options: byLabel(Object.keys(UNIT_STATS), unitName),
		label: unitName,
	},
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
