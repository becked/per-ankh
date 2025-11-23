<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import type { GameStatistics, SaveDateEntry } from "$lib/types";
  import type { EChartsOption } from "echarts";
  import Chart from "$lib/Chart.svelte";
  import { formatEnum } from "$lib/utils/formatting";
  import { CHART_THEME, getChartColor, getCivilizationColor, getNationColor } from "$lib/config";
  import { refreshData as refreshDataStore } from "$lib/stores/refresh";

  let refreshData = $state(0);
  $effect(() => {
    const unsubscribe = refreshDataStore.subscribe((value) => {
      refreshData = value;
    });
    return unsubscribe;
  });

  let stats = $state<GameStatistics | null>(null);
  let saveDates = $state<SaveDateEntry[]>([]);
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

  // Calendar chart: heatmap showing save activity by nation color
  function buildCalendarChartOption(dates: SaveDateEntry[]): EChartsOption | null {
    if (dates.length === 0) return null;

    // Determine date range: last 6 months from today
    const today = new Date();
    const sixMonthsAgo = new Date(today);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const maxDate = today.toISOString().split("T")[0];
    const minDate = sixMonthsAgo.toISOString().split("T")[0];

    // Group all nations by date (preserve all nations, deduplicated)
    // Only include dates within the visible range
    const dateToNations = new Map<string, string[]>();
    for (const entry of dates) {
      // Filter to only dates within the 6-month range
      if (entry.date < minDate || entry.date > maxDate) continue;

      const nation = entry.nation ?? "Unknown";
      const existing = dateToNations.get(entry.date) ?? [];
      if (!existing.includes(nation)) {
        existing.push(nation);
      }
      dateToNations.set(entry.date, existing);
    }

    // Create heatmap data - use first nation's color, but store all nations for tooltip
    const heatmapData: Array<{
      value: [string, number];
      nations: string[];
      itemStyle: { color: string };
    }> = [];

    for (const [date, nations] of dateToNations) {
      const firstNation = nations[0];
      const nationKey = firstNation.replace(/^NATION_/, "");
      const color = getNationColor(nationKey) ?? getChartColor(0);
      heatmapData.push({
        value: [date, 1],
        nations,
        itemStyle: { color },
      });
    }

    return {
      ...CHART_THEME,
      title: {
        ...CHART_THEME.title,
        text: "Calendar",
      },
      tooltip: {
        trigger: "item",
        formatter: (params: unknown) => {
          const p = params as { data: { value: [string, number]; nations: string[] } };
          const nationsFormatted = p.data.nations
            .map((n) => formatEnum(n, "NATION_"))
            .join("<br/>");
          return `${p.data.value[0]}<br/>${nationsFormatted}`;
        },
      },
      calendar: {
        range: [minDate, maxDate],
        cellSize: ["auto", 20],
        left: 60,
        right: 30,
        top: 80,
        bottom: 20,
        itemStyle: {
          color: CHART_THEME.backgroundColor, // Empty cells match chart background
          borderWidth: 1,
          borderColor: "#c5c3c2",
        },
        dayLabel: {
          color: CHART_THEME.title?.textStyle?.color ?? "#D2B48C",
        },
        monthLabel: {
          color: CHART_THEME.title?.textStyle?.color ?? "#D2B48C",
        },
        yearLabel: {
          color: CHART_THEME.title?.textStyle?.color ?? "#D2B48C",
        },
        splitLine: {
          lineStyle: {
            color: "#c5c3c2",
          },
        },
      },
      visualMap: {
        show: false,
        max: 1,
      },
      series: [
        {
          type: "heatmap",
          coordinateSystem: "calendar",
          data: heatmapData,
        },
      ],
    } as EChartsOption;
  }

  let calendarChartOption = $derived(buildCalendarChartOption(saveDates));

  async function fetchStats() {
    loading = true;
    error = null;
    try {
      const [statsResult, datesResult] = await Promise.all([
        api.getGameStatistics(),
        api.getSaveDates(),
      ]);
      stats = statsResult;
      saveDates = datesResult;
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
    <div class="p-2 border-2 border-black rounded-lg mb-8" style="background-color: #36302a;">
      <div class="flex items-center justify-center gap-2">
        <span class="font-bold text-brown text-sm uppercase tracking-wide">Games Played:</span>
        <span class="text-2xl font-bold" style="color: #EEEEEE;">{stats.total_games}</span>
      </div>
    </div>

    {#if chartOption}
      <div class="p-1 border-2 border-black rounded-lg mb-8" style="background-color: var(--color-chart-frame)">
        <Chart option={chartOption} height="400px" />
      </div>
    {/if}

    {#if calendarChartOption}
      <div class="p-1 border-2 border-black rounded-lg mb-8" style="background-color: var(--color-chart-frame)">
        <Chart option={calendarChartOption} height="250px" />
      </div>
    {/if}
  {/if}
</main>
