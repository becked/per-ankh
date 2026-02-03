<script lang="ts">
  import { page } from "$app/stores";
  import { api } from "$lib/api";
  import type { GameDetails } from "$lib/types/GameDetails";
  import type { PlayerHistory } from "$lib/types/PlayerHistory";
  import type { YieldHistory } from "$lib/types/YieldHistory";
  import type { YieldDataPoint } from "$lib/types/YieldDataPoint";
  import type { EventLog } from "$lib/types/EventLog";
  import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
  import type { PlayerLaw } from "$lib/types/PlayerLaw";
  import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
  import type { PlayerTech } from "$lib/types/PlayerTech";
  import type { PlayerUnitProduced } from "$lib/types/PlayerUnitProduced";
  import type { CityStatistics } from "$lib/types/CityStatistics";
  import type { CityInfo } from "$lib/types/CityInfo";
  import type { ImprovementData } from "$lib/types/ImprovementData";
  import type { MapTile } from "$lib/types/MapTile";
  import type { EChartsOption } from "echarts";
  import HexMap from "$lib/HexMap.svelte";
  import ChartContainer from "$lib/ChartContainer.svelte";
  import SearchInput from "$lib/SearchInput.svelte";
  import { Tabs, Select } from "bits-ui";
  import { formatEnum, formatDate, formatGameTitle, formatMapClass, stripMarkup } from "$lib/utils/formatting";
  import { CHART_THEME, getChartColor, getCivilizationColor } from "$lib/config";
  import GamePageSkeleton from "$lib/GamePageSkeleton.svelte";

  let gameDetails = $state<GameDetails | null>(null);
  let playerHistory = $state<PlayerHistory[] | null>(null);
  let allYields = $state<YieldHistory[] | null>(null);
  let eventLogs = $state<EventLog[] | null>(null);
  let lawAdoptionHistory = $state<LawAdoptionHistory[] | null>(null);
  let currentLaws = $state<PlayerLaw[] | null>(null);
  let techDiscoveryHistory = $state<TechDiscoveryHistory[] | null>(null);
  let completedTechs = $state<PlayerTech[] | null>(null);
  let unitsProduced = $state<PlayerUnitProduced[] | null>(null);
  let cityStatistics = $state<CityStatistics | null>(null);
  let improvementData = $state<ImprovementData | null>(null);
  let mapTiles = $state<MapTile[] | null>(null);
  let selectedMapTurn = $state<number | null>(null);
  let mapTilesLoading = $state(false);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let activeTab = $state<string>("events");

  // Chart series filter state - each chart has its own independent filter
  type ChartFilterKey =
    | "points" | "military" | "legitimacy"
    | "science" | "civics" | "training" | "growth" | "culture"
    | "happiness" | "orders" | "food" | "money" | "discontent"
    | "iron" | "stone" | "wood" | "maintenance"
    | "laws" | "techs";

  let chartFilters = $state<Record<ChartFilterKey, Record<string, boolean>>>({
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
  });

  // Table state - consolidated for all sortable/filterable tables
  type TableState = {
    search: string;
    sortColumn: string;
    sortDirection: "asc" | "desc";
    filters: string[];
  };

  type TableName = "events" | "cities" | "improvements" | "laws" | "techs" | "units";

  let tables = $state<Record<TableName, TableState>>({
    events: { search: "", sortColumn: "turn", sortDirection: "desc", filters: [] },
    cities: { search: "", sortColumn: "owner_nation", sortDirection: "asc", filters: [] },
    improvements: { search: "", sortColumn: "improvement", sortDirection: "asc", filters: [] },
    laws: { search: "", sortColumn: "nation", sortDirection: "asc", filters: [] },
    techs: { search: "", sortColumn: "nation", sortDirection: "asc", filters: [] },
    units: { search: "", sortColumn: "nation", sortDirection: "asc", filters: [] },
  });

  // Generic toggle sort function for all tables
  function toggleSort(tableName: TableName, columnKey: string) {
    const table = tables[tableName];
    if (table.sortColumn === columnKey) {
      table.sortDirection = table.sortDirection === "asc" ? "desc" : "asc";
    } else {
      table.sortColumn = columnKey;
      table.sortDirection = "asc";
    }
  }

  // City column definitions
  // format function receives the value AND the city object for context (e.g., capital star)
  type CityColumn = {
    key: string;
    label: string;
    defaultVisible: boolean;
    getValue: (city: CityInfo) => string | number | boolean | null;
    format?: (value: string | number | boolean | null, city: CityInfo) => string;
    sortValue?: (city: CityInfo) => string | number;
  };

  // Column order: Nation, Name, Family, Founded, Culture, Specialists, Growth, Population, Tiles Bought
  // Default visible: Nation, Name, Family, Founded, Culture
  const CITY_COLUMNS: CityColumn[] = [
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
      format: (v) => v ? formatEnum(v as string, "NAME_") : "—",
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

  // Initialize visible columns from defaults
  let cityVisibleColumns = $state<Record<string, boolean>>(
    Object.fromEntries(CITY_COLUMNS.map((col) => [col.key, col.defaultVisible]))
  );

  // Get visible columns in order
  const visibleCityColumns = $derived(
    CITY_COLUMNS.filter((col) => cityVisibleColumns[col.key])
  );

  // Convert visibility Record to array of selected keys for Select component
  const selectedColumnKeys = $derived(
    Object.entries(cityVisibleColumns)
      .filter(([, visible]) => visible)
      .map(([key]) => key)
  );

  // Handle column visibility change from Select
  function handleColumnVisibilityChange(keys: string[]) {
    for (const col of CITY_COLUMNS) {
      cityVisibleColumns[col.key] = keys.includes(col.key);
    }
  }

  // Get unique nations for city filter dropdown
  const uniqueCityNations = $derived(
    cityStatistics
      ? [...new Set(cityStatistics.cities.map(city => city.owner_nation).filter((n): n is string => n != null))].sort()
      : []
  );

  // Parse selected city filters (nation only)
  const selectedCityNations = $derived(
    tables.cities.filters
      .filter(f => f.startsWith("nation:"))
      .map(f => f.replace("nation:", ""))
  );

  // Filtered and sorted cities
  const filteredSortedCities = $derived(() => {
    if (!cityStatistics) return [];

    let cities = cityStatistics.cities;

    // Filter by selected nations
    if (selectedCityNations.length > 0) {
      cities = cities.filter((city) => city.owner_nation && selectedCityNations.includes(city.owner_nation));
    }

    // Filter by search term
    if (tables.cities.search) {
      const term = tables.cities.search.toLowerCase();
      cities = cities.filter((city) =>
        city.city_name.toLowerCase().includes(term) ||
        (city.owner_nation?.toLowerCase().includes(term) ?? false) ||
        (city.family?.toLowerCase().includes(term) ?? false) ||
        (city.governor_name?.toLowerCase().includes(term) ?? false)
      );
    }

    // Sort
    const column = CITY_COLUMNS.find((col) => col.key === tables.cities.sortColumn);
    if (column) {
      cities = [...cities].sort((a, b) => {
        const aVal = column.sortValue ? column.sortValue(a) : column.getValue(a);
        const bVal = column.sortValue ? column.sortValue(b) : column.getValue(b);

        // Handle nulls - sort them to the end
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        // Compare values
        let cmp: number;
        if (typeof aVal === "string" && typeof bVal === "string") {
          cmp = aVal.localeCompare(bVal);
        } else {
          cmp = (aVal as number) - (bVal as number);
        }

        return tables.cities.sortDirection === "asc" ? cmp : -cmp;
      });
    }

    return cities;
  });

  // Format cell value using column's format function or default
  function formatCityCell(column: CityColumn, city: CityInfo): string {
    const value = column.getValue(city);
    if (column.format) {
      return column.format(value, city);
    }
    return value?.toString() ?? "—";
  }

  // Get unique nations for improvement filter dropdown
  const uniqueImprovementNations = $derived(
    improvementData
      ? [...new Set(improvementData.improvements.map(imp => imp.nation).filter((n): n is string => n != null))].sort()
      : []
  );

  // Parse selected improvement filters (nation only)
  const selectedImprovementNations = $derived(
    tables.improvements.filters
      .filter(f => f.startsWith("nation:"))
      .map(f => f.replace("nation:", ""))
  );

  // Nations to display as columns (filtered or all)
  const displayedImprovementNations = $derived(
    selectedImprovementNations.length > 0 ? selectedImprovementNations : uniqueImprovementNations
  );

  // Pivot table data: rows are improvement names, columns are nations
  type ImprovementPivotRow = {
    improvement: string;
    counts: Record<string, number>;  // nation -> count
    total: number;
  };

  const improvementPivotData = $derived(() => {
    if (!improvementData || improvementData.improvements.length === 0) return [];

    // Build a map of improvement -> nation -> count
    const pivotMap = new Map<string, Record<string, number>>();

    for (const imp of improvementData.improvements) {
      if (!imp.nation) continue;

      if (!pivotMap.has(imp.improvement)) {
        pivotMap.set(imp.improvement, {});
      }
      const counts = pivotMap.get(imp.improvement)!;
      counts[imp.nation] = (counts[imp.nation] ?? 0) + 1;
    }

    // Convert to array of rows
    const rows: ImprovementPivotRow[] = [];
    for (const [improvement, counts] of pivotMap) {
      // Filter by search term
      if (tables.improvements.search) {
        const term = tables.improvements.search.toLowerCase();
        if (!improvement.toLowerCase().includes(term)) {
          continue;
        }
      }

      // Calculate total across all nations
      const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
      rows.push({ improvement, counts, total });
    }

    // Sort
    rows.sort((a, b) => {
      if (tables.improvements.sortColumn === "improvement") {
        const cmp = a.improvement.localeCompare(b.improvement);
        return tables.improvements.sortDirection === "asc" ? cmp : -cmp;
      } else if (tables.improvements.sortColumn === "total") {
        const cmp = a.total - b.total;
        return tables.improvements.sortDirection === "asc" ? cmp : -cmp;
      } else if (tables.improvements.sortColumn.startsWith("nation:")) {
        const nation = tables.improvements.sortColumn.replace("nation:", "");
        const aVal = a.counts[nation] ?? 0;
        const bVal = b.counts[nation] ?? 0;
        const cmp = aVal - bVal;
        return tables.improvements.sortDirection === "asc" ? cmp : -cmp;
      }
      return a.improvement.localeCompare(b.improvement);
    });

    return rows;
  });

  // Get unique nations for law filter dropdown
  const uniqueLawNations = $derived(
    currentLaws
      ? [...new Set(currentLaws.map(law => law.nation).filter((n): n is string => n != null))].sort()
      : []
  );

  // Get unique law names (for rows)
  const uniqueLawNames = $derived(
    currentLaws
      ? [...new Set(currentLaws.map(law => law.law))].sort()
      : []
  );

  // Parse selected law filters (nation only now)
  const selectedLawNations = $derived(
    tables.laws.filters
      .filter(f => f.startsWith("nation:"))
      .map(f => f.replace("nation:", ""))
  );

  // Nations to display as columns (filtered or all)
  const displayedLawNations = $derived(
    selectedLawNations.length > 0 ? selectedLawNations : uniqueLawNations
  );

  // Pivot table data: rows are law names, columns are nations
  type LawPivotRow = {
    law: string;
    turns: Record<string, number | null>;  // nation -> adopted_turn
  };

  const lawPivotData = $derived(() => {
    if (!currentLaws || currentLaws.length === 0) return [];

    // Build a map of law -> nation -> adopted_turn
    const pivotMap = new Map<string, Record<string, number | null>>();

    for (const l of currentLaws) {
      if (!l.nation) continue;

      if (!pivotMap.has(l.law)) {
        pivotMap.set(l.law, {});
      }
      const turns = pivotMap.get(l.law)!;
      turns[l.nation] = l.adopted_turn;
    }

    // Convert to array of rows
    const rows: LawPivotRow[] = [];
    for (const [law, turns] of pivotMap) {
      // Filter by search term
      if (tables.laws.search) {
        const term = tables.laws.search.toLowerCase();
        if (!law.toLowerCase().includes(term)) {
          continue;
        }
      }

      rows.push({ law, turns });
    }

    // Sort by law name or by sort column
    rows.sort((a, b) => {
      if (tables.laws.sortColumn === "law") {
        const cmp = a.law.localeCompare(b.law);
        return tables.laws.sortDirection === "asc" ? cmp : -cmp;
      } else if (tables.laws.sortColumn.startsWith("nation:")) {
        const nation = tables.laws.sortColumn.replace("nation:", "");
        const aVal = a.turns[nation] ?? Infinity;
        const bVal = b.turns[nation] ?? Infinity;
        const cmp = aVal - bVal;
        return tables.laws.sortDirection === "asc" ? cmp : -cmp;
      }
      return a.law.localeCompare(b.law);
    });

    return rows;
  });

  // Get unique nations for tech filter dropdown
  const uniqueTechNations = $derived(
    completedTechs
      ? [...new Set(completedTechs.map(tech => tech.nation).filter((n): n is string => n != null))].sort()
      : []
  );

  // Get unique tech names (for rows)
  const uniqueTechNames = $derived(
    completedTechs
      ? [...new Set(completedTechs.map(tech => tech.tech))].sort()
      : []
  );

  // Parse selected tech filters (nation only now)
  const selectedTechNations = $derived(
    tables.techs.filters
      .filter(f => f.startsWith("nation:"))
      .map(f => f.replace("nation:", ""))
  );

  // Nations to display as columns (filtered or all)
  const displayedTechNations = $derived(
    selectedTechNations.length > 0 ? selectedTechNations : uniqueTechNations
  );

  // Pivot table data: rows are tech names, columns are nations
  type TechPivotRow = {
    tech: string;
    turns: Record<string, number | null>;  // nation -> completed_turn
  };

  const techPivotData = $derived(() => {
    if (!completedTechs || completedTechs.length === 0) return [];

    // Build a map of tech -> nation -> completed_turn
    const pivotMap = new Map<string, Record<string, number | null>>();

    for (const t of completedTechs) {
      if (!t.nation) continue;

      if (!pivotMap.has(t.tech)) {
        pivotMap.set(t.tech, {});
      }
      const turns = pivotMap.get(t.tech)!;
      turns[t.nation] = t.completed_turn;
    }

    // Convert to array of rows
    const rows: TechPivotRow[] = [];
    for (const [tech, turns] of pivotMap) {
      // Filter by search term
      if (tables.techs.search) {
        const term = tables.techs.search.toLowerCase();
        if (!tech.toLowerCase().includes(term)) {
          continue;
        }
      }

      rows.push({ tech, turns });
    }

    // Sort by tech name or by sort column
    rows.sort((a, b) => {
      if (tables.techs.sortColumn === "tech") {
        const cmp = a.tech.localeCompare(b.tech);
        return tables.techs.sortDirection === "asc" ? cmp : -cmp;
      } else if (tables.techs.sortColumn.startsWith("nation:")) {
        const nation = tables.techs.sortColumn.replace("nation:", "");
        const aVal = a.turns[nation] ?? Infinity;
        const bVal = b.turns[nation] ?? Infinity;
        const cmp = aVal - bVal;
        return tables.techs.sortDirection === "asc" ? cmp : -cmp;
      }
      return a.tech.localeCompare(b.tech);
    });

    return rows;
  });

  // Get unique nations for unit filter dropdown
  const uniqueUnitNations = $derived(
    unitsProduced
      ? [...new Set(unitsProduced.map(u => u.nation).filter((n): n is string => n != null))].sort()
      : []
  );

  // Get unique unit types (for rows)
  const uniqueUnitTypes = $derived(
    unitsProduced
      ? [...new Set(unitsProduced.map(u => u.unit_type))].sort()
      : []
  );

  // Parse selected unit filters (nation only now)
  const selectedUnitNations = $derived(
    tables.units.filters
      .filter(f => f.startsWith("nation:"))
      .map(f => f.replace("nation:", ""))
  );

  // Nations to display as columns (filtered or all)
  const displayedUnitNations = $derived(
    selectedUnitNations.length > 0 ? selectedUnitNations : uniqueUnitNations
  );

  // Pivot table data: rows are unit types, columns are nations
  type UnitPivotRow = {
    unit_type: string;
    counts: Record<string, number>;  // nation -> count
    total: number;
  };

  const unitPivotData = $derived(() => {
    if (!unitsProduced || unitsProduced.length === 0) return [];

    // Build a map of unit_type -> nation -> count
    const pivotMap = new Map<string, Record<string, number>>();

    for (const u of unitsProduced) {
      if (!u.nation) continue;

      if (!pivotMap.has(u.unit_type)) {
        pivotMap.set(u.unit_type, {});
      }
      const counts = pivotMap.get(u.unit_type)!;
      counts[u.nation] = (counts[u.nation] ?? 0) + u.count;
    }

    // Convert to array of rows
    const rows: UnitPivotRow[] = [];
    for (const [unit_type, counts] of pivotMap) {
      // Filter by search term
      if (tables.units.search) {
        const term = tables.units.search.toLowerCase();
        if (!unit_type.toLowerCase().includes(term)) {
          continue;
        }
      }

      // Calculate total across displayed nations
      const total = displayedUnitNations.reduce((sum, nation) => sum + (counts[nation] ?? 0), 0);

      rows.push({ unit_type, counts, total });
    }

    // Sort by unit type name or by sort column
    rows.sort((a, b) => {
      if (tables.units.sortColumn === "unit_type") {
        const cmp = a.unit_type.localeCompare(b.unit_type);
        return tables.units.sortDirection === "asc" ? cmp : -cmp;
      } else if (tables.units.sortColumn === "total") {
        const cmp = a.total - b.total;
        return tables.units.sortDirection === "asc" ? cmp : -cmp;
      } else if (tables.units.sortColumn.startsWith("nation:")) {
        const nation = tables.units.sortColumn.replace("nation:", "");
        const aVal = a.counts[nation] ?? 0;
        const bVal = b.counts[nation] ?? 0;
        const cmp = aVal - bVal;
        return tables.units.sortDirection === "asc" ? cmp : -cmp;
      }
      return a.unit_type.localeCompare(b.unit_type);
    });

    return rows;
  });

  // Helper to create default selection (all nations selected)
  function createDefaultSelection(players: { nation: string | null }[]): Record<string, boolean> {
    return Object.fromEntries(
      players.map((player) => [formatEnum(player.nation, "NATION_"), true])
    );
  }

  // Initialize filter state when data loads - select all nations by default for each chart
  $effect(() => {
    if (playerHistory) {
      const defaultSelection = createDefaultSelection(playerHistory);
      // Initialize all player-based chart filters
      const playerChartKeys: ChartFilterKey[] = [
        "points", "military", "legitimacy",
        "science", "civics", "training", "growth", "culture",
        "happiness", "orders", "food", "money", "discontent",
        "iron", "stone", "wood", "maintenance"
      ];
      for (const key of playerChartKeys) {
        chartFilters[key] = { ...defaultSelection };
      }
    }
  });

  // Initialize law adoption filter separately (uses lawAdoptionHistory data)
  $effect(() => {
    if (lawAdoptionHistory) {
      chartFilters.laws = createDefaultSelection(lawAdoptionHistory);
    }
  });

  // Initialize tech discovery filter separately (uses techDiscoveryHistory data)
  $effect(() => {
    if (techDiscoveryHistory) {
      chartFilters.techs = createDefaultSelection(techDiscoveryHistory);
    }
  });

  // Parse selected filters back into separate arrays
  const selectedLogTypes = $derived(
    tables.events.filters
      .filter(f => f.startsWith("logtype:"))
      .map(f => f.replace("logtype:", ""))
  );

  const selectedPlayers = $derived(
    tables.events.filters
      .filter(f => f.startsWith("player:"))
      .map(f => f.replace("player:", ""))
  );

  // All available yield types in Old World
  const YIELD_TYPES = [
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
    "YIELD_MAINTENANCE"
  ] as const;

  // Helper to get player color based on nation
  function getPlayerColor(nation: string | null | undefined, fallbackIndex: number): string {
    if (nation) {
      // Strip "NATION_" prefix if present (database stores as "NATION_CARTHAGE" but color map expects "CARTHAGE")
      const cleanNation = nation.replace(/^NATION_/, '');
      const nationColor = getCivilizationColor(cleanNation);
      if (nationColor) return nationColor;
    }
    return getChartColor(fallbackIndex);
  }

  // Generate chart options for each metric
  const pointsChartOption = $derived<EChartsOption | null>(
    playerHistory
      ? {
          ...CHART_THEME,
          title: {
            ...CHART_THEME.title,
            text: "Victory Points",
          },
          legend: {
            show: false,
            data: playerHistory.map((p) => formatEnum(p.nation, "NATION_")),
            selected: chartFilters.points,
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
            data: playerHistory[0]?.history.map((h) => h.turn) ?? [],
          },
          yAxis: {
            type: "value",
            name: "Points",
            nameLocation: "middle",
            nameGap: 40,
          },
          series: playerHistory.map((player, i) => ({
            name: formatEnum(player.nation, "NATION_"),
            type: "line",
            data: player.history.map((h) => h.points),
            itemStyle: { color: getPlayerColor(player.nation, i) },
          })),
        }
      : null
  );

  const militaryChartOption = $derived<EChartsOption | null>(
    playerHistory
      ? {
          ...CHART_THEME,
          title: {
            ...CHART_THEME.title,
            text: "Military Power",
          },
          legend: {
            show: false,
            data: playerHistory.map((p) => formatEnum(p.nation, "NATION_")),
            selected: chartFilters.military,
          },
          xAxis: {
            type: "category",
            name: "Turn",
            data: playerHistory[0]?.history.map((h) => h.turn) ?? [],
          },
          yAxis: {
            type: "value",
            name: "Military Power",
          },
          series: playerHistory.map((player, i) => ({
            name: formatEnum(player.nation, "NATION_"),
            type: "line",
            data: player.history.map((h) => h.military_power),
            itemStyle: { color: getPlayerColor(player.nation, i) },
          })),
        }
      : null
  );

  const legitimacyChartOption = $derived<EChartsOption | null>(
    playerHistory
      ? {
          ...CHART_THEME,
          title: {
            ...CHART_THEME.title,
            text: "Legitimacy",
          },
          legend: {
            show: false,
            data: playerHistory.map((p) => formatEnum(p.nation, "NATION_")),
            selected: chartFilters.legitimacy,
          },
          xAxis: {
            type: "category",
            name: "Turn",
            data: playerHistory[0]?.history.map((h) => h.turn) ?? [],
          },
          yAxis: {
            type: "value",
            name: "Legitimacy",
          },
          series: playerHistory.map((player, i) => ({
            name: formatEnum(player.nation, "NATION_"),
            type: "line",
            data: player.history.map((h) => h.legitimacy),
            itemStyle: { color: getPlayerColor(player.nation, i) },
          })),
        }
      : null
  );

  // Helper function to create yield chart option for a specific yield type
  function createYieldChartOption(
    yieldType: string,
    title: string,
    yAxisLabel: string,
    selectedNationsState: Record<string, boolean>
  ): EChartsOption | null {
    if (!allYields || allYields.length === 0) return null;

    const yieldData = allYields.filter(y => y.yield_type === yieldType);
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

  // Create chart options for each yield type - each with its own independent state
  const scienceChartOption = $derived(createYieldChartOption("YIELD_SCIENCE", "Science Production", "Science per Turn", chartFilters.science));
  const civicsChartOption = $derived(createYieldChartOption("YIELD_CIVICS", "Civics Production", "Civics per Turn", chartFilters.civics));
  const trainingChartOption = $derived(createYieldChartOption("YIELD_TRAINING", "Training Production", "Training per Turn", chartFilters.training));
  const growthChartOption = $derived(createYieldChartOption("YIELD_GROWTH", "Growth Production", "Growth per Turn", chartFilters.growth));
  const cultureChartOption = $derived(createYieldChartOption("YIELD_CULTURE", "Culture Production", "Culture per Turn", chartFilters.culture));
  const happinessChartOption = $derived(createYieldChartOption("YIELD_HAPPINESS", "Happiness Production", "Happiness per Turn", chartFilters.happiness));
  const ordersChartOption = $derived(createYieldChartOption("YIELD_ORDERS", "Orders", "Orders per Turn", chartFilters.orders));
  const foodChartOption = $derived(createYieldChartOption("YIELD_FOOD", "Food Production", "Food per Turn", chartFilters.food));
  const moneyChartOption = $derived(createYieldChartOption("YIELD_MONEY", "Money Income", "Gold per Turn", chartFilters.money));
  const discontentChartOption = $derived(createYieldChartOption("YIELD_DISCONTENT", "Discontent", "Discontent per Turn", chartFilters.discontent));
  const ironChartOption = $derived(createYieldChartOption("YIELD_IRON", "Iron Production", "Iron per Turn", chartFilters.iron));
  const stoneChartOption = $derived(createYieldChartOption("YIELD_STONE", "Stone Production", "Stone per Turn", chartFilters.stone));
  const woodChartOption = $derived(createYieldChartOption("YIELD_WOOD", "Wood Production", "Wood per Turn", chartFilters.wood));
  const maintenanceChartOption = $derived(createYieldChartOption("YIELD_MAINTENANCE", "Maintenance Costs", "Maintenance per Turn", chartFilters.maintenance));

  // Create law adoption chart option
  // Uses ECharts legend.selected for filtering instead of filtering data directly
  // Note: Not using explicit EChartsOption type because ECharts types are overly strict
  const lawAdoptionChartOption = $derived(
    (lawAdoptionHistory?.length ?? 0) > 0
      ? (() => {
          const players = lawAdoptionHistory ?? [];

          // Calculate the maximum law count across all players
          const maxLawCount = Math.max(
            ...players.flatMap(player => player.data.map(d => d.law_count))
          );

          // Get the final turn for consistent x-axis
          const finalTurn = Math.max(
            ...players.flatMap(player => player.data.map(d => d.turn))
          );

          // Get nation names for legend
          const nationNames = players.map(p => formatEnum(p.nation, "NATION_"));

          return {
            ...CHART_THEME,
            title: {
              ...CHART_THEME.title,
              text: "Law Adoption Over Time",
            },
            // Hidden legend controls series visibility via legend.selected
            legend: {
              show: false,
              data: nationNames,
              selected: chartFilters.laws,
            },
            tooltip: {
              trigger: 'item',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter: (params: any) => {
                const data = params.data as [number, number, string | null] | undefined;
                if (!data) return '';
                const [turn, count, lawName] = data;
                if (lawName) {
                  // Format law name: LAW_SLAVERY -> Slavery
                  const formattedLaw = formatEnum(lawName, "LAW_");
                  return `Turn ${turn}: Adopted ${formattedLaw}`;
                }
                return `Turn ${turn}: ${count} law classes`;
              },
            },
            grid: {
              left: 60,
              right: 40,
              top: 80,
              bottom: 60,
            },
            xAxis: {
              type: "value",
              name: "Turn",
              nameLocation: "middle",
              nameGap: 30,
              splitLine: { show: false },
              max: finalTurn,
            },
            yAxis: {
              type: "value",
              name: "Number of Laws",
              nameLocation: "middle",
              nameGap: 40,
              max: maxLawCount + 2,
              splitLine: { show: false },
            },
            series: players.map((player, i) => ({
              name: formatEnum(player.nation, "NATION_"),
              type: "line" as const,
              data: player.data.map((d) => [d.turn, d.law_count, d.law_name]),
              itemStyle: { color: getPlayerColor(player.nation, i) },
              symbol: (value: [number, number, string | null]) => value[2] ? 'circle' : 'none',
              symbolSize: 8,
              emphasis: {
                symbolSize: 12,
              },
              // Add custom horizontal lines to the first series only
              ...(i === 0 ? {
                markLine: {
                  silent: true,
                  symbol: 'none',
                  label: { show: false },
                  lineStyle: {
                    type: 'dashed' as const,
                    color: '#666666',
                    width: 1,
                  },
                  data: [
                    { yAxis: 4 },
                    { yAxis: 7 },
                  ],
                },
              } : {}),
            })),
          };
        })()
      : null
  );

  const techDiscoveryChartOption = $derived(
    (techDiscoveryHistory?.length ?? 0) > 0
      ? (() => {
          const players = techDiscoveryHistory ?? [];

          // Calculate the maximum tech count across all players
          const maxTechCount = Math.max(
            ...players.flatMap(player => player.data.map(d => d.tech_count))
          );

          // Get the final turn for consistent x-axis
          const finalTurn = Math.max(
            ...players.flatMap(player => player.data.map(d => d.turn))
          );

          // Get nation names for legend
          const nationNames = players.map(p => formatEnum(p.nation, "NATION_"));

          return {
            ...CHART_THEME,
            title: {
              ...CHART_THEME.title,
              text: "Tech Discovery Over Time",
            },
            // Hidden legend controls series visibility via legend.selected
            legend: {
              show: false,
              data: nationNames,
              selected: chartFilters.techs,
            },
            tooltip: {
              trigger: 'item',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter: (params: any) => {
                const data = params.data as [number, number, string | null] | undefined;
                if (!data) return '';
                const [turn, count, techName] = data;
                if (techName) {
                  // Format tech name: TECH_IRONWORKING -> Ironworking
                  const formattedTech = formatEnum(techName, "TECH_");
                  return `Turn ${turn}: Discovered ${formattedTech}`;
                }
                return `Turn ${turn}: ${count} technologies`;
              },
            },
            grid: {
              left: 60,
              right: 40,
              top: 80,
              bottom: 60,
            },
            xAxis: {
              type: "value",
              name: "Turn",
              nameLocation: "middle",
              nameGap: 30,
              splitLine: { show: false },
              max: finalTurn,
            },
            yAxis: {
              type: "value",
              name: "Number of Technologies",
              nameLocation: "middle",
              nameGap: 40,
              max: maxTechCount + 2,
              splitLine: { show: false },
            },
            series: players.map((player, i) => ({
              name: formatEnum(player.nation, "NATION_"),
              type: "line" as const,
              data: player.data.map((d) => [d.turn, d.tech_count, d.tech_name]),
              itemStyle: { color: getPlayerColor(player.nation, i) },
              symbol: (value: [number, number, string | null]) => value[2] ? 'circle' : 'none',
              symbolSize: 8,
              emphasis: {
                symbolSize: 12,
              },
            })),
          };
        })()
      : null
  );

  // Fetch game data when route changes
  $effect(() => {
    const matchId = Number($page.params.id);

    // Reset state for new game
    loading = true;
    error = null;
    activeTab = "events";
    // Reset table states to defaults
    tables.events = { search: "", sortColumn: "turn", sortDirection: "desc", filters: [] };
    tables.cities = { search: "", sortColumn: "owner_nation", sortDirection: "asc", filters: [] };
    tables.improvements = { search: "", sortColumn: "improvement", sortDirection: "asc", filters: [] };
    tables.laws = { search: "", sortColumn: "nation", sortDirection: "asc", filters: [] };
    tables.techs = { search: "", sortColumn: "nation", sortDirection: "asc", filters: [] };
    tables.units = { search: "", sortColumn: "nation", sortDirection: "asc", filters: [] };
    cityVisibleColumns = Object.fromEntries(
      CITY_COLUMNS.map((col) => [col.key, col.defaultVisible])
    );

    Promise.all([
      api.getGameDetails(matchId),
      api.getPlayerHistory(matchId),
      api.getYieldHistory(matchId, Array.from(YIELD_TYPES)),
      api.getEventLogs(matchId),
      api.getLawAdoptionHistory(matchId),
      api.getCurrentLaws(matchId),
      api.getTechDiscoveryHistory(matchId),
      api.getCompletedTechs(matchId),
      api.getUnitsProduced(matchId),
      api.getCityStatistics(matchId),
      api.getImprovementData(matchId),
      api.getMapTiles(matchId),
    ])
      .then(([details, history, yields, logs, lawHistory, laws, techHistory, techs, units, cityStats, impData, tiles]) => {
        gameDetails = details;
        playerHistory = history;
        allYields = yields;
        eventLogs = logs;
        lawAdoptionHistory = lawHistory;
        currentLaws = laws;
        techDiscoveryHistory = techHistory;
        completedTechs = techs;
        unitsProduced = units;
        cityStatistics = cityStats;
        improvementData = impData;
        mapTiles = tiles;
        // Initialize map turn to final turn
        selectedMapTurn = details.total_turns;
      })
      .catch((err) => {
        error = String(err);
      })
      .finally(() => {
        loading = false;
      });
  });

  // Get the human player's nation
  const humanNation = $derived(
    gameDetails?.players.find((p) => p.is_human)?.nation ?? null
  );

  // Format the game title using the shared formatter
  const gameTitle = $derived(
    gameDetails ? formatGameTitle({
      game_name: gameDetails.game_name,
      save_owner_nation: humanNation,
      total_turns: gameDetails.total_turns,
      match_id: gameDetails.match_id
    }) : ""
  );

  // Get winner civilization color
  const winnerColor = $derived(() => {
    if (!gameDetails?.winner_civilization) return undefined;
    return getCivilizationColor(gameDetails.winner_civilization);
  });

  // Format victory conditions from DB string
  const victoryConditions = $derived(
    gameDetails?.victory_conditions
      ?.split('+')
      .map(v => formatEnum(v, 'VICTORY_'))
      .join(', ') ?? 'Unknown'
  );

  // Check if Victory Points victory condition is enabled
  const victoryPointsEnabled = $derived(
    gameDetails?.victory_conditions?.includes('VICTORY_POINTS') ?? false
  );

  // Format DLC list from DB string
  const dlcList = $derived(
    gameDetails?.enabled_dlc
      ?.split('+')
      .map(dlc => formatEnum(dlc, 'DLC_'))
      .join(', ') ?? 'None'
  );

  // Format mods list from DB string
  const modsList = $derived(
    gameDetails?.enabled_mods
      ?.split('+')
      .join(', ') ?? 'None'
  );

  // Process event logs to extract player names from descriptions like "...by Kush (Fluffbunny)"
  const processedEventLogs = $derived(
    eventLogs?.map(log => {
      // Strip markup first
      const cleanDesc = stripMarkup(log.description);

      // If player_name is already set, just clean the description
      if (log.player_name) {
        return { ...log, description: cleanDesc };
      }

      // Try to extract player name from description ending with "(PlayerName)"
      const match = cleanDesc?.match(/\s*\(([^)]+)\)\s*$/);
      if (match) {
        return {
          ...log,
          player_name: match[1],
          // Store the cleaned description with the parenthetical removed
          description: cleanDesc?.replace(/\s*\([^)]+\)\s*$/, '') ?? null
        };
      }

      return { ...log, description: cleanDesc };
    }) ?? null
  );

  // Get unique log types for filter dropdown
  const uniqueLogTypes = $derived(
    processedEventLogs
      ? [...new Set(processedEventLogs.map(log => log.log_type))].sort()
      : []
  );


  // Get unique players for filter dropdown
  const uniquePlayers = $derived(
    processedEventLogs
      ? [...new Set(processedEventLogs.map(log => log.player_name).filter((p): p is string => p != null && p !== 'Player'))].sort()
      : []
  );

  // Get nation names to distinguish from player usernames
  const nationNames = $derived(
    gameDetails
      ? gameDetails.players.map(p => formatEnum(p.nation, 'NATION_'))
      : []
  );

  // Show player column if any event has a player name that's NOT a nation name
  // and looks like a real username (no spaces - filters out "One Legendary", etc.)
  // In single player, extracted names are nations (e.g., "Aksum") or game terms
  // In multiplayer, they're actual usernames (e.g., "Fluffbunny")
  const showPlayerColumn = $derived(
    processedEventLogs && processedEventLogs.some(log =>
      log.player_name &&
      log.player_name !== 'Player' &&
      !nationNames.includes(log.player_name) &&
      !log.player_name.includes(' ')  // Real usernames don't have spaces
    )
  );


  // Apply filters and sorting to event logs
  const filteredEventLogs = $derived(() => {
    if (!processedEventLogs) return null;

    // Filter
    let logs = processedEventLogs.filter(log => {
      // Search filter (case-insensitive) - searches log type, player, and description
      if (tables.events.search) {
        const term = tables.events.search.toLowerCase();
        const matchesLogType = formatEnum(log.log_type, "").toLowerCase().includes(term);
        const matchesPlayer = log.player_name?.toLowerCase().includes(term) ?? false;
        const matchesDescription = log.description?.toLowerCase().includes(term) ?? false;
        if (!matchesLogType && !matchesPlayer && !matchesDescription) {
          return false;
        }
      }
      // Log type filter
      if (selectedLogTypes.length > 0 && !selectedLogTypes.includes(log.log_type)) {
        return false;
      }
      // Player filter
      if (selectedPlayers.length > 0 && (!log.player_name || !selectedPlayers.includes(log.player_name))) {
        return false;
      }
      return true;
    });

    // Sort
    logs = [...logs].sort((a, b) => {
      let aVal: string | number | null;
      let bVal: string | number | null;

      switch (tables.events.sortColumn) {
        case "turn":
          aVal = a.turn;
          bVal = b.turn;
          break;
        case "log_type":
          aVal = a.log_type;
          bVal = b.log_type;
          break;
        case "player_name":
          aVal = a.player_name ?? "";
          bVal = b.player_name ?? "";
          break;
        case "description":
          aVal = a.description ?? "";
          bVal = b.description ?? "";
          break;
        default:
          aVal = a.turn;
          bVal = b.turn;
      }

      // Handle nulls - sort them to the end
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      // Compare values
      let cmp: number;
      if (typeof aVal === "string" && typeof bVal === "string") {
        cmp = aVal.localeCompare(bVal);
      } else {
        cmp = (aVal as number) - (bVal as number);
      }

      return tables.events.sortDirection === "asc" ? cmp : -cmp;
    });

    return logs;
  });

  // Check if any filters are active
  const hasActiveFilters = $derived(
    tables.events.search !== "" ||
    tables.events.filters.length > 0
  );

  // Clear all filters
  function clearFilters() {
    tables.events.search = "";
    tables.events.filters = [];
  }

  // Handle map turn slider change
  async function handleMapTurnChange(turn: number) {
    if (!gameDetails || mapTilesLoading) return;

    selectedMapTurn = turn;

    // Fetch tiles at the specified turn
    if (turn === gameDetails.total_turns) {
      // For final turn, use the regular endpoint (current state)
      mapTilesLoading = true;
      try {
        mapTiles = await api.getMapTiles(gameDetails.match_id);
      } catch (err) {
        console.error("Failed to fetch map tiles:", err);
      } finally {
        mapTilesLoading = false;
      }
    } else {
      // For historical turns, use the historical endpoint
      mapTilesLoading = true;
      try {
        mapTiles = await api.getMapTilesAtTurn(gameDetails.match_id, turn);
      } catch (err) {
        console.error("Failed to fetch map tiles at turn:", err);
      } finally {
        mapTilesLoading = false;
      }
    }
  }

