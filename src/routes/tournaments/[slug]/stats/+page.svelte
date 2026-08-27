<script lang="ts">
	// Tournament stats page. Eight tabs — Matches (the sortable match list,
	// each row linking to its uploaded game), Players (standings + nation
	// picks), Nations (nation win rate), Leaders (starting archetype and
	// traits), Wonders (build timing and builder win rate), Families (capital
	// family + per-nation picks), Yields (per-turn curves) and Casters (caster
	// leaderboard) — spanning both stats
	// subsystems: Plane A tournament-native (standings + casters) and Plane B1
	// (the ChartBundle pointed at the tournament's games). Renders the charts
	// directly (no chart registry) through the shared ChartContainer, reusing the
	// chart theme/grid; the tab bar mirrors the user-stats chip tabs.
	import { Tabs } from "bits-ui";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import MatchTable from "$lib/tournament/MatchTable.svelte";
	import {
		filterMatchRows,
		matchStatusGroup,
		pickColumns,
		sortMatchRows,
		toMatchRows,
		toggleMatchSort,
		type MatchStatusGroup,
		type MatchTableState,
	} from "$lib/tournament/matches-table";
	import { MATCH_STATUS_LABEL } from "$lib/tournament/parts";
	import { buildSlotMaps } from "$lib/tournament/slot-identity";
	import { getZoneClock } from "$lib/tournament/zone-context.svelte";
	import FamilyKeepsPanel from "$lib/stats/FamilyKeepsPanel.svelte";
	import FamilyStatsPanel from "$lib/stats/FamilyStatsPanel.svelte";
	import YieldsStatsPanel from "$lib/stats/YieldsStatsPanel.svelte";
	import { barChartHeight } from "$lib/stats/charts/helpers";
	import {
		ARCHETYPE_EMPTY_MESSAGE,
		TRAIT_EMPTY_MESSAGE,
		startingArchetypeWinLossOption,
		startingTraitWinLossOption,
		visibleTraitRowCount,
	} from "$lib/stats/charts/leaders";
	import { nationWinLossStackedOption } from "$lib/stats/charts/nations";
	import {
		WONDER_EMPTY_MESSAGE,
		wonderOverviewOption,
	} from "$lib/stats/charts/wonders";
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

	// Match list — the shared match table pointed at the layout's match load
	// (all matches, byes filtered by toMatchRows), with the game facts columns.
	// Default order is the global match number; headers re-sort. The live slot
	// maps back the pending rows' names (completed rows carry their snapshot).
	const slotMaps = $derived(buildSlotMaps(data.standings, data.bracket));
	const matchColumns = pickColumns(["number", "matchup", "time", "game"]);
	// The tournament-wide UTC/local clock the [slug] layout owns and the header
	// toggle drives — shown on Stats too, so the scheduled times here have to
	// follow it rather than pin to local.
	const clock = getZoneClock();
	// A status segment facets the list through MatchTableState.filters.
	// Completed by default — the list's job is finding played games — with the
	// other buckets one segment away. "All" is the empty selection filterMatchRows
	// already reads as "no filter", so the segment carries no special case.
	let matchesTableState = $state<MatchTableState>({
		sortColumn: "number",
		sortDirection: "asc",
		filters: ["completed"],
	});
	const allMatchRows = $derived(toMatchRows(data.matches));
	// One bucket at a time, All first. Labels reuse the shared status wording;
	// unscheduled has no badge label (deliberately — see MATCH_STATUS_LABEL), so
	// it's named here.
	type MatchStatusSegment = MatchStatusGroup | "all";
	const STATUS_SEGMENTS: Array<{ key: MatchStatusSegment; label: string }> = [
		{ key: "all", label: "All" },
		{ key: "completed", label: MATCH_STATUS_LABEL.completed },
		{ key: "in_progress", label: MATCH_STATUS_LABEL.in_progress },
		{ key: "scheduled", label: MATCH_STATUS_LABEL.scheduled },
		{ key: "unscheduled", label: "Unscheduled" },
	];
	// Segmented-control tokens, matching the matches page's view switch.
	const statusTriggerClass =
		"relative z-10 cursor-pointer whitespace-nowrap px-3 py-1.5 text-center text-xs font-bold text-tan transition-colors";
	// The lit segment reads back out of filters rather than shadowing it in a
	// second state field, so the control can never disagree with the table.
	const activeStatus = $derived<MatchStatusSegment>(
		STATUS_SEGMENTS.find((s) => s.key === matchesTableState.filters[0])?.key ??
			"all",
	);
	function selectStatus(key: MatchStatusSegment) {
		matchesTableState.filters = key === "all" ? [] : [key];
	}
	const statusCounts = $derived.by(() => {
		const counts: Partial<Record<MatchStatusSegment, number>> = {
			all: allMatchRows.length,
		};
		for (const row of allMatchRows) {
			const group = matchStatusGroup(row.match);
			if (group !== null) counts[group] = (counts[group] ?? 0) + 1;
		}
		return counts;
	});
	const matchRows = $derived(
		sortMatchRows(
			filterMatchRows(allMatchRows, matchesTableState.filters),
			matchesTableState.sortColumn,
			matchesTableState.sortDirection,
			{ slotLabels: slotMaps.labels },
		),
	);
	const nationWinRate = $derived(data.games.nationWinRate);
	const startingArchetypes = $derived(data.games.startingArchetypeWinRate);
	const startingTraits = $derived(data.games.startingTraitWinRate);
	const wonders = $derived(data.games.wonderStats);

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
	const TABS = [
		"matches",
		"players",
		"nations",
		"leaders",
		"wonders",
		"families",
		"family-fielded",
		"yields",
		"casters",
	] as const;
	type StatsTab = (typeof TABS)[number];
	const tab = $derived.by<StatsTab>(() => {
		const fromUrl = page.url.searchParams.get("category");
		return TABS.find((t) => t === fromUrl) ?? "matches";
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
			<Tabs.Trigger value="matches" class={triggerClass}>Matches</Tabs.Trigger>
			<Tabs.Trigger value="players" class={triggerClass}>Players</Tabs.Trigger>
			<Tabs.Trigger value="nations" class={triggerClass}>Nations</Tabs.Trigger>
			<Tabs.Trigger value="leaders" class={triggerClass}>Leaders</Tabs.Trigger>
			<Tabs.Trigger value="wonders" class={triggerClass}>Wonders</Tabs.Trigger>
			<Tabs.Trigger value="families" class={triggerClass}>Families</Tabs.Trigger
			>
			<Tabs.Trigger value="family-fielded" class={triggerClass}
				>Families fielded</Tabs.Trigger
			>
			<Tabs.Trigger value="yields" class={triggerClass}>Yields</Tabs.Trigger>
			<Tabs.Trigger value="casters" class={triggerClass}>Casters</Tabs.Trigger>
		</Tabs.List>

		<!-- Matches — every match as a sortable list (default: match-number
		     order, completed via the status switch), each side showing its
		     nation crest + starting-ruler archetype glyph and the winner
		     emphasized, with a per-row link to the uploaded game. The list form
		     of the brackets, for finding and opening games. -->
		<Tabs.Content value="matches">
			<section class="mb-8">
				<h2 class="mb-3 text-base font-bold text-tan">Matches</h2>
				<!-- Status switch: one bucket at a time with its count, the lit
				     segment sliding across (the matches page's view switch, and the
				     game detail tabs', in the same construct). All comes first so
				     widening back out is one click from anywhere. -->
				<div
					class="relative mb-3 grid w-fit overflow-hidden rounded-lg border-2 border-surface"
					style="background-color: rgb(var(--color-surface)); grid-template-columns: repeat({STATUS_SEGMENTS.length}, minmax(0, 1fr));"
					role="group"
					aria-label="Match status"
				>
					<div
						class="pointer-events-none absolute inset-y-0 left-0 transition-transform duration-200 ease-out"
						style:width="{100 / STATUS_SEGMENTS.length}%"
						style:background-color="rgb(var(--color-surface-raised))"
						style:transform="translateX({STATUS_SEGMENTS.findIndex(
							(s) => s.key === activeStatus,
						) * 100}%)"
					></div>
					{#each STATUS_SEGMENTS as segment (segment.key)}
						<button
							type="button"
							class={statusTriggerClass}
							aria-pressed={activeStatus === segment.key}
							onclick={() => selectStatus(segment.key)}
						>
							{segment.label}
							<span class="ml-1 opacity-60"
								>{statusCounts[segment.key] ?? 0}</span
							>
						</button>
					{/each}
				</div>
				<MatchTable
					columns={matchColumns}
					rows={matchRows}
					zone={clock.zone}
					tournament={data.tournament}
					user={null}
					slotLabels={slotMaps.labels}
					slotUserIds={slotMaps.userIds}
					slotSlugs={slotMaps.slugs}
					slotAvatars={slotMaps.avatars}
					sortColumn={matchesTableState.sortColumn}
					sortDirection={matchesTableState.sortDirection}
					onSort={(key) => toggleMatchSort(matchesTableState, key)}
					emptyMessage={matchesTableState.filters.length > 0
						? "No matches with the selected status."
						: "No matches yet."}
				/>
			</section>
		</Tabs.Content>

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

		<!-- Leaders — the starting leader each player was dealt (Plane B1):
		     archetype and the traits they began with, each as games played
		     split by outcome. -->
		<Tabs.Content value="leaders">
			<section class="mb-8">
				<h2 class="mb-3 text-base font-bold text-tan">Starting archetype</h2>
				{#if startingArchetypes.length > 0}
					<ChartContainer
						option={startingArchetypeWinLossOption(data.games)}
						height={barChartHeight(startingArchetypes.length)}
						title="Starting archetype"
					/>
				{:else}
					<p class="p-8 text-center italic text-tan opacity-60">
						{ARCHETYPE_EMPTY_MESSAGE}
					</p>
				{/if}
			</section>

			<section class="mb-8">
				<h2 class="mb-3 text-base font-bold text-tan">
					Starting leader traits
				</h2>
				{#if startingTraits.length > 0}
					<ChartContainer
						option={startingTraitWinLossOption(data.games)}
						height={barChartHeight(visibleTraitRowCount(data.games))}
						title="Starting leader traits"
					/>
				{:else}
					<p class="p-8 text-center italic text-tan opacity-60">
						{TRAIT_EMPTY_MESSAGE}
					</p>
				{/if}
			</section>
		</Tabs.Content>

		<!-- Wonders — when each wonder lands (a P25–P75 bar colored by the
		     builders' outcome) and how often the players who could build it did
		     (Plane B1). -->
		<Tabs.Content value="wonders">
			<section class="mb-8">
				<h2 class="mb-3 text-base font-bold text-tan">Wonder built win rate</h2>
				{#if wonders.length > 0}
					<ChartContainer
						option={wonderOverviewOption(data.games)}
						height={barChartHeight(wonders.length)}
						title="Wonder built win rate"
					/>
				{:else}
					<p class="p-8 text-center italic text-tan opacity-60">
						{WONDER_EMPTY_MESSAGE}
					</p>
				{/if}
			</section>
		</Tabs.Content>

		<!-- Families — which class ran the capital, then which classes each
		     nation's players run and the city footprint behind each. The same
		     panel the player page uses, pointed at the tournament's games
		     (Plane B1). -->
		<Tabs.Content value="families">
			<FamilyStatsPanel bundle={data.games} />
		</Tabs.Content>

		<!-- Which families this event's field refuses to put on the board — a
		     choice measured against the pool's chance level, where the Families
		     tab beside it measures outcomes. -->
		<Tabs.Content value="family-fielded">
			<FamilyKeepsPanel bundle={data.games} />
		</Tabs.Content>

		<!-- Yields — per-turn yield curves across the tournament's games
		     (Plane B1). Focal is every human, so an unsplit sample is one
		     player-game, not one game; the split cohorts are games. -->
		<Tabs.Content value="yields">
			<YieldsStatsPanel bundle={data.games} countLabel="Players" />
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
