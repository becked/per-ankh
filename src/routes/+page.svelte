<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import RecentSaveCard from "$lib/RecentSaveCard.svelte";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import TournamentCard from "$lib/tournament/TournamentCard.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const user = $derived(page.data.user);

	// All-time stats for the signed-in viewer's right-rail card. Mirrors the
	// profile page's identity-card boxes; null when signed out or the
	// best-effort profile fetch failed (boxes are simply hidden then).
	const summary = $derived(data.profileSummary);
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
		summary?.favorite_day_of_week != null
			? DAY_NAMES[summary.favorite_day_of_week]
			: null,
	);
	const winRatePct = $derived(
		summary?.win_rate != null ? Math.round(summary.win_rate * 100) : null,
	);

	// "Active" on the home page = anything not complete. The tournaments
	// listing already separates "Open for signups" + "Active" + "Past";
	// here we collapse them so the home surfaces every in-flight bracket.
	const activeTournaments = $derived(
		data.tournaments.filter((t) => t.status !== "complete").slice(0, 6),
	);

	// The right rail only carries content for signed-in viewers (profile card)
	// or when there are active tournaments. With both absent — the common
	// signed-out case — the recent-saves grid widens to the full row instead
	// of leaving an empty column.
	const hasRail = $derived(!!user || activeTournaments.length > 0);
</script>

<main class="isolate flex flex-1 flex-col overflow-hidden">
	<div
		class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
		use:autohideScroll
	>
		<div class="mx-auto max-w-screen-2xl">
			<!--
			Signed-out hero: a full-width pitch band above the discovery grid.
			Signed-in viewers skip it — they already know the product and want
			straight to the feed.
		-->
			{#if !user}
				<section
					class="mb-4 rounded-lg p-6 sm:p-8"
					style="background-color: #35302b;"
				>
					<h1 class="text-3xl font-bold text-gray-200 sm:text-4xl">
						Parse, analyze and share your Old World games
					</h1>
					<p class="mt-2 text-sm text-tan opacity-90 sm:text-base">
						Upload save files and explore every detail of your games.
					</p>
					<div
						class="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-semibold text-tan"
					>
						<span class="flex items-center gap-2">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-4 w-4 text-orange"
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
						<span class="flex items-center gap-2">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-4 w-4 text-orange"
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
						<span class="flex items-center gap-2">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-4 w-4 text-orange"
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
				</section>
			{/if}

			<!--
			Discovery grid: recently shared saves (dominant, two-up) beside the
			right rail (profile card + active tournaments). When the rail is
			empty the saves span the full row. No wrapper panel — the #35302b
			RecentSaveCards float directly on the page background, matching the
			tournaments-listing pattern.
		-->
			<div class="grid gap-4 lg:grid-cols-12">
				<section class={hasRail ? "lg:col-span-9" : "lg:col-span-12"}>
					{#if data.recentGames.length === 0}
						<p class="text-sm text-tan opacity-70">
							No public saves yet. Be the first — upload a save and toggle
							visibility to public.
						</p>
					{:else}
						<!--
							Signed-in viewers get a single column (their cards sit beside
							the profile/tournaments rail and would compress two-up);
							signed-out viewers get two columns to fill the wider row.
						-->
						<div
							class={user ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}
						>
							{#each data.recentGames as game (game.game_id)}
								<RecentSaveCard {game} />
							{/each}
						</div>
					{/if}
				</section>

				<!-- Right: profile card (signed-in only) + active tournaments -->
				{#if hasRail}
					<aside class="space-y-3 lg:col-span-3">
						{#if user}
							<!-- Whole card links to the viewer's own profile/library. -->
							<a
								href={resolve(`/users/${user.user_id}`)}
								class="block rounded-lg p-3 transition-colors hover:bg-[#3e3833]"
								style="background-color: #35302B;"
							>
								<div class="flex items-center gap-2">
									<img
										src={user.avatar_url}
										alt=""
										class="h-8 w-8 shrink-0 rounded-full"
										width="32"
										height="32"
									/>
									<p class="min-w-0 flex-1 truncate text-sm font-bold text-tan">
										{user.display_name}
									</p>
								</div>

								{#if summary}
									<!-- All-time stat boxes, mirroring the profile identity card. -->
									<div class="mt-3 grid grid-cols-2 gap-1.5">
										<div
											class="rounded px-2 py-1"
											style="background-color: #2a2622;"
										>
											<p class="mb-0.5 text-[10px] font-bold text-gray-400">
												Saves
											</p>
											<p class="text-[10px] font-bold text-tan">
												{summary.total_games}
											</p>
										</div>

										<div
											class="rounded px-2 py-1"
											style="background-color: #2a2622;"
										>
											<p class="mb-0.5 text-[10px] font-bold text-gray-400">
												Win Rate
											</p>
											<p class="text-[10px] font-bold text-tan">
												{#if winRatePct != null}{winRatePct}%{:else}—{/if}
											</p>
										</div>

										<div
											class="rounded px-2 py-1"
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
											class="rounded px-2 py-1"
											style="background-color: #2a2622;"
										>
											<p class="mb-0.5 text-[10px] font-bold text-gray-400">
												Favorite Day
											</p>
											<p class="text-[10px] font-bold text-tan">
												{favoriteDay ?? "—"}
											</p>
										</div>
									</div>
								{/if}
							</a>
						{/if}

						{#if activeTournaments.length > 0}
							<div class="rounded-lg p-3" style="background-color: #35302b;">
								<a
									href={resolve("/tournaments")}
									class="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-200 hover:text-orange"
								>
									<SpriteIcon
										category="icons"
										value="GAME_HELP"
										size={14}
										alt="Tournaments"
									/>
									Tournaments
								</a>
								<div class="space-y-2">
									{#each activeTournaments as t (t.tournament_id)}
										<TournamentCard tournament={t} compact />
									{/each}
								</div>
							</div>
						{/if}
					</aside>
				{/if}
			</div>
		</div>
	</div>
</main>
