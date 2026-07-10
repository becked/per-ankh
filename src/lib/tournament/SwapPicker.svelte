<script lang="ts">
	// Occupant-swap picker: the "Swap" affordance in a Swiss standings row. The
	// button is a Popover trigger; the popover holds a searchable bits-ui Combobox
	// over the swap-eligible players in the same division. The admin picks the
	// player to trade seats with, unblocking a stuck pending match by pairing the
	// healthy player against someone from another pending match.
	//
	// Why Popover + Combobox (two bits-ui floating primitives nested):
	//   * The Popover portals its content, so the dropdown escapes the standings
	//     table's overflow (the original reason SwapPicker reached for Combobox at
	//     all) and anchors to the button like the row's Withdraw/Reinstate siblings
	//     don't need to — it floats free of the row.
	//   * The Combobox stays for the searchable, keyboard-navigable candidate list
	//     (a round-1 division can be ~30 players, so the typeahead filter matters);
	//     bits-ui owns keyboard nav and ARIA. We render the items matching the typed
	//     query — bits-ui filters nothing itself.
	//
	// Nesting two floating layers safely: the Combobox uses ContentStatic (NOT
	// Combobox.Portal), so the whole input+list tree lives inside the Popover's DOM
	// and focus scope — the Popover's focus trap contains it, and a click on a
	// Combobox item is DOM-inside the popover, so the Popover's outside-click
	// dismiss never races the item selection. bits-ui's dismiss is topmost-layer
	// only, so while the Combobox is open it owns Escape / outside-click; we route a
	// single `open` state through both, so one dismiss collapses the whole picker.
	import { Combobox } from "bits-ui";
	import Popover from "$lib/ui/Popover.svelte";

	interface SwapCandidate {
		slotId: string;
		label: string;
		seed: number | null;
		// The candidate's current pending opponent — the admin is really choosing
		// the resulting matchup, so we surface it. Null only for the rare eligible
		// slot with no pending match (e.g. reinstated mid-round).
		opponentLabel: string | null;
	}

	let {
		candidates,
		eligible,
		disabled = false,
		onSelect,
	}: {
		candidates: SwapCandidate[];
		// Whether this row's player may swap at all (no banked result this phase).
		// Drives the disabled-trigger title; candidates is empty when ineligible.
		eligible: boolean;
		disabled?: boolean;
		// eslint-disable-next-line no-unused-vars -- param name documentary
		onSelect: (otherSlotId: string) => void;
	} = $props();

	// One open state, bound to the Popover and passed (controlled) to the
	// Combobox: any Combobox dismiss (Escape, outside click, pick) flows back
	// through onOpenChange and collapses the popover in a single step.
	let open = $state(false);

	let search = $state("");
	const query = $derived(search.trim().toLowerCase());
	const filtered = $derived(
		query
			? candidates.filter((c) => c.label.toLowerCase().includes(query))
			: candidates,
	);

	// The trigger can't open when the player has already banked a result, when no
	// eligible partners exist, or while another action is in flight — a disabled
	// Popover trigger can't open, so this gates the whole picker.
	const triggerDisabled = $derived(
		disabled || !eligible || candidates.length === 0,
	);
	const triggerTitle = $derived(
		!eligible
			? "Can't swap — already has a result this phase"
			: candidates.length === 0
				? "No swap-eligible players (others have results this round)"
				: "Swap this player's seat with another same-division pending player",
	);
</script>

<Popover
	bind:open
	ariaLabel="Swap with player"
	contentClass="w-72"
	frameClass="border border-surface bg-surface-sunken p-0 shadow-lg"
>
	{#snippet trigger({ props })}
		<button
			{...props}
			type="button"
			disabled={triggerDisabled}
			class="rounded border border-black border-opacity-50 px-1.5 text-[10px] text-tan opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
			title={triggerTitle}
		>
			Swap
		</button>
	{/snippet}

	<Combobox.Root
		type="single"
		{open}
		onOpenChange={(o) => {
			// Escape / outside click / pick all close the Combobox — collapse the
			// popover with it so the row returns to just the button.
			if (!o) open = false;
		}}
		onValueChange={(v) => {
			if (v) onSelect(v);
		}}
	>
		<div class="p-1.5">
			<!-- No autofocus attribute: the Popover's focus scope focuses its first
			     tabbable (this input) on open, so the admin can type immediately. -->
			<Combobox.Input
				aria-label="Swap with player"
				oninput={(e) => (search = e.currentTarget.value)}
				class="w-full rounded bg-surface px-1.5 py-1 text-xs text-tan focus:outline-none"
			/>
		</div>
		<Combobox.ContentStatic
			class="max-h-64 overflow-y-auto border-t border-surface pb-1"
		>
			<Combobox.Viewport>
				{#each filtered as c (c.slotId)}
					<Combobox.Item
						value={c.slotId}
						label={c.label}
						class="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-xs text-tan data-[highlighted]:bg-surface-raised"
					>
						<span class="truncate">{c.label}</span>
						<span class="ml-2 shrink-0 whitespace-nowrap opacity-60">
							{#if c.seed != null}#{c.seed}{/if}
							{#if c.opponentLabel}· vs {c.opponentLabel}{/if}
						</span>
					</Combobox.Item>
				{:else}
					<div class="px-3 py-2 text-xs text-tan opacity-60">No matches.</div>
				{/each}
			</Combobox.Viewport>
		</Combobox.ContentStatic>
	</Combobox.Root>
</Popover>
