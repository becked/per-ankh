<script lang="ts">
	// This user's featured videos first, then recent uploads merged across their
	// linked channels (newest first within each half) — rendered as a grid of
	// discovery-style VideoCards, the same card the home "Latest from creators"
	// feed uses, so the two surfaces read as one family. The order is the
	// Worker's, not this component's: it ships that way from
	// GET /v1/users/:id/videos, so a signed-out visitor sees the owner's picks
	// at the top too.
	//
	// These are all one user's uploads, so the cards suppress the uploader credit
	// and show the date pill alone — the videos still carry their uploader, which
	// is what an admin's star snapshots into the featured set and what the
	// owner's pin is keyed on. The grid sits in a recessed (sunken) panel so the
	// raised cards read as a well within the tab. Data comes from the page load.
	import VideoCard from "$lib/VideoCard.svelte";
	import { videoKey } from "$lib/featured-videos.svelte";
	import type { CreatorVideo } from "$lib/api-cloud";

	// `isOwner` is this tab's own viewer check, and the only surface that passes
	// ownerCanFeature: the pin promotes a video within this list.
	let { videos, isOwner }: { videos: CreatorVideo[]; isOwner: boolean } =
		$props();
</script>

<div
	class="rounded-lg p-4"
	style="background-color: rgb(var(--color-surface-sunken));"
>
	{#if videos.length === 0}
		<div class="py-8 text-center text-sm text-gray-400">No recent videos.</div>
	{:else}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each videos as v (videoKey(v))}
				<VideoCard video={v} showUploader={false} ownerCanFeature={isOwner} />
			{/each}
		</div>
	{/if}
</div>
