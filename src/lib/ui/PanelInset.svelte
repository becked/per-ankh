<script lang="ts">
	// The recessed box inside a Panel: the step below the panel's `surface`
	// that a list or a preview sits in, so a panel reads as a tray with things
	// on it rather than one flat box. The home page's insets are all this one —
	// the featured tile's standings and schedule, the stats lists, the tools
	// links.
	//
	// The label is the inset's own heading — `h3`, under the panel's `h2` — and
	// it is optional: an inset that is its panel's only child is already named
	// by the heading above it. A control that acts on the inset as a whole goes
	// in `action`, at the right end of that heading row.
	import type { Snippet } from "svelte";

	let {
		label,
		icon,
		action,
		overArt = false,
		class: className = "",
		children,
	}: {
		label?: string;
		// Optional glyph before the label (typically a <SpriteIcon size={14} />),
		// smaller than a row icon so it reads as the inset's marker rather than
		// as its first entry.
		icon?: Snippet;
		// Optional control at the right end of the heading row — the button that
		// adds a row to the inset's own list, kept out of the list it adds to.
		action?: Snippet;
		// Nearly opaque rather than opaque, for an inset sitting on a tile's
		// backdrop art: the art is the tile's backdrop, not a texture behind the
		// inset's rows, and at any less the still's lit half fights the text in
		// front of it. What shows the picture is the space around the inset, not
		// what bleeds through it. A boolean rather than a `bg-` class from the
		// caller, because two `bg-surface-deep` rules resolve by stylesheet order
		// and not by the order they are written in the attribute.
		overArt?: boolean;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<div
	class="rounded-lg p-2 {overArt
		? 'bg-surface-deep/90'
		: 'bg-surface-deep'} {className}"
>
	{#if label || action}
		<div class="mb-1 flex items-center justify-between gap-2">
			{#if label}
				<h3
					class="flex items-center gap-1.5 text-[10px] font-bold uppercase text-gray-400"
				>
					{@render icon?.()}
					{label}
				</h3>
			{/if}
			{@render action?.()}
		</div>
	{/if}
	{@render children()}
</div>
