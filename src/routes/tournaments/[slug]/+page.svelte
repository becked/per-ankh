<script lang="ts">
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import BracketView from "$lib/tournament/BracketView.svelte";
	import MatchCard from "$lib/tournament/MatchCard.svelte";
	import SwissStandings from "$lib/tournament/SwissStandings.svelte";
	import type { TournamentMatch } from "$lib/api-cloud";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// Build a slot_id → label resolver from standings + bracket so MatchCard
	// can render player names without each card fetching slot identity.
	// Plain Record (vs. Map) avoids the SvelteMap reactivity lint and is
	// fine here since the resolver is derived, not mutated.
	const slotLabelById = $derived.by(() => {
		const out: Record<string, string> = {};
		for (const div of ["A", "B"] as const) {
			for (const s of data.standings.divisions[div].standings) {
				if (s.discord_username) out[s.slot_id] = s.discord_username;
			}
		}
		for (const s of data.bracket.slots) {
			if (s.discord_username) out[s.slot_id] = s.discord_username;
		}
		return out;
	});

	function slotLabel(slotId: string | null): string | null {
		if (!slotId) return null;
		return slotLabelById[slotId] ?? null;
	}

	// Sort matches by reported_at desc so the page surfaces recent activity.
	// Bye/forfeit matches without reported_at fall to the bottom.
	const recentMatches = $derived(
		[...data.matches]
			.filter((m: TournamentMatch) => m.status !== "pending")
			.sort((a, b) => {
				const ra = a.reported_at ?? "";
				const rb = b.reported_at ?? "";
				return rb.localeCompare(ra);
			})
			.slice(0, 8),
	);

	const upcomingMatches = $derived(
		data.matches.filter((m: TournamentMatch) => m.status === "pending"),
	);
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-5xl">
				<header class="mb-6">
					<div class="flex items-baseline justify-between gap-3">
						<h1 class="text-2xl font-bold text-tan">{data.tournament.name}</h1>
						<span
							class="whitespace-nowrap rounded border border-orange px-2 py-0.5 text-xs uppercase text-orange"
						>
							{data.tournament.status}
						</span>
					</div>
					{#if data.tournament.description}
						<p class="mt-2 text-sm text-tan opacity-80">
							{data.tournament.description}
						</p>
					{/if}
				</header>

				<section
					class="mb-6 rounded-lg p-4"
					style="background-color: #2a2622;"
				>
					<h2 class="mb-3 text-sm font-bold text-tan">Swiss Standings</h2>
					<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
						<SwissStandings
							divisionName={data.standings.divisions.A.name}
							standings={data.standings.divisions.A.standings}
						/>
						<SwissStandings
							divisionName={data.standings.divisions.B.name}
							standings={data.standings.divisions.B.standings}
						/>
					</div>
				</section>

				{#if data.bracket.rounds.length > 0}
					<section
						class="mb-6 rounded-lg p-4"
						style="background-color: #2a2622;"
					>
						<h2 class="mb-3 text-sm font-bold text-tan">
							Championship Bracket
						</h2>
						<BracketView
							bracket={data.bracket}
							tournamentSlug={data.tournament.slug}
						/>
					</section>
				{/if}

				{#if upcomingMatches.length > 0}
					<section
						class="mb-6 rounded-lg p-4"
						style="background-color: #2a2622;"
					>
						<h2 class="mb-3 text-sm font-bold text-tan">Upcoming Matches</h2>
						<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
							{#each upcomingMatches as m (m.match_id)}
								<MatchCard
									match={m}
									tournamentSlug={data.tournament.slug}
									{slotLabel}
								/>
							{/each}
						</div>
					</section>
				{/if}

				{#if recentMatches.length > 0}
					<section
						class="mb-6 rounded-lg p-4"
						style="background-color: #2a2622;"
					>
						<h2 class="mb-3 text-sm font-bold text-tan">Recent Results</h2>
						<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
							{#each recentMatches as m (m.match_id)}
								<MatchCard
									match={m}
									tournamentSlug={data.tournament.slug}
									{slotLabel}
								/>
							{/each}
						</div>
					</section>
				{/if}
			</div>
		</div>
	</main>
</div>
