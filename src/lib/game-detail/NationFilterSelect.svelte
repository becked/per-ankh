<script lang="ts">
	// Shared nation multi-select for the data-tab filter columns. Binds the
	// owning table's `filters` array directly; emits `nation:<NATION_*>` values
	// and renders matching chips elsewhere. One group over `TableFilterSelect`,
	// which is the control every filter column's select goes through.
	import TableFilterSelect from "./TableFilterSelect.svelte";
	import { nationName } from "$lib/utils/formatting";

	let {
		nations,
		value = $bindable<string[]>([]),
		label = "Filter",
		heading = "Nations",
	}: {
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
				label: nationName(nation),
			})),
		},
	]);
</script>

<TableFilterSelect {groups} bind:value {label} />
