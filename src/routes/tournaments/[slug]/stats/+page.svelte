<script lang="ts">
	// Tournament stats page. A single scrolling page of chart sections — three
	// for the MVP, spanning both stats subsystems: standings + caster leaderboard
	// (Plane A, tournament-native) and nation win rate (Plane B1, the ChartBundle
	// pointed at the tournament's games). Renders the charts directly (no chart
	// registry) through the shared ChartContainer, reusing the chart theme/grid.
	import { resolve } from "$app/paths";
	import Breadcrumb, { type Crumb } from "$lib/Breadcrumb.svelte";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import { nationWinLossStackedOption } from "$lib/stats/charts/nations";
	import {
		casterLeaderboardOption,
		standingsOption,
	} from "$lib/tournament/stats-charts";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const crumbs: Crumb[] = $derived([
		{ label: "Home", href: resolve("/") },
		{ label: "Tournaments", href: resolve("/tournaments") },
		{
			label: data.tournament.name,
			href: resolve("/tournaments/[slug]", { slug: data.tournament.slug }),
		},
		{ label: "Stats" },
	]);

	// Standings row count drives both the empty state and the bar-chart height.
	// Uses the combined cross-division ranking when present (swiss onward), else
	// the concatenated per-division standings (setup-phase admin preview).
	const standingsRows = $derived(
		data.competition.standings.combined_qualifier_ranking ?? [
			...data.competition.standings.divisions.A.standings,
			...data.competition.standings.divisions.B.standings,
		],
	);
	const casters = $derived(data.competition.caster_leaderboard);
	const nationWinRate = $derived(data.games.nationWinRate);

	// Horizontal-bar charts need vertical room scaled to their row count.
	function barHeight(rowCount: number): string {
		return `${Math.max(280, rowCount * 30 + 120)}px`;
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-screen-2xl">
				<div class="mb-4 flex items-center justify-between gap-3">
					<Breadcrumb {crumbs} class="min-w-0" />
				</div>

				<h1 class="mb-6 text-lg font-bold text-tan">
					{data.tournament.name} · Stats
				</h1>

				<!-- Standings (Plane A) -->
				<section class="mb-8">
					<h2 class="mb-1 text-base font-bold text-tan">Standings</h2>
					<p class="mb-3 text-sm text-tan opacity-70">
						Win–loss record and tiebreakers, ranked.
					</p>
					{#if standingsRows.length > 0}
						<ChartContainer
							option={standingsOption(data.competition.standings)}
							height={barHeight(standingsRows.length)}
							title="Standings"
						/>
					{:else}
						<p class="p-8 text-center italic text-tan opacity-60">
							No standings yet.
						</p>
					{/if}
				</section>

				<!-- Caster leaderboard (Plane A) -->
				<section class="mb-8">
					<h2 class="mb-1 text-base font-bold text-tan">Caster leaderboard</h2>
					<p class="mb-3 text-sm text-tan opacity-70">
						Most-active casters across the tournament, by match-part
						appearances.
					</p>
					{#if casters.length > 0}
						<ChartContainer
							option={casterLeaderboardOption(casters)}
							height={barHeight(casters.length)}
							title="Caster leaderboard"
						/>
					{:else}
						<p class="p-8 text-center italic text-tan opacity-60">
							No casters recorded yet.
						</p>
					{/if}
				</section>

				<!-- Nation win rate (Plane B1) -->
				<section class="mb-8">
					<h2 class="mb-1 text-base font-bold text-tan">Nation win rate</h2>
					<p class="mb-3 text-sm text-tan opacity-70">
						Wins vs. losses per nation, across the tournament's completed games.
					</p>
					{#if nationWinRate.length > 0}
						<ChartContainer
							option={nationWinLossStackedOption(data.games)}
							height={barHeight(nationWinRate.length)}
							title="Nation win rate"
						/>
					{:else}
						<p class="p-8 text-center italic text-tan opacity-60">
							No completed games yet.
						</p>
					{/if}
				</section>
			</div>
		</div>
	</main>
</div>
