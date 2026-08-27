<script lang="ts">
	// User home — a tabbed surface (Overview / Stats / Games) over a single
	// scoped corpus. The scope selector (on the tab row) drives every tab.
	// Tab + scope state live in the URL; the bits-ui Tabs are controlled
	// one-directionally (value derived from ?tab, change → goto) to avoid a
	// state↔URL feedback loop.
	//
	// Mounted by both profile routes — /users/[user_id] and /u/[slug]. It never
	// names either: every URL it writes is derived from the current page.url,
	// so the same markup serves whichever one the visitor arrived on.

	import { Tabs } from "bits-ui";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import Breadcrumb, { type Crumb } from "$lib/Breadcrumb.svelte";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import UserTournamentsTab from "$lib/tournament/UserTournamentsTab.svelte";
	import GamesTable from "$lib/users/GamesTable.svelte";
	import OpponentsTab from "$lib/users/OpponentsTab.svelte";
	import OverviewTab from "$lib/users/OverviewTab.svelte";
	import ScopeRow from "$lib/users/ScopeRow.svelte";
	import VideosTab from "$lib/users/VideosTab.svelte";
	import StatsView from "$lib/stats/StatsView.svelte";
	import { nationName } from "$lib/utils/formatting";
	import type { ProfilePageData } from "$lib/users/profile-load";

	let { data }: { data: ProfilePageData } = $props();

	const bundle = $derived(data.bundle);
	const profile = $derived(data.profile);
	const nationOptions = $derived(data.bundle.nations.map((n) => n.nation));

	// Canonical trail: Home › this user. The avatar stays alongside as
	// profile identity; the breadcrumb leaf is the display name.
	const crumbs: Crumb[] = $derived([
		{ label: "Home", href: resolve("/") },
		{ label: profile.display_name },
	]);

	// Profile-card stats — always over ALL the user's saves (from the
	// profile endpoint), independent of the page's scope selector.
	const summary = $derived(profile.summary);
	const DAY_NAMES = [
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
	];
	const favoriteDay = $derived(
		summary.favorite_day_of_week != null
			? DAY_NAMES[summary.favorite_day_of_week]
			: null,
	);
	const winRatePct = $derived(
		summary.win_rate != null ? Math.round(summary.win_rate * 100) : null,
	);

	// An empty library is a fact about the profile, not about the scope or about
	// any one chart's inputs, so the three save-backed tabs say so once and in
	// the same words. Their own empty states stay for what they're worded for —
	// a non-empty corpus filtered or aggregated down to nothing.
	const hasNoGames = $derived(summary.total_games === 0);

	const triggerClass =
		"cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-tan-hover data-[state=active]:bg-surface-raised data-[state=inactive]:bg-surface";

	async function onTabChange(value: string) {
		if (value === data.tab) return;
		const next = new URL(page.url);
		next.searchParams.set("tab", value);
		// Tab-local params don't carry across tabs.
		if (value !== "stats") next.searchParams.delete("category");
		if (value !== "games") {
			for (const k of ["q", "nation", "result", "date", "sort"]) {
				next.searchParams.delete(k);
			}
		}
		// The scope selector applies to the save-backed tabs; suggested opponents
		// come from the whole rated corpus and ignore it. Dropping it keeps the
		// URL honest about what the page is filtered by.
		if (value === "opponents") next.searchParams.delete("scope");
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		await goto(next, { keepFocus: true, noScroll: true });
	}
</script>

