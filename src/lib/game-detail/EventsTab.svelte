<script lang="ts">
	import type { EventLog } from "$lib/types/EventLog";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { EChartsOption } from "echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import SearchInput from "$lib/SearchInput.svelte";
	import { Select } from "bits-ui";
	import { formatEnum, stripMarkup } from "$lib/utils/formatting";
	import { CHART_THEME } from "$lib/config";
	import { type TableState, getPlayerColor } from "./helpers";

	let {
		eventLogs,
		playerHistory,
		gameDetails,
		victoryPointsEnabled,
		victoryConditions,
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
		victoryPointsEnabled: boolean;
		victoryConditions: string;
		chartFilter?: Record<string, boolean>;
		tableState?: TableState;
	} = $props();

	// ─── Chart option ─────────────────────────────────────────────────
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
						data: playerHistory.map((p) => formatEnum(p.nation, "NATION_")),
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
					series: playerHistory.map((player, i) => ({
						name: formatEnum(player.nation, "NATION_"),
						type: "line",
						data: player.history.map((h) => h.points),
						itemStyle: { color: getPlayerColor(player.nation, i) },
					})),
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
	const filteredEventLogs = $derived(() => {
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

	function handleToggleSort(columnKey: string) {
		if (tableState.sortColumn === columnKey) {
			tableState.sortDirection = tableState.sortDirection === "asc" ? "desc" : "asc";
		} else {
			tableState.sortColumn = columnKey;
			tableState.sortDirection = "asc";
		}
	}
</script>

<h2 class="mb-4 mt-0 font-bold text-tan">Game History</h2>
{#if !victoryPointsEnabled}
	<div
		class="mb-6 rounded-lg border-2 border-black p-6"
		style="background-color: #201a13;"
	>
		<h3 class="mb-2 font-bold text-tan">Victory Points</h3>
		<p class="italic text-brown">
			Victory Points not enabled for this game (enabled: {victoryConditions}).
		</p>
	</div>
{:else if pointsChartOption}
	<ChartContainer
		option={pointsChartOption}
		height="400px"
		title="Victory Points"
	/>
{/if}

<!-- Event Logs Table -->
<h3 class="mb-4 mt-8 font-bold text-tan">Event Logs</h3>
{#if processedEventLogs.length === 0}
	<p class="p-8 text-center italic text-brown">
		No event logs recorded
	</p>
{:else}
	<!-- Filters -->
	<div class="mb-4 flex flex-wrap items-end gap-3">
		<!-- Combined Log Type and Player Filter -->
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
						<!-- Players Group (only show if player column is visible) -->
						{#if showPlayerColumn && uniquePlayers.length > 0}
							<Select.Group>
								<Select.GroupHeading
									class="border-brown/50 border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-brown"
								>
									Players
								</Select.GroupHeading>
								{#each uniquePlayers as player (player)}
									<Select.Item
										value={`player:${player}`}
										label={player}
										class="hover:bg-brown/30 data-[highlighted]:bg-brown/30 flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan"
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
									class="border-brown/50 border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-brown {showPlayerColumn &&
									uniquePlayers.length > 0
										? 'border-t-brown/50 border-t'
										: ''}"
								>
									Log Types
								</Select.GroupHeading>
								{#each uniqueLogTypes as logType (logType)}
									<Select.Item
										value={`logtype:${logType}`}
										label={formatEnum(logType, "")}
										class="hover:bg-brown/30 data-[highlighted]:bg-brown/30 flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan"
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

		<!-- Description search -->
		<SearchInput
			bind:value={tableState.search}
			variant="field"
			class="w-96"
		/>

		<!-- Selected filter chips -->
		{#if tableState.filters.length > 0}
			<div class="flex flex-wrap gap-1">
				{#each tableState.filters as filter (filter)}
					<span class="rounded bg-brown px-2 py-1 text-xs text-white">
						{filter.startsWith("logtype:")
							? formatEnum(filter.replace("logtype:", ""), "")
							: filter.replace("player:", "")}
					</span>
				{/each}
			</div>
		{/if}

		<!-- Results count -->
		<span class="ml-auto text-sm text-brown">
			{filteredEventLogs()?.length ?? 0} / {processedEventLogs.length} events
		</span>
	</div>

	<div
		class="min-h-[36rem] overflow-x-auto rounded-lg"
		style="background-color: #201a13;"
	>
		<table class="w-full">
			<thead>
				<tr>
					<th
						class="hover:bg-brown/20 cursor-pointer select-none whitespace-nowrap border-b-2 border-brown p-3 text-left font-bold text-brown"
						onclick={() => handleToggleSort("turn")}
					>
						<span class="inline-flex items-center gap-1">
							Turn
							{#if tableState.sortColumn === "turn"}
								<span class="text-orange"
									>{tableState.sortDirection === "asc"
										? "↑"
										: "↓"}</span
								>
							{/if}
						</span>
					</th>
					<th
						class="hover:bg-brown/20 cursor-pointer select-none whitespace-nowrap border-b-2 border-brown p-3 text-left font-bold text-brown"
						onclick={() => handleToggleSort("log_type")}
					>
						<span class="inline-flex items-center gap-1">
							Log Type
							{#if tableState.sortColumn === "log_type"}
								<span class="text-orange"
									>{tableState.sortDirection === "asc"
										? "↑"
										: "↓"}</span
								>
							{/if}
						</span>
					</th>
					{#if showPlayerColumn}
						<th
							class="hover:bg-brown/20 cursor-pointer select-none whitespace-nowrap border-b-2 border-brown p-3 text-left font-bold text-brown"
							onclick={() => handleToggleSort("player_name")}
						>
							<span class="inline-flex items-center gap-1">
								Player
								{#if tableState.sortColumn === "player_name"}
									<span class="text-orange"
										>{tableState.sortDirection === "asc"
											? "↑"
											: "↓"}</span
									>
								{/if}
							</span>
						</th>
					{/if}
					<th
						class="hover:bg-brown/20 cursor-pointer select-none whitespace-nowrap border-b-2 border-brown p-3 text-left font-bold text-brown"
						onclick={() => handleToggleSort("description")}
					>
						<span class="inline-flex items-center gap-1">
							Description
							{#if tableState.sortColumn === "description"}
								<span class="text-orange"
									>{tableState.sortDirection === "asc"
										? "↑"
										: "↓"}</span
								>
							{/if}
						</span>
					</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredEventLogs() ?? [] as log, i (i)}
					<tr class="hover:bg-brown/20 transition-colors duration-200">
						<td class="border-brown/50 border-b p-3 text-left text-tan"
							>{log.turn}</td
						>
						<td class="border-brown/50 border-b p-3 text-left text-tan">
							<code class="text-sm">{formatEnum(log.log_type, "")}</code
							>
						</td>
						{#if showPlayerColumn}
							<td
								class="border-brown/50 border-b p-3 text-left text-tan"
								>{log.player_name ?? ""}</td
							>
						{/if}
						<td class="border-brown/50 border-b p-3 text-left text-tan"
							>{log.description || "—"}</td
						>
					</tr>
				{:else}
					<tr>
						<td
							colspan={showPlayerColumn ? 4 : 3}
							class="p-8 text-center text-brown italic"
						>
							No events match filters
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
