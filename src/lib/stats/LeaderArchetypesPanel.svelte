<script lang="ts">
	// Every leader's archetype, counted, with the switch that cuts the count by
	// when each took the throne.
	//
	// Its own component because two surfaces render it — the stats catalog's
	// Leaders tab (LeadersStatsPanel) and the tournament stats page's Leaders
	// tab — and each keeps its own heading convention around it, so sharing the
	// panel instead of the trio (switch, count label, chart) would mean
	// rewriting one page's layout to match the other's.
	//
	// The segment is local state, not a URL param: it is a reading of one chart
	// rather than a scope on the page, and ?category already owns the part of
	// the URL this tab is addressed by.

	import ChartContainer from "$lib/ChartContainer.svelte";
	import CountRow from "$lib/ui/CountRow.svelte";
	import SegmentedSwitch from "$lib/ui/SegmentedSwitch.svelte";
	import { barChartHeight } from "./charts/helpers";
	import {
		ALL_TURNS_KEY,
		leaderArchetypeOption,
		leaderBandCountLabel,
		leaderBandEmptyMessage,
		leaderBandSegments,
	} from "./charts/leaders";
	import type { ChartBundleCore } from "./types";

	// chartTitle is the in-chart ECharts title, set by the caller that has no
	// HTML heading of its own (the stats catalog's panel). The tournament stats
	// page heads its sections with an h2 and leaves this off, so the chart is
	// not titled twice.
	let {
		bundle,
		chartTitle,
	}: {
		bundle: ChartBundleCore;
		chartTitle?: string;
	} = $props();

	const segments = $derived(leaderBandSegments(bundle.leaderArchetypes));
	// Annotated, not inferred: the initializer's literal type would otherwise
	// decide what a band key is allowed to be.
	let chosen = $state<string>(ALL_TURNS_KEY);
	const active = $derived(
		segments.find((s) => s.key === chosen) ?? segments[0],
	);
	// Every game reaches the first band, so its count is the corpus the later
	// bands' are read against — and it is counted over the focal seats, which
	// summary.total_games deliberately is not.
	const totalGames = $derived(bundle.leaderArchetypes[0]?.games ?? 0);
	const corpusHasLeaders = $derived(
		bundle.leaderArchetypes.some((b) => b.leaders > 0),
	);
</script>

{#if segments.length > 0}
	<SegmentedSwitch
		items={segments.map((s) => ({ key: s.key, label: s.label }))}
		value={active.key}
		onChange={(key) => (chosen = key)}
		ariaLabel="Turn band"
		class="mb-2 w-fit"
	/>

	<!-- Suppressed where there is nothing to count, so the empty state below
	     isn't introduced by a "0 Leaders". -->
	{#if active.band.leaders > 0}
		<CountRow>{leaderBandCountLabel(active.band, totalGames)}</CountRow>
	{/if}

	{#if active.band.rows.length > 0}
		<ChartContainer
			option={leaderArchetypeOption(active.band, chartTitle)}
			height={barChartHeight(active.band.rows.length)}
			title={chartTitle ?? "Leader archetypes"}
		/>
	{:else}
		<p class="p-8 text-center italic text-tan opacity-60">
			{leaderBandEmptyMessage(active.band, corpusHasLeaders)}
		</p>
	{/if}
{/if}
