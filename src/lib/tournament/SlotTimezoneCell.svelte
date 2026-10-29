<script lang="ts">
	// The Zone cell of an admin slot roster: what the scheduling DM will print
	// as this seat's timezone, and the control that sets the seat's own column.
	//
	// Shared by both admin rosters — the setup-phase Slots panel and the
	// live Swiss standings — because both render SlotStanding rows and the
	// organiser's job is the same on each: see which seats still have no zone,
	// and fill them in. Two copies of a 400-option picker would be two
	// spellings of one interaction.
	import Select from "$lib/ui/Select.svelte";
	import { formatTimeZone, shortTimeZoneName } from "$lib/utils/formatting";
	import { timeZoneOptions } from "$lib/utils/timezones";

	let {
		resolved,
		seatZone,
		disabled,
		onSave,
	}: {
		// The zone the DM resolves for this seat — the occupant's account zone
		// when they have one, else the seat's own. Server-resolved
		// (slotTimezone in cloud/src/tournament/data.ts); this cell displays it
		// rather than deciding it, so the roster and the DM can't disagree.
		resolved: string | null;
		// The seat's own stored column — what the picker opens on and writes
		// back. Null when nothing was ever stored on the seat, which includes
		// every seat of a tournament whose signup never asked.
		seatZone: string | null;
		disabled: boolean;
		// Save the seat's zone; null clears it. Required, not optional: this
		// cell has no read-only audience — the column it sits in is admin-only,
		// and a non-admin viewer never renders it at all.
		onSave: (
			// eslint-disable-next-line no-unused-vars -- documentary param name
			zone: string | null,
		) => void;
	} = $props();

	let editing = $state(false);
	let value = $state("");

	// The abbreviation the DM's long form is built on — "EDT", or the offset
	// itself ("GMT+5:30") for the zones Intl has no abbreviation for. The id
	// is the fallback for a zone this runtime's tzdata no longer resolves, so
	// a stored zone always renders as something.
	const label = $derived(
		resolved === null
			? null
			: shortTimeZoneName(new Date(), resolved) || resolved,
	);

	// The account zone is outranking the seat's own column. Worth saying,
	// because an admin who sets a seat zone here and sees the row keep a
	// different one has no other way to tell why.
	const shadowed = $derived(resolved !== null && resolved !== seatZone);

	const title = $derived.by(() => {
		if (resolved === null) {
			return "No timezone set — the scheduling DM falls back to the signup answer";
		}
		const lines = [formatTimeZone(resolved)];
		if (shadowed) {
			lines.push(
				seatZone === null
					? "The player set this on their account"
					: `The player's account zone wins over this seat's ${formatTimeZone(seatZone)}`,
			);
		}
		return lines.join("\n");
	});

	const choices = $derived(timeZoneOptions(value === "" ? null : value));

	function startEdit() {
		// Opens on the seat's own zone, or "Not set" — deliberately NOT on
		// getLocalTimeZone() the way the account and signup pickers do. Those
		// two ask a player for their own zone, where the detected one is the
		// answer nearly every time; this asks an admin for someone else's,
		// where the admin's own zone is the one answer that is certainly wrong.
		value = seatZone ?? "";
		editing = true;
	}

	function save() {
		const next = value === "" ? null : value;
		if (next !== seatZone) onSave(next);
		editing = false;
	}
</script>

{#if editing}
	<span class="inline-flex flex-col items-end gap-1">
		<span class="inline-flex items-center gap-1">
			<Select
				{value}
				onChange={(v) => (value = v ?? "")}
				options={choices}
				{disabled}
				compact
				matchTriggerWidth
				ariaLabel="Seat timezone"
				class="w-44"
			/>
			<button
				type="button"
				class="text-xs text-tan opacity-70 hover:text-orange hover:opacity-100"
				onclick={save}
				{disabled}
				aria-label="Save"
			>
				✓
			</button>
			<button
				type="button"
				class="text-xs text-tan opacity-50 hover:opacity-100"
				onclick={() => (editing = false)}
				{disabled}
				aria-label="Cancel"
			>
				×
			</button>
		</span>
		{#if shadowed}
			<span class="text-[10px] leading-tight text-tan opacity-60">
				Account zone in use
			</span>
		{/if}
	</span>
{:else}
	<button
		type="button"
		class="font-mono text-[11px] text-tan transition-colors hover:text-orange"
		class:opacity-40={label === null}
		onclick={startEdit}
		{disabled}
		{title}
		aria-label="Set seat timezone"
	>
		{label ?? "—"}
	</button>
{/if}
