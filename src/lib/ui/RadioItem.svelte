<script lang="ts">
	// The styled radio indicator (dot) only — drop it inside a caller's <label>
	// card. Must be rendered within a <RadioGroup> (bits-ui RadioGroup.Root),
	// which owns the selected value.
	import { RadioGroup } from "bits-ui";

	let {
		value,
		disabled = false,
		ariaLabel,
		class: klass = "",
	}: {
		value: string;
		disabled?: boolean;
		ariaLabel?: string;
		class?: string;
	} = $props();
</script>

<RadioGroup.Item
	{value}
	{disabled}
	aria-label={ariaLabel}
	class="grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 border-tan bg-transparent transition-colors hover:border-orange disabled:hover:border-tan data-[state=checked]:border-orange {klass}"
>
	{#snippet children({ checked })}
		{#if checked}<span class="h-2 w-2 rounded-full bg-orange"></span>{/if}
	{/snippet}
</RadioGroup.Item>
