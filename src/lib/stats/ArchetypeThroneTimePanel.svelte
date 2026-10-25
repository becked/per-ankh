<script lang="ts">
	// The banded throne-time chart and the switch that picks the band.
	//
	// Its own component because two surfaces render it — the stats catalog's
	// Leaders tab (LeadersStatsPanel) and the tournament stats page's Leaders
	// tab — and each keeps its own heading convention around it, so sharing the
	// panel instead of the trio (switch, chart, caveat line) would mean
	// rewriting one page's layout to match the other's.
	//
	// Band selection is local state, not a URL param: it is a reading of one
	// chart rather than a scope on the page, and ?category already owns the
	// part of the URL this tab is addressed by.

	import ChartContainer from "$lib/ChartContainer.svelte";
	import SegmentedSwitch from "$lib/ui/SegmentedSwitch.svelte";
	import { barChartHeight } from "./charts/helpers";
	import {
		archetypeThroneTimeOption,
		THRONE_TIME_EMPTY_MESSAGE,
		throneTimeBandLabel,
		throneTimeBandNote,
		throneTimeRowCount,
	} from "./charts/leaders";
	import type { ChartBundleCore } from "./types";

	// toolbarFlush pulls the switch's bar out of a container's px-4 so it lines
	// up with the tabs above, the same opt-in NationSelect takes and for the
	// same reason: only StatsView pads its tab content.
	//
	// chartTitle is the in-chart ECharts title, set by the caller that has no
	// HTML heading of its own (the stats catalog's panel). The tournament stats
	// page heads its sections with an h2 and leaves this off, so the chart is
	// not titled twice.
	let {
		bundle,
		chartTitle,
		toolbarFlush = false,
	}: {
		bundle: ChartBundleCore;
		chartTitle?: string;
		toolbarFlush?: boolean;
	} = $props();

	const bands = $derived(bundle.archetypeThroneTime);
	// Keyed on the band's own first turn rather than its array position, so the
	// selection survives a bundle whose bands were cut at different edges —
	// which a cached bundle from before an edge moved is exactly.
	let chosen = $state<string | null>(null);
	const activeKey = $derived(
		chosen !== null && bands.some((b) => `${b.from}` === chosen)
			? chosen
			: `${bands[0]?.from ?? 1}`,
	);
	const band = $derived(bands.find((b) => `${b.from}` === activeKey));
	// Sized off the WIDEST band, not the open one, so flipping between bands
	// doesn't resize the panel under the pointer. Over a real corpus every band
	// carries all ten archetypes and this is a no-op; over a thin one — a small
	// tournament, a new player's library — it is the difference between a chart
	// you can click through and one that jumps.
	const height = $derived(
		barChartHeight(Math.max(...bands.map(throneTimeRowCount), 1)),
	);
	const note = $derived(
		band ? throneTimeBandNote(band, bundle.summary.total_games) : null,
	);
</script>

{#if bands.length > 0}
	<div
		class="sticky top-1 z-10 mb-4 flex w-fit items-center gap-2 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg {toolbarFlush
			? '-ml-4'
			: ''}"
	>
		<SegmentedSwitch
			items={bands.map((b) => ({
				key: `${b.from}`,
				label: throneTimeBandLabel(b),
			}))}
			value={activeKey}
			onChange={(key) => (chosen = key)}
			ariaLabel="Turn band"
		/>
	</div>

	{#if band && band.rows.length > 0}
		<ChartContainer
			option={archetypeThroneTimeOption(band, chartTitle)}
			{height}
			title={chartTitle ?? "Archetype throne-time"}
		/>
	{:else}
		<!-- Same box as the chart, for the same reason the height is pinned
		     above: a band nobody reached must not collapse the panel. -->
		<div class="mb-6 flex items-center justify-center" style:height>
			<p class="text-center italic text-tan opacity-60">
				{THRONE_TIME_EMPTY_MESSAGE}
			</p>
		</div>
	{/if}

	<!-- The band's denominator and its unknown share, beside the value rather
	     than as a chart subtitle. Below the chart because it qualifies what was
	     just read; a reader who doesn't scroll to it has still seen the shape,
	     and a reader who does gets the two reasons it might mislead. -->
	{#if note}
		<p class="-mt-4 mb-6 text-xs text-brown">{note}</p>
	{/if}
{/if}
