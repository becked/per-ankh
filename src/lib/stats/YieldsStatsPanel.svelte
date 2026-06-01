<script lang="ts">
	// Yields category: one chart per series (stacked, like the game-detail
	// YieldsTab). A sticky, floating bits-ui Toolbar carries the page-level
	// controls — values mode (per-turn / cumulative) and display toggles
	// (band, game count) — so they stay reachable while scrolling the stack.

	import { Toolbar } from "bits-ui";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import type { ChartBundle } from "./types";
	import { YIELD_SERIES, yieldChartOption } from "./charts/yields";

	let { bundle }: { bundle: ChartBundle } = $props();

	let mode = $state<"rate" | "cumulative">("rate");
	let showBand = $state(true);
	let showCount = $state(false);

	const hasData = $derived(bundle.yieldCurves.turns.length > 0);

	// The display toggles are one multi-select group; mirror them to the two
	// booleans the chart builder takes.
	const displayValue = $derived([
		...(showBand ? ["band"] : []),
		...(showCount ? ["count"] : []),
	]);
	function onDisplayChange(v: string[]) {
		showBand = v.includes("band");
		showCount = v.includes("count");
	}

	// Shared toggle-item tokens (matches the game-detail ToggleGroup).
	const itemClass =
		"px-2.5 py-1 text-xs text-tan transition-colors data-[state=off]:bg-surface data-[state=on]:bg-surface-raised";
</script>

{#if !hasData}
	<p class="p-8 text-center italic text-brown">Not enough data.</p>
{:else}
	<Toolbar.Root
		class="sticky top-1 z-10 -ml-4 mb-4 flex w-fit flex-wrap items-center gap-3 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
	>
		<Toolbar.Group
			type="single"
			value={mode}
			onValueChange={(v: string) => {
				if (v) mode = v as "rate" | "cumulative";
			}}
			class="flex overflow-hidden rounded"
		>
			<Toolbar.GroupItem value="rate" class="rounded-l {itemClass}">
				Per Turn
			</Toolbar.GroupItem>
			<Toolbar.GroupItem value="cumulative" class="rounded-r {itemClass}">
				Cumulative
			</Toolbar.GroupItem>
		</Toolbar.Group>

		<Toolbar.Group
			type="multiple"
			value={displayValue}
			onValueChange={onDisplayChange}
			class="flex gap-1"
		>
			<Toolbar.GroupItem value="band" class="rounded {itemClass}">
				P25–P75 band
			</Toolbar.GroupItem>
			<Toolbar.GroupItem value="count" class="rounded {itemClass}">
				Game count
			</Toolbar.GroupItem>
		</Toolbar.Group>
	</Toolbar.Root>

	{#each YIELD_SERIES as ys (ys.key)}
		<ChartContainer
			option={yieldChartOption(bundle, ys.key, ys.label, {
				mode,
				showBand,
				showCount,
			})}
			height="400px"
			title={ys.label}
		/>
	{/each}
{/if}
