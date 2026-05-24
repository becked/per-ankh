<script lang="ts">
	// User home — a tabbed surface (Overview / Stats / Games) over a single
	// scoped corpus. The scope selector (on the tab row) drives every tab.
	// Tab + scope state live in the URL; the bits-ui Tabs are controlled
	// one-directionally (value derived from ?tab, change → goto) to avoid a
	// state↔URL feedback loop.

	import { Tabs } from "bits-ui";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import GamesTable from "$lib/users/GamesTable.svelte";
	import OverviewTab from "$lib/users/OverviewTab.svelte";
	import ScopeRow from "$lib/users/ScopeRow.svelte";
	import StatsView from "$lib/stats/StatsView.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const bundle = $derived(data.bundle);
	const profile = $derived(data.profile);
	const nationOptions = $derived(data.bundle.nations.map((n) => n.nation));

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

	const triggerClass =
		"cursor-pointer rounded px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-tan-hover data-[state=active]:bg-[#35302B] data-[state=inactive]:bg-[#2a2622]";

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
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- search-param-only update on the current route; URL objects are SvelteKit's documented dynamic-nav API
		await goto(next, { keepFocus: true, noScroll: true });
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
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
					<h1 class="text-2xl font-bold text-gray-200">
						{profile.display_name}
					</h1>
				</div>

				<div class="flex flex-wrap gap-2">
					<div
						class="min-w-[88px] rounded px-2 py-1"
						style="background-color: #2a2622;"
					>
						<p class="mb-0.5 text-[10px] font-bold text-gray-400">Saves</p>
						<p class="text-[10px] font-bold text-tan">
							{summary.total_games}
						</p>
					</div>

					<div
						class="min-w-[88px] rounded px-2 py-1"
						style="background-color: #2a2622;"
					>
						<p class="mb-0.5 text-[10px] font-bold text-gray-400">Win Rate</p>
						<p class="text-[10px] font-bold text-tan">
							{#if winRatePct != null}{winRatePct}%{:else}—{/if}
						</p>
					</div>

					<div
						class="min-w-[88px] rounded px-2 py-1"
						style="background-color: #2a2622;"
					>
						<p
							class="mb-0.5 flex items-center gap-1 text-[10px] font-bold text-gray-400"
						>
							{#if summary.favorite_nation}
								<SpriteIcon
									category="crests"
									value={summary.favorite_nation}
									size={10}
									alt={formatEnum(summary.favorite_nation, "NATION_")}
								/>
							{/if}
							Favorite Nation
						</p>
						<p class="text-[10px] font-bold text-tan">
							{summary.favorite_nation
								? formatEnum(summary.favorite_nation, "NATION_")
								: "—"}
						</p>
					</div>

					<div
						class="min-w-[88px] rounded px-2 py-1"
						style="background-color: #2a2622;"
					>
						<p class="mb-0.5 text-[10px] font-bold text-gray-400">
							Favorite Day
						</p>
						<p class="text-[10px] font-bold text-tan">{favoriteDay ?? "—"}</p>
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
				<div class="rounded-lg p-4" style="background-color: #35302B;">
					<Tabs.List
						class="mb-4 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-[#2a2622] bg-[#241f1b] p-2 shadow-lg"
					>
						<Tabs.Trigger value="overview" class={triggerClass}
							>Overview</Tabs.Trigger
						>
						<Tabs.Trigger value="games" class={triggerClass}>Games</Tabs.Trigger>
						<Tabs.Trigger value="stats" class={triggerClass}>Stats</Tabs.Trigger>
					</Tabs.List>

					<Tabs.Content value="overview">
						<OverviewTab {bundle} />
					</Tabs.Content>

					<Tabs.Content value="games">
						{#if data.tab === "games"}
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

					<Tabs.Content value="stats">
						<StatsView {bundle} />
					</Tabs.Content>
				</div>
			</Tabs.Root>
		</div>
	</main>
</div>
