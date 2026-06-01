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

	// Shared toggle-item tokens (matches the aggregate-stats YieldsStatsPanel).
	const itemClass =
		"px-2.5 py-1 text-xs text-tan transition-colors data-[state=off]:bg-surface data-[state=on]:bg-surface-raised";
</script>

<div
	class="rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<div
		class="sticky top-1 z-10 -ml-4 mb-4 flex w-fit flex-wrap items-center gap-3 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
	>
		<ToggleGroup.Root
			type="single"
			value={yieldMode}
			onValueChange={(v) => {
				if (v) yieldMode = v as YieldMode;
			}}
			class="flex overflow-hidden rounded"
		>
			<ToggleGroup.Item value="rate" class="rounded-l {itemClass}">
				Per Turn
			</ToggleGroup.Item>
			<ToggleGroup.Item value="cumulative" class="rounded-r {itemClass}">
				Cumulative
			</ToggleGroup.Item>
		</ToggleGroup.Root>
	</div>

	{#if allYields.length === 0}
		<p class="p-8 text-center italic text-tan">No yield data available</p>
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
</div>
