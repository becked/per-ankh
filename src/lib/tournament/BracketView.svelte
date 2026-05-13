<script lang="ts">
	import type { BracketResponse, BracketSlot } from "$lib/api-cloud";
	import MatchCard from "./MatchCard.svelte";

	let {
		bracket,
		tournamentSlug,
	}: { bracket: BracketResponse; tournamentSlug: string } = $props();

	const slotsById = $derived.by(() => {
		const out: Record<string, BracketSlot> = {};
		for (const s of bracket.slots) out[s.slot_id] = s;
		return out;
	});

	function slotLabel(slotId: string | null): string | null {
		if (!slotId) return null;
		const s = slotsById[slotId];
		if (!s) return null;
		return s.discord_username ?? `seed ${s.championship_seed ?? "?"}`;
	}

	function roundTitle(roundNumber: number, totalRounds: number): string {
		if (roundNumber === totalRounds) return "Final";
		if (roundNumber === totalRounds - 1) return "Semifinal";
		if (roundNumber === totalRounds - 2) return "Quarterfinal";
		return `Round ${roundNumber}`;
	}
</script>

{#if bracket.rounds.length === 0}
	<p class="text-sm text-tan opacity-70">
		The championship bracket hasn't started yet.
	</p>
{:else}
	<div class="flex flex-col gap-4">
		{#each bracket.rounds as round (round.round_id)}
			<section>
				<h3 class="mb-2 text-sm font-bold text-tan">
					{roundTitle(round.round_number, bracket.rounds.length)}
					<span class="ml-2 text-xs font-normal opacity-60">
						{round.status}
					</span>
				</h3>
				<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
					{#each round.matches as match (match.match_id)}
						<MatchCard {match} {tournamentSlug} {slotLabel} />
					{/each}
				</div>
			</section>
		{/each}
	</div>
{/if}
