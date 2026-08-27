<script lang="ts">
	// Families-fielded category: which family classes this corpus actually
	// fields, against how often fielding one would happen by itself.
	//
	// "Fielded" on the surface, `familyKeeps` underneath. The mechanic's own
	// verb is field — a player fields three of the pool — and that is what the
	// page should say. The data layer keeps the keep/cut vocabulary the method
	// is written in, so its arithmetic stays checkable against the method.
	//
	// Its own category rather than a third chart on Families, because it asks a
	// different kind of question. The two charts there are outcome stats — this
	// class ran the capital, these classes won more. This one is a *choice*
	// stat, measured against the pool's chance level rather than against a win
	// rate, and reading it next to two win-rate bars invited the two to be
	// compared when they answer nothing like the same question.
	//
	// Rendered on both the profile Stats tab and a tournament's stats page, so
	// the table reads as "this player's choices" in one place and "this event's
	// field" in the other with no branch here — the corpus behind the bundle is
	// the only difference.
	import NationSelect from "./NationSelect.svelte";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { familyKeepsOption } from "./charts/families";
	import { barChartHeight } from "./charts/helpers";
	import { ALL_NATIONS, nationLabel } from "./charts/helpers";
	import type { ChartBundleCore } from "./types";

	let { bundle }: { bundle: ChartBundleCore } = $props();

	// Only nations there is a table for — one that fields its whole pool never
	// reaches the selector, having nothing to say about preference.
	const options = $derived([
		ALL_NATIONS,
		...bundle.familyKeeps.byNation.map((n) => n.nation),
	]);
	// Defaults to the cross-nation aggregate until they pick, or if a scope
	// change drops the chosen one.
	let chosen = $state<string | null>(null);
	const nation = $derived(
		chosen && options.includes(chosen) ? chosen : ALL_NATIONS,
	);

	// A swap, not a filter over shared rows: each nation's table carries its own
	// false-discovery gate, because looking at one nation is four tests and not
	// ten.
	const keeps = $derived(
		nation === ALL_NATIONS
			? bundle.familyKeeps.overall
			: (bundle.familyKeeps.byNation.find((n) => n.nation === nation) ??
					bundle.familyKeeps.overall),
	);

	// The player-games the table couldn't read. Not on the page — it is detail
	// for someone who wants it — but not thrown away either, so the sample the
	// page quotes can be reconciled with the corpus it came from.
	const skipped = $derived(
		keeps.skipped_incomplete +
			keeps.skipped_forced_pool +
			keeps.skipped_unknown_pool,
	);
	const skippedReason = $derived(
		[
			keeps.skipped_incomplete > 0
				? `${keeps.skipped_incomplete} that lost a family to conquest`
				: null,
			keeps.skipped_forced_pool > 0
				? `${keeps.skipped_forced_pool} on nations that field their whole pool`
				: null,
			keeps.skipped_unknown_pool > 0
				? `${keeps.skipped_unknown_pool} on an unrecognised nation`
				: null,
		]
			.filter(Boolean)
			.join(", "),
	);
</script>

{#if bundle.familyKeeps.overall.rows.length === 0}
	<p class="p-8 text-center italic text-brown">No family data available.</p>
{:else}
	<NationSelect value={nation} {options} onChange={(v) => (chosen = v)} />

	<ChartContainer
		option={familyKeepsOption(keeps.rows)}
		height={barChartHeight(keeps.rows.length + 1)}
		title="Families fielded"
	/>
	<!-- What each column is. Three definitions rather than a paragraph: the
	     chart is legible without them, and this is for the reader who wants to
	     know what "vs chance" is measured against. -->
	<p
		class="-mt-4 mb-1 text-center text-xs text-muted"
		title={skipped > 0
			? `${skipped} more left out: ${skippedReason}`
			: undefined}
	>
		Based on {keeps.player_games} player-games{nation === ALL_NATIONS
			? ""
			: ` of ${nationLabel(nation)}`}.
	</p>
	<p class="mx-auto mb-6 max-w-3xl px-4 text-center text-xs text-muted">
		<span class="text-tan">fielded</span> — how often the family was fielded in
		the games its nation could have fielded it.
		<span class="text-tan">vs chance</span> — how far that sits from fielding
		three of the pool at random, which is the tick on each bar.
		<span class="text-tan">color</span> — the gap is further from chance than this
		many games could produce by luck.
	</p>
{/if}
