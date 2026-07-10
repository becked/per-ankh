<script lang="ts">
	// Occupant-swap picker: a searchable dropdown over the swap-eligible players
	// in the same division. Backs the "Swap" affordance in SwissStandings — the
	// admin picks the player to trade seats with, unblocking a stuck pending
	// match by pairing the healthy player against someone from another pending
	// match.
	//
	// Built on bits-ui's Combobox (the app's UI primitive, styled to match
	// ui/Select.svelte) rather than UserAutocomplete: the candidate set is an
	// in-memory list of existing slots in this division, not a server user
	// search. bits-ui filters nothing itself — we render the items matching the
	// typed query and it owns keyboard nav, ARIA, and the portal'd dropdown (so
	// the list isn't clipped by the standings table's overflow).
	import { Combobox } from "bits-ui";

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
		disabled = false,
		onSelect,
		onCancel,
	}: {
		candidates: SwapCandidate[];
		disabled?: boolean;
		// eslint-disable-next-line no-unused-vars -- param name documentary
		onSelect: (otherSlotId: string) => void;
		onCancel: () => void;
	} = $props();

	let search = $state("");
	let inputEl = $state<HTMLInputElement | null>(null);
	// Open on mount so the candidate list shows immediately; bits-ui owns it
	// thereafter (Escape / outside click / pick set it false → onOpenChange
	// collapses the whole picker).
	let open = $state(true);

	const query = $derived(search.trim().toLowerCase());
	const filtered = $derived(
		query
			? candidates.filter((c) => c.label.toLowerCase().includes(query))
			: candidates,
	);

	// Focus + select on mount so the admin can type immediately (parity with the
	// substitute editor's toggle-to-edit). Uses the ref rather than the native
	// autofocus attribute to avoid the a11y-autofocus lint.
	$effect(() => {
		inputEl?.focus();
		inputEl?.select();
	});
</script>

<Combobox.Root
	type="single"
	bind:open
	{disabled}
	onValueChange={(v) => {
		if (v) onSelect(v);
	}}
	onOpenChange={(o) => {
		// Escape or an outside click closes the dropdown — collapse the whole
		// picker back to the button. A pick fires onValueChange first, so the
		// resulting close here is a harmless second cancel.
		if (!o) onCancel();
	}}
>
	<span class="inline-flex items-center gap-1">
		<Combobox.Input
			bind:ref={inputEl}
			{disabled}
			aria-label="Swap with player"
			oninput={(e) => (search = e.currentTarget.value)}
			class="w-40 rounded bg-surface px-1.5 py-0.5 text-xs text-tan focus:outline-none disabled:opacity-50"
		/>
		<button
			type="button"
			class="text-xs text-tan opacity-50 hover:opacity-100"
			onclick={onCancel}
			{disabled}
			aria-label="Cancel swap"
		>
			×
		</button>
	</span>
	<Combobox.Portal>
		<Combobox.Content
			class="z-50 max-h-72 w-72 overflow-y-auto rounded-lg border border-surface bg-surface-sunken shadow-lg"
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
		</Combobox.Content>
	</Combobox.Portal>
</Combobox.Root>
