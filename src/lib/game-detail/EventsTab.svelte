<script lang="ts">
	import type { EventLog } from "$lib/types/EventLog";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { ChartOption } from "$lib/echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { Select } from "bits-ui";
	import { formatEnum, stripMarkup, nationName } from "$lib/utils/formatting";
	import { CHART_THEME, getNationChartColor } from "$lib/config";
	import TableFilterColumn from "./TableFilterColumn.svelte";
	import {
		type TableState,
		type DetailPlayer,
		TABLE_FRAME_CLASS,
		TABLE_CLASS,
		TABLE_HEADER_TH_CLASS,
		TABLE_CELL_TD_CLASS,
		eventLogOwnedBy,
		toggleSort,
		filledLineStyle,
	} from "./helpers";
	import { withEndStateTotal } from "$lib/utils/victory-point-series";

	let {
		eventLogs,
		playerHistory,
		players,
		victoryPointsEnabled,
		victoryPoints,
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
		players: DetailPlayer[];
		victoryPointsEnabled: boolean;
		// Each seat's end-state victory-point total, keyed by player id, or null
		// where the blob cannot answer (victory-points.ts) — the chart's last
		// point, which the recorded series samples at the seat's turn START.
		victoryPoints: Map<number, number> | null;
		chartFilter?: Record<string, boolean>;
		tableState?: TableState;
	} = $props();

	// Resolved identity lookup (stable label + color per player), keyed by the
	// player id every per-player array carries. Mirror-match safe.
	const playerById = $derived(new Map(players.map((p) => [p.playerId, p])));

	// ─── Chart options ────────────────────────────────────────────────
	const pointsChartOption = $derived.by<ChartOption | null>(() => {
		if (!playerHistory) return null;
		// Value x-axis with a small pad so the area fill doesn't clip at the edges.
		const turns = playerHistory[0]?.history.map((h) => h.turn) ?? [];
		const minTurn = turns[0] ?? 0;
		const maxTurn = turns[turns.length - 1] ?? 0;
		const pad = Math.max(1, (maxTurn - minTurn) * 0.02);
		return {
			...CHART_THEME,
			title: {
				...CHART_THEME.title,
				text: "Victory Points",
			},
			legend: {
				show: false,
				data: playerHistory.map(
					(p) => playerById.get(p.player_id)?.label ?? nationName(p.nation),
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
				type: "value",
				name: "Turn",
				nameLocation: "middle",
				nameGap: 30,
				min: minTurn - pad,
				max: maxTurn + pad,
				minInterval: 1,
				splitLine: { show: false },
			},
			yAxis: {
				type: "value",
				name: "Points",
				nameLocation: "middle",
				nameGap: 40,
				axisLine: { onZero: false },
			},
			series: playerHistory.map((player, i) => {
				const rp = playerById.get(player.player_id);
				const color = rp?.color ?? getNationChartColor(player.nation, i);
				return {
					name: rp?.label ?? nationName(player.nation),
					type: "line",
					data: withEndStateTotal(
						player.history.map((h): [number, number | null] => [
							h.turn,
							h.points,
						]),
						victoryPoints?.get(player.player_id),
					),
					itemStyle: { color },
					...filledLineStyle(color),
				};
			}),
		};
	});

	// ─── Event log processing ─────────────────────────────────────────
	// Annotate each row with the players that logged it, then filter and label
	// off that. A row is a dedup group over (turn, log_type, description), so
	// an event several realms saw carries all of them and belongs under each
	// one's chip. `player_name` is no help here: it is null the moment a group
	// holds more than one row, and empty for every player in a single-player
	// save.
	const annotatedEventLogs = $derived(
		eventLogs.map((log) => {
			const owners = players.filter((p) =>
				eventLogOwnedBy(log.player_xml_ids, log.player_name, p),
			);
			return {
				...log,
				description: stripMarkup(log.description),
				ownerIds: owners.map((p) => p.playerId),
				ownerLabel: owners.map((p) => p.label).join(", "),
			};
		}),
	);

	const uniqueLogTypes = $derived(
		[...new Set(annotatedEventLogs.map((log) => log.log_type))].sort(),
	);

	// The players that logged something — the filter's options. Empty on a blob
	// below PARSER_VERSION 2.14.0 whose players are all unnamed, which is every
	// single-player save: there is nothing to attribute by until re-import, so
	// the column and its chips stay hidden rather than showing blanks.
	const playersWithEvents = $derived(
		new Set(annotatedEventLogs.flatMap((log) => log.ownerIds)),
	);
	const filterablePlayers = $derived(
		players.filter((p) => playersWithEvents.has(p.playerId)),
	);
	const showPlayerColumn = $derived(filterablePlayers.length > 0);

	// Parse selected filters
	const selectedLogTypes = $derived(
		tableState.filters
			.filter((f) => f.startsWith("logtype:"))
			.map((f) => f.replace("logtype:", "")),
	);

	const selectedPlayerIds = $derived(
		tableState.filters
			.filter((f) => f.startsWith("player:"))
			.map((f) => Number(f.replace("player:", ""))),
	);

	// Filtered and sorted event logs
	const filteredEventLogs = $derived.by(() => {
		let logs = annotatedEventLogs.filter((log) => {
			if (tableState.search) {
				const term = tableState.search.toLowerCase();
				const matchesLogType = formatEnum(log.log_type, "")
					.toLowerCase()
					.includes(term);
				const matchesPlayer = log.ownerLabel.toLowerCase().includes(term);
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
				selectedPlayerIds.length > 0 &&
				!log.ownerIds.some((id) => selectedPlayerIds.includes(id))
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
				case "owners":
					aVal = a.ownerLabel;
					bVal = b.ownerLabel;
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
{#if annotatedEventLogs.length === 0}
	<p class="p-8 text-center italic text-tan">No event logs recorded</p>
{:else}
	<h3 class="mb-2 mt-0 font-bold text-tan">Event Logs</h3>
	<div class={TABLE_FRAME_CLASS}>
		<TableFilterColumn
			bind:search={tableState.search}
			count={`${filteredEventLogs?.length ?? 0} / ${annotatedEventLogs.length} events`}
			chips={tableState.filters.map((f) =>
				f.startsWith("logtype:")
					? formatEnum(f.replace("logtype:", ""), "")
					: (playerById.get(Number(f.replace("player:", "")))?.label ?? ""),
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
								{#if showPlayerColumn}
									<Select.Group>
										<Select.GroupHeading
											class="border-b border-surface px-3 py-2 text-xs font-bold uppercase tracking-wide text-tan"
										>
											Players
										</Select.GroupHeading>
										{#each filterablePlayers as player (player.playerId)}
											<Select.Item
												value={`player:${player.playerId}`}
												label={player.label}
												class="flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan hover:bg-surface-raised data-[highlighted]:bg-surface-raised"
											>
												{#snippet children({ selected })}
													{player.label}
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
											class="border-b border-surface px-3 py-2 text-xs font-bold uppercase tracking-wide text-tan {showPlayerColumn
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
								onclick={() => toggleSort(tableState, "owners")}
							>
								<span class="inline-flex items-center gap-1">
									Players
									{#if tableState.sortColumn === "owners"}
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
								<td class={TABLE_CELL_TD_CLASS}>{log.ownerLabel}</td>
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
