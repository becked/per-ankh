<script lang="ts">
	// Shared nation multi-select for the data-tab filter columns. Binds the
	// owning table's `filters` array directly; emits `nation:<NATION_*>` values
	// and renders matching chips elsewhere. Styled as a games-table dark select.
	import { Select } from "bits-ui";
	import { formatEnum } from "$lib/utils/formatting";

	let {
		nations,
		value = $bindable<string[]>([]),
		label = "Filter",
		heading = "Nations",
	}: {
		nations: string[];
		value?: string[];
		label?: string;
		heading?: string;
	} = $props();
</script>

<Select.Root type="multiple" bind:value>
	<Select.Trigger
		class="flex w-full cursor-pointer items-center justify-between rounded border border-black bg-[#35302b] px-2 py-1.5 text-xs text-tan"
	>
		<span class="truncate">{label}</span>
		<span class="ml-2 text-tan opacity-60">▼</span>
	</Select.Trigger>
	<Select.Portal>
		<Select.Content
			class="z-50 max-h-64 overflow-y-auto rounded bg-[#241f1b] shadow-lg"
		>
			<Select.Viewport>
				{#if nations.length > 0}
					<Select.Group>
						<Select.GroupHeading
							class="border-b border-[#2a2622] px-3 py-2 text-xs font-bold uppercase tracking-wide text-tan"
						>
							{heading}
						</Select.GroupHeading>
						{#each nations as nation (nation)}
							<Select.Item
								value={`nation:${nation}`}
								label={formatEnum(nation, "NATION_")}
								class="flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-tan hover:bg-[#35302b] data-[highlighted]:bg-[#35302b]"
							>
								{#snippet children({ selected })}
									{formatEnum(nation, "NATION_")}
									{#if selected}
										<span class="font-bold text-orange">✓</span>
									{/if}
								{/snippet}
							</Select.Item>
						{/each}
					</Select.Group>
				{/if}
			</Select.Viewport>
		</Select.Content>
	</Select.Portal>
</Select.Root>
