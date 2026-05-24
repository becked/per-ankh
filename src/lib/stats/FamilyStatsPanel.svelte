<script lang="ts">
	// Families category: pick a nation, see which family classes its players
	// pick (pick rate) and whether some win more (win rate), as paired bars.

	import ChartContainer from "$lib/ChartContainer.svelte";
	import NationSelect from "./NationSelect.svelte";
	import type { ChartBundle } from "./types";
	import { familyNations, familyNationPicksOption } from "./charts/families";
	import { ALL_NATIONS, nationLabel } from "./charts/helpers";

	let { bundle }: { bundle: ChartBundle } = $props();

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

{#if nations.length === 0}
	<p class="p-8 text-center italic text-brown">Not enough data.</p>
{:else}
	<NationSelect value={nation} {options} onChange={(v) => (chosen = v)} />

	<ChartContainer
		option={familyNationPicksOption(bundle, nation)}
		height="400px"
		title={nationLabel(nation)}
	/>
{/if}
