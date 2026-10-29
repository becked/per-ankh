<script lang="ts">
	// The multi-select every data-tab filter column opens: grouped options over
	// the owning table's `filters` array, which it binds directly. A caller owns
	// its own value prefixes (`player:`, `logtype:`, `kind:`, `nation:`) and the
	// chips `TableFilterColumn` renders from them; the control itself — the dark
	// trigger, the portal list, the orange check on a selected item — lives here
	// once.
	//
	// Grouped rather than flat because a column usually offers two kinds of
	// option at once: players and log types on the event log, players and pin
	// kinds on the map pins. A group with no options is dropped, so a heading
	// never stands over an empty list and the divider lands on the first group
	// that renders rather than on a fixed one.
	//
	// `$lib/ui/Select.svelte` is the single-select sibling and speaks the same
	// `SelectGroup` shape; its styling is the form-sized one, this the filter
	// column's.
	import { Select } from "bits-ui";
	import type { SelectGroup } from "$lib/ui/types";

	let {
		groups,
		value = $bindable<string[]>([]),
		label = "Filter",
	}: {
		groups: readonly SelectGroup[];
		value?: string[];
		label?: string;
	} = $props();

	const shownGroups = $derived(groups.filter((g) => g.options.length > 0));
</script>

<Select.Root type="multiple" bind:value>
	<Select.Trigger
		class="flex w-full cursor-pointer items-center justify-between rounded border border-black bg-surface-raised px-2 py-1.5 text-xs text-tan"
	>
		<span class="truncate">{label}</span>
		<span class="ml-2 text-tan opacity-60">▼</span>
	</Select.Trigger>
	<Select.Portal>
		<Select.Content
			class="z-50 max-h-64 overflow-y-auto rounded bg-surface-sunken shadow-lg"
		>
			<Select.Viewport>
				{#each shownGroups as group, i (group.heading)}
					<Select.Group>
						<Select.GroupHeading
							class="border-b border-surface px-3 py-2 text-xs font-bold uppercase tracking-wide text-tan {i >
							0
								? 'border-t border-surface'
								: ''}"
						>
							{group.heading}
						</Select.GroupHeading>
						{#each group.options as option (option.value)}
							<Select.Item
								value={option.value}
								label={option.label}
								class="flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan hover:bg-surface-raised data-[highlighted]:bg-surface-raised"
							>
								{#snippet children({ selected })}
									{option.label}
									{#if selected}
										<span class="font-bold text-orange">✓</span>
									{/if}
								{/snippet}
							</Select.Item>
						{/each}
					</Select.Group>
				{/each}
			</Select.Viewport>
		</Select.Content>
	</Select.Portal>
</Select.Root>
