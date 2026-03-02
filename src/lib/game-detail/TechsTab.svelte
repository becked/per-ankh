<script lang="ts">
	import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
	import type { PlayerTech } from "$lib/types/PlayerTech";
	import type { EChartsOption } from "echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import SearchInput from "$lib/SearchInput.svelte";
	import { Select } from "bits-ui";
	import { formatEnum } from "$lib/utils/formatting";
	import { CHART_THEME } from "$lib/config";
	import { type TableState, getPlayerColor } from "./helpers";

	let {
		techDiscoveryHistory,
		completedTechs,
		chartFilter = $bindable<Record<string, boolean>>({}),
		tableState = $bindable<TableState>({
			search: "",
			sortColumn: "nation",
			sortDirection: "asc",
			filters: [],
		}),
	}: {
		techDiscoveryHistory: TechDiscoveryHistory[];
		completedTechs: PlayerTech[];
		chartFilter?: Record<string, boolean>;
		tableState?: TableState;
	} = $props();

	// ─── Chart option ─────────────────────────────────────────────────
	const techDiscoveryChartOption = $derived(
		techDiscoveryHistory.length > 0
			? (() => {
					const players = techDiscoveryHistory;
					const maxTechCount = Math.max(
						...players.flatMap((player) =>
							player.data.map((d) => d.tech_count),
						),
					);
					const finalTurn = Math.max(
						...players.flatMap((player) => player.data.map((d) => d.turn)),
					);
					const nationNames = players.map((p) =>
						formatEnum(p.nation, "NATION_"),
					);

					return {
						...CHART_THEME,
						title: {
							...CHART_THEME.title,
							text: "Tech Discovery Over Time",
						},
						legend: {
							show: false,
							data: nationNames,
							selected: chartFilter,
						},
						tooltip: {
							trigger: "item",
							formatter: (params: { data: unknown }) => {
								const data = params.data as
									| [number, number, string | null]
									| undefined;
								if (!data) return "";
								const [turn, count, techName] = data;
								if (techName) {
									const formattedTech = formatEnum(techName, "TECH_");
									return `Turn ${turn}: Discovered ${formattedTech}`;
								}
								return `Turn ${turn}: ${count} technologies`;
							},
						},
						grid: {
							left: 60,
							right: 40,
							top: 80,
							bottom: 60,
						},
						xAxis: {
							type: "value",
							name: "Turn",
							nameLocation: "middle",
							nameGap: 30,
							splitLine: { show: false },
							max: finalTurn,
						},
						yAxis: {
							type: "value",
							name: "Number of Technologies",
							nameLocation: "middle",
							nameGap: 40,
							max: maxTechCount + 2,
							splitLine: { show: false },
						},
						series: players.map((player, i) => ({
							name: formatEnum(player.nation, "NATION_"),
							type: "line" as const,
							data: player.data.map((d) => [d.turn, d.tech_count, d.tech_name]),
							itemStyle: { color: getPlayerColor(player.nation, i) },
							symbol: (value: [number, number, string | null]) =>
								value[2] ? "circle" : "none",
							symbolSize: 8,
							emphasis: {
								symbolSize: 12,
							},
						})),
					} as EChartsOption;
				})()
			: null,
	);

	// ─── Pivot table logic ────────────────────────────────────────────
	const uniqueTechNations = $derived(
		[
			...new Set(
				completedTechs
					.map((tech) => tech.nation)
					.filter((n): n is string => n != null),
			),
		].sort(),
	);

	const selectedTechNations = $derived(
		tableState.filters
			.filter((f) => f.startsWith("nation:"))
			.map((f) => f.replace("nation:", "")),
	);

	const displayedTechNations = $derived(
		selectedTechNations.length > 0 ? selectedTechNations : uniqueTechNations,
	);

	type TechPivotRow = {
		tech: string;
		turns: Record<string, number | null>;
	};

	const techPivotData = $derived(() => {
		if (completedTechs.length === 0) return [];

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const pivotMap = new Map<string, Record<string, number | null>>();

		for (const t of completedTechs) {
			if (!t.nation) continue;
			if (!pivotMap.has(t.tech)) {
				pivotMap.set(t.tech, {});
			}
			const turns = pivotMap.get(t.tech)!;
			turns[t.nation] = t.completed_turn;
		}

		const rows: TechPivotRow[] = [];
		for (const [tech, turns] of pivotMap) {
			if (tableState.search) {
				const term = tableState.search.toLowerCase();
				if (!tech.toLowerCase().includes(term)) {
					continue;
				}
			}
			rows.push({ tech, turns });
		}

		rows.sort((a, b) => {
			if (tableState.sortColumn === "tech") {
				const cmp = a.tech.localeCompare(b.tech);
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			} else if (tableState.sortColumn.startsWith("nation:")) {
				const nation = tableState.sortColumn.replace("nation:", "");
				const aVal = a.turns[nation] ?? Infinity;
				const bVal = b.turns[nation] ?? Infinity;
				const cmp = aVal - bVal;
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			}
			return a.tech.localeCompare(b.tech);
		});

		return rows;
	});

	function handleToggleSort(columnKey: string) {
		if (tableState.sortColumn === columnKey) {
			tableState.sortDirection = tableState.sortDirection === "asc" ? "desc" : "asc";
		} else {
			tableState.sortColumn = columnKey;
			tableState.sortDirection = "asc";
		}
	}
