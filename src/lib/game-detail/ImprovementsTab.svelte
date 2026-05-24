<script lang="ts">
	import type { ImprovementData } from "$lib/types/ImprovementData";
	import { formatEnum } from "$lib/utils/formatting";
	import SpriteIcon from "./SpriteIcon.svelte";
	import TableFilterColumn from "./TableFilterColumn.svelte";
	import NationFilterSelect from "./NationFilterSelect.svelte";
	import {
		type TableState,
		TABLE_FRAME_CLASS,
		TABLE_CLASS,
		TABLE_HEADER_TH_CLASS,
		TABLE_CELL_TD_CLASS,
		toggleSort,
	} from "./helpers";

	let {
		improvementData,
		tableState = $bindable<TableState>({
			search: "",
			sortColumn: "improvement",
			sortDirection: "asc",
			filters: [],
		}),
	}: {
		improvementData: ImprovementData;
		tableState?: TableState;
	} = $props();

	// ─── Pivot table logic ────────────────────────────────────────────
	const uniqueImprovementNations = $derived(
		[
			...new Set(
				improvementData.improvements
					.map((imp) => imp.nation)
					.filter((n): n is string => n != null),
			),
		].sort(),
	);

	const selectedImprovementNations = $derived(
		tableState.filters
			.filter((f) => f.startsWith("nation:"))
			.map((f) => f.replace("nation:", "")),
	);

	const displayedImprovementNations = $derived(
		selectedImprovementNations.length > 0
			? selectedImprovementNations
			: uniqueImprovementNations,
	);

	type ImprovementPivotRow = {
		improvement: string;
		counts: Record<string, number>;
		total: number;
	};

	const improvementPivotData = $derived.by(() => {
		if (improvementData.improvements.length === 0) return [];

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const pivotMap = new Map<string, Record<string, number>>();

		for (const imp of improvementData.improvements) {
			if (!imp.nation) continue;
			if (!pivotMap.has(imp.improvement)) {
				pivotMap.set(imp.improvement, {});
			}
			const counts = pivotMap.get(imp.improvement)!;
			counts[imp.nation] = (counts[imp.nation] ?? 0) + 1;
		}

		const rows: ImprovementPivotRow[] = [];
		for (const [improvement, counts] of pivotMap) {
			if (tableState.search) {
				const term = tableState.search.toLowerCase();
				if (!improvement.toLowerCase().includes(term)) {
					continue;
				}
			}
			const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
			rows.push({ improvement, counts, total });
		}

		rows.sort((a, b) => {
			if (tableState.sortColumn === "improvement") {
				const cmp = a.improvement.localeCompare(b.improvement);
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			} else if (tableState.sortColumn === "total") {
				const cmp = a.total - b.total;
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			} else if (tableState.sortColumn.startsWith("nation:")) {
				const nation = tableState.sortColumn.replace("nation:", "");
				const aVal = a.counts[nation] ?? 0;
				const bVal = b.counts[nation] ?? 0;
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
							class="{TABLE_HEADER_TH_CLASS} rounded-l-lg border-l {displayedImprovementNations.length ===
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
						{#each displayedImprovementNations as nation (nation)}
							<th
								class="{TABLE_HEADER_TH_CLASS} !text-center {displayedImprovementNations.length ===
								1
									? 'rounded-r-lg border-r'
									: ''}"
								onclick={() => toggleSort(tableState, `nation:${nation}`)}
							>
								<span class="inline-flex items-center justify-center gap-1.5">
									<SpriteIcon
										category="crests"
										value={nation}
										size={14}
										alt={formatEnum(nation, "NATION_")}
									/>
									{formatEnum(nation, "NATION_")}
									{#if tableState.sortColumn === `nation:${nation}`}
										<span class="text-orange">
											{tableState.sortDirection === "asc" ? "↑" : "↓"}
										</span>
									{/if}
								</span>
							</th>
						{/each}
						{#if displayedImprovementNations.length > 1}
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
								class="{TABLE_CELL_TD_CLASS} whitespace-nowrap rounded-l-lg {displayedImprovementNations.length ===
								0
									? 'rounded-r-lg'
									: ''}"
							>
								{formatEnum(row.improvement, "IMPROVEMENT_")}
							</td>
							{#each displayedImprovementNations as nation (nation)}
								<td
									class="{TABLE_CELL_TD_CLASS} whitespace-nowrap !text-center {displayedImprovementNations.length ===
									1
										? 'rounded-r-lg'
										: ''}"
								>
									{row.counts[nation] ?? 0}
								</td>
							{/each}
							{#if displayedImprovementNations.length > 1}
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
								colspan={displayedImprovementNations.length +
									(displayedImprovementNations.length > 1 ? 2 : 1)}
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
