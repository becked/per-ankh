<script lang="ts">
	import type { ImprovementData } from "$lib/types/ImprovementData";
	import SearchInput from "$lib/SearchInput.svelte";
	import { Select } from "bits-ui";
	import { formatEnum } from "$lib/utils/formatting";
	import { type TableState } from "./helpers";

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

	const improvementPivotData = $derived(() => {
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

	function handleToggleSort(columnKey: string) {
		if (tableState.sortColumn === columnKey) {
			tableState.sortDirection = tableState.sortDirection === "asc" ? "desc" : "asc";
		} else {
			tableState.sortColumn = columnKey;
			tableState.sortDirection = "asc";
		}
	}
</script>

{#if improvementData.improvements.length === 0}
	<p class="p-8 text-center italic text-brown">No improvements found</p>
{:else}
	<!-- Controls row -->
	<div class="mb-4 flex flex-wrap items-end gap-3">
		<!-- Filter dropdown -->
		<Select.Root
			type="multiple"
			bind:value={tableState.filters}
		>
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
						{#if uniqueImprovementNations.length > 0}
							<Select.Group>
								<Select.GroupHeading
									class="border-brown/50 border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-brown"
								>
									Nations
								</Select.GroupHeading>
								{#each uniqueImprovementNations as nation (nation)}
									<Select.Item
										value={`nation:${nation}`}
										label={formatEnum(nation, "NATION_")}
										class="hover:bg-brown/30 data-[highlighted]:bg-brown/30 flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan"
									>
										{#snippet children({ selected })}
											{formatEnum(nation, "NATION_")}
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

		<!-- Search -->
		<SearchInput
			bind:value={tableState.search}
			placeholder="Search"
			variant="field"
			class="w-64"
		/>

		<!-- Selected filter chips -->
		{#if tableState.filters.length > 0}
			<div class="flex flex-wrap gap-1">
				{#each tableState.filters as filter (filter)}
					<span class="rounded bg-brown px-2 py-1 text-xs text-white">
						{formatEnum(filter.replace("nation:", ""), "NATION_")}
					</span>
				{/each}
			</div>
		{/if}

		<!-- Results count -->
		<span class="ml-auto text-sm text-brown">
			{improvementPivotData().length} improvements
		</span>
	</div>

	<!-- Improvements pivot table -->
	<div
		class="overflow-x-auto rounded-lg"
		style="background-color: #201a13;"
	>
		<table class="w-full">
			<thead>
				<tr>
					<th
						class="hover:bg-brown/20 cursor-pointer select-none whitespace-nowrap border-b-2 border-brown p-3 text-left font-bold text-brown"
						onclick={() => handleToggleSort("improvement")}
					>
						<span class="inline-flex items-center gap-1">
							Improvement
							{#if tableState.sortColumn === "improvement"}
								<span class="text-orange">
									{tableState.sortDirection === "asc"
										? "↑"
										: "↓"}
								</span>
							{/if}
						</span>
					</th>
					{#each displayedImprovementNations as nation (nation)}
						<th
							class="hover:bg-brown/20 cursor-pointer select-none whitespace-nowrap border-b-2 border-brown p-3 text-center font-bold text-brown"
							onclick={() =>
								handleToggleSort(`nation:${nation}`)}
						>
							<span
								class="inline-flex items-center justify-center gap-1"
							>
								{formatEnum(nation, "NATION_")}
								{#if tableState.sortColumn === `nation:${nation}`}
									<span class="text-orange">
										{tableState.sortDirection === "asc"
											? "↑"
											: "↓"}
									</span>
								{/if}
							</span>
						</th>
					{/each}
					{#if displayedImprovementNations.length > 1}
						<th
							class="hover:bg-brown/20 cursor-pointer select-none whitespace-nowrap border-b-2 border-brown p-3 text-center font-bold text-brown"
							onclick={() => handleToggleSort("total")}
						>
							<span
								class="inline-flex items-center justify-center gap-1"
							>
								Total
								{#if tableState.sortColumn === "total"}
									<span class="text-orange">
										{tableState.sortDirection === "asc"
											? "↑"
											: "↓"}
									</span>
								{/if}
							</span>
						</th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#each improvementPivotData() as row (row.improvement)}
					<tr class="hover:bg-brown/10">
						<td
							class="border-brown/50 whitespace-nowrap border-b p-3 text-left text-tan"
						>
							{formatEnum(row.improvement, "IMPROVEMENT_")}
						</td>
						{#each displayedImprovementNations as nation (nation)}
							<td
								class="border-brown/50 whitespace-nowrap border-b p-3 text-center text-tan"
							>
								{row.counts[nation] ?? 0}
							</td>
						{/each}
						{#if displayedImprovementNations.length > 1}
							<td
								class="border-brown/50 whitespace-nowrap border-b p-3 text-center font-bold text-tan"
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
							class="p-8 text-center text-brown italic"
						>
							No improvements match search
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
