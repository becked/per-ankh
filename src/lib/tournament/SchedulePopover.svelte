<script lang="ts">
	// Per-match scheduling form, opened as a nested popover off the "Schedule"
	// button in the match popover footer. Lets a tournament admin or either
	// participant set the match's scheduled time (UTC), stream link, and caster.
	// Styled to mirror the match popover (surface frame, surface-raised header
	// bar, surface-raised body card). Self-contained: owns its own busy/toast/invalidate
	// cycle, so the parent only decides whether to render it.
	import {
		cloudApi,
		type TournamentDetail,
		type TournamentMatch,
		type UserSearchResult,
	} from "$lib/api-cloud";
	import Popover from "$lib/ui/Popover.svelte";
	import { runAction } from "$lib/tournament/async-action";
	import FormFooter from "$lib/tournament/FormFooter.svelte";
	import UserAutocomplete from "./UserAutocomplete.svelte";
	import { DatePicker, TimeField } from "bits-ui";
	import {
		CalendarDateTime,
		now,
		parseAbsolute,
		Time,
		toCalendarDate,
		type DateValue,
	} from "@internationalized/date";

	let {
		match,
		tournament,
	}: {
		match: TournamentMatch;
		tournament: TournamentDetail;
	} = $props();

	let open = $state(false);
	let busy = $state(false);

	// Mirror of the Worker's StreamUrlSchema host allow-list (cloud schema is the
	// real gate; this just surfaces the error inline before Save).
	const STREAM_HOSTS = new Set([
		"youtube.com",
		"www.youtube.com",
		"m.youtube.com",
		"youtu.be",
		"twitch.tv",
		"www.twitch.tv",
		"m.twitch.tv",
	]);
	function isValidStreamUrl(s: string): boolean {
		const trimmed = s.trim();
		if (!trimmed) return true; // empty clears the stream — allowed
		try {
			return STREAM_HOSTS.has(new URL(trimmed).hostname.toLowerCase());
		} catch {
			return false;
		}
	}

	// Date and time are independent controls (a date-only calendar + a TimeField)
	// so picking a calendar day never changes the entered time. Both are treated
	// as UTC and recombined into the stored instant on save; localization later.
	let calendarOpen = $state(false);
	let fieldEl = $state<HTMLElement>();
	const nowUtc = now("UTC");
	const datePlaceholder = toCalendarDate(nowUtc);
	const timePlaceholder = new Time(nowUtc.hour, nowUtc.minute);

	// Form state — seeded from the match each time the popover opens (see
	// reset()), so an invalidateAll from elsewhere can't clobber an in-progress
	// edit and reopening always starts from the persisted values.
	let dateValue = $state<DateValue | undefined>(undefined);
	let timeValue = $state<Time | undefined>(undefined);
	let streamValue = $state("");
	// Caster, modeled like a slot occupant: casterUserId links a Per-Ankh user
	// (set only via the autocomplete dropdown), casterValue is the visible text.
	// casterLinkedName is the username the current link corresponds to — typing
	// away from it drops the link so the save goes out as free text.
	let casterValue = $state("");
	let casterUserId = $state<string | null>(null);
	let casterLinkedName = $state<string | null>(null);

	const streamError = $derived(
		isValidStreamUrl(streamValue)
			? null
			: "Enter a youtube.com or twitch.tv link",
	);

	function reset() {
		if (match.scheduled_at) {
			const z = parseAbsolute(match.scheduled_at, "UTC");
			dateValue = toCalendarDate(z);
			timeValue = new Time(z.hour, z.minute);
		} else {
			dateValue = undefined;
			timeValue = undefined;
		}
		streamValue = match.stream_url ?? "";
		casterValue = match.caster_name ?? "";
		casterUserId = match.caster_user_id;
		casterLinkedName = match.caster_user_id
			? (match.caster_name ?? null)
			: null;
		calendarOpen = false;
	}

	function onCasterValueChange(next: string) {
		casterValue = next;
		// Editing away from the linked handle forgets the link → free text.
		if (casterUserId !== null && next !== casterLinkedName) {
			casterUserId = null;
			casterLinkedName = null;
		}
	}

	function onCasterSelectUser(user: UserSearchResult | null) {
		casterUserId = user?.user_id ?? null;
		casterLinkedName = user?.discord_username ?? null;
	}

	function scheduledToIso(): string | null {
		// A date is required for a schedule; time defaults to midnight if cleared.
		if (!dateValue) return null;
		const t = timeValue ?? new Time(0, 0);
		const dt = new CalendarDateTime(
			dateValue.year,
			dateValue.month,
			dateValue.day,
			t.hour,
			t.minute,
		);
		return dt.toDate("UTC").toISOString();
	}

	async function save() {
		const ok = await runAction(
			() =>
				cloudApi.patchMatchSchedule(tournament.tournament_id, match.match_id, {
					scheduled_at: scheduledToIso(),
					stream_url: streamValue.trim() ? streamValue.trim() : null,
					caster_user_id: casterUserId,
					caster_name: casterValue.trim() ? casterValue.trim() : null,
				}),
			{ setBusy: (b) => (busy = b), success: "Schedule updated" },
		);
		if (ok !== null) open = false;
	}
</script>

