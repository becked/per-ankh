<script lang="ts">
	// Game length category: the corpus's turn-count distribution — the four
	// numbers people ask for, then the shape they come from.
	//
	// Numbers above the chart rather than inside it. "Shortest" and "longest"
	// are each one game, which a bar chart draws as two outliers next to a
	// mound and a reader takes for a trend; as cells they read as what they
	// are, and the histogram below carries the part that needs a chart. The
	// cell chrome is RecordsPanel's card (`rounded-lg bg-surface p-3`), since
	// that panel sits one tab away and these are the same kind of box.
	//
	// Median and average both: they answer the same question and disagree
	// exactly when the tail is long, which on this data they barely do (73 vs
	// 73.7 over the public duels) — so showing one and hiding the other would
	// be a claim about skew that the corpus doesn't make either way.
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { gameLengthHistogramOption } from "./charts/game-length";
	import type { ChartBundleCore } from "./types";

	// ChartBundleCore, not ChartBundle: turn length is a per-game fact, correct
	// over either focal set, so this renders on every corpus the catalog serves.
	//
	// No countLabel prop, unlike its sibling panels. Theirs names what one
	// sample is, which follows the bundle's focal mode ("Players" on /stats,
	// "Games" on a profile); a game's length belongs to the game however many
	// seats it had, so the denominator here is games on every surface and
	// threading the caller's label would mislabel two of the three.
	let { bundle }: { bundle: ChartBundleCore } = $props();

	const stats = $derived(bundle.turnLength);

	// Turn counts are integers; the mean is the one value that isn't, and a
	// tenth is as fine as it reads next to them.
	const fmt = (v: number): string =>
		Number.isInteger(v) ? String(v) : v.toFixed(1);

	// One list rather than four hand-written boxes, so a change to the cell —
	// its chrome, its unit, how it formats — lands on all of them.
	//
	// Ordered as the distribution reads, low to high, with the two middle
	// measures between the two extremes they sit between. The middle half rides
	// under the median because it is that value's own spread; min and max carry
	// no sub-line, and the grid stretches every cell to the tallest so the boxes
	// stay level.
	const cells = $derived(
		stats === null
			? []
			: [
					{ key: "min", label: "Shortest", value: stats.min, sub: null },
					{
						key: "median",
						label: "Median",
						value: stats.median,
						sub: `middle half ${fmt(stats.p25)}–${fmt(stats.p75)}`,
					},
					{ key: "mean", label: "Average", value: stats.mean, sub: null },
					{ key: "max", label: "Longest", value: stats.max, sub: null },
				],
	);
</script>

{#if stats === null}
	<p class="p-8 text-center italic text-brown">
		No game length data available.
	</p>
{:else}
	<section class="mb-6">
		<p class="mb-3 text-xs text-brown">
			{stats.games.toLocaleString("en-US")} games
		</p>

		<div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
			{#each cells as cell (cell.key)}
				<div class="rounded-lg bg-surface p-3">
					<p class="mb-1 text-xs text-brown">{cell.label}</p>
					<p class="text-lg font-bold tabular-nums text-tan">
						{fmt(cell.value)}<span class="ml-1 text-xs font-normal text-brown"
							>turns</span
						>
					</p>
					{#if cell.sub}
						<p class="text-xs tabular-nums text-brown">{cell.sub}</p>
					{/if}
				</div>
			{/each}
		</div>

		<ChartContainer
			option={gameLengthHistogramOption(stats)}
			height="400px"
			title="Game length"
		/>
	</section>
{/if}
