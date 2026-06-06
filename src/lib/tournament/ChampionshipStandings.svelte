<script lang="ts">
	// Progress table for the championship bracket — the Standings view paired with
	// ChampionshipBracketTree. Rows are the bracket seeds in seed order; the Round
	// column reports where each participant currently stands in the knockout.
	import type { BracketResponse } from "$lib/api-cloud";
	import PlayerAvatar from "./PlayerAvatar.svelte";

	let {
		bracket,
		// Champion is only awarded once the tournament is complete; mid-bracket
		// the winner of the latest round is still advancing, not the champion.
		isComplete,
	}: { bracket: BracketResponse; isComplete: boolean } = $props();

	type Outcome = "won" | "lost" | "pending";
	interface Row {
		slot_id: string;
		seed: number | null;
		name: string;
		avatarUrl: string | null;
		round: string;
		eliminated: boolean;
		isChampion: boolean;
	}

	const rows = $derived.by((): Row[] => {
		const slots = bracket.slots;
		if (slots.length === 0) return [];

		// Total rounds the full bracket spans (e.g. 5–8 players → 3 rounds). Used
		// to recognize a final-round win as the championship rather than just
		// "advance to the next round".
		const totalRounds =
			slots.length >= 2 ? Math.ceil(Math.log2(slots.length)) : 1;

		// Furthest round each participant reached, and the outcome there. Byes
		// (slot_b null) record a win and advance the player like any other win.
		const prog: Record<string, { lastRound: number; outcome: Outcome }> = {};
		for (const r of bracket.rounds) {
			for (const m of r.matches) {
				for (const sid of [m.slot_a_id, m.slot_b_id]) {
					if (!sid) continue;
					const cur = prog[sid];
					if (cur && cur.lastRound >= r.round_number) continue;
					const outcome: Outcome = !m.winner_slot_id
						? "pending"
						: m.winner_slot_id === sid
							? "won"
							: "lost";
					prog[sid] = { lastRound: r.round_number, outcome };
				}
			}
		}

		// The player's current round: a pending match means they're playing that
		// round now; a win advances them to the next round (lastRound + 1) even
		// before it's been generated; a loss freezes the round they went out in;
		// a final-round win is the championship once the tournament completes.
		function roundCell(
			p: { lastRound: number; outcome: Outcome } | undefined,
		): string {
			if (!p) return "1";
			if (p.outcome === "lost") return `Eliminated R${p.lastRound}`;
			if (p.outcome === "won") {
				if (isComplete && p.lastRound >= totalRounds) return "Champion";
				return String(p.lastRound + 1);
			}
			return String(p.lastRound);
		}

		return slots
			.slice()
			.sort(
				(a, b) =>
					(a.championship_seed ?? Infinity) - (b.championship_seed ?? Infinity),
			)
			.map((s): Row => {
				const p = prog[s.slot_id];
				return {
					slot_id: s.slot_id,
					seed: s.championship_seed,
					name: s.display_name ?? `seed ${s.championship_seed ?? "?"}`,
					avatarUrl: s.avatar_url,
					round: roundCell(p),
					eliminated: p?.outcome === "lost",
					isChampion:
						isComplete && p?.outcome === "won" && p.lastRound >= totalRounds,
				};
			});
	});
</script>

<section
	class="mx-auto mb-2 w-fit rounded-lg p-3"
	style="background-color: rgb(var(--color-surface-raised));"
>
	{#if rows.length === 0}
		<p class="text-xs text-tan opacity-70">No participants yet.</p>
	{:else}
		<table class="text-xs text-tan">
			<thead>
				<tr class="border-b border-black">
					<th class="px-4 py-1 text-center" title="Championship seed">Seed</th>
					<th class="px-4 py-1 text-left">Player</th>
					<th class="px-4 py-1 text-center">Round</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.slot_id)}
					<tr
						class="border-b border-black border-opacity-30 last:border-0"
						class:opacity-60={r.eliminated}
					>
						<td class="px-4 py-1 text-center font-mono">{r.seed ?? "—"}</td>
						<td class="px-4 py-1">
							<span class="flex items-center gap-1.5">
								<PlayerAvatar avatarUrl={r.avatarUrl} size={15} />
								<span>{r.name}</span>
							</span>
						</td>
						<td
							class="px-4 py-1 text-center"
							class:font-semibold={r.isChampion}
						>
							{r.round}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>
