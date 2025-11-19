<script lang="ts">
  import { page } from "$app/stores";
  import { api } from "$lib/api";
  import type { GameDetails } from "$lib/types/GameDetails";
  import type { PlayerHistory } from "$lib/types/PlayerHistory";
  import type { YieldHistory } from "$lib/types/YieldHistory";
  import type { YieldDataPoint } from "$lib/types/YieldDataPoint";
  import type { EventLog } from "$lib/types/EventLog";
  import type { EChartsOption } from "echarts";
  import Chart from "$lib/Chart.svelte";
  import { Tabs, Combobox } from "bits-ui";
  import { formatEnum, formatDate, formatGameTitle, formatMapClass, stripMarkup } from "$lib/utils/formatting";
  import { CHART_THEME, getChartColor, getCivilizationColor } from "$lib/config";

  let gameDetails = $state<GameDetails | null>(null);
  let playerHistory = $state<PlayerHistory[] | null>(null);
  let allYields = $state<YieldHistory[] | null>(null);
  let eventLogs = $state<EventLog[] | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let activeTab = $state<string>("events");

  // Event log filter state
  let searchTerm = $state("");
  let selectedLogTypes = $state<string[]>([]);
  let selectedPlayers = $state<string[]>([]);

  // Combobox search state
  let logTypeSearch = $state("");
  let playerSearch = $state("");

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
            data: playerHistory.map((p) => p.player_name),
            top: 30,
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
            name: player.player_name,
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
            data: playerHistory.map((p) => p.player_name),
            top: 30,
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
            name: player.player_name,
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
            data: playerHistory.map((p) => p.player_name),
            top: 30,
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
            name: player.player_name,
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
      legend: {
        data: yieldData.map((y) => y.player_name),
        top: 30,
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
        name: playerYield.player_name,
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

  // Reactively load game details when the route parameter changes
  $effect(() => {
    const matchId = Number($page.params.id);

    loading = true;
    error = null;
    gameDetails = null;
    playerHistory = null;
    allYields = null;
    eventLogs = null;

    Promise.all([
      api.getGameDetails(matchId),
      api.getPlayerHistory(matchId),
      api.getYieldHistory(matchId, Array.from(YIELD_TYPES)),
      api.getEventLogs(matchId),
    ])
      .then(([details, history, yields, logs]) => {
        gameDetails = details;
        playerHistory = history;
        allYields = yields;
        eventLogs = logs;
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

  // Filtered log types for combobox search
  const filteredLogTypes = $derived(
    logTypeSearch === ""
      ? uniqueLogTypes
      : uniqueLogTypes.filter(type =>
          formatEnum(type, "").toLowerCase().includes(logTypeSearch.toLowerCase())
        )
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

  // Filtered players for combobox search
  const filteredPlayers = $derived(
    playerSearch === ""
      ? uniquePlayers
      : uniquePlayers.filter(player =>
          player.toLowerCase().includes(playerSearch.toLowerCase())
        )
  );

  // Apply filters to event logs
  const filteredEventLogs = $derived(
    processedEventLogs?.filter(log => {
      // Search filter (case-insensitive)
      if (searchTerm && !log.description?.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
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
    selectedLogTypes.length > 0 ||
    selectedPlayers.length > 0
  );

  // Clear all filters
  function clearFilters() {
    searchTerm = "";
    selectedLogTypes = [];
    selectedPlayers = [];
    logTypeSearch = "";
    playerSearch = "";
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
            <div class="p-1 border-2 border-tan rounded-lg mb-6" style="background-color: var(--color-chart-frame)">
              <Chart option={pointsChartOption} height="400px" />
            </div>
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
              <!-- Log Type -->
              <div class="flex flex-col gap-1">
                <span class="text-brown text-xs font-bold">Log Type</span>
                <Combobox.Root type="multiple" bind:value={selectedLogTypes}>
                  <div class="relative">
                    <Combobox.Input
                      oninput={(e) => (logTypeSearch = e.currentTarget.value)}
                      placeholder={selectedLogTypes.length > 0 ? `${selectedLogTypes.length} selected` : "Select types..."}
                      class="px-3 py-2 rounded border-2 border-black bg-white text-black text-sm w-40"
                    />
                    <Combobox.Trigger class="absolute right-2 top-1/2 -translate-y-1/2 text-black">
                      ▼
                    </Combobox.Trigger>
                  </div>
                  <Combobox.Portal>
                    <Combobox.Content class="bg-white border-2 border-black rounded shadow-lg max-h-48 overflow-y-auto z-50">
                      {#each filteredLogTypes as logType}
                        <Combobox.Item
                          value={logType}
                          label={formatEnum(logType, "")}
                          class="px-3 py-2 cursor-pointer hover:bg-tan text-black text-sm flex justify-between items-center data-[highlighted]:bg-tan"
                        >
                          {#snippet children({ selected })}
                            {formatEnum(logType, "")}
                            {#if selected}
                              <span class="text-brown font-bold">✓</span>
                            {/if}
                          {/snippet}
                        </Combobox.Item>
                      {:else}
                        <div class="px-3 py-2 text-brown text-sm italic">No matches</div>
                      {/each}
                    </Combobox.Content>
                  </Combobox.Portal>
                </Combobox.Root>
              </div>

              <!-- Player (only show if player column is visible) -->
              {#if showPlayerColumn && uniquePlayers.length > 0}
                <div class="flex flex-col gap-1">
                  <span class="text-brown text-xs font-bold">Player</span>
                  <Combobox.Root type="multiple" bind:value={selectedPlayers}>
                    <div class="relative">
                      <Combobox.Input
                        oninput={(e) => (playerSearch = e.currentTarget.value)}
                        placeholder={selectedPlayers.length > 0 ? `${selectedPlayers.length} selected` : "Select players..."}
                        class="px-3 py-2 rounded border-2 border-black bg-white text-black text-sm w-40"
                      />
                      <Combobox.Trigger class="absolute right-2 top-1/2 -translate-y-1/2 text-black">
                        ▼
                      </Combobox.Trigger>
                    </div>
                    <Combobox.Portal>
                      <Combobox.Content class="bg-white border-2 border-black rounded shadow-lg max-h-48 overflow-y-auto z-50">
                        {#each filteredPlayers as player}
                          <Combobox.Item
                            value={player}
                            label={player}
                            class="px-3 py-2 cursor-pointer hover:bg-tan text-black text-sm flex justify-between items-center data-[highlighted]:bg-tan"
                          >
                            {#snippet children({ selected })}
                              {player}
                              {#if selected}
                                <span class="text-brown font-bold">✓</span>
                              {/if}
                            {/snippet}
                          </Combobox.Item>
                        {:else}
                          <div class="px-3 py-2 text-brown text-sm italic">No matches</div>
                        {/each}
                      </Combobox.Content>
                    </Combobox.Portal>
                  </Combobox.Root>
                </div>
              {/if}

              <!-- Search (Description) -->
              <div class="flex flex-col gap-1">
                <label for="search" class="text-brown text-xs font-bold">Search</label>
                <input
                  id="search"
                  type="text"
                  bind:value={searchTerm}
                  placeholder="Filter by description..."
                  class="px-3 py-2 rounded border-2 border-black bg-white text-black text-sm w-48"
                />
              </div>

              <!-- Clear button -->
              {#if hasActiveFilters}
                <button
                  onclick={clearFilters}
                  class="px-3 py-2 rounded border-2 border-black bg-brown text-white text-sm font-bold hover:bg-tan hover:text-black transition-colors"
                >
                  Clear
                </button>
              {/if}

              <!-- Results count -->
              <span class="text-brown text-sm ml-auto">
                {filteredEventLogs?.length ?? 0} / {processedEventLogs.length} events
              </span>
            </div>

            <div class="overflow-x-auto rounded-lg" style="background-color: #c5c3c2;">
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
          <p class="text-brown italic text-center p-8 text-lg">Coming soon...</p>
        </Tabs.Content>

        <!-- Tab Content: Economics -->
        <Tabs.Content
          value="economics"
          class="p-8 border-2 border-black border-t-0 rounded-b-lg min-h-[400px] tab-pane"
          style="background-color: #35302B;"
        >
          <h2 class="text-tan font-bold mb-4 mt-0">Economics</h2>
          {#if militaryChartOption}
            <div class="p-1 border-2 border-tan rounded-lg mb-6" style="background-color: var(--color-chart-frame)">
              <Chart option={militaryChartOption} height="400px" />
            </div>
          {/if}

          {#if legitimacyChartOption}
            <div class="p-1 border-2 border-tan rounded-lg mb-6" style="background-color: var(--color-chart-frame)">
              <Chart option={legitimacyChartOption} height="400px" />
            </div>
          {/if}

          {#if allYields === null}
            <p class="text-brown italic text-center p-8">Loading yield data...</p>
          {:else if allYields.length === 0}
            <p class="text-brown italic text-center p-8">No yield data available</p>
          {:else}
            {#if scienceChartOption}
              <div class="p-1 border-2 border-tan rounded-lg mb-6" style="background-color: var(--color-chart-frame)">
                <Chart option={scienceChartOption} height="400px" />
              </div>
            {/if}

            {#if civicsChartOption}
              <div class="p-1 border-2 border-tan rounded-lg mb-6" style="background-color: var(--color-chart-frame)">
                <Chart option={civicsChartOption} height="400px" />
              </div>
            {/if}

            {#if trainingChartOption}
              <div class="p-1 border-2 border-tan rounded-lg mb-6" style="background-color: var(--color-chart-frame)">
                <Chart option={trainingChartOption} height="400px" />
              </div>
            {/if}

            {#if growthChartOption}
              <div class="p-1 border-2 border-tan rounded-lg mb-6" style="background-color: var(--color-chart-frame)">
                <Chart option={growthChartOption} height="400px" />
              </div>
            {/if}

            {#if cultureChartOption}
              <div class="p-1 border-2 border-tan rounded-lg mb-6" style="background-color: var(--color-chart-frame)">
                <Chart option={cultureChartOption} height="400px" />
              </div>
            {/if}

            {#if happinessChartOption}
              <div class="p-1 border-2 border-tan rounded-lg mb-6" style="background-color: var(--color-chart-frame)">
                <Chart option={happinessChartOption} height="400px" />
              </div>
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
