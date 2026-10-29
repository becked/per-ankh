<script lang="ts">
	// Leaders category: the starting leader's archetype, then every leader the
	// corpus's seats had, then the starting leader's personality traits.
	//
	// A panel rather than three registry specs because the middle chart needs a
	// turn-band switch and the generic spec loop has nowhere to put one — the
	// same reason LawsStatsPanel exists, and it keeps the same shape: a
	// category anchor spec in the registry, the charts here.
	//
	// Order is deliberate. The starting-archetype bar comes first because it is
	// the chart that already existed and the one the home card teases, and the
	// every-leader bar sits directly under it in the same unit — so "Tactician
	// dominates" and "Tactician dominates the opening" are read against each
	// other rather than on separate tabs.

	import ChartContainer from "$lib/ChartContainer.svelte";
	import LeaderArchetypesPanel from "./LeaderArchetypesPanel.svelte";
	import { barChartHeight } from "./charts/helpers";
	import {
		ARCHETYPE_EMPTY_MESSAGE,
		TRAIT_EMPTY_MESSAGE,
		startingArchetypeWinLossOption,
		startingTraitWinLossOption,
		visibleTraitRowCount,
	} from "./charts/leaders";
	import type { ChartBundleCore } from "./types";

	let { bundle }: { bundle: ChartBundleCore } = $props();
</script>

{#if bundle.startingArchetypeWinRate.length > 0}
	<ChartContainer
		option={startingArchetypeWinLossOption(bundle, "Starting archetype")}
		height={barChartHeight(bundle.startingArchetypeWinRate.length)}
		title="Starting archetype"
	/>
{:else}
	<p class="p-8 text-center italic text-tan opacity-60">
		{ARCHETYPE_EMPTY_MESSAGE}
	</p>
{/if}

<LeaderArchetypesPanel {bundle} chartTitle="Leader archetypes" />

{#if bundle.startingTraitWinRate.length > 0}
	<ChartContainer
		option={startingTraitWinLossOption(bundle, "Starting leader traits")}
		height={barChartHeight(visibleTraitRowCount(bundle))}
		title="Starting leader traits"
	/>
{:else}
	<p class="p-8 text-center italic text-tan opacity-60">
		{TRAIT_EMPTY_MESSAGE}
	</p>
{/if}
