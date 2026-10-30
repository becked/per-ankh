import type { CityInfo } from "$lib/types/CityInfo";
import type {
	PlayerNationEntry,
	CharacterInfo,
	CharacterTraitInfo,
	FullGameData,
	PlayerGoalInfo,
	UnitInfo,
} from "$lib/parser/types";
import type { YieldHistory } from "$lib/types/YieldHistory";
import type { YieldDataPoint } from "$lib/types/YieldDataPoint";
import type { PlayerHistory } from "$lib/types/PlayerHistory";
import type { PlayerInfo } from "$lib/types/PlayerInfo";
import type { StoryEvent } from "$lib/types/StoryEvent";
import type { TechDiscoveryDataPoint } from "$lib/types/TechDiscoveryDataPoint";
import type { ChartOption, LineSeriesOption } from "$lib/echarts";
import {
	civilizationName,
	cognomenName,
	formatEnum,
	toRomanNumeral,
	characterName,
	nationName,
} from "$lib/utils/formatting";
import { toRgba } from "$lib/utils/color";
import {
	CHART_THEME,
	getChartColor,
	getCivilizationColor,
	getNationChartColor,
	getSeriesColor,
} from "$lib/config";
import { CREST_SPRITE_NAMES, TRIBE_CRESTS } from "$lib/generated/crest-sprites";
import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
import { UNIT_STATS } from "$lib/generated/unit-stats";
import { TECH_NAMES } from "$lib/generated/tech-names";
import { IMPROVEMENT_NAMES } from "$lib/generated/improvement-names";
import { SHRINE_TYPE, IMPROVEMENT_ICON } from "$lib/generated/science-yields";
import { PROJECT_ICON } from "$lib/generated/project-icons";
import { PROJECT_NAMES } from "$lib/generated/project-names";
import {
	OWTT_BASE_URL,
	OWTT_NATION_INDEX,
	OWTT_TECH_ENC,
} from "$lib/generated/owtt";

// ─── Types ───────────────────────────────────────────────────────────

export type ChartFilterKey =
	| "points"
	| "military"
	| "legitimacy"
	| "science"
	| "civics"
	| "training"
	| "growth"
	| "culture"
	| "happiness"
	| "orders"
	| "food"
	| "money"
	| "discontent"
	| "iron"
	| "stone"
	| "wood"
	| "maintenance"
	| "laws"
	| "techs";

export type TableState = {
	search: string;
	sortColumn: string;
	sortDirection: "asc" | "desc";
	filters: string[];
};

export type TableName =
	| "events"
	| "pins"
	| "cities"
	| "improvements"
	| "specialists"
	| "laws"
	| "units";

// The display row for the cities table: a CityInfo augmented with the resolved
// founding nation (see resolveCityRows). founder_nation is derived from the
// player_nations sidecar, not present on the blob's CityInfo, so it lives here.
export type CityRow = CityInfo & { founder_nation: string | null };

// format function receives the value AND the city object for context (e.g., capital star)
export type CityColumn = {
	key: string;
	label: string;
	defaultVisible: boolean;
	getValue: (city: CityRow) => string | number | boolean | null;
	format?: (value: string | number | boolean | null, city: CityRow) => string;
	sortValue?: (city: CityRow) => string | number | null;
	// When set, the cell prefixes a SpriteIcon resolved from the raw getValue()
	// enum (e.g. "crests" for NATION_*/FAMILY_*, "culture" for CULTURE_*).
	iconCategory?: SpriteCategory;
	// Overrides the icon's enum value (defaults to getValue()). Used by Family
	// to fall back from the per-family crest to the archetype crest. Returning
	// null renders no icon.
	iconValue?: (city: CityRow) => string | null;
};

export type YieldMode = "rate" | "cumulative";

export type YieldChartConfig = {
	yieldType: string;
	title: string;
	yAxisLabel: string;
	filterKey: ChartFilterKey;
};

// ─── Constants ───────────────────────────────────────────────────────

export const YIELD_TYPES = [
	"YIELD_SCIENCE",
	"YIELD_CIVICS",
	"YIELD_TRAINING",
	"YIELD_GROWTH",
	"YIELD_CULTURE",
	"YIELD_HAPPINESS",
	"YIELD_ORDERS",
	"YIELD_FOOD",
	"YIELD_MONEY",
	"YIELD_DISCONTENT",
	"YIELD_IRON",
	"YIELD_STONE",
	"YIELD_WOOD",
	"YIELD_MAINTENANCE",
] as const;

export const PLAYER_CHART_KEYS: ChartFilterKey[] = [
	"points",
	"military",
	"legitimacy",
	"science",
	"civics",
	"training",
	"growth",
	"culture",
	"happiness",
	"orders",
	"food",
	"money",
	"discontent",
	"iron",
	"stone",
	"wood",
	"maintenance",
];

export const YIELD_CHART_CONFIG: YieldChartConfig[] = [
	{
		yieldType: "YIELD_SCIENCE",
		title: "Science",
		yAxisLabel: "Science",
		filterKey: "science",
	},
	{
		yieldType: "YIELD_CIVICS",
		title: "Civics",
		yAxisLabel: "Civics",
		filterKey: "civics",
	},
	{
		yieldType: "YIELD_TRAINING",
		title: "Training",
		yAxisLabel: "Training",
		filterKey: "training",
	},
	{
		yieldType: "YIELD_GROWTH",
		title: "Growth",
		yAxisLabel: "Growth",
		filterKey: "growth",
	},
	{
		yieldType: "YIELD_CULTURE",
		title: "Culture",
		yAxisLabel: "Culture",
		filterKey: "culture",
	},
	{
		yieldType: "YIELD_HAPPINESS",
		title: "Happiness",
		yAxisLabel: "Happiness",
		filterKey: "happiness",
	},
	{
		yieldType: "YIELD_ORDERS",
		title: "Orders",
		yAxisLabel: "Orders",
		filterKey: "orders",
	},
	{
		yieldType: "YIELD_FOOD",
		title: "Food",
		yAxisLabel: "Food",
		filterKey: "food",
	},
	{
		yieldType: "YIELD_MONEY",
		title: "Money",
		yAxisLabel: "Gold",
		filterKey: "money",
	},
	{
		yieldType: "YIELD_DISCONTENT",
		title: "Discontent",
		yAxisLabel: "Discontent",
		filterKey: "discontent",
	},
	{
		yieldType: "YIELD_IRON",
		title: "Iron",
		yAxisLabel: "Iron",
		filterKey: "iron",
	},
	{
		yieldType: "YIELD_STONE",
		title: "Stone",
		yAxisLabel: "Stone",
		filterKey: "stone",
	},
	{
		yieldType: "YIELD_WOOD",
		title: "Wood",
		yAxisLabel: "Wood",
		filterKey: "wood",
	},
	{
		yieldType: "YIELD_MAINTENANCE",
		title: "Maintenance",
		yAxisLabel: "Maintenance",
		filterKey: "maintenance",
	},
];

/**
 * Whether a yield's `cumulative` is the game's own lifetime total (true) or
 * our running sum of the per-turn rate (false). The parser decides it per
 * save and yield, so every player's series of one yield agree. Absent on
 * blobs parsed before 2.18.0, where the two are mixed — that reads as the
 * running sum, the claim the blob can't contradict.
 */
export function cumulativeIsGameTotal(
	allYields: YieldHistory[],
	yieldType: string,
): boolean {
	return (
		allYields.find((y) => y.yield_type === yieldType)
			?.cumulative_is_game_total ?? false
	);
}

