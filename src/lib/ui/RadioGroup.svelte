<script lang="ts">
	// Shared styled radio group (wraps bits-ui RadioGroup.Root). Owns the
	// selected value; callers place <RadioItem> (the styled dot) inside their
	// own <label> cards so rich content is preserved. bits-ui RadioGroup is
	// string-only — non-string call sites map at the boundary (e.g. a sentinel
	// string for an "observer"/null choice).
	import { RadioGroup } from "bits-ui";
	import type { Snippet } from "svelte";

	let {
		value = $bindable(""),
		onChange,
		disabled = false,
		ariaLabel,
		class: klass = "",
		children,
	}: {
		value?: string;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onChange?: (value: string) => void;
		disabled?: boolean;
		ariaLabel?: string;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<RadioGroup.Root
	bind:value
	onValueChange={onChange}
	{disabled}
	aria-label={ariaLabel}
	class={klass}
>
	{@render children()}
</RadioGroup.Root>
