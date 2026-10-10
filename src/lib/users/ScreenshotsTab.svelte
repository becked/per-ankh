<script lang="ts">
	// One user's screenshots across all their games, newest first — the same
	// grid the game-detail strip renders, with each tile naming and linking the
	// game it came from, which on this surface is the only thing that does.
	// The grid sits in a recessed (sunken) panel so the tiles read as a well
	// within the tab, matching the Videos tab beside it.
	//
	// Data comes from GET /v1/users/:id/screenshots via the page load, lazily
	// with the tab. The owner's delete is on the tile here too: this is the
	// surface that shows every shot an account has, so it is where someone
	// clearing up goes.
	import ScreenshotGallery from "$lib/screenshots/ScreenshotGallery.svelte";
	import type { GameScreenshot } from "$lib/api-cloud";

	let {
		screenshots = $bindable(),
		isOwner = false,
	}: { screenshots: GameScreenshot[]; isOwner?: boolean } = $props();
</script>

<div
	class="rounded-lg p-4"
	style="background-color: rgb(var(--color-surface-sunken));"
>
	{#if screenshots.length === 0}
		<div class="py-8 text-center text-sm text-gray-400">No screenshots.</div>
	{:else}
		<ScreenshotGallery bind:screenshots canDelete={isOwner} showGame />
	{/if}
</div>
