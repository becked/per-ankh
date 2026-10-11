<script lang="ts">
	// The control both featuring toggles are: a glyph on a video card that flips
	// one set and reports nothing back — FeaturedStar (the site-wide set, admins
	// only) and FeaturedPin (a creator's own, on their profile's Videos tab).
	//
	// The two differ in four things, which are the props below: who may press it,
	// what it says, which glyph it draws, and which set it writes. Everything else
	// — the hover reveal, the stacking above the card's stretched link, the
	// in-flight guard — was the same in both, as two copies of one button.
	import type { Snippet } from "svelte";

	let {
		canToggle,
		featured,
		label,
		onToggle,
		children,
	}: {
		// Renders nothing when false, so either control can be placed on a list of
		// cards without the surface knowing who is looking.
		canToggle: boolean;
		// Whether the video is in the set this control writes — `aria-pressed`, and
		// the colour that goes with the caller's filled glyph.
		featured: boolean;
		// What the button says in this state, as both the accessible name and the
		// tooltip, so a pointer and a screen reader are told the same thing.
		label: string;
		// Flip the set. Both callers' writes are optimistic and revert themselves
		// on failure (featured-videos.svelte.ts), so there is nothing to hand back.
		onToggle: () => Promise<void>;
		// The glyph, filled by the caller from the same `featured`.
		children: Snippet;
	} = $props();

	let saving = $state(false);

	async function toggle() {
		if (saving) return;
		saving = true;
		await onToggle();
		saving = false;
	}
</script>

{#if canToggle}
	<!-- Above the stretched-link overlay (z-20, the escape hatch the uploader
	     link uses) so it wins the click instead of opening the video. Hidden
	     until the card is hovered or the button itself is focused, and inert
	     while hidden so an invisible control can't be clicked; that means no
	     control on touch, which each set's Featured tab covers. -->
	<button
		type="button"
		onclick={toggle}
		disabled={saving}
		aria-pressed={featured}
		aria-label={label}
		title={label}
		class="pointer-events-none relative z-20 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-tan-hover focus-visible:pointer-events-auto focus-visible:opacity-100 disabled:opacity-50 group-hover:pointer-events-auto group-hover:opacity-100 {featured
			? 'text-orange'
			: 'text-tan'}"
	>
		{@render children()}
	</button>
{/if}
