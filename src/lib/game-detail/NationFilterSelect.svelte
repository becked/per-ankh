<script lang="ts">
	// Shared nation multi-select for the data-tab filter columns. Binds the
	// owning table's `filters` array directly; emits `nation:<NATION_*>` values
	// and renders matching chips elsewhere. One group over `TableFilterSelect`,
	// which is the control every filter column's select goes through.
	import TableFilterSelect from "./TableFilterSelect.svelte";
	import { civilizationName } from "$lib/utils/formatting";

	let {
		nations,
		value = $bindable<string[]>([]),
		label = "Filter",
		heading = "Nations",
	}: {
		// Nations, or — where a row's owner can be either, as a city's can —
		// the NATION_*/TRIBE_* union. Labelled through `civilizationName`,
		// which is `nationName` for every NATION_* a nation-only caller passes.
		nations: string[];
		value?: string[];
		label?: string;
		heading?: string;
	} = $props();

	const groups = $derived([
		{
			heading,
			options: nations.map((nation) => ({
				value: `nation:${nation}`,
				label: civilizationName(nation),
			})),
		},
	]);
</script>

<TableFilterSelect {groups} bind:value {label} />
