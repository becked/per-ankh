<script lang="ts">
	// Tournament stats page. Three tabs — Players (standings), Nations (nation
	// win rate), Casters (caster leaderboard) — spanning both stats subsystems:
	// Plane A tournament-native (standings + casters) and Plane B1 (the
	// ChartBundle pointed at the tournament's games). Renders the charts directly
	// (no chart registry) through the shared ChartContainer, reusing the chart
	// theme/grid; the tab bar mirrors the user-stats chip tabs.
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { Tabs } from "bits-ui";
	import Breadcrumb, { type Crumb } from "$lib/Breadcrumb.svelte";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import { nationWinLossStackedOption } from "$lib/stats/charts/nations";
	import TournamentActions from "$lib/tournament/TournamentActions.svelte";
	import type { ScheduleZone } from "$lib/tournament/schedule";
	import {
		casterLeaderboardOption,
		standingsOption,
	} from "$lib/tournament/stats-charts";
	import {
		resolveInitialZone,
		writeZoneCookie,
	} from "$lib/tournament/zone-preference";
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

	// Standings rows. Uses the combined cross-division ranking when present (swiss
	// onward), else the concatenated per-division standings (setup-phase admin
	// preview); only players who have played at least one game are shown.
	const standingsRows = $derived(
		(
			data.competition.standings.combined_qualifier_ranking ?? [
				...data.competition.standings.divisions.A.standings,
				...data.competition.standings.divisions.B.standings,
			]
		).filter((r) => r.wins + r.losses >= 1),
	);
	const casters = $derived(data.competition.caster_leaderboard);
	const nationWinRate = $derived(data.games.nationWinRate);

	let tab = $state<"players" | "nations" | "casters">("players");

	// Opens the shared guide, carrying this tournament as origin (mirrors the
	// overview and matches pages) so the guide breadcrumb can link back here.
	function openGuide() {
		const dest = `${resolve("/tournaments/guide")}?from=${data.tournament.slug}&name=${encodeURIComponent(data.tournament.name)}`;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- query string appended to a resolved path
		goto(dest);
	}

	// Sticky UTC/local clock, shared app-wide via cookie and carried in the header
	// like the overview and matches pages. The stats page has no match times of
	// its own, but the control stays for header consistency and to let the visitor
	// set the app-wide preference here.
	let zone = $state<ScheduleZone>(resolveInitialZone(null));
	function setZone(next: ScheduleZone) {
		zone = next;
		writeZoneCookie(next);
	}

	// Chip-style tab triggers, matching the user-stats subtabs.
	const triggerClass =
		"cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-tan-hover data-[state=active]:bg-surface-raised data-[state=inactive]:bg-surface";

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
					<TournamentActions
						tournament={data.tournament}
						onGuide={openGuide}
						{zone}
						onZoneChange={setZone}
					/>
				</div>

				<Tabs.Root value={tab} onValueChange={(v) => (tab = v as typeof tab)}>
					<!-- Tabs live inside the raised panel, matching the user-stats page;
					     the list is a floating chip bar. -->
					<div
						class="rounded-lg p-4"
						style="background-color: rgb(var(--color-surface-raised));"
					>
						<Tabs.List
							class="mb-4 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
						>
							<Tabs.Trigger value="players" class={triggerClass}
								>Players</Tabs.Trigger
							>
							<Tabs.Trigger value="nations" class={triggerClass}
								>Nations</Tabs.Trigger
							>
							<Tabs.Trigger value="casters" class={triggerClass}
								>Casters</Tabs.Trigger
							>
						</Tabs.List>

						<!-- Players — standings (Plane A) -->
						<Tabs.Content value="players">
							<section class="mb-8">
								<h2 class="mb-3 text-base font-bold text-tan">Standings</h2>
								{#if standingsRows.length > 0}
									<ChartContainer
										option={standingsOption(standingsRows)}
										height={barHeight(standingsRows.length)}
										title="Standings"
									/>
								{:else}
									<p class="p-8 text-center italic text-tan opacity-60">
										No games played yet.
									</p>
								{/if}
							</section>
						</Tabs.Content>

						<!-- Nations — nation win rate (Plane B1) -->
						<Tabs.Content value="nations">
							<section class="mb-8">
								<h2 class="mb-3 text-base font-bold text-tan">
									Nation win rate
								</h2>
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
						</Tabs.Content>

						<!-- Casters — caster leaderboard (Plane A) -->
						<Tabs.Content value="casters">
							<section class="mb-8">
								<h2 class="mb-3 text-base font-bold text-tan">
									Caster leaderboard
								</h2>
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
						</Tabs.Content>
					</div>
				</Tabs.Root>
			</div>
		</div>
	</main>
</div>
