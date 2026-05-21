<script lang="ts">
	import type { ECElementEvent, EChartsOption } from "echarts";
	import { get } from "svelte/store";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import CloudGameSidebar from "$lib/CloudGameSidebar.svelte";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import { formatEnum } from "$lib/utils/formatting";
	import {
		CHART_THEME,
		getChartColor,
		getCivilizationColor,
		getNationColor,
	} from "$lib/config";
	import { searchQuery } from "$lib/stores/search";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
	const stats = $derived(data.stats);

	// 0=Sunday..6=Saturday, matching SQLite strftime('%w').
	const DAY_NAMES = [
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
	];

	const favoriteNation = $derived(stats.nations[0]?.nation ?? null);
	const favoriteDay = $derived(
		stats.favorite_day_of_week != null
			? DAY_NAMES[stats.favorite_day_of_week]
			: null,
	);
	const winRatePct = $derived(
		stats.win_rate != null ? Math.round(stats.win_rate * 100) : null,
	);

	// Cross-filter state lives in the URL (?nation=, ?date=) so a chart
	// click is shareable, browser back/forward restores the prior filter,
	// and the +page.ts load() can ask the worker for the filtered slice.
	const selectedNation = $derived(data.selectedNation);
	const selectedDate = $derived(data.selectedDate);

	// Toggle a single URL search param: same value → remove, different → set.
	// replaceState avoids polluting history with chart-click ticks; noScroll
	// keeps the dashboard scroll position when only the sidebar updates.
	async function toggleSearchParam(key: string, value: string | null) {
		const next = new URL(page.url);
		const current = next.searchParams.get(key);
		if (value === null || current === value) {
			next.searchParams.delete(key);
		} else {
			next.searchParams.set(key, value);
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		await goto(next, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function handleNationClick(params: ECElementEvent) {
		if (params.componentType !== "series" || params.seriesType !== "bar")
			return;
		const nation = stats.nations[params.dataIndex]?.nation;
		if (!nation) return;
		void toggleSearchParam("nation", nation);
	}

	function handleCalendarClick(params: ECElementEvent) {
		if (params.componentType !== "series" || params.seriesType !== "custom")
			return;
		// Custom-series value tuple: [date, nationsJson, colorsJson]
		const value = params.value as [string, string, string] | undefined;
		const date = value?.[0];
		if (!date) return;
		void toggleSearchParam("date", date);
	}

	// Sync the global search store from the URL on every load() run so a
	// shareable link with ?q=… populates the header input. The reverse
	// direction (input → URL) is the debounced effect below.
	//
	// CRITICAL: read the store via `get()` (non-reactive) instead of `$searchQuery`
	// so this effect only tracks `data.searchValue`. Reading the store
	// reactively here would create a feedback loop — every keystroke
	// updates the store, this effect re-runs, the comparison still finds
	// `data.searchValue` (the URL hasn't updated yet) different from the
	// store value the user just typed, and the effect overwrites the
	// in-flight keystroke with "". The user can't type anything.
	$effect(() => {
		const next = data.searchValue;
		if (next !== get(searchQuery)) searchQuery.set(next);
	});

	// Debounce search-input writes to the URL so a fast typist doesn't fire
	// a request per keystroke. 300ms is the standard "search-as-you-type"
	// feel; the AbortController in the sidebar handles in-flight cancellation
	// when a later keystroke supersedes an earlier one.
	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const current = $searchQuery;
		// Skip the initial run when store matches URL (avoids a no-op goto).
		if (current === data.searchValue) return;
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(() => {
			const next = new URL(page.url);
			if (current.trim() === "") next.searchParams.delete("q");
			else next.searchParams.set("q", current.trim());
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
			void goto(next, { replaceState: true, keepFocus: true, noScroll: true });
		}, 300);
		return () => {
			if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		};
	});

	const chartOption = $derived<EChartsOption>({
		...CHART_THEME,
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
		},
		xAxis: {
			type: "category",
			data: stats.nations.map((n) => formatEnum(n.nation, "NATION_")),
			axisLabel: {
				rotate: 45,
				interval: 0,
			},
		},
		yAxis: {
			type: "value",
			name: "Games Played",
		},
		series: [
			{
				name: "Games Played",
				type: "bar",
				data: stats.nations.map((n, i) => ({
					value: n.games_played,
					itemStyle: {
						color:
							getCivilizationColor(n.nation.replace(/^NATION_/, "")) ??
							getChartColor(i),
					},
				})),
			},
		],
		grid: {
			bottom: 60,
		},
	});

	// Calendar chart: custom series with split cells for multi-nation days.
	// Direct port of src/routes/+page.svelte:85-235.
	function buildCalendarChartOption(
		dates: Array<{ date: string; nation: string | null }>,
	): EChartsOption | null {
		if (dates.length === 0) return null;

		const today = new Date();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Date used in regular function, not reactive state
		const sixMonthsAgo = new Date(today);
		sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

		const maxDate = today.toISOString().split("T")[0];
		const minDate = sixMonthsAgo.toISOString().split("T")[0];

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used in regular function, not reactive state
		const dateToNations = new Map<string, string[]>();
		for (const entry of dates) {
			if (entry.date < minDate || entry.date > maxDate) continue;

			const nation = entry.nation ?? "Unknown";
			const existing = dateToNations.get(entry.date) ?? [];
			if (!existing.includes(nation)) {
				existing.push(nation);
			}
			dateToNations.set(entry.date, existing);
		}

		const customData: Array<[string, string, string]> = [];
		for (const [date, nations] of dateToNations) {
			const colors = nations.map((nation) => {
				const nationKey = nation.replace(/^NATION_/, "");
				return getNationColor(nationKey) ?? getChartColor(0);
			});
			customData.push([date, JSON.stringify(nations), JSON.stringify(colors)]);
		}

		return {
			...CHART_THEME,
			tooltip: {
				trigger: "item",
				formatter: (params: unknown) => {
					const p = params as { value: [string, string, string] };
					const nations = JSON.parse(p.value[1]) as string[];
					const nationsFormatted = nations
						.map((n) => formatEnum(n, "NATION_"))
						.join("<br/>");
					return `${p.value[0]}<br/>${nationsFormatted}`;
				},
			},
			calendar: {
				range: [minDate, maxDate],
				cellSize: ["auto", 20],
				left: 60,
				right: 30,
				top: 80,
				bottom: 20,
				itemStyle: {
					color: CHART_THEME.backgroundColor,
					borderWidth: 1,
					borderColor: "#c5c3c2",
				},
				dayLabel: {
					color: CHART_THEME.title?.textStyle?.color ?? "#D2B48C",
				},
				monthLabel: {
					color: CHART_THEME.title?.textStyle?.color ?? "#D2B48C",
				},
				yearLabel: {
					color: CHART_THEME.title?.textStyle?.color ?? "#D2B48C",
				},
				splitLine: {
					lineStyle: {
						color: "#c5c3c2",
					},
				},
			},
			series: [
				{
					type: "custom",
					coordinateSystem: "calendar",
					data: customData,
					/* eslint-disable no-unused-vars -- Parameters in type signature */
					renderItem: (
						params: { coordSys: { cellWidth: number; cellHeight: number } },
						api: {
							value: (idx: number) => string;
							coord: (date: string) => [number, number];
						},
						/* eslint-enable no-unused-vars */
					) => {
						const date = api.value(0);
						const cellPoint = api.coord(date);
						const cellWidth = params.coordSys.cellWidth;
						const cellHeight = params.coordSys.cellHeight;

						const colorsJson = api.value(2);
						const colors = JSON.parse(colorsJson) as string[];
						const numColors = colors.length;

						if (numColors === 1) {
							return {
								type: "rect",
								shape: {
									x: cellPoint[0] - cellWidth / 2,
									y: cellPoint[1] - cellHeight / 2,
									width: cellWidth,
									height: cellHeight,
								},
								style: {
									fill: colors[0],
								},
							};
						} else {
							const sliceWidth = cellWidth / numColors;
							return {
								type: "group",
								children: colors.map((color, i) => ({
									type: "rect",
									shape: {
										x: cellPoint[0] - cellWidth / 2 + i * sliceWidth,
										y: cellPoint[1] - cellHeight / 2,
										width: sliceWidth,
										height: cellHeight,
									},
									style: {
										fill: color,
									},
								})),
							};
						}
					},
				},
			],
		} as EChartsOption;
	}

	const calendarChartOption = $derived(
		buildCalendarChartOption(stats.save_dates),
	);
