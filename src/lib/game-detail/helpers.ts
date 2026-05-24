import type { CityInfo } from "$lib/types/CityInfo";
import type { YieldHistory } from "$lib/types/YieldHistory";
import type { YieldDataPoint } from "$lib/types/YieldDataPoint";
import type { EChartsOption } from "echarts";
import { formatEnum } from "$lib/utils/formatting";
import { CHART_THEME, getNationChartColor } from "$lib/config";
import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";

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
	| "cities"
	| "improvements"
	| "laws"
	| "techs"
	| "units";

// format function receives the value AND the city object for context (e.g., capital star)
export type CityColumn = {
	key: string;
	label: string;
	defaultVisible: boolean;
	getValue: (city: CityInfo) => string | number | boolean | null;
	format?: (value: string | number | boolean | null, city: CityInfo) => string;
	sortValue?: (city: CityInfo) => string | number;
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

// Column order: Nation, Name, Family, Founded, Culture, Specialists, Growth, Population, Tiles Bought
// Default visible: Nation, Name, Family, Founded, Culture
export const CITY_COLUMNS: CityColumn[] = [
	{
		key: "owner_nation",
		label: "Nation",
		defaultVisible: true,
		getValue: (c) => c.owner_nation,
		format: (v) => formatEnum(v as string | null, "NATION_"),
	},
	{
		key: "city_name",
		label: "Name",
		defaultVisible: true,
		getValue: (c) => c.city_name,
		format: (v, city) => {
			const name = formatEnum(v as string, "CITYNAME_");
			return city.is_capital ? `${name} ★` : name;
		},
	},
	{
		key: "family",
		label: "Family",
		defaultVisible: true,
		getValue: (c) => c.family,
		format: (v) => formatEnum(v as string | null, "FAMILY_"),
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
		format: (v) => (v ? formatEnum(v as string, "NAME_") : "—"),
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
		laws: {
			search: "",
			sortColumn: "nation",
			sortDirection: "asc",
			filters: [],
		},
		techs: {
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
	| "icons"
	| "units";

// Known tech name corrections (game data typos or alternate names)
const TECH_SPRITE_FIXES: Record<string, string> = {
	TECH_SOVEREIGNITY: "TECH_SOVEREIGNTY",
};

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
	// Fallback: try unit sprite (TECH_HASTATUS -> UNIT_HASTATUS)
	const unitName = tech.replace(/^TECH_/, "UNIT_");
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
): string | null {
	if (category === "crests") {
		return SPRITE_MANIFEST[`crests/CREST_${enumValue}`] ?? null;
	}
	if (category === "techs") {
		const resolved = resolveTechSprite(enumValue);
		if (resolved == null) return null;
		return SPRITE_MANIFEST[`${resolved.category}/${resolved.filename}`] ?? null;
	}
	return SPRITE_MANIFEST[`${category}/${enumValue}`] ?? null;
}

// ─── Unit Classification ────────────────────────────────────────────

const RANGED_KEYWORDS = [
	"ARCHER",
	"BOWMAN",
	"CROSSBOW",
	"SLINGER",
	"SKIRMISHER",
	"JAVELINEER",
	"CLUB_THROWER",
];
const CAVALRY_KEYWORDS = [
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
const NAVAL_KEYWORDS = [
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

export type UnitClass = "Infantry" | "Ranged" | "Cavalry" | "Siege" | "Naval";

export function classifyUnit(unitType: string): UnitClass | null {
	const upper = unitType.toUpperCase();
	if (SUPPORT_KEYWORDS.some((k) => upper.includes(k))) return null;
	if (NAVAL_KEYWORDS.some((k) => upper.includes(k))) return "Naval";
	if (SIEGE_KEYWORDS.some((k) => upper.includes(k))) return "Siege";
	if (CAVALRY_KEYWORDS.some((k) => upper.includes(k))) return "Cavalry";
	if (RANGED_KEYWORDS.some((k) => upper.includes(k))) return "Ranged";
	return "Infantry";
}

export const UNIT_CLASS_COLORS: Record<UnitClass, string> = {
	Infantry: "#C87941",
	Ranged: "#B8860B",
	Cavalry: "#CD853F",
	Siege: "#A0522D",
	Naval: "#8B4513",
};

// ─── Timeline Types ─────────────────────────────────────────────────

export type TimelineCategory =
	| "tech"
	| "law"
	| "city"
	| "religion"
	| "wonder"
	| "battle";

export type TimelineEvent = {
	turn: number;
	nation: string | null;
	playerName: string;
	category: TimelineCategory;
	label: string;
	enumValue: string;
	spriteCategory: SpriteCategory | null;
};

// ─── Overview Types ─────────────────────────────────────────────────

export type PlayerSummary = {
	playerName: string;
	nation: string | null;
	isHuman: boolean;
	isSaveOwner: boolean;
	isWinner: boolean;
	finalVP: number | null;
	finalMilitary: number | null;
	cityCount: number;
	techCount: number;
	lawCount: number;
	unitsTotal: number;
	religion: string | null;
};

// ─── Pure Functions ──────────────────────────────────────────────────

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

export function createDefaultSelection(
	players: { nation: string | null }[],
): Record<string, boolean> {
	return Object.fromEntries(
		players.map((player) => [formatEnum(player.nation, "NATION_"), true]),
	);
}

export function formatCityCell(column: CityColumn, city: CityInfo): string {
	const value = column.getValue(city);
	if (column.format) {
		return column.format(value, city);
	}
	return value?.toString() ?? "—";
}

export function createYieldChartOption(
	allYields: YieldHistory[],
	yieldType: string,
	title: string,
	yAxisLabel: string,
	selectedNationsState: Record<string, boolean>,
	mode: YieldMode = "rate",
): EChartsOption | null {
	if (allYields.length === 0) return null;

	const yieldData = allYields.filter((y) => y.yield_type === yieldType);
	if (yieldData.length === 0) return null;

	const fullTitle =
		mode === "rate" ? `${title} per Turn` : `Cumulative ${title}`;
	const fullYAxisLabel =
		mode === "rate" ? `${yAxisLabel} per Turn` : `Total ${yAxisLabel}`;

	return {
		...CHART_THEME,
		title: {
			...CHART_THEME.title,
			text: fullTitle,
		},
		legend: {
			show: false,
			data: yieldData.map((y) => formatEnum(y.nation, "NATION_")),
			selected: selectedNationsState,
		},
		grid: {
			left: 60,
			right: 40,
			top: 80,
			bottom: 60,
		},
		xAxis: {
			type: "category",
			name: "Turn",
			nameLocation: "middle",
			nameGap: 30,
			data: yieldData[0]?.data.map((d: YieldDataPoint) => d.turn) ?? [],
		},
		yAxis: {
			type: "value",
			name: fullYAxisLabel,
			nameLocation: "middle",
			nameGap: 40,
		},
		series: yieldData.map((playerYield, i) => ({
			name: formatEnum(playerYield.nation, "NATION_"),
			type: "line",
			data: playerYield.data.map((d: YieldDataPoint) =>
				mode === "rate" ? d.rate : d.cumulative,
			),
			itemStyle: { color: getPlayerColor(playerYield.nation, i) },
		})),
	};
}
