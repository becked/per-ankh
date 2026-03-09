<script lang="ts">
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { PlayerUnitProduced } from "$lib/types/PlayerUnitProduced";
	import type { EChartsOption } from "echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import Chart from "$lib/Chart.svelte";
	import SearchInput from "$lib/SearchInput.svelte";
	import { Select } from "bits-ui";
	import { formatEnum } from "$lib/utils/formatting";
	import { CHART_THEME } from "$lib/config";
	import { type TableState, type UnitClass, getPlayerColor, toggleSort, classifyUnit, UNIT_CLASS_COLORS } from "./helpers";

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
						formatter: (params: any) => `${params.name}: ${params.value} (${params.percent}%)`,
					},
					series: [{
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
					}],
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
		class="mb-6 grid gap-4"
		style="grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));"
	>
		{#each armyPieCharts as chart (chart.nation)}
			<div class="overflow-hidden rounded-lg">
				<Chart option={chart.pieOption} height="200px" />
			</div>
		{/each}
	</div>
{/if}

<!-- Units Produced Table -->
{#if unitsProduced.length > 0}
	<div
		class="mt-6 rounded-lg p-4"
		style="background-color: #2a2622;"
	>
		<h3 class="mb-4 font-bold text-tan">Units Produced</h3>

		<!-- Controls row -->
		<div class="mb-4 flex flex-wrap items-end gap-3">
			<!-- Filter dropdown -->
			<Select.Root type="multiple" bind:value={tableState.filters}>
				<Select.Trigger
					class="relative flex w-32 items-center justify-between rounded py-2 pl-9 pr-8 text-sm text-tan"
					style="background-color: #201a13;"
				>
					<div
						class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4 text-brown"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M3 4h18M5 8h14M7 12h10M9 16h6"
							/>
						</svg>
					</div>
					<span class="truncate">Filter</span>
					<span class="ml-2">▼</span>
				</Select.Trigger>
				<Select.Portal>
					<Select.Content
						class="z-50 max-h-64 overflow-y-auto rounded bg-[#201a13] shadow-lg"
					>
						<Select.Viewport>
							{#if uniqueUnitNations.length > 0}
								<Select.Group>
									<Select.GroupHeading
										class="border-b border-[#2a2622] px-3 py-2 text-xs font-bold uppercase tracking-wide text-brown"
									>
										Nations
									</Select.GroupHeading>
									{#each uniqueUnitNations as nation (nation)}
										<Select.Item
											value={`nation:${nation}`}
											label={formatEnum(nation, "NATION_")}
											class="hover:bg-brown/30 data-[highlighted]:bg-brown/30 flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan"
										>
											{#snippet children({ selected })}
												{formatEnum(nation, "NATION_")}
												{#if selected}
													<span class="font-bold text-orange">✓</span>
												{/if}
											{/snippet}
										</Select.Item>
									{/each}
								</Select.Group>
							{/if}
						</Select.Viewport>
					</Select.Content>
				</Select.Portal>
			</Select.Root>

			<!-- Search -->
			<SearchInput
				bind:value={tableState.search}
				placeholder="Search units"
				variant="field"
				class="w-64"
			/>

			<!-- Selected filter chips -->
			{#if tableState.filters.length > 0}
				<div class="flex flex-wrap gap-1">
					{#each tableState.filters as filter (filter)}
						<span class="rounded bg-brown px-2 py-1 text-xs text-white">
							{formatEnum(filter.replace("nation:", ""), "NATION_")}
						</span>
					{/each}
				</div>
			{/if}

			<!-- Results count -->
			<span class="ml-auto text-sm text-brown">
				{unitPivotData.length} unit types
			</span>
		</div>

		<!-- Units Pivot Table -->
		<div
			class="overflow-x-auto rounded-lg"
			style="background-color: #35302B;"
		>
			<table class="w-full">
				<thead>
					<tr>
						<th
							class="hover:bg-brown/20 cursor-pointer select-none whitespace-nowrap border-b-2 border-[#2a2622] p-3 text-left font-bold text-brown"
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
								class="hover:bg-brown/20 cursor-pointer select-none whitespace-nowrap border-b-2 border-[#2a2622] p-3 text-right font-bold text-brown"
								onclick={() => toggleSort(tableState, `nation:${nation}`)}
							>
								<span
									class="inline-flex items-center justify-end gap-1"
								>
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
								class="hover:bg-brown/20 cursor-pointer select-none whitespace-nowrap border-b-2 border-[#2a2622] p-3 text-right font-bold text-brown"
								onclick={() => toggleSort(tableState, "total")}
							>
								<span
									class="inline-flex items-center justify-end gap-1"
								>
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
						<tr class="hover:bg-brown/10">
							<td
								class="whitespace-nowrap border-b border-[#2a2622] p-3 text-left text-tan"
							>
								{formatEnum(row.unit_type, "UNIT_")}
							</td>
							{#each displayedUnitNations as nation (nation)}
								<td
									class="whitespace-nowrap border-b border-[#2a2622] p-3 text-right text-tan"
								>
									{row.counts[nation] ?? 0}
								</td>
							{/each}
							{#if displayedUnitNations.length > 1}
								<td
									class="whitespace-nowrap border-b border-[#2a2622] p-3 text-right font-bold text-tan"
								>
									{row.total}
								</td>
							{/if}
						</tr>
					{:else}
						<tr>
							<td
								colspan={displayedUnitNations.length + 2}
								class="p-8 text-center text-brown italic"
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
	<p class="p-8 text-center italic text-brown">
		No unit production data available
	</p>
{/if}
