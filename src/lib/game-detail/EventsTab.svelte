<script lang="ts">
	import type { EventLog } from "$lib/types/EventLog";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { EChartsOption } from "echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { Select } from "bits-ui";
	import { formatEnum, stripMarkup } from "$lib/utils/formatting";
	import { CHART_THEME } from "$lib/config";
	import TableFilterColumn from "./TableFilterColumn.svelte";
	import {
		type TableState,
		type DetailPlayer,
		TABLE_FRAME_CLASS,
		TABLE_CLASS,
		TABLE_HEADER_TH_CLASS,
		TABLE_CELL_TD_CLASS,
		toggleSort,
	} from "./helpers";

	let {
		eventLogs,
		playerHistory,
		gameDetails,
		players,
		victoryPointsEnabled,
		chartFilter = $bindable<Record<string, boolean>>({}),
		tableState = $bindable<TableState>({
			search: "",
			sortColumn: "turn",
			sortDirection: "desc",
			filters: [],
		}),
	}: {
		eventLogs: EventLog[];
		playerHistory: PlayerHistory[];
		gameDetails: GameDetails;
		players: DetailPlayer[];
		victoryPointsEnabled: boolean;
		chartFilter?: Record<string, boolean>;
		tableState?: TableState;
	} = $props();

	// Resolved identity lookup (stable label + color per player), keyed by the
	// player id every per-player array carries. Mirror-match safe.
	const playerById = $derived(new Map(players.map((p) => [p.playerId, p])));

	// ─── Chart options ────────────────────────────────────────────────
	const pointsChartOption = $derived<EChartsOption | null>(
		playerHistory
			? {
					...CHART_THEME,
					title: {
						...CHART_THEME.title,
						text: "Victory Points",
					},
					legend: {
						show: false,
						data: playerHistory.map(
							(p) =>
								playerById.get(p.player_id)?.label ??
								formatEnum(p.nation, "NATION_"),
						),
						selected: chartFilter,
					},
					grid: {
						left: 60,
						right: 40,
						top: 80,
						bottom: 60,
					},
					xAxis: {
						type: "category",
						name: "Turn",
						nameLocation: "middle",
						nameGap: 30,
						data: playerHistory[0]?.history.map((h) => h.turn) ?? [],
					},
					yAxis: {
						type: "value",
						name: "Points",
						nameLocation: "middle",
						nameGap: 40,
					},
					series: playerHistory.map((player) => {
						const rp = playerById.get(player.player_id);
						return {
							name: rp?.label ?? formatEnum(player.nation, "NATION_"),
							type: "line",
							data: player.history.map((h) => h.points),
							itemStyle: { color: rp?.color },
						};
					}),
				}
			: null,
	);

	// ─── Event log processing ─────────────────────────────────────────
	const processedEventLogs = $derived(
		eventLogs.map((log) => {
			const cleanDesc = stripMarkup(log.description);
			if (log.player_name) {
				return { ...log, description: cleanDesc };
			}
			const match = cleanDesc?.match(/\s*\(([^)]+)\)\s*$/);
			if (match) {
				return {
					...log,
					player_name: match[1],
					description: cleanDesc?.replace(/\s*\([^)]+\)\s*$/, "") ?? null,
				};
			}
			return { ...log, description: cleanDesc };
		}),
	);

	const uniqueLogTypes = $derived(
		[...new Set(processedEventLogs.map((log) => log.log_type))].sort(),
	);

	const uniquePlayers = $derived(
		[
			...new Set(
				processedEventLogs
					.map((log) => log.player_name)
					.filter((p): p is string => p != null && p !== "Player"),
			),
		].sort(),
	);

	const nationNames = $derived(
		gameDetails.players.map((p) => formatEnum(p.nation, "NATION_")),
	);

	// Show player column if any event has a player name that's NOT a nation name
	const showPlayerColumn = $derived(
		processedEventLogs.some(
			(log) =>
				log.player_name &&
				log.player_name !== "Player" &&
				!nationNames.includes(log.player_name) &&
				!log.player_name.includes(" "),
		),
	);

	// Parse selected filters
	const selectedLogTypes = $derived(
		tableState.filters
			.filter((f) => f.startsWith("logtype:"))
			.map((f) => f.replace("logtype:", "")),
	);

	const selectedPlayers = $derived(
		tableState.filters
			.filter((f) => f.startsWith("player:"))
			.map((f) => f.replace("player:", "")),
	);

	// Filtered and sorted event logs
	const filteredEventLogs = $derived.by(() => {
		let logs = processedEventLogs.filter((log) => {
			if (tableState.search) {
				const term = tableState.search.toLowerCase();
				const matchesLogType = formatEnum(log.log_type, "")
					.toLowerCase()
					.includes(term);
				const matchesPlayer =
					log.player_name?.toLowerCase().includes(term) ?? false;
				const matchesDescription =
					log.description?.toLowerCase().includes(term) ?? false;
				if (!matchesLogType && !matchesPlayer && !matchesDescription) {
					return false;
				}
			}
			if (
				selectedLogTypes.length > 0 &&
				!selectedLogTypes.includes(log.log_type)
			) {
				return false;
			}
			if (
				selectedPlayers.length > 0 &&
				(!log.player_name || !selectedPlayers.includes(log.player_name))
			) {
				return false;
			}
			return true;
		});

		logs = [...logs].sort((a, b) => {
			let aVal: string | number | null;
			let bVal: string | number | null;

			switch (tableState.sortColumn) {
				case "turn":
					aVal = a.turn;
					bVal = b.turn;
					break;
				case "log_type":
					aVal = a.log_type;
					bVal = b.log_type;
					break;
				case "player_name":
					aVal = a.player_name ?? "";
					bVal = b.player_name ?? "";
					break;
				case "description":
					aVal = a.description ?? "";
					bVal = b.description ?? "";
					break;
				default:
					aVal = a.turn;
					bVal = b.turn;
			}

			if (aVal == null && bVal == null) return 0;
			if (aVal == null) return 1;
			if (bVal == null) return -1;

			let cmp: number;
			if (typeof aVal === "string" && typeof bVal === "string") {
				cmp = aVal.localeCompare(bVal);
			} else {
				cmp = (aVal as number) - (bVal as number);
			}

			return tableState.sortDirection === "asc" ? cmp : -cmp;
		});

		return logs;
	});
