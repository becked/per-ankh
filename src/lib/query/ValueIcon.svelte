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
	//
	// One size, not a prop: every surface here draws a value at row-text size,
	// which is the box PlayerAvatar reserves in a standings row.
	const SIZE = 16;

	let {
		src,
		// A circular crop, for the one vocabulary whose icons are photographs of
		// people: an account's Discord avatar, which every other avatar on the
		// site draws round (PlayerAvatar, the header, a save card).
		round = false,
	}: {
		src: string | null;
		round?: boolean;
	} = $props();
</script>

<span
	class="inline-flex shrink-0 items-center justify-center"
	style="width: {SIZE}px; height: {SIZE}px;"
>
	{#if src}
		<img
			{src}
			alt=""
			width={SIZE}
			height={SIZE}
			class={round ? "rounded-full object-cover" : ""}
			style="width: {SIZE}px; height: {SIZE}px;"
		/>
	{/if}
</span>
