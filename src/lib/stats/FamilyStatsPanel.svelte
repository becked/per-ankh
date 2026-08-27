<script lang="ts">
	// Families category: which family class ran the capital (nation-agnostic —
	// the earliest of the family decisions), then a nation selector for which
	// classes that nation's players pick and whether some win more.
	//
	// Both are outcome stats. Which families a corpus refuses to field is a
	// choice stat measured against chance, and lives in its own category —
	// FamilyKeepsPanel.

	import ChartContainer from "$lib/ChartContainer.svelte";
	import NationSelect from "./NationSelect.svelte";
	import type { ChartBundleCore } from "./types";
	import {
		capitalFamilyWinLossOption,
		familyClassRowCount,
		familyNations,
		familyNationPicksOption,
	} from "./charts/families";
	import { ALL_NATIONS, barChartHeight, nationLabel } from "./charts/helpers";

	let { bundle }: { bundle: ChartBundleCore } = $props();

	const nations = $derived(familyNations(bundle));
	// Selector options: the cross-nation aggregate first, then each nation.
	const options = $derived([ALL_NATIONS, ...nations]);
	// User selection; defaults to the "All nations" aggregate until they pick,
	// or if a scope change drops the chosen one.
	let chosen = $state<string | null>(null);
	const nation = $derived(
		chosen && options.includes(chosen) ? chosen : ALL_NATIONS,
	);
</script>

<!-- The two charts read from different columns (player_summaries
     .capital_family_class, .family_classes) and go empty independently, so each
     carries its own empty state rather than sharing one guard. -->
{#if bundle.capitalFamilyWinRate.length > 0}
	<ChartContainer
		option={capitalFamilyWinLossOption(bundle)}
		height={barChartHeight(bundle.capitalFamilyWinRate.length)}
		title="Capital family"
	/>
{:else}
	<p class="p-8 text-center italic text-brown">
		No capital family data available.
	</p>
{/if}

{#if nations.length === 0}
	<p class="p-8 text-center italic text-brown">No family data available.</p>
{:else}
	<NationSelect value={nation} {options} onChange={(v) => (chosen = v)} />

	<ChartContainer
		option={familyNationPicksOption(bundle, nation)}
		height={barChartHeight(familyClassRowCount(bundle, nation))}
		title={nationLabel(nation)}
	/>
{/if}
