<script lang="ts">
	// The /stats facet row — the three controls that name the global corpus: a
	// composition slice, optionally one nation ANDed with it, and how recently
	// the games were played. Sibling of
	// $lib/users/ScopeRow.svelte and built to the same shape: hand-rolled
	// popovers (not native <select>) matching the game-detail action popups,
	// each writing its selection to the URL so the load re-runs and the view
	// stays linkable.
	//
	// Single-select throughout. The nightly precompute holds the slice × nation
	// space; it deliberately warms the all-time window only, so a narrowed
	// window is a cache miss the first time it is asked for and then a 24h
	// entry with serve-stale behind it (stats/precompute.ts).
	//
	// Controlled: the selection comes from the load (which parsed it out of
	// the URL), never from local state, so the lit option and the rendered
	// bundle can't disagree.

	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { ALL_NATIONS, nationLabel } from "./charts/helpers";
	import {
		DEFAULT_GLOBAL_PERIOD,
		DEFAULT_GLOBAL_SLICE,
		GLOBAL_PERIODS,
		GLOBAL_SLICES,
		globalPeriodLabel,
		globalSliceLabel,
		NATION_FACET_OPTIONS,
	} from "./global-facets";
	import type { GlobalPeriod, GlobalSlice } from "./types";

	let {
		slice,
		nation,
		period,
	}: { slice: GlobalSlice; nation: string | null; period: GlobalPeriod } =
		$props();

	// The URL param each control writes, which is also its identity in the row.
	type Facet = "slice" | "nation" | "period";
	type Option = { value: string; label: string };
	type FacetMenu = {
		facet: Facet;
		// Names the control for a screen reader; the trigger's visible text is
		// the current value, which on its own doesn't say what it selects.
		ariaLabel: string;
		options: Option[];
		current: string;
		currentLabel: string;
		// The value that carries no param. Both defaults drop their param
		// rather than spelling it out (as ScopeRow does for scope=all), so the
		// default view has one canonical URL — and so one edge-cache entry
		// rather than several spellings of the same bundle.
		defaultValue: string;
	};

	// ALL_NATIONS is the "no facet" option — the same sentinel the in-panel
	// nation selectors (Families, Laws, Tech) use for their cross-nation view,
	// so "All nations" means one thing on this page.
	const nationValue = $derived(nation ?? ALL_NATIONS);

	const menus = $derived<FacetMenu[]>([
		{
			facet: "slice",
			ariaLabel: "Games",
			options: GLOBAL_SLICES.map((s) => ({
				value: s,
				label: globalSliceLabel(s),
			})),
			current: slice,
			currentLabel: globalSliceLabel(slice),
			defaultValue: DEFAULT_GLOBAL_SLICE,
		},
		{
			facet: "nation",
			ariaLabel: "Nation",
			options: [ALL_NATIONS, ...NATION_FACET_OPTIONS].map((n) => ({
				value: n,
				label: nationLabel(n),
			})),
			current: nationValue,
			currentLabel: nationLabel(nationValue),
			defaultValue: ALL_NATIONS,
		},
		{
			facet: "period",
			ariaLabel: "Played",
			options: GLOBAL_PERIODS.map((p) => ({
				value: p,
				label: globalPeriodLabel(p),
			})),
			current: period,
			currentLabel: globalPeriodLabel(period),
			defaultValue: DEFAULT_GLOBAL_PERIOD,
		},
	]);

	// The row has three menus; one is open at a time.
	let openMenu = $state<Facet | null>(null);

	async function select(menu: FacetMenu, value: string) {
		openMenu = null;
		if (value === menu.current) return;
		const next = new URL(page.url);
		if (value === menu.defaultValue) next.searchParams.delete(menu.facet);
		else next.searchParams.set(menu.facet, value);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		await goto(next, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function handleClickOutside(e: MouseEvent) {
		if (openMenu === null) return;
		const target = e.target as HTMLElement;
		if (!target.closest(".facet-select")) openMenu = null;
	}
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && openMenu !== null) openMenu = null;
	}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<div class="flex flex-wrap items-center gap-2">
	{#each menus as menu (menu.facet)}
		<div class="facet-select relative">
			<button
				type="button"
				onclick={() => (openMenu = openMenu === menu.facet ? null : menu.facet)}
				aria-haspopup="menu"
				aria-expanded={openMenu === menu.facet}
				aria-label="{menu.ariaLabel}: {menu.currentLabel}"
				class="flex items-center gap-2 rounded bg-surface px-2 py-1 text-sm text-tan transition-colors hover:bg-surface-hover"
			>
				<!-- Every option of this menu is laid into one grid cell, all but
				     the current one hidden. The trigger is therefore as wide as its
				     widest option and stays that width whichever is selected, so
				     picking a shorter label can't move this control or the one
				     beside it. Sizing off the options themselves rather than a px
				     guess keeps it right as the slice and nation rosters change. -->
				<span class="label-stack">
					{#each menu.options as o (o.value)}
						<span class="label-sizer" aria-hidden="true">{o.label}</span>
					{/each}
					<span>{menu.currentLabel}</span>
				</span>
				<span class="text-[9px] text-tan opacity-60">▼</span>
			</button>

			{#if openMenu === menu.facet}
				<div
					class="action-popover absolute right-0 top-full z-50 mt-2 max-h-80 w-56 overflow-y-auto rounded border-2 border-black bg-blue-gray p-2 shadow-lg"
					role="menu"
					tabindex="-1"
				>
					{#each menu.options as o (o.value)}
						{@const isCurrent = o.value === menu.current}
						<button
							type="button"
							role="menuitemradio"
							aria-checked={isCurrent}
							onclick={() => select(menu, o.value)}
							class="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs text-tan transition-colors hover:bg-surface-raised {isCurrent
								? 'bg-surface-raised'
								: ''}"
						>
							<span class="truncate">{o.label}</span>
							{#if isCurrent}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-3.5 w-3.5 shrink-0 text-orange"
									viewBox="0 0 20 20"
									fill="currentColor"
									aria-hidden="true"
								>
									<path
										fill-rule="evenodd"
										d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
										clip-rule="evenodd"
									/>
								</svg>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.label-stack {
		display: grid;
		justify-items: start;
	}

	.label-stack > span {
		grid-area: 1 / 1;
		white-space: nowrap;
	}

	.label-sizer {
		visibility: hidden;
	}
</style>
