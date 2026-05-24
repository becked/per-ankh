<script lang="ts">
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { PlayerUnitProduced } from "$lib/types/PlayerUnitProduced";
	import type { EChartsOption } from "echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import Chart from "$lib/Chart.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import { CHART_THEME } from "$lib/config";
	import SpriteIcon from "./SpriteIcon.svelte";
	import TableFilterColumn from "./TableFilterColumn.svelte";
	import NationFilterSelect from "./NationFilterSelect.svelte";
	import {
		type TableState,
		type UnitClass,
		TABLE_FRAME_CLASS,
		TABLE_CLASS,
		TABLE_HEADER_TH_CLASS,
		TABLE_CELL_TD_CLASS,
		getPlayerColor,
		toggleSort,
		classifyUnit,
		UNIT_CLASS_COLORS,
	} from "./helpers";

	let {
		gameDetails,
		playerHistory,
		unitsProduced,
		chartFilter = $bindable<Record<string, boolean>>({}),
		tableState = $bindable<TableState>({
			search: "",
			sortColumn: "nation",
			sortDirection: "asc",
			filters: [],
		}),
	}: {
		gameDetails: GameDetails;
		playerHistory: PlayerHistory[];
		unitsProduced: PlayerUnitProduced[];
		chartFilter?: Record<string, boolean>;
		tableState?: TableState;
	} = $props();

	// ─── Chart option ─────────────────────────────────────────────────
	const militaryChartOption = $derived<EChartsOption | null>(
		playerHistory
			? {
					...CHART_THEME,
					title: {
						...CHART_THEME.title,
						text: "Military Power",
					},
					legend: {
						show: false,
						data: playerHistory.map((p) => formatEnum(p.nation, "NATION_")),
						selected: chartFilter,
					},
					xAxis: {
						type: "category",
						name: "Turn",
						data: playerHistory[0]?.history.map((h) => h.turn) ?? [],
					},
					yAxis: {
						type: "value",
						name: "Military Power",
					},
					series: playerHistory.map((player, i) => ({
						name: formatEnum(player.nation, "NATION_"),
						type: "line",
						data: player.history.map((h) => h.military_power),
						itemStyle: { color: getPlayerColor(player.nation, i) },
					})),
				}
			: null,
	);

	// ─── Army composition pie charts ─────────────────────────────────
	type ArmyPieData = {
		nation: string | null;
		nationLabel: string;
		color: string;
		pieOption: EChartsOption;
	};

	const armyPieCharts = $derived<ArmyPieData[]>(
		gameDetails.players
			.map((p, i) => {
				const playerUnits = unitsProduced.filter((u) => u.nation === p.nation);
				const classCounts: Partial<Record<UnitClass, number>> = {};
				for (const u of playerUnits) {
					const cls = classifyUnit(u.unit_type);
					if (cls == null) continue;
					classCounts[cls] = (classCounts[cls] ?? 0) + u.count;
				}
				const slices = (Object.entries(classCounts) as [UnitClass, number][])
					.filter(([, count]) => count > 0)
					.sort(([, a], [, b]) => b - a);

				if (slices.length === 0) return null;

				const pieOption: EChartsOption = {
					backgroundColor: "#211A12",
					animation: false,
					title: {
						text: formatEnum(p.nation, "NATION_"),
						left: "center",
						top: 8,
						textStyle: { color: getPlayerColor(p.nation, i), fontSize: 14 },
					},
					tooltip: {
						trigger: "item",
						formatter: (params: any) =>
							`${params.name}: ${params.value} (${params.percent}%)`,
					},
					series: [
						{
							type: "pie",
							radius: ["30%", "60%"],
							center: ["50%", "55%"],
							avoidLabelOverlap: false,
							label: {
								show: true,
								position: "outside",
								formatter: "{b} {d}%",
								fontSize: 10,
								color: "#D2B48C",
							},
							labelLine: {
								show: true,
								length: 8,
								length2: 6,
								lineStyle: { color: "#666" },
							},
							data: slices.map(([unitClass, count]) => ({
								name: unitClass,
								value: count,
								itemStyle: { color: UNIT_CLASS_COLORS[unitClass] },
							})),
						},
					],
				};

				return {
					nation: p.nation,
					nationLabel: formatEnum(p.nation, "NATION_"),
					color: getPlayerColor(p.nation, i),
					pieOption,
				};
			})
			.filter((d): d is ArmyPieData => d != null)
			.sort((a, b) => a.nationLabel.localeCompare(b.nationLabel)),
	);

	// ─── Units pivot table logic ──────────────────────────────────────
	const uniqueUnitNations = $derived(
		[
			...new Set(
				unitsProduced
					.map((u) => u.nation)
					.filter((n): n is string => n != null),
			),
		].sort(),
	);

	const selectedUnitNations = $derived(
		tableState.filters
			.filter((f) => f.startsWith("nation:"))
			.map((f) => f.replace("nation:", "")),
	);

	const displayedUnitNations = $derived(
		selectedUnitNations.length > 0 ? selectedUnitNations : uniqueUnitNations,
	);

	type UnitPivotRow = {
		unit_type: string;
		counts: Record<string, number>;
		total: number;
	};

	const unitPivotData = $derived.by(() => {
		if (unitsProduced.length === 0) return [];

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const pivotMap = new Map<string, Record<string, number>>();

		for (const u of unitsProduced) {
			if (!u.nation) continue;
			if (!pivotMap.has(u.unit_type)) {
				pivotMap.set(u.unit_type, {});
			}
			const counts = pivotMap.get(u.unit_type)!;
			counts[u.nation] = (counts[u.nation] ?? 0) + u.count;
		}

		const rows: UnitPivotRow[] = [];
		for (const [unit_type, counts] of pivotMap) {
			if (tableState.search) {
				const term = tableState.search.toLowerCase();
				if (!unit_type.toLowerCase().includes(term)) {
					continue;
				}
			}
			const total = displayedUnitNations.reduce(
				(sum, nation) => sum + (counts[nation] ?? 0),
				0,
			);
			rows.push({ unit_type, counts, total });
		}

		rows.sort((a, b) => {
			if (tableState.sortColumn === "unit_type") {
				const cmp = a.unit_type.localeCompare(b.unit_type);
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			} else if (tableState.sortColumn === "total") {
				const cmp = a.total - b.total;
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			} else if (tableState.sortColumn.startsWith("nation:")) {
				const nation = tableState.sortColumn.replace("nation:", "");
				const aVal = a.counts[nation] ?? 0;
				const bVal = b.counts[nation] ?? 0;
				const cmp = aVal - bVal;
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			}
			return a.unit_type.localeCompare(b.unit_type);
		});

		return rows;
	});
