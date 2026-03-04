<script lang="ts">
	import type { YieldHistory } from "$lib/types/YieldHistory";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { EChartsOption } from "echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import { CHART_THEME } from "$lib/config";
	import {
		type ChartFilterKey,
		YIELD_CHART_CONFIG,
		getPlayerColor,
		createYieldChartOption,
	} from "./helpers";

	let {
		allYields,
		playerHistory,
		chartFilters = $bindable<Record<ChartFilterKey, Record<string, boolean>>>(
			{} as Record<ChartFilterKey, Record<string, boolean>>,
		),
	}: {
		allYields: YieldHistory[];
		playerHistory: PlayerHistory[];
		chartFilters?: Record<ChartFilterKey, Record<string, boolean>>;
	} = $props();

	// Legitimacy chart option
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
			: null,
	);
</script>

<h2 class="mb-4 mt-0 font-bold text-tan">Yields</h2>
{#if legitimacyChartOption}
	<ChartContainer
		option={legitimacyChartOption}
		height="400px"
		title="Legitimacy"
	/>
{/if}

{#if allYields.length === 0}
	<p class="p-8 text-center italic text-brown">
		No yield data available
	</p>
{:else}
	{#each YIELD_CHART_CONFIG as config (config.yieldType)}
		{@const chartOption = createYieldChartOption(
			allYields,
			config.yieldType,
			config.title,
			config.yAxisLabel,
			chartFilters[config.filterKey],
		)}
		{#if chartOption}
			<ChartContainer
				option={chartOption}
				height="400px"
				title={config.title}
			/>
		{/if}
	{/each}
{/if}