</script>

<!--
	app.css globally sets `html, body { height: 100%; overflow: hidden }` to
	support the desktop Tauri shell, which scrolls internally. Cloud routes
	therefore need their own scroll container; mirroring the pattern from
	src/routes/games/[id]/+page.svelte:50.

	Layout mirrors desktop: stats main pane, game sidebar pinned right.
-->
<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<h1 class="mb-8 text-3xl font-bold text-gray-200">Overview</h1>

			<div class="mb-6 rounded-lg p-4" style="background-color: #2a2622;">
				<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
					<div class="rounded-lg p-3" style="background-color: #35302B;">
						<p class="mb-1 text-xs font-bold text-gray-400">Saves Uploaded</p>
						<p class="text-lg font-bold" style="color: #DBDEE3;">
							{stats.total_games}
						</p>
					</div>

					<div class="rounded-lg p-3" style="background-color: #35302B;">
						<p class="mb-1 text-xs font-bold text-gray-400">Win Rate</p>
						<p class="text-lg font-bold" style="color: #DBDEE3;">
							{#if winRatePct != null}
								{winRatePct}%
							{:else}
								—
							{/if}
						</p>
					</div>

					<div class="rounded-lg p-3" style="background-color: #35302B;">
						<p
							class="mb-1 flex items-center gap-1 text-xs font-bold text-gray-400"
						>
							{#if favoriteNation}
								<SpriteIcon
									category="crests"
									value={favoriteNation}
									size={14}
									alt={formatEnum(favoriteNation, "NATION_")}
								/>
							{/if}
							Favorite Nation
						</p>
						<p class="text-lg font-bold" style="color: #DBDEE3;">
							{#if favoriteNation}
								{formatEnum(favoriteNation, "NATION_")}
							{:else}
								—
							{/if}
						</p>
					</div>

					<div class="rounded-lg p-3" style="background-color: #35302B;">
						<p class="mb-1 text-xs font-bold text-gray-400">Favorite Day</p>
						<p class="text-lg font-bold" style="color: #DBDEE3;">
							{favoriteDay ?? "—"}
						</p>
					</div>
				</div>
			</div>

			{#if stats.nations.length > 0 || calendarChartOption}
				<div
					class="rounded-lg px-8 pb-2 pt-8"
					style="background-color: #35302B;"
				>
					{#if calendarChartOption}
						<ChartContainer
							option={calendarChartOption}
							height="250px"
							title="Calendar"
							onItemClick={handleCalendarClick}
						/>
					{/if}

					{#if stats.nations.length > 0}
						<ChartContainer
							option={chartOption}
							height="320px"
							title="Games by Nation"
							onItemClick={handleNationClick}
						/>
					{/if}
				</div>
			{/if}
		</div>
	</main>

	<CloudGameSidebar
		initialGames={data.games}
		total={data.gamesTotal}
		pageSize={data.pageSize}
		collections={data.collections}
		publicCount={data.publicCount}
		currentGameId={null}
		activeFilter={data.activeFilter}
		{selectedNation}
		{selectedDate}
		onClearNationFilter={() => toggleSearchParam("nation", null)}
		onClearDateFilter={() => toggleSearchParam("date", null)}
	/>
</div>
