<script lang="ts">
	// Shared nation selector for the per-nation stats panels (Families, Opening
	// laws, Tech). Controlled: the parent owns the selected value and the option
	// list (typically the ALL_NATIONS sentinel followed by real nations) and
	// handles changes. Labels render via the shared nationLabel helper.
	//
	// Rendered as a sticky, left-aligned bar matching the Yields toolbar
	// (same chrome as the subtab chip bar), so it stays reachable while
	// scrolling the panel's chart stack. The `-ml-4` cancels Tabs.Content's
	// px-4 to align the bar flush with the tab bars above it.

	import { Select } from "bits-ui";
	import { nationLabel } from "./charts/helpers";

	let {
		value,
		options,
		onChange,
	}: {
		value: string;
		options: string[];
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onChange: (value: string) => void;
	} = $props();
</script>

<div
	class="sticky top-1 z-10 -ml-4 mb-4 flex w-fit items-center gap-2 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
>
	<Select.Root
		type="single"
		{value}
		onValueChange={onChange}
		items={options.map((n) => ({ value: n, label: nationLabel(n) }))}
	>
		<Select.Trigger
			class="flex items-center gap-2 rounded bg-surface-raised px-2.5 py-1 text-xs font-bold text-tan"
		>
			{nationLabel(value)}
			<span class="text-brown">▼</span>
		</Select.Trigger>
		<Select.Portal>
			<Select.Content
				class="z-50 max-h-72 overflow-y-auto rounded-lg border border-surface bg-surface-sunken shadow-lg"
			>
				<Select.Viewport>
					{#each options as n (n)}
						<Select.Item
							value={n}
							label={nationLabel(n)}
							class="flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm text-tan data-[highlighted]:bg-surface-raised"
						>
							{#snippet children({ selected })}
								{nationLabel(n)}
								{#if selected}<span class="text-orange">✓</span>{/if}
							{/snippet}
						</Select.Item>
					{/each}
				</Select.Viewport>
			</Select.Content>
		</Select.Portal>
	</Select.Root>
</div>
