<script lang="ts">
	// /stats — the chart catalog over the whole public corpus. The page is the
	// facet row plus the shared StatsView: every chart here is the same spec
	// the user and tournament surfaces render, which is the point of typing
	// the registry at ChartBundleCore.
	//
	// The bundle is built with focal: "humans", so every human seat counts
	// rather than only an uploader's — both sides of a duel are somebody's
	// game. That is also why the page shows no win-rate or top-nation tile:
	// over an all-humans corpus those read ~50% by construction, and the
	// bundle correctly omits them.

	import { navigating } from "$app/state";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import GlobalFacetRow from "$lib/stats/GlobalFacetRow.svelte";
	import {
		parseGlobalPeriod,
		parseGlobalSlice,
		parseNationFacet,
	} from "$lib/stats/global-facets";
	import StatsView from "$lib/stats/StatsView.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// Not displayed — this is the empty-state gate. A selection narrows the
	// games as well as the focal seats, so a facet the corpus has no game for
	// resolves to a bundle with nothing in it rather than to an error.
	const gameCount = $derived(data.bundle.meta.game_count);

	// A facet change re-runs the load, so the page keeps showing the outgoing
	// bundle until the new one lands and then replaces it in one frame. The
	// charts animate their series through that swap but not their axes — a
	// rescaled value axis has no old tick to animate from, so ECharts redraws
	// those gridlines straight at their destination — and the bar categories
	// change container height outright. Dimming the catalog for the duration
	// puts that redraw under a fade instead of at full opacity, and says the
	// numbers still on screen belong to the selection you just left.
	//
	// Only for a navigation that actually changes the bundle: SvelteKit tracks
	// url dependencies per search param, so the ?category subtab writes a param
	// the load never read and refetches nothing. Dimming for that would flash
	// the catalog on every tab click. Read through the same parsers the load
	// uses rather than comparing raw params, so an explicit ?slice=duel and an
	// omitted one are recognized as the one selection they both name.
	const isSwapping = $derived.by(() => {
		const to = navigating.to;
		if (!to) return false;
		return (
			parseGlobalSlice(to.url.searchParams.get("slice")) !== data.slice ||
			parseNationFacet(to.url.searchParams.get("nation")) !== data.nation ||
			parseGlobalPeriod(to.url.searchParams.get("period")) !== data.period
		);
	});
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-screen-2xl">
				<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
					<h1 class="text-2xl font-bold text-gray-200">Global Stats</h1>
					<GlobalFacetRow
						slice={data.slice}
						nation={data.nation}
						period={data.period}
					/>
				</div>

				<div
					class="stats-catalog"
					class:swapping={isSwapping}
					aria-busy={isSwapping}
				>
					{#if gameCount === 0}
						<p class="p-8 text-center italic text-tan opacity-60">
							No public games match this selection yet.
						</p>
					{:else}
						<!-- The facet row above is this page's nation control, so the
						     per-nation panels drop their own. -->
						<StatsView
							bundle={data.bundle}
							showNationSelect={false}
							countLabel="Players"
						/>
					{/if}
				</div>
			</div>
		</div>
	</main>
</div>

<style>
	/* 200ms to match the view crossfades the tournament pages use. */
	.stats-catalog {
		transition: opacity 200ms ease-out;
	}

	.stats-catalog.swapping {
		opacity: 0.3;
		/* What's under the fade is the outgoing selection — a click would act on
		   numbers that are about to be replaced. */
		pointer-events: none;
	}
</style>
