<script lang="ts">
	import type { ImprovementData } from "$lib/types/ImprovementData";
	import { formatEnum } from "$lib/utils/formatting";
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
		improvementData,
		tableState = $bindable<TableState>({
			search: "",
			sortColumn: "improvement",
			sortDirection: "asc",
			filters: [],
		}),
	}: {
		players: DetailPlayer[];
		improvementData: ImprovementData;
		tableState?: TableState;
	} = $props();

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
								{formatEnum(row.improvement, "IMPROVEMENT_")}
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
