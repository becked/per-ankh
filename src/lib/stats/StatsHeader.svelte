<script lang="ts">
	// The header both Global Stats views share: the title, the Charts/Explore tab
	// group centred beneath it, and whatever control the current view hangs on
	// the title row.
	//
	// One shared component rather than a block on each page because the two views
	// have different body widths — Charts fills screen-2xl, Explore's builder is
	// held to screen-lg — so a header inside each page's own container put the
	// title at a different left edge on each, and "Global Stats" jumped when you
	// switched tabs. Here the header has a width of its own, the same on both,
	// and only the body below it changes.
	//
	// The tabs sit centred on a row of their own, the same shape and the same
	// wrapper as the game views in GameHeader: SegmentedNav is a grid of equal
	// columns, so without `w-fit` it would stretch the full row. Both containers
	// are `mx-auto`, so the centre line is the same on both views and the pill
	// doesn't move either.
	//
	// Matched on `page.route.id`, NOT on `page.url.pathname`: during SSR
	// `resolve()` returns a path relative to the page being rendered, so a
	// pathname comparison reads false on the server and the pill would slide into
	// place on hydration instead of landing in the first paint. Route ids are the
	// same string on both sides and are checked against the generated RouteId
	// union, so a renamed route fails svelte-check. Same rule, and the same
	// reason, as the tournament tabs — $lib/tournament/views.ts has the long
	// version. No views module here: two tabs, and nothing but this header names
	// them.
	import type { Snippet } from "svelte";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import type { ResolvedPathname, RouteId } from "$app/types";
	import SegmentedNav from "$lib/ui/SegmentedNav.svelte";

	// The current view's own controls, at the right of the title row. Charts
	// passes its facet row; Explore passes nothing, because it narrows the
	// corpus from its builder instead.
	let { controls }: { controls?: Snippet } = $props();

	const tabs: { routeId: RouteId; href: ResolvedPathname; label: string }[] = [
		{ routeId: "/stats", href: resolve("/stats"), label: "Charts" },
		{
			routeId: "/stats/query",
			href: resolve("/stats/query"),
			label: "Explore",
		},
	];

	// -1 (no match) parks the pill hidden — defensive only: this header renders
	// solely on the two routes it names.
	const activeIndex = $derived(
		tabs.findIndex((tab) => tab.routeId === page.route.id),
	);
</script>

<div class="mx-auto mb-4 flex max-w-screen-2xl flex-col gap-2">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-2xl font-bold text-gray-200">Global Stats</h1>
		{@render controls?.()}
	</div>

	<div class="mx-auto w-fit">
		<SegmentedNav
			items={tabs.map((tab) => ({ href: tab.href, label: tab.label }))}
			{activeIndex}
			ariaLabel="Global stats views"
		/>
	</div>
</div>
