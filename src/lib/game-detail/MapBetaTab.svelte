<script lang="ts">
	import type { MapTile } from "$lib/types/MapTile";
	import SpriteMap from "$lib/SpriteMap.svelte";

	let {
		mapTiles,
	}: {
		mapTiles: MapTile[] | null;
	} = $props();
</script>

{#if mapTiles}
	<SpriteMap tiles={mapTiles} height="600px" />
{:else}
	<p class="italic text-brown">Loading map data...</p>
{/if}
