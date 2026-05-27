<script lang="ts">
	import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
	import type { PlayerLaw } from "$lib/types/PlayerLaw";
	import type { EChartsOption } from "echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import { CHART_THEME } from "$lib/config";
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
	} from "./helpers";

	let {
		players,
		lawAdoptionHistory,
		currentLaws,
		chartFilter = $bindable<Record<string, boolean>>({}),
		tableState = $bindable<TableState>({
			search: "",
			sortColumn: "nation",
			sortDirection: "asc",
			filters: [],
		}),
	}: {
		players: DetailPlayer[];
		lawAdoptionHistory: LawAdoptionHistory[];
		currentLaws: PlayerLaw[];
		chartFilter?: Record<string, boolean>;
		tableState?: TableState;
	} = $props();

	// Resolved identity lookup (stable label + color per player), keyed by the
	// player id every per-player array carries. Mirror-match safe.
	const playerById = $derived(new Map(players.map((p) => [p.playerId, p])));

	// ─── Chart option ─────────────────────────────────────────────────
	const lawAdoptionChartOption = $derived(
		lawAdoptionHistory.length > 0
			? (() => {
					const histories = lawAdoptionHistory;
					const maxLawCount = Math.max(
						...histories.flatMap((player) =>
							player.data.map((d) => d.law_count),
						),
					);
					const finalTurn = Math.max(
						...histories.flatMap((player) => player.data.map((d) => d.turn)),
					);
					const seriesLabels = histories.map(
						(p) =>
							playerById.get(p.player_id)?.label ??
							formatEnum(p.nation, "NATION_"),
					);

					return {
						...CHART_THEME,
						title: {
							...CHART_THEME.title,
							text: "Law Adoption Over Time",
						},
						legend: {
							show: false,
							data: seriesLabels,
							selected: chartFilter,
						},
						tooltip: {
							trigger: "item",
							formatter: (params: { data: unknown }) => {
								const data = params.data as
									| [number, number, string | null]
									| undefined;
								if (!data) return "";
								const [turn, count, lawName] = data;
								if (lawName) {
									const formattedLaw = formatEnum(lawName, "LAW_");
									return `Turn ${turn}: Adopted ${formattedLaw}`;
								}
								return `Turn ${turn}: ${count} law classes`;
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
							name: "Number of Laws",
							nameLocation: "middle",
							nameGap: 40,
							max: maxLawCount + 2,
							splitLine: { show: false },
						},
						series: histories.map((player, i) => ({
							name:
								playerById.get(player.player_id)?.label ??
								formatEnum(player.nation, "NATION_"),
							type: "line" as const,
							data: player.data.map((d) => [d.turn, d.law_count, d.law_name]),
							itemStyle: { color: playerById.get(player.player_id)?.color },
							symbol: (value: [number, number, string | null]) =>
								value[2] ? "circle" : "none",
							symbolSize: 8,
							emphasis: {
								symbolSize: 12,
							},
							...(i === 0
								? {
										markLine: {
											silent: true,
											symbol: "none",
											label: { show: false },
											lineStyle: {
												type: "dashed" as const,
												color: "#666666",
												width: 1,
											},
											data: [{ yAxis: 4 }, { yAxis: 7 }],
										},
									}
								: {}),
						})),
					} as EChartsOption;
				})()
			: null,
	);

	// ─── Pivot table logic ────────────────────────────────────────────
	// Columns are per player (mirror-match safe); filtering stays by nation.
	const lawColumnPlayers = $derived(
		players.filter(
			(p) =>
				ownedByPlayer(currentLaws, p, (l) => l.player_id, (l) => l.nation)
					.length > 0,
		),
	);

	const uniqueLawNations = $derived(
		[
			...new Set(
				lawColumnPlayers
					.map((p) => p.nation)
					.filter((n): n is string => n != null),
			),
		].sort(),
	);

	const selectedLawNations = $derived(
		tableState.filters
			.filter((f) => f.startsWith("nation:"))
			.map((f) => f.replace("nation:", "")),
	);

	const displayedLawPlayers = $derived(
		selectedLawNations.length > 0
			? lawColumnPlayers.filter(
					(p) => p.nation != null && selectedLawNations.includes(p.nation),
				)
			: lawColumnPlayers,
	);

	type LawPivotRow = {
		law: string;
		turns: Record<number, number | null>;
	};

	const lawPivotData = $derived.by(() => {
		if (currentLaws.length === 0) return [];

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const pivotMap = new Map<string, Record<number, number | null>>();

		for (const p of lawColumnPlayers) {
			for (const l of ownedByPlayer(
				currentLaws,
				p,
				(x) => x.player_id,
				(x) => x.nation,
			)) {
				if (!pivotMap.has(l.law)) {
					pivotMap.set(l.law, {});
				}
				pivotMap.get(l.law)![p.playerId] = l.adopted_turn;
			}
		}

		const rows: LawPivotRow[] = [];
		for (const [law, turns] of pivotMap) {
			if (tableState.search) {
				const term = tableState.search.toLowerCase();
				if (!law.toLowerCase().includes(term)) {
					continue;
				}
			}
			rows.push({ law, turns });
		}

		rows.sort((a, b) => {
			if (tableState.sortColumn === "law") {
				const cmp = a.law.localeCompare(b.law);
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			} else if (tableState.sortColumn.startsWith("player:")) {
				const id = Number(tableState.sortColumn.replace("player:", ""));
				const aVal = a.turns[id] ?? Infinity;
				const bVal = b.turns[id] ?? Infinity;
				const cmp = aVal - bVal;
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			}
			return a.law.localeCompare(b.law);
		});

		return rows;
	});
</script>

{#if lawAdoptionChartOption}
	<div class="mb-4 rounded-lg p-4" style="background-color: #2a2622;">
		<ChartContainer
			option={lawAdoptionChartOption}
			height="400px"
			title="Law Adoption Over Time"
		/>
	</div>
{:else if lawAdoptionHistory.length === 0}
	<p class="p-8 text-center italic text-tan">No law adoption data available</p>
{/if}

<!-- Current Laws Table -->
{#if currentLaws.length === 0}
	<div class="mt-8">
		<p class="p-8 text-center italic text-tan">No laws data available</p>
	</div>
{:else}
	<div class={TABLE_FRAME_CLASS}>
		<TableFilterColumn
			bind:search={tableState.search}
			count={`${lawPivotData.length} laws`}
			chips={selectedLawNations.map((n) => formatEnum(n, "NATION_"))}
		>
			{#snippet filters()}
				<NationFilterSelect
					nations={uniqueLawNations}
					bind:value={tableState.filters}
				/>
			{/snippet}
		</TableFilterColumn>

		<!-- Laws pivot table -->
		<div class="min-w-0 flex-1 overflow-x-auto">
			<table class={TABLE_CLASS}>
				<thead>
					<tr>
						<th
							class="{TABLE_HEADER_TH_CLASS} rounded-l-lg border-l {displayedLawPlayers.length ===
							0
								? 'rounded-r-lg border-r'
								: ''}"
							onclick={() => toggleSort(tableState, "law")}
						>
							<span class="inline-flex items-center gap-1">
								Law
								{#if tableState.sortColumn === "law"}
									<span class="text-orange">
										{tableState.sortDirection === "asc" ? "↑" : "↓"}
									</span>
								{/if}
							</span>
						</th>
						{#each displayedLawPlayers as player, i (player.playerId)}
							<th
								class="{TABLE_HEADER_TH_CLASS} !text-center {i ===
								displayedLawPlayers.length - 1
									? 'rounded-r-lg border-r'
									: ''}"
								onclick={() => toggleSort(tableState, `player:${player.playerId}`)}
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
					</tr>
				</thead>
				<tbody>
					{#each lawPivotData as row (row.law)}
						<tr class="group">
							<td
								class="{TABLE_CELL_TD_CLASS} whitespace-nowrap rounded-l-lg {displayedLawPlayers.length ===
								0
									? 'rounded-r-lg'
									: ''}"
							>
								{formatEnum(row.law, "LAW_")}
							</td>
							{#each displayedLawPlayers as player, i (player.playerId)}
								<td
									class="{TABLE_CELL_TD_CLASS} whitespace-nowrap !text-center {i ===
									displayedLawPlayers.length - 1
										? 'rounded-r-lg'
										: ''}"
								>
									{row.turns[player.playerId] != null
										? row.turns[player.playerId]
										: "—"}
								</td>
							{/each}
						</tr>
					{:else}
						<tr>
							<td
								colspan={displayedLawPlayers.length + 1}
								class="p-8 text-center italic text-tan"
							>
								No laws match search
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
