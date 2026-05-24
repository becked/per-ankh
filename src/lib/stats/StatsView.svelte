<script lang="ts">
	// Stats catalog renderer. Renders the ChartBundle as category subtabs
	// (styled like the game-detail tabs); each category shows a single
	// column of full-width ChartContainers, matching the game-detail chart
	// UI (in-chart titles + fullscreen-expand). The active category lives
	// in ?category (controlled: value derived from the URL, change → goto).

	import { Tabs } from "bits-ui";
	import type { EChartsOption } from "echarts";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import YieldsStatsPanel from "./YieldsStatsPanel.svelte";
	import FamilyStatsPanel from "./FamilyStatsPanel.svelte";
	import LawsStatsPanel from "./LawsStatsPanel.svelte";
	import TechStatsPanel from "./TechStatsPanel.svelte";
	import { CHART_THEME, COMMON_GRID } from "./charts/helpers";
	import { CATEGORIES, CHART_SPECS } from "./charts/registry";
	import {
		nationAvgPointsOption,
		nationWinLossStackedOption,
	} from "./charts/nations";
	import { expansionWinRateOption } from "./charts/cities";
	import type { ChartBundle, StatsCategory } from "./types";

	let { bundle }: { bundle: ChartBundle } = $props();

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
	const sections = CATEGORIES.map((c) => ({
		id: c.id,
		label: c.label,
		specs: SPEC_GROUPS.get(c.id) ?? [],
	})).filter((s) => s.specs.length > 0);

	const validIds = new Set(sections.map((s) => s.id));
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

	function buildOption(specId: string): EChartsOption | null {
		switch (specId) {
			case "nation-winloss-stacked":
				return nationWinLossStackedOption(bundle);
			case "nation-avg-points":
				return nationAvgPointsOption(bundle);
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
		option: EChartsOption | null,
		spec: { title: string; subtitle?: string },
	): EChartsOption | null {
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
	// borderless, fill-based state (active = #35302B "on", inactive =
	// #2a2622 "off"), separated by a gap on the list.
	const triggerClass =
		"cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622]";
</script>

<Tabs.Root value={activeCategory} onValueChange={onCategoryChange}>
	<Tabs.List
		class="mb-4 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-[#2a2622] bg-[#241f1b] p-2 shadow-lg"
	>
		{#each sections as s (s.id)}
			<Tabs.Trigger value={s.id} class={triggerClass}>{s.label}</Tabs.Trigger>
		{/each}
	</Tabs.List>

	{#each sections as section (section.id)}
		<Tabs.Content value={section.id} class="px-4 pb-4">
			{#if section.id === "yields"}
				<YieldsStatsPanel {bundle} />
			{:else if section.id === "families"}
				<FamilyStatsPanel {bundle} />
			{:else if section.id === "laws"}
				<LawsStatsPanel {bundle} />
			{:else if section.id === "tech"}
				<TechStatsPanel {bundle} />
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
						<p class="p-8 text-center italic text-brown">
							{spec.emptyMessage?.(bundle) ?? "Not enough data."}
						</p>
					{/if}
				{/each}
			{/if}
		</Tabs.Content>
	{/each}
</Tabs.Root>
