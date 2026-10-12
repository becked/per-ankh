<script lang="ts">
	// A control's name, on hover and on focus, for a button whose glyph is its
	// only markup. MapChrome's tab cluster already makes the case — "a glyph
	// alone doesn't say which tab it opens, and the native title's delay and OS
	// styling read as outside the chrome" — and `title` has a second problem it
	// doesn't name: a touch pointer never raises one at all, and a keyboard
	// never does either.
	//
	// Wraps bits-ui Tooltip the way Popover.svelte beside it wraps bits-ui
	// Popover, and for the same reason: the Provider/Root/Trigger/Portal/Content
	// block had three hand-written copies before this one. It covers the
	// short-label case only — the icon button — and leaves those three where
	// they are: MapYieldStrip and TechComparison hang whole panels off a
	// tooltip, and MapChrome's is the same shape as this but dressed in
	// CHROME_PANEL_CLASS, which belongs to the map's own chrome.
	//
	// The trigger is bits-ui's own <button> rather than a `trigger` snippet as
	// Popover takes, because a tooltip's props carry an `onclick` that dismisses
	// it: a caller spreading them onto its own button would have to chain that
	// handler with its own, at every call site. Passing `class` / `onclick` /
	// `disabled` through to Tooltip.Trigger instead hands the chaining to
	// bits-ui's own mergeProps. `disabled` reaches the rendered button, so a
	// disabled control still refuses the click as well as the tooltip.
	//
	// Composes with another bits-ui trigger — the camera in GameActions is this
	// and a Dialog.Trigger at once. mergeProps chains the two `onclick`s and
	// keeps both ref attachments (each is a distinct symbol key), and the
	// dialog reads its `triggerId` off the mounted element rather than from the
	// prop this one wins, so spreading the other trigger's props in is enough.
	import { Tooltip } from "bits-ui";
	import type { Snippet } from "svelte";

	// bits-ui's own trigger props, rather than svelte/elements'
	// HTMLButtonAttributes: the two disagree on `id` (bits-ui won't take null)
	// and intersecting 450 button attributes with this produces a union
	// svelte-check calls too complex to represent. `child` goes because the
	// glyph arrives as this component's children and renders into the
	// trigger's own slot — a caller passing both would silently lose one.
	let {
		label,
		children,
		...rest
	}: Omit<Tooltip.TriggerProps, "child" | "children"> & {
		// What the control is called. A name, not an explanation — one line,
		// and the same words the surface it opens uses for itself.
		label: string;
		// The glyph.
		children: Snippet;
	} = $props();
</script>

<Tooltip.Provider delayDuration={200} disableHoverableContent>
	<Tooltip.Root>
		<Tooltip.Trigger {...rest}>
			{@render children()}
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<!-- TechComparison's tooltip chrome, which is the one the app already
			     wears off the map: a `blue-gray` panel on a raised-surface rule.
			     Tightened to a single line's padding — this holds two words, not
			     a table. -->
			<Tooltip.Content
				side="bottom"
				sideOffset={6}
				class="z-50 rounded-lg border-2 border-surface-raised bg-blue-gray px-2 py-1 text-xs font-semibold text-tan shadow-lg"
			>
				{label}
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
</Tooltip.Provider>
