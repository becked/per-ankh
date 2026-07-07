<script lang="ts">
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import { UNCLAIMED_AVATAR_ICON } from "$lib/utils/avatars";

	// A player's Discord avatar, or — when the slot hasn't been claimed by a
	// logged-in user (avatarUrl is null) — the UNCLAIMED_AVATAR_ICON sprite as
	// an "unclaimed" stand-in. Sized via `size` (px) so callers can match the
	// surrounding text density (dense brackets vs. standings rows).
	let {
		avatarUrl,
		size = 16,
		alt = "",
	}: { avatarUrl: string | null; size?: number; alt?: string } = $props();
</script>

{#if avatarUrl}
	<img
		src={avatarUrl}
		{alt}
		class="shrink-0 rounded-full object-cover"
		style="width: {size}px; height: {size}px;"
		width={size}
		height={size}
	/>
{:else}
	<span
		class="inline-flex shrink-0 items-center justify-center"
		style="width: {size}px; height: {size}px;"
	>
		<SpriteIcon category="icons" value={UNCLAIMED_AVATAR_ICON} {size} {alt} />
	</span>
{/if}
