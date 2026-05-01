<script lang="ts">
	import type { MapTile } from "$lib/types/MapTile";
	import type { CityInfo } from "$lib/types/CityInfo";
	import SpriteMap from "$lib/SpriteMap.svelte";

	let {
		mapTiles,
		cities = [],
	}: {
		mapTiles: MapTile[] | null;
		cities?: CityInfo[];
	} = $props();
</script>

{#if mapTiles}
	<SpriteMap tiles={mapTiles} {cities} height="600px" />
{:else}
	<p class="italic text-brown">Loading map data...</p>
{/if}
