<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { DatePicker } from "bits-ui";
	import {
		type DateValue,
		parseAbsolute,
		today,
		toCalendarDate,
	} from "@internationalized/date";
	import {
		ApiError,
		cloudApi,
		type PatchTournamentBody,
		type TournamentDetail,
	} from "$lib/api-cloud";
	import { toast } from "$lib/ui/toast";
	import TournamentLinksEditor from "./TournamentLinksEditor.svelte";

	interface Props {
		tournament: TournamentDetail;
	}

	let { tournament }: Props = $props();

	// svelte-ignore state_referenced_locally
	let name = $state(tournament.name);
	// svelte-ignore state_referenced_locally
	let description = $state(tournament.description ?? "");
	// svelte-ignore state_referenced_locally
	let divisionAName = $state(tournament.division_a_name);
	// svelte-ignore state_referenced_locally
	let divisionBName = $state(tournament.division_b_name);

	// Scheduled start, entered and displayed as a UTC calendar date. starts_at
	// is stored as a full ISO-8601 instant for column-type consistency; we treat
	// the date as midnight UTC on the chosen day (the standard pattern for a
	// date-only field backed by a timestamp column). Controlled value —
	// onValueChange writes straight back through the same PATCH path.
	const startsAt = $derived<DateValue | undefined>(
		tournament.starts_at
			? toCalendarDate(parseAbsolute(tournament.starts_at, "UTC"))
			: undefined,
	);
	// Seeds the empty-state segment layout and the calendar's initial month.
	const startsAtPlaceholder = today("UTC");
	let calendarOpen = $state(false);
	// The whole field is the popup's anchor (via DatePicker.Content's
	// customAnchor) so the calendar drops below and centers under the field
	// rather than under the small trigger icon at its left edge.
	let fieldEl = $state<HTMLDivElement | null>(null);

	function commitStartsAt(value: DateValue | undefined) {
		// CalendarDate.toDate("UTC") → JS Date at midnight UTC on that day.
		const next = value ? value.toDate("UTC").toISOString() : null;
		if (next === tournament.starts_at) return;
		commit({ starts_at: next });
	}

	async function commit(patch: PatchTournamentBody) {
		if (Object.keys(patch).length === 0) return;
		try {
			await cloudApi.patchTournament(tournament.tournament_id, patch);
			await invalidateAll();
			toast.info("Saved");
		} catch (err) {
			let message = "Save failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
		}
	}

	function commitName() {
		const trimmed = name.trim();
		if (!trimmed) {
			name = tournament.name; // empty name not allowed — revert
			return;
		}
		if (trimmed === tournament.name) return;
		commit({ name: trimmed });
	}

	function commitDescription() {
		const next = description.trim() || null;
		if (next === tournament.description) return;
		commit({ description: next });
	}

	function commitDivisionA() {
		const trimmed = divisionAName.trim();
		if (!trimmed) {
			divisionAName = tournament.division_a_name;
			return;
		}
		if (trimmed === tournament.division_a_name) return;
		commit({ division_a_name: trimmed });
	}

	function commitDivisionB() {
		const trimmed = divisionBName.trim();
		if (!trimmed) {
			divisionBName = tournament.division_b_name;
			return;
		}
		if (trimmed === tournament.division_b_name) return;
		commit({ division_b_name: trimmed });
	}
</script>