</script>

{#if techDiscoveryChartOption}
	<ChartContainer
		option={techDiscoveryChartOption}
		height="400px"
		title="Tech Discovery Over Time"
	/>
{:else if techDiscoveryHistory.length === 0}
	<p class="p-8 text-center italic text-brown">
		No tech discovery data available
	</p>
{/if}

<!-- Completed Technologies Table -->
{#if completedTechs.length === 0}
	<div class="mt-8">
		<p class="p-8 text-center italic text-brown">
			No technologies data available
		</p>
	</div>
{:else}
	<div class="mt-8">
		<!-- Controls row -->
		<div class="mb-4 flex flex-wrap items-end gap-3">
			<!-- Filter dropdown -->
			<Select.Root type="multiple" bind:value={tableState.filters}>
				<Select.Trigger
					class="relative flex w-32 items-center justify-between rounded border-2 border-black py-2 pl-9 pr-8 text-sm text-tan"
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
						class="z-50 max-h-64 overflow-y-auto rounded border-2 border-black bg-[#201a13] shadow-lg"
					>
						<Select.Viewport>
							{#if uniqueTechNations.length > 0}
								<Select.Group>
									<Select.GroupHeading
										class="border-brown/50 border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-brown"
									>
										Nations
									</Select.GroupHeading>
									{#each uniqueTechNations as nation (nation)}
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
				placeholder="Search technologies"
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
				{techPivotData().length} technologies
			</span>
		</div>

		<!-- Technologies pivot table -->
		<div
			class="overflow-x-auto rounded-lg"
			style="background-color: #201a13;"
		>
			<table class="w-full">
				<thead>
					<tr>
						<th
							class="hover:bg-brown/20 cursor-pointer select-none whitespace-nowrap border-b-2 border-brown p-3 text-left font-bold text-brown"
							onclick={() => handleToggleSort("tech")}
						>
							<span class="inline-flex items-center gap-1">
								Technology
								{#if tableState.sortColumn === "tech"}
									<span class="text-orange">
										{tableState.sortDirection === "asc" ? "↑" : "↓"}
									</span>
								{/if}
							</span>
						</th>
						{#each displayedTechNations as nation (nation)}
							<th
								class="hover:bg-brown/20 cursor-pointer select-none whitespace-nowrap border-b-2 border-brown p-3 text-center font-bold text-brown"
								onclick={() => handleToggleSort(`nation:${nation}`)}
							>
								<span
									class="inline-flex items-center justify-center gap-1"
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
					</tr>
				</thead>
				<tbody>
					{#each techPivotData() as row (row.tech)}
						<tr class="hover:bg-brown/10">
							<td
								class="border-brown/50 whitespace-nowrap border-b p-3 text-left text-tan"
							>
								{formatEnum(row.tech, "TECH_")}
							</td>
							{#each displayedTechNations as nation (nation)}
								<td
									class="border-brown/50 whitespace-nowrap border-b p-3 text-center text-tan"
								>
									{row.turns[nation] != null ? row.turns[nation] : "—"}
								</td>
							{/each}
						</tr>
					{:else}
						<tr>
							<td
								colspan={displayedTechNations.length + 1}
								class="p-8 text-center text-brown italic"
							>
								No technologies match search
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
