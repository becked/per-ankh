<script lang="ts">
  import { page } from "$app/stores";
  import { api } from "$lib/api";
  import type { GameDetails, PlayerHistory, YieldHistory } from "$lib/types";
  import type { EChartsOption } from "echarts";
  import Chart from "$lib/Chart.svelte";
  import { Tabs } from "bits-ui";
  import { formatEnum } from "$lib/utils/formatting";
  import { CHART_THEME, getChartColor, getCivilizationColor } from "$lib/config";

  let gameDetails = $state<GameDetails | null>(null);
  let playerHistory = $state<PlayerHistory[] | null>(null);
  let yieldHistory = $state<YieldHistory[] | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let activeTab = $state<string>("events");

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

  const scienceChartOption = $derived<EChartsOption | null>(
    yieldHistory && yieldHistory.length > 0
      ? {
          ...CHART_THEME,
          title: {
            ...CHART_THEME.title,
            text: "Science Production",
          },
          legend: {
            data: yieldHistory.map((y) => y.player_name),
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
            data: yieldHistory[0]?.data.map((d) => d.turn) ?? [],
          },
          yAxis: {
            type: "value",
            name: "Science per Turn",
            nameLocation: "middle",
            nameGap: 40,
          },
          series: yieldHistory.map((playerYield, i) => ({
            name: playerYield.player_name,
            type: "line",
            data: playerYield.data.map((d) => d.amount),
            itemStyle: { color: getPlayerColor(playerYield.nation, i) },
          })),
        }
      : null
  );

  // Reactively load game details when the route parameter changes
  $effect(() => {
    const matchId = Number($page.params.id);

    loading = true;
    error = null;
    gameDetails = null;
    playerHistory = null;
    yieldHistory = null;

    Promise.all([
      api.getGameDetails(matchId),
      api.getPlayerHistory(matchId),
      api.getYieldHistory(matchId, ["YIELD_SCIENCE"]),
    ])
      .then(([details, history, yields]) => {
        gameDetails = details;
        playerHistory = history;
        yieldHistory = yields;
      })
      .catch((err) => {
        error = String(err);
      })
      .finally(() => {
        loading = false;
      });
  });

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "Unknown";
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  }

  // Get the human player's nation
  const humanNation = $derived(
    gameDetails?.players.find((p) => p.is_human)?.nation ?? null
  );
</script>

