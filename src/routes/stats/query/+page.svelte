<script lang="ts">
	// /stats/query — Explore, the second view of Global Stats: the builder over
	// the catalog, and the answer under it.
	//
	// The page is two panels: the question, and what the corpus said. Nothing
	// is asked until "Ask" is pressed, so arriving here costs no read budget
	// and the first thing on screen is an empty builder rather than a number
	// nobody asked for.

	import { navigating } from "$app/state";
	import StatsHeader from "$lib/stats/StatsHeader.svelte";
	import Panel from "$lib/ui/Panel.svelte";
	import QueryBuilder from "$lib/query/QueryBuilder.svelte";
	import QueryResults from "$lib/query/QueryResults.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const source = $derived(
		data.catalog.sources.find((s) => s.key === data.result?.source) ?? null,
	);

	// A new question re-runs the load, so the page keeps showing the outgoing
	// answer until the new one lands. Dimming for the duration says the rows
	// still on screen belong to the question you just left — the same move
	// /stats makes across a facet change.
	const isAsking = $derived(navigating.to !== null);
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div class="flex-1 overflow-y-auto px-4 pb-8 pt-4">
			<StatsHeader />

			<div class="mx-auto flex max-w-screen-lg flex-col gap-4">
				<Panel title="Question">
					<QueryBuilder catalog={data.catalog} draft={data.draft} />
				</Panel>

				{#if data.error}
					<Panel title="Answer">
						<p class="p-4 text-center text-sm text-orange">{data.error}</p>
					</Panel>
				{:else if data.result && source}
					<Panel title="Answer">
						<div class="answer" class:asking={isAsking} aria-busy={isAsking}>
							<QueryResults result={data.result} {source} />
						</div>
					</Panel>
				{:else}
					<p class="px-1 text-sm italic text-tan opacity-70">
						Compose a question above, then ask it.
					</p>
				{/if}
			</div>
		</div>
	</main>
</div>

<style>
	/* 200ms to match the view crossfades the stats pages use. */
	.answer {
		transition: opacity 200ms ease-out;
	}

	.answer.asking {
		opacity: 0.3;
		/* What's under the fade is the outgoing question's answer — a click
		   would follow a link off rows that are about to be replaced. */
		pointer-events: none;
	}
</style>