</script>

{#if militaryChartOption || armyPieCharts.length > 0}
	<div class="mb-4 rounded-lg p-4" style="background-color: #2a2622;">
		<!-- Military Power Chart -->
		{#if militaryChartOption}
			<ChartContainer
				option={militaryChartOption}
				height="400px"
				title="Military Power"
			/>
		{/if}

		<!-- Army Composition Pie Charts -->
		{#if armyPieCharts.length > 0}
			<div
				class="{militaryChartOption ? 'mt-4 ' : ''}grid gap-4"
				style="grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));"
			>
				{#each armyPieCharts as chart (chart.nation)}
					<div class="overflow-hidden rounded-lg">
						<Chart option={chart.pieOption} height="200px" />
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<!-- Units Produced Table -->
{#if unitsProduced.length > 0}
	<h3 class="mb-2 font-bold text-tan">Units Produced</h3>
	<div class={TABLE_FRAME_CLASS}>
		<TableFilterColumn
			bind:search={tableState.search}
			count={`${unitPivotData.length} unit types`}
			chips={selectedUnitNations.map((n) => formatEnum(n, "NATION_"))}
		>
			{#snippet filters()}
				<NationFilterSelect
					nations={uniqueUnitNations}
					bind:value={tableState.filters}
				/>
			{/snippet}
		</TableFilterColumn>

		<!-- Units Pivot Table -->
		<div class="min-w-0 flex-1 overflow-x-auto">
			<table class={TABLE_CLASS}>
				<thead>
					<tr>
						<th
							class="{TABLE_HEADER_TH_CLASS} rounded-l-lg border-l {displayedUnitNations.length ===
							0
								? 'rounded-r-lg border-r'
								: ''}"
							onclick={() => toggleSort(tableState, "unit_type")}
						>
							<span class="inline-flex items-center gap-1">
								Unit
								{#if tableState.sortColumn === "unit_type"}
									<span class="text-orange">
										{tableState.sortDirection === "asc" ? "↑" : "↓"}
									</span>
								{/if}
							</span>
						</th>
						{#each displayedUnitNations as nation (nation)}
							<th
								class="{TABLE_HEADER_TH_CLASS} !text-right {displayedUnitNations.length ===
								1
									? 'rounded-r-lg border-r'
									: ''}"
								onclick={() => toggleSort(tableState, `nation:${nation}`)}
							>
								<span class="inline-flex items-center justify-end gap-1.5">
									<SpriteIcon
										category="crests"
										value={nation}
										size={14}
										alt={formatEnum(nation, "NATION_")}
									/>
									{formatEnum(nation, "NATION_")}
									{#if tableState.sortColumn === `nation:${nation}`}
										<span class="text-orange">
											{tableState.sortDirection === "asc" ? "↑" : "↓"}
										</span>
									{/if}
								</span>
							</th>
						{/each}
						{#if displayedUnitNations.length > 1}
							<th
								class="{TABLE_HEADER_TH_CLASS} rounded-r-lg border-r !text-right"
								onclick={() => toggleSort(tableState, "total")}
							>
								<span class="inline-flex items-center justify-end gap-1">
									Total
									{#if tableState.sortColumn === "total"}
										<span class="text-orange">
											{tableState.sortDirection === "asc" ? "↑" : "↓"}
										</span>
									{/if}
								</span>
							</th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each unitPivotData as row (row.unit_type)}
						<tr class="group">
							<td
								class="{TABLE_CELL_TD_CLASS} whitespace-nowrap rounded-l-lg {displayedUnitNations.length ===
								0
									? 'rounded-r-lg'
									: ''}"
							>
								{formatEnum(row.unit_type, "UNIT_")}
							</td>
							{#each displayedUnitNations as nation (nation)}
								<td
									class="{TABLE_CELL_TD_CLASS} whitespace-nowrap !text-right {displayedUnitNations.length ===
									1
										? 'rounded-r-lg'
										: ''}"
								>
									{row.counts[nation] ?? 0}
								</td>
							{/each}
							{#if displayedUnitNations.length > 1}
								<td
									class="{TABLE_CELL_TD_CLASS} whitespace-nowrap rounded-r-lg !text-right font-bold"
								>
									{row.total}
								</td>
							{/if}
						</tr>
					{:else}
						<tr>
							<td
								colspan={displayedUnitNations.length + 2}
								class="p-8 text-center italic text-tan"
							>
								No units match search
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{:else}
	<p class="p-8 text-center italic text-tan">
		No unit production data available
	</p>
{/if}