// ─── Shared data-table styling (game-detail data tabs) ───────────────
// Visual tokens matching the player games table: a dark blue-gray frame
// holding surface rounded card rows under a surface-sunken toolbar-style header
// bar. Round the first/last cell of each row inline with
// `rounded-l-lg border-l` / `rounded-r-lg border-r`.
export const TABLE_FRAME_CLASS = "flex gap-4 rounded-lg bg-blue-gray p-3";
export const TABLE_CLASS = "w-full border-separate border-spacing-y-1.5";
export const TABLE_HEADER_TH_CLASS =
	"sticky -top-4 z-10 cursor-pointer select-none whitespace-nowrap border-y border-surface bg-surface-sunken px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-100 shadow-lg transition-colors hover:text-orange";
export const TABLE_CELL_TD_CLASS =
	"bg-surface p-3 text-left text-tan transition-colors duration-200 group-hover:bg-surface-hover";

// Column order: Nation, Name, Family, Founded, Culture, Specialists, Growth, Population, Tiles Bought
// Default visible: Nation, Name, Family, Founded, Culture
export const CITY_COLUMNS: CityColumn[] = [
	{
		key: "owner_nation",
		label: "Nation",
		defaultVisible: true,
		// Whoever HOLDS the city, which is a tribe when no nation does — see
		// `cityOwner`. `owner_nation` alone read every tribe-held city as
		// "Unknown", crestless and colourless.
		getValue: (c) => cityOwner(c.owner_nation, c.tribe)?.civilization ?? null,
		format: (v) => civilizationName(v as string | null),
		iconCategory: "crests",
		iconValue: (c) => cityOwner(c.owner_nation, c.tribe)?.crestKey ?? null,
	},
	{
		key: "founder_nation",
		label: "Founder",
		defaultVisible: false,
		getValue: (c) => c.founder_nation,
		// Blank (not "Unknown") when the founder can't be resolved — pre-2.6.0
		// blobs ship no player_nations sidecar.
		format: (v) => (v ? nationName(v as string) : ""),
		iconCategory: "crests",
	},
	{
		key: "city_name",
		label: "Name",
		defaultVisible: true,
		getValue: (c) => c.city_name,
		format: (v, city) => {
			const name = formatEnum(v as string, "CITYNAME_");
			return city.is_capital ? `★ ${name}` : name;
		},
	},
	{
		key: "family",
		label: "Family",
		defaultVisible: true,
		getValue: (c) => c.family,
		format: (v) => formatEnum(v as string | null, "FAMILY_"),
		iconCategory: "crests",
		// Per-family crest art ships for only a few families; fall back to the
		// always-available archetype crest derived from family_class.
		iconValue: (c) => familyCrestKey(c.family, c.family_class),
	},
	{
		key: "founded_turn",
		label: "Founded",
		defaultVisible: true,
		getValue: (c) => c.founded_turn,
	},
	{
		key: "culture_level",
		label: "Culture",
		defaultVisible: true,
		getValue: (c) => c.culture_level,
		format: (v) => formatEnum(v as string | null, "CULTURE_"),
		sortValue: (c) => c.culture_level ?? "",
		iconCategory: "icons",
	},
	{
		key: "specialist_count",
		label: "Specialists",
		defaultVisible: false,
		getValue: (c) => c.specialist_count,
	},
	{
		key: "growth_count",
		label: "Growth",
		defaultVisible: false,
		getValue: (c) => c.growth_count,
	},
	{
		key: "citizens",
		label: "Population",
		defaultVisible: false,
		getValue: (c) => c.citizens,
	},
	{
		key: "buy_tile_count",
		label: "Tiles Bought",
		defaultVisible: false,
		getValue: (c) => c.buy_tile_count,
	},
	{
		key: "governor_name",
		label: "Governor",
		defaultVisible: false,
		getValue: (c) => c.governor_name,
		format: (v) => (v ? characterName(v as string) : "—"),
		// Sort on the resolved name — the token orders the Hatti pool as
		// NAME_HITTITE_MALE01…26, which reads as unsorted in the column.
		sortValue: (c) => (c.governor_name ? characterName(c.governor_name) : null),
	},
	{
		key: "unit_production_count",
		label: "Units Produced",
		defaultVisible: false,
		getValue: (c) => c.unit_production_count,
	},
	{
		key: "hurry_civics_count",
		label: "Hurry (Civics)",
		defaultVisible: false,
		getValue: (c) => c.hurry_civics_count,
	},
	{
		key: "hurry_money_count",
		label: "Hurry (Money)",
		defaultVisible: false,
		getValue: (c) => c.hurry_money_count,
	},
	{
		key: "hurry_training_count",
		label: "Hurry (Training)",
		defaultVisible: false,
		getValue: (c) => c.hurry_training_count,
	},
	{
		key: "hurry_population_count",
		label: "Hurry (Pop)",
		defaultVisible: false,
		getValue: (c) => c.hurry_population_count,
	},
];

// ─── Factory Functions ───────────────────────────────────────────────

export function createDefaultChartFilters(): Record<
	ChartFilterKey,
	Record<string, boolean>
> {
	return {
		points: {},
		military: {},
		legitimacy: {},
		science: {},
		civics: {},
		training: {},
		growth: {},
		culture: {},
		happiness: {},
		orders: {},
		food: {},
		money: {},
		discontent: {},
		iron: {},
		stone: {},
		wood: {},
		maintenance: {},
		laws: {},
		techs: {},
	};
}

export function createDefaultTableStates(): Record<TableName, TableState> {
	return {
		events: {
			search: "",
			sortColumn: "turn",
			sortDirection: "desc",
			filters: [],
		},
		// The Events tab's second table, the Map Pins section's.
		pins: {
			search: "",
			sortColumn: "turn",
			sortDirection: "desc",
			filters: [],
		},
		cities: {
			search: "",
			sortColumn: "owner_nation",
			sortDirection: "asc",
			filters: [],
		},
		improvements: {
			search: "",
			sortColumn: "improvement",
			sortDirection: "asc",
			filters: [],
		},
		specialists: {
			search: "",
			sortColumn: "specialist",
			sortDirection: "asc",
			filters: [],
		},
		laws: {
			search: "",
			sortColumn: "nation",
			sortDirection: "asc",
			filters: [],
		},
		units: {
			search: "",
			sortColumn: "nation",
			sortDirection: "asc",
			filters: [],
		},
	};
}

export function createDefaultCityVisibleColumns(): Record<string, boolean> {
	return Object.fromEntries(
		CITY_COLUMNS.map((col) => [col.key, col.defaultVisible]),
	);
}

// ─── Sprite Helpers ─────────────────────────────────────────────────

export type SpriteCategory =
	| "crests"
	| "techs"
	| "laws"
	| "yields"
	| "religions"
	| "theology"
	| "icons"
	| "units"
	| "traits"
	| "traits-trimmed"
	| "portraits"
	| "improvements"
	| "specialists"
	| "projects"
	| "resources"
	// Effect-unit glyphs, keyed by the effect unit's `<zIconName>` rather than
	// its zType — the two differ for 47 of the 134 entries a unit can carry, and
	// the art is named by the icon. `$lib/generated/effect-units` puts that
	// name on each row as `icon`; pass it through, not the zType.
	| "effect-units";

// Known tech name corrections (game data typos or alternate names)
const TECH_SPRITE_FIXES: Record<string, string> = {
	TECH_SOVEREIGNITY: "TECH_SOVEREIGNTY",
};

// The sprite name a unit actually renders: some units ship no sprite of their
// own and borrow another's (unit.xml <zIconName>, e.g. UNIT_HITTITE_CHARIOT_1
// → UNIT_THREE_MEN_CHARIOT).
const unitSpriteName = (unitType: string): string =>
	UNIT_STATS[unitType]?.icon ?? unitType;

// Tech display name — the baked override, else the generic formatter. Shared by
// the Military rail and the Techs tab (comparison table + science rail).
export const techName = (tech: string): string =>
	TECH_NAMES[tech] ?? formatEnum(tech, "TECH_");

