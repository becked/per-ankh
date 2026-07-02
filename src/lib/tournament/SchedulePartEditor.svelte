<script lang="ts" module>
	import type { DateValue } from "@internationalized/date";
	import { Time } from "@internationalized/date";

	// One stream row in the editor. Kept as plain strings (label "" = untagged);
	// the popover trims + drops empties on save.
	export interface EditStream {
		url: string;
		label: string;
	}

	// One caster row in the editor. Mirrors the slot occupant model: userId links
	// an account, value is the visible text, linkedName is the name the current
	// link corresponds to (typing away from it drops the link → free text).
	export interface EditCaster {
		value: string;
		userId: string | null;
		linkedName: string | null;
	}

	// One part's editable state. id is present for a persisted part and absent
	// for a freshly added one (the server mints it). date/time are independent
	// controls entered in the viewer's own timezone and recombined into the
	// stored UTC instant on save; casters are ordered (index 0 = the streamer,
	// the rest co-casters).
	export interface EditPart {
		id?: string;
		date: DateValue | undefined;
		time: Time | undefined;
		casters: EditCaster[];
		streams: EditStream[];
	}

	// Mirror of the Worker's StreamUrlSchema host allow-list. The cloud schema is
	// the real gate; this surfaces the error inline before Save.
	const STREAM_HOSTS = new Set([
		"youtube.com",
		"www.youtube.com",
		"m.youtube.com",
		"youtu.be",
		"twitch.tv",
		"www.twitch.tv",
		"m.twitch.tv",
	]);
	export function isValidStreamUrl(s: string): boolean {
		const trimmed = s.trim();
		if (!trimmed) return true; // empty is dropped on save — allowed
		try {
			return STREAM_HOSTS.has(new URL(trimmed).hostname.toLowerCase());
		} catch {
			return false;
		}
	}
</script>

<script lang="ts">
	// One part's controls inside the schedule popover: a scheduled time entered
	// in the editor's OWN timezone (the popover converts to/from the stored UTC
	// instant), a caster, and a list of stream links. Mutates the passed-in EditPart
	// in place (the popover owns the parts array as $state, so field writes
	// propagate through the reactive proxy).
	import type { UserSearchResult } from "$lib/api-cloud";
	import UserAutocomplete from "./UserAutocomplete.svelte";
	import {
		formatRelativeToNow,
		formatScheduledUtc,
	} from "$lib/utils/formatting";
	import { DatePicker, TimeField } from "bits-ui";
	import {
		getLocalTimeZone,
		now,
		toCalendarDate,
	} from "@internationalized/date";
	import { partToIso } from "$lib/tournament/parts";

	let {
		part,
		index,
		count,
		busy,
		onRemove,
	}: {
		part: EditPart;
		index: number;
		count: number;
		busy: boolean;
		onRemove: () => void;
	} = $props();

	let calendarOpen = $state(false);
	let fieldEl = $state<HTMLElement>();
	// Times are entered/displayed in the viewer's own zone; the popover stores
	// the resulting UTC instant, so a match reads correctly in everyone's zone.
	const tz = getLocalTimeZone();
	const nowLocal = now(tz);
	const datePlaceholder = toCalendarDate(nowLocal);
	const timePlaceholder = new Time(nowLocal.hour, nowLocal.minute);

	// Short zone name (e.g. "PDT") for the field label — resolved for the entered
	// date so a summer match reads "PDT" and a winter one "PST".
	const tzLabel = $derived.by(() => {
		const base = part.date ? part.date.toDate(tz) : nowLocal.toDate();
		return (
			new Intl.DateTimeFormat(undefined, {
				timeZone: tz,
				timeZoneName: "short",
			})
				.formatToParts(base)
				.find((p) => p.type === "timeZoneName")?.value ?? tz
		);
	});

	// The stored UTC instant the entered local date/time maps to, so the editor
	// can confirm the canonical time + countdown as it's typed. Null until a date
	// is picked (time defaults to midnight, mirroring the popover's save).
	const previewIso = $derived.by(() => partToIso(part.date, part.time, tz));

	function onCasterValueChange(ci: number, next: string) {
		const c = part.casters[ci];
		c.value = next;
		// Editing away from the linked name forgets the link → free text.
		if (c.userId !== null && next !== c.linkedName) {
			c.userId = null;
			c.linkedName = null;
		}
	}
	function onCasterSelectUser(ci: number, user: UserSearchResult | null) {
		const c = part.casters[ci];
		c.userId = user?.user_id ?? null;
		c.linkedName = user?.display_name ?? null;
	}
</script>

<div
	class="flex flex-col gap-3 rounded-lg p-3 text-xs text-tan"
	style="background-color: rgb(var(--color-surface-raised));"
