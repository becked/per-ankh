import type { CityInfo } from "$lib/types/CityInfo";
import type { YieldHistory } from "$lib/types/YieldHistory";
import type { YieldDataPoint } from "$lib/types/YieldDataPoint";
import type { EChartsOption } from "echarts";
import {
	formatEnum,
} from "$lib/utils/formatting";
import {
	CHART_THEME,
	getChartColor,
	getCivilizationColor,
} from "$lib/config";

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
	format?: (
		value: string | number | boolean | null,
		city: CityInfo,
	) => string;
	sortValue?: (city: CityInfo) => string | number;
};

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
	{ yieldType: "YIELD_SCIENCE", title: "Science Production", yAxisLabel: "Science per Turn", filterKey: "science" },
	{ yieldType: "YIELD_CIVICS", title: "Civics Production", yAxisLabel: "Civics per Turn", filterKey: "civics" },
	{ yieldType: "YIELD_TRAINING", title: "Training Production", yAxisLabel: "Training per Turn", filterKey: "training" },
	{ yieldType: "YIELD_GROWTH", title: "Growth Production", yAxisLabel: "Growth per Turn", filterKey: "growth" },
	{ yieldType: "YIELD_CULTURE", title: "Culture Production", yAxisLabel: "Culture per Turn", filterKey: "culture" },
	{ yieldType: "YIELD_HAPPINESS", title: "Happiness Production", yAxisLabel: "Happiness per Turn", filterKey: "happiness" },
	{ yieldType: "YIELD_ORDERS", title: "Orders", yAxisLabel: "Orders per Turn", filterKey: "orders" },
	{ yieldType: "YIELD_FOOD", title: "Food Production", yAxisLabel: "Food per Turn", filterKey: "food" },
	{ yieldType: "YIELD_MONEY", title: "Money Income", yAxisLabel: "Gold per Turn", filterKey: "money" },
	{ yieldType: "YIELD_DISCONTENT", title: "Discontent", yAxisLabel: "Discontent per Turn", filterKey: "discontent" },
	{ yieldType: "YIELD_IRON", title: "Iron Production", yAxisLabel: "Iron per Turn", filterKey: "iron" },
	{ yieldType: "YIELD_STONE", title: "Stone Production", yAxisLabel: "Stone per Turn", filterKey: "stone" },
	{ yieldType: "YIELD_WOOD", title: "Wood Production", yAxisLabel: "Wood per Turn", filterKey: "wood" },
	{ yieldType: "YIELD_MAINTENANCE", title: "Maintenance Costs", yAxisLabel: "Maintenance per Turn", filterKey: "maintenance" },
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

export function createDefaultChartFilters(): Record<ChartFilterKey, Record<string, boolean>> {
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

// ─── Pure Functions ──────────────────────────────────────────────────

export function toggleSort(table: TableState, columnKey: string): void {
	if (table.sortColumn === columnKey) {
		table.sortDirection = table.sortDirection === "asc" ? "desc" : "asc";
	} else {
		table.sortColumn = columnKey;
		table.sortDirection = "asc";
	}
}

export function getPlayerColor(
	nation: string | null | undefined,
	fallbackIndex: number,
): string {
	if (nation) {
		// Strip "NATION_" prefix if present (database stores as "NATION_CARTHAGE" but color map expects "CARTHAGE")
		const cleanNation = nation.replace(/^NATION_/, "");
		const nationColor = getCivilizationColor(cleanNation);
		if (nationColor) return nationColor;
	}
	return getChartColor(fallbackIndex);
}

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
): EChartsOption | null {
	if (allYields.length === 0) return null;

	const yieldData = allYields.filter((y) => y.yield_type === yieldType);
	if (yieldData.length === 0) return null;

	return {
		...CHART_THEME,
		title: {
			...CHART_THEME.title,
			text: title,
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
			name: yAxisLabel,
			nameLocation: "middle",
			nameGap: 40,
		},
		series: yieldData.map((playerYield, i) => ({
			name: formatEnum(playerYield.nation, "NATION_"),
			type: "line",
			data: playerYield.data.map((d: YieldDataPoint) => d.amount),
			itemStyle: { color: getPlayerColor(playerYield.nation, i) },
		})),
	};
}
