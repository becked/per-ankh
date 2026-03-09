<script lang="ts">
	import type { YieldHistory } from "$lib/types/YieldHistory";
	import { ToggleGroup } from "bits-ui";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import {
		type ChartFilterKey,
		type YieldMode,
		YIELD_CHART_CONFIG,
		createYieldChartOption,
	} from "./helpers";

	let {
		allYields,
		chartFilters = $bindable<Record<ChartFilterKey, Record<string, boolean>>>(
			{} as Record<ChartFilterKey, Record<string, boolean>>,
		),
	}: {
		allYields: YieldHistory[];
		chartFilters?: Record<ChartFilterKey, Record<string, boolean>>;
	} = $props();

	let yieldMode = $state<YieldMode>("rate");
</script>

<div class="mb-4 flex items-center gap-4">
	<h2 class="mt-0 font-bold text-tan">Yields</h2>
	<ToggleGroup.Root
		type="single"
		value={yieldMode}
		onValueChange={(v) => { if (v) yieldMode = v as YieldMode; }}
		class="flex rounded border border-tan"
	>
		<ToggleGroup.Item value="rate" class="rounded-l px-2.5 py-1 text-xs text-tan transition-colors data-[state=on]:bg-[#35302B] data-[state=off]:bg-[#2a2622]">
			Per Turn
		</ToggleGroup.Item>
		<ToggleGroup.Item value="cumulative" class="rounded-r border-l border-tan px-2.5 py-1 text-xs text-tan transition-colors data-[state=on]:bg-[#35302B] data-[state=off]:bg-[#2a2622]">
			Cumulative
		</ToggleGroup.Item>
	</ToggleGroup.Root>
</div>

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
			yieldMode,
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