/**
 * Resolve a tech enum value to its (category, filename) in the sprite
 * manifest, or null if no sprite ships. Handles game-data corner cases:
 * bonus-suffix techs, the RESOURCE_ prefix, the known TECH_SOVEREIGNITY
 * misspelling, and the unit-icon fallback for unit-unlock techs.
 */
function resolveTechSprite(
	enumValue: string,
): { category: string; filename: string } | null {
	// Strip bonus suffixes: TECH_STONECUTTING_BONUS_STONE -> TECH_STONECUTTING
	let tech = enumValue.replace(/_BONUS.*$/, "");
	// Strip RESOURCE_ prefix: TECH_RESOURCE_EBONY -> TECH_EBONY
	tech = tech.replace(/^TECH_RESOURCE_/, "TECH_");
	// Apply known corrections (game data typos)
	tech = TECH_SPRITE_FIXES[tech] ?? tech;
	if (SPRITE_MANIFEST[`techs/${tech}`] != null) {
		return { category: "techs", filename: tech };
	}
	// Fallback: try unit sprite (TECH_HASTATUS -> UNIT_HASTATUS), following a
	// borrowed icon (TECH_HITTITE_CHARIOT_1 -> UNIT_THREE_MEN_CHARIOT).
	const unitName = unitSpriteName(tech.replace(/^TECH_/, "UNIT_"));
	if (SPRITE_MANIFEST[`units/${unitName}`] != null) {
		return { category: "units", filename: unitName };
	}
	// Also try stripping nation prefixes: TECH_HITTITE_CHARIOT_1 -> UNIT_CHARIOT
	const withoutNation = tech
		.replace(
			/^TECH_(AKSUM|ASSYRIA|BABYLONIA|CARTHAGE|EGYPT|GREECE|HITTITE|KUSH|PERSIA|ROME)_/,
			"TECH_",
		)
		.replace(/_\d+$/, ""); // strip trailing numbers
	if (withoutNation !== tech) {
		const unitFallback = withoutNation.replace(/^TECH_/, "UNIT_");
		if (SPRITE_MANIFEST[`units/${unitFallback}`] != null) {
			return { category: "units", filename: unitFallback };
		}
	}
	return null;
}

export function getSpritePath(
	category: SpriteCategory,
	enumValue: string,
	opts?: { glyph?: boolean },
): string | null {
	if (category === "crests") {
		return SPRITE_MANIFEST[`crests/CREST_${enumValue}`] ?? null;
	}
	if (category === "techs") {
		const resolved = resolveTechSprite(enumValue);
		if (resolved == null) return null;
		return SPRITE_MANIFEST[`${resolved.category}/${resolved.filename}`] ?? null;
	}
	if (category === "traits-trimmed") {
		// Rail-only trimmed+squared copy of the archetype glyphs (baked by
		// scripts/bake-sprites.ts) so they fill their box like the plated markers
		// beside them (#85). Falls back to the untrimmed traits/ tile if the
		// cropped manifest entry is missing (e.g. before a re-bake).
		return (
			SPRITE_MANIFEST[`traits-trimmed/${enumValue}`] ??
			SPRITE_MANIFEST[`traits/${enumValue}`] ??
			null
		);
	}
	if (category === "portraits") {
		// The save's portrait id is `CHARACTER_PORTRAIT_<base>`; the manifest key
		// is `portraits/<base>` (age suffix baked away). Null for unmapped/old
		// portraits — SpriteIcon renders nothing, so it degrades gracefully.
		const base = enumValue.replace(/^CHARACTER_PORTRAIT_/, "");
		return SPRITE_MANIFEST[`portraits/${base}`] ?? null;
	}
	if (category === "improvements") {
		// The 2D icon set is named by zIconName, which tiers share
		// (IMPROVEMENT_LIBRARY_2 → IMPROVEMENT_ACADEMY); same-named entries
		// (watermill, groves) aren't in the baked override table.
		return (
			SPRITE_MANIFEST[
				`improvements/${IMPROVEMENT_ICON[enumValue] ?? enumValue}`
			] ?? null
		);
	}
	if (category === "specialists") {
		// One class-level icon per specialist line — tiers share it
		// (SPECIALIST_POET_2 → SPECIALIST_POET).
		return (
			SPRITE_MANIFEST[`specialists/${enumValue.replace(/_\d+$/, "")}`] ?? null
		);
	}
	if (category === "projects") {
		// Projects name their icon with <zIcon> (baked into PROJECT_ICON), and
		// that name crosses sprite sets: most are a project's own art, the import
		// projects name the resource they import (PROJECT_IMPORT_CAMEL →
		// RESOURCE_CAMEL), the dissent ones a religion, and the suppress-dissent
		// ones the MISSION_REMOVE_HERESY glyph baked into icons/. Each in turn.
		const icon = PROJECT_ICON[enumValue] ?? enumValue;
		return (
			SPRITE_MANIFEST[`projects/${icon}`] ??
			SPRITE_MANIFEST[`resources/${icon}`] ??
			SPRITE_MANIFEST[`religions/${icon}`] ??
			SPRITE_MANIFEST[`icons/${icon}`] ??
			null
		);
	}
	if (category === "units") {
		const name = unitSpriteName(enumValue);
		// The `glyph` variant is the small white flag glyph shipped as a __ICON
		// sibling of the portrait (units/UNIT_X__ICON.png) — the form the Military
		// rail's unit markers use. Glyph-or-nothing: a unit with no glyph returns
		// null so the rail renders its colored dot rather than the painted
		// portrait, a categorically different image in a glyph slot.
		if (opts?.glyph) return SPRITE_MANIFEST[`units/${name}__ICON`] ?? null;
		return SPRITE_MANIFEST[`units/${name}`] ?? null;
	}
	return SPRITE_MANIFEST[`${category}/${enumValue}`] ?? null;
}

/**
 * Crest sprite key (for the `crests` category) of a family: the per-family
 * crest when we ship the art, else the family-class archetype crest —
 * which always exists for non-null family_class values. Null when neither
 * resolves, so callers can degrade (the map omits the crest, the rail
 * renders its colored dot).
 */
export function familyCrestKey(
	family: string | null | undefined,
	familyClass: string | null | undefined,
): string | null {
	// Family values already carry the FAMILY_ prefix (FAMILY_ANTIGONUS) and the
	// art ships as CREST_FAMILY_ANTIGONUS, but the CREST_ prefix is
	// getSpritePath's to add — so the value goes through as-is.
	if (family && getSpritePath("crests", family)) {
		return family;
	}
	if (familyClass) {
		// FAMILYCLASS_CHAMPIONS → ARCHETYPE_CHAMPIONS
		return familyClass.replace(/^FAMILYCLASS_/, "ARCHETYPE_");
	}
	return null;
}

/**
 * The family a city was held under by a given owner: its `player_families`
 * entry, else the city's current family. A city's family only changes on
 * conquest, so each past owner's entry is the family during their tenure —
 * a captured city resolves to the founder's family for the founder and the
 * conqueror's for the conqueror. Falls back to the current family when the
 * owner is unknown, or for pre-2.10.0 blobs, which ship no `player_families`.
 */
export function familyForOwner(
	city: CityInfo,
	playerXmlId: number | null | undefined,
): { family: string | null; familyClass: string | null } {
	const pf =
		playerXmlId != null
			? city.player_families?.find((f) => f.player_xml_id === playerXmlId)
			: undefined;
	return {
		family: pf?.family ?? city.family,
		familyClass: pf?.family_class ?? city.family_class,
	};
}

// One rating chip for a character tooltip: the in-game stat icon + value.
function ratingChipHtml(
	label: string,
	key: string,
	value: number | null,
): string {
	if (value == null) return "";
	const url = getSpritePath("icons", key);
	const ic = url
		? `<img src="${url}" alt="${label}" style="width:13px;height:13px"/>`
		: `${label}`;
	return `<span style="display:inline-flex;align-items:center;gap:3px">${ic}${value}</span>`;
}

