<script lang="ts">
	// The owner's control for featuring one of their own videos: it pins the
	// video to the front of their profile's Videos tab. The order is the public
	// read's (GET /v1/users/:id/videos leads with the featured set), so every
	// visitor sees it there — signed out included.
	//
	// A pin rather than FeaturedStar's star, because the two can sit on the same
	// card — an admin looking at their own profile — and curate different
	// things: the star the site's home strip, this the owner's own tab.
	//
	// Renders nothing unless the signed-in viewer is the video's uploader, so a
	// caller can place it unconditionally on a surface that is theirs.
	import { page } from "$app/state";
	import { isMyFeatured, setMyFeatured } from "$lib/featured-videos.svelte";
	import type { CreatorVideo } from "$lib/api-cloud";

	let { video }: { video: CreatorVideo } = $props();

	// Read from `page` rather than threaded down, like FeaturedStar: every
	// surface renders this from a list, and none of them has another reason to
	// know who is looking.
	const mine = $derived(page.data.user?.user_id === video.user_id);
	const featured = $derived(isMyFeatured(video));
	let saving = $state(false);

	async function toggle() {
		if (saving) return;
		saving = true;
		// Optimistic — the shared set flips first and reverts itself on failure.
		await setMyFeatured(video, !featured);
		saving = false;
	}
</script>

{#if mine}
	<!-- Styled as FeaturedStar's twin: above the stretched-link overlay (z-20)
	     so it wins the click instead of opening the video, hidden until the card
	     is hovered or the button itself is focused, and inert while hidden so an
	     invisible pin can't be clicked. That means no control on touch, which
	     the Featured tab on /account covers. Filled = featured. -->
	<button
		type="button"
		onclick={toggle}
		disabled={saving}
		aria-pressed={featured}
		aria-label={featured
			? "Remove from your featured videos"
			: "Feature at the top of your videos"}
		title={featured
			? "Remove from your featured videos"
			: "Feature at the top of your videos"}
		class="pointer-events-none relative z-20 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-tan-hover focus-visible:pointer-events-auto focus-visible:opacity-100 disabled:opacity-50 group-hover:pointer-events-auto group-hover:opacity-100 {featured
			? 'text-orange'
			: 'text-tan'}"
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-4 w-4"
			viewBox="0 0 24 24"
			fill={featured ? "currentColor" : "none"}
			stroke="currentColor"
			stroke-width="1.5"
			aria-hidden="true"
		>
			<path stroke-linecap="round" stroke-linejoin="round" d="M12 17v5" />
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"
			/>
		</svg>
	</button>
{/if}
