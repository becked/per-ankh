// Select options for the rules editor: what an objective can target, named
// the way the game names it. All from the baked reference tables.

import { techName, improvementDisplayName } from "$lib/game-detail/helpers";
import { specialistName } from "$lib/game-detail/specialists";
import { IMPROVEMENT_BUILDS } from "$lib/generated/improvement-builds";
import { LEADER_TRAITS } from "$lib/generated/leader-traits";
import { COGNOMEN_LEGITIMACY } from "$lib/generated/orders-sources";
import { SPECIALISTS } from "$lib/generated/specialists";
import { OWTT_TECH_ENC } from "$lib/generated/owtt";
import { UNIT_STATS } from "$lib/generated/unit-stats";
import { CULTURE_LEVELS, WONDER_CULTURE_PREREQ } from "$lib/generated/wonders";
import { SHARE_YIELD_TYPES } from "$lib/parser/derive";
import type { SelectGroup, SelectOption } from "$lib/ui/types";
import { formatEnum } from "$lib/utils/formatting";
import { traitName, unitName } from "./describe";
import { ANY_RELIGION, ANY_WONDER, SCALAR_METRICS } from "./types";

const byLabel = (a: SelectOption, b: SelectOption) =>
	a.label.localeCompare(b.label);

function options(
	keys: Iterable<string>,
	label: (key: string) => string,
): SelectOption[] {
	return Array.from(keys, (value) => ({ value, label: label(value) })).sort(
		byLabel,
	);
}

// Researchable techs — the planner table encodes those as non-negative and
// the `_BONUS` reward cards (free units, boosts) as negative. Its positive
// keys are exactly tech.xml's researchable entries; the name tables only
// carry overrides, so they can't enumerate.
export const TECH_OPTIONS = options(
	Object.entries(OWTT_TECH_ENC)
		.filter(([, enc]) => enc >= 0)
		.map(([tech]) => tech),
	techName,
);

// Ordinary improvements a worker can build — wonders are their own list so
// the build picker can limit them to the ones the map has enabled.
export const IMPROVEMENT_OPTIONS = options(
	Object.entries(IMPROVEMENT_BUILDS)
		.filter(([, b]) => b.kind !== "wonder")
		.map(([imp]) => imp),
	improvementDisplayName,
);

export const WONDER_OPTIONS = options(
	Object.keys(WONDER_CULTURE_PREREQ),
	improvementDisplayName,
);

export const ANY_WONDER_OPTION: SelectOption = {
	value: ANY_WONDER,
	label: "Any wonder",
};

export const UNIT_OPTIONS = options(Object.keys(UNIT_STATS), unitName);

export const SPECIALIST_OPTIONS = options(
	Object.keys(SPECIALISTS),
	specialistName,
);

export const CULTURE_OPTIONS: SelectOption[] = CULTURE_LEVELS.map((c) => ({
	value: c,
	label: formatEnum(c, "CULTURE_"),
}));

// The world religions a player can found — religion.xml's seven non-pagan
// entries (the pagan ones are per-nation and never founded). No baked table
// carries the roster, so it's listed here.
export const RELIGION_OPTIONS: SelectOption[] = [
	{ value: ANY_RELIGION, label: "Any religion" },
	...options(
		[
			"RELIGION_ZOROASTRIANISM",
			"RELIGION_JUDAISM",
			"RELIGION_CHRISTIANITY",
			"RELIGION_MANICHAEISM",
			"RELIGION_BUDDHISM",
			"RELIGION_HINDUISM",
			"RELIGION_ATENISM",
		],
		(r) => formatEnum(r, "RELIGION_"),
	),
];

// The legitimacy table lists every cognomen but COGNOMEN_NEW — the
// placeholder a fresh ruler carries before earning one, which is no target.
// What a custom leader picks on turn 1 — the `leader` criterion's
// `required_traits` roster.
export const LEADER_TRAIT_OPTIONS: SelectGroup[] = [
	{
		heading: "Archetype",
		options: options(LEADER_TRAITS.archetype, traitName),
	},
	{
		heading: "Strengths",
		options: options(LEADER_TRAITS.strength, traitName),
	},
	{
		heading: "Weaknesses",
		options: options(LEADER_TRAITS.weakness, traitName),
	},
];

export const COGNOMEN_OPTIONS = options(Object.keys(COGNOMEN_LEGITIMACY), (c) =>
	formatEnum(c, "COGNOMEN_"),
);

// The yields the share blob carries a history for — the scorer reads
// `yield_history`, so a yield outside this list can never be met.
export const YIELD_OPTIONS = options(SHARE_YIELD_TYPES, (y) =>
	formatEnum(y, "YIELD_"),
);

// Grouped because the labels collide otherwise: the legitimacy yield rate
// and the legitimacy score both format as "Legitimacy".
export const METRIC_OPTIONS: SelectGroup[] = [
	{ heading: "Yields", options: YIELD_OPTIONS },
	{
		heading: "Scores",
		options: SCALAR_METRICS.map((m) => ({
			value: m,
			label: formatEnum(m, ""),
		})),
	},
];
