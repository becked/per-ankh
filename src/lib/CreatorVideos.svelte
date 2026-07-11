<script lang="ts">
	// "Latest from creators": the newest uploads across every user's linked
	// channels, merged newest-first (GET /v1/creator-videos via the home load).
	// On the home page this is the middle column between the games feed and the
	// right rail on desktop, where it lays out as a 2-up grid of compact
	// (half-size) VideoCards; below `lg` it collapses to a full-width strip (2-up,
	// then 4-up). Each card is a CreatorVideo, so it carries the uploader's
	// attribution. The `class` prop supplies the parent grid's placement (order +
	// col-span).
	import VideoCard from "$lib/VideoCard.svelte";
	import type { CreatorVideo } from "$lib/api-cloud";

	let {
		videos,
		class: className = "",
	}: { videos: CreatorVideo[]; class?: string } = $props();
</script>

<section class={className}>
	<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2">
		{#each videos as v (v.platform + ":" + v.id)}
			<VideoCard video={v} />
		{/each}
	</div>
</section>
