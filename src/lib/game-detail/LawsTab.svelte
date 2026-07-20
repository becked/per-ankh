<script lang="ts">
	import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
	import type { PlayerLaw } from "$lib/types/PlayerLaw";
	import type { ChartOption } from "$lib/echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import { CHART_THEME, getNationChartColor } from "$lib/config";
	import { LAW_TO_CLASS } from "$lib/generated/law-classes";
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
		lawAdoptionHistory,
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
		chartFilter?: Record<string, boolean>;
		tableState?: TableState;
	} = $props();

	// Resolved identity lookup (stable label + color per player), keyed by the
	// player id every per-player array carries. Mirror-match safe.
	const playerById = $derived(new Map(players.map((p) => [p.playerId, p])));

	// Per-series (same order as lawAdoptionHistory) map of turn → adoption
	// descriptions for the chart tooltip. Walking each player's adoptions in
	// order and tracking the current law per class lets a same-class
	// replacement read as a switch ("Epics → Exploration"); adoptions that
	// share a turn are grouped so one (possibly overlapping) dot lists them all.
	const adoptionLabelsBySeries = $derived(
		lawAdoptionHistory.map((player) => {
			const currentByClass: Record<string, string> = {};
			const byTurn: Record<number, string[]> = {};
			for (const d of player.data) {
				if (d.law_name == null) continue;
				const cls = LAW_TO_CLASS[d.law_name];
				const prior = cls != null ? currentByClass[cls] : undefined;
				const label =
					prior != null && prior !== d.law_name
						? `Switched ${formatEnum(prior, "LAW_")} → ${formatEnum(d.law_name, "LAW_")}`
						: `Adopted ${formatEnum(d.law_name, "LAW_")}`;
				const existing = byTurn[d.turn];
				if (existing) existing.push(label);
				else byTurn[d.turn] = [label];
				if (cls != null) currentByClass[cls] = d.law_name;
			}
			return byTurn;
		}),
	);

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
							trigger: "axis",
							// Points are sparse (one per adoption), so snap the axis
							// pointer to the nearest event and drive the tooltip off the
							// axis — hovering anywhere works, matching the other charts.
							axisPointer: { snap: true },
							formatter: (params: unknown) => {
								const arr = params as Array<{
									marker: string;
									seriesName: string;
									seriesIndex: number;
									data: [number, number, string | null];
								}>;
								if (arr.length === 0) return "";
								const turn = arr[0].data[0];
								const rows = arr
									.map((p) => {
										const [, count, lawName] = p.data;
										let detail = "";
										if (lawName) {
											const labels =
												adoptionLabelsBySeries[p.seriesIndex]?.[turn];
											detail =
												labels && labels.length > 0
													? ` — ${labels.join("; ")}`
													: ` — Adopted ${formatEnum(lawName, "LAW_")}`;
										}
										return `${p.marker}${p.seriesName}: <b>${count}</b>${detail}`;
									})
									.join("<br/>");
								return `Turn ${turn}<br/>${rows}`;
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
						},
						series: histories.map((player, i) => {
							const rp = playerById.get(player.player_id);
							const color = rp?.color ?? getNationChartColor(player.nation, i);
							return {
								name: rp?.label ?? formatEnum(player.nation, "NATION_"),
								type: "line" as const,
								data: player.data.map((d) => [d.turn, d.law_count, d.law_name]),
								itemStyle: { color },
								// Milestone markers stay hidden until hover (per the shared
								// look) but still name the adopted law in the tooltip.
								symbol: (value: [number, number, string | null]) =>
									value[2] ? "circle" : "none",
								symbolSize: 8,
								emphasis: {
									symbolSize: 12,
								},
								...filledLineStyle(color),
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
							};
						}),
					} as ChartOption;
				})()
			: null,
	);

	// ─── Pivot table logic ────────────────────────────────────────────
	// The table pivots the SAME data the chart plots — law_adoption_history,
	// i.e. every LAW_ADOPTED event — rather than the end-state active laws.
	// So a law the player later switched away from (e.g. Epics → Exploration)
	// still appears, each with the turn it was adopted. One row per
	// (player, law); a law re-adopted after a repeal collapses to its earliest
	// adoption turn. Succession laws are already absent from the history, so
	// they stay out of the table too.
	const adoptedLaws = $derived.by(() => {
		const out: PlayerLaw[] = [];
		for (const entry of lawAdoptionHistory) {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
			const firstTurn = new Map<string, number>();
			for (const d of entry.data) {
				if (d.law_name == null) continue;
				const prev = firstTurn.get(d.law_name);
				if (prev === undefined || d.turn < prev) {
					firstTurn.set(d.law_name, d.turn);
				}
			}
			for (const [law, turn] of firstTurn) {
				out.push({
					player_id: entry.player_id,
					player_name: entry.player_name,
					nation: entry.nation,
					law_category: LAW_TO_CLASS[law] ?? "",
					law,
					adopted_turn: turn,
					change_count: 1,
				});
			}
		}
		return out;
	});

	// Columns are per player (mirror-match safe); filtering stays by nation.
	const lawColumnPlayers = $derived(
		players.filter(
			(p) =>
				ownedByPlayer(
					adoptedLaws,
					p,
					(l) => l.player_id,
					(l) => l.nation,
				).length > 0,
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
		if (adoptedLaws.length === 0) return [];

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const pivotMap = new Map<string, Record<number, number | null>>();

		for (const p of lawColumnPlayers) {
			for (const l of ownedByPlayer(
				adoptedLaws,
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
	<div
		class="mb-4 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<ChartContainer
			option={lawAdoptionChartOption}
			height="400px"
			title="Law Adoption Over Time"
		/>
	</div>
{:else if lawAdoptionHistory.length === 0}
	<p class="p-8 text-center italic text-tan">No law adoption data available</p>
{/if}

<!-- Law Adoptions Table -->
{#if adoptedLaws.length === 0}
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
