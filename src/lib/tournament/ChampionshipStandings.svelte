<script lang="ts">
	// Final-placement table for the championship bracket — the Standings view
	// paired with ChampionshipBracketTree. A knockout has no W-L/tiebreaker
	// columns to tabulate, so placement is derived from how far each participant
	// advanced: champion, runner-up, then tied tiers per eliminated round.
	import type { BracketResponse } from "$lib/api-cloud";
	import PlayerAvatar from "./PlayerAvatar.svelte";

	let {
		bracket,
		// Champion is only awarded once the tournament is complete; mid-bracket
		// the winner of the latest round is still "Active", not the champion.
		isComplete,
	}: { bracket: BracketResponse; isComplete: boolean } = $props();

	type Outcome = "won" | "lost" | "pending";
	interface Row {
		slot_id: string;
		seed: number | null;
		name: string;
		avatarUrl: string | null;
		rankLabel: string;
		result: string;
		eliminated: boolean;
		isChampion: boolean;
	}

	function roundName(fromFinal: number): string {
		switch (fromFinal) {
			case 0:
				return "Runner-up";
			case 1:
				return "Semifinals";
			case 2:
				return "Quarterfinals";
			case 3:
				return "Round of 16";
			case 4:
				return "Round of 32";
			default:
				return "Round of " + 2 ** (fromFinal + 1);
		}
	}

	const rows = $derived.by((): Row[] => {
		const slots = bracket.slots;
		if (slots.length === 0) return [];

		// Total rounds the full bracket spans (e.g. 5–8 players → 3 rounds). Drives
		// round naming so an early-round loss isn't mislabeled "Runner-up" just
		// because later rounds haven't been generated yet.
		const totalRounds =
			slots.length >= 2 ? Math.ceil(Math.log2(slots.length)) : 1;

		// Furthest round each participant reached, and the outcome there. Byes
		// (slot_b null) record a win and never eliminate the opponent — there is
		// no opponent — so they don't perturb the placement math.
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

		// Ranking score (higher = better): champion on top, then still-alive
		// players by furthest round, then eliminated players by the round they
		// went out in. The 0.5 bump keeps a survivor of round r above someone
		// eliminated in round r.
		const CHAMPION_SCORE = totalRounds + 2;
		function scoreOf(
			p: { lastRound: number; outcome: Outcome } | undefined,
		): number {
			if (!p) return -1;
			if (p.outcome === "lost") return p.lastRound;
			if (isComplete && p.outcome === "won" && p.lastRound >= totalRounds) {
				return CHAMPION_SCORE;
			}
			return p.lastRound + 0.5;
		}

		const enriched = slots.map((s) => {
			const p = prog[s.slot_id];
			const score = scoreOf(p);
			return {
				s,
				p,
				score,
				isChampion: score === CHAMPION_SCORE,
				eliminated: p?.outcome === "lost",
			};
		});

		enriched.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return (
				(a.s.championship_seed ?? Infinity) -
				(b.s.championship_seed ?? Infinity)
			);
		});

		// Place = (# ranked strictly above) + 1, with a "T" prefix when more than
		// one participant shares the exact score (e.g. both semifinal losers → T3).
		const shared: Record<number, number> = {};
		for (const e of enriched) shared[e.score] = (shared[e.score] ?? 0) + 1;

		return enriched.map((e) => {
			const place = enriched.filter((o) => o.score > e.score).length + 1;
			const tied = (shared[e.score] ?? 0) > 1;
			const result = e.isChampion
				? "Champion"
				: e.eliminated && e.p
					? roundName(totalRounds - e.p.lastRound)
					: "Active";
			return {
				slot_id: e.s.slot_id,
				seed: e.s.championship_seed,
				name: e.s.discord_username ?? `seed ${e.s.championship_seed ?? "?"}`,
				avatarUrl: e.s.avatar_url,
				rankLabel: tied ? `T${place}` : `${place}`,
				result,
				eliminated: e.eliminated,
				isChampion: e.isChampion,
			};
		});
	});
</script>

<section class="rounded-lg p-3" style="background-color: #35302B;">
	{#if rows.length === 0}
		<p class="text-xs text-tan opacity-70">No participants yet.</p>
	{:else}
		<table class="w-full text-xs text-tan">
			<thead>
				<tr class="border-b border-black text-left">
					<th class="py-1 pr-2">#</th>
					<th class="py-1 pr-2">Player</th>
					<th class="py-1 pr-2 text-right" title="Championship seed">Seed</th>
					<th class="py-1 text-right">Result</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.slot_id)}
					<tr
						class="border-b border-black border-opacity-30 last:border-0"
						class:opacity-60={r.eliminated}
					>
						<td class="py-1 pr-2 font-mono">{r.rankLabel}</td>
						<td class="py-1 pr-2">
							<span class="flex items-center gap-1.5">
								<PlayerAvatar avatarUrl={r.avatarUrl} size={15} />
								<span>{r.name}</span>
							</span>
						</td>
						<td class="py-1 pr-2 text-right font-mono">{r.seed ?? "—"}</td>
						<td class="py-1 text-right" class:font-semibold={r.isChampion}>
							{r.result}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>
