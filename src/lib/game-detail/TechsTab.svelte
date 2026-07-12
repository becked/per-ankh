<script lang="ts">
	import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
	import type { PlayerTech } from "$lib/types/PlayerTech";
	import type { EChartsOption } from "echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import { TECH_NAMES } from "$lib/generated/tech-names";
	import { CHART_THEME, getNationChartColor } from "$lib/config";
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
	} from "./helpers";

	let {
		players,
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
		players: DetailPlayer[];
		techDiscoveryHistory: TechDiscoveryHistory[];
		completedTechs: PlayerTech[];
		chartFilter?: Record<string, boolean>;
		tableState?: TableState;
	} = $props();

	// Resolved identity lookup (stable label + color per player), keyed by the
	// player id every per-player array carries. Mirror-match safe.
	const playerById = $derived(new Map(players.map((p) => [p.playerId, p])));

	// ─── Chart option ─────────────────────────────────────────────────
	const techDiscoveryChartOption = $derived(
		techDiscoveryHistory.length > 0
			? (() => {
					const histories = techDiscoveryHistory;
					const maxTechCount = Math.max(
						...histories.flatMap((player) =>
							player.data.map((d) => d.tech_count),
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
							text: "Tech Discovery Over Time",
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
								const [turn, count, techName] = data;
								if (techName) {
									const formattedTech =
										TECH_NAMES[techName] ?? formatEnum(techName, "TECH_");
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
						},
						series: histories.map((player, i) => {
							const rp = playerById.get(player.player_id);
							const color = rp?.color ?? getNationChartColor(player.nation, i);
							return {
								name: rp?.label ?? formatEnum(player.nation, "NATION_"),
								type: "line" as const,
								data: player.data.map((d) => [
									d.turn,
									d.tech_count,
									d.tech_name,
								]),
								itemStyle: { color },
								// Milestone markers stay hidden until hover (per the shared
								// look) but still name the discovered tech in the tooltip.
								symbol: (value: [number, number, string | null]) =>
									value[2] ? "circle" : "none",
								symbolSize: 8,
								emphasis: {
									symbolSize: 12,
								},
								...filledLineStyle(color),
							};
						}),
					} as EChartsOption;
				})()
			: null,
	);

	// ─── Pivot table logic ────────────────────────────────────────────
	// Columns are per player (mirror-match safe); filtering stays by nation.
	const techColumnPlayers = $derived(
		players.filter(
			(p) =>
				ownedByPlayer(
					completedTechs,
					p,
					(t) => t.player_id,
					(t) => t.nation,
				).length > 0,
		),
	);

	const uniqueTechNations = $derived(
		[
			...new Set(
				techColumnPlayers
					.map((p) => p.nation)
					.filter((n): n is string => n != null),
			),
		].sort(),
	);

	const selectedTechNations = $derived(
		tableState.filters
			.filter((f) => f.startsWith("nation:"))
			.map((f) => f.replace("nation:", "")),
	);

	const displayedTechPlayers = $derived(
		selectedTechNations.length > 0
			? techColumnPlayers.filter(
					(p) => p.nation != null && selectedTechNations.includes(p.nation),
				)
			: techColumnPlayers,
	);

	type TechPivotRow = {
		tech: string;
		turns: Record<number, number | null>;
	};

	const techPivotData = $derived.by(() => {
		if (completedTechs.length === 0) return [];

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const pivotMap = new Map<string, Record<number, number | null>>();

		for (const p of techColumnPlayers) {
			for (const t of ownedByPlayer(
				completedTechs,
				p,
				(x) => x.player_id,
				(x) => x.nation,
			)) {
				if (!pivotMap.has(t.tech)) {
					pivotMap.set(t.tech, {});
				}
				pivotMap.get(t.tech)![p.playerId] = t.completed_turn;
			}
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
			} else if (tableState.sortColumn.startsWith("player:")) {
				const id = Number(tableState.sortColumn.replace("player:", ""));
				const aVal = a.turns[id] ?? Infinity;
				const bVal = b.turns[id] ?? Infinity;
				const cmp = aVal - bVal;
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			}
			return a.tech.localeCompare(b.tech);
		});

		return rows;
	});
</script>

{#if techDiscoveryChartOption}
	<div
		class="mb-4 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<ChartContainer
			option={techDiscoveryChartOption}
			height="400px"
			title="Tech Discovery Over Time"
		/>
	</div>
{:else if techDiscoveryHistory.length === 0}
	<p class="p-8 text-center italic text-tan">
		No tech discovery data available
	</p>
{/if}

<!-- Completed Technologies Table -->
{#if completedTechs.length === 0}
	<div class="mt-8">
		<p class="p-8 text-center italic text-tan">
			No technologies data available
		</p>
	</div>
{:else}
	<div class={TABLE_FRAME_CLASS}>
		<TableFilterColumn
			bind:search={tableState.search}
			count={`${techPivotData.length} technologies`}
			chips={selectedTechNations.map((n) => formatEnum(n, "NATION_"))}
		>
			{#snippet filters()}
				<NationFilterSelect
					nations={uniqueTechNations}
					bind:value={tableState.filters}
				/>
			{/snippet}
		</TableFilterColumn>

		<!-- Technologies pivot table -->
		<div class="min-w-0 flex-1 overflow-x-auto">
			<table class={TABLE_CLASS}>
				<thead>
					<tr>
						<th
							class="{TABLE_HEADER_TH_CLASS} rounded-l-lg border-l {displayedTechPlayers.length ===
							0
								? 'rounded-r-lg border-r'
								: ''}"
							onclick={() => toggleSort(tableState, "tech")}
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
						{#each displayedTechPlayers as player, i (player.playerId)}
							<th
								class="{TABLE_HEADER_TH_CLASS} !text-center {i ===
								displayedTechPlayers.length - 1
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
					</tr>
				</thead>
				<tbody>
					{#each techPivotData as row (row.tech)}
						<tr class="group">
							<td
								class="{TABLE_CELL_TD_CLASS} whitespace-nowrap rounded-l-lg {displayedTechPlayers.length ===
								0
									? 'rounded-r-lg'
									: ''}"
							>
								{TECH_NAMES[row.tech] ?? formatEnum(row.tech, "TECH_")}
							</td>
							{#each displayedTechPlayers as player, i (player.playerId)}
								<td
									class="{TABLE_CELL_TD_CLASS} whitespace-nowrap !text-center {i ===
									displayedTechPlayers.length - 1
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
								colspan={displayedTechPlayers.length + 1}
								class="p-8 text-center italic text-tan"
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