</script>

{#if loading}
  <GamePageSkeleton />
{:else if error}
  <main class="flex-1 pt-4 px-4 pb-8 overflow-y-auto bg-blue-gray isolate">
    <p class="text-white bg-brown p-4 border-2 border-orange rounded font-bold">Error: {error}</p>
  </main>
{:else if gameDetails}
  <main class="flex-1 pt-4 px-4 pb-8 overflow-y-auto bg-blue-gray isolate">
    <div class="flex justify-between items-baseline mb-8">
        <h1 class="text-gray-200 text-3xl font-bold">{gameTitle}</h1>
        <p class="text-brown text-sm">{formatDate(gameDetails.save_date)}</p>
      </div>

      <!-- Summary Section -->
      <div class="p-2 border-2 border-black rounded-lg mb-6" style="background-color: #36302a;">
        <div class="flex justify-evenly">
          <!-- Left Column: Player, Winner & Victory Type -->
          <div class="grid grid-cols-[auto_minmax(180px,1fr)] gap-x-2 gap-y-2 items-center">
            <span class="font-bold text-brown text-xs uppercase tracking-wide text-right">Player:</span>
            <span class="text-xl font-bold" style="color: #EEEEEE;">{formatEnum(humanNation, "NATION_")}</span>

            <span class="font-bold text-brown text-xs uppercase tracking-wide text-right">Winner:</span>
            <span
              class="text-xl font-bold"
              style:color={winnerColor() ?? '#EEEEEE'}
            >
              {#if gameDetails.winner_player_id}
                {#if gameDetails.winner_name}
                  {gameDetails.winner_name} - {formatEnum(gameDetails.winner_civilization, 'NATION_')}
                {:else}
                  {formatEnum(gameDetails.winner_civilization, 'NATION_')}
                {/if}
              {:else}
                In Progress
              {/if}
            </span>

            <span class="font-bold text-brown text-xs uppercase tracking-wide text-right">Victory Type:</span>
            <span class="text-xl font-bold" style="color: #EEEEEE;">
              {#if gameDetails.winner_victory_type}
                {formatEnum(gameDetails.winner_victory_type, 'VICTORY_')}
              {:else}
                -
              {/if}
            </span>
          </div>

          <!-- Right Column: Map, Turns & Nations -->
          <div class="grid grid-cols-[auto_minmax(100px,1fr)] gap-x-2 gap-y-2 items-center">
            {#if gameDetails.map_class}
              <span class="font-bold text-brown text-xs uppercase tracking-wide text-right">Map:</span>
              <span class="text-xl font-bold" style="color: #EEEEEE;">{formatMapClass(gameDetails.map_class)}</span>
            {/if}

            <span class="font-bold text-brown text-xs uppercase tracking-wide text-right">Turns:</span>
            <span class="text-xl font-bold" style="color: #EEEEEE;">{gameDetails.total_turns}</span>

            <span class="font-bold text-brown text-xs uppercase tracking-wide text-right">Nations:</span>
            <span class="text-xl font-bold" style="color: #EEEEEE;">{gameDetails.players.length}</span>
          </div>
        </div>
      </div>

      <!-- Tabs with Bits UI -->
      <Tabs.Root bind:value={activeTab}>
        <!-- Tab Navigation -->
        <Tabs.List class="flex">
          <Tabs.Trigger
            value="events"
            class="px-6 py-3 border-2 border-black border-b-0 border-r-0 rounded-tl-lg font-bold cursor-pointer transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=active]:text-tan data-[state=inactive]:bg-[#2a2622] data-[state=inactive]:text-tan"
          >
            Events
          </Tabs.Trigger>

          <Tabs.Trigger
            value="laws"
            class="px-6 py-3 border-2 border-black border-b-0 border-r-0 font-bold cursor-pointer transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=active]:text-tan data-[state=inactive]:bg-[#2a2622] data-[state=inactive]:text-tan"
          >
            Laws
          </Tabs.Trigger>

          <Tabs.Trigger
            value="techs"
            class="px-6 py-3 border-2 border-black border-b-0 border-r-0 font-bold cursor-pointer transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=active]:text-tan data-[state=inactive]:bg-[#2a2622] data-[state=inactive]:text-tan"
          >
            Techs
          </Tabs.Trigger>

          <Tabs.Trigger
            value="economics"
            class="px-6 py-3 border-2 border-black border-b-0 border-r-0 font-bold cursor-pointer transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=active]:text-tan data-[state=inactive]:bg-[#2a2622] data-[state=inactive]:text-tan"
          >
            Yields
          </Tabs.Trigger>

          <Tabs.Trigger
            value="military"
            class="px-6 py-3 border-2 border-black border-b-0 border-r-0 font-bold cursor-pointer transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=active]:text-tan data-[state=inactive]:bg-[#2a2622] data-[state=inactive]:text-tan"
          >
            Military
          </Tabs.Trigger>

          <Tabs.Trigger
            value="cities"
            class="px-6 py-3 border-2 border-black border-b-0 border-r-0 font-bold cursor-pointer transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=active]:text-tan data-[state=inactive]:bg-[#2a2622] data-[state=inactive]:text-tan"
          >
            Cities
          </Tabs.Trigger>

          <Tabs.Trigger
            value="improvements"
            class="px-6 py-3 border-2 border-black border-b-0 border-r-0 font-bold cursor-pointer transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=active]:text-tan data-[state=inactive]:bg-[#2a2622] data-[state=inactive]:text-tan"
          >
            Improvements
          </Tabs.Trigger>

          <Tabs.Trigger
            value="map"
            class="px-6 py-3 border-2 border-black border-b-0 border-r-0 font-bold cursor-pointer transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=active]:text-tan data-[state=inactive]:bg-[#2a2622] data-[state=inactive]:text-tan"
          >
            Map
          </Tabs.Trigger>

          <Tabs.Trigger
            value="settings"
            class="px-6 py-3 border-2 border-black border-b-0 rounded-tr-lg font-bold cursor-pointer transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=active]:text-tan data-[state=inactive]:bg-[#2a2622] data-[state=inactive]:text-tan"
          >
            Game Settings
          </Tabs.Trigger>
        </Tabs.List>

        <!-- Tab Content: Events -->
        <Tabs.Content
          value="events"
          class="p-8 border-2 border-black border-t-0 rounded-b-lg min-h-[400px] tab-pane"
          style="background-color: #35302B;"
        >
          <h2 class="text-tan font-bold mb-4 mt-0">Game History</h2>
          {#if !victoryPointsEnabled}
            <div class="p-6 rounded-lg border-2 border-black mb-6" style="background-color: #201a13;">
              <h3 class="text-tan font-bold mb-2">Victory Points</h3>
              <p class="text-brown italic">Victory Points not enabled for this game (enabled: {victoryConditions}).</p>
            </div>
          {:else if pointsChartOption}
            <ChartContainer option={pointsChartOption} height="400px" title="Victory Points" />
          {/if}

          <!-- Event Logs Table -->
          <h3 class="text-tan font-bold mb-4 mt-8">Event Logs</h3>
          {#if processedEventLogs === null}
            <p class="text-brown italic text-center p-8">Loading event logs...</p>
          {:else if processedEventLogs.length === 0}
            <p class="text-brown italic text-center p-8">No event logs recorded</p>
          {:else}
            <!-- Filters -->
            <div class="flex flex-wrap gap-3 mb-4 items-end">
              <!-- Combined Log Type and Player Filter -->
              <Select.Root type="multiple" bind:value={tables.events.filters}>
                <Select.Trigger class="pl-9 pr-8 py-2 rounded border-2 border-black text-tan text-sm w-32 flex items-center justify-between relative" style="background-color: #201a13;">
                  <div class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-brown" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h18M5 8h14M7 12h10M9 16h6" />
                    </svg>
                  </div>
                  <span class="truncate">Filter</span>
                  <span class="ml-2">▼</span>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content class="border-2 border-black rounded shadow-lg max-h-64 overflow-y-auto z-50 bg-[#201a13]">
                    <Select.Viewport>
                      <!-- Players Group (only show if player column is visible) -->
                      {#if showPlayerColumn && uniquePlayers.length > 0}
                        <Select.Group>
                          <Select.GroupHeading class="px-3 py-2 text-brown text-xs font-bold uppercase tracking-wide border-b border-brown/50">
                            Players
                          </Select.GroupHeading>
                          {#each uniquePlayers as player}
                            <Select.Item
                              value={`player:${player}`}
                              label={player}
                              class="px-3 py-2 cursor-pointer hover:bg-brown/30 text-tan text-sm flex justify-between items-center data-[highlighted]:bg-brown/30"
                            >
                              {#snippet children({ selected })}
                                {player}
                                {#if selected}
                                  <span class="text-orange font-bold">✓</span>
                                {/if}
                              {/snippet}
                            </Select.Item>
                          {/each}
                        </Select.Group>
                      {/if}

                      <!-- Log Types Group -->
                      {#if uniqueLogTypes.length > 0}
                        <Select.Group>
                          <Select.GroupHeading class="px-3 py-2 text-brown text-xs font-bold uppercase tracking-wide border-b border-brown/50 {showPlayerColumn && uniquePlayers.length > 0 ? 'border-t border-t-brown/50' : ''}">
                            Log Types
                          </Select.GroupHeading>
                          {#each uniqueLogTypes as logType}
                            <Select.Item
                              value={`logtype:${logType}`}
                              label={formatEnum(logType, "")}
                              class="px-3 py-2 cursor-pointer hover:bg-brown/30 text-tan text-sm flex justify-between items-center data-[highlighted]:bg-brown/30"
                            >
                              {#snippet children({ selected })}
                                {formatEnum(logType, "")}
                                {#if selected}
                                  <span class="text-orange font-bold">✓</span>
                                {/if}
                              {/snippet}
                            </Select.Item>
                          {/each}
                        </Select.Group>
                      {/if}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>

              <!-- Description search -->
              <SearchInput
                bind:value={tables.events.search}
                variant="field"
                class="w-96"
              />

              <!-- Selected filter chips -->
              {#if tables.events.filters.length > 0}
                <div class="flex flex-wrap gap-1">
                  {#each tables.events.filters as filter}
                    <span class="px-2 py-1 rounded bg-brown text-white text-xs">
                      {filter.startsWith("logtype:")
                        ? formatEnum(filter.replace("logtype:", ""), "")
                        : filter.replace("player:", "")}
                    </span>
                  {/each}
                </div>
              {/if}

              <!-- Results count -->
              <span class="text-brown text-sm ml-auto">
                {filteredEventLogs()?.length ?? 0} / {processedEventLogs.length} events
              </span>
            </div>

            <div class="overflow-x-auto rounded-lg min-h-[36rem]" style="background-color: #201a13;">
              <table class="w-full">
                <thead>
                  <tr>
                    <th
                      class="p-3 text-left border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                      onclick={() => toggleSort("events", "turn")}
                    >
                      <span class="inline-flex items-center gap-1">
                        Turn
                        {#if tables.events.sortColumn === "turn"}
                          <span class="text-orange">{tables.events.sortDirection === "asc" ? "↑" : "↓"}</span>
                        {/if}
                      </span>
                    </th>
                    <th
                      class="p-3 text-left border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                      onclick={() => toggleSort("events", "log_type")}
                    >
                      <span class="inline-flex items-center gap-1">
                        Log Type
                        {#if tables.events.sortColumn === "log_type"}
                          <span class="text-orange">{tables.events.sortDirection === "asc" ? "↑" : "↓"}</span>
                        {/if}
                      </span>
                    </th>
                    {#if showPlayerColumn}
                      <th
                        class="p-3 text-left border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                        onclick={() => toggleSort("events", "player_name")}
                      >
                        <span class="inline-flex items-center gap-1">
                          Player
                          {#if tables.events.sortColumn === "player_name"}
                            <span class="text-orange">{tables.events.sortDirection === "asc" ? "↑" : "↓"}</span>
                          {/if}
                        </span>
                      </th>
                    {/if}
                    <th
                      class="p-3 text-left border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                      onclick={() => toggleSort("events", "description")}
                    >
                      <span class="inline-flex items-center gap-1">
                        Description
                        {#if tables.events.sortColumn === "description"}
                          <span class="text-orange">{tables.events.sortDirection === "asc" ? "↑" : "↓"}</span>
                        {/if}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {#each filteredEventLogs() ?? [] as log}
                      <tr class="transition-colors duration-200 hover:bg-brown/20">
                        <td class="p-3 text-left border-b border-brown/50 text-tan">{log.turn}</td>
                        <td class="p-3 text-left border-b border-brown/50 text-tan">
                          <code class="text-sm">{formatEnum(log.log_type, "")}</code>
                        </td>
                        {#if showPlayerColumn}
                          <td class="p-3 text-left border-b border-brown/50 text-tan">{log.player_name ?? ""}</td>
                        {/if}
                        <td class="p-3 text-left border-b border-brown/50 text-tan">{log.description || "—"}</td>
                      </tr>
                  {:else}
                    <tr>
                      <td colspan={showPlayerColumn ? 4 : 3} class="p-8 text-center text-brown italic">
                        No events match filters
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </Tabs.Content>

        <!-- Tab Content: Laws -->
        <Tabs.Content
          value="laws"
          class="p-8 border-2 border-black border-t-0 rounded-b-lg min-h-[400px] tab-pane"
          style="background-color: #35302B;"
        >
          {#if lawAdoptionChartOption}
            <ChartContainer option={lawAdoptionChartOption} height="400px" title="Law Adoption Over Time" />
          {:else if lawAdoptionHistory !== null && lawAdoptionHistory.length === 0}
            <p class="text-brown italic text-center p-8">No law adoption data available</p>
          {:else}
            <p class="text-brown italic text-center p-8">Loading law adoption data...</p>
          {/if}

          <!-- Current Laws Table -->
          {#if currentLaws === null}
            <div class="mt-8">
              <p class="text-brown italic text-center p-8">Loading laws data...</p>
            </div>
          {:else if currentLaws.length === 0}
            <div class="mt-8">
              <p class="text-brown italic text-center p-8">No laws data available</p>
            </div>
          {:else}
            <div class="mt-8">
              <!-- Controls row -->
              <div class="flex flex-wrap gap-3 mb-4 items-end">
                <!-- Filter dropdown -->
                <Select.Root type="multiple" bind:value={tables.laws.filters}>
                  <Select.Trigger class="pl-9 pr-8 py-2 rounded border-2 border-black text-tan text-sm w-32 flex items-center justify-between relative" style="background-color: #201a13;">
                    <div class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-brown" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h18M5 8h14M7 12h10M9 16h6" />
                      </svg>
                    </div>
                    <span class="truncate">Filter</span>
                    <span class="ml-2">▼</span>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content class="border-2 border-black rounded shadow-lg max-h-64 overflow-y-auto z-50 bg-[#201a13]">
                      <Select.Viewport>
                        <!-- Nations Group -->
                        {#if uniqueLawNations.length > 0}
                          <Select.Group>
                            <Select.GroupHeading class="px-3 py-2 text-brown text-xs font-bold uppercase tracking-wide border-b border-brown/50">
                              Nations
                            </Select.GroupHeading>
                            {#each uniqueLawNations as nation}
                              <Select.Item
                                value={`nation:${nation}`}
                                label={formatEnum(nation, "NATION_")}
                                class="px-3 py-2 cursor-pointer hover:bg-brown/30 text-tan text-sm flex justify-between items-center data-[highlighted]:bg-brown/30"
                              >
                                {#snippet children({ selected })}
                                  {formatEnum(nation, "NATION_")}
                                  {#if selected}
                                    <span class="text-orange font-bold">✓</span>
                                  {/if}
                                {/snippet}
                              </Select.Item>
                            {/each}
                          </Select.Group>
                        {/if}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>

                <!-- Search -->
                <SearchInput
                  bind:value={tables.laws.search}
                  placeholder="Search laws"
                  variant="field"
                  class="w-64"
                />

                <!-- Selected filter chips -->
                {#if tables.laws.filters.length > 0}
                  <div class="flex flex-wrap gap-1">
                    {#each tables.laws.filters as filter}
                      <span class="px-2 py-1 rounded bg-brown text-white text-xs">
                        {formatEnum(filter.replace("nation:", ""), "NATION_")}
                      </span>
                    {/each}
                  </div>
                {/if}

                <!-- Results count -->
                <span class="text-brown text-sm ml-auto">
                  {lawPivotData().length} laws
                </span>
              </div>

              <!-- Laws pivot table -->
              <div class="overflow-x-auto rounded-lg" style="background-color: #201a13;">
                <table class="w-full">
                  <thead>
                    <tr>
                      <!-- Law column header -->
                      <th
                        class="p-3 text-left border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                        onclick={() => toggleSort("laws", "law")}
                      >
                        <span class="inline-flex items-center gap-1">
                          Law
                          {#if tables.laws.sortColumn === "law"}
                            <span class="text-orange">
                              {tables.laws.sortDirection === "asc" ? "↑" : "↓"}
                            </span>
                          {/if}
                        </span>
                      </th>
                      <!-- Nation column headers -->
                      {#each displayedLawNations as nation}
                        <th
                          class="p-3 text-center border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                          onclick={() => toggleSort("laws", `nation:${nation}`)}
                        >
                          <span class="inline-flex items-center gap-1 justify-center">
                            {formatEnum(nation, "NATION_")}
                            {#if tables.laws.sortColumn === `nation:${nation}`}
                              <span class="text-orange">
                                {tables.laws.sortDirection === "asc" ? "↑" : "↓"}
                              </span>
                            {/if}
                          </span>
                        </th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each lawPivotData() as row}
                      <tr class="hover:bg-brown/10">
                        <td class="p-3 text-left border-b border-brown/50 text-tan whitespace-nowrap">
                          {formatEnum(row.law, "LAW_")}
                        </td>
                        {#each displayedLawNations as nation}
                          <td class="p-3 text-center border-b border-brown/50 text-tan whitespace-nowrap">
                            {row.turns[nation] != null ? row.turns[nation] : "—"}
                          </td>
                        {/each}
                      </tr>
                    {:else}
                      <tr>
                        <td colspan={displayedLawNations.length + 1} class="p-8 text-center text-brown italic">
                          No laws match search
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}
        </Tabs.Content>

        <!-- Tab Content: Techs -->
        <Tabs.Content
          value="techs"
          class="p-8 border-2 border-black border-t-0 rounded-b-lg min-h-[400px] tab-pane"
          style="background-color: #35302B;"
        >
          {#if techDiscoveryChartOption}
            <ChartContainer option={techDiscoveryChartOption} height="400px" title="Tech Discovery Over Time" />
          {:else if techDiscoveryHistory !== null && techDiscoveryHistory.length === 0}
            <p class="text-brown italic text-center p-8">No tech discovery data available</p>
          {:else}
            <p class="text-brown italic text-center p-8">Loading tech discovery data...</p>
          {/if}

          <!-- Completed Technologies Table -->
          {#if completedTechs === null}
            <div class="mt-8">
              <p class="text-brown italic text-center p-8">Loading technologies data...</p>
            </div>
          {:else if completedTechs.length === 0}
            <div class="mt-8">
              <p class="text-brown italic text-center p-8">No technologies data available</p>
            </div>
          {:else}
            <div class="mt-8">
              <!-- Controls row -->
              <div class="flex flex-wrap gap-3 mb-4 items-end">
                <!-- Filter dropdown -->
                <Select.Root type="multiple" bind:value={tables.techs.filters}>
                  <Select.Trigger class="pl-9 pr-8 py-2 rounded border-2 border-black text-tan text-sm w-32 flex items-center justify-between relative" style="background-color: #201a13;">
                    <div class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-brown" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h18M5 8h14M7 12h10M9 16h6" />
                      </svg>
                    </div>
                    <span class="truncate">Filter</span>
                    <span class="ml-2">▼</span>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content class="border-2 border-black rounded shadow-lg max-h-64 overflow-y-auto z-50 bg-[#201a13]">
                      <Select.Viewport>
                        <!-- Nations Group -->
                        {#if uniqueTechNations.length > 0}
                          <Select.Group>
                            <Select.GroupHeading class="px-3 py-2 text-brown text-xs font-bold uppercase tracking-wide border-b border-brown/50">
                              Nations
                            </Select.GroupHeading>
                            {#each uniqueTechNations as nation}
                              <Select.Item
                                value={`nation:${nation}`}
                                label={formatEnum(nation, "NATION_")}
                                class="px-3 py-2 cursor-pointer hover:bg-brown/30 text-tan text-sm flex justify-between items-center data-[highlighted]:bg-brown/30"
                              >
                                {#snippet children({ selected })}
                                  {formatEnum(nation, "NATION_")}
                                  {#if selected}
                                    <span class="text-orange font-bold">✓</span>
                                  {/if}
                                {/snippet}
                              </Select.Item>
                            {/each}
                          </Select.Group>
                        {/if}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>

                <!-- Search -->
                <SearchInput
                  bind:value={tables.techs.search}
                  placeholder="Search technologies"
                  variant="field"
                  class="w-64"
                />

                <!-- Selected filter chips -->
                {#if tables.techs.filters.length > 0}
                  <div class="flex flex-wrap gap-1">
                    {#each tables.techs.filters as filter}
                      <span class="px-2 py-1 rounded bg-brown text-white text-xs">
                        {formatEnum(filter.replace("nation:", ""), "NATION_")}
                      </span>
                    {/each}
                  </div>
                {/if}

                <!-- Results count -->
                <span class="text-brown text-sm ml-auto">
                  {techPivotData().length} technologies
                </span>
              </div>

              <!-- Technologies pivot table -->
              <div class="overflow-x-auto rounded-lg" style="background-color: #201a13;">
                <table class="w-full">
                  <thead>
                    <tr>
                      <!-- Technology column header -->
                      <th
                        class="p-3 text-left border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                        onclick={() => toggleSort("techs", "tech")}
                      >
                        <span class="inline-flex items-center gap-1">
                          Technology
                          {#if tables.techs.sortColumn === "tech"}
                            <span class="text-orange">
                              {tables.techs.sortDirection === "asc" ? "↑" : "↓"}
                            </span>
                          {/if}
                        </span>
                      </th>
                      <!-- Nation column headers -->
                      {#each displayedTechNations as nation}
                        <th
                          class="p-3 text-center border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                          onclick={() => toggleSort("techs", `nation:${nation}`)}
                        >
                          <span class="inline-flex items-center gap-1 justify-center">
                            {formatEnum(nation, "NATION_")}
                            {#if tables.techs.sortColumn === `nation:${nation}`}
                              <span class="text-orange">
                                {tables.techs.sortDirection === "asc" ? "↑" : "↓"}
                              </span>
                            {/if}
                          </span>
                        </th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each techPivotData() as row}
                      <tr class="hover:bg-brown/10">
                        <td class="p-3 text-left border-b border-brown/50 text-tan whitespace-nowrap">
                          {formatEnum(row.tech, "TECH_")}
                        </td>
                        {#each displayedTechNations as nation}
                          <td class="p-3 text-center border-b border-brown/50 text-tan whitespace-nowrap">
                            {row.turns[nation] != null ? row.turns[nation] : "—"}
                          </td>
                        {/each}
                      </tr>
                    {:else}
                      <tr>
                        <td colspan={displayedTechNations.length + 1} class="p-8 text-center text-brown italic">
                          No technologies match search
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}
        </Tabs.Content>

        <!-- Tab Content: Yields -->
        <Tabs.Content
          value="economics"
          class="p-8 border-2 border-black border-t-0 rounded-b-lg min-h-[400px] tab-pane"
          style="background-color: #35302B;"
        >
          <h2 class="text-tan font-bold mb-4 mt-0">Yields</h2>
          {#if legitimacyChartOption}
            <ChartContainer option={legitimacyChartOption} height="400px" title="Legitimacy" />
          {/if}

          {#if allYields === null}
            <p class="text-brown italic text-center p-8">Loading yield data...</p>
          {:else if allYields.length === 0}
            <p class="text-brown italic text-center p-8">No yield data available</p>
          {:else}
            {#if scienceChartOption}
              <ChartContainer option={scienceChartOption} height="400px" title="Science Production" />
            {/if}

            {#if civicsChartOption}
              <ChartContainer option={civicsChartOption} height="400px" title="Civics Production" />
            {/if}

            {#if trainingChartOption}
              <ChartContainer option={trainingChartOption} height="400px" title="Training Production" />
            {/if}

            {#if growthChartOption}
              <ChartContainer option={growthChartOption} height="400px" title="Growth Production" />
            {/if}

            {#if cultureChartOption}
              <ChartContainer option={cultureChartOption} height="400px" title="Culture Production" />
            {/if}

            {#if happinessChartOption}
              <ChartContainer option={happinessChartOption} height="400px" title="Happiness Production" />
            {/if}

            {#if ordersChartOption}
              <ChartContainer option={ordersChartOption} height="400px" title="Orders" />
            {/if}

            {#if foodChartOption}
              <ChartContainer option={foodChartOption} height="400px" title="Food Production" />
            {/if}

            {#if moneyChartOption}
              <ChartContainer option={moneyChartOption} height="400px" title="Money Income" />
            {/if}

            {#if discontentChartOption}
              <ChartContainer option={discontentChartOption} height="400px" title="Discontent" />
            {/if}

            {#if ironChartOption}
              <ChartContainer option={ironChartOption} height="400px" title="Iron Production" />
            {/if}

            {#if stoneChartOption}
              <ChartContainer option={stoneChartOption} height="400px" title="Stone Production" />
            {/if}

            {#if woodChartOption}
              <ChartContainer option={woodChartOption} height="400px" title="Wood Production" />
            {/if}

            {#if maintenanceChartOption}
              <ChartContainer option={maintenanceChartOption} height="400px" title="Maintenance Costs" />
            {/if}
          {/if}
        </Tabs.Content>

        <!-- Tab Content: Military -->
        <Tabs.Content
          value="military"
          class="p-8 border-2 border-black border-t-0 rounded-b-lg min-h-[400px] tab-pane"
          style="background-color: #35302B;"
        >
          <h2 class="text-tan font-bold mb-4 mt-0">Military</h2>

          <!-- Military Power Chart -->
          {#if militaryChartOption}
            <ChartContainer option={militaryChartOption} height="400px" title="Military Power" />
          {/if}

          <!-- Units Produced Table -->
          {#if unitsProduced && unitsProduced.length > 0}
            <div class="p-6 rounded-lg border-2 border-black mt-6" style="background-color: #201a13;">
              <h3 class="text-tan font-bold mb-4">Units Produced</h3>

              <!-- Controls row -->
              <div class="flex flex-wrap gap-3 mb-4 items-end">
                <!-- Filter dropdown -->
                <Select.Root type="multiple" bind:value={tables.units.filters}>
                  <Select.Trigger class="pl-9 pr-8 py-2 rounded border-2 border-black text-tan text-sm w-32 flex items-center justify-between relative" style="background-color: #201a13;">
                    <div class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-brown" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h18M5 8h14M7 12h10M9 16h6" />
                      </svg>
                    </div>
                    <span class="truncate">Filter</span>
                    <span class="ml-2">▼</span>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content class="border-2 border-black rounded shadow-lg max-h-64 overflow-y-auto z-50 bg-[#201a13]">
                      <Select.Viewport>
                        <!-- Nations Group -->
                        {#if uniqueUnitNations.length > 0}
                          <Select.Group>
                            <Select.GroupHeading class="px-3 py-2 text-brown text-xs font-bold uppercase tracking-wide border-b border-brown/50">
                              Nations
                            </Select.GroupHeading>
                            {#each uniqueUnitNations as nation}
                              <Select.Item
                                value={`nation:${nation}`}
                                label={formatEnum(nation, "NATION_")}
                                class="px-3 py-2 cursor-pointer hover:bg-brown/30 text-tan text-sm flex justify-between items-center data-[highlighted]:bg-brown/30"
                              >
                                {#snippet children({ selected })}
                                  {formatEnum(nation, "NATION_")}
                                  {#if selected}
                                    <span class="text-orange font-bold">✓</span>
                                  {/if}
                                {/snippet}
                              </Select.Item>
                            {/each}
                          </Select.Group>
                        {/if}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>

                <!-- Search -->
                <SearchInput
                  bind:value={tables.units.search}
                  placeholder="Search units"
                  variant="field"
                  class="w-64"
                />

                <!-- Selected filter chips -->
                {#if tables.units.filters.length > 0}
                  <div class="flex flex-wrap gap-1">
                    {#each tables.units.filters as filter}
                      <span class="px-2 py-1 rounded bg-brown text-white text-xs">
                        {formatEnum(filter.replace("nation:", ""), "NATION_")}
                      </span>
                    {/each}
                  </div>
                {/if}

                <!-- Results count -->
                <span class="text-brown text-sm ml-auto">
                  {unitPivotData().length} unit types
                </span>
              </div>

              <!-- Units Pivot Table -->
              <div class="overflow-x-auto">
                <table class="w-full">
                  <thead>
                    <tr>
                      <!-- Unit column header -->
                      <th
                        class="p-3 text-left border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                        onclick={() => toggleSort("units", "unit_type")}
                      >
                        <span class="inline-flex items-center gap-1">
                          Unit
                          {#if tables.units.sortColumn === "unit_type"}
                            <span class="text-orange">
                              {tables.units.sortDirection === "asc" ? "↑" : "↓"}
                            </span>
                          {/if}
                        </span>
                      </th>
                      <!-- Nation column headers -->
                      {#each displayedUnitNations as nation}
                        <th
                          class="p-3 text-right border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                          onclick={() => toggleSort("units", `nation:${nation}`)}
                        >
                          <span class="inline-flex items-center gap-1 justify-end">
                            {formatEnum(nation, "NATION_")}
                            {#if tables.units.sortColumn === `nation:${nation}`}
                              <span class="text-orange">
                                {tables.units.sortDirection === "asc" ? "↑" : "↓"}
                              </span>
                            {/if}
                          </span>
                        </th>
                      {/each}
                      <!-- Total column if multiple nations -->
                      {#if displayedUnitNations.length > 1}
                        <th
                          class="p-3 text-right border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                          onclick={() => toggleSort("units", "total")}
                        >
                          <span class="inline-flex items-center gap-1 justify-end">
                            Total
                            {#if tables.units.sortColumn === "total"}
                              <span class="text-orange">
                                {tables.units.sortDirection === "asc" ? "↑" : "↓"}
                              </span>
                            {/if}
                          </span>
                        </th>
                      {/if}
                    </tr>
                  </thead>
                  <tbody>
                    {#each unitPivotData() as row}
                      <tr class="hover:bg-brown/10">
                        <td class="p-3 text-left border-b border-brown/50 text-tan whitespace-nowrap">
                          {formatEnum(row.unit_type, "UNIT_")}
                        </td>
                        {#each displayedUnitNations as nation}
                          <td class="p-3 text-right border-b border-brown/50 text-tan whitespace-nowrap">
                            {row.counts[nation] ?? 0}
                          </td>
                        {/each}
                        {#if displayedUnitNations.length > 1}
                          <td class="p-3 text-right border-b border-brown/50 text-tan font-bold whitespace-nowrap">
                            {row.total}
                          </td>
                        {/if}
                      </tr>
                    {:else}
                      <tr>
                        <td colspan={displayedUnitNations.length + 2} class="p-8 text-center text-brown italic">
                          No units match search
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {:else if unitsProduced === null}
            <p class="text-brown italic text-center p-8">Loading unit data...</p>
          {:else}
            <p class="text-brown italic text-center p-8">No unit production data available</p>
          {/if}
        </Tabs.Content>

        <!-- Tab Content: Cities -->
        <Tabs.Content
          value="cities"
          class="p-8 border-2 border-black border-t-0 rounded-b-lg min-h-[400px] tab-pane"
          style="background-color: #35302B;"
        >
          <h2 class="text-tan font-bold mb-4 mt-0">Cities</h2>

          {#if cityStatistics === null}
            <p class="text-brown italic text-center p-8">Loading city data...</p>
          {:else if cityStatistics.cities.length === 0}
            <p class="text-brown italic text-center p-8">No cities found</p>
          {:else}
            <!-- Table Controls -->
            <div class="flex flex-wrap gap-3 mb-4 items-end">
              <!-- Filter dropdown -->
              <Select.Root type="multiple" bind:value={tables.cities.filters}>
                <Select.Trigger class="pl-9 pr-8 py-2 rounded border-2 border-black text-tan text-sm w-32 flex items-center justify-between relative" style="background-color: #201a13;">
                  <div class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-brown" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h18M5 8h14M7 12h10M9 16h6" />
                    </svg>
                  </div>
                  <span class="truncate">Filter</span>
                  <span class="ml-2">▼</span>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content class="border-2 border-black rounded shadow-lg max-h-64 overflow-y-auto z-50 bg-[#201a13]">
                    <Select.Viewport>
                      <!-- Nations Group -->
                      {#if uniqueCityNations.length > 0}
                        <Select.Group>
                          <Select.GroupHeading class="px-3 py-2 text-brown text-xs font-bold uppercase tracking-wide border-b border-brown/50">
                            Nations
                          </Select.GroupHeading>
                          {#each uniqueCityNations as nation}
                            <Select.Item
                              value={`nation:${nation}`}
                              label={formatEnum(nation, "NATION_")}
                              class="px-3 py-2 cursor-pointer hover:bg-brown/30 text-tan text-sm flex justify-between items-center data-[highlighted]:bg-brown/30"
                            >
                              {#snippet children({ selected })}
                                {formatEnum(nation, "NATION_")}
                                {#if selected}
                                  <span class="text-orange font-bold">✓</span>
                                {/if}
                              {/snippet}
                            </Select.Item>
                          {/each}
                        </Select.Group>
                      {/if}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>

              <!-- Search -->
              <SearchInput
                bind:value={tables.cities.search}
                placeholder="Search"
                variant="field"
                class="w-64"
              />

              <!-- Selected filter chips -->
              {#if tables.cities.filters.length > 0}
                <div class="flex flex-wrap gap-1">
                  {#each tables.cities.filters as filter}
                    <span class="px-2 py-1 rounded bg-brown text-white text-xs">
                      {formatEnum(filter.replace("nation:", ""), "NATION_")}
                    </span>
                  {/each}
                </div>
              {/if}

              <!-- Column Visibility Dropdown -->
              <Select.Root type="multiple" value={selectedColumnKeys} onValueChange={handleColumnVisibilityChange}>
                <Select.Trigger class="px-4 py-2 rounded border-2 border-black text-tan text-sm flex items-center gap-2" style="background-color: #201a13;">
                  <span>Columns</span>
                  <span class="text-brown">▼</span>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content class="border-2 border-black rounded shadow-lg max-h-80 overflow-y-auto z-50 bg-[#201a13]">
                    <Select.Viewport>
                      {#each CITY_COLUMNS as column}
                        <Select.Item
                          value={column.key}
                          label={column.label}
                          class="px-3 py-2 cursor-pointer hover:bg-brown/30 text-tan text-sm flex justify-between items-center data-[highlighted]:bg-brown/30"
                        >
                          {#snippet children({ selected })}
                            <span>{column.label}</span>
                            {#if selected}
                              <span class="text-orange font-bold">✓</span>
                            {/if}
                          {/snippet}
                        </Select.Item>
                      {/each}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>

              <!-- Results count -->
              <span class="text-brown text-sm ml-auto">
                {filteredSortedCities().length} / {cityStatistics.cities.length} cities
              </span>
            </div>

            <!-- City Details Table -->
            <div class="overflow-x-auto rounded-lg" style="background-color: #201a13;">
              <table class="w-full">
                <thead>
                  <tr>
                    {#each visibleCityColumns as column}
                      <th
                        class="p-3 text-left border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                        onclick={() => toggleSort("cities", column.key)}
                      >
                        <span class="inline-flex items-center gap-1">
                          {column.label}
                          {#if tables.cities.sortColumn === column.key}
                            <span class="text-orange">
                              {tables.cities.sortDirection === "asc" ? "↑" : "↓"}
                            </span>
                          {/if}
                        </span>
                      </th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each filteredSortedCities() as city}
                    <tr class="transition-colors duration-200 hover:bg-brown/20">
                      {#each visibleCityColumns as column}
                        <td class="p-3 text-left border-b border-brown/50 text-tan {column.key === 'city_name' ? 'font-bold' : ''} whitespace-nowrap">
                          {formatCityCell(column, city)}
                        </td>
                      {/each}
                    </tr>
                  {:else}
                    <tr>
                      <td colspan={visibleCityColumns.length} class="p-8 text-center text-brown italic">
                        No cities match search
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </Tabs.Content>

        <!-- Tab Content: Improvements -->
        <Tabs.Content
          value="improvements"
          class="p-8 border-2 border-black border-t-0 rounded-b-lg min-h-[400px] tab-pane"
          style="background-color: #35302B;"
        >
          {#if improvementData === null}
            <p class="text-brown italic text-center p-8">Loading improvement data...</p>
          {:else if improvementData.improvements.length === 0}
            <p class="text-brown italic text-center p-8">No improvements found</p>
          {:else}
            <!-- Controls row -->
            <div class="flex flex-wrap gap-3 mb-4 items-end">
              <!-- Filter dropdown -->
              <Select.Root type="multiple" bind:value={tables.improvements.filters}>
                <Select.Trigger class="pl-9 pr-8 py-2 rounded border-2 border-black text-tan text-sm w-32 flex items-center justify-between relative" style="background-color: #201a13;">
                  <div class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-brown" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h18M5 8h14M7 12h10M9 16h6" />
                    </svg>
                  </div>
                  <span class="truncate">Filter</span>
                  <span class="ml-2">▼</span>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content class="border-2 border-black rounded shadow-lg max-h-64 overflow-y-auto z-50 bg-[#201a13]">
                    <Select.Viewport>
                      <!-- Nations Group -->
                      {#if uniqueImprovementNations.length > 0}
                        <Select.Group>
                          <Select.GroupHeading class="px-3 py-2 text-brown text-xs font-bold uppercase tracking-wide border-b border-brown/50">
                            Nations
                          </Select.GroupHeading>
                          {#each uniqueImprovementNations as nation}
                            <Select.Item
                              value={`nation:${nation}`}
                              label={formatEnum(nation, "NATION_")}
                              class="px-3 py-2 cursor-pointer hover:bg-brown/30 text-tan text-sm flex justify-between items-center data-[highlighted]:bg-brown/30"
                            >
                              {#snippet children({ selected })}
                                {formatEnum(nation, "NATION_")}
                                {#if selected}
                                  <span class="text-orange font-bold">✓</span>
                                {/if}
                              {/snippet}
                            </Select.Item>
                          {/each}
                        </Select.Group>
                      {/if}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>

              <!-- Search -->
              <SearchInput
                bind:value={tables.improvements.search}
                placeholder="Search"
                variant="field"
                class="w-64"
              />

              <!-- Selected filter chips -->
              {#if tables.improvements.filters.length > 0}
                <div class="flex flex-wrap gap-1">
                  {#each tables.improvements.filters as filter}
                    <span class="px-2 py-1 rounded bg-brown text-white text-xs">
                      {formatEnum(filter.replace("nation:", ""), "NATION_")}
                    </span>
                  {/each}
                </div>
              {/if}

              <!-- Results count -->
              <span class="text-brown text-sm ml-auto">
                {improvementPivotData().length} improvements
              </span>
            </div>

            <!-- Improvements pivot table -->
            <div class="overflow-x-auto rounded-lg" style="background-color: #201a13;">
              <table class="w-full">
                <thead>
                  <tr>
                    <!-- Improvement column header -->
                    <th
                      class="p-3 text-left border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                      onclick={() => toggleSort("improvements", "improvement")}
                    >
                      <span class="inline-flex items-center gap-1">
                        Improvement
                        {#if tables.improvements.sortColumn === "improvement"}
                          <span class="text-orange">
                            {tables.improvements.sortDirection === "asc" ? "↑" : "↓"}
                          </span>
                        {/if}
                      </span>
                    </th>
                    <!-- Nation column headers -->
                    {#each displayedImprovementNations as nation}
                      <th
                        class="p-3 text-center border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                        onclick={() => toggleSort("improvements", `nation:${nation}`)}
                      >
                        <span class="inline-flex items-center gap-1 justify-center">
                          {formatEnum(nation, "NATION_")}
                          {#if tables.improvements.sortColumn === `nation:${nation}`}
                            <span class="text-orange">
                              {tables.improvements.sortDirection === "asc" ? "↑" : "↓"}
                            </span>
                          {/if}
                        </span>
                      </th>
                    {/each}
                    <!-- Total column header (only if multiple nations) -->
                    {#if displayedImprovementNations.length > 1}
                      <th
                        class="p-3 text-center border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                        onclick={() => toggleSort("improvements", "total")}
                      >
                        <span class="inline-flex items-center gap-1 justify-center">
                          Total
                          {#if tables.improvements.sortColumn === "total"}
                            <span class="text-orange">
                              {tables.improvements.sortDirection === "asc" ? "↑" : "↓"}
                            </span>
                          {/if}
                        </span>
                      </th>
                    {/if}
                  </tr>
                </thead>
                <tbody>
                  {#each improvementPivotData() as row}
                    <tr class="hover:bg-brown/10">
                      <td class="p-3 text-left border-b border-brown/50 text-tan whitespace-nowrap">
                        {formatEnum(row.improvement, "IMPROVEMENT_")}
                      </td>
                      {#each displayedImprovementNations as nation}
                        <td class="p-3 text-center border-b border-brown/50 text-tan whitespace-nowrap">
                          {row.counts[nation] ?? 0}
                        </td>
                      {/each}
                      {#if displayedImprovementNations.length > 1}
                        <td class="p-3 text-center border-b border-brown/50 text-tan font-bold whitespace-nowrap">
                          {row.total}
                        </td>
                      {/if}
                    </tr>
                  {:else}
                    <tr>
                      <td colspan={displayedImprovementNations.length + (displayedImprovementNations.length > 1 ? 2 : 1)} class="p-8 text-center text-brown italic">
                        No improvements match search
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </Tabs.Content>

        <!-- Tab Content: Map -->
        <Tabs.Content
          value="map"
          class="p-8 border-2 border-black border-t-0 rounded-b-lg min-h-[400px] tab-pane"
          style="background-color: #35302B;"
        >
          <h2 class="text-tan font-bold mb-4 mt-0">World Map</h2>
          {#if mapTiles}
            <HexMap
              tiles={mapTiles}
              height="600px"
              totalTurns={gameDetails?.total_turns ?? null}
              selectedTurn={selectedMapTurn}
              onTurnChange={handleMapTurnChange}
            />
          {:else}
            <p class="text-brown italic">Loading map data...</p>
          {/if}
        </Tabs.Content>

        <!-- Tab Content: Settings -->
        <Tabs.Content
          value="settings"
          class="p-8 border-2 border-black border-t-0 rounded-b-lg min-h-[400px] tab-pane"
          style="background-color: #35302B;"
        >
          <h2 class="text-tan font-bold mb-4 mt-0">Game Settings</h2>
          <div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4 mb-8 p-4 rounded-lg border-2 border-black" style="background-color: #201a13;">
            {#if gameDetails.map_size}
              <div class="flex flex-col gap-1">
                <span class="font-bold text-brown text-sm">Map Size:</span>
                <span class="text-tan text-base">{formatEnum(gameDetails.map_size, "MAPSIZE_")}</span>
              </div>
            {/if}
            {#if gameDetails.map_width && gameDetails.map_height}
              <div class="flex flex-col gap-1">
                <span class="font-bold text-brown text-sm">Map Dimensions:</span>
                <span class="text-tan text-base">{gameDetails.map_width} × {gameDetails.map_height}</span>
              </div>
            {/if}
            {#if gameDetails.game_mode}
              <div class="flex flex-col gap-1">
                <span class="font-bold text-brown text-sm">Game Mode:</span>
                <span class="text-tan text-base">{gameDetails.game_mode}</span>
              </div>
            {/if}
            {#if gameDetails.difficulty}
              <div class="flex flex-col gap-1">
                <span class="font-bold text-brown text-sm">Difficulty:</span>
                <span class="text-tan text-base">{formatEnum(gameDetails.difficulty, "DIFFICULTY_")}</span>
              </div>
            {/if}
            {#if gameDetails.victory_conditions}
              <div class="flex flex-col gap-1">
                <span class="font-bold text-brown text-sm">Victory Conditions:</span>
                <span class="text-tan text-base">{victoryConditions}</span>
              </div>
            {/if}
            {#if gameDetails.enabled_dlc}
              <div class="flex flex-col gap-1">
                <span class="font-bold text-brown text-sm">DLC Enabled:</span>
                <span class="text-tan text-base">{dlcList}</span>
              </div>
            {/if}
            {#if gameDetails.enabled_mods}
              <div class="flex flex-col gap-1">
                <span class="font-bold text-brown text-sm">Mods Enabled:</span>
                <span class="text-tan text-base">{modsList}</span>
              </div>
            {/if}
          </div>

          <div class="mt-8 p-4 rounded-lg border-2 border-black" style="background-color: #201a13;">
            <h3 class="text-tan font-bold mb-4 mt-0 text-xl">Players</h3>
            <table class="w-full mt-2">
              <thead>
                <tr>
                  <th class="p-3 text-left border-b-2 border-brown text-brown font-bold">Player</th>
                  <th class="p-3 text-left border-b-2 border-brown text-brown font-bold">Nation</th>
                  <th class="p-3 text-left border-b-2 border-brown text-brown font-bold">Type</th>
                  <th class="p-3 text-left border-b-2 border-brown text-brown font-bold">Legitimacy</th>
                  <th class="p-3 text-left border-b-2 border-brown text-brown font-bold">State Religion</th>
                </tr>
              </thead>
              <tbody>
                {#each gameDetails.players as player}
                  <tr class="transition-colors duration-200 hover:bg-brown/20">
                    <td class="p-3 text-left border-b border-brown/50 text-tan">{player.player_name}</td>
                    <td class="p-3 text-left border-b border-brown/50 text-tan">{formatEnum(player.nation, "NATION_")}</td>
                    <td class="p-3 text-left border-b border-brown/50 text-tan">{player.is_human ? "Human" : "AI"}</td>
                    <td class="p-3 text-left border-b border-brown/50 text-tan">{player.legitimacy ?? "—"}</td>
                    <td class="p-3 text-left border-b border-brown/50 text-tan">{formatEnum(player.state_religion, "RELIGION_")}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </Tabs.Content>
      </Tabs.Root>
  </main>
{/if}

<style>
  /* Custom fade-in animation for tab switching */
  :global(.tab-pane) {
    animation: fadeIn 0.3s;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
