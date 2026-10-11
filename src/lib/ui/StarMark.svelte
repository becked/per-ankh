<script lang="ts">
	// The "featured" star, in its two states — the glyph behind every control
	// that puts something on the home page: FeaturedStar (a video) and the
	// admin star on a screenshot tile (ScreenshotGallery). Shared for
	// CheckMark's and CopyMark's reason: two hand-pasted copies of one path,
	// which happened to agree and had nothing keeping them that way.
	//
	// `filled` is what says the thing IS featured, so it is the whole state the
	// icon carries — the outline alone is the offer, the filled star the fact.
	// Sized by the caller (`class`) and coloured by `currentColor`: the button
	// it sits in decides both, and names itself, so this is decorative.
	let {
		class: className = "h-3.5 w-3.5",
		filled = false,
	}: { class?: string; filled?: boolean } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	class={className}
	viewBox="0 0 24 24"
	fill={filled ? "currentColor" : "none"}
	stroke="currentColor"
	stroke-width="1.5"
	aria-hidden="true"
>
	<path
		stroke-linecap="round"
		stroke-linejoin="round"
		d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"
	/>
</svg>
