<script lang="ts">
	// Shared styled single-select (wraps bits-ui Select). Replaces native
	// <select>. Styling matches the existing bits-ui Select usages
	// (NationSelect / NationFilterSelect): dark trigger, portal content, orange
	// check on the selected item.
	//
	// bits-ui single Select is string-typed, so the empty/placeholder value is
	// mapped to `null` at the onChange boundary (via `placeholderValue`). For
	// the "add an item then clear" pattern (e.g. add-map-script pickers), set
	// `resetAfterSelect`: the trigger snaps back to the placeholder after each
	// pick. The reset is deferred (tick) so it doesn't fight bits-ui's commit.
	import { Select } from "bits-ui";
	import { tick, type Snippet } from "svelte";
	import {
		type SelectOption,
		type SelectOptions,
		isSelectGroup,
	} from "./types";

	let {
		value,
		onChange,
		options,
		placeholder = "Select…",
		placeholderValue = "",
		disabled = false,
		ariaLabel,
		class: klass = "",
		resetAfterSelect = false,
		icon,
		matchTriggerWidth = false,
		compact = false,
	}: {
		value: string;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onChange: (value: string | null) => void;
		options: SelectOptions;
		placeholder?: string;
		placeholderValue?: string;
		disabled?: boolean;
		ariaLabel?: string;
		class?: string;
		resetAfterSelect?: boolean;
		// Leading glyph for an option, taking its value — rendered in the
		// trigger for the current selection and beside each item in the list.
		icon?: Snippet<[string]>;
		// For a caller that stretches the trigger (`w-full`), hold the list to
		// the trigger's width instead of letting it shrink to its own items.
		// bits-ui measures the trigger onto the content as
		// --bits-select-anchor-width. A floor rather than a fixed width, so a
		// label longer than the trigger still widens the list rather than
		// truncating in it.
		matchTriggerWidth?: boolean;
		// The tighter trigger the map chrome's panels are built at, against
		// the form-sized default. A named size rather than padding passed
		// through `class`, because two padding utilities in one class
		// attribute are decided by Tailwind's emission order and not by the
		// order they are written in — `px-2` is emitted after `px-1.5`, so a
		// caller's override loses to the default it meant to replace.
		compact?: boolean;
	} = $props();

	// Writable derived: tracks the parent's `value`, but stays reassignable so
	// a selection (bind:value) or a post-pick reset can override it until the
	// parent's `value` next changes.
	let current = $derived(value);

	const flat = $derived(
		(
			options as (SelectOption | { heading: string; options: SelectOption[] })[]
		).flatMap((o) => (isSelectGroup(o) ? o.options : [o])),
	);
	const selectedLabel = $derived(
		flat.find((o) => o.value === current)?.label ?? placeholder,
	);
	const isPlaceholder = $derived(current === placeholderValue);

	function handleChange(next: string): void {
		current = next;
		onChange(next === placeholderValue ? null : next);
		if (resetAfterSelect) {
			void tick().then(() => {
				current = "";
			});
		}
	}
</script>

<Select.Root
	type="single"
	bind:value={current}
	onValueChange={handleChange}
	{disabled}
>
	<Select.Trigger
		aria-label={ariaLabel}
		class="flex cursor-pointer items-center justify-between gap-2 rounded border border-black bg-surface-raised text-tan disabled:opacity-50 {compact
			? 'px-1.5 py-0.5 text-[11px]'
			: 'px-2 py-1.5 text-xs'} {klass}"
	>
		<span
			class="flex min-w-0 items-center gap-1.5 {isPlaceholder
				? 'opacity-60'
				: ''}"
		>
			{#if icon}{@render icon(current)}{/if}
			<span class="truncate">{selectedLabel}</span>
		</span>
		<span class="ml-2 text-tan opacity-60">▼</span>
	</Select.Trigger>
	<Select.Portal>
		<Select.Content
			class="z-50 max-h-72 overflow-y-auto rounded-lg border border-surface bg-surface-sunken shadow-lg {matchTriggerWidth
				? 'min-w-[var(--bits-select-anchor-width)]'
				: ''}"
		>
			<Select.Viewport>
				{#each options as entry (isSelectGroup(entry) ? entry.heading : entry.value)}
					{#if isSelectGroup(entry)}
						<Select.Group>
							<Select.GroupHeading
								class="border-b border-surface px-3 py-2 text-xs font-bold uppercase tracking-wide text-tan"
							>
								{entry.heading}
							</Select.GroupHeading>
							{#each entry.options as opt (opt.value)}
								{@render item(opt)}
							{/each}
						</Select.Group>
					{:else}
						{@render item(entry)}
					{/if}
				{/each}
			</Select.Viewport>
		</Select.Content>
	</Select.Portal>
</Select.Root>

{#snippet item(opt: SelectOption)}
	<Select.Item
		value={opt.value}
		label={opt.label}
		disabled={opt.disabled}
		class="flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm text-tan data-[disabled]:cursor-default data-[highlighted]:bg-surface-raised data-[disabled]:opacity-40"
	>
		{#snippet children({ selected })}
			<span class="flex min-w-0 items-center gap-1.5">
				{#if icon}{@render icon(opt.value)}{/if}
				<span class="truncate">{opt.label}</span>
			</span>
			{#if selected}<span class="text-orange">✓</span>{/if}
		{/snippet}
	</Select.Item>
{/snippet}
