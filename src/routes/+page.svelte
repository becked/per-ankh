<script lang="ts">
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import CreatorVideos from "$lib/CreatorVideos.svelte";
	import RecentSaveCard from "$lib/RecentSaveCard.svelte";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import TournamentCard from "$lib/tournament/TournamentCard.svelte";
	import { cloudApi, ApiError } from "$lib/api-cloud";
	import { resolveLoginNext } from "$lib/utils/safe-next";
	import { formatEnum } from "$lib/utils/formatting";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const user = $derived(page.data.user);

	// Signed-out hero CTA. Mirrors the header's login button: kicks off the
	// Discord OAuth round-trip and returns the viewer to this page via `next`.
	let signingIn = $state(false);
	let loginError = $state<string | null>(null);

	async function handleSignIn() {
		signingIn = true;
		loginError = null;
		try {
			const redirectUri = `${window.location.origin}/auth/callback`;
			const next = resolveLoginNext(page.url);
			const { authorize_url } = await cloudApi.discordStart(redirectUri, next);
			window.location.href = authorize_url;
		} catch (err) {
			signingIn = false;
			loginError =
				err instanceof ApiError
					? `${err.code ?? err.status}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Login failed";
		}
	}

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
	// signed-out case — the recent-saves grid widens instead of leaving an
	// empty column.
	const hasRail = $derived(!!user || activeTournaments.length > 0);

	// The creator-videos column only exists when a creator has recent uploads
	// (empty on a cold feed cache). When present it sits between the games feed
	// and the rail; the games column narrows to make room.
	const hasVideos = $derived(data.creatorVideos.length > 0);

	// Desktop column widths (12-col grid). The games feed dominates and gives up
	// width as the videos column and/or rail claim their 3-col slots; with both
	// absent it spans the full row.
	const gamesColClass = $derived(
		hasVideos && hasRail
			? "lg:col-span-6"
			: hasVideos
				? "lg:col-span-8"
				: hasRail
					? "lg:col-span-9"
					: "lg:col-span-12",
	);
	// The videos column widens slightly when there's no rail to sit beside.
	const videosColClass = $derived(hasRail ? "lg:col-span-3" : "lg:col-span-4");

	// Two-up game cards only when the games column keeps its full desktop width
	// — signed-out with no videos column narrowing it. Otherwise a single column
	// (signed-in cards sit beside the rail; a videos column squeezes the feed).
	const twoUpCards = $derived(!user && !hasVideos);
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
				<!--
				Signed-out hero band: the product pitch (left) beside a highlight
				card for the current major tournament (right). Side by side on
				desktop, stacked on mobile.
			-->
				<div class="mb-4 grid gap-4 lg:grid-cols-2">
					<section
						class="rounded-lg p-6 sm:p-8"
						style="background-color: rgb(var(--color-surface-raised));"
					>
						<h1 class="text-3xl font-bold text-gray-200 sm:text-4xl">
							Parse, analyze and share your Old World games
						</h1>
						<p class="mt-2 text-sm text-tan opacity-90 sm:text-base">
							Upload save files and explore every detail of your games. Sign in
							with Discord to get started.
						</p>
						<button
							type="button"
							onclick={handleSignIn}
							disabled={signingIn}
							class="mt-4 inline-flex items-center gap-2 rounded-md bg-[#5865F2] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#4752c4] disabled:opacity-60"
							title={loginError ?? undefined}
						>
							<svg
								class="h-5 w-5"
								viewBox="0 0 24 24"
								fill="currentColor"
								aria-hidden="true"
							>
								<path
									d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3.2a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 5.83 4.369a.07.07 0 0 0-.032.027C3.476 7.86 2.843 11.255 3.156 14.605a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.056c.5-3.873-.838-7.24-3.549-10.209a.061.061 0 0 0-.031-.028ZM9.681 12.564c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.974 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"
								/>
							</svg>
							{signingIn ? "Redirecting…" : "Continue with Discord"}
						</button>
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

					<!--
				Tournament highlight: the whole card links to the current major
				tournament. The event name is baked into the still (the animation's
				opening title card), so no text overlay is needed.
			-->
					<a
						href={resolve("/tournaments/2026-community-tournament")}
						class="group block aspect-video overflow-hidden rounded-lg bg-black lg:aspect-auto"
					>
						<img
							src="/tournament-hero.webp"
							alt="2026 Community Tournament"
							width="654"
							height="345"
							class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
						/>
					</a>
				</div>
			{/if}

			<!--
			Discovery grid (desktop): recent saves (dominant, left) → creator
			videos (middle) → right rail (profile card + active tournaments).
			Columns that have no content drop out and their neighbours widen. No
			wrapper panels — cards float directly on the page background, matching
			the tournaments-listing pattern.
		-->
			<!--
				On mobile the grid stacks in DOM order; `order` utilities lift the
				rail and videos above the long games feed there, while `lg:order-*`
				restores the desktop left→right (games → videos → rail) arrangement.
			-->
			<div class="grid gap-4 lg:grid-cols-12">
				<section class={`order-3 lg:order-1 ${gamesColClass}`}>
					{#if data.recentGames.length === 0}
						<p class="text-sm text-tan opacity-70">
							No public saves yet. Be the first — upload a save and toggle
							visibility to public.
						</p>
					{:else}
						<!--
							Single column whenever the feed is narrowed (beside the rail, or
							squeezed by the videos column); two-up only when it keeps the
							full-width row — see `twoUpCards`.
						-->
						<div
							class={twoUpCards
								? "grid grid-cols-2 gap-3"
								: "grid grid-cols-1 gap-3"}
						>
							{#each data.recentGames as game (game.game_id)}
								<RecentSaveCard {game} />
							{/each}
						</div>
					{/if}
				</section>

				<!--
				Creator videos: middle column on desktop, full-width strip on smaller
				screens (the component handles the responsive grid). Omitted entirely
				on a cold/empty feed rather than leaving a gap.
			-->
				{#if hasVideos}
					<CreatorVideos
						videos={data.creatorVideos}
						class={`order-2 lg:order-2 ${videosColClass}`}
					/>
				{/if}

				<!-- Right rail: profile card (signed-in only) + active tournaments. No
				     top offset — with the column headings gone, its first card aligns
				     with the first game/video card at the top of the grid. -->
				{#if hasRail}
					<aside class="order-1 space-y-3 lg:order-3 lg:col-span-3">
						{#if user}
							<!-- Whole card links to the viewer's own profile/library. -->
							<a
								href={resolve(`/users/${user.user_id}`)}
								class="block rounded-lg p-3 transition-colors hover:bg-surface-hover"
								style="background-color: rgb(var(--color-surface-raised));"
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
											style="background-color: rgb(var(--color-surface));"
										>
											<p class="mb-0.5 text-[10px] font-bold text-gray-400">
												Saves
											</p>
											<p class="text-[10px] font-bold text-bright">
												{summary.total_games}
											</p>
										</div>

										<div
											class="rounded px-2 py-1"
											style="background-color: rgb(var(--color-surface));"
										>
											<p class="mb-0.5 text-[10px] font-bold text-gray-400">
												Win Rate
											</p>
											<p class="text-[10px] font-bold text-bright">
												{#if winRatePct != null}{winRatePct}%{:else}—{/if}
											</p>
										</div>

										<div
											class="rounded px-2 py-1"
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
														alt={formatEnum(summary.favorite_nation, "NATION_")}
													/>
												{/if}
												Favorite Nation
											</p>
											<p class="text-[10px] font-bold text-bright">
												{summary.favorite_nation
													? formatEnum(summary.favorite_nation, "NATION_")
													: "—"}
											</p>
										</div>

										<div
											class="rounded px-2 py-1"
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
								{/if}
							</a>
						{/if}

						{#if user}
							<!--
								2026 tournament banner: signed-in viewers skip the signed-out
								hero, so surface it here in the rail — beneath the profile card,
								above the tournaments list. Shown at full rail width so the
								title card isn't cropped.
							-->
							<a
								href={resolve("/tournaments/2026-community-tournament")}
								class="group block overflow-hidden rounded-lg bg-black"
							>
								<img
									src="/tournament-hero.webp"
									alt="2026 Community Tournament"
									width="654"
									height="345"
									class="w-full transition-transform duration-300 group-hover:scale-105"
								/>
							</a>
						{/if}

						{#if activeTournaments.length > 0}
							<div
								class="rounded-lg p-3"
								style="background-color: rgb(var(--color-surface-raised));"
							>
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