<Popover
	bind:open
	onOpenChange={(o) => {
		if (o) reset();
	}}
	side="bottom"
	align="start"
	contentClass="w-[min(92vw,24rem)]"
	frameClass="bg-surface p-3 shadow-[0_24px_64px_-12px_rgb(var(--color-black)/0.85)]"
	ariaLabel="Schedule match"
>
	{#snippet trigger({ props })}
		<button
			{...props}
			type="button"
			class="inline-flex items-center gap-1.5 rounded border border-input px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-3.5 w-3.5"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<rect x="3" y="4" width="18" height="18" rx="2" />
				<path d="M16 2v4M8 2v4M3 10h18" />
			</svg>
			Schedule
		</button>
	{/snippet}

	<!-- Header bar mirrors the match popover's: a surface-raised rounded bar carrying
	     the title with a close affordance on the right. -->
	<header
		class="mb-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<h2 class="text-lg font-bold text-tan">Schedule match</h2>
		<button
			type="button"
			class="text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
			onclick={() => (open = false)}
			aria-label="Close"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-5 w-5"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M6 18L18 6M6 6l12 12"
				/>
			</svg>
		</button>
	</header>

	<div
		class="flex flex-col gap-3 rounded-lg p-3 text-xs text-tan"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<!-- Scheduled time (UTC): a date-only themed calendar plus a separate
		     TimeField. They're independent, so choosing a calendar day leaves the
		     time untouched. -->
		<div class="flex flex-col gap-1">
			<span class="opacity-70">Scheduled time</span>
			<div class="flex flex-wrap items-center gap-2">
				<DatePicker.Root
					bind:open={calendarOpen}
					locale="en-CA"
					weekdayFormat="short"
					fixedWeeks
					granularity="day"
					bind:value={dateValue}
					placeholder={datePlaceholder}
				>
					<div>
						<!-- Field-chrome click opens the calendar; segment + button clicks
						     are excluded so typing/clearing still works. -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							bind:this={fieldEl}
							class="flex items-center gap-1 rounded border border-input bg-surface p-1.5 text-tan focus-within:border-input-focus"
							onclick={(e) => {
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
											<span class="px-0.5 text-tan/50">{segment.value}</span>
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

							{#if dateValue}
								<button
									type="button"
									class="rounded px-1 leading-none text-tan/60 hover:text-tan"
									aria-label="Clear scheduled date"
									onclick={(e) => {
										e.stopPropagation();
										dateValue = undefined;
										timeValue = undefined;
									}}
								>
									×
								</button>
							{/if}
						</div>

						<DatePicker.Content
							customAnchor={fieldEl}
							side="bottom"
							align="start"
							sideOffset={6}
							class="z-50"
						>
							<DatePicker.Calendar
								class="rounded-lg border border-surface bg-surface-sunken p-3 shadow-lg"
							>
								{#snippet children({ months, weekdays })}
									<DatePicker.Header
										class="mb-2 flex items-center justify-between"
									>
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
					</div>
				</DatePicker.Root>

				<TimeField.Root
					locale="en-CA"
					granularity="minute"
					hourCycle={24}
					value={timeValue}
					placeholder={timePlaceholder}
					onValueChange={(v) => (timeValue = v instanceof Time ? v : undefined)}
				>
					<TimeField.Input
						class="flex items-center gap-0.5 rounded border border-input bg-surface p-1.5 text-tan focus-within:border-input-focus"
					>
						{#snippet children({ segments })}
							{#each segments as segment, i (i)}
								{#if segment.part === "literal"}
									<span class="text-tan/50">{segment.value}</span>
								{:else}
									<TimeField.Segment
										part={segment.part}
										class="rounded px-0.5 tabular-nums focus:bg-input-focus focus:text-tan focus:outline-none data-[placeholder]:text-tan/40"
									>
										{segment.value}
									</TimeField.Segment>
								{/if}
							{/each}
						{/snippet}
					</TimeField.Input>
				</TimeField.Root>

				<span class="text-[11px] uppercase text-tan/60">UTC</span>
			</div>
		</div>

		<!-- Caster. Pick a Per-Ankh user (links the account) or type a free-text
		     name. Clearing the field removes the caster. -->
		<div class="flex flex-col gap-1">
			<span class="opacity-70">Caster</span>
			<UserAutocomplete
				value={casterValue}
				onValueChange={onCasterValueChange}
				onSelectUser={onCasterSelectUser}
				disabled={busy}
				inputClass="border border-black bg-surface"
			/>
		</div>

		<!-- Stream link. Restricted to youtube/twitch (server is the real gate;
		     streamError surfaces it inline). -->
		<label class="flex flex-col gap-1">
			<span class="opacity-70">Stream</span>
			<input
				type="url"
				bind:value={streamValue}
				disabled={busy}
				class="block w-full rounded border border-black bg-surface p-1.5 text-xs text-tan"
				autocomplete="off"
			/>
			{#if streamError}
				<span class="text-[10px] text-red-400">{streamError}</span>
			{/if}
		</label>

		<FormFooter
			class="pt-1"
			onCancel={() => (open = false)}
			onConfirm={save}
			confirmLabel="Save"
			{busy}
			confirmDisabled={busy || streamError !== null}
		/>
	</div>
</Popover>
