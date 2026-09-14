<script lang="ts">
	// Stats catalog renderer. Renders a ChartBundleCore as category subtabs
	// (styled like the game-detail tabs); each category shows a single
	// column of full-width ChartContainers, matching the game-detail chart
	// UI (in-chart titles + fullscreen-expand). The active category lives
	// in ?category (controlled: value derived from the URL, change → goto).

	import { Tabs } from "bits-ui";
	import type { ChartOption } from "$lib/echarts";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import YieldsStatsPanel from "./YieldsStatsPanel.svelte";
	import RecordsPanel from "./RecordsPanel.svelte";
	import FamilyStatsPanel from "./FamilyStatsPanel.svelte";
	import LawsStatsPanel from "./LawsStatsPanel.svelte";
	import TechStatsPanel from "./TechStatsPanel.svelte";
	import { CHART_THEME, COMMON_GRID } from "./charts/helpers";
	import { CATEGORIES, CHART_SPECS } from "./charts/registry";
	import {
		nationAvgPointsOption,
		nationWinLossStackedOption,
	} from "./charts/nations";
	import {
		startingArchetypeWinLossOption,
		startingTraitWinLossOption,
	} from "./charts/leaders";
	import { wonderOverviewOption } from "./charts/wonders";
	import { expansionWinRateOption } from "./charts/cities";
	import type { ChartBundleCore, StatsCategory } from "./types";

	// showNationSelect — whether the per-nation panels (Families, Laws, Tech)
	// carry their own nation dropdown. /stats passes false: that page has a
	// page-level nation facet over the whole bundle, so the panels' own
	// dropdowns would be a second control for the same question. The profile
	// stats tab has no such facet, so it keeps them — there they are the only
	// way to read one nation at a time.
	//
	// countLabel — what one sample on the yields overlay is, which follows the
	// focal mode the bundle was built in and so is the caller's to name. A
	// uploader-focal bundle has one seat per game ("Games"); a humans-focal one
	// has a seat per human player ("Players"), where a one-duel corpus counts 2.
	// Forwarded to YieldsStatsPanel, which is where the tournament stats page
	// passes its own.
	let {
		bundle,
		showNationSelect = true,
		countLabel,
	}: {
		bundle: ChartBundleCore;
		showNationSelect?: boolean;
		countLabel?: string;
	} = $props();

	// Group CHART_SPECS by category once at module init. Not reactive —
	// a constant lookup over a static array.
	const SPEC_GROUPS = (() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-shot derivation of a static lookup, never mutated reactively
		const map = new Map<StatsCategory, typeof CHART_SPECS>();
		for (const spec of CHART_SPECS) {
			const arr = map.get(spec.category) ?? [];
			arr.push(spec);
			map.set(spec.category, arr);
		}
		return map;
	})();
	// A category earns its tab by having charts, except Records — one bespoke
	// panel with no specs, kept whenever the bundle actually carries records.
	//
	// $derived, not a plain const: this reads the bundle, and `bundle` is a
	// prop that changes on navigation (the global page passes `data.bundle`
	// into an unkeyed component when the slice changes). validIds and
	// activeCategory hang off it, so a stale list would keep a dead tab valid.
	const sections = $derived(
		CATEGORIES.map((c) => ({
			id: c.id,
			label: c.label,
			specs: SPEC_GROUPS.get(c.id) ?? [],
		})).filter(
			(s) =>
				s.specs.length > 0 ||
				(s.id === "records" && Object.keys(bundle.records).length > 0),
		),
	);

	const validIds = $derived(new Set(sections.map((s) => s.id)));
	const activeCategory = $derived.by<StatsCategory>(() => {
		const fromUrl = page.url.searchParams.get("category");
		if (fromUrl && validIds.has(fromUrl as StatsCategory)) {
			return fromUrl as StatsCategory;
		}
		return sections[0]?.id ?? "yields";
	});

	async function onCategoryChange(value: string) {
		const next = new URL(page.url);
		next.searchParams.set("category", value);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		await goto(next, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function buildOption(specId: string): ChartOption | null {
		switch (specId) {
			case "nation-winloss-stacked":
				return nationWinLossStackedOption(bundle);
			case "nation-avg-points":
				return nationAvgPointsOption(bundle);
			case "starting-archetype-winloss":
				return startingArchetypeWinLossOption(bundle);
			case "starting-trait-winloss":
				return startingTraitWinLossOption(bundle);
			case "wonder-overview":
				return wonderOverviewOption(bundle);
			case "city-expansion-winrate":
				return expansionWinRateOption(bundle);
			default:
				return null;
		}
	}

	// Inject an in-chart ECharts title (text + optional subtext) and make
	// room for it in the grid — mirroring the game-detail charts, which
	// title themselves inside the chart rather than via an HTML heading.
	function titled(
		option: ChartOption | null,
		spec: { title: string; subtitle?: string },
	): ChartOption | null {
		if (!option) return null;
		const grid =
			option.grid && !Array.isArray(option.grid)
				? (option.grid as Record<string, unknown>)
				: COMMON_GRID;
		return {
			...option,
			title: {
				...CHART_THEME.title,
				text: spec.title,
				...(spec.subtitle
					? {
							subtext: spec.subtitle,
							subtextStyle: { color: CHART_THEME.textStyle.color },
						}
					: {}),
			},
			grid: { ...grid, top: spec.subtitle ? 92 : 64 },
		};
	}

	// Subtabs styled as rounded chips matching the yields toolbar buttons:
	// borderless, fill-based state (active = surface-raised "on", inactive =
	// surface "off"), separated by a gap on the list.
	const triggerClass =
		"cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-tan-hover data-[state=active]:bg-surface-raised data-[state=inactive]:bg-surface";
</script>

<Tabs.Root value={activeCategory} onValueChange={onCategoryChange}>
	<Tabs.List
		class="mb-4 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
	>
		{#each sections as s (s.id)}
			<Tabs.Trigger value={s.id} class={triggerClass}>{s.label}</Tabs.Trigger>
		{/each}
	</Tabs.List>

	{#each sections as section (section.id)}
		<Tabs.Content value={section.id} class="px-4 pb-4">
			{#if section.id === "yields"}
				<YieldsStatsPanel {bundle} {countLabel} toolbarFlush />
			{:else if section.id === "records"}
				<RecordsPanel {bundle} toolbarFlush />
			{:else if section.id === "families"}
				<FamilyStatsPanel {bundle} {showNationSelect} toolbarFlush />
			{:else if section.id === "laws"}
				<LawsStatsPanel {bundle} {showNationSelect} toolbarFlush />
			{:else if section.id === "tech"}
				<TechStatsPanel {bundle} {showNationSelect} toolbarFlush />
			{:else}
				{#each section.specs as spec (spec.id)}
					{#if spec.hasData(bundle)}
						{@const opt = titled(buildOption(spec.id), spec)}
						{#if opt}
							<ChartContainer
								option={opt}
								height={spec.height?.(bundle) ?? "400px"}
								title={spec.title}
							/>
						{/if}
					{:else}
						<p class="p-8 text-center italic text-tan opacity-60">
							{spec.emptyMessage?.(bundle) ?? "Not enough data."}
						</p>
					{/if}
				{/each}
			{/if}
		</Tabs.Content>
	{/each}
</Tabs.Root>
