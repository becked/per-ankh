<script lang="ts">
	// One value's picture, in a box that is the same width whether the picture
	// arrived or not.
	//
	// The box is the point. A column whose vocabulary has icons reserves this
	// width in every row of that column, so the labels keep one left edge even
	// where a value ships no art — the tech bonus cards, and the "Not recorded"
	// row every value column can return. A column whose vocabulary has no icons
	// at all renders none of these and reserves nothing.
	//
	// Drawn as a plain <img>, which is what the sprite URLs and the Discord CDN
	// URLs have in common: `Vocabulary.icon` hands over a resolved path, not a
	// (category, zType) pair, so one component covers both.

	let {
		src,
		size = 16,
		// A circular crop, for the one vocabulary whose icons are photographs of
		// people: an account's Discord avatar, which every other avatar on the
		// site draws round (PlayerAvatar, the header, a save card).
		round = false,
		alt = "",
	}: {
		src: string | null;
		size?: number;
		round?: boolean;
		alt?: string;
	} = $props();
</script>

<span
	class="inline-flex shrink-0 items-center justify-center"
	style="width: {size}px; height: {size}px;"
>
	{#if src}
		<img
			{src}
			{alt}
			width={size}
			height={size}
			class={round ? "rounded-full object-cover" : ""}
			style="width: {size}px; height: {size}px;"
		/>
	{/if}
</span>
