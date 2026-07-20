<script lang="ts">
	import type { ImprovementData } from "$lib/types/ImprovementData";
	import type { UnitInfo } from "$lib/parser/types";
	import type { ChartOption } from "$lib/echarts";
	import { formatEnum } from "$lib/utils/formatting";
	import { CHART_THEME } from "$lib/config";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import SpriteIcon from "./SpriteIcon.svelte";
	import TableFilterColumn from "./TableFilterColumn.svelte";
	import NationFilterSelect from "./NationFilterSelect.svelte";
	import {
		type TableState,
		type DetailPlayer,
		TABLE_FRAME_CLASS,
		TABLE_CLASS,
		TABLE_HEADER_TH_CLASS,
		TABLE_CELL_TD_CLASS,
		ownedByPlayer,
		toggleSort,
		filledLineStyle,
		improvementDisplayName,
	} from "./helpers";

	let {
		players,
		improvementData,
		units = [],
		totalTurns,
		tableState = $bindable<TableState>({
			search: "",
			sortColumn: "improvement",
			sortDirection: "asc",
			filters: [],
		}),
	}: {
		players: DetailPlayer[];
		improvementData: ImprovementData;
		units?: UnitInfo[];
		totalTurns: number;
		tableState?: TableState;
	} = $props();

	const workerChartOption = $derived.by<ChartOption | null>(() => {
		const workers = units.filter(
			(u) =>
				u.unit_type === "UNIT_WORKER" &&
				u.player_xml_id != null &&
				u.create_turn != null,
		);
		if (workers.length === 0) return null;

		const finalTurn = Math.max(
			totalTurns,
			...workers.map((w) => w.create_turn as number),
		);

		const series = players
			.map((p) => {
				const buildTurns = workers
					.filter((w) => w.player_xml_id === p.playerId)
					.map((w) => w.create_turn as number);
				if (buildTurns.length === 0) return null;

				const counts = new Array<number>(finalTurn + 1).fill(0);
				for (const t of buildTurns) counts[Math.max(0, t)] += 1;
				for (let i = 1; i <= finalTurn; i++) counts[i] += counts[i - 1];

				return {
					name: p.label,
					type: "line" as const,
					data: counts.map((c, turn) => [turn, c]),
					itemStyle: { color: p.color },
					...filledLineStyle(p.color),
				};
			})
			.filter((s): s is NonNullable<typeof s> => s != null);

		if (series.length === 0) return null;

		return {
			...CHART_THEME,
			title: {
				...CHART_THEME.title,
				text: "Workers Over Time",
			},
			tooltip: {
				trigger: "axis",
				formatter: (params: unknown) => {
					const arr = params as Array<{
						marker: string;
						seriesName: string;
						value: [number, number];
					}>;
					if (arr.length === 0) return "";
					const rows = arr
						.map((p) => ({
							marker: p.marker,
							name: p.seriesName,
							count: p.value[1],
						}))
						.sort((a, b) => b.count - a.count)
						.map((r) => `${r.marker}${r.name}: <b>${r.count}</b>`)
						.join("<br/>");
					return `Turn ${arr[0].value[0]}<br/>${rows}`;
				},
			},
			grid: { left: 60, right: 40, top: 80, bottom: 60 },
			xAxis: {
				type: "value",
				name: "Turn",
				nameLocation: "middle",
				nameGap: 30,
				min: 0,
				max: finalTurn,
				minInterval: 1,
				splitLine: { show: false },
			},
			yAxis: {
				type: "value",
				name: "Workers",
				nameLocation: "middle",
				nameGap: 40,
				minInterval: 1,
			},
			series,
		} as ChartOption;
	});

	// ─── Pivot table logic ────────────────────────────────────────────
	// Columns are per player (mirror-match safe); filtering stays by nation.
	// Attribution prefers owner_player_xml_id (reparsed ≥2.6.0 blobs) and
	// falls back to nation on older blobs (where same-nation owners merge).
	const impColumnPlayers = $derived(
		players.filter(
			(p) =>
				ownedByPlayer(
					improvementData.improvements,
					p,
					(imp) => imp.owner_player_xml_id,
					(imp) => imp.nation,
				).length > 0,
		),
	);

	const uniqueImprovementNations = $derived(
		[
			...new Set(
				impColumnPlayers
					.map((p) => p.nation)
					.filter((n): n is string => n != null),
			),
		].sort(),
	);

	const selectedImprovementNations = $derived(
		tableState.filters
			.filter((f) => f.startsWith("nation:"))
			.map((f) => f.replace("nation:", "")),
	);

	const displayedImprovementPlayers = $derived(
		selectedImprovementNations.length > 0
			? impColumnPlayers.filter(
					(p) =>
						p.nation != null && selectedImprovementNations.includes(p.nation),
				)
			: impColumnPlayers,
	);

	type ImprovementPivotRow = {
		improvement: string;
		counts: Record<number, number>;
		total: number;
	};

	const improvementPivotData = $derived.by(() => {
		if (improvementData.improvements.length === 0) return [];

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const pivotMap = new Map<string, Record<number, number>>();

		for (const p of impColumnPlayers) {
			for (const imp of ownedByPlayer(
				improvementData.improvements,
				p,
				(i) => i.owner_player_xml_id,
				(i) => i.nation,
			)) {
				if (!pivotMap.has(imp.improvement)) {
					pivotMap.set(imp.improvement, {});
				}
				const counts = pivotMap.get(imp.improvement)!;
				counts[p.playerId] = (counts[p.playerId] ?? 0) + 1;
			}
		}

		const rows: ImprovementPivotRow[] = [];
		for (const [improvement, counts] of pivotMap) {
			if (tableState.search) {
				const term = tableState.search.toLowerCase();
				if (!improvement.toLowerCase().includes(term)) {
					continue;
				}
			}
			const total = displayedImprovementPlayers.reduce(
				(sum, p) => sum + (counts[p.playerId] ?? 0),
				0,
			);
			rows.push({ improvement, counts, total });
		}

		rows.sort((a, b) => {
			if (tableState.sortColumn === "improvement") {
				const cmp = a.improvement.localeCompare(b.improvement);
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			} else if (tableState.sortColumn === "total") {
				const cmp = a.total - b.total;
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			} else if (tableState.sortColumn.startsWith("player:")) {
				const id = Number(tableState.sortColumn.replace("player:", ""));
				const aVal = a.counts[id] ?? 0;
				const bVal = b.counts[id] ?? 0;
				const cmp = aVal - bVal;
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			}
			return a.improvement.localeCompare(b.improvement);
		});

		return rows;
	});
