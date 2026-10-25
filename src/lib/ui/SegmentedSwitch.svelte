<script module lang="ts">
	export interface SegmentedItem {
		key: string;
		label: string;
		// Appended after the label, dimmed — a bucket's row count. Omit where
		// the label is the whole story.
		count?: number;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	// The app's in-page segmented switch: an equal-column grid of buttons with
	// a raised-surface thumb that slides under the active one. The sibling of
	// SegmentedNav, which is the same shape for cross-route LINKS; this one
	// toggles a view of the route you are already on, so its items are buttons
	// carrying aria-pressed rather than anchors carrying aria-current.
	//
	// It was hand-rolled in five places before it was one component: game
	// detail's science and empire switches, the tournament matches page's view
	// toggle and the stats page's status switch, and the /players board switch.
	// The sixth copy — the stats catalog's Leaders band switch — is the one that
	// paid for the extraction. The thumb is the sole active indicator and the
	// label text stays tan in every state.
	//
	// Still not this component: the tournament overview's Championship and
	// division toggles. Those are bits-ui `Tabs.List`/`Tabs.Trigger` inside a
	// `Tabs.Root` that also owns the fading panel beneath them, so the lit rail
	// there is markup on a tablist, not a group of buttons — converting them
	// would mean rebuilding their panel switching to win back thirty lines.

	let {
		items,
		value,
		onChange,
		ariaLabel,
		borderShade = "surface",
		itemClass = "",
		class: klass = "",
	}: {
		items: SegmentedItem[];
		// The active item's key. `null` parks the thumb hidden while leaving
		// every button unpressed — which is a real state, not a defensive
		// branch: the matches page's Calendar button lives outside this control
		// and none of these reads as pressed while it is open.
		value: string | null;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onChange: (key: string) => void;
		ariaLabel: string;
		// Which rung of the surface ladder the edge sits on, decided by what the
		// control sits ON: `sunken` against a bg-surface card (the game-detail
		// chart panels), `surface` against anything raised or page-level.
		borderShade?: "surface" | "sunken";
		// Per-item extras — in practice a min-width, which keeps the thumb from
		// resizing under the pointer when the labels differ in length.
		itemClass?: string;
		// Container extras: margins, and the width/justify the caller's layout
		// needs (`w-fit` where it hugs its labels).
		class?: string;
	} = $props();

	const activeIndex = $derived(items.findIndex((i) => i.key === value));
</script>

<div
	class="relative grid overflow-hidden rounded-lg border-2 bg-surface {borderShade ===
	'sunken'
		? 'border-surface-sunken'
		: 'border-surface'} {klass}"
	style:grid-template-columns={`repeat(${items.length}, minmax(0, 1fr))`}
	role="group"
	aria-label={ariaLabel}
>
	<div
		class="pointer-events-none absolute inset-y-0 left-0 bg-surface-raised transition-transform duration-200 ease-out"
		style:width={`${100 / items.length}%`}
		style:opacity={activeIndex < 0 ? "0" : "1"}
		style:transform={`translateX(${(activeIndex < 0 ? 0 : activeIndex) * 100}%)`}
	></div>
	{#each items as item (item.key)}
		<button
			type="button"
			class="relative z-10 cursor-pointer whitespace-nowrap px-3 py-1.5 text-center text-xs font-bold text-tan transition-colors disabled:cursor-default disabled:opacity-50 {itemClass}"
			aria-pressed={item.key === value}
			disabled={item.disabled}
			onclick={() => onChange(item.key)}
		>
			{item.label}
			{#if item.count != null}
				<span class="ml-1 opacity-60">{item.count}</span>
			{/if}
		</button>
	{/each}
</div>
