<script lang="ts">
  import { page } from "$app/stores";
  import { api } from "$lib/api";
  import type { GameDetails } from "$lib/types/GameDetails";
  import type { PlayerHistory } from "$lib/types/PlayerHistory";
  import type { YieldHistory } from "$lib/types/YieldHistory";
  import type { YieldDataPoint } from "$lib/types/YieldDataPoint";
  import type { EventLog } from "$lib/types/EventLog";
  import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
  import type { EChartsOption } from "echarts";
  import ChartContainer from "$lib/ChartContainer.svelte";
  import ChartSeriesFilter, { type SeriesInfo } from "$lib/ChartSeriesFilter.svelte";
  import SearchInput from "$lib/SearchInput.svelte";
  import { Tabs, Select } from "bits-ui";
  import { formatEnum, formatDate, formatGameTitle, formatMapClass, stripMarkup } from "$lib/utils/formatting";
  import { CHART_THEME, getChartColor, getCivilizationColor } from "$lib/config";

  let gameDetails = $state<GameDetails | null>(null);
  let playerHistory = $state<PlayerHistory[] | null>(null);
  let allYields = $state<YieldHistory[] | null>(null);
  let eventLogs = $state<EventLog[] | null>(null);
  let lawAdoptionHistory = $state<LawAdoptionHistory[] | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let activeTab = $state<string>("events");

  // Event log filter state
  let searchTerm = $state("");
  let selectedFilters = $state<string[]>([]);  // Combined log types and players with prefixes

  // Chart series filter state (shared across all nation-based charts)
  let selectedNations = $state<Record<string, boolean>>({});

  // Derive series info from law adoption history for the filter component
  const nationSeriesInfo = $derived<SeriesInfo[]>(
    lawAdoptionHistory?.map((player, i) => ({
      name: formatEnum(player.nation, "NATION_"),
      color: getPlayerColor(player.nation, i),
    })) ?? []
  );

  // Initialize filter state when data loads - select all nations by default
  $effect(() => {
    if (lawAdoptionHistory && Object.keys(selectedNations).length === 0) {
      selectedNations = Object.fromEntries(
        lawAdoptionHistory.map((player) => [
          formatEnum(player.nation, "NATION_"),
          true,
        ])
      );
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
  function createYieldChartOption(yieldType: string, title: string, yAxisLabel: string): EChartsOption | null {
    if (!allYields || allYields.length === 0) return null;

    const yieldData = allYields.filter(y => y.yield_type === yieldType);
    if (yieldData.length === 0) return null;

    return {
      ...CHART_THEME,
      title: {
        ...CHART_THEME.title,
        text: title,
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

  // Create chart options for each yield type
  const scienceChartOption = $derived(createYieldChartOption("YIELD_SCIENCE", "Science Production", "Science per Turn"));
  const civicsChartOption = $derived(createYieldChartOption("YIELD_CIVICS", "Civics Production", "Civics per Turn"));
  const trainingChartOption = $derived(createYieldChartOption("YIELD_TRAINING", "Training Production", "Training per Turn"));
  const growthChartOption = $derived(createYieldChartOption("YIELD_GROWTH", "Growth Production", "Growth per Turn"));
  const cultureChartOption = $derived(createYieldChartOption("YIELD_CULTURE", "Culture Production", "Culture per Turn"));
  const happinessChartOption = $derived(createYieldChartOption("YIELD_HAPPINESS", "Happiness Production", "Happiness per Turn"));

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
              selected: selectedNations,
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

  // Reactively load game details when the route parameter changes
  $effect(() => {
    const matchId = Number($page.params.id);

    loading = true;
    error = null;
    gameDetails = null;
    playerHistory = null;
    allYields = null;
    eventLogs = null;
    lawAdoptionHistory = null;

    Promise.all([
      api.getGameDetails(matchId),
      api.getPlayerHistory(matchId),
      api.getYieldHistory(matchId, Array.from(YIELD_TYPES)),
      api.getEventLogs(matchId),
      api.getLawAdoptionHistory(matchId),
    ])
      .then(([details, history, yields, logs, lawHistory]) => {
        gameDetails = details;
        playerHistory = history;
        allYields = yields;
        eventLogs = logs;
        lawAdoptionHistory = lawHistory;
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
      human_nation: humanNation,
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


  // Apply filters to event logs
  const filteredEventLogs = $derived(
    processedEventLogs?.filter(log => {
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
    }) ?? null
  );

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
</script>

<main class="flex-1 pt-4 px-4 pb-8 overflow-y-auto bg-blue-gray">
    {#if loading}
      <p>Loading game details...</p>
    {:else if error}
      <p class="text-white bg-brown p-4 border-2 border-orange rounded font-bold">Error: {error}</p>
    {:else if gameDetails}
      <div class="flex justify-between items-baseline mb-8">
        <h1 class="text-gray-200 text-3xl font-bold">{gameTitle}</h1>
        <p class="text-brown text-sm">{formatDate(gameDetails.save_date)}</p>
      </div>

      <!-- Summary Section -->
      <div class="p-2 border-2 border-black rounded-lg mb-6" style="background-color: #36302a;">
        <div class="flex justify-evenly">
          <!-- Left Column: Player, Winner & Victory Type -->
          <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-2 items-center">
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
          <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-2 items-center">
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
              <Select.Root type="multiple" bind:value={selectedFilters}>
                <Select.Trigger class="pl-9 pr-8 py-2 rounded border-2 border-black bg-white text-black text-sm w-32 flex items-center justify-between relative">
                  <div class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h18M5 8h14M7 12h10M9 16h6" />
                    </svg>
                  </div>
                  <span class="truncate">Filter</span>
                  <span class="ml-2">▼</span>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content class="bg-white border-2 border-black rounded shadow-lg max-h-64 overflow-y-auto z-50">
                    <Select.Viewport>
                      <!-- Players Group (only show if player column is visible) -->
                      {#if showPlayerColumn && uniquePlayers.length > 0}
                        <Select.Group>
                          <Select.GroupHeading class="px-3 py-2 text-brown text-xs font-bold uppercase tracking-wide border-b border-gray-200">
                            Players
                          </Select.GroupHeading>
                          {#each uniquePlayers as player}
                            <Select.Item
                              value={`player:${player}`}
                              label={player}
                              class="px-3 py-2 cursor-pointer hover:bg-tan-hover text-black text-sm flex justify-between items-center data-[highlighted]:bg-tan-hover"
                            >
                              {#snippet children({ selected })}
                                {player}
                                {#if selected}
                                  <span class="text-brown font-bold">✓</span>
                                {/if}
                              {/snippet}
                            </Select.Item>
                          {/each}
                        </Select.Group>
                      {/if}

                      <!-- Log Types Group -->
                      {#if uniqueLogTypes.length > 0}
                        <Select.Group>
                          <Select.GroupHeading class="px-3 py-2 text-brown text-xs font-bold uppercase tracking-wide border-b border-gray-200 {showPlayerColumn && uniquePlayers.length > 0 ? 'border-t' : ''}">
                            Log Types
                          </Select.GroupHeading>
                          {#each uniqueLogTypes as logType}
                            <Select.Item
                              value={`logtype:${logType}`}
                              label={formatEnum(logType, "")}
                              class="px-3 py-2 cursor-pointer hover:bg-tan-hover text-black text-sm flex justify-between items-center data-[highlighted]:bg-tan-hover"
                            >
                              {#snippet children({ selected })}
                                {formatEnum(logType, "")}
                                {#if selected}
                                  <span class="text-brown font-bold">✓</span>
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
                variant="light"
                class="w-96"
              />

              <!-- Clear button -->
              {#if hasActiveFilters}
                <button
                  onclick={clearFilters}
                  class="px-3 py-2 rounded border-2 border-black bg-orange text-black text-sm font-bold hover:bg-tan transition-colors"
                >
                  Clear
                </button>
              {/if}

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
                {filteredEventLogs?.length ?? 0} / {processedEventLogs.length} events
              </span>
            </div>

            <div class="overflow-x-auto rounded-lg min-h-[36rem]" style="background-color: #c5c3c2;">
              <table class="w-full">
                <thead>
                  <tr>
                    <th class="p-3 text-left border-b-2 border-black text-black font-bold">Turn</th>
                    <th class="p-3 text-left border-b-2 border-black text-black font-bold">Log Type</th>
                    {#if showPlayerColumn}
                      <th class="p-3 text-left border-b-2 border-black text-black font-bold">Player</th>
                    {/if}
                    <th class="p-3 text-left border-b-2 border-black text-black font-bold">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {#if filteredEventLogs && filteredEventLogs.length > 0}
                    {#each filteredEventLogs as log}
                      <tr class="transition-colors duration-200 hover:bg-tan">
                        <td class="p-3 text-left border-b-2 border-tan text-black">{log.turn}</td>
                        <td class="p-3 text-left border-b-2 border-tan text-black">
                          <code class="text-sm">{formatEnum(log.log_type, "")}</code>
                        </td>
                        {#if showPlayerColumn}
                          <td class="p-3 text-left border-b-2 border-tan text-black">{log.player_name ?? ""}</td>
                        {/if}
                        <td class="p-3 text-left border-b-2 border-tan text-black">{log.description || "—"}</td>
                      </tr>
                    {/each}
                  {:else}
                    <tr>
                      <td colspan={showPlayerColumn ? 4 : 3} class="p-8 text-center text-brown italic">
                        No events match filters
                      </td>
                    </tr>
                  {/if}
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
            <!-- Nation filter for chart series -->
            {#if nationSeriesInfo.length > 0}
              <div class="mb-4">
                <ChartSeriesFilter series={nationSeriesInfo} bind:selected={selectedNations} />
              </div>
            {/if}
            <ChartContainer option={lawAdoptionChartOption} height="400px" title="Law Adoption Over Time" />
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
            <ChartContainer option={militaryChartOption} height="400px" title="Military Power" />
          {/if}

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
          {/if}
        </Tabs.Content>

        <!-- Tab Content: Settings -->
        <Tabs.Content
          value="settings"
          class="p-8 border-2 border-black border-t-0 rounded-b-lg min-h-[400px] tab-pane"
          style="background-color: #35302B;"
        >
          <h2 class="text-tan font-bold mb-4 mt-0">Game Settings</h2>
          <div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4 mb-8 p-4 rounded-lg" style="background-color: #c5c3c2;">
            {#if gameDetails.map_size}
              <div class="flex flex-col gap-1">
                <span class="font-bold text-brown text-sm">Map Size:</span>
                <span class="text-black text-base">{formatEnum(gameDetails.map_size, "MAPSIZE_")}</span>
              </div>
            {/if}
            {#if gameDetails.map_width && gameDetails.map_height}
              <div class="flex flex-col gap-1">
                <span class="font-bold text-brown text-sm">Map Dimensions:</span>
                <span class="text-black text-base">{gameDetails.map_width} × {gameDetails.map_height}</span>
              </div>
            {/if}
            {#if gameDetails.game_mode}
              <div class="flex flex-col gap-1">
                <span class="font-bold text-brown text-sm">Game Mode:</span>
                <span class="text-black text-base">{gameDetails.game_mode}</span>
              </div>
            {/if}
            {#if gameDetails.opponent_level}
              <div class="flex flex-col gap-1">
                <span class="font-bold text-brown text-sm">Difficulty:</span>
                <span class="text-black text-base">{formatEnum(gameDetails.opponent_level, "LEVEL_")}</span>
              </div>
            {/if}
            {#if gameDetails.victory_conditions}
              <div class="flex flex-col gap-1">
                <span class="font-bold text-brown text-sm">Victory Conditions:</span>
                <span class="text-black text-base">{victoryConditions}</span>
              </div>
            {/if}
            {#if gameDetails.enabled_dlc}
              <div class="flex flex-col gap-1">
                <span class="font-bold text-brown text-sm">DLC Enabled:</span>
                <span class="text-black text-base">{dlcList}</span>
              </div>
            {/if}
          </div>

          <div class="mt-8 p-4 rounded-lg" style="background-color: #c5c3c2;">
            <h3 class="text-black font-bold mb-4 mt-0 text-xl">Players</h3>
            <table class="w-full mt-2">
              <thead>
                <tr>
                  <th class="p-3 text-left border-b-2 border-black text-black font-bold">Player</th>
                  <th class="p-3 text-left border-b-2 border-black text-black font-bold">Nation</th>
                  <th class="p-3 text-left border-b-2 border-black text-black font-bold">Type</th>
                  <th class="p-3 text-left border-b-2 border-black text-black font-bold">Legitimacy</th>
                  <th class="p-3 text-left border-b-2 border-black text-black font-bold">State Religion</th>
                </tr>
              </thead>
              <tbody>
                {#each gameDetails.players as player}
                  <tr class="transition-colors duration-200 hover:bg-tan">
                    <td class="p-3 text-left border-b-2 border-tan text-black">{player.player_name}</td>
                    <td class="p-3 text-left border-b-2 border-tan text-black">{formatEnum(player.nation, "NATION_")}</td>
                    <td class="p-3 text-left border-b-2 border-tan text-black">{player.is_human ? "Human" : "AI"}</td>
                    <td class="p-3 text-left border-b-2 border-tan text-black">{player.legitimacy ?? "—"}</td>
                    <td class="p-3 text-left border-b-2 border-tan text-black">{formatEnum(player.state_religion, "RELIGION_")}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    {/if}
</main>

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
