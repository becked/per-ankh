<script lang="ts">
	// Tournament stats page. Three tabs — Players (standings), Nations (nation
	// win rate), Casters (caster leaderboard) — spanning both stats subsystems:
	// Plane A tournament-native (standings + casters) and Plane B1 (the
	// ChartBundle pointed at the tournament's games). Renders the charts directly
	// (no chart registry) through the shared ChartContainer, reusing the chart
	// theme/grid; the tab bar mirrors the user-stats chip tabs.
	import { Tabs } from "bits-ui";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { barChartHeight } from "$lib/stats/charts/helpers";
	import { nationWinLossStackedOption } from "$lib/stats/charts/nations";
	import {
		AVATAR_LABEL_SIZE,
		casterLeaderboardOption,
		playerPicksOption,
		standingsOption,
	} from "$lib/tournament/stats-charts";
	import { loadCircularAvatars } from "$lib/utils/avatars";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

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
	const playerPicks = $derived(data.competition.player_picks);
	const nationWinRate = $derived(data.games.nationWinRate);

	// Circular avatar images for the players/casters axis labels, rasterized
	// client-side from the Discord CDN (ECharts rich-text labels can't round
	// remote images — see $lib/utils/avatars). Undefined until loaded: the
	// charts first render name-only labels, then rebuild with avatars.
	let standingsAvatars = $state<(string | undefined)[]>();
	let casterAvatars = $state<(string | undefined)[]>();
	let playerPicksAvatars = $state<(string | undefined)[]>();
	// Shared $effect body: rasterize the rows' avatars and assign on resolve.
	// Returns the effect cleanup, whose stale flag drops a late resolution
	// after the rows change (navigation, data refresh).
	function trackAvatars(
		rows: { avatar_url: string | null }[],
		// eslint-disable-next-line no-unused-vars -- callback signature
		assign: (imgs: (string | undefined)[]) => void,
	) {
		let stale = false;
		void loadCircularAvatars(
			rows.map((r) => r.avatar_url),
			AVATAR_LABEL_SIZE,
		).then((imgs) => {
			if (!stale) assign(imgs);
		});
		return () => {
			stale = true;
		};
	}
	$effect(() =>
		trackAvatars(standingsRows, (imgs) => (standingsAvatars = imgs)),
	);
	$effect(() =>
		trackAvatars(playerPicks, (imgs) => (playerPicksAvatars = imgs)),
	);
	$effect(() => trackAvatars(casters, (imgs) => (casterAvatars = imgs)));

	// The active tab lives in ?category (controlled: value derived from the
	// URL, change → goto), mirroring the user-stats subtabs (StatsView) so a
	// tab is deep-linkable and survives refresh.
	const TABS = ["players", "nations", "casters"] as const;
	type StatsTab = (typeof TABS)[number];
	const tab = $derived.by<StatsTab>(() => {
		const fromUrl = page.url.searchParams.get("category");
		return TABS.find((t) => t === fromUrl) ?? "players";
	});

	async function onTabChange(value: string) {
		const next = new URL(page.url);
		next.searchParams.set("category", value);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		await goto(next, { replaceState: true, keepFocus: true, noScroll: true });
	}

	// Chip-style tab triggers, matching the user-stats subtabs.
	const triggerClass =
		"cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-tan-hover data-[state=active]:bg-surface-raised data-[state=inactive]:bg-surface";
</script>

<Tabs.Root value={tab} onValueChange={onTabChange}>
	<!-- Tabs live inside the raised panel, matching the user-stats page;
	     the list is a floating chip bar. -->
	<div
		class="rounded-lg p-4"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<Tabs.List
			class="mb-4 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
		>
			<Tabs.Trigger value="players" class={triggerClass}>Players</Tabs.Trigger>
			<Tabs.Trigger value="nations" class={triggerClass}>Nations</Tabs.Trigger>
			<Tabs.Trigger value="casters" class={triggerClass}>Casters</Tabs.Trigger>
		</Tabs.List>

		<!-- Players — standings + per-player nation picks (Plane A) -->
		<Tabs.Content value="players">
			<section class="mb-8">
				<h2 class="mb-3 text-base font-bold text-tan">Standings</h2>
				{#if standingsRows.length > 0}
					<ChartContainer
						option={standingsOption(standingsRows, standingsAvatars)}
						height={barChartHeight(standingsRows.length)}
						title="Standings"
					/>
				{:else}
					<p class="p-8 text-center italic text-tan opacity-60">
						No games played yet.
					</p>
				{/if}
			</section>

			<section class="mb-8">
				<h2 class="mb-3 text-base font-bold text-tan">Nation picks</h2>
				{#if playerPicks.length > 0}
					<ChartContainer
						option={playerPicksOption(playerPicks, playerPicksAvatars)}
						height={barChartHeight(playerPicks.length)}
						title="Nation picks"
					/>
				{:else}
					<p class="p-8 text-center italic text-tan opacity-60">
						No completed games yet.
					</p>
				{/if}
			</section>
		</Tabs.Content>

		<!-- Nations — nation win rate (Plane B1) -->
		<Tabs.Content value="nations">
			<section class="mb-8">
				<h2 class="mb-3 text-base font-bold text-tan">Nation win rate</h2>
				{#if nationWinRate.length > 0}
					<ChartContainer
						option={nationWinLossStackedOption(data.games)}
						height={barChartHeight(nationWinRate.length)}
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
				<h2 class="mb-3 text-base font-bold text-tan">Caster leaderboard</h2>
				{#if casters.length > 0}
					<ChartContainer
						option={casterLeaderboardOption(casters, casterAvatars)}
						height={barChartHeight(casters.length)}
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