<!-- Shared empty state for Overview / Games / Stats when the library is empty.
     Same type as the tabs' own empty states (GamesTable's), so the Stats tab
     stops being the odd one out in italic brown. -->
{#snippet noGames()}
	<p class="p-8 text-center text-sm text-tan opacity-60">
		{profile.display_name} has not uploaded any games.
	</p>
{/snippet}

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-screen-2xl">
				<!--
					Profile card: identity (left) + all-time stat boxes (right),
					styled like the / game-card stat panels. The stats are over the
					user's whole library — they do NOT track the scope selector.
				-->
				<div class="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
					<div class="flex items-center gap-3">
						<img
							src={profile.avatar_url}
							alt=""
							width="40"
							height="40"
							class="h-10 w-10 rounded-full border-2 border-black"
						/>
						<Breadcrumb {crumbs} class="min-w-0" />
					</div>

					<div class="flex flex-wrap gap-2">
						<div
							class="min-w-[88px] rounded px-2 py-1"
							style="background-color: rgb(var(--color-surface));"
						>
							<p class="mb-0.5 text-[10px] font-bold text-gray-400">Saves</p>
							<p class="text-[10px] font-bold text-bright">
								{summary.total_games}
							</p>
						</div>

						<div
							class="min-w-[88px] rounded px-2 py-1"
							style="background-color: rgb(var(--color-surface));"
						>
							<p class="mb-0.5 text-[10px] font-bold text-gray-400">Win Rate</p>
							<p class="text-[10px] font-bold text-bright">
								{#if winRatePct != null}{winRatePct}%{:else}—{/if}
							</p>
						</div>

						<div
							class="min-w-[88px] rounded px-2 py-1"
							style="background-color: rgb(var(--color-surface));"
						>
							<p
								class="mb-0.5 flex items-center gap-1 text-[10px] font-bold text-gray-400"
							>
								{#if summary.favorite_nation}
									<SpriteIcon
										category="crests"
										value={summary.favorite_nation}
										size={10}
										alt={nationName(summary.favorite_nation)}
									/>
								{/if}
								Favorite Nation
							</p>
							<p class="text-[10px] font-bold text-bright">
								{summary.favorite_nation
									? nationName(summary.favorite_nation)
									: "—"}
							</p>
						</div>

						<div
							class="min-w-[88px] rounded px-2 py-1"
							style="background-color: rgb(var(--color-surface));"
						>
							<p class="mb-0.5 text-[10px] font-bold text-gray-400">
								Favorite Day
							</p>
							<p class="text-[10px] font-bold text-bright">
								{favoriteDay ?? "—"}
							</p>
						</div>
					</div>

					<!-- Scope selector, aligned with the profile card. -->
					<div class="ml-auto">
						<ScopeRow
							collections={data.collections}
							scopeCounts={data.scopeCounts}
							scope={data.scope}
							isOwner={data.isOwner}
						/>
					</div>
				</div>

				<Tabs.Root value={data.tab} onValueChange={onTabChange}>
					<!-- Tabs live inside the light-brown panel; the list is a floating
					     chip bar matching the stats subtabs. -->
					<div
						class="rounded-lg p-4"
						style="background-color: rgb(var(--color-surface-raised));"
					>
						<Tabs.List
							class="mb-4 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
						>
							<Tabs.Trigger value="overview" class={triggerClass}
								>Overview</Tabs.Trigger
							>
							<Tabs.Trigger value="games" class={triggerClass}
								>Games</Tabs.Trigger
							>
							{#if data.isTournamentParticipant}
								<Tabs.Trigger value="tournaments" class={triggerClass}
									>Tournaments</Tabs.Trigger
								>
							{/if}
							{#if data.hasChannels}
								<Tabs.Trigger value="videos" class={triggerClass}
									>Videos</Tabs.Trigger
								>
							{/if}
							<Tabs.Trigger value="stats" class={triggerClass}
								>Stats</Tabs.Trigger
							>
							<!-- Owner-only, and the padlock says so — every other tab on this
						     bar is the same for whoever is looking, so a tab that isn't
						     needs to announce itself rather than leave the owner wondering
						     who else can read it. -->
							{#if data.isOwner}
								<Tabs.Trigger
									value="opponents"
									class="{triggerClass} flex items-center gap-1.5"
									title="Only you can see this"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-3.5 w-3.5"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										stroke-width="2"
										aria-hidden="true"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
										/>
									</svg>
									Opponents
								</Tabs.Trigger>
							{/if}
						</Tabs.List>

						<Tabs.Content value="overview">
							{#if hasNoGames}
								{@render noGames()}
							{:else}
								<OverviewTab {bundle} />
							{/if}
						</Tabs.Content>

						<Tabs.Content value="games">
							{#if hasNoGames}
								{@render noGames()}
							{:else if data.tab === "games"}
								<GamesTable
									userId={profile.user_id}
									initialGames={data.games}
									total={data.gamesTotal}
									pageSize={data.pageSize}
									q={data.q}
									nation={data.nation}
									result={data.result}
									date={data.date}
									sort={data.sort}
									{nationOptions}
								/>
							{/if}
						</Tabs.Content>

						{#if data.isTournamentParticipant}
							<Tabs.Content value="tournaments">
								<!-- Payload loads lazily with the tab (mirrors Videos), so it's
								     null until then. -->
								{#if data.tournamentRecord}
									<UserTournamentsTab record={data.tournamentRecord} />
								{/if}
							</Tabs.Content>
						{/if}

						{#if data.hasChannels}
							<Tabs.Content value="videos">
								<VideosTab videos={data.videos} />
							</Tabs.Content>
						{/if}

						<Tabs.Content value="stats">
							{#if hasNoGames}
								{@render noGames()}
							{:else}
								<StatsView {bundle} />
							{/if}
						</Tabs.Content>

						{#if data.isOwner}
							<Tabs.Content value="opponents">
								<!-- Payload loads lazily with the tab (mirrors Videos and
								     Tournaments), so it's null until then. -->
								{#if data.suggestions}
									<OpponentsTab
										suggestions={data.suggestions}
										openToMatches={page.data.user?.open_to_matches ?? true}
									/>
								{/if}
							</Tabs.Content>
						{/if}
					</div>
				</Tabs.Root>
			</div>
		</div>
	</main>
</div>
