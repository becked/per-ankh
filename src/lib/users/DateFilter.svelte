<script lang="ts">
	// Save-date filter for the user library. Wraps bits-ui's DatePicker so it
	// matches the dark filter chrome (same border/bg/text as the nation and
	// result selects). The URL `?date` param is the source of truth: `value`
	// is the resolved YYYY-MM-DD string (or null) and `onChange` writes it back.
	import { DatePicker } from "bits-ui";
	import { type DateValue, parseDate } from "@internationalized/date";

	let {
		value,
		onChange,
	}: {
		value: string | null;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onChange: (value: string | null) => void;
	} = $props();

	const selected = $derived<DateValue | undefined>(
		value ? parseDate(value) : undefined,
	);
</script>

<DatePicker.Root
	locale="en-CA"
	weekdayFormat="short"
	fixedWeeks
	value={selected}
	onValueChange={(v) => onChange(v ? v.toString() : null)}
>
	<div
		class="flex w-full items-center gap-1 rounded border border-black bg-[#35302b] px-2 py-1.5 text-xs text-tan"
	>
		<DatePicker.Input class="flex flex-1 items-center">
			{#snippet children({ segments })}
				{#each segments as segment, i (i)}
					{#if segment.part === "literal"}
						<span class="text-tan/50 px-0.5">{segment.value}</span>
					{:else}
						<DatePicker.Segment
							part={segment.part}
							class="data-[placeholder]:text-tan/40 rounded px-0.5 tabular-nums focus:bg-orange focus:text-black focus:outline-none"
						>
							{segment.value}
						</DatePicker.Segment>
					{/if}
				{/each}
			{/snippet}
		</DatePicker.Input>

		{#if value}
			<button
				type="button"
				class="text-tan/60 rounded px-1 leading-none hover:text-orange"
				aria-label="Clear date filter"
				onclick={() => onChange(null)}
			>
				×
			</button>
		{/if}

		<DatePicker.Trigger
			class="text-tan/70 flex items-center rounded px-0.5 hover:text-orange"
			aria-label="Open calendar"
		>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<rect x="3" y="4" width="18" height="18" rx="2" />
				<path d="M16 2v4M8 2v4M3 10h18" />
			</svg>
		</DatePicker.Trigger>
	</div>

	<DatePicker.Content sideOffset={6} class="z-50">
		<DatePicker.Calendar
			class="rounded-lg border border-[#2a2622] bg-[#241f1b] p-3 shadow-lg"
		>
			{#snippet children({ months, weekdays })}
				<DatePicker.Header class="mb-2 flex items-center justify-between">
					<DatePicker.PrevButton
						class="rounded px-2 py-1 text-tan hover:bg-[#35302B]"
					>
						‹
					</DatePicker.PrevButton>
					<DatePicker.Heading class="text-xs font-bold text-tan" />
					<DatePicker.NextButton
						class="rounded px-2 py-1 text-tan hover:bg-[#35302B]"
					>
						›
					</DatePicker.NextButton>
				</DatePicker.Header>

				{#each months as month (month.value)}
					<DatePicker.Grid class="w-full border-collapse select-none">
						<DatePicker.GridHead>
							<DatePicker.GridRow class="flex">
								{#each weekdays as day (day)}
									<DatePicker.HeadCell
										class="text-tan/50 w-8 text-center text-[10px] font-bold uppercase"
									>
										{day.slice(0, 2)}
									</DatePicker.HeadCell>
								{/each}
							</DatePicker.GridRow>
						</DatePicker.GridHead>
						<DatePicker.GridBody>
							{#each month.weeks as weekDates (weekDates)}
								<DatePicker.GridRow class="flex w-full">
									{#each weekDates as date (date)}
										<DatePicker.Cell {date} month={month.value} class="p-0">
											<DatePicker.Day
												class="data-[outside-month]:text-tan/30 flex h-8 w-8 items-center justify-center rounded text-xs text-tan hover:bg-[#35302B] data-[selected]:bg-orange data-[selected]:font-bold data-[selected]:text-black data-[today]:underline data-[disabled]:opacity-30"
											/>
										</DatePicker.Cell>
									{/each}
								</DatePicker.GridRow>
							{/each}
						</DatePicker.GridBody>
					</DatePicker.Grid>
				{/each}
			{/snippet}
		</DatePicker.Calendar>
	</DatePicker.Content>
</DatePicker.Root>
