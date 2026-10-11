<script lang="ts">
	// The "pinned" pin, in its two states — the glyph behind FeaturedPin, the
	// control that puts one of a creator's own videos at the top of their
	// profile's Videos tab. A file of its own for StarMark's reason: a glyph
	// hand-pasted into the control that draws it is a path nothing keeps in one
	// place.
	//
	// `filled` is what says the video IS pinned, so it is the whole state the icon
	// carries — the outline alone is the offer, the filled pin the fact. Sized by
	// the caller (`class`) and coloured by `currentColor`: the button it sits in
	// decides both, and names itself, so this is decorative.
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
	<path stroke-linecap="round" stroke-linejoin="round" d="M12 17v5" />
	<path
		stroke-linecap="round"
		stroke-linejoin="round"
		d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"
	/>
</svg>
