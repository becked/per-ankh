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
	import type { Measurable } from "$lib/ui/types";

	type Side = "top" | "right" | "bottom" | "left";
	type Align = "start" | "center" | "end";
	type InteractOutsideBehavior =
		"close" | "defer-otherwise-close" | "defer-otherwise-ignore" | "ignore";

	let {
		open = $bindable(false),
		side = "bottom",
		align = "end",
		sideOffset = 8,
		customAnchor = null,
		updatePositionStrategy = "optimized",
		interactOutsideBehavior = "close",
		contentClass = "w-[min(92vw,28rem)]",
		frameClass = "border-4 border-surface-raised bg-blue-gray p-5 shadow-lg",
		ariaLabel,
		autoFocus = true,
		onOpenChange,
		onpointerenter,
		onpointerleave,
		oncontextmenu,
		trigger,
		children,
	}: {
		open?: boolean;
		side?: Side;
		align?: Align;
		sideOffset?: number;
		customAnchor?: string | HTMLElement | Measurable | null;
		// How often the floating panel re-measures its anchor. bits-ui's
		// default only recomputes on scroll/resize; "always" re-measures every
		// animation frame, which the map's popovers need — their anchor moves
		// with a pan or a zoom, neither of which fires either event.
		updatePositionStrategy?: "optimized" | "always";
		// What an outside interaction does to the panel. bits-ui's default
		// closes it, which is right for a panel the page is meant to dismiss.
		// "ignore" holds it open, for one that outlives what goes on behind
		// it — the map's LOCKED city card, where a pan begins with a
		// pointerdown on the canvas and the default took the card down at the
		// start of every drag. Escape closes it either way.
		interactOutsideBehavior?: InteractOutsideBehavior;
		// Width / size override for the floating panel. The surface, rounding,
		// scroll, and shadow are fixed; width varies per use.
		contentClass?: string;
		// Border, surface background, padding, and shadow of the floating panel.
		// Defaults to the standard dark frame; callers can drop the border,
		// recolor the surface, thin the padding, or deepen the shadow (e.g. the
		// match popover, whose own header bar already frames the content).
		frameClass?: string;
		ariaLabel?: string;
		// Whether opening moves focus into the panel. True is right for a
		// panel a click or a keypress asked for. A panel the POINTER opens
		// passes false: taking focus there would pull it off whatever the
		// keyboard was on, and where the anchor's own focus is what opens the
		// panel, the two chase each other — focus in, anchor blurs, panel
		// closes, focus returns, panel opens. With it false nothing moves, so
		// there is nothing to restore on close either.
		autoFocus?: boolean;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onOpenChange?: (open: boolean) => void;
		// Pointer crossings on the panel itself, for a caller that opens on
		// hover: the panel is the far side of the gap the pointer travels, so
		// it has to be able to hold its own open.
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onpointerenter?: (event: PointerEvent) => void;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onpointerleave?: (event: PointerEvent) => void;
		// A right-click on the panel, for a caller that floats one over a
		// surface with a contextmenu handler of its own: the panel is
		// rendered on `document.body`, so that handler doesn't cover it and
		// the browser's menu opens over the surface.
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		oncontextmenu?: (event: MouseEvent) => void;
		// Receives bits-ui's trigger props to spread onto the caller's own button
		// element, so existing trigger markup/styling is preserved verbatim.
		trigger?: Snippet<[{ props: Record<string, unknown> }]>;
		children: Snippet;
	} = $props();

	// Focus return on close, minus the scroll jump. bits-ui restores focus to
	// whatever was focused before the popover opened, calling `.focus()` with no
	// `preventScroll` (focus-scope.svelte.js #handleCloseAutoFocus). When that
	// element sits off-screen the browser drags its scroll container back to it
	// — and because the close fires on pointerdown, the page moves mid-click and
	// `click` never lands on the element you aimed at. On the tournament page
	// that meant a second bracket cell opened nothing and snapped you back to
	// the first (#231). We take the restore over: same element, scroll
	// suppressed.
	let preFocused: HTMLElement | null = null;

	// Capture matches bits-ui's own: mount() registers the scope — snapshotting
	// document.activeElement — then fires onOpenAutoFocus synchronously, moving
	// focus only in a later frame. So activeElement here is still the element
	// bits-ui memorized, and there is no second source of truth to drift.
	function rememberPreFocus(): void {
		const active = document.activeElement;
		preFocused =
			active instanceof HTMLElement && active !== document.body ? active : null;
	}

	function restorePreFocus(event: Event): void {
		event.preventDefault();
		const el = preFocused;
		preFocused = null; // don't pin a detached node
		if (el && document.contains(el)) el.focus({ preventScroll: true });
	}

	function handleOpenAutoFocus(event: Event): void {
		if (!autoFocus) {
			event.preventDefault();
			return;
		}
		rememberPreFocus();
	}

	// Nothing was moved when `autoFocus` is false, so the close just stands
	// down rather than hauling focus back to an anchor the caller may have
	// tabbed away from.
	function handleCloseAutoFocus(event: Event): void {
		if (!autoFocus) {
			event.preventDefault();
			return;
		}
		restorePreFocus(event);
	}
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
			{updatePositionStrategy}
			{interactOutsideBehavior}
			onOpenAutoFocus={handleOpenAutoFocus}
			onCloseAutoFocus={handleCloseAutoFocus}
			{onpointerenter}
			{onpointerleave}
			{oncontextmenu}
			aria-label={ariaLabel}
			class="z-50 max-h-[85vh] overflow-y-auto rounded-lg text-tan {frameClass} {contentClass}"
		>
			{@render children()}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
