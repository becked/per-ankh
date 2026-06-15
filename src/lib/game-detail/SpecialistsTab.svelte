<script lang="ts">
	import type { ImprovementData } from "$lib/types/ImprovementData";
	import type { EChartsOption } from "echarts";
	import { formatEnum } from "$lib/utils/formatting";
	import { CHART_THEME, getNationChartColor } from "$lib/config";
	import SpriteIcon from "./SpriteIcon.svelte";
	import ChartContainer from "$lib/ChartContainer.svelte";
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
	import {
		type KindFilter,
		type SpecialistKind,
		specialistInfo,
		classLabel,
		specialistName,
		summarizeForPlayer,
		levelBreakdownForPlayer,
	} from "./specialists";

	let {
		players,
		improvementData,
		tableState = $bindable<TableState>({
			search: "",
			sortColumn: "specialist",
			sortDirection: "asc",
			filters: [],
		}),
	}: {
		players: DetailPlayer[];
		improvementData: ImprovementData;
		tableState?: TableState;
	} = $props();

	// Table-only options (not persisted across tab switches): urban/rural filter
	// and whether urban classes expand into their three tiers.
	let kindFilter = $state<KindFilter>("all");
	let breakOutByLevel = $state(false);
	const KIND_OPTIONS: [KindFilter, string][] = [
		["all", "All"],
		["urban", "Urban"],
		["rural", "Rural"],
	];

	// Stacked-bar segment colors: muted brown for rural, a light→dark copper ramp
	// for the three urban tiers (deeper = more developed).
	const SEGMENTS = [
		{ name: "Rural", key: "rural", color: "#5a4d3f" },
		{ name: "Urban Level 1", key: "urban1", color: "#CD853F" },
		{ name: "Urban Level 2", key: "urban2", color: "#C87941" },
		{ name: "Urban Level 3", key: "urban3", color: "#8B4513" },
	] as const;

	const hasSpecialist = (imp: { specialist: string | null }) =>
		specialistInfo(imp.specialist) != null;

	const placedCount = $derived(
		improvementData.improvements.filter(hasSpecialist).length,
	);

	// Columns are per player (mirror-match safe); filtering stays by nation.
	// Attribution prefers owner_player_xml_id (≥2.6.0 blobs), falling back to
	// nation on older blobs — same convention as the Improvements tab.
	const columnPlayers = $derived(
		players.filter((p) =>
			ownedByPlayer(
				improvementData.improvements,
				p,
				(i) => i.owner_player_xml_id,
				(i) => i.nation,
			).some(hasSpecialist),
		),
	);

	const uniqueNations = $derived(
		[
			...new Set(
				columnPlayers
					.map((p) => p.nation)
					.filter((n): n is string => n != null),
			),
		].sort(),
	);

	const selectedNations = $derived(
		tableState.filters
			.filter((f) => f.startsWith("nation:"))
			.map((f) => f.replace("nation:", "")),
	);

	const displayedPlayers = $derived(
		selectedNations.length > 0
			? columnPlayers.filter(
					(p) => p.nation != null && selectedNations.includes(p.nation),
				)
			: columnPlayers,
	);

	const summaries = $derived(
		displayedPlayers.map((p) =>
			summarizeForPlayer(improvementData.improvements, p),
		),
	);

	type SpecialistPivotRow = {
		key: string;
		label: string;
		kind: SpecialistKind;
		sortKey: string;
		counts: Record<number, number>;
		total: number;
	};

	const pivotData = $derived.by(() => {
		const placed = improvementData.improvements.filter(hasSpecialist);
		if (placed.length === 0) return [];

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Maps used locally in function, not as reactive state
		const counts = new Map<string, Record<number, number>>();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Maps used locally in function, not as reactive state
		const meta = new Map<
			string,
			Omit<SpecialistPivotRow, "counts" | "total">
		>();

		for (const p of columnPlayers) {
			for (const imp of ownedByPlayer(
				placed,
				p,
				(i) => i.owner_player_xml_id,
				(i) => i.nation,
			)) {
				const info = specialistInfo(imp.specialist)!;
				if (kindFilter !== "all" && info.kind !== kindFilter) continue;

				const key = breakOutByLevel ? imp.specialist! : info.class;
				if (!meta.has(key)) {
					const cls = classLabel(info.class);
					// Group rows urban-first, then by class line, then by tier.
					const order = info.kind === "urban" ? 0 : 1;
					const tier = String(info.level ?? 0).padStart(2, "0");
					meta.set(key, {
						key,
						label: breakOutByLevel ? specialistName(imp.specialist!) : cls,
						kind: info.kind,
						sortKey: `${order}|${cls}|${tier}`,
					});
				}
				if (!counts.has(key)) counts.set(key, {});
				const row = counts.get(key)!;
				row[p.playerId] = (row[p.playerId] ?? 0) + 1;
			}
		}

		const term = tableState.search.toLowerCase();
		const rows: SpecialistPivotRow[] = [];
		for (const [key, row] of counts) {
			const m = meta.get(key)!;
			if (term && !m.label.toLowerCase().includes(term)) continue;
			const total = displayedPlayers.reduce(
				(sum, p) => sum + (row[p.playerId] ?? 0),
				0,
			);
			rows.push({ ...m, counts: row, total });
		}

		const dir = tableState.sortDirection === "asc" ? 1 : -1;
		rows.sort((a, b) => {
			if (tableState.sortColumn === "total") return (a.total - b.total) * dir;
			if (tableState.sortColumn.startsWith("player:")) {
				const id = Number(tableState.sortColumn.replace("player:", ""));
				return ((a.counts[id] ?? 0) - (b.counts[id] ?? 0)) * dir;
			}
			return a.sortKey.localeCompare(b.sortKey) * dir;
		});
		return rows;
	});

	function coveragePct(coverage: number | null): string {
		return coverage != null ? `${Math.round(coverage * 100)}%` : "—";
	}

	// Breadth × depth: stacked specialist counts per player, split rural + the
	// three urban tiers. Bar height = breadth; stack mix = maturity.
	const levelStackOption: EChartsOption = $derived.by(() => {
		const breakdowns = displayedPlayers.map((p) =>
			levelBreakdownForPlayer(improvementData.improvements, p),
		);
		return {
			...CHART_THEME,
			title: { ...CHART_THEME.title, text: "Specialists by level" },
			legend: { show: true, bottom: 0, textStyle: { color: "#FFFFFF" } },
			tooltip: { ...CHART_THEME.tooltip, axisPointer: { type: "shadow" } },
			grid: { left: 16, right: 16, top: 56, bottom: 48, containLabel: true },
			xAxis: { type: "category", data: displayedPlayers.map((p) => p.label) },
			yAxis: { type: "value", minInterval: 1 },
			series: SEGMENTS.map((s) => ({
				name: s.name,
				type: "bar",
				stack: "specialists",
				data: breakdowns.map((b) => b[s.key]),
				itemStyle: { color: s.color },
			})),
		};
	});

	// Coverage: staffed share of specialist-eligible improvements built, per
	// player, colored by nation.
	const coverageOption: EChartsOption = $derived.by(() => {
		const data = displayedPlayers.map((p, i) => ({
			value:
				summaries[i].coverage != null
					? Math.round(summaries[i].coverage * 1000) / 10
					: 0,
			itemStyle: { color: getNationChartColor(p.nation, i) },
		}));
		return {
			...CHART_THEME,
			title: { ...CHART_THEME.title, text: "Coverage" },
			tooltip: {
				...CHART_THEME.tooltip,
				axisPointer: { type: "shadow" },
				formatter: (params: unknown) => {
					const p = (params as { dataIndex: number }[])[0];
					const player = displayedPlayers[p.dataIndex];
					const s = summaries[p.dataIndex];
					if (!player || !s) return "";
					return `${player.label}<br/>Coverage: ${coveragePct(s.coverage)}<br/>${s.total} specialists`;
				},
			},
			grid: { left: 16, right: 16, top: 56, bottom: 24, containLabel: true },
			xAxis: {
				type: "category",
				data: displayedPlayers.map((p) => p.label),
				// Bars are colored by nation, so the per-bar labels are redundant.
				axisLabel: { show: false },
			},
			yAxis: {
				type: "value",
				max: 100,
				axisLabel: { formatter: "{value}%" },
			},
			series: [{ type: "bar", data, barMaxWidth: 56 }],
		};
	});