<main class="flex-1 pt-4 px-8 pb-8 overflow-y-auto bg-blue-gray">
    {#if loading}
      <p>Loading game details...</p>
    {:else if error}
      <p class="text-white bg-brown p-4 border-2 border-orange rounded font-bold">Error: {error}</p>
    {:else if gameDetails}
      <h1 class="mb-8 text-gray-200 text-2xl font-bold border-b-[3px] border-orange pb-2">{gameDetails.game_name || `Game ${gameDetails.match_id}`}</h1>

      <!-- Summary Section -->
      <div class="bg-gray-200 p-6 border-2 border-black rounded-lg mb-6">
        <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-6">
          <div class="flex flex-col gap-2 text-center">
            <span class="font-bold text-brown text-sm uppercase tracking-wide">Save Date</span>
            <span class="text-black text-2xl font-bold">{formatDate(gameDetails.save_date)}</span>
          </div>
          <div class="flex flex-col gap-2 text-center">
            <span class="font-bold text-brown text-sm uppercase tracking-wide">Players</span>
            <span class="text-black text-2xl font-bold">{gameDetails.players.length}</span>
          </div>
          <div class="flex flex-col gap-2 text-center">
            <span class="font-bold text-brown text-sm uppercase tracking-wide">Human Nation</span>
            <span class="text-black text-2xl font-bold">{formatEnum(humanNation, "NATION_")}</span>
          </div>
          <div class="flex flex-col gap-2 text-center">
            <span class="font-bold text-brown text-sm uppercase tracking-wide">Turns</span>
            <span class="text-black text-2xl font-bold">{gameDetails.total_turns}</span>
          </div>
        </div>
      </div>

      <!-- Tabs with Bits UI -->
      <Tabs.Root bind:value={activeTab}>
        <!-- Tab Navigation -->
        <Tabs.List class="flex gap-2 mb-6 border-b-2 border-black">
          <Tabs.Trigger
            value="events"
            class="px-6 py-3 border-2 border-black border-b-0 rounded-t-lg font-bold text-black cursor-pointer transition-all duration-200 relative -bottom-0.5 hover:bg-tan-hover data-[state=active]:bg-gray-200 data-[state=inactive]:bg-tan"
          >
            Events
          </Tabs.Trigger>

          <Tabs.Trigger
            value="laws"
            class="px-6 py-3 border-2 border-black border-b-0 rounded-t-lg font-bold text-black cursor-pointer transition-all duration-200 relative -bottom-0.5 hover:bg-tan-hover data-[state=active]:bg-gray-200 data-[state=inactive]:bg-tan"
          >
            Laws & Technology
          </Tabs.Trigger>

          <Tabs.Trigger
            value="economics"
            class="px-6 py-3 border-2 border-black border-b-0 rounded-t-lg font-bold text-black cursor-pointer transition-all duration-200 relative -bottom-0.5 hover:bg-tan-hover data-[state=active]:bg-gray-200 data-[state=inactive]:bg-tan"
          >
            Economics
          </Tabs.Trigger>

          <Tabs.Trigger
            value="settings"
            class="px-6 py-3 border-2 border-black border-b-0 rounded-t-lg font-bold text-black cursor-pointer transition-all duration-200 relative -bottom-0.5 hover:bg-tan-hover data-[state=active]:bg-gray-200 data-[state=inactive]:bg-tan"
          >
            Game Settings
          </Tabs.Trigger>
        </Tabs.List>

        <!-- Tab Content: Events -->
        <Tabs.Content
          value="events"
          class="bg-gray-200 p-8 border-2 border-black rounded-b-lg rounded-tr-lg min-h-[400px] tab-pane"
        >
          <h2 class="text-black font-bold mb-4 mt-0">Game History</h2>
          {#if pointsChartOption}
            <div class="bg-white p-4 border-2 border-tan rounded-lg mb-6">
              <Chart option={pointsChartOption} height="400px" />
            </div>
          {/if}

          {#if militaryChartOption}
            <div class="bg-white p-4 border-2 border-tan rounded-lg mb-6">
              <Chart option={militaryChartOption} height="400px" />
            </div>
          {/if}

          {#if legitimacyChartOption}
            <div class="bg-white p-4 border-2 border-tan rounded-lg mb-6">
              <Chart option={legitimacyChartOption} height="400px" />
            </div>
          {/if}
        </Tabs.Content>

        <!-- Tab Content: Laws -->
        <Tabs.Content
          value="laws"
          class="bg-gray-200 p-8 border-2 border-black rounded-b-lg rounded-tr-lg min-h-[400px] tab-pane"
        >
          <h2 class="text-black font-bold mb-4 mt-0">Laws & Technology</h2>
          <p class="text-brown italic text-center p-8 text-lg">Coming soon...</p>
        </Tabs.Content>

        <!-- Tab Content: Economics -->
        <Tabs.Content
          value="economics"
          class="bg-gray-200 p-8 border-2 border-black rounded-b-lg rounded-tr-lg min-h-[400px] tab-pane"
        >
          <h2 class="text-black font-bold mb-4 mt-0">Economics</h2>
          {#if scienceChartOption}
            <div class="bg-white p-4 border-2 border-tan rounded-lg mb-6">
              <Chart option={scienceChartOption} height="400px" />
            </div>
          {:else if yieldHistory === null}
            <p class="text-brown italic text-center p-8">Loading yield data...</p>
          {:else}
            <p class="text-brown italic text-center p-8">No yield data available</p>
          {/if}
        </Tabs.Content>

        <!-- Tab Content: Settings -->
        <Tabs.Content
          value="settings"
          class="bg-gray-200 p-8 border-2 border-black rounded-b-lg rounded-tr-lg min-h-[400px] tab-pane"
        >
          <h2 class="text-black font-bold mb-4 mt-0">Game Settings</h2>
          <div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4 mb-8">
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
          </div>

          <div class="mt-8">
            <h3 class="text-black font-bold mb-4 mt-8 text-xl">Players</h3>
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
