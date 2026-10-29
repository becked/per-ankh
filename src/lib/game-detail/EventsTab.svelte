<script lang="ts">
	import type { EventLog } from "$lib/types/EventLog";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { FullGameData } from "$lib/parser/types";
	import type { ChartOption } from "$lib/echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import SegmentedSwitch from "$lib/ui/SegmentedSwitch.svelte";
	import { formatEnum, stripMarkup, nationName } from "$lib/utils/formatting";
	import { CHART_THEME, getNationChartColor } from "$lib/config";
	import TableFilterColumn from "./TableFilterColumn.svelte";
	import TableFilterSelect from "./TableFilterSelect.svelte";
	import MapPinsView from "./MapPinsView.svelte";
	import { hasMapPins } from "./map-pins";
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
		game,
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
		pinsTableState = $bindable<TableState>({
			search: "",
			sortColumn: "turn",
			sortDirection: "desc",
			filters: [],
		}),
	}: {
		// What the Map Pins view below reads, which is the only reason this tab
		// takes the game at all: the pins, and the grid they are placed on.
		game: Pick<FullGameData, "pings" | "map_tiles" | "game_details">;
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
		pinsTableState?: TableState;
	} = $props();

	// Resolved identity lookup (stable label + color per player), keyed by the
	// player id every per-player array carries. Mirror-match safe.
	const playerById = $derived(new Map(players.map((p) => [p.playerId, p])));

	// ─── List view ────────────────────────────────────────────────────
	// The tab's two lists, switched under the chart: the event log, and the map
	// pins the save still carried (MapPinsView). The switch shows only where the
	// blob carries a pin at all, so a game with no pins reads as the log alone
	// rather than a switch with one segment that can never fill.
	type ListView = "events" | "pins";
	const LIST_VIEWS: { key: ListView; label: string }[] = [
		{ key: "events", label: "Events" },
		{ key: "pins", label: "Map Pins" },
	];

	const hasPins = $derived(hasMapPins(game));
	let listView = $state<ListView>("events");

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

	// What the filter column offers: the seats that logged something, and the
	// log types present. The Players group carries the same question
	// `showPlayerColumn` asks, so where the column is hidden the group has no
	// options and TableFilterSelect drops its heading with it.
	const filterGroups = $derived([
		{
			heading: "Players",
			options: filterablePlayers.map((p) => ({
				value: `player:${p.playerId}`,
				label: p.label,
			})),
		},
		{
			heading: "Log Types",
			options: uniqueLogTypes.map((logType) => ({
				value: `logtype:${logType}`,
				label: formatEnum(logType, ""),
			})),
		},
	]);

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

<!-- Map Pins beside the log rather than merged into it: the same turn-stamped,
     seat-attributed rows, but a pin's turn is a FLOOR on when it was on the map
     and a log entry's is not, so no one column header could label both. -->
{#if hasPins}
	<div class="mb-4">
		<SegmentedSwitch
			items={LIST_VIEWS}
			value={listView}
			onChange={(key) => (listView = key)}
			ariaLabel="Events list view"
			borderShade="sunken"
			class="w-fit"
		/>
	</div>
{/if}

{#if listView === "pins"}
	<MapPinsView {game} {players} bind:tableState={pinsTableState} />
{:else if annotatedEventLogs.length === 0}
	<p class="p-8 text-center italic text-tan">No event logs recorded</p>
{:else}
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
				<TableFilterSelect
					groups={filterGroups}
					bind:value={tableState.filters}
				/>
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
