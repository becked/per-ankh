<script lang="ts">
	import type { CityStatistics } from "$lib/types/CityStatistics";
	import SearchInput from "$lib/SearchInput.svelte";
	import { Select } from "bits-ui";
	import { formatEnum } from "$lib/utils/formatting";
	import { type TableState, CITY_COLUMNS, formatCityCell } from "./helpers";

	let {
		cityStatistics,
		tableState = $bindable<TableState>({
			search: "",
			sortColumn: "owner_nation",
			sortDirection: "asc",
			filters: [],
		}),
		cityVisibleColumns = $bindable<Record<string, boolean>>(
			Object.fromEntries(
				CITY_COLUMNS.map((col) => [col.key, col.defaultVisible]),
			),
		),
	}: {
		cityStatistics: CityStatistics;
		tableState?: TableState;
		cityVisibleColumns?: Record<string, boolean>;
	} = $props();

	// Get visible columns in order
	const visibleCityColumns = $derived(
		CITY_COLUMNS.filter((col) => cityVisibleColumns[col.key]),
	);

	// Convert visibility Record to array of selected keys for Select component
	const selectedColumnKeys = $derived(
		Object.entries(cityVisibleColumns)
			.filter(([, visible]) => visible)
			.map(([key]) => key),
	);

	function handleColumnVisibilityChange(keys: string[]) {
		for (const col of CITY_COLUMNS) {
			cityVisibleColumns[col.key] = keys.includes(col.key);
		}
	}

	// Get unique nations for city filter dropdown
	const uniqueCityNations = $derived(
		[
			...new Set(
				cityStatistics.cities
					.map((city) => city.owner_nation)
					.filter((n): n is string => n != null),
			),
		].sort(),
	);

	// Parse selected city filters (nation only)
	const selectedCityNations = $derived(
		tableState.filters
			.filter((f) => f.startsWith("nation:"))
			.map((f) => f.replace("nation:", "")),
	);

	// Filtered and sorted cities
	const filteredSortedCities = $derived(() => {
		let cities = cityStatistics.cities;

		if (selectedCityNations.length > 0) {
			cities = cities.filter(
				(city) =>
					city.owner_nation && selectedCityNations.includes(city.owner_nation),
			);
		}

		if (tableState.search) {
			const term = tableState.search.toLowerCase();
			cities = cities.filter(
				(city) =>
					city.city_name.toLowerCase().includes(term) ||
					(city.owner_nation?.toLowerCase().includes(term) ?? false) ||
					(city.family?.toLowerCase().includes(term) ?? false) ||
					(city.governor_name?.toLowerCase().includes(term) ?? false),
			);
		}

		const column = CITY_COLUMNS.find(
			(col) => col.key === tableState.sortColumn,
		);
		if (column) {
			cities = [...cities].sort((a, b) => {
				const aVal = column.sortValue
					? column.sortValue(a)
					: column.getValue(a);
				const bVal = column.sortValue
					? column.sortValue(b)
					: column.getValue(b);

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
		}

		return cities;
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

<h2 class="mb-4 mt-0 font-bold text-tan">Cities</h2>

{#if cityStatistics.cities.length === 0}
	<p class="p-8 text-center italic text-brown">No cities found</p>
{:else}
	<!-- Table Controls -->
	<div class="mb-4 flex flex-wrap items-end gap-3">
		<!-- Filter dropdown -->
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
						{#if uniqueCityNations.length > 0}
							<Select.Group>
								<Select.GroupHeading
									class="border-brown/50 border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-brown"
								>
									Nations
								</Select.GroupHeading>
								{#each uniqueCityNations as nation (nation)}
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

		<!-- Column Visibility Dropdown -->
		<Select.Root
			type="multiple"
			value={selectedColumnKeys}
			onValueChange={handleColumnVisibilityChange}
		>
			<Select.Trigger
				class="flex items-center gap-2 rounded border-2 border-black px-4 py-2 text-sm text-tan"
				style="background-color: #201a13;"
			>
				<span>Columns</span>
				<span class="text-brown">▼</span>
			</Select.Trigger>
			<Select.Portal>
				<Select.Content
					class="z-50 max-h-80 overflow-y-auto rounded border-2 border-black bg-[#201a13] shadow-lg"
				>
					<Select.Viewport>
						{#each CITY_COLUMNS as column (column.key)}
							<Select.Item
								value={column.key}
								label={column.label}
								class="hover:bg-brown/30 data-[highlighted]:bg-brown/30 flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan"
							>
								{#snippet children({ selected })}
									<span>{column.label}</span>
									{#if selected}
										<span class="font-bold text-orange">✓</span>
									{/if}
								{/snippet}
							</Select.Item>
						{/each}
					</Select.Viewport>
				</Select.Content>
			</Select.Portal>
		</Select.Root>

		<!-- Results count -->
		<span class="ml-auto text-sm text-brown">
			{filteredSortedCities().length} / {cityStatistics.cities.length} cities
		</span>
	</div>

	<!-- City Details Table -->
	<div
		class="overflow-x-auto rounded-lg"
		style="background-color: #201a13;"
	>
		<table class="w-full">
			<thead>
				<tr>
					{#each visibleCityColumns as column (column.key)}
						<th
							class="hover:bg-brown/20 cursor-pointer select-none whitespace-nowrap border-b-2 border-brown p-3 text-left font-bold text-brown"
							onclick={() => handleToggleSort(column.key)}
						>
							<span class="inline-flex items-center gap-1">
								{column.label}
								{#if tableState.sortColumn === column.key}
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
				{#each filteredSortedCities() as city (city.city_name)}
					<tr class="hover:bg-brown/20 transition-colors duration-200">
						{#each visibleCityColumns as column (column.key)}
							<td
								class="border-brown/50 border-b p-3 text-left text-tan {column.key ===
								'city_name'
									? 'font-bold'
									: ''} whitespace-nowrap"
							>
								{formatCityCell(column, city)}
							</td>
						{/each}
					</tr>
				{:else}
					<tr>
						<td
							colspan={visibleCityColumns.length}
							class="p-8 text-center text-brown italic"
						>
							No cities match search
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