</script>

{#if workerChartOption}
	<div
		class="mb-4 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<ChartContainer
			option={workerChartOption}
			height="440px"
			title="Workers Over Time"
		/>
	</div>
{/if}

{#if improvementData.improvements.length === 0}
	<p class="p-8 text-center italic text-tan">No improvements found</p>
{:else}
	<div class={TABLE_FRAME_CLASS}>
		<TableFilterColumn
			bind:search={tableState.search}
			count={`${improvementPivotData.length} improvements`}
			chips={selectedImprovementNations.map((n) => formatEnum(n, "NATION_"))}
		>
			{#snippet filters()}
				<NationFilterSelect
					nations={uniqueImprovementNations}
					bind:value={tableState.filters}
				/>
			{/snippet}
		</TableFilterColumn>

		<!-- Improvements pivot table -->
		<div class="min-w-0 flex-1 overflow-x-auto">
			<table class={TABLE_CLASS}>
				<thead>
					<tr>
						<th
							class="{TABLE_HEADER_TH_CLASS} rounded-l-lg border-l {displayedImprovementPlayers.length ===
							0
								? 'rounded-r-lg border-r'
								: ''}"
							onclick={() => toggleSort(tableState, "improvement")}
						>
							<span class="inline-flex items-center gap-1">
								Improvement
								{#if tableState.sortColumn === "improvement"}
									<span class="text-orange">
										{tableState.sortDirection === "asc" ? "↑" : "↓"}
									</span>
								{/if}
							</span>
						</th>
						{#each displayedImprovementPlayers as player (player.playerId)}
							<th
								class="{TABLE_HEADER_TH_CLASS} !text-center {displayedImprovementPlayers.length ===
								1
									? 'rounded-r-lg border-r'
									: ''}"
								onclick={() =>
									toggleSort(tableState, `player:${player.playerId}`)}
							>
								<span class="inline-flex items-center justify-center gap-1.5">
									{#if player.nation}
										<SpriteIcon
											category="crests"
											value={player.nation}
											size={14}
											alt={formatEnum(player.nation, "NATION_")}
										/>
									{/if}
									{player.label}
									{#if tableState.sortColumn === `player:${player.playerId}`}
										<span class="text-orange">
											{tableState.sortDirection === "asc" ? "↑" : "↓"}
										</span>
									{/if}
								</span>
							</th>
						{/each}
						{#if displayedImprovementPlayers.length > 1}
							<th
								class="{TABLE_HEADER_TH_CLASS} rounded-r-lg border-r !text-center"
								onclick={() => toggleSort(tableState, "total")}
							>
								<span class="inline-flex items-center justify-center gap-1">
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
					{#each improvementPivotData as row (row.improvement)}
						<tr class="group">
							<td
								class="{TABLE_CELL_TD_CLASS} whitespace-nowrap rounded-l-lg {displayedImprovementPlayers.length ===
								0
									? 'rounded-r-lg'
									: ''}"
							>
								{improvementDisplayName(row.improvement)}
							</td>
							{#each displayedImprovementPlayers as player (player.playerId)}
								<td
									class="{TABLE_CELL_TD_CLASS} whitespace-nowrap !text-center {displayedImprovementPlayers.length ===
									1
										? 'rounded-r-lg'
										: ''}"
								>
									{row.counts[player.playerId] ?? 0}
								</td>
							{/each}
							{#if displayedImprovementPlayers.length > 1}
								<td
									class="{TABLE_CELL_TD_CLASS} whitespace-nowrap rounded-r-lg !text-center font-bold"
								>
									{row.total}
								</td>
							{/if}
						</tr>
					{:else}
						<tr>
							<td
								colspan={displayedImprovementPlayers.length +
									(displayedImprovementPlayers.length > 1 ? 2 : 1)}
								class="p-8 text-center italic text-tan"
							>
								No improvements match search
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
