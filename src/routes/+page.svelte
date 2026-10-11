<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import CreatorVideos from "$lib/CreatorVideos.svelte";
	import DiscordLoginButton from "$lib/DiscordLoginButton.svelte";
	import DiscordMark from "$lib/ui/DiscordMark.svelte";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import RecentSaveCard from "$lib/RecentSaveCard.svelte";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import FeaturedScreenshotStrip from "$lib/screenshots/FeaturedScreenshotStrip.svelte";
	import FeaturedTournamentPanel from "$lib/home/FeaturedTournamentPanel.svelte";
	import CommunityToolsPanel from "$lib/home/CommunityToolsPanel.svelte";
	import HomeStatsPanel from "$lib/home/HomeStatsPanel.svelte";
	import SeasonStandingsPanel from "$lib/home/SeasonStandingsPanel.svelte";
	import YourSeasonPanel from "$lib/home/YourSeasonPanel.svelte";
	import {
		homeArchetypeRows,
		homeCapitalFamilyRows,
		homeNationPickRateRows,
	} from "$lib/home/home-stats";
	import Panel from "$lib/ui/Panel.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const user = $derived(page.data.user);

	// The stats panel's three lists, built together or not at all — the payload
	// is one envelope, so there is no state where one of them has data. A cache
	// miss (or a failed fetch) is `null`, and the page drops the whole stats
	// panel rather than laying out three empty insets; the tools panel beside it
	// keeps its column, the same way the discovery grid closes up on an empty
	// feed.
	const stats = $derived.by(() => {
		const summary = data.homeSummary;
		if (!summary) return null;
		return {
			nationPickRate: homeNationPickRateRows(summary),
			capitalFamily: homeCapitalFamilyRows(summary),
			archetype: homeArchetypeRows(summary),
		};
	});

	// The videos column only exists when a creator or a tournament playlist has
	// recent uploads (empty on a cold feed cache). It's the only thing that
	// varies the discovery grid below: present, it takes half the row and the
	// games feed keeps its cards in one column; absent, the feed spans the row
	// on its own and the cards go two-up.
	const hasVideos = $derived(data.videos.length > 0);

	// The curated strip is empty until an admin stars something, and a starred
	// screenshot can stop being one (a takedown clears the star), so the panel
	// drops out entirely rather than rendering its own empty state — the
	// drop-a-region rule the videos column and the stats panel follow.
	const hasScreenshots = $derived(data.screenshots.length > 0);
</script>

