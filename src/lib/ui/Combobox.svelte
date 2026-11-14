<script lang="ts">
	// Shared styled single-select with a type-to-filter input (wraps bits-ui
	// Combobox). `Select`'s sibling, and the one to reach for when the list is
	// long enough that scrolling it is the wrong way to find a value — the
	// explore surface's filter-value pickers, where a tech roster is 49 entries
	// and a law roster 30-odd.
	//
	// Same props and same chrome as Select, down to the trigger's border and
	// the orange check on the selected item, so the two read as one control in
	// a row that holds both. The differences are the ones the input forces:
	//
	//   * bits-ui filters nothing for you. The input's text is read off its
	//     `oninput` into `search`, and this component is what narrows
	//     `options` by it (case-insensitive substring on the LABEL, which is
	//     what is on screen — matching the zType would mean typing
	//     "FAMILYCLASS_" to find Landowners). `inputValue` on the root is not
	//     that text: it is declared non-bindable, a way to push a value INTO
	//     the input rather than to read one out.
	//   * The input is the list's anchor and the thing you read, so
	//     `placeholder` is its placeholder where Select's is trigger text — and
	//     an `icon` reaches the list items only, where Select's also sits in the
	//     trigger. There is nowhere in a text box to put the current value's
	//     picture, and a picker that resets after each pick has no current value
	//     to draw one for.
	//   * Typing opens the list (bits-ui's own input onkeydown does it); the
	//     trigger beside it opens it without typing, which is what keeps the
	//     control usable as a plain dropdown.
	//
	// Groups are deliberately absent. Select carries them because the nation
	// pickers need headings; nothing that filters does, and a heading whose
	// group has been filtered to nothing is a row that says nothing.
	import { Combobox } from "bits-ui";
	import { tick, type Snippet } from "svelte";
	import type { SelectOption } from "./types";

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
		matchTriggerWidth = false,
		compact = false,
		icon,
	}: {
		value: string;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onChange: (value: string | null) => void;
		options: readonly SelectOption[];
		placeholder?: string;
		placeholderValue?: string;
		disabled?: boolean;
		ariaLabel?: string;
		class?: string;
		// For the "add an item then clear" pattern (the filter-value pickers):
		// the input and the selection both snap back after each pick, so the
		// next value is typed into an empty box rather than over the last one.
		resetAfterSelect?: boolean;
		// Hold the list to the trigger's width instead of letting it shrink to
		// its own items. A floor, not a fixed width.
		matchTriggerWidth?: boolean;
		compact?: boolean;
		// A picture for one option, as Select's `icon` is, rendered ahead of the
		// label. In the list only, where Select also puts it in the trigger: the
		// trigger here is the text input, and the pickers that pass an icon pass
		// `resetAfterSelect` with it, so that box is empty after every pick.
		icon?: Snippet<[string]>;
	} = $props();

	// Writable derived, as Select's is: tracks the parent's `value` but stays
	// reassignable so a selection or a post-pick reset can override it until
	// the parent's `value` next changes.
	let current = $derived(value);
	// The filter text, kept in step with the input by its own `oninput`. Only
	// ever read here — what the input SHOWS is bits-ui's to write, which is how
	// a pick puts the chosen label in the box.
	let search = $state("");

	const needle = $derived(search.trim().toLowerCase());
	const shown = $derived(
		needle === ""
			? options
			: options.filter((o) => o.label.toLowerCase().includes(needle)),
	);

	function handleChange(next: string): void {
		current = next;
		onChange(next === placeholderValue ? null : next);
		if (resetAfterSelect) {
			// Deferred so it doesn't fight bits-ui's own commit, which writes
			// the picked label into the input. Clearing `current` is also what
			// empties the box: `clearOnDeselect` on the Input blanks it when the
			// selection goes back to "", which is the only handle on the input's
			// text from out here.
			void tick().then(() => {
				current = "";
				search = "";
			});
		}
	}

	const CHROME =
		"flex items-center justify-between gap-2 rounded border border-black bg-surface-raised text-tan";
	const SIZE = $derived(
		compact ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1.5 text-xs",
	);
</script>

<Combobox.Root
	type="single"
	bind:value={current}
	onValueChange={handleChange}
	{disabled}
>
	<div class="{CHROME} {SIZE} {klass} {disabled ? 'opacity-50' : ''}">
		<Combobox.Input
			aria-label={ariaLabel}
			{placeholder}
			clearOnDeselect
			oninput={(e) => (search = e.currentTarget.value)}
			class="min-w-0 flex-1 bg-transparent text-tan placeholder:text-tan placeholder:opacity-60 focus:outline-none"
		/>
		<Combobox.Trigger
			aria-label={ariaLabel === undefined
				? undefined
				: `${ariaLabel} — show all`}
			class="cursor-pointer text-tan opacity-60">▼</Combobox.Trigger
		>
	</div>
	<Combobox.Portal>
		<Combobox.Content
			class="z-50 max-h-72 overflow-y-auto rounded-lg border border-surface bg-surface-sunken shadow-lg {matchTriggerWidth
				? 'min-w-[var(--bits-combobox-anchor-width)]'
				: ''}"
		>
			<Combobox.Viewport>
				{#each shown as opt (opt.value)}
					<Combobox.Item
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
					</Combobox.Item>
				{/each}
				{#if shown.length === 0}
					<!-- Said rather than left blank: an empty popover under a box
					     you are typing into reads as a control that broke. -->
					<p class="px-3 py-1.5 text-sm italic text-tan opacity-70">No match</p>
				{/if}
			</Combobox.Viewport>
		</Combobox.Content>
	</Combobox.Portal>
</Combobox.Root>