/**
 * The four-rating stat line for a character tooltip (Wis/Cha/Cou/Dis, each
 * with its in-game icon), or "" when no rating is known — the row the
 * Military rail's leader markers show, shared with the Techs rail's
 * leader-change markers.
 */
export function ratingChipsRowHtml(c: CharacterInfo): string {
	const chips = [
		ratingChipHtml("Wis", "RATING_WISDOM", c.wisdom),
		ratingChipHtml("Cha", "RATING_CHARISMA", c.charisma),
		ratingChipHtml("Cou", "RATING_COURAGE", c.courage),
		ratingChipHtml("Dis", "RATING_DISCIPLINE", c.discipline),
	].join("");
	return chips
		? `<div style="display:flex;gap:11px;margin-top:4px">${chips}</div>`
		: "";
}

// ─── Unit Classification ────────────────────────────────────────────
//
// Chart labels follow the game's own military UnitCycle names: Infantry,
// Ranged, Mounted, Siege, Water (see MILITARY_CYCLE_CLASS below). classifyUnit
// resolves each unit from its baked <UnitCycle>; the keyword heuristic is only
// a fallback for units absent from Reference (unreleased DLC / mods).

export type UnitClass = "Infantry" | "Ranged" | "Mounted" | "Siege" | "Water";

// The game's five military unit cycles (unit.xml <UnitCycle>) → our chart
// labels. Civilian cycles (worker, settler, scout, caravan, disciple) are
// deliberately absent, so they resolve to null and drop out of the breakdown.
const MILITARY_CYCLE_CLASS: Record<string, UnitClass> = {
	UNITCYCLE_MILITARY_INFANTRY: "Infantry",
	UNITCYCLE_MILITARY_RANGED: "Ranged",
	UNITCYCLE_MILITARY_MOUNTED: "Mounted",
	UNITCYCLE_MILITARY_SIEGE: "Siege",
	UNITCYCLE_MILITARY_WATER: "Water",
};

const RANGED_KEYWORDS = [
	"ARCHER",
	"BOWMAN",
	"CROSSBOW",
	"SLINGER",
	"SKIRMISHER",
	"JAVELINEER",
	"CLUB_THROWER",
];
const MOUNTED_KEYWORDS = [
	"CAVALRY",
	"CHARIOT",
	"CATAPHRACT",
	"HORSEMAN",
	"RIDER",
	"LANCER",
	"MOUNTED",
	"ELEPHANT",
	"CAMEL",
];
const SIEGE_KEYWORDS = [
	"BALLISTA",
	"ONAGER",
	"SIEGE",
	"CATAPULT",
	"RAM",
	"TORSION",
];
const WATER_KEYWORDS = [
	"BIREME",
	"TRIREME",
	"DROMON",
	"QUINQUEREME",
	"PENTECONTER",
	"GALLEY",
	"SHIP",
	"LONGBOAT",
];
const SUPPORT_KEYWORDS = [
	"WORKER",
	"MILITIA",
	"SETTLER",
	"SCOUT",
	"CARAVAN",
	"DISCIPLE",
	"DIPLOMAT",
	"MISSIONARY",
	"SPY",
	"MONK",
	"CLERIC",
	"PROPHET",
	"ENVOY",
	"TRADER",
];

export function classifyUnit(unitType: string): UnitClass | null {
	// Prefer the game's canonical grouping. A unit present in the baked table
	// with a non-military cycle (caravan/disciple/…) maps to null → excluded.
	const cycle = UNIT_STATS[unitType]?.cycle;
	if (cycle != null) return MILITARY_CYCLE_CLASS[cycle] ?? null;
	// Fallback for units absent from Reference (unreleased DLC / mods not yet
	// re-baked): approximate the class from the zType name.
	return classifyByKeyword(unitType);
}

function classifyByKeyword(unitType: string): UnitClass | null {
	const upper = unitType.toUpperCase();
	if (SUPPORT_KEYWORDS.some((k) => upper.includes(k))) return null;
	if (WATER_KEYWORDS.some((k) => upper.includes(k))) return "Water";
	if (SIEGE_KEYWORDS.some((k) => upper.includes(k))) return "Siege";
	if (MOUNTED_KEYWORDS.some((k) => upper.includes(k))) return "Mounted";
	if (RANGED_KEYWORDS.some((k) => upper.includes(k))) return "Ranged";
	return "Infantry";
}

export const UNIT_CLASS_COLORS: Record<UnitClass, string> = {
	Infantry: "#C87941",
	Ranged: "#B8860B",
	Mounted: "#CD853F",
	Siege: "#A0522D",
	Water: "#8B4513",
};

// ─── Timeline Types ─────────────────────────────────────────────────

export type TimelineCategory =
	"tech" | "law" | "city" | "religion" | "wonder" | "battle";

// The timeline table buckets by nation, so `nation` is the whole of a row's
// attribution — hence no player name here. The one it used to carry was a
// mix of raw player names (empty on single-player saves) and nation labels,
// depending on which producer built the row, and nothing read it.
export type TimelineEvent = {
	turn: number;
	nation: string | null;
	category: TimelineCategory;
	label: string;
	enumValue: string;
	spriteCategory: SpriteCategory | null;
};

// ─── Overview Types ─────────────────────────────────────────────────

export type PlayerSummary = {
	playerId: number;
	playerName: string;
	nation: string | null;
	isHuman: boolean;
	isUploader: boolean;
	isWinner: boolean;
	finalMilitary: number | null;
	cityCount: number;
	techCount: number;
	lawCount: number;
	unitsTotal: number;
	religion: string | null;
};

// ─── Player identity (mirror-match safe) ─────────────────────────────
//
// `nation` is NOT a unique player key: mirror matches (two players, same
// nation) collide, which crashes `{#each}` keys and conflates per-player
// joins. The stable key is the player's xml_id — present as `player_id` on
// every per-player array and as `player_index` on `player_roster`. These
// helpers resolve that id, plus a unique display label and a per-player
// color, used as the single identity backbone across the detail view.

// Any row that identifies a player. `player_id` is present on parser ≥2.x
// per-player arrays and (from 2.6.0) on `PlayerInfo`; older `PlayerInfo`
// rows carry neither and are recovered from `player_roster`.
export type PlayerLike = {
	player_id?: number | null;
	player_index?: number;
	player_name: string;
	nation: string | null;
};

// Minimal roster shape used to recover ids for id-less PlayerInfo rows. The
// canonical `player_roster` (player_index) satisfies it; so does a roster
// synthesized from any per-player array (player_id → player_index) for legacy
// blobs that predate the roster sidecar.
export type RosterLike = {
	player_index: number;
	player_name: string;
	nation: string | null;
};

export type ResolvedPlayer = {
	// Canonical id — equals per-array `player_id` and roster `player_index`.
	playerId: number;
	playerName: string;
	nation: string | null;
	// Unique, display-friendly label: the nation name, with the player name
	// appended only when ≥2 players share a nation. Safe as an `{#each}` key
	// and as an ECharts series name / legend + selection key.
	label: string;
	// Nation color when the nation is unique among players; a distinct palette
	// color when nations collide, so same-nation players stay visually separable.
	color: string;
};

/**
 * Resolve a stable per-player identity from any list of player-bearing rows.
 *
 * Dedupes by canonical id (so it accepts a per-player array with many rows
 * per player, or a one-row-per-player roster). `roster` backfills the id for
 * pre-2.6.0 `PlayerInfo` rows that lack one (matched by name+nation); an
 * unrecoverable row gets a unique synthetic id so keys never collide.
 */
