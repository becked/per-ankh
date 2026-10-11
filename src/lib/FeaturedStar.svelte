<script lang="ts">
	// Site-admin control that adds a video to, or removes it from, the shared
	// featured set. Extracted from VideoCard so every surface that lists videos
	// carries the same one — the tournament Videos tab renders its own compact
	// tile rather than a VideoCard, and silently lost the star when it did.
	//
	// Renders nothing for a non-admin, so a caller can place it unconditionally.
	import { page } from "$app/state";
	import { isFeatured, setFeatured } from "$lib/featured-videos.svelte";
	import StarMark from "$lib/ui/StarMark.svelte";
	import type { TournamentVideo } from "$lib/api-cloud";

	let { video }: { video: TournamentVideo } = $props();

	// Read from `page` rather than threaded down: every surface renders this from
	// a list, and none of them has another reason to know who is looking (the
	// same reason GameActions and SettingsPopover read it directly).
	const canFeature = $derived(page.data.user?.is_admin === true);
	const featured = $derived(isFeatured(video));
	let saving = $state(false);

	async function toggle() {
		if (saving) return;
		saving = true;
		// Optimistic — the shared set flips first and reverts itself on failure.
		await setFeatured(video, !featured);
		saving = false;
	}
</script>

{#if canFeature}
	<!-- Above the stretched-link overlay (z-20, the escape hatch the uploader
	     link uses) so it wins the click instead of opening the video. Hidden
	     until the card is hovered or the button itself is focused, and inert
	     while hidden so an invisible star can't be clicked; that means no
	     control on touch, which the Featured tab on /admin covers. Filled =
	     featured. -->
	<button
		type="button"
		onclick={toggle}
		disabled={saving}
		aria-pressed={featured}
		aria-label={featured ? "Remove from featured" : "Feature this video"}
		title={featured ? "Remove from featured" : "Feature this video"}
		class="pointer-events-none relative z-20 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-tan-hover focus-visible:pointer-events-auto focus-visible:opacity-100 disabled:opacity-50 group-hover:pointer-events-auto group-hover:opacity-100 {featured
			? 'text-orange'
			: 'text-tan'}"
	>
		<StarMark class="h-4 w-4" filled={featured} />
	</button>
{/if}
