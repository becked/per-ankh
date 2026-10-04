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
		openAtYield = null,
	}: {
		allYields: YieldHistory[];
		chartFilters?: Record<ChartFilterKey, Record<string, boolean>>;
		// The yield to open at, for a host that came in through one — the map
		// view's yield strip, whose Money slot would otherwise open the stack
		// eight charts above the one it names. Null opens at the top, which is
		// how the analyst view's tab pane opens.
		openAtYield?: string | null;
	} = $props();

	let yieldMode = $state<YieldMode>("rate");
	let stack = $state<HTMLDivElement | null>(null);

	// The chart is scrolled to rather than moved to the front: every yield keeps
	// the position it has in the analyst view's tab, and its neighbours stay a
	// scroll away. Nothing scrolls when the stack holds no chart for it.
	//
	// On the next frame, not this one: the map view renders this tab inside a
	// <dialog> that is display:none until showModal() (FullscreenDialog), and
	// an element with no layout box can't be scrolled to. The frame callback
	// runs after the dialog has opened whichever order the two effects take.
	$effect(() => {
		if (!openAtYield || !stack) return;
		const target = stack.querySelector(`[data-yield="${openAtYield}"]`);
		if (!target) return;
		const frame = requestAnimationFrame(() =>
			target.scrollIntoView({ block: "start" }),
		);
		return () => cancelAnimationFrame(frame);
	});

	// Shared toggle-item tokens (matches the aggregate-stats YieldsStatsPanel).
	const itemClass =
		"px-2.5 py-1 text-xs text-tan transition-colors data-[state=off]:bg-surface data-[state=on]:bg-surface-raised";
</script>

<div
	bind:this={stack}
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
				<!-- scroll-mt clears the sticky mode toggle, which the chart
				     scrolled to would otherwise land under: the toggle's bottom
				     sits 62px into the scroll port, and 80 leaves it about the
				     gap the charts keep between themselves. -->
				<div data-yield={config.yieldType} class="scroll-mt-20">
					<ChartContainer
						option={chartOption}
						height="400px"
						title={config.title}
					/>
				</div>
			{/if}
		{/each}
	{/if}
</div>