>
	<!-- Part header + remove. The "Part N" label only matters once a match is
	     split, but showing it always keeps the multi-part layout legible. -->
	<div class="flex items-center justify-between">
		<span class="text-[10px] font-bold uppercase tracking-wider text-muted">
			Part {index + 1}
		</span>
		{#if count > 1}
			<button
				type="button"
				class="rounded px-1.5 py-0.5 text-[11px] text-tan/60 hover:text-red-400"
				onclick={onRemove}
				disabled={busy}
			>
				Remove part
			</button>
		{/if}
	</div>

	<!-- Scheduled time, entered in the viewer's own timezone: a date-only themed
	     calendar plus a separate TimeField. They're independent, so choosing a
	     calendar day leaves the time untouched. A preview line confirms the
	     canonical UTC instant + countdown the local time maps to. -->
	<div class="flex flex-col gap-1">
		<span class="opacity-70"
			>Scheduled time <span class="text-tan/40">({tzLabel})</span></span
		>
		<div class="flex flex-wrap items-center gap-2">
			<DatePicker.Root
				bind:open={calendarOpen}
				locale="en-CA"
				weekdayFormat="short"
				fixedWeeks
				granularity="day"
				bind:value={part.date}
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

						{#if part.date}
							<button
								type="button"
								class="rounded px-1 leading-none text-tan/60 hover:text-tan"
								aria-label="Clear scheduled date"
								onclick={(e) => {
									e.stopPropagation();
									part.date = undefined;
									part.time = undefined;
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
				value={part.time}
				placeholder={timePlaceholder}
				onValueChange={(v) => (part.time = v instanceof Time ? v : undefined)}
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

			<span class="text-[11px] uppercase text-tan/60">{tzLabel}</span>
		</div>
		{#if previewIso}
			<span class="text-[11px] text-tan/60">
				= {formatScheduledUtc(previewIso)} UTC · {formatRelativeToNow(
					previewIso,
				)}
			</span>
		{/if}
	</div>

	<!-- Casters. The first is the streamer; add co-casters below. Each row picks a
	     Per-Ankh user (links the account) or takes a free-text name; clearing it
	     drops that caster on save. -->
	<div class="flex flex-col gap-1.5">
		<span class="opacity-70">Casters</span>
		{#each part.casters as caster, ci (ci)}
			<div class="flex items-center gap-1.5">
				<span class="w-16 shrink-0 text-[10px] uppercase text-tan/50">
					{ci === 0 ? "Streamer" : "Co-cast"}
				</span>
				<div class="min-w-0 flex-1">
					<UserAutocomplete
						value={caster.value}
						onValueChange={(v) => onCasterValueChange(ci, v)}
						onSelectUser={(u) => onCasterSelectUser(ci, u)}
						disabled={busy}
						inputClass="border border-black bg-surface"
					/>
				</div>
				{#if part.casters.length > 1}
					<button
						type="button"
						class="shrink-0 rounded px-1.5 text-tan/60 hover:text-red-400"
						aria-label="Remove caster"
						onclick={() => part.casters.splice(ci, 1)}
						disabled={busy}
					>
						×
					</button>
				{/if}
			</div>
		{/each}
		<button
			type="button"
			class="self-start rounded border border-input px-2 py-1 text-[11px] text-tan/80 hover:border-orange hover:text-orange"
			onclick={() =>
				part.casters.push({ value: "", userId: null, linkedName: null })}
			disabled={busy}
		>
			+ Add co-caster
		</button>
	</div>

	<!-- stream links. Multiple per part (each player's POV, the cast). Restricted to
	     youtube/twitch (server is the real gate); the optional label distinguishes
	     them ("alcaras POV", "Cast"). -->
	<div class="flex flex-col gap-1.5">
		<span class="opacity-70">Streams</span>
		{#each part.streams as stream, vi (vi)}
			{@const streamError = !isValidStreamUrl(stream.url)}
			<div class="flex flex-col gap-1">
				<div class="flex items-center gap-1.5">
					<input
						type="url"
						bind:value={stream.url}
						disabled={busy}
						class="block w-full rounded border border-black bg-surface p-1.5 text-xs text-tan"
						autocomplete="off"
					/>
					<input
						type="text"
						bind:value={stream.label}
						disabled={busy}
						class="block w-32 shrink-0 rounded border border-black bg-surface p-1.5 text-xs text-tan"
						autocomplete="off"
					/>
					<button
						type="button"
						class="shrink-0 rounded px-1.5 text-tan/60 hover:text-red-400"
						aria-label="Remove stream"
						onclick={() => part.streams.splice(vi, 1)}
						disabled={busy}
					>
						×
					</button>
				</div>
				{#if streamError}
					<span class="text-[10px] text-red-400"
						>Enter a youtube.com or twitch.tv link</span
					>
				{/if}
			</div>
		{/each}
		<button
			type="button"
			class="self-start rounded border border-input px-2 py-1 text-[11px] text-tan/80 hover:border-orange hover:text-orange"
			onclick={() => part.streams.push({ url: "", label: "" })}
			disabled={busy}
		>
			+ Add stream
		</button>
	</div>
</div>
