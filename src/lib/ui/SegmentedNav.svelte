<script lang="ts">
	// The app's segmented view switcher: an equal-column grid of cross-route
	// links with a raised-surface pill that slides under the active one. Shared
	// by the tournament views (TournamentViewTabs) and a game's Analysis/Map
	// toggle (GameHeader) — both centred, the tournament header in its header
	// row, the game header on a row below the trail, so "which view am I on"
	// reads at a glance in the same shape on both.
	//
	// Links rather than buttons: nav semantics, so aria-current, not
	// aria-pressed. The pill is the sole active indicator and the text stays
	// tan. The caller resolves the hrefs and says which one is active, so the
	// pill lands on the right item in the SSR'd first paint instead of sliding
	// into place on hydration.
	//
	// Not for the in-page switches that toggle a view of the same route — those
	// are SegmentedSwitch, the same shape built from buttons carrying
	// aria-pressed. The tournament overview's toggles are neither: they are a
	// bits-ui Tabs.List that also owns the panel below it.
	import type { ResolvedPathname } from "$app/types";

	let {
		items,
		activeIndex,
		ariaLabel,
	}: {
		items: { href: ResolvedPathname; label: string }[];
		// Which item the current route sits on. -1 (no match) parks the pill
		// hidden — defensive only, for a route none of the items name.
		activeIndex: number;
		ariaLabel: string;
	} = $props();
</script>

<nav
	class="relative grid overflow-hidden rounded-lg border-2 border-surface bg-surface"
	style:grid-template-columns={`repeat(${items.length}, minmax(0, 1fr))`}
	aria-label={ariaLabel}
>
	<div
		class="pointer-events-none absolute inset-y-0 left-0 bg-surface-raised transition-transform duration-200 ease-out"
		style:width={`${100 / items.length}%`}
		style:opacity={activeIndex < 0 ? "0" : "1"}
		style:transform={`translateX(${(activeIndex < 0 ? 0 : activeIndex) * 100}%)`}
	></div>
	<!-- eslint-disable svelte/no-navigation-without-resolve -- item.href is a resolve() result; not traceable through the array -->
	{#each items as item, i (item.href)}
		<a
			href={item.href}
			aria-current={i === activeIndex ? "page" : undefined}
			class="relative z-10 px-3 py-1.5 text-center text-xs font-bold text-tan transition-colors"
		>
			{item.label}
		</a>
	{/each}
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</nav>
