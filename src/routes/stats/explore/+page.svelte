<script lang="ts">
	// /stats/explore — Explore, the second view of Global Stats: the builder
	// over the catalog, and the rows it returns.
	//
	// The page is two panels side by side, each on its own half: the query on
	// the left, the results on the right. Nothing is asked until "Ask" is
	// pressed, so arriving here costs no read budget and the first thing on
	// screen is an empty builder rather than a number nobody asked for.
	//
	// Both panels render on arrival, and so does the frame the rows sit in —
	// empty, at a height that reads as a waiting table rather than as a seam.
	// The columns and that frame are what the page is, not what a first answer
	// turns it into: the builder doesn't move sideways under the pointer the
	// moment it is used, and the rows land in a box that was already there.
	//
	// A refused selection is drawn in that same box. The Worker's message is
	// what this query returned, so it belongs where the rows would be rather
	// than loose on the panel above an empty frame.

	import { navigating } from "$app/state";
	import StatsHeader from "$lib/stats/StatsHeader.svelte";
	import Panel from "$lib/ui/Panel.svelte";
	import QueryBuilder from "$lib/query/QueryBuilder.svelte";
	import QueryResults from "$lib/query/QueryResults.svelte";
	import { TABLE_FRAME_CLASS } from "$lib/ui/classes";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const source = $derived(
		data.catalog.sources.find((s) => s.key === data.result?.source) ?? null,
	);

	// A new question re-runs the load, so the page keeps showing the outgoing
	// rows until the new ones land. Dimming for the duration says what is still
	// on screen belongs to the query you just left — the same move /stats
	// makes across a facet change.
	const isAsking = $derived(navigating.to !== null);

	// The rows' own frame at the height an empty one needs to read as a table
	// waiting rather than as a seam. QueryResults draws this frame itself once
	// there are rows, so the constant is shared rather than restyled here.
	const FRAME = `${TABLE_FRAME_CLASS} min-h-[16rem]`;
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div class="flex-1 overflow-y-auto px-4 pb-8 pt-4">
			<StatsHeader />

			<div
				class="mx-auto grid max-w-screen-2xl grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
			>
				<Panel title="Query">
					<QueryBuilder catalog={data.catalog} draft={data.draft} />
				</Panel>

				<Panel title="Results">
					{#if data.error}
						<div class="{FRAME} items-center">
							<p class="flex-1 text-center text-sm text-orange">{data.error}</p>
						</div>
					{:else if data.result && source}
						<div class="results" class:asking={isAsking} aria-busy={isAsking}>
							<QueryResults
								result={data.result}
								{source}
								rosters={data.catalog.rosters}
							/>
						</div>
					{:else}
						<!-- The frame the rows land in, with nothing in it yet. No copy
						     inside it: a line here would be read as the answer to a
						     question nobody has asked. -->
						<div class={FRAME}></div>
					{/if}
				</Panel>
			</div>
		</div>
	</main>
</div>

<style>
	/* 200ms to match the view crossfades the stats pages use. */
	.results {
		transition: opacity 200ms ease-out;
	}

	.results.asking {
		opacity: 0.3;
		/* What's under the fade is the outgoing query's rows — a click would
		   follow a link off rows that are about to be replaced. */
		pointer-events: none;
	}
</style>
