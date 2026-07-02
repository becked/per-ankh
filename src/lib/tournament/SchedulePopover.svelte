<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	// Per-match schedule editor, opened as a nested popover off the "Schedule"
	// button in the match popover footer. A match is one game played across one
	// or more "parts" (sittings); this edits the ordered list of parts, each with
	// its own time (entered in the viewer's zone), casters (streamer + co-casters),
	// and stream links. Replace-all: Save sends the full parts list. Open to an admin
	// or either participant on any non-bye match — scheduling ahead while pending,
	// attaching streams after it's played. Self-contained: owns its own
	// busy/toast/invalidate cycle, so the parent only decides whether to render it.
	import {
		cloudApi,
		type TournamentDetail,
		type TournamentMatch,
	} from "$lib/api-cloud";
	import Popover from "$lib/ui/Popover.svelte";
	import { runAction } from "$lib/tournament/async-action";
	import FormFooter from "$lib/tournament/FormFooter.svelte";
	import SchedulePartEditor, {
		isValidStreamUrl,
		type EditCaster,
		type EditPart,
	} from "./SchedulePartEditor.svelte";
	import {
		getLocalTimeZone,
		parseAbsolute,
		Time,
		toCalendarDate,
	} from "@internationalized/date";
	import { partToIso } from "$lib/tournament/parts";

	let {
		match,
		tournament,
	}: {
		match: TournamentMatch;
		tournament: TournamentDetail;
	} = $props();

	let open = $state(false);
	let busy = $state(false);

	// Times are entered/displayed in the viewer's own timezone and stored as the
	// resulting UTC instant, so a match reads correctly in everyone's zone.
	const tz = getLocalTimeZone();

	// On a decided match the editor is about attaching streams/casters after the
	// fact, so the affordance reads "Streams" rather than "Schedule".
	const editorLabel = $derived(
		match.status === "pending" ? "Schedule" : "Streams",
	);
	const editorTitle = $derived(
		match.status === "pending" ? "Schedule match" : "Match Streams & casters",
	);

	// Parts editor state — seeded from the match each time the popover opens (see
	// reset()), so an invalidateAll from elsewhere can't clobber an in-progress
	// edit and reopening always starts from the persisted values.
	let parts = $state<EditPart[]>([]);

	// One blank caster row so the editor always shows a "Streamer" field.
	function emptyCaster(): EditCaster {
		return { value: "", userId: null, linkedName: null };
	}

	function emptyPart(): EditPart {
		return {
			// Client-side key only — stripped on save so the server mints the
			// real id. A stable key (vs index) keeps each editor's local UI state
			// (open calendar, focused segment) with its part when one is removed.
			id: `tmp-${crypto.randomUUID()}`,
			date: undefined,
			time: undefined,
			casters: [emptyCaster()],
			streams: [],
		};
	}

	// The parts_rev the editor loaded, echoed back on save so a concurrent
	// writer (another admin, a caster sign-up) turns into a 409 instead of
	// being silently erased by this editor's replace-all.
	let loadedRev = $state(0);

	function reset() {
		loadedRev = match.parts_rev ?? 0;
		// A never-scheduled match starts with a single blank part ready to fill.
		parts =
			match.parts.length > 0
				? match.parts.map((p) => {
						let date: EditPart["date"] = undefined;
						let time: EditPart["time"] = undefined;
						if (p.scheduled_at) {
							try {
								const z = parseAbsolute(p.scheduled_at, tz);
								date = toCalendarDate(z);
								time = new Time(z.hour, z.minute);
							} catch {
								// Malformed stored instant (the API stores ISO, so this only
								// hits hand-edited/legacy data) — start the picker blank
								// rather than throwing the whole editor.
							}
						}
						// Edit the display label, not the stored name: for a linked caster
						// the worker re-resolves the canonical value from user_id on save,
						// so the input can show the friendly name. Always keep at least one
						// (blank) row so the streamer field is present.
						const casters: EditCaster[] =
							p.casters.length > 0
								? p.casters.map((c) => ({
										value: c.display_name ?? "",
										userId: c.user_id,
										linkedName: c.user_id ? (c.display_name ?? null) : null,
									}))
								: [emptyCaster()];
						return {
							id: p.id,
							date,
							time,
							casters,
							streams: p.streams.map((v) => ({
								url: v.url,
								label: v.label ?? "",
							})),
						};
					})
				: [emptyPart()];
	}

	// Save is blocked while any stream url is malformed; the cloud schema is the real
	// gate but this stops an obviously-bad submit.
	const hasInvalidStream = $derived(
		parts.some((p) => p.streams.some((v) => !isValidStreamUrl(v.url))),
	);

	async function save() {
		const payload = parts
			.map((p) => ({
				// Temp (client-key) ids are stripped; the server mints real ones.
				id: p.id?.startsWith("tmp-") ? undefined : p.id,
				scheduled_at: partToIso(p.date, p.time, tz),
				// Keep caster order (streamer first); drop rows left blank.
				casters: p.casters
					.map((c) => ({
						user_id: c.userId,
						name: c.value.trim() ? c.value.trim() : null,
					}))
					.filter((c) => c.user_id !== null || c.name !== null),
				streams: p.streams
					.filter((v) => v.url.trim())
					.map((v) => ({
						url: v.url.trim(),
						label: v.label.trim() ? v.label.trim() : null,
					})),
			}))
			// Drop parts the editor left entirely blank so an accidental empty row
			// doesn't persist as a phantom sitting.
			.filter(
				(p) =>
					p.scheduled_at !== null ||
					p.casters.length > 0 ||
					p.streams.length > 0,
			);
		const ok = await runAction(
			() =>
				cloudApi.patchMatchSchedule(tournament.tournament_id, match.match_id, {
					parts: payload,
					expected_rev: loadedRev,
				}),
			{
				setBusy: (b) => (busy = b),
				success: "Schedule updated",
				// A 409 means someone else changed the schedule mid-edit (another
				// admin, a caster). Refresh the page data so reopening the editor
				// shows the current state (runAction only invalidates on success).
				onError: (err) => {
					if (err.code !== "CONFLICT") return undefined;
					void invalidateAll();
					return "Schedule changed while you were editing — reopen to see the latest";
				},
			},
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
	contentClass="w-[min(92vw,28rem)]"
	frameClass="bg-surface p-3 shadow-[0_24px_64px_-12px_rgb(var(--color-black)/0.85)]"
	ariaLabel={editorTitle}
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
			{editorLabel}
		</button>
	{/snippet}

	<!-- Header bar mirrors the match popover's: a surface-raised rounded bar carrying
	     the title with a close affordance on the right. -->
	<header
		class="mb-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<h2 class="text-lg font-bold text-tan">{editorTitle}</h2>
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

	<div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
		{#each parts as part, i (part.id)}
			<SchedulePartEditor
				{part}
				index={i}
				count={parts.length}
				{busy}
				onRemove={() => parts.splice(i, 1)}
			/>
		{/each}

		<button
			type="button"
			class="self-start rounded border border-input px-2.5 py-1 text-xs text-tan/80 hover:border-orange hover:text-orange"
			onclick={() => parts.push(emptyPart())}
			disabled={busy}
		>
			+ Add part
		</button>

		<FormFooter
			class="pt-1"
			onCancel={() => (open = false)}
			onConfirm={save}
			confirmLabel="Save"
			{busy}
			confirmDisabled={busy || hasInvalidStream}
		/>
	</div>
</Popover>
