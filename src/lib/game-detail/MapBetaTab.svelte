<script lang="ts">
	import type { MapTile } from "$lib/types/MapTile";
	import type { CityInfo } from "$lib/types/CityInfo";
	import SpriteMap from "$lib/SpriteMap.svelte";

	let {
		mapTiles,
		cities = [],
		totalTurns = null,
		selectedTurn = null,
		onTurnChange = null,
	}: {
		mapTiles: MapTile[] | null;
		cities?: CityInfo[];
		totalTurns?: number | null;
		selectedTurn?: number | null;
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onTurnChange?: ((turn: number) => Promise<void>) | null;
	} = $props();
</script>

{#if mapTiles}
	<SpriteMap
		tiles={mapTiles}
		{cities}
		height="600px"
		totalTurns={onTurnChange ? totalTurns : null}
		selectedTurn={onTurnChange ? selectedTurn : null}
		{onTurnChange}
	/>
{:else}
	<p class="italic text-brown">Loading map data...</p>
{/if}
