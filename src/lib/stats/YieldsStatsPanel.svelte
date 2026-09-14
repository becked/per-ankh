<script lang="ts">
	// Yields category: one chart per series (stacked, like the game-detail
	// YieldsTab). A sticky, floating bits-ui Toolbar carries the page-level
	// controls — values mode (per-turn / cumulative) and display toggles
	// (band, game count) — so they stay reachable while scrolling the stack.

	import { Toolbar } from "bits-ui";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import type { ChartBundleCore } from "./types";
	import { YIELD_SERIES, yieldChartOption } from "./charts/yields";

	// ChartBundleCore, not ChartBundle: the panel only reads yieldCurves, so
	// it renders on the tournament bundle too (which has no Overview fields).
	//
	// toolbarFlush pulls the sticky toolbar out of a container's px-4 so it
	// lines up with the tab bar above. Only StatsView pads its tab content, so
	// only it opts in; a caller that doesn't pad (the tournament stats page)
	// leaves it off, or the bar hangs a rem left of both the tabs above it and
	// the charts below.
	let {
		bundle,
		countLabel,
		toolbarFlush = false,
	}: {
		bundle: ChartBundleCore;
		countLabel?: string;
		toolbarFlush?: boolean;
	} = $props();

	let mode = $state<"rate" | "cumulative">("rate");
	let showBand = $state(true);
	let showCount = $state(false);
	let split = $state(false);

	const hasData = $derived(bundle.yieldCurves.turns.length > 0);
	// No decided games in the corpus → nothing to split by.
	const canSplit = $derived(bundle.yieldCurves.outcome != null);

	// The display toggles are one multi-select group; mirror them to the
	// booleans the chart builder takes.
	const displayValue = $derived([
		...(showBand ? ["band"] : []),
		...(showCount ? ["count"] : []),
	]);
	function onDisplayChange(v: string[]) {
		showBand = v.includes("band");
		showCount = v.includes("count");
	}

	// A series the corpus has no data for is dropped rather than drawn empty.
	// Every column here is nullable and some are only populated for part of the
	// corpus — gdp_per_turn needs a save that recorded market prices, and needs
	// the game to have been indexed since migration 0044 — so an all-null band
	// is an ordinary state, not a bug, and an axis with no line on it says
	// nothing a missing card doesn't say better.
	const drawable = $derived(
		YIELD_SERIES.filter((ys) => {
			const band = bundle.yieldCurves.series[ys.key];
			if (!band) return false;
			return (
				band.rate.p50.some((v) => v != null) ||
				band.cumulative.p50.some((v) => v != null)
			);
		}),
	);

	// Shared toggle-item tokens (matches the game-detail ToggleGroup).
	const itemClass =
		"px-2.5 py-1 text-xs text-tan transition-colors data-[state=off]:bg-surface data-[state=on]:bg-surface-raised";
</script>

{#if !hasData}
	<p class="p-8 text-center italic text-brown">No yield data available.</p>
{:else}
	<Toolbar.Root
		class="sticky top-1 z-10 mb-4 flex w-fit flex-wrap items-center gap-3 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg {toolbarFlush
			? '-ml-4'
			: ''}"
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

		{#if canSplit}
			<Toolbar.Group
				type="multiple"
				value={split ? ["split"] : []}
				onValueChange={(v: string[]) => (split = v.includes("split"))}
				class="flex gap-1"
			>
				<Toolbar.GroupItem value="split" class="rounded {itemClass}">
					Winners vs losers
				</Toolbar.GroupItem>
			</Toolbar.Group>
		{/if}
	</Toolbar.Root>

	{#each drawable as ys (ys.key)}
		<ChartContainer
			option={yieldChartOption(bundle, ys.key, ys.label, {
				mode,
				showBand,
				showCount,
				split,
				countLabel,
			})}
			height="400px"
			title={ys.label}
		/>
	{/each}
{/if}
