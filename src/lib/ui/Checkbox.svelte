<script lang="ts">
	// Shared styled checkbox (wraps bits-ui Checkbox.Root). Replaces native
	// checkboxes and the older scoped `.themed-checkbox` / `.marker-toggle`
	// CSS — single source of truth for the look: tan border, orange fill when
	// checked, dark check glyph. Supports both `bind:checked` and one-way
	// `checked` + `onCheckedChange` (optimistic-commit) usages.
	//
	// When given `children` (or `label`), it owns the surrounding <label> so
	// the whole row is clickable (box first, then content). bits-ui only emits
	// a hidden form input when a `name` is set, so wrapping the box in an
	// external <label> wouldn't reliably toggle it — hence the component owns
	// the label itself. With no content it renders just the clickable box.
	import { Checkbox } from "bits-ui";
	import type { Snippet } from "svelte";

	let {
		checked = $bindable(false),
		onCheckedChange,
		disabled = false,
		label,
		ariaLabel,
		class: klass = "",
		labelClass = "",
		children,
	}: {
		checked?: boolean;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onCheckedChange?: (checked: boolean) => void;
		disabled?: boolean;
		label?: string;
		ariaLabel?: string;
		class?: string;
		labelClass?: string;
		children?: Snippet;
	} = $props();
</script>

{#snippet box()}
	<Checkbox.Root
		bind:checked
		{onCheckedChange}
		{disabled}
		aria-label={ariaLabel ?? label}
		class="relative grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border-2 border-tan bg-transparent transition-colors hover:border-orange disabled:hover:border-tan data-[state=checked]:border-orange data-[state=checked]:bg-orange {klass}"
	>
		{#if checked}
			<svg
				viewBox="0 0 12 12"
				class="h-3 w-3 text-[#1a1a1a]"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				aria-hidden="true"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M2.5 6.5l2.5 2.5 4.5-5.5"
				/>
			</svg>
		{/if}
	</Checkbox.Root>
{/snippet}

{#if children || label}
	<label
		class="inline-flex items-center gap-2 {disabled
			? 'cursor-default opacity-50'
			: 'cursor-pointer'} {labelClass}"
	>
		{@render box()}
		{#if children}{@render children()}{:else}<span class="text-sm text-tan"
				>{label}</span
			>{/if}
	</label>
{:else}
	{@render box()}
{/if}
