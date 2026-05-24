<script lang="ts">
	// Tech category: one nation selector (default All nations) driving both the
	// "First tech researched" and "Tech timing" charts. Per-nation because each
	// nation starts with different techs, which open different research paths.

	import ChartContainer from "$lib/ChartContainer.svelte";
	import NationSelect from "./NationSelect.svelte";
	import type { ChartBundle } from "./types";
	import {
		techNations,
		techFirstOption,
		techTimingOption,
	} from "./charts/tech";
	import { ALL_NATIONS } from "./charts/helpers";

	let { bundle }: { bundle: ChartBundle } = $props();

	const nations = $derived(techNations(bundle));
	// Selector options: the cross-nation aggregate first, then each nation.
	const options = $derived([ALL_NATIONS, ...nations]);
	// Defaults to the "All nations" aggregate until the user picks, or if a
	// scope change drops the chosen one.
	let chosen = $state<string | null>(null);
	const nation = $derived(
		chosen && options.includes(chosen) ? chosen : ALL_NATIONS,
	);

	// ~26px per row so the bars/labels aren't crammed (matches Law adoption).
	// Cap mirrors each option builder's row slice (first: 15, timing: 25).
	const rowHeight = (n: number, cap: number) =>
		`${Math.max(Math.min(n, cap), 1) * 26 + 130}px`;
	const firstHeight = $derived(
		rowHeight(bundle.techFirst.filter((r) => r.nation === nation).length, 15),
	);
	const timingHeight = $derived(
		rowHeight(bundle.techTiming.filter((r) => r.nation === nation).length, 25),
	);
</script>

{#if bundle.techTiming.length === 0 && bundle.techFirst.length === 0}
	<p class="p-8 text-center italic text-brown">Not enough data.</p>
{:else}
	<NationSelect value={nation} {options} onChange={(v) => (chosen = v)} />

	<ChartContainer
		option={techFirstOption(bundle, nation)}
		height={firstHeight}
		title="First tech researched"
	/>
	<ChartContainer
		option={techTimingOption(bundle, nation)}
		height={timingHeight}
		title="Tech timing"
	/>
{/if}
