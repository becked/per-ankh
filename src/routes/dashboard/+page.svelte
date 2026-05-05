<script lang="ts">
	import type { EChartsOption } from "echarts";
	import Chart from "$lib/Chart.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import {
		CHART_THEME,
		getChartColor,
		getCivilizationColor,
		getNationColor,
	} from "$lib/config";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
	const stats = $derived(data.stats);

	const chartOption = $derived<EChartsOption>({
		...CHART_THEME,
		title: {
			...CHART_THEME.title,
			text: "Games by Nation",
		},
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
			bottom: 100,
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
			title: {
				...CHART_THEME.title,
				text: "Calendar",
			},
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

	const calendarChartOption = $derived(buildCalendarChartOption(stats.save_dates));
</script>

<!--
	app.css globally sets `html, body { height: 100%; overflow: hidden }` to
	support the desktop Tauri shell, which scrolls internally. Cloud routes
	therefore need their own scroll container; mirroring the pattern from
	src/routes/games/[id]/+page.svelte:50.
-->
<main class="isolate flex flex-1 flex-col overflow-hidden">
	<div class="flex-1 overflow-y-auto px-4 pb-8 pt-4">
		<h1 class="mb-8 text-3xl font-bold text-gray-200">Overview</h1>

		<div
			class="mb-8 rounded-lg border-2 border-black p-2"
			style="background-color: #36302a;"
		>
			<div class="flex items-center justify-center gap-2">
				<span class="text-sm font-bold uppercase tracking-wide text-brown"
					>Games Played:</span
				>
				<span class="text-2xl font-bold" style="color: #EEEEEE;"
					>{stats.total_games}</span
				>
			</div>
		</div>

		{#if stats.nations.length > 0}
			<div
				class="mb-8 rounded-lg border-2 border-black p-1"
				style="background-color: var(--color-chart-frame)"
			>
				<Chart option={chartOption} height="400px" />
			</div>
		{/if}

		{#if calendarChartOption}
			<div
				class="mb-8 rounded-lg border-2 border-black p-1"
				style="background-color: var(--color-chart-frame)"
			>
				<Chart option={calendarChartOption} height="250px" />
			</div>
		{/if}
	</div>
</main>
