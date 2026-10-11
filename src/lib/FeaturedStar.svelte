<script lang="ts">
	// Site-admin control that adds a video to, or removes it from, the shared
	// featured set. Extracted from VideoCard so every surface that lists videos
	// carries the same one — the tournament Videos tab renders its own compact
	// tile rather than a VideoCard, and silently lost the star when it did.
	//
	// Renders nothing for a non-admin, so a caller can place it unconditionally.
	// The button is FeaturedVideoToggle, shared with the owner's pin.
	import { page } from "$app/state";
	import FeaturedVideoToggle from "$lib/FeaturedVideoToggle.svelte";
	import { isFeatured, setFeatured } from "$lib/featured-videos.svelte";
	import StarMark from "$lib/ui/StarMark.svelte";
	import type { TournamentVideo } from "$lib/api-cloud";

	let { video }: { video: TournamentVideo } = $props();

	// Read from `page` rather than threaded down: every surface renders this from
	// a list, and none of them has another reason to know who is looking (the
	// same reason GameActions and SettingsPopover read it directly).
	const canFeature = $derived(page.data.user?.is_admin === true);
	const featured = $derived(isFeatured(video));
</script>

<!-- Filled = featured. The touch gap the hover-only reveal leaves is covered by
     the Featured tab on /admin. -->
<FeaturedVideoToggle
	canToggle={canFeature}
	{featured}
	label={featured ? "Remove from featured" : "Feature this video"}
	onToggle={() => setFeatured(video, !featured)}
>
	<StarMark class="h-4 w-4" filled={featured} />
</FeaturedVideoToggle>