export function resolvePlayers(
	rows: PlayerLike[],
	roster?: RosterLike[],
): ResolvedPlayer[] {
	const consumed = new Set<number>();
	const order: number[] = [];
	const byId = new Map<number, { playerName: string; nation: string | null }>();
	let synthetic = -1;

	for (const r of rows) {
		let id: number | null = r.player_id ?? r.player_index ?? null;
		if (id == null && roster) {
			const match = roster.find(
				(e) =>
					!consumed.has(e.player_index) &&
					e.player_name === r.player_name &&
					e.nation === r.nation,
			);
			if (match) {
				id = match.player_index;
				consumed.add(match.player_index);
			}
		}
		if (id == null) id = synthetic--;
		if (!byId.has(id)) {
			byId.set(id, { playerName: r.player_name, nation: r.nation });
			order.push(id);
		}
	}

	const nationCounts = new Map<string, number>();
	for (const id of order) {
		const key = byId.get(id)!.nation ?? "";
		nationCounts.set(key, (nationCounts.get(key) ?? 0) + 1);
	}

	return order.map((id, ordinal) => {
		const { playerName, nation } = byId.get(id)!;
		const collides = (nationCounts.get(nation ?? "") ?? 0) > 1;
		const base = nationName(nation);
		const name = playerName.length > 0 ? playerName : `#${id}`;
		return {
			playerId: id,
			playerName,
			nation,
			label: collides ? `${base} (${name})` : base,
			color: collides
				? getChartColor(ordinal)
				: getNationChartColor(nation, ordinal),
		};
	});
}

// A roster player enriched with its resolved identity — the iteration source
// for the per-player tabs (Overview, Settings, Military).
export type DetailPlayer = PlayerInfo &
	Pick<ResolvedPlayer, "playerId" | "label" | "color">;

/**
 * One ruler's tenure on the Leaders tab: the ruler character plus the derived
 * reign window [start, end], its length in turns, the legitimacy at each edge,
 * and the traits/ambitions held during it. Built in `LeadersTab`, consumed by
 * `LeaderCard`.
 */
export type Reign = {
	ruler: CharacterInfo;
	start: number;
	end: number;
	years: number;
	legitStart: number | null;
	legitEnd: number | null;
	netLegitimacy: number | null;
	traits: CharacterTraitInfo[];
	ambitions: PlayerGoalInfo[];
};

/**
 * Resolve `gameDetails.players` into the iteration source for per-player tabs,
 * keeping the full `PlayerInfo` fields and adding a stable `playerId`, unique
 * `label`, and per-player `color`. `players` is one row per player, so the
 * resolved list aligns 1:1 by index.
 */
export function resolveDetailPlayers(
	players: PlayerInfo[],
	roster?: RosterLike[],
): DetailPlayer[] {
	const resolved = resolvePlayers(players, roster);
	return players.map((p, i) => ({
		...p,
		playerId: resolved[i].playerId,
		label: resolved[i].label,
		color: resolved[i].color,
	}));
}

/**
 * A game's per-player iteration source, shared by both views of a game: the
 * tabs and the map view's chrome. `player_roster` is the id source; a blob
 * without one falls back to a roster synthesized from player_history (which
 * carries player_id) to recover ids for its id-less game_details.players rows.
 */
export function resolveGamePlayers(
	game: Pick<FullGameData, "game_details" | "player_roster" | "player_history">,
): DetailPlayer[] {
	const roster: RosterLike[] =
		game.player_roster.length > 0
			? game.player_roster
			: game.player_history.map((h) => ({
					player_index: h.player_id,
					player_name: h.player_name,
					nation: h.nation,
				}));
	return resolveDetailPlayers(game.game_details.players, roster);
}

/**
 * The uploader's seat: the player holding `uploaderIndex`, which is the seat
 * `player_summaries.is_uploader` records and the detail payload serves. A
 * nation can't stand in for it — two humans can play one nation, and the
 * uploader is not always the lower seat of the two.
 *
 * `uploaderNation` is the fallback, and only for the case the id can't answer:
 * a pre-2.6.0 blob whose `game_details.players` rows carry no id of their own
 * gets a synthetic negative one wherever {@link resolvePlayers} can't match the
 * row to the roster, and index equality fails silently against that. Same
 * id-then-nation shape as {@link findByPlayer}, for the same reason.
 *
 * An observer upload claims no seat — `uploaderIndex` is null — so each caller
 * picks its own fallback.
 *
 * Not the save owner, which has a different source and a different answer:
 * `PlayerRosterEntry.is_save_owner` is the seat the file was written from, and
 * it names the other player on exactly the uploads observer mode exists for.
 * {@link leadPlayerId} is what reaches for it, and only once this has come up
 * empty.
 */
export function uploaderPlayer<
	T extends Pick<ResolvedPlayer, "playerId" | "nation">,
>(
	players: T[],
	uploaderIndex: number | null,
	uploaderNation: string | null,
): T | undefined {
	if (uploaderIndex == null) return undefined;
	const seated = players.find((p) => p.playerId === uploaderIndex);
	if (seated || uploaderNation == null) return seated;
	return players.find((p) => p.nation === uploaderNation);
}

/**
 * Filter per-entity rows down to those owned by `player`. Prefers the entity's
 * owner-id field when present (reparsed ≥2.6.0 blobs), falling back to nation
 * when it's absent (older blobs, where same-nation owners can't be split).
 */
export function ownedByPlayer<T>(
	rows: T[],
	player: Pick<ResolvedPlayer, "playerId" | "nation">,
	idOf: (row: T) => number | null | undefined,
	nationOf: (row: T) => string | null,
): T[] {
	return rows.filter((row) => {
		const id = idOf(row);
		return id != null
			? id === player.playerId
			: nationOf(row) === player.nation;
	});
}

/**
 * The seat the per-player surfaces lead with, in resolution order:
 *
 *   1. The uploader's, when the upload claimed one.
 *   2. `PlayerRosterEntry.is_save_owner` — the seat whose client wrote the
 *      file. Only the end-of-game save records it: `ClientManager.sendSave`
 *      raises `ActionType.SAVE` carrying `getActivePlayer()`
 *      (`ClientManager.sendSave`, ClientManager.cs:988), its handler forwards
 *      that seat on the end-auto-save branch alone (`Game.handleAction`,
 *      Game.cs:15523) and `GameServerBehaviour.SaveGameToString` writes it as
 *      `<?ActivePlayer N?>` (GameServerBehaviour.cs:1078); every other save
 *      path passes `PlayerType.NONE`. Those three are app-layer files, which
 *      `Reference/Source` doesn't ship — cited from a decompiled build.
 *   3. The lowest-numbered human otherwise. That is the seat the Worker's
 *      COALESCE'd `user_nation` names (`ORDER BY ps.player_index ASC`,
 *      cloud/src/games.ts), so the tabs lead with the nation the header, the
 *      games list and the Player card already show for the same game.
 *
 * Not the first human in `players` order: `deriveGameDetails`
 * (parser/derive/game-details.ts) sorts `game_details.players` by player name,
 * so a positional pick there resolves to whatever our own display sort put
 * first — a seat the save itself records nothing about.
 */
export function leadPlayerId(
	players: DetailPlayer[],
	uploaderPlayerId: number | null,
	saveOwnerPlayerId: number | null,
): number | null {
	const humanSeats = players.filter((p) => p.is_human).map((p) => p.playerId);
	const lowestHuman = humanSeats.length > 0 ? Math.min(...humanSeats) : null;
	return uploaderPlayerId ?? saveOwnerPlayerId ?? lowestHuman;
}

/**
 * Canonical per-player display order for the detail tabs: the seat the view
 * leads with ({@link leadPlayerId}) first, then the rest in their existing
 * order.
 */
export function orderPlayersLeadFirst(
	players: DetailPlayer[],
	leadId: number | null,
): DetailPlayer[] {
	if (leadId == null) return players;
	return [...players].sort(
		(a, b) => (a.playerId === leadId ? 0 : 1) - (b.playerId === leadId ? 0 : 1),
	);
}

