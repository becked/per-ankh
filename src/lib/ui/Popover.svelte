<script lang="ts">
	// Shared styled popover (wraps bits-ui Popover). Replaces the hand-rolled
	// `fixed inset-0 z-50` modal overlays the tournament surface used to carry —
	// non-blocking, anchored to its trigger, dismissed by click-outside + Escape.
	// Theme mirrors the other $lib/ui wrappers (blue-gray surface, black border).
	//
	// Two usage modes:
	//   1. Trigger-anchored (the common case): pass a `trigger` snippet and bind
	//      `open` (or leave it — the trigger toggles the internal state). The
	//      content floats off the trigger element.
	//   2. Externally-anchored: omit `trigger`, control `open` from the parent,
	//      and pass `customAnchor` (a selector string or element). Used by the
	//      match popover, whose trigger is a bracket cell rendered elsewhere.
	import { Popover } from "bits-ui";
	import type { Snippet } from "svelte";

	type Side = "top" | "right" | "bottom" | "left";
	type Align = "start" | "center" | "end";
	// A floating-ui "virtual" anchor — anything exposing getBoundingClientRect.
	// Lets callers anchor to a point (e.g. the mouse position) rather than a DOM
	// element. Mirrors bits-ui's customAnchor, which accepts this same shape.
	type Measurable = { getBoundingClientRect: () => DOMRect };

	let {
		open = $bindable(false),
		side = "bottom",
		align = "end",
		sideOffset = 8,
		customAnchor = null,
		contentClass = "w-[min(92vw,28rem)]",
		frameClass = "border-4 border-[#35302B] bg-blue-gray p-5 shadow-lg",
		ariaLabel,
		onOpenChange,
		trigger,
		children,
	}: {
		open?: boolean;
		side?: Side;
		align?: Align;
		sideOffset?: number;
		customAnchor?: string | HTMLElement | Measurable | null;
		// Width / size override for the floating panel. The surface, rounding,
		// scroll, and shadow are fixed; width varies per use.
		contentClass?: string;
		// Border, surface background, padding, and shadow of the floating panel.
		// Defaults to the standard dark frame; callers can drop the border,
		// recolor the surface, thin the padding, or deepen the shadow (e.g. the
		// match popover, whose own header bar already frames the content).
		frameClass?: string;
		ariaLabel?: string;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onOpenChange?: (open: boolean) => void;
		// Receives bits-ui's trigger props to spread onto the caller's own button
		// element, so existing trigger markup/styling is preserved verbatim.
		trigger?: Snippet<[{ props: Record<string, unknown> }]>;
		children: Snippet;
	} = $props();
</script>

<Popover.Root bind:open {onOpenChange}>
	{#if trigger}
		<Popover.Trigger>
			{#snippet child({ props })}
				{@render trigger({ props })}
			{/snippet}
		</Popover.Trigger>
	{/if}
	<Popover.Portal>
		<Popover.Content
			{side}
			{align}
			{sideOffset}
			{customAnchor}
			aria-label={ariaLabel}
			class="z-50 max-h-[85vh] overflow-y-auto rounded-lg text-tan {frameClass} {contentClass}"
		>
			{@render children()}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
