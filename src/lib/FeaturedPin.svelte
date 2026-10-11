<script lang="ts">
	// The owner's control for featuring one of their own videos: it pins the
	// video to the front of their profile's Videos tab. The order is the public
	// read's (GET /v1/users/:id/videos leads with the featured set), so every
	// visitor sees it there — signed out included.
	//
	// A pin rather than FeaturedStar's star, because the two can sit on the same
	// card — an admin looking at their own profile — and curate different
	// things: the star the site's home strip, this the owner's own tab. The
	// button under both is one component; the glyph is what differs.
	//
	// Renders nothing unless the signed-in viewer is the video's uploader, so a
	// caller can place it unconditionally on a surface that is theirs.
	import { page } from "$app/state";
	import FeaturedVideoToggle from "$lib/FeaturedVideoToggle.svelte";
	import { isMyFeatured, setMyFeatured } from "$lib/featured-videos.svelte";
	import PinMark from "$lib/ui/PinMark.svelte";
	import type { CreatorVideo } from "$lib/api-cloud";

	let { video }: { video: CreatorVideo } = $props();

	// Read from `page` rather than threaded down, like FeaturedStar: every
	// surface renders this from a list, and none of them has another reason to
	// know who is looking.
	const mine = $derived(page.data.user?.user_id === video.user_id);
	const featured = $derived(isMyFeatured(video));
</script>

<!-- Filled = pinned. The touch gap the hover-only reveal leaves is covered by
     the Featured tab on /account. -->
<FeaturedVideoToggle
	canToggle={mine}
	{featured}
	label={featured
		? "Remove from your featured videos"
		: "Pin to the top of your Videos tab"}
	onToggle={() => setMyFeatured(video, !featured)}
>
	<PinMark class="h-4 w-4" filled={featured} />
</FeaturedVideoToggle>