/** Single-row variant of {@link ownedByPlayer} — id match, nation fallback. */
export function findByPlayer<T>(
	rows: T[],
	player: Pick<ResolvedPlayer, "playerId" | "nation">,
	idOf: (row: T) => number | null | undefined,
	nationOf: (row: T) => string | null,
): T | undefined {
	return rows.find((row) => {
		const id = idOf(row);
		return id != null
			? id === player.playerId
			: nationOf(row) === player.nation;
	});
}

/**
 * One player's story rows. The story-row counterpart to {@link ownedByPlayer}
 * — same id-first shape, but the fallback is the player *name*, because a
 * `StoryEvent` carries no nation.
 *
 * The fallback only exists for blobs below PARSER_VERSION 2.14.0, and it
 * skips a player with no name: single-player saves leave `player_name` empty
 * for every player, and `"" === ""` would hand each of them every realm's
 * events. An empty name matches nothing instead — the same call the Techs
 * tab's espionage markers make, where a row carrying no usable key simply
 * yields no markers on a legacy blob. Re-importing the game fills in
 * `player_xml_id` and the join becomes exact.
 */
export function storyEventsFor(
	events: StoryEvent[],
	player: Pick<DetailPlayer, "playerId" | "player_name">,
): StoryEvent[] {
	return events.filter((e) =>
		e.player_xml_id != null
			? e.player_xml_id === player.playerId
			: player.player_name !== "" && e.player_name === player.player_name,
	);
}

/**
 * Whether an event-log row belongs to `player`. The event-log counterpart to
 * {@link storyEventsFor} — same id-first shape, except the id is a *set*: a
 * derived event-log row stands for a dedup group, and `player_xml_ids` names
 * every realm that logged it. A game-wide plague carries the whole roster and
 * so matches everyone; a drought three realms logged matches exactly those
 * three.
 *
 * The name fallback exists only for blobs below PARSER_VERSION 2.14.0, and it
 * skips a player with no name for the reason given on {@link storyEventsFor}.
 *
 * Takes the row's two fields as arguments rather than a `Pick<>` because the
 * callers hold them under different names — `EventLog.player_xml_ids` /
 * `player_name` and `Calamity.playerXmlIds` / `playerName`.
 */
export function eventLogOwnedBy(
	playerXmlIds: number[] | undefined,
	playerName: string | null,
	player: Pick<DetailPlayer, "playerId" | "player_name">,
): boolean {
	return playerXmlIds != null
		? playerXmlIds.includes(player.playerId)
		: player.player_name !== "" && playerName === player.player_name;
}

/**
 * The canonical `EVENTSTORY_*` type behind a story row's `event_type`.
 *
 * The same event reaches the save once per audience under its own prefix
 * ("P.1.EVENTSTORY_X", the family's copy, the religion's copy), so callers
 * normalize before naming or deduping an event. Returns null for a row
 * carrying no EVENTSTORY_ type.
 */
export function storyEventType(eventType: string): string | null {
	const at = eventType.indexOf("EVENTSTORY_");
	return at < 0 ? null : eventType.slice(at);
}

// ─── Rulers ──────────────────────────────────────────────────────────

/**
 * A player's rulers in reign order — the dynasty every tab that walks a
 * succession starts from: Leaders derives its reign windows, Military plots
 * its accession markers, and Orders divides cognomen legitimacy by reign
 * recency.
 */
export function dynastyLeaders(
	characters: CharacterInfo[],
	playerId: number,
): CharacterInfo[] {
	return characters
		.filter((c) => c.player_xml_id === playerId && c.became_leader_turn != null)
		.sort((a, b) => (a.became_leader_turn ?? 0) - (b.became_leader_turn ?? 0));
}

/**
 * A ruler's first name, carrying their regnal numeral when they share a name
 * with an earlier ruler (`suffix > 1`) — the first of a name carries none,
 * matching Old World. The numeral is appended after the name resolves so
 * `formatEnum`'s trailing-digit strip can't eat it (and it's Roman letters
 * anyway).
 *
 * Null for a character the save left unnamed, so each surface supplies its
 * own fallback rather than inheriting `formatEnum`'s "Unknown".
 */
export function rulerName(c: CharacterInfo): string | null {
	if (!c.first_name) return null;
	const name = characterName(c.first_name);
	return c.suffix > 1 ? `${name} ${toRomanNumeral(c.suffix)}` : name;
}

/**
 * A ruler's cognomen as the game writes it, article included ("the Wise");
 * null until they've earned one.
 */
export function rulerCognomen(c: CharacterInfo): string | null {
	return c.cognomen ? cognomenName(c.cognomen) : null;
}

/**
 * A ruler's portrait id when we ship the art, else null — what a caller gates
 * the portrait slot on. The id itself isn't that gate: a save can name a
 * portrait neither the Reference XML nor pinacotheca defines (2 of the 149
 * reigning rulers across test-data/saves/ wear one), SpriteIcon renders nothing
 * for those, and a slot gated on the id keeps its frame and its gap around an
 * image that never arrives.
 */
export function rulerPortrait(c: CharacterInfo): string | null {
	return c.portrait && getSpritePath("portraits", c.portrait)
		? c.portrait
		: null;
}

// ─── Build Comparison Panels ─────────────────────────────────────────

/** One row's subject and how many of it a side has. */
export type BuildItem = { key: string; count: number };

/**
 * Shared row order for a set of <BuildComparison> panels: the union of every
 * key on any side, in `compare` order. Passing one order into several panels
 * lines them up, so a subject absent from one draws a blank placeholder row
 * there rather than shifting the rows below it.
 *
 * Callers hand over their raw per-side rows; BuildComparison zero-fills the
 * gaps itself, so there's no need to pad each side to the full key set first.
 */
export function comparisonRowKeys(
	sides: BuildItem[][],
	compare: (a: string, b: string) => number,
): string[] {
	const keys = new Set<string>();
	for (const side of sides) {
		for (const it of side) keys.add(it.key);
	}
	return [...keys].sort(compare);
}

// ─── Pure Functions ──────────────────────────────────────────────────

/**
 * The band a value falls in, for any of the game's opinion tables — family
 * opinion of a player, a character's of their leader. Bands are ascending,
 * and `getOpinionFromRate` (InfoHelpers.cs:2302) takes the one with the
 * smallest threshold still at or above the value, so the first band the
 * value doesn't exceed wins and a value above every threshold gets the
 * open-ended last one.
 */
export function opinionBand<T extends { readonly threshold: number | null }>(
	value: number,
	bands: readonly T[],
): T {
	for (const band of bands) {
		if (band.threshold == null || value <= band.threshold) return band;
	}
	return bands[bands.length - 1];
}

export function toggleSort(table: TableState, columnKey: string): void {
	if (table.sortColumn === columnKey) {
		table.sortDirection = table.sortDirection === "asc" ? "desc" : "asc";
	} else {
		table.sortColumn = columnKey;
		table.sortDirection = "asc";
	}
}

// Nation series color with palette fallback. Aliased to the shared config
// helper so game-detail and the aggregate-stats charts color a nation
// identically.
export const getPlayerColor = getNationChartColor;

// Shared "filled trend line" styling for the game-detail time-series charts:
// a 2px line over a vertical fade of the series color (22% → transparent) with
// point symbols hidden except on hover. Every line chart on the game detail
// page spreads this so they read as one family (mirrors the Military Power
// plot). Pass the resolved series color.
export function filledLineStyle(
	color: string,
): Pick<LineSeriesOption, "showSymbol" | "lineStyle" | "areaStyle"> {
	return {
		showSymbol: false,
		lineStyle: { width: 2 },
		areaStyle: {
			color: {
				type: "linear",
				x: 0,
				y: 0,
				x2: 0,
				y2: 1,
				colorStops: [
					{ offset: 0, color: toRgba(color, 0.22) },
					{ offset: 1, color: toRgba(color, 0) },
				],
			},
		},
	};
}

