<script lang="ts">
	// Shared left filter column for the data-tab tables, mirroring the player
	// games table: a leading spacer that aligns the controls with the first
	// table row (not the header), a dark search field, caller-supplied filter
	// dropdown(s), selected-filter chips, and a results count.
	import type { Snippet } from "svelte";
	import SearchInput from "$lib/SearchInput.svelte";

	let {
		search = $bindable(""),
		searchPlaceholder = "",
		count,
		chips = [],
		filters,
	}: {
		search?: string;
		searchPlaceholder?: string;
		count: string;
		// Pre-formatted labels for the active-filter chips.
		chips?: string[];
		// The filter dropdown(s) for this table.
		filters?: Snippet;
	} = $props();
</script>

<aside class="w-48 shrink-0">
	<!--
		mt-1.5 offsets the table's leading row-gap (border-spacing-y) so the
		first control aligns with the styled header row.
	-->
	<div class="mt-1.5 space-y-2">
		<SearchInput
			bind:value={search}
			placeholder={searchPlaceholder}
			variant="dark"
			class="w-full"
		/>

		{@render filters?.()}

		{#if chips.length > 0}
			<div class="flex flex-wrap gap-1">
				{#each chips as chip (chip)}
					<span class="rounded bg-surface-raised px-2 py-1 text-xs text-tan">
						{chip}
					</span>
				{/each}
			</div>
		{/if}

		<p class="text-xs text-tan opacity-70">{count}</p>
	</div>
</aside>
