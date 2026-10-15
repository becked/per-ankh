<script lang="ts">
	// A control's name, on hover and on focus, for a button whose glyph is its
	// only markup. MapChrome's tab cluster already makes the case — "a glyph
	// alone doesn't say which tab it opens, and the native title's delay and OS
	// styling read as outside the chrome" — and `title` has a second problem it
	// doesn't name: a touch pointer never raises one at all, and a keyboard
	// never does either.
	//
	// Wraps bits-ui Tooltip the way Popover.svelte beside it wraps bits-ui
	// Popover, and for the same reason: the Root/Trigger/Portal/Content block
	// had four hand-written copies before this one. It covers the short-label
	// case only — the icon button — and leaves those four where they are:
	// MapYieldStrip, TechComparison and TechsTab hang a whole panel or a
	// paragraph off a tooltip, and MapChrome's is the same shape as this but
	// dressed in CHROME_PANEL_CLASS, which belongs to the map's own chrome.
	//
	// No Tooltip.Provider in here: the call site wraps the whole cluster in
	// one, as each of those four does. A provider is a group, and the group is
	// what two of bits-ui's behaviours are scoped to — `skipDelayDuration`,
	// which lets the next tooltip in it open without re-paying the delay, and
	// the close of whichever one in it is already open. Neither crosses a
	// provider boundary, so one provider per tooltip would make a row of icons
	// pay the full delay at every icon and let a focused trigger's tooltip and
	// a hovered trigger's tooltip stand at once. Tooltip.Root reads the
	// provider out of context and can't run without one.
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
		// What the control is called, and — since the glyph inside is
		// aria-hidden — the button's accessible name as well. A name, not an
		// explanation: one line, and the same words the surface it opens uses
		// for itself.
		label: string;
		// The glyph.
		children: Snippet;
	} = $props();
</script>

<Tooltip.Root>
	<!-- The label is also the name, through aria-label. All bits-ui wires is
	     aria-describedby, and only while the tooltip is open — a description,
	     which is not a name, so without this the button has none at all: AT
	     announces an unnamed button and voice control can't address it. Ahead
	     of {...rest}, so a caller can still pass its own. -->
	<Tooltip.Trigger aria-label={label} {...rest}>
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