// Chart selection is keyed by the resolved player label (unique per player,
// mirror-match safe) — the same string used as the ECharts series name.
export function createDefaultSelection(
	players: PlayerLike[],
): Record<string, boolean> {
	return Object.fromEntries(
		resolvePlayers(players).map((p) => [p.label, true]),
	);
}

/**
 * Deep-link a player's research order into the owtt tech-tree planner
 * (https://alcaras.github.io/owtt/): `?n=` selects the nation (the planner
 * pre-grants its starting techs) and `?o=` carries the researched techs, in
 * order, as planner-encoding ints (see `src/lib/generated/owtt.ts`).
 *
 * Turn-1 discoveries are the nation's free starting techs and are excluded;
 * techs the planner doesn't know (nation-unique DLC techs) are skipped.
 * Returns null when nothing encodes — the caller hides the link.
 */
export function buildOwttUrl(
	nation: string | null,
	discoveries: TechDiscoveryDataPoint[],
): string | null {
	const seen = new Set<string>();
	const encs: number[] = [];
	// `discoveries` is already turn-then-sequence ordered (see
	// derive/tech-discovery-history.ts); dedupe because free-tech events can
	// duplicate a normal research of the same tech.
	for (const d of discoveries) {
		if (d.tech_name == null || d.turn <= 1 || seen.has(d.tech_name)) continue;
		seen.add(d.tech_name);
		const enc = OWTT_TECH_ENC[d.tech_name];
		if (enc != null) encs.push(enc);
	}
	if (encs.length === 0) return null;
	const n = nation != null ? OWTT_NATION_INDEX[nation] : undefined;
	const nationParam = n != null ? `n=${n}&` : "";
	return `${OWTT_BASE_URL}?${nationParam}o=${encs.join(",")}`;
}

/**
 * Display name for an improvement zType: the baked IMPROVEMENT_NAMES
 * override (tiers, monasteries, shrine-of-X) with formatEnum as fallback,
 * plus a pagan shrine's domain appended: "Shrine of Nabu (Wisdom)".
 */
export function improvementDisplayName(zType: string): string {
	const named = IMPROVEMENT_NAMES[zType] ?? formatEnum(zType, "IMPROVEMENT_");
	const domain = SHRINE_TYPE[zType];
	return domain ? `${named} (${domain})` : named;
}

/**
 * Display name for a project zType: the baked PROJECT_NAMES override with
 * formatEnum as fallback. The override matters most for the tiered lines —
 * the game names them "Archive II", and formatEnum's trailing-digit strip
 * would otherwise collapse all four Archive tiers to "Archive".
 */
export function projectDisplayName(zType: string): string {
	return PROJECT_NAMES[zType] ?? formatEnum(zType, "PROJECT_");
}

/** Who a unit belongs to, named and coloured. */
export interface UnitOwner {
	/** The roster's label for a player — the nation, disambiguated by name only
	 * in a mirror — or the tribe's name. */
	label: string;
	/** NATION_* or TRIBE_*, which is what the crest sprite takes. */
	civilization: string | null;
	/** The colour the unit wears on the map and on its card. */
	color: string;
}

/**
 * Resolve a unit's owner, grouping by the PLAYER rather than by the nation: a
 * mirror match (1 of the 16 saves in `test-data/saves/` is NATION_EGYPT ×2)
 * would otherwise merge two opposing Egypts. A unit with no `player_xml_id` is
 * a tribe's — `tribe` is NOT the test, because the save writes `Tribe="NONE"`
 * and the parser keeps it as a string, so the field is non-null on every one of
 * the corpus's 1,157 player-owned military units.
 *
 * The colour follows the rule CityPopover's Units-in-Territory headings
 * established: the roster's own colour for a player, which is what tells a
 * mirror's two Egypts apart and is also what that player wears on every chart;
 * the baked civilization table for a tribe, which covers all 23; and
 * `getSeriesColor` for an owner neither answers for — a `player_xml_id` off the
 * roster, or a tribe outside the baked tables. Not the `getChartColor` ramp the
 * roster itself draws from: that one is six colours wrapped by index and
 * `resolvePlayers` hands a mirror's players those same six by ordinal, so no
 * index into it is free of a player's colour.
 *
 * `fallbackIndex` is only ever reached by that last arm, and the three callers
 * want different things from it. A LIST of owners — the city card's
 * Units-in-Territory headings — passes each group's sorted position, so two
 * unresolvable owners still read apart. A single unit — the map marker's plate
 * and the unit card's heading, which must agree with each other or a card would
 * contradict the plate that opened it — leaves it at 0. Nothing in the corpus
 * reaches it either way: all 1,411 military units resolve an owner colour.
 */
export function unitOwner(
	unit: Pick<UnitInfo, "player_xml_id" | "tribe">,
	players: DetailPlayer[],
	fallbackIndex = 0,
): UnitOwner {
	const player =
		unit.player_xml_id != null
			? players.find((p) => p.playerId === unit.player_xml_id)
			: undefined;
	const civilization = player?.nation ?? unit.tribe;
	return {
		label:
			player?.label ??
			(unit.player_xml_id != null
				? `Player ${unit.player_xml_id}`
				: formatEnum(unit.tribe, "TRIBE_")),
		civilization,
		color:
			player?.color ??
			(civilization != null ? getCivilizationColor(civilization) : undefined) ??
			getSeriesColor(fallbackIndex),
	};
}

/**
 * The crest sprite key for a tribe: the crest `tribe.xml` gives it — which is
 * what the game draws for a city the tribe holds (`City.getCrest`,
 * City.cs:3319, reads `tribeInfo().meCrest` under `isTribe()`) — through the
 * art name that crest actually ships under, with the generic tribe crest when
 * neither resolves.
 *
 * The raw `TRIBE_*` is NOT the key. It finds the same art for only 7 of the 23
 * baked tribes: 15 ship no `CREST_TRIBE_<zType>` at all and would render
 * nothing (`TRIBE_ANARCHY`'s art is `CREST_TRIBE_REBELS`, `TRIBE_BERBERS`
 * draws the Thracians'), and `TRIBE_SCYTHIANS` would render the wrong one —
 * its own file ships, but the game draws Kush's crest for it.
 */
export function tribeCrestKey(tribe: string): string {
	const crest = TRIBE_CRESTS[tribe];
	if (crest) {
		const sprite = CREST_SPRITE_NAMES[crest] ?? crest;
		if (SPRITE_MANIFEST[`crests/${sprite}`] != null) {
			return sprite.replace(/^CREST_/, "");
		}
	}
	return "TRIBE_GENERIC";
}

/** Who holds a city, named, crested and coloured. */
export interface CityOwner {
	/** The nation's name, or the tribe's. */
	label: string;
	/** NATION_* or TRIBE_*, the union `getCivilizationColor` takes. */
	civilization: string;
	/** The crest sprite key for that civilization. */
	crestKey: string;
	/** The colour the owner's name draws in. */
	color: string;
}

/**
 * Resolve who holds a city: the nation that owns it, else the TRIBE that does.
 * `unitOwner` is the same resolution for a unit, and `getCivilizationColor`
 * covers both baked colour tables, so a tribe's city reads like its units.
 *
 * A tribe-held city is not an unowned one. The game writes `<Tribe>` only
 * under `City.isTribe()` (City.cs:1263) and such a city has no player at all,
 * so the two arms are exclusive: across the 2,769 city rows in
 * `test-data/saves/`, 2,687 carry a player and no tribe, 82 a tribe and no
 * player, and none both. Of those 82, 80 are `TRIBE_ANARCHY` with a capture
 * field set — the state a capture leaves behind (`Unit.doCityCapture`,
 * Unit.cs:2004) — 1 is anarchy with the capture finished, and 1 is a real
 * tribe holding the city outright.
 *
 * Null when neither names a holder: a blob parsed before PARSER_VERSION
 * 2.26.0 carries no `tribe`, so WHO holds a player-less city there is unknown
 * rather than nobody, and each caller words that itself.
 *
 * `crestKey`'s nation arm is the nation's own crest, the key the Cities tab
 * has always passed. The hex map resolves that arm further, through the
 * runtime nation-asset aliases that let a variant nation fall back to its
 * parent civ's crest; nothing outside the map loads them, which is why
 * `SpriteMap.resolveCityCrestKey` wraps this rather than replacing it.
 */
