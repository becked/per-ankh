<script lang="ts">
  import { page } from "$app/stores";
  import { api } from "$lib/api";
  import type { GameDetails } from "$lib/types/GameDetails";
  import type { PlayerHistory } from "$lib/types/PlayerHistory";
  import type { YieldHistory } from "$lib/types/YieldHistory";
  import type { YieldDataPoint } from "$lib/types/YieldDataPoint";
  import type { EventLog } from "$lib/types/EventLog";
  import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
  import type { CityStatistics } from "$lib/types/CityStatistics";
  import type { CityInfo } from "$lib/types/CityInfo";
  import type { EChartsOption } from "echarts";
  import ChartContainer from "$lib/ChartContainer.svelte";
  import ChartSeriesFilter, { type SeriesInfo } from "$lib/ChartSeriesFilter.svelte";
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
  let cityStatistics = $state<CityStatistics | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let activeTab = $state<string>("events");

  // Event log filter state
  let searchTerm = $state("");
  let selectedFilters = $state<string[]>([]);  // Combined log types and players with prefixes

  // Event log sort state
  let eventLogSortColumn = $state<string>("turn");
  let eventLogSortDirection = $state<"asc" | "desc">("desc");

  // Chart series filter state - each chart has its own independent state
  let selectedPointsNations = $state<Record<string, boolean>>({});
  let selectedLawsNations = $state<Record<string, boolean>>({});
  let selectedMilitaryNations = $state<Record<string, boolean>>({});
  let selectedLegitimacyNations = $state<Record<string, boolean>>({});
  let selectedScienceNations = $state<Record<string, boolean>>({});
  let selectedCivicsNations = $state<Record<string, boolean>>({});
  let selectedTrainingNations = $state<Record<string, boolean>>({});
  let selectedGrowthNations = $state<Record<string, boolean>>({});
  let selectedCultureNations = $state<Record<string, boolean>>({});
  let selectedHappinessNations = $state<Record<string, boolean>>({});

  // City table state
  let citySearchTerm = $state("");
  let citySortColumn = $state<string>("owner_nation");
  let citySortDirection = $state<"asc" | "desc">("asc");

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

  // Filtered and sorted cities
  const filteredSortedCities = $derived(() => {
    if (!cityStatistics) return [];

    // Filter by search term
    let cities = cityStatistics.cities;
    if (citySearchTerm) {
      const term = citySearchTerm.toLowerCase();
      cities = cities.filter((city) =>
        city.city_name.toLowerCase().includes(term) ||
        (city.owner_nation?.toLowerCase().includes(term) ?? false) ||
        (city.family?.toLowerCase().includes(term) ?? false) ||
        (city.governor_name?.toLowerCase().includes(term) ?? false)
      );
    }

    // Sort
    const column = CITY_COLUMNS.find((col) => col.key === citySortColumn);
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

        return citySortDirection === "asc" ? cmp : -cmp;
      });
    }

    return cities;
  });

  // Toggle sort column/direction
  function toggleCitySort(columnKey: string) {
    if (citySortColumn === columnKey) {
      // Toggle direction if same column
      citySortDirection = citySortDirection === "asc" ? "desc" : "asc";
    } else {
      // New column, default to ascending
      citySortColumn = columnKey;
      citySortDirection = "asc";
    }
  }

  // Format cell value using column's format function or default
  function formatCityCell(column: CityColumn, city: CityInfo): string {
    const value = column.getValue(city);
    if (column.format) {
      return column.format(value, city);
    }
    return value?.toString() ?? "—";
  }

  // Derive series info from player history for the filter component
  const nationSeriesInfo = $derived<SeriesInfo[]>(
    playerHistory?.map((player, i) => ({
      name: formatEnum(player.nation, "NATION_"),
      color: getPlayerColor(player.nation, i),
    })) ?? []
  );

  // Derive series info from law adoption history (may have different players than playerHistory)
  const lawsSeriesInfo = $derived<SeriesInfo[]>(
    lawAdoptionHistory?.map((player, i) => ({
      name: formatEnum(player.nation, "NATION_"),
      color: getPlayerColor(player.nation, i),
    })) ?? []
  );

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
      selectedPointsNations = { ...defaultSelection };
      selectedMilitaryNations = { ...defaultSelection };
      selectedLegitimacyNations = { ...defaultSelection };
      selectedScienceNations = { ...defaultSelection };
      selectedCivicsNations = { ...defaultSelection };
      selectedTrainingNations = { ...defaultSelection };
      selectedGrowthNations = { ...defaultSelection };
      selectedCultureNations = { ...defaultSelection };
      selectedHappinessNations = { ...defaultSelection };
    }
  });

  // Initialize law adoption filter separately (uses lawAdoptionHistory data)
  $effect(() => {
    if (lawAdoptionHistory) {
      selectedLawsNations = createDefaultSelection(lawAdoptionHistory);
    }
  });

  // Parse selected filters back into separate arrays
  const selectedLogTypes = $derived(
    selectedFilters
      .filter(f => f.startsWith("logtype:"))
      .map(f => f.replace("logtype:", ""))
  );

  const selectedPlayers = $derived(
    selectedFilters
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
    "YIELD_HAPPINESS"
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
            selected: selectedPointsNations,
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
            selected: selectedMilitaryNations,
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
            selected: selectedLegitimacyNations,
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
  const scienceChartOption = $derived(createYieldChartOption("YIELD_SCIENCE", "Science Production", "Science per Turn", selectedScienceNations));
  const civicsChartOption = $derived(createYieldChartOption("YIELD_CIVICS", "Civics Production", "Civics per Turn", selectedCivicsNations));
  const trainingChartOption = $derived(createYieldChartOption("YIELD_TRAINING", "Training Production", "Training per Turn", selectedTrainingNations));
  const growthChartOption = $derived(createYieldChartOption("YIELD_GROWTH", "Growth Production", "Growth per Turn", selectedGrowthNations));
  const cultureChartOption = $derived(createYieldChartOption("YIELD_CULTURE", "Culture Production", "Culture per Turn", selectedCultureNations));
  const happinessChartOption = $derived(createYieldChartOption("YIELD_HAPPINESS", "Happiness Production", "Happiness per Turn", selectedHappinessNations));

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
              selected: selectedLawsNations,
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

  // Fetch game data when route changes
  $effect(() => {
    const matchId = Number($page.params.id);

    // Reset state for new game
    loading = true;
    error = null;
    activeTab = "events";
    eventLogSortColumn = "turn";
    eventLogSortDirection = "desc";
    citySortColumn = "owner_nation";
    citySortDirection = "asc";
    cityVisibleColumns = Object.fromEntries(
      CITY_COLUMNS.map((col) => [col.key, col.defaultVisible])
    );

    Promise.all([
      api.getGameDetails(matchId),
      api.getPlayerHistory(matchId),
      api.getYieldHistory(matchId, Array.from(YIELD_TYPES)),
      api.getEventLogs(matchId),
      api.getLawAdoptionHistory(matchId),
      api.getCityStatistics(matchId),
    ])
      .then(([details, history, yields, logs, lawHistory, cityStats]) => {
        gameDetails = details;
        playerHistory = history;
        allYields = yields;
        eventLogs = logs;
        lawAdoptionHistory = lawHistory;
        cityStatistics = cityStats;
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
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
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

      switch (eventLogSortColumn) {
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

      return eventLogSortDirection === "asc" ? cmp : -cmp;
    });

    return logs;
  });

  // Check if any filters are active
  const hasActiveFilters = $derived(
    searchTerm !== "" ||
    selectedFilters.length > 0
  );

  // Clear all filters
  function clearFilters() {
    searchTerm = "";
    selectedFilters = [];
  }

  // Toggle event log sort column/direction
  function toggleEventLogSort(columnKey: string) {
    if (eventLogSortColumn === columnKey) {
      // Toggle direction if same column
      eventLogSortDirection = eventLogSortDirection === "asc" ? "desc" : "asc";
    } else {
      // New column, default to ascending
      eventLogSortColumn = columnKey;
      eventLogSortDirection = "asc";
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
            Laws & Technology
          </Tabs.Trigger>

          <Tabs.Trigger
            value="economics"
            class="px-6 py-3 border-2 border-black border-b-0 border-r-0 font-bold cursor-pointer transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=active]:text-tan data-[state=inactive]:bg-[#2a2622] data-[state=inactive]:text-tan"
          >
            Economics
          </Tabs.Trigger>

          <Tabs.Trigger
            value="cities"
            class="px-6 py-3 border-2 border-black border-b-0 border-r-0 font-bold cursor-pointer transition-all duration-200 hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=active]:text-tan data-[state=inactive]:bg-[#2a2622] data-[state=inactive]:text-tan"
          >
            Cities
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
          {#if pointsChartOption}
            {#snippet pointsFilter()}
              {#if nationSeriesInfo.length > 0}
                <ChartSeriesFilter series={nationSeriesInfo} bind:selected={selectedPointsNations} />
              {/if}
            {/snippet}
            <ChartContainer option={pointsChartOption} height="400px" title="Victory Points" controls={pointsFilter} />
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
              <Select.Root type="multiple" bind:value={selectedFilters}>
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
                bind:value={searchTerm}
                variant="field"
                class="w-96"
              />

              <!-- Selected filter chips -->
              {#if selectedFilters.length > 0}
                <div class="flex flex-wrap gap-1">
                  {#each selectedFilters as filter}
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
                      onclick={() => toggleEventLogSort("turn")}
                    >
                      <span class="inline-flex items-center gap-1">
                        Turn
                        {#if eventLogSortColumn === "turn"}
                          <span class="text-orange">{eventLogSortDirection === "asc" ? "↑" : "↓"}</span>
                        {/if}
                      </span>
                    </th>
                    <th
                      class="p-3 text-left border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                      onclick={() => toggleEventLogSort("log_type")}
                    >
                      <span class="inline-flex items-center gap-1">
                        Log Type
                        {#if eventLogSortColumn === "log_type"}
                          <span class="text-orange">{eventLogSortDirection === "asc" ? "↑" : "↓"}</span>
                        {/if}
                      </span>
                    </th>
                    {#if showPlayerColumn}
                      <th
                        class="p-3 text-left border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                        onclick={() => toggleEventLogSort("player_name")}
                      >
                        <span class="inline-flex items-center gap-1">
                          Player
                          {#if eventLogSortColumn === "player_name"}
                            <span class="text-orange">{eventLogSortDirection === "asc" ? "↑" : "↓"}</span>
                          {/if}
                        </span>
                      </th>
                    {/if}
                    <th
                      class="p-3 text-left border-b-2 border-brown text-brown font-bold cursor-pointer hover:bg-brown/20 select-none whitespace-nowrap"
                      onclick={() => toggleEventLogSort("description")}
                    >
                      <span class="inline-flex items-center gap-1">
                        Description
                        {#if eventLogSortColumn === "description"}
                          <span class="text-orange">{eventLogSortDirection === "asc" ? "↑" : "↓"}</span>
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
          <h2 class="text-tan font-bold mb-4 mt-0">Laws & Technology</h2>
          {#if lawAdoptionChartOption}
            {#snippet lawsFilter()}
              {#if lawsSeriesInfo.length > 0}
                <ChartSeriesFilter series={lawsSeriesInfo} bind:selected={selectedLawsNations} />
              {/if}
            {/snippet}
            <ChartContainer option={lawAdoptionChartOption} height="400px" title="Law Adoption Over Time" controls={lawsFilter} />
          {:else if lawAdoptionHistory !== null && lawAdoptionHistory.length === 0}
            <p class="text-brown italic text-center p-8">No law adoption data available</p>
          {:else}
            <p class="text-brown italic text-center p-8">Loading law adoption data...</p>
          {/if}
        </Tabs.Content>

        <!-- Tab Content: Economics -->
        <Tabs.Content
          value="economics"
          class="p-8 border-2 border-black border-t-0 rounded-b-lg min-h-[400px] tab-pane"
          style="background-color: #35302B;"
        >
          <h2 class="text-tan font-bold mb-4 mt-0">Economics</h2>
          {#if militaryChartOption}
            {#snippet militaryFilter()}
              {#if nationSeriesInfo.length > 0}
                <ChartSeriesFilter series={nationSeriesInfo} bind:selected={selectedMilitaryNations} />
              {/if}
            {/snippet}
            <ChartContainer option={militaryChartOption} height="400px" title="Military Power" controls={militaryFilter} />
          {/if}

          {#if legitimacyChartOption}
            {#snippet legitimacyFilter()}
              {#if nationSeriesInfo.length > 0}
                <ChartSeriesFilter series={nationSeriesInfo} bind:selected={selectedLegitimacyNations} />
              {/if}
            {/snippet}
            <ChartContainer option={legitimacyChartOption} height="400px" title="Legitimacy" controls={legitimacyFilter} />
          {/if}

          {#if allYields === null}
            <p class="text-brown italic text-center p-8">Loading yield data...</p>
          {:else if allYields.length === 0}
            <p class="text-brown italic text-center p-8">No yield data available</p>
          {:else}
            {#if scienceChartOption}
              {#snippet scienceFilter()}
                {#if nationSeriesInfo.length > 0}
                  <ChartSeriesFilter series={nationSeriesInfo} bind:selected={selectedScienceNations} />
                {/if}
              {/snippet}
              <ChartContainer option={scienceChartOption} height="400px" title="Science Production" controls={scienceFilter} />
            {/if}

            {#if civicsChartOption}
              {#snippet civicsFilter()}
                {#if nationSeriesInfo.length > 0}
                  <ChartSeriesFilter series={nationSeriesInfo} bind:selected={selectedCivicsNations} />
                {/if}
              {/snippet}
              <ChartContainer option={civicsChartOption} height="400px" title="Civics Production" controls={civicsFilter} />
            {/if}

            {#if trainingChartOption}
              {#snippet trainingFilter()}
                {#if nationSeriesInfo.length > 0}
                  <ChartSeriesFilter series={nationSeriesInfo} bind:selected={selectedTrainingNations} />
                {/if}
              {/snippet}
              <ChartContainer option={trainingChartOption} height="400px" title="Training Production" controls={trainingFilter} />
            {/if}

            {#if growthChartOption}
              {#snippet growthFilter()}
                {#if nationSeriesInfo.length > 0}
                  <ChartSeriesFilter series={nationSeriesInfo} bind:selected={selectedGrowthNations} />
                {/if}
              {/snippet}
              <ChartContainer option={growthChartOption} height="400px" title="Growth Production" controls={growthFilter} />
            {/if}

            {#if cultureChartOption}
              {#snippet cultureFilter()}
                {#if nationSeriesInfo.length > 0}
                  <ChartSeriesFilter series={nationSeriesInfo} bind:selected={selectedCultureNations} />
                {/if}
              {/snippet}
              <ChartContainer option={cultureChartOption} height="400px" title="Culture Production" controls={cultureFilter} />
            {/if}

            {#if happinessChartOption}
              {#snippet happinessFilter()}
                {#if nationSeriesInfo.length > 0}
                  <ChartSeriesFilter series={nationSeriesInfo} bind:selected={selectedHappinessNations} />
                {/if}
              {/snippet}
              <ChartContainer option={happinessChartOption} height="400px" title="Happiness Production" controls={happinessFilter} />
            {/if}
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
              <!-- Search -->
              <SearchInput
                bind:value={citySearchTerm}
                placeholder="Search"
                variant="field"
                class="w-64"
              />

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
                        onclick={() => toggleCitySort(column.key)}
                      >
                        <span class="inline-flex items-center gap-1">
                          {column.label}
                          {#if citySortColumn === column.key}
                            <span class="text-orange">
                              {citySortDirection === "asc" ? "↑" : "↓"}
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
