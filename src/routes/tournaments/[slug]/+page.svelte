<script lang="ts">
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import ChampionshipBracketTree from "$lib/tournament/ChampionshipBracketTree.svelte";
	import SwissFlowBracket from "$lib/tournament/SwissFlowBracket.svelte";
	import SwissStandings from "$lib/tournament/SwissStandings.svelte";
	import type { Division, TournamentMatch } from "$lib/api-cloud";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// Swiss-phase matches, filtered per division. The flow bracket needs
	// only its own division's matches so the (W, L) record walk doesn't
	// mix slots from the parallel division.
	function swissMatchesFor(division: Division): TournamentMatch[] {
		return data.matches.filter(
			(m) => m.phase === "swiss" && m.division === division,
		);
	}

	const matchesByDivision = $derived({
		A: swissMatchesFor("A"),
		B: swissMatchesFor("B"),
	});

	const hasAnyStandings = $derived(
		data.standings.divisions.A.standings.length > 0 ||
			data.standings.divisions.B.standings.length > 0,
	);
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-6xl">
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

				{#if !hasAnyStandings}
					<section
						class="mb-6 rounded-lg p-6 text-center"
						style="background-color: #2a2622;"
					>
						<p class="text-sm text-tan opacity-70">
							The tournament hasn't started yet. Check back when slots have been
							claimed and round 1 is paired.
						</p>
					</section>
				{:else}
					{#each ["A", "B"] as const as division (division)}
						{@const divisionData = data.standings.divisions[division]}
						{#if divisionData.standings.length > 0}
							<section class="mb-8">
								<h2 class="mb-3 text-lg font-bold text-tan">
									{divisionData.name}
								</h2>
								<div class="space-y-3">
									<SwissFlowBracket
										winsToAdvance={data.tournament.swiss_wins_to_advance}
										lossesToEliminate={data.tournament
											.swiss_losses_to_eliminate}
										maxRounds={data.tournament.swiss_max_rounds}
										standings={divisionData.standings}
										matches={matchesByDivision[division]}
										tournamentSlug={data.tournament.slug}
									/>
									<SwissStandings
										divisionName=""
										standings={divisionData.standings}
									/>
								</div>
							</section>
						{/if}
					{/each}
				{/if}

				{#if data.bracket.rounds.length > 0}
					<section
						class="mb-6 rounded-lg p-4"
						style="background-color: #2a2622;"
					>
						<h2 class="mb-3 text-sm font-bold text-tan">
							Championship Bracket
						</h2>
						<ChampionshipBracketTree
							bracket={data.bracket}
							tournamentSlug={data.tournament.slug}
						/>
					</section>
				{/if}
			</div>
		</div>
	</main>
</div>
