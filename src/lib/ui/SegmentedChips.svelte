<script lang="ts" generics="K extends string">
	// The app's thumbless segmented group: compact items that light by filling
	// to `surface-raised`, with no sliding thumb behind them. The lighter of
	// the two segmented shapes, and the one to reach for where the control sits
	// inside a row of other inputs rather than heading a panel — SegmentedSwitch
	// is heavier on purpose and reads as the thing the panel is switched by.
	//
	// Hand-rolled three times before this, with the item tokens copied between
	// them: game detail's Specialists kind filter, which is now this
	// component's one consumer, and the two Per Turn / Cumulative toggles in
	// YieldsTab and YieldsStatsPanel, which still carry their own markup — each
	// is a group inside a wider toolbar rather than a control of its own, and
	// the stats one's toolbar holds two more multi-select groups on the same
	// tokens. Those tokens are TOGGLE_ITEM_CLASS, read from $lib/ui/classes by
	// all three, so the shape has one definition even where the markup does
	// not.
	//
	// Unlike SegmentedSwitch, the lit item can be toggled back off. bits-ui
	// reports that as the empty string and this hands back `null`, which is
	// the state a caller needs where the group is a shortcut for a value that
	// can also be entered some other way.
	import { ToggleGroup } from "bits-ui";
	import { TOGGLE_ITEM_CLASS } from "./classes";

	let {
		items,
		value,
		onChange,
		ariaLabel,
		class: klass = "",
	}: {
		items: Array<{ key: K; label: string }>;
		// The lit item, or null for none lit.
		value: K | null;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onChange: (key: K | null) => void;
		ariaLabel: string;
		// Container extras: the margins and width the caller's row needs.
		class?: string;
	} = $props();
</script>

<ToggleGroup.Root
	type="single"
	value={value ?? ""}
	onValueChange={(v: string) => onChange(v === "" ? null : (v as K))}
	class="flex w-fit overflow-hidden rounded border border-black {klass}"
	aria-label={ariaLabel}
>
	{#each items as item, i (item.key)}
		<ToggleGroup.Item
			value={item.key}
			class="{i === 0 ? 'rounded-l' : ''} {i === items.length - 1
				? 'rounded-r'
				: ''} {TOGGLE_ITEM_CLASS}"
		>
			{item.label}
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>