</script>

{#if victoryPointsEnabled && pointsChartOption}
	<div
		class="mb-4 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<ChartContainer
			option={pointsChartOption}
			height="400px"
			title="Victory Points"
		/>
	</div>
{/if}

<!-- Event Logs Table -->
{#if processedEventLogs.length === 0}
	<p class="p-8 text-center italic text-tan">No event logs recorded</p>
{:else}
	<h3 class="mb-2 mt-0 font-bold text-tan">Event Logs</h3>
	<div class={TABLE_FRAME_CLASS}>
		<TableFilterColumn
			bind:search={tableState.search}
			count={`${filteredEventLogs?.length ?? 0} / ${processedEventLogs.length} events`}
			chips={tableState.filters.map((f) =>
				f.startsWith("logtype:")
					? formatEnum(f.replace("logtype:", ""), "")
					: f.replace("player:", ""),
			)}
		>
			{#snippet filters()}
				<!-- Combined Log Type and Player Filter -->
				<Select.Root type="multiple" bind:value={tableState.filters}>
					<Select.Trigger
						class="flex w-full cursor-pointer items-center justify-between rounded border border-black bg-surface-raised px-2 py-1.5 text-xs text-tan"
					>
						<span class="truncate">Filter</span>
						<span class="ml-2 text-tan opacity-60">▼</span>
					</Select.Trigger>
					<Select.Portal>
						<Select.Content
							class="z-50 max-h-64 overflow-y-auto rounded bg-surface-sunken shadow-lg"
						>
							<Select.Viewport>
								<!-- Players Group (only show if player column is visible) -->
								{#if showPlayerColumn && uniquePlayers.length > 0}
									<Select.Group>
										<Select.GroupHeading
											class="border-b border-surface px-3 py-2 text-xs font-bold uppercase tracking-wide text-tan"
										>
											Players
										</Select.GroupHeading>
										{#each uniquePlayers as player (player)}
											<Select.Item
												value={`player:${player}`}
												label={player}
												class="flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan hover:bg-surface-raised data-[highlighted]:bg-surface-raised"
											>
												{#snippet children({ selected })}
													{player}
													{#if selected}
														<span class="font-bold text-orange">✓</span>
													{/if}
												{/snippet}
											</Select.Item>
										{/each}
									</Select.Group>
								{/if}

								<!-- Log Types Group -->
								{#if uniqueLogTypes.length > 0}
									<Select.Group>
										<Select.GroupHeading
											class="border-b border-surface px-3 py-2 text-xs font-bold uppercase tracking-wide text-tan {showPlayerColumn &&
											uniquePlayers.length > 0
												? 'border-t border-surface'
												: ''}"
										>
											Log Types
										</Select.GroupHeading>
										{#each uniqueLogTypes as logType (logType)}
											<Select.Item
												value={`logtype:${logType}`}
												label={formatEnum(logType, "")}
												class="flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan hover:bg-surface-raised data-[highlighted]:bg-surface-raised"
											>
												{#snippet children({ selected })}
													{formatEnum(logType, "")}
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
			{/snippet}
		</TableFilterColumn>

		<div class="min-w-0 flex-1 overflow-x-auto">
			<table class={TABLE_CLASS}>
				<thead>
					<tr>
						<th
							class="{TABLE_HEADER_TH_CLASS} rounded-l-lg border-l"
							onclick={() => toggleSort(tableState, "turn")}
						>
							<span class="inline-flex items-center gap-1">
								Turn
								{#if tableState.sortColumn === "turn"}
									<span class="text-orange"
										>{tableState.sortDirection === "asc" ? "↑" : "↓"}</span
									>
								{/if}
							</span>
						</th>
						<th
							class={TABLE_HEADER_TH_CLASS}
							onclick={() => toggleSort(tableState, "log_type")}
						>
							<span class="inline-flex items-center gap-1">
								Log Type
								{#if tableState.sortColumn === "log_type"}
									<span class="text-orange"
										>{tableState.sortDirection === "asc" ? "↑" : "↓"}</span
									>
								{/if}
							</span>
						</th>
						{#if showPlayerColumn}
							<th
								class={TABLE_HEADER_TH_CLASS}
								onclick={() => toggleSort(tableState, "player_name")}
							>
								<span class="inline-flex items-center gap-1">
									Player
									{#if tableState.sortColumn === "player_name"}
										<span class="text-orange"
											>{tableState.sortDirection === "asc" ? "↑" : "↓"}</span
										>
									{/if}
								</span>
							</th>
						{/if}
						<th
							class="{TABLE_HEADER_TH_CLASS} rounded-r-lg border-r"
							onclick={() => toggleSort(tableState, "description")}
						>
							<span class="inline-flex items-center gap-1">
								Description
								{#if tableState.sortColumn === "description"}
									<span class="text-orange"
										>{tableState.sortDirection === "asc" ? "↑" : "↓"}</span
									>
								{/if}
							</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredEventLogs ?? [] as log (log.log_id)}
						<tr class="group">
							<td class="{TABLE_CELL_TD_CLASS} rounded-l-lg">{log.turn}</td>
							<td class={TABLE_CELL_TD_CLASS}>
								{formatEnum(log.log_type, "")}
							</td>
							{#if showPlayerColumn}
								<td class={TABLE_CELL_TD_CLASS}>{log.player_name ?? ""}</td>
							{/if}
							<td class="{TABLE_CELL_TD_CLASS} rounded-r-lg">
								{log.description || "—"}
							</td>
						</tr>
					{:else}
						<tr>
							<td
								colspan={showPlayerColumn ? 4 : 3}
								class="p-8 text-center italic text-tan"
							>
								No events match filters
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
