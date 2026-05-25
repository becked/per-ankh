<script lang="ts">
	import type { Snippet } from "svelte";
	import type { MapTile } from "$lib/types/MapTile";
	import type { CityInfo } from "$lib/types/CityInfo";
	import SpriteMap from "$lib/SpriteMap.svelte";

	let {
		mapTiles,
		cities = [],
		totalTurns = null,
		selectedTurn = null,
		onTurnChange = null,
		missingMessage,
	}: {
		mapTiles: MapTile[] | null;
		cities?: CityInfo[];
		totalTurns?: number | null;
		selectedTurn?: number | null;
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onTurnChange?: ((turn: number) => Promise<void>) | null;
		missingMessage?: Snippet;
	} = $props();
</script>

{#if mapTiles == null}
	<p class="italic text-tan">Loading map data...</p>
{:else if mapTiles.length === 0}
	{#if missingMessage}
		{@render missingMessage()}
	{:else}
		<p class="italic text-tan">No map data available for this game.</p>
	{/if}
{:else}
	<SpriteMap
		tiles={mapTiles}
		{cities}
		height="600px"
		totalTurns={onTurnChange ? totalTurns : null}
		selectedTurn={onTurnChange ? selectedTurn : null}
		{onTurnChange}
	/>
{/if}
