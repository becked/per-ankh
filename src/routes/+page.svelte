<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import type { GameStatistics } from "$lib/types";
  import type { EChartsOption } from "echarts";
  import Chart from "$lib/Chart.svelte";
  import { formatEnum } from "$lib/utils/formatting";
  import { CHART_THEME, getChartColor, getCivilizationColor } from "$lib/config";
  import { refreshData as refreshDataStore } from "$lib/stores/refresh";

  let refreshData = $state(0);
  $effect(() => {
    const unsubscribe = refreshDataStore.subscribe((value) => {
      refreshData = value;
    });
    return unsubscribe;
  });

  let stats = $state<GameStatistics | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let chartOption = $derived<EChartsOption | null>(
    stats
      ? {
          ...CHART_THEME,
          title: {
            ...CHART_THEME.title,
            text: "Games by Nation",
          },
          tooltip: {
            ...CHART_THEME.tooltip,
            axisPointer: { type: "shadow" },
          },
          xAxis: {
            type: "category",
            data: stats.nations.map((n) => formatEnum(n.nation, "NATION_")),
            axisLabel: {
              rotate: 45,
              interval: 0,
            },
          },
          yAxis: {
            type: "value",
            name: "Games Played",
          },
          series: [
            {
              name: "Games Played",
              type: "bar",
              data: stats.nations.map((n, i) => ({
                value: n.games_played,
                itemStyle: {
                  color: getCivilizationColor(n.nation.replace(/^NATION_/, '')) ?? getChartColor(i),
                },
              })),
            },
          ],
          grid: {
            bottom: 100,
          },
        }
      : null
  );

  async function fetchStats() {
    loading = true;
    error = null;
    try {
      stats = await api.getGameStatistics();
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    fetchStats();
  });

  // React to refresh events
  $effect(() => {
    if (refreshData > 0) {
      fetchStats();
    }
  });
</script>

<main class="flex-1 pt-4 px-4 pb-8 overflow-y-auto bg-blue-gray">
  <h1 class="mb-8 text-gray-200 text-3xl font-bold">Overview</h1>

  {#if loading}
    <p>Loading...</p>
  {:else if error}
    <p class="text-white bg-brown p-4 border-2 border-orange rounded font-bold">Error: {error}</p>
  {:else if stats}
    <div class="mb-8 bg-gray-200 p-6 border-2 border-black rounded-lg">
      <h2 class="text-black font-bold">Games Played: {stats.total_games}</h2>
    </div>

    {#if chartOption}
      <div class="bg-gray-200 p-6 border-2 border-black rounded-lg mb-8">
        <Chart option={chartOption} height="400px" />
      </div>
    {/if}

    <div class="bg-gray-200 p-6 border-2 border-black rounded-lg">
      <h2 class="text-brown font-bold">Nations</h2>
      <table class="w-full mt-4">
        <thead>
          <tr>
            <th class="p-3 text-left border-b-2 border-black text-black font-bold">Nation</th>
            <th class="p-3 text-left border-b-2 border-black text-black font-bold">Games Played</th>
          </tr>
        </thead>
        <tbody>
          {#each stats.nations as nation}
            <tr class="transition-colors duration-200 hover:bg-tan">
              <td class="p-3 text-left border-b-2 border-tan text-black">{formatEnum(nation.nation, "NATION_")}</td>
              <td class="p-3 text-left border-b-2 border-tan text-black">{nation.games_played}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</main>
