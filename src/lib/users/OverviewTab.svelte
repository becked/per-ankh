<script lang="ts">
	// Overview tab — scoped view of the selected corpus: a save-date
	// calendar heatmap and a games-by-nation bar. All data comes from the
	// single scoped ChartBundle. (The headline tiles live in the profile
	// card, where they're intentionally unscoped.) No chart-click cross-filter.

	import type { ECElementEvent, EChartsOption } from "echarts";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import Popover from "$lib/ui/Popover.svelte";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import { formatEnum, formatGameTitle } from "$lib/utils/formatting";
	import {
		CHART_THEME,
		getChartColor,
		getCivilizationColor,
		getNationColor,
	} from "$lib/config";
	import type { ChartBundle } from "$lib/stats/types";

	let { bundle }: { bundle: ChartBundle } = $props();

	// One clickable game per calendar cell. A date can hold several games
	// (different nations the same day, and re-uploads create distinct records),
	// so we key a list per date. The title mirrors the game page heading
	// exactly — same formatGameTitle, with nation as save_owner_nation and the
	// match_id: 0 sentinel (unreachable since total_turns is NOT NULL), matching
	// the other D1-list callers (RecentSaveCard, HeaderGameSearch).
	type DayGame = { game_id: string; nation: string | null; title: string };
	const dateToGames = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Map in a derived, not reactive state
		const m = new Map<string, DayGame[]>();
		for (const e of bundle.save_dates) {
			const games = m.get(e.date) ?? [];
			games.push({
				game_id: e.game_id,
				nation: e.nation,
				title: formatGameTitle({
					display_name: e.display_name,
					game_name: e.game_name,
					save_owner_nation: e.nation,
					total_turns: e.total_turns,
					match_id: 0,
				}),
			});
			m.set(e.date, games);
		}
		return m;
	});

	// Picker popover state. A single-game day navigates straight to the game; a
	// multi-game day anchors a chooser at the click point (floating-ui virtual
	// anchor — same pattern as the tournament matches page).
	let pickerOpen = $state(false);
	let pickerGames = $state<DayGame[]>([]);
	let pickerAnchor = $state<{ getBoundingClientRect: () => DOMRect } | null>(
		null,
	);

	async function onCalendarClick(params: ECElementEvent) {
		// Custom calendar series: the clicked cell's data item is our
		// [date, nations, colors] tuple, so the date is value[0].
		const value = params.value as [string, string, string] | undefined;
		const date = Array.isArray(value) ? value[0] : undefined;
		if (!date) return;
		const games = dateToGames.get(date) ?? [];
		if (games.length === 0) return;
		if (games.length === 1) {
			await goto(resolve("/games/[id]", { id: games[0].game_id }));
			return;
		}
		// Anchor the chooser at the cursor. The ECharts event wraps the native
		// browser event, whose clientX/clientY are the viewport coords floating-ui
		// expects.
		const native = (
			params.event as unknown as { event?: MouseEvent } | undefined
		)?.event;
		const x = native?.clientX ?? 0;
		const y = native?.clientY ?? 0;
		pickerAnchor = { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
		pickerGames = games;
		pickerOpen = true;
	}

	const nationChartOption = $derived<EChartsOption>({
		...CHART_THEME,
		tooltip: {
			...CHART_THEME.tooltip,
			axisPointer: { type: "shadow" },
		},
		xAxis: {
			type: "category",
			data: bundle.nations.map((n) => formatEnum(n.nation, "NATION_")),
			axisLabel: { rotate: 45, interval: 0 },
		},
		yAxis: { type: "value", name: "Games Played" },
		series: [
			{
				name: "Games Played",
				type: "bar",
				data: bundle.nations.map((n, i) => ({
					value: n.games_played,
					itemStyle: {
						color: getCivilizationColor(n.nation) ?? getChartColor(i),
					},
				})),
			},
		],
		grid: { bottom: 60 },
	});

	// Calendar heatmap with split cells for multi-nation days. Ported from
	// the previous /users/[user_id] overview page; reads bundle.save_dates.
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
			if (!existing.includes(nation)) existing.push(nation);
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
				dayLabel: { color: CHART_THEME.title?.textStyle?.color ?? "#D2B48C" },
				monthLabel: { color: CHART_THEME.title?.textStyle?.color ?? "#D2B48C" },
				yearLabel: { color: CHART_THEME.title?.textStyle?.color ?? "#D2B48C" },
				splitLine: { lineStyle: { color: "#c5c3c2" } },
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

						const colors = JSON.parse(api.value(2)) as string[];
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
								style: { fill: colors[0] },
								// Cells are click-through to the game page.
								cursor: "pointer",
							};
						}
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
								style: { fill: color },
								cursor: "pointer",
							})),
						};
					},
				},
			],
		} as EChartsOption;
	}

	const calendarChartOption = $derived(
		buildCalendarChartOption(bundle.save_dates),
	);
</script>

{#if bundle.nations.length > 0 || calendarChartOption}
	{#if calendarChartOption}
		<!--
			Keyed on save_dates so the chart fully remounts (fresh ECharts init)
			when the scope changes. ECharts' calendar coordinate system + custom
			series doesn't re-render correctly through an in-place
			setOption(…, notMerge) update — the cells map against a stale
			calendar layout and render off-canvas — so we recreate the instance
			instead, matching the (working) full-page-load path.
		-->
		{#key bundle.save_dates}
			<ChartContainer
				option={calendarChartOption}
				height="250px"
				title="Calendar"
				onItemClick={onCalendarClick}
			/>
		{/key}
	{/if}
	{#if bundle.nations.length > 0}
		<ChartContainer
			option={nationChartOption}
			height="320px"
			title="Games by Nation"
		/>
	{/if}
{:else}
	<div
		class="rounded-lg p-8 text-center text-sm text-tan opacity-60"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		No games in this scope yet.
	</div>
{/if}

<!-- Multi-game day chooser. A calendar cell can hold several games; clicking
     one opens this list anchored at the cursor (single-game days navigate
     directly and never reach here). -->
<Popover
	open={pickerOpen}
	onOpenChange={(o) => {
		if (!o) pickerOpen = false;
	}}
	customAnchor={pickerAnchor}
	side="bottom"
	align="center"
	contentClass="w-fit max-w-[min(92vw,22rem)]"
	frameClass="border-4 border-surface-raised bg-blue-gray p-2 shadow-lg"
	ariaLabel="Games on this day"
>
	<div class="flex flex-col gap-1">
		{#each pickerGames as game (game.game_id)}
			<a
				href={resolve("/games/[id]", { id: game.game_id })}
				onclick={() => (pickerOpen = false)}
				class="inline-flex items-center gap-1.5 rounded border border-input px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
			>
				{#if game.nation}
					<SpriteIcon
						category="crests"
						value={game.nation}
						size={16}
						alt={formatEnum(game.nation, "NATION_")}
					/>
				{/if}
				<span class="truncate">{game.title}</span>
			</a>
		{/each}
	</div>
</Popover>