<main class="isolate flex flex-1 flex-col overflow-hidden">
	<div
		class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
		use:autohideScroll
	>
		<div class="mx-auto max-w-screen-2xl">
			<!--
			The call to action, on one narrow full-width row: the pitch on the left,
			the action on the right, stacking on mobile. Both viewers get the band —
			only the action differs (sign in vs. a link into your own games), so the
			whole page reads the same signed in or out.
			-->
			<section
				class="mb-4 flex flex-col gap-3 rounded-lg px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6"
				style="background-color: rgb(var(--color-surface-raised));"
			>
				<!--
				Pitch + pills travel together as the left cluster, a fixed `sm:gap-8`
				apart, so the pills read as part of the pitch instead of floating in
				the middle. All the row's slack lands between this cluster and the
				action (the section's `justify-between`), which keeps the pitch→pills
				spacing identical at every window width.
				-->
				<div
					class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-8"
				>
					<div class="min-w-0">
						<h1 class="text-xl font-bold text-gray-200 sm:text-2xl">
							Parse, analyze and share your Old World games
						</h1>
						<p class="mt-1 text-sm text-tan opacity-90">
							Upload save files and explore every detail of your games.{#if !user}
								Sign in with Discord to get started.{/if}
						</p>
					</div>

					<!--
					The three feature pills. A vertical list at this size: the band is a
					third the height of the panel they used to sit in as a wrapping row,
					and stacked they fill it instead of forcing it taller.
					-->
					<div
						class="flex shrink-0 flex-col gap-1 text-xs font-semibold text-tan"
					>
						<span class="flex items-center gap-1.5">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-3.5 w-3.5 text-orange"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2"
								aria-hidden="true"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.281m5.94 2.28l-2.28 5.941"
								/>
							</svg>
							Interactive charts
						</span>
						<span class="flex items-center gap-1.5">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-3.5 w-3.5 text-orange"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2"
								aria-hidden="true"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
								/>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
								/>
							</svg>
							Explorable map
						</span>
						<span class="flex items-center gap-1.5">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-3.5 w-3.5 text-orange"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2"
								aria-hidden="true"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"
								/>
							</svg>
							Share saves
						</span>
					</div>
				</div>

				<!--
					The action, widening left to right from the whole public corpus to your
					own games, the profile link carrying the same avatar the header shows so
					it reads as "you". Signed out none of that is openable — /stats bounces
					an anonymous visitor to login — so the cluster is the same button the
					header's Login is, sized as a call to action. The players roster is not
					here: the season standings panel below is the link to it.
					-->
				<div
					class="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-auto"
				>
					{#if user}
						<a
							href={resolve("/stats")}
							class="inline-flex items-center gap-2 rounded-md bg-[#292623] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:text-orange"
						>
							<SpriteIcon category="icons" value="STATS" size={24} alt="" />
							Global Stats
						</a>
						<ProfileLink
							userId={user.user_id}
							slug={user.slug}
							class="inline-flex items-center gap-2 rounded-md bg-[#292623] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:text-orange"
						>
							<img
								src={user.avatar_url}
								alt=""
								class="h-6 w-6 rounded-full border border-black"
								width="24"
								height="24"
							/>
							Your Games
						</ProfileLink>
					{:else}
						<DiscordLoginButton
							label="Continue with Discord"
							class="inline-flex items-center gap-2 rounded-md bg-[#5865F2] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#4752c4] disabled:opacity-60"
						>
							<DiscordMark class="h-5 w-5" />
						</DiscordLoginButton>
					{/if}
				</div>
			</section>

			<!--
			Row 1 — the live half of the page: the featured tournament on the left,
			the season boards on the right. Both halves are about people playing
			right now, which is what the page leads with once a visitor knows what
			the site is (the call to action above answers that).
			-->
			<div class="mb-4 grid gap-4 lg:grid-cols-2">
				{#if data.featured}
					<FeaturedTournamentPanel
						tournament={data.featured.tournament}
						standings={data.featured.standings}
						matches={data.featured.matches}
					/>
				{/if}

				<!--
				The season pair. Signed out there is no "Your season" to show, so the
				standings panel spans the half on its own — the same drop-a-region
				rule the video column follows, rather than a signed-out placeholder.
				-->
				<div
					class={`grid gap-4 sm:grid-cols-2 ${data.featured ? "" : "lg:col-span-2"}`}
				>
					<SeasonStandingsPanel
						players={data.seasonPlayers}
						seasonLabel={data.season.label}
						class={data.yourSeason ? "" : "sm:col-span-2"}
					/>
					{#if data.yourSeason}
						<YourSeasonPanel
							displayName={data.yourSeason.displayName}
							avatarUrl={data.yourSeason.avatarUrl}
							rank={data.yourSeason.rank}
							games={data.yourSeason.games}
							allTimeGames={data.yourSeason.allTimeGames}
							winRate={data.yourSeason.winRate}
							cognomen={data.yourSeason.cognomen}
							seasonUntil={data.season.until}
						/>
					{/if}
				</div>
			</div>

			<!--
			Row 2 — the stats tray, then the community tools. The three lists are
			insets of one panel rather than three panels of their own: they are one
			board read together, and at four panels across the row repeated the
			panel chrome three times to say so. At `lg` an inset is still the
			standings panel's width and reads the same way: a rank, a crest, a name
			and two numbers. That is also why these are lists at all — a horizontal
			bar spends 140px on its label gutter before the first pixel of plot,
			which is most of a panel this wide.

			The stats can be absent — with no summary the tools list is the row's only
			panel, at the width it would have had beside them.
			-->
			<div class="mb-4 grid gap-4 lg:grid-cols-4">
				{#if stats}
					<HomeStatsPanel
						nationPickRate={stats.nationPickRate}
						capitalFamily={stats.capitalFamily}
						archetype={stats.archetype}
						class="lg:col-span-3"
					/>
				{/if}

				<!--
				The outbound tools, in the slot the featured video tile held: featuring a
				video now promotes it to the front of the Recent Videos strip below
				instead of giving it a card of its own up here.
				-->
				<CommunityToolsPanel />
			</div>

			<!--
			The curated screenshots, on a full-width row of their own immediately
			above the rest of the discovery region: these are 8:5 images that have to
			read as one row, which a half-width column beside the games feed can't
			give them. Only admin-starred screenshots are here — the strip IS the
			curation, unlike a starred video, which is promoted to the front of a feed
			that exists anyway.
			-->
			{#if hasScreenshots}
				<Panel title="Screenshots" class="mb-4">
					<FeaturedScreenshotStrip screenshots={data.screenshots} />
				</Panel>
			{/if}

			<!--
			Discovery grid (desktop): recent saves (left) → videos (right). A column
			with no content drops out and its neighbour widens. Each column is a
			titled Panel, the same chrome the hero row uses.
		-->
			<!--
				On mobile the grid stacks in DOM order; `order` utilities lift the
				videos above the long games feed there, while `lg:order-*` restores
				the desktop left→right (games → videos) arrangement.
			-->
			<div class="grid gap-4 lg:grid-cols-2">
				<Panel
					title="Recent Games"
					class={`order-2 lg:order-1 ${hasVideos ? "" : "lg:col-span-2"}`}
				>
					{#if data.recentGames.length === 0}
						<p class="text-sm text-tan opacity-70">
							No public saves yet. Be the first — upload a save and toggle
							visibility to public.
						</p>
					{:else}
						<div
							class={hasVideos
								? "grid grid-cols-1 gap-3"
								: "grid grid-cols-2 gap-3"}
						>
							{#each data.recentGames as game (game.game_id)}
								<RecentSaveCard {game} />
							{/each}
						</div>
					{/if}
				</Panel>

				<!--
				Videos: creator uploads and tournament-playlist uploads merged into one
				strip — right column on desktop, full-width on smaller screens (the
				component handles the responsive grid). `self-start` keeps it at its
				content height instead of stretching to the (much taller) games column,
				so it ends after its last card. Omitted entirely on a cold/empty feed
				rather than leaving a gap.
			-->
				{#if hasVideos}
					<Panel title="Recent Videos" class="order-1 self-start lg:order-2">
						<CreatorVideos videos={data.videos} />
					</Panel>
				{/if}
			</div>
		</div>
	</div>
</main>
