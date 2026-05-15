<script lang="ts">
	import { resolve } from "$app/paths";
	import type { TournamentMatch } from "$lib/api-cloud";
	import { formatEnum } from "$lib/utils/formatting";

	let {
		match,
		tournamentSlug,
		slotLabel,
	}: {
		match: TournamentMatch;
		tournamentSlug: string;
		// Resolver provided by the parent so each card doesn't fetch its own
		// slot identities. Returns `null` if the slot is unknown.
		// eslint-disable-next-line no-unused-vars -- type-signature param name is documentary
		slotLabel: (slotId: string | null) => string | null;
	} = $props();

	const slotALabel = $derived(slotLabel(match.slot_a_id) ?? "—");
	const slotBLabel = $derived(
		slotLabel(match.slot_b_id) ?? (match.slot_b_id === null ? "BYE" : "—"),
	);
	const winnerLabel = $derived(slotLabel(match.winner_slot_id) ?? null);
	const isBye = $derived(match.status === "bye");
	const isReported = $derived(
		match.status === "reported" || match.status === "forfeit",
	);
	const mapName = $derived(
		match.map_script ? formatEnum(match.map_script, "MAPCLASS_") : "—",
	);
</script>

<a
	href={resolve("/tournaments/[slug]/matches/[match_id]", {
		slug: tournamentSlug,
		match_id: match.match_id,
	})}
	class="block rounded-lg transition-colors hover:ring-2 hover:ring-orange"
	style="background-color: #35302B;"
>
	<div class="grid grid-cols-1 gap-px lg:grid-cols-2" style="background-color: #2a2622;">
		<div class="p-3" style="background-color: #35302B;">
			<p class="truncate text-sm font-bold text-tan">{slotALabel}</p>
			{#if match.winner_slot_id === match.slot_a_id}
				<p class="mt-1 text-xs text-orange">Winner</p>
			{/if}
		</div>
		<div class="p-3" style="background-color: #35302B;">
			<p class="truncate text-sm font-bold text-tan">
				{slotBLabel}
			</p>
			{#if isBye}
				<p class="mt-1 text-xs text-tan opacity-60">Bye</p>
			{:else if match.winner_slot_id === match.slot_b_id}
				<p class="mt-1 text-xs text-orange">Winner</p>
			{/if}
		</div>
	</div>
	<div
		class="flex items-center justify-between gap-3 px-3 py-2 text-xs text-tan"
		style="border-top: 1px solid #2a2622;"
	>
		<span class="truncate opacity-70">{mapName}</span>
		<span class="whitespace-nowrap">
			{#if isBye}
				bye
			{:else if isReported}
				<span class="text-orange">{match.status}</span>
				{#if winnerLabel}
					· {winnerLabel}
				{/if}
			{:else}
				pending
			{/if}
		</span>
	</div>
</a>
