<script lang="ts">
	// Tournament Videos view: the uploads from the admin-set YouTube playlist,
	// newest first, rendered as the same discovery-style VideoCards the home
	// creator feed and the profile Videos tab use — so the three surfaces read as
	// one family. Data comes from the page load (which fetches the playlist's
	// videos only when one is configured). The tab linking here is hidden unless a
	// playlist is set; a direct visit to an unconfigured tournament shows the
	// empty state. The grid sits in a recessed panel so the raised cards read as a
	// well, matching VideosTab.
	import VideoCard from "$lib/VideoCard.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

<div
	class="rounded-lg p-4"
	style="background-color: rgb(var(--color-surface-sunken));"
>
	{#if data.videos.length === 0}
		<div class="py-8 text-center text-sm text-gray-400">No videos yet.</div>
	{:else}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.videos as v (v.platform + ":" + v.id)}
				<VideoCard video={v} />
			{/each}
		</div>
	{/if}
</div>