</script>

{#if placedCount === 0}
	<p class="p-8 text-center italic text-tan">No specialists found</p>
{:else}
	<!-- Per-player headline metrics: breadth (total), coverage %, depth (avg urban level). -->
	{#if displayedPlayers.length > 0}
		<div class="mb-4 flex flex-wrap gap-3">
			{#each displayedPlayers as player, i (player.playerId)}
				<div class="min-w-[9rem] flex-1 rounded-lg bg-surface p-3">
					<div class="mb-2 flex items-center gap-1.5">
						{#if player.nation}
							<SpriteIcon
								category="crests"
								value={player.nation}
								size={16}
								alt={formatEnum(player.nation, "NATION_")}
							/>
						{/if}
						<span class="truncate text-sm font-semibold text-tan"
							>{player.label}</span
						>
					</div>
					<dl class="space-y-1 text-xs text-tan">
						<div class="flex justify-between">
							<dt class="opacity-70">Specialists</dt>
							<dd class="font-bold">{summaries[i].total}</dd>
						</div>
						<div class="flex justify-between">
							<dt class="opacity-70">Coverage</dt>
							<dd class="font-bold">{coveragePct(summaries[i].coverage)}</dd>
						</div>
						<div class="flex justify-between">
							<dt class="opacity-70">Avg urban level</dt>
							<dd class="font-bold">
								{summaries[i].avgUrbanLevel != null
									? summaries[i].avgUrbanLevel.toFixed(1)
									: "—"}
							</dd>
						</div>
					</dl>
				</div>
			{/each}
		</div>

		<div class="mb-6 grid gap-4 rounded-lg bg-surface p-4 lg:grid-cols-2">
			<ChartContainer
				option={levelStackOption}
				height="320px"
				title="Specialists by level"
			/>
			<ChartContainer option={coverageOption} height="320px" title="Coverage" />
		</div>
	{/if}

	<div class={TABLE_FRAME_CLASS}>
		<TableFilterColumn
			bind:search={tableState.search}
			searchPlaceholder="Search specialists"
			count={`${pivotData.length} ${breakOutByLevel ? "specialists" : "classes"}`}
			chips={selectedNations.map((n) => formatEnum(n, "NATION_"))}
		>
			{#snippet filters()}
				<NationFilterSelect
					nations={uniqueNations}
					bind:value={tableState.filters}
				/>
				<div class="flex gap-1">
					{#each KIND_OPTIONS as [val, lbl] (val)}
						<button
							type="button"
							class="flex-1 cursor-pointer rounded border border-black px-2 py-1 text-xs {kindFilter ===
							val
								? 'bg-orange font-semibold text-black'
								: 'bg-surface-raised text-tan'}"
							onclick={() => (kindFilter = val)}>{lbl}</button
						>
					{/each}
				</div>
				<label class="flex cursor-pointer items-center gap-2 text-xs text-tan">
					<input type="checkbox" bind:checked={breakOutByLevel} />
					Break out by level
				</label>
			{/snippet}
		</TableFilterColumn>

		<!-- Specialists pivot table -->
		<div class="min-w-0 flex-1 overflow-x-auto">
			<table class={TABLE_CLASS}>
				<thead>
					<tr>
						<th
							class="{TABLE_HEADER_TH_CLASS} rounded-l-lg border-l {displayedPlayers.length ===
							0
								? 'rounded-r-lg border-r'
								: ''}"
							onclick={() => toggleSort(tableState, "specialist")}
						>
							<span class="inline-flex items-center gap-1">
								Specialist
								{#if tableState.sortColumn === "specialist"}
									<span class="text-orange">
										{tableState.sortDirection === "asc" ? "↑" : "↓"}
									</span>
								{/if}
							</span>
						</th>
						{#each displayedPlayers as player (player.playerId)}
							<th
								class="{TABLE_HEADER_TH_CLASS} !text-center {displayedPlayers.length ===
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
						{#if displayedPlayers.length > 1}
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
					{#each pivotData as row (row.key)}
						<tr class="group">
							<td
								class="{TABLE_CELL_TD_CLASS} whitespace-nowrap rounded-l-lg {displayedPlayers.length ===
								0
									? 'rounded-r-lg'
									: ''}"
							>
								{row.label}
								{#if kindFilter === "all"}
									<span class="ml-2 text-xs capitalize text-tan opacity-50"
										>{row.kind}</span
									>
								{/if}
							</td>
							{#each displayedPlayers as player (player.playerId)}
								<td
									class="{TABLE_CELL_TD_CLASS} whitespace-nowrap !text-center {displayedPlayers.length ===
									1
										? 'rounded-r-lg'
										: ''}"
								>
									{row.counts[player.playerId] ?? 0}
								</td>
							{/each}
							{#if displayedPlayers.length > 1}
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
								colspan={displayedPlayers.length +
									(displayedPlayers.length > 1 ? 2 : 1)}
								class="p-8 text-center italic text-tan"
							>
								No specialists match filters
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
