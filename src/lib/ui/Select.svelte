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
	import { tick } from "svelte";
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
		class="flex cursor-pointer items-center justify-between gap-2 rounded border border-black bg-[#35302b] px-2 py-1.5 text-xs text-tan disabled:opacity-50 {klass}"
	>
		<span class="truncate {isPlaceholder ? 'opacity-60' : ''}"
			>{selectedLabel}</span
		>
		<span class="ml-2 text-tan opacity-60">▼</span>
	</Select.Trigger>
	<Select.Portal>
		<Select.Content
			class="z-50 max-h-72 overflow-y-auto rounded-lg border border-[#2a2622] bg-[#241f1b] shadow-lg"
		>
			<Select.Viewport>
				{#each options as entry (isSelectGroup(entry) ? entry.heading : entry.value)}
					{#if isSelectGroup(entry)}
						<Select.Group>
							<Select.GroupHeading
								class="border-b border-[#2a2622] px-3 py-2 text-xs font-bold uppercase tracking-wide text-tan"
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
		class="flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm text-tan data-[disabled]:cursor-default data-[highlighted]:bg-[#35302B] data-[disabled]:opacity-40"
	>
		{#snippet children({ selected })}
			{opt.label}
			{#if selected}<span class="text-orange">✓</span>{/if}
		{/snippet}
	</Select.Item>
{/snippet}
