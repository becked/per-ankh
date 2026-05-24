<script lang="ts">
	// Laws category: one nation selector (default All nations) driving both the
	// "Law adoption" timing chart and the "opening law sequence" chart. Per-nation
	// because each nation starts with different techs, which gate different laws.

	import ChartContainer from "$lib/ChartContainer.svelte";
	import NationSelect from "./NationSelect.svelte";
	import type { ChartBundle } from "./types";
	import {
		lawNations,
		lawTimingOption,
		openingLawsOption,
	} from "./charts/laws";
	import { ALL_NATIONS, nationLabel } from "./charts/helpers";

	let { bundle }: { bundle: ChartBundle } = $props();

	const nations = $derived(lawNations(bundle));
	// Selector options: the cross-nation aggregate first, then each nation.
	const options = $derived([ALL_NATIONS, ...nations]);
	// Defaults to the "All nations" aggregate until the user picks, or if a
	// scope change drops the chosen one.
	let chosen = $state<string | null>(null);
	const nation = $derived(
		chosen && options.includes(chosen) ? chosen : ALL_NATIONS,
	);

	// ~26px per row so the bars/labels aren't crammed (matches Tech). Caps
	// mirror each option builder's row slice (timing: 25, sequence: 15).
	const rowHeight = (n: number, cap: number) =>
		`${Math.max(Math.min(n, cap), 1) * 26 + 130}px`;
	const timingHeight = $derived(
		rowHeight(bundle.lawTiming.filter((r) => r.nation === nation).length, 25),
	);
	// The sequence chart aggregates across nations for ALL_NATIONS, so its row
	// count is the distinct four-law sets, not a per-nation row tally.
	const sequenceHeight = $derived(
		rowHeight(
			nation === ALL_NATIONS
				? new Set(bundle.openingLaws.map((o) => o.laws.join("|"))).size
				: bundle.openingLaws.filter((o) => o.nation === nation).length,
			15,
		),
	);
</script>

{#if bundle.lawTiming.length === 0 && bundle.openingLaws.length === 0}
	<p class="p-8 text-center italic text-brown">Not enough data.</p>
{:else}
	<NationSelect value={nation} {options} onChange={(v) => (chosen = v)} />

	<ChartContainer
		option={lawTimingOption(bundle, nation)}
		height={timingHeight}
		title="Law adoption"
	/>
	<ChartContainer
		option={openingLawsOption(bundle, nation)}
		height={sequenceHeight}
		title={`${nationLabel(nation)} opening law sequence`}
	/>
{/if}
