<script lang="ts">
	import type { MapTile } from "$lib/types/MapTile";
	import HexMap from "$lib/HexMap.svelte";

	let {
		mapTiles,
		totalTurns = null,
		selectedTurn = null,
		onTurnChange = null,
	}: {
		mapTiles: MapTile[] | null;
		totalTurns?: number | null;
		selectedTurn?: number | null;
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onTurnChange?: ((turn: number) => Promise<void>) | null;
	} = $props();
</script>

<h2 class="mb-4 mt-0 font-bold text-tan">World Map</h2>
{#if mapTiles}
	<HexMap
		tiles={mapTiles}
		height="600px"
		totalTurns={onTurnChange ? totalTurns : null}
		selectedTurn={onTurnChange ? selectedTurn : null}
		onTurnChange={onTurnChange}
	/>
{:else}
	<p class="italic text-brown">Loading map data...</p>
{/if}
