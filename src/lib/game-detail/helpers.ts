import type { CityInfo } from "$lib/types/CityInfo";
import type { YieldHistory } from "$lib/types/YieldHistory";
import type { YieldDataPoint } from "$lib/types/YieldDataPoint";
import type { PlayerInfo } from "$lib/types/PlayerInfo";
import type { EChartsOption } from "echarts";
import { formatEnum } from "$lib/utils/formatting";
import { CHART_THEME, getChartColor, getNationChartColor } from "$lib/config";
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
	// When set, the cell prefixes a SpriteIcon resolved from the raw getValue()
	// enum (e.g. "crests" for NATION_*/FAMILY_*, "culture" for CULTURE_*).
	iconCategory?: SpriteCategory;
	// Overrides the icon's enum value (defaults to getValue()). Used by Family
	// to fall back from the per-family crest to the archetype crest. Returning
	// null renders no icon.
	iconValue?: (city: CityInfo) => string | null;
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

// ─── Shared data-table styling (game-detail data tabs) ───────────────
// Visual tokens matching the player games table: a dark blue-gray frame
// holding #2a2622 rounded card rows under a #241f1b toolbar-style header
// bar. Round the first/last cell of each row inline with
// `rounded-l-lg border-l` / `rounded-r-lg border-r`.
export const TABLE_FRAME_CLASS = "flex gap-4 rounded-lg bg-blue-gray p-3";
export const TABLE_CLASS = "w-full border-separate border-spacing-y-1.5";
export const TABLE_HEADER_TH_CLASS =
	"sticky -top-4 z-10 cursor-pointer select-none whitespace-nowrap border-y border-[#2a2622] bg-[#241f1b] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-100 shadow-lg transition-colors hover:text-orange";
export const TABLE_CELL_TD_CLASS =
	"bg-[#2a2622] p-3 text-left text-tan transition-colors duration-200 group-hover:bg-[#3e362f]";

// Column order: Nation, Name, Family, Founded, Culture, Specialists, Growth, Population, Tiles Bought
// Default visible: Nation, Name, Family, Founded, Culture
export const CITY_COLUMNS: CityColumn[] = [
	{
		key: "owner_nation",
		label: "Nation",
		defaultVisible: true,
		getValue: (c) => c.owner_nation,
		format: (v) => formatEnum(v as string | null, "NATION_"),
		iconCategory: "crests",
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
		iconCategory: "crests",
		// Per-family crest art ships for only a few families; fall back to the
		// always-available archetype crest derived from family_class.
		iconValue: (c) =>
			c.family && getSpritePath("crests", c.family)
				? c.family
				: c.family_class
					? c.family_class.replace("FAMILYCLASS_", "ARCHETYPE_")
					: null,
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
	playerId: number;
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
		const base = formatEnum(nation, "NATION_");
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

// Chart selection is keyed by the resolved player label (unique per player,
// mirror-match safe) — the same string used as the ECharts series name.
export function createDefaultSelection(
	players: PlayerLike[],
): Record<string, boolean> {
	return Object.fromEntries(
		resolvePlayers(players).map((p) => [p.label, true]),
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

	// Resolve per-player labels/colors so same-nation players get distinct,
	// unique series names (ECharts dedupes series that share a name).
	const resolved = resolvePlayers(yieldData);
	const byId = new Map(resolved.map((p) => [p.playerId, p]));

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
			data: resolved.map((p) => p.label),
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
		series: yieldData.map((playerYield, i) => {
			const rp = byId.get(playerYield.player_id);
			return {
				name: rp?.label ?? formatEnum(playerYield.nation, "NATION_"),
				type: "line",
				data: playerYield.data.map((d: YieldDataPoint) =>
					mode === "rate" ? d.rate : d.cumulative,
				),
				itemStyle: {
					color: rp?.color ?? getPlayerColor(playerYield.nation, i),
				},
			};
		}),
	};
}