<section
	class="mb-6 rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<h2 class="mb-3 text-sm font-bold text-tan">Overview</h2>

	<div class="flex flex-col gap-3 text-xs text-tan">
		<label class="flex flex-col gap-1">
			<span>Name</span>
			<input
				type="text"
				bind:value={name}
				onblur={commitName}
				class="rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none"
			/>
		</label>

		<label class="flex flex-col gap-1">
			<span>Description</span>
			<textarea
				bind:value={description}
				onblur={commitDescription}
				rows="2"
				class="rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none"
			></textarea>
		</label>

		<div class="flex flex-col gap-1">
			<span>Scheduled start</span>
			<DatePicker.Root
				bind:open={calendarOpen}
				locale="en-CA"
				weekdayFormat="short"
				fixedWeeks
				value={startsAt}
				placeholder={startsAtPlaceholder}
				onValueChange={commitStartsAt}
			>
				<!-- Clicking the field chrome opens the calendar; clicking a segment
				(role=spinbutton) edits it instead, so typing the time still works. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					bind:this={fieldEl}
					class="flex items-center gap-1 rounded border border-input bg-surface-raised p-1.5 text-tan focus-within:border-input-focus"
					onclick={(e) => {
						// Open on field-chrome clicks. Exclude the segments (spinbuttons —
						// let them take focus to edit) and the trigger/clear buttons (they
						// manage open state themselves).
						const t = e.target as HTMLElement;
						if (!t.closest("button") && !t.closest('[role="spinbutton"]')) {
							calendarOpen = true;
						}
					}}
				>
					<DatePicker.Trigger
						class="flex items-center rounded px-0.5 text-tan/70 hover:text-tan"
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

					<DatePicker.Input class="flex items-center">
						{#snippet children({ segments })}
							{#each segments as segment, i (i)}
								{#if segment.part === "literal"}
									<span class="px-0.5 text-tan/50"
										>{segment.value.replace(/-/g, "/").replace(/,/g, "")}</span
									>
								{:else}
									<DatePicker.Segment
										part={segment.part}
										class="rounded px-0.5 tabular-nums focus:bg-input-focus focus:text-tan focus:outline-none data-[placeholder]:text-tan/40"
									>
										{segment.value}
									</DatePicker.Segment>
								{/if}
							{/each}
						{/snippet}
					</DatePicker.Input>

					<span class="px-0.5 text-[11px] uppercase text-tan/60">UTC</span>

					{#if startsAt}
						<button
							type="button"
							class="ml-auto rounded px-1 leading-none text-tan/60 hover:text-tan"
							aria-label="Clear scheduled start"
							onclick={(e) => {
								e.stopPropagation();
								commitStartsAt(undefined);
							}}
						>
							×
						</button>
					{/if}
				</div>

				<DatePicker.Content
					customAnchor={fieldEl}
					side="bottom"
					align="center"
					sideOffset={6}
					class="z-50"
				>
					<DatePicker.Calendar
						class="rounded-lg border border-surface bg-surface-sunken p-3 shadow-lg"
					>
						{#snippet children({ months, weekdays })}
							<DatePicker.Header class="mb-2 flex items-center justify-between">
								<DatePicker.PrevButton
									class="rounded px-2 py-1 text-tan hover:bg-surface-raised"
								>
									‹
								</DatePicker.PrevButton>
								<DatePicker.Heading class="text-xs font-bold text-tan" />
								<DatePicker.NextButton
									class="rounded px-2 py-1 text-tan hover:bg-surface-raised"
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
													class="w-8 text-center text-[10px] font-bold uppercase text-tan/50"
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
													<DatePicker.Cell
														{date}
														month={month.value}
														class="p-0"
													>
														<DatePicker.Day
															class="flex h-8 w-8 items-center justify-center rounded text-xs text-tan hover:bg-surface-raised data-[selected]:bg-input-focus data-[selected]:font-bold data-[outside-month]:text-tan/30 data-[selected]:text-tan data-[today]:underline data-[disabled]:opacity-30"
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
		</div>

		<label class="flex flex-col gap-1">
			<span>Division A name</span>
			<input
				type="text"
				bind:value={divisionAName}
				onblur={commitDivisionA}
				class="rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none"
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span>Division B name</span>
			<input
				type="text"
				bind:value={divisionBName}
				onblur={commitDivisionB}
				class="rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none"
			/>
		</label>

		<TournamentLinksEditor {tournament} />
	</div>
</section>