export function cityOwner(
	nation: string | null | undefined,
	tribe: string | null | undefined,
): CityOwner | null {
	// Tribe first, the order `City.getCrest` and `City.getPrimaryPlayerColor`
	// check in — immaterial on the measured corpus, where the two never both
	// hold, and the game's answer if a save ever disagrees.
	const civilization = tribe ?? nation;
	if (civilization == null) return null;
	return {
		label: civilizationName(civilization),
		civilization,
		crestKey: tribe != null ? tribeCrestKey(tribe) : civilization,
		color: getCivilizationColor(civilization) ?? "rgb(var(--color-tan))",
	};
}

export function formatCityCell(column: CityColumn, city: CityRow): string {
	const value = column.getValue(city);
	if (column.format) {
		return column.format(value, city);
	}
	return value?.toString() ?? "—";
}

// Augment each city with its founding nation, resolved through the player_nations
// sidecar via CityInfo.first_owner_player_xml_id (the same lookup the hex map uses
// for architecture). founder_nation is null when player_nations is absent or the
// city predates first_owner_player_xml_id (pre-2.6.0 blob).
export function resolveCityRows(
	cities: CityInfo[],
	playerNations: PlayerNationEntry[],
): CityRow[] {
	const nationByPlayer = new Map<number, string | null>(
		playerNations.map((p) => [p.player_xml_id, p.nation]),
	);
	return cities.map((c) => ({
		...c,
		founder_nation:
			c.first_owner_player_xml_id != null
				? (nationByPlayer.get(c.first_owner_player_xml_id) ?? null)
				: null,
	}));
}

export function createYieldChartOption(
	allYields: YieldHistory[],
	yieldType: string,
	title: string,
	yAxisLabel: string,
	selectedNationsState: Record<string, boolean>,
	mode: YieldMode = "rate",
	// Compact variant: drop the chart title and the "Turn"/y-axis-name titles,
	// and use the tight, containLabel grid of the game-detail time-series plots
	// (the Military-Power look). The Techs tab opts in: its view toggle sits above
	// the plot and already names it, so the Cumulative/Per-Turn science views drop
	// the redundant in-canvas title and match the "Techs over Time" view they
	// toggle against — and the science rail reads under all three the same way.
	// The Yields tab leaves it off and keeps the title and labelled axes.
	compact = false,
): ChartOption | null {
	if (allYields.length === 0) return null;

	const yieldData = allYields.filter((y) => y.yield_type === yieldType);
	if (yieldData.length === 0) return null;

	// Resolve per-player labels/colors so same-nation players get distinct,
	// unique series names (ECharts dedupes series that share a name).
	const resolved = resolvePlayers(yieldData);
	const byId = new Map(resolved.map((p) => [p.playerId, p]));

	// Title and axis name the same quantity: "Total" only when the series is
	// the game's own total, "Cumulative" for our running sum.
	const cumulativePrefix = cumulativeIsGameTotal(yieldData, yieldType)
		? "Total"
		: "Cumulative";
	const fullTitle =
		mode === "rate" ? `${title} per Turn` : `${cumulativePrefix} ${title}`;
	const fullYAxisLabel =
		mode === "rate"
			? `${yAxisLabel} per Turn`
			: `${cumulativePrefix} ${yAxisLabel}`;

	// Value x-axis with a small pad so the area fill doesn't clip at the edges.
	const turns = yieldData[0]?.data.map((d: YieldDataPoint) => d.turn) ?? [];
	const minTurn = turns[0] ?? 0;
	const maxTurn = turns[turns.length - 1] ?? 0;
	const pad = Math.max(1, (maxTurn - minTurn) * 0.02);

	return {
		...CHART_THEME,
		// Compact drops the chart title outright (the toggle above the plot names
		// it); non-compact keeps the derived "Total X" / "Cumulative X" /
		// "X per Turn" title.
		title: compact
			? { show: false }
			: { ...CHART_THEME.title, text: fullTitle },
		legend: {
			show: false,
			data: resolved.map((p) => p.label),
			selected: selectedNationsState,
		},
		grid: compact
			? { top: 44, left: 8, right: 20, bottom: 24, containLabel: true }
			: { left: 60, right: 40, top: 80, bottom: 60 },
		xAxis: {
			type: "value",
			name: compact ? undefined : "Turn",
			nameLocation: "middle",
			nameGap: 30,
			min: minTurn - pad,
			max: maxTurn + pad,
			minInterval: 1,
			splitLine: { show: false },
		},
		yAxis: {
			type: "value",
			name: compact ? undefined : fullYAxisLabel,
			nameLocation: "middle",
			nameGap: 40,
			axisLine: { onZero: false },
		},
		series: yieldData.map((playerYield, i) => {
			const rp = byId.get(playerYield.player_id);
			const color = rp?.color ?? getPlayerColor(playerYield.nation, i);
			return {
				name: rp?.label ?? nationName(playerYield.nation),
				type: "line",
				data: playerYield.data.map((d: YieldDataPoint) => [
					d.turn,
					mode === "rate" ? d.rate : d.cumulative,
				]),
				itemStyle: { color },
				...filledLineStyle(color),
			};
		}),
	};
}

/**
 * Legitimacy over time, one line per player — the counterpart to
 * {@link createYieldChartOption} for the series that isn't a yield.
 * Rendered by the Leaders tab (where the dynasty explains its shape) and by
 * the Orders tab (where it drives orders through ORDERS_PER_LEGITIMACY), so
 * both draw the same plot from one definition.
 *
 * `players` supplies the resolved label/color; a row without a match falls
 * back to its nation, as the yield builder does.
 */
export function createLegitimacyChartOption(
	playerHistory: PlayerHistory[],
	players: DetailPlayer[],
	selectedPlayersState: Record<string, boolean>,
): ChartOption | null {
	if (playerHistory.length === 0) return null;

	const byId = new Map(players.map((p) => [p.playerId, p]));
	const labelOf = (row: PlayerHistory): string =>
		byId.get(row.player_id)?.label ?? nationName(row.nation);

	// Value x-axis with a small pad so the area fill doesn't clip at the edges.
	const turns = playerHistory[0]?.history.map((h) => h.turn) ?? [];
	const minTurn = turns[0] ?? 0;
	const maxTurn = turns[turns.length - 1] ?? 0;
	const pad = Math.max(1, (maxTurn - minTurn) * 0.02);

	return {
		...CHART_THEME,
		title: { ...CHART_THEME.title, text: "Legitimacy" },
		legend: {
			show: false,
			data: playerHistory.map(labelOf),
			selected: selectedPlayersState,
		},
		grid: { left: 60, right: 40, top: 80, bottom: 60 },
		xAxis: {
			type: "value",
			name: "Turn",
			nameLocation: "middle",
			nameGap: 30,
			min: minTurn - pad,
			max: maxTurn + pad,
			minInterval: 1,
			splitLine: { show: false },
		},
		yAxis: {
			type: "value",
			name: "Legitimacy",
			nameLocation: "middle",
			nameGap: 40,
			axisLine: { onZero: false },
		},
		series: playerHistory.map((row, i) => {
			const color =
				byId.get(row.player_id)?.color ?? getPlayerColor(row.nation, i);
			return {
				name: labelOf(row),
				type: "line",
				data: row.history.map((h) => [h.turn, h.legitimacy]),
				itemStyle: { color },
				...filledLineStyle(color),
			};
		}),
	};
}
