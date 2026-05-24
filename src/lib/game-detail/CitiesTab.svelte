<script lang="ts">
	import type { CityStatistics } from "$lib/types/CityStatistics";
	import { Select } from "bits-ui";
	import { formatEnum } from "$lib/utils/formatting";
	import { getCivilizationColor } from "$lib/config";
	import SpriteIcon from "./SpriteIcon.svelte";
	import TableFilterColumn from "./TableFilterColumn.svelte";
	import NationFilterSelect from "./NationFilterSelect.svelte";
	import {
		type TableState,
		CITY_COLUMNS,
		TABLE_FRAME_CLASS,
		TABLE_CLASS,
		TABLE_HEADER_TH_CLASS,
		TABLE_CELL_TD_CLASS,
		formatCityCell,
		toggleSort,
	} from "./helpers";

	// Nation accent color for the Nation cell, mirroring the games table.
	function nationColor(nation: string | null): string | undefined {
		if (!nation) return undefined;
		return getCivilizationColor(nation.replace(/^NATION_/, "")) ?? undefined;
	}

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
	const filteredSortedCities = $derived.by(() => {
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
</script>

{#if cityStatistics.cities.length === 0}
	<p class="p-8 text-center italic text-tan">No cities found</p>
{:else}
	<!--
		Two-column layout mirroring the player games table: filters + search
		stacked in a left column, the data table on the right.
	-->
	<div class={TABLE_FRAME_CLASS}>
		<TableFilterColumn
			bind:search={tableState.search}
			count={`${filteredSortedCities.length} / ${cityStatistics.cities.length} cities`}
			chips={selectedCityNations.map((n) => formatEnum(n, "NATION_"))}
		>
			{#snippet filters()}
				<NationFilterSelect
					nations={uniqueCityNations}
					bind:value={tableState.filters}
				/>

				<!-- Column visibility (Cities-specific) -->
				<Select.Root
					type="multiple"
					value={selectedColumnKeys}
					onValueChange={handleColumnVisibilityChange}
				>
					<Select.Trigger
						class="flex w-full cursor-pointer items-center justify-between rounded border border-black bg-[#35302b] px-2 py-1.5 text-xs text-tan"
					>
						<span class="truncate">Columns</span>
						<span class="ml-2 text-tan opacity-60">▼</span>
					</Select.Trigger>
					<Select.Portal>
						<Select.Content
							class="z-50 max-h-80 overflow-y-auto rounded bg-[#241f1b] shadow-lg"
						>
							<Select.Viewport>
								{#each CITY_COLUMNS as column (column.key)}
									<Select.Item
										value={column.key}
										label={column.label}
										class="flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan hover:bg-[#35302b] data-[highlighted]:bg-[#35302b]"
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
			{/snippet}
		</TableFilterColumn>

		<!-- Right: City Details Table -->
		<div class="min-w-0 flex-1 overflow-x-auto">
			<table class={TABLE_CLASS}>
				<thead>
					<tr>
						{#each visibleCityColumns as column, i (column.key)}
							<th
								class="{TABLE_HEADER_TH_CLASS} {i === 0
									? 'rounded-l-lg border-l'
									: ''} {i === visibleCityColumns.length - 1
									? 'rounded-r-lg border-r'
									: ''}"
								onclick={() => toggleSort(tableState, column.key)}
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
					{#each filteredSortedCities as city (city.city_id)}
						<tr class="group">
							{#each visibleCityColumns as column, i (column.key)}
								{@const iconValue = column.iconCategory
									? column.iconValue
										? column.iconValue(city)
										: column.getValue(city)
									: null}
								<td
									class="{TABLE_CELL_TD_CLASS} {i === 0
										? 'rounded-l-lg'
										: ''} {i === visibleCityColumns.length - 1
										? 'rounded-r-lg'
										: ''} {column.key === 'city_name'
										? 'font-bold'
										: ''} whitespace-nowrap"
									style={column.key === "owner_nation" &&
									nationColor(city.owner_nation)
										? `color: ${nationColor(city.owner_nation)}`
										: undefined}
								>
									{#if column.iconCategory}
										<span class="inline-flex items-center gap-1.5">
											{#if iconValue != null}
												<SpriteIcon
													category={column.iconCategory}
													value={String(iconValue)}
													size={16}
													alt=""
												/>
											{/if}
											{formatCityCell(column, city)}
										</span>
									{:else}
										{formatCityCell(column, city)}
									{/if}
								</td>
							{/each}
						</tr>
					{:else}
						<tr>
							<td
								colspan={visibleCityColumns.length}
								class="p-8 text-center italic text-tan"
							>
								No cities match search
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
