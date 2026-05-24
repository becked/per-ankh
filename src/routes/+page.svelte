<script lang="ts">
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import { cloudApi, ApiError } from "$lib/api-cloud";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import RecentSaveCard from "$lib/RecentSaveCard.svelte";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import TournamentCard from "$lib/tournament/TournamentCard.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import { safeNext } from "$lib/utils/safe-next";
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

	const SCREENSHOTS: Array<{ src: string; alt: string }> = [
		{
			src: "/screenshots/overview.webp",
			alt: "Per-Ankh overview tab showing player summaries and final score",
		},
		{
			src: "/screenshots/map.webp",
			alt: "Per-Ankh interactive hex map of an Old World game",
		},
		{
			src: "/screenshots/yields.webp",
			alt: "Per-Ankh yields tab with per-turn charts for science, military, and more",
		},
	];

	// --- Login state (signed-out only) ---
	let busy = $state(false);
	let error = $state<string | null>(null);
	let inviteCode = $state("");
	// Default true: returning users (the common case) shouldn't flash the
	// invite-code field. Flipped to false in onMount if the pa_seen cookie
	// isn't present, revealing the field for new visitors only.
	let hasSeenBefore = $state(true);

	onMount(() => {
		const cookies = document.cookie.split("; ");
		hasSeenBefore = cookies.includes("pa_seen=1");
	});

	async function signIn() {
		busy = true;
		error = null;
		try {
			const redirectUri = `${window.location.origin}/auth/callback`;
			const params = new URLSearchParams(window.location.search);
			const next = safeNext(params.get("next"));
			const trimmedCode = inviteCode.trim();
			const { authorize_url } = await cloudApi.discordStart(
				redirectUri,
				next,
				trimmedCode || null,
			);
			window.location.href = authorize_url;
		} catch (err) {
			busy = false;
			error =
				err instanceof ApiError
					? `${err.code ?? err.status}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Login failed";
		}
	}
</script>

<main class="isolate flex flex-1 flex-col overflow-hidden">
	<div
		class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
		use:autohideScroll
	>
		<!--
			Three-column layout: about + screenshots (left), the recently-
			shared list (center, dominant), profile + active tournaments
			(right). On narrow viewports the columns stack: about, recent,
			profile, tournaments.
		-->
		<div class="grid gap-4 lg:grid-cols-12">
			<!-- Left: about + screenshots -->
			<aside class="lg:col-span-2">
				<div class="rounded-lg p-4" style="background-color: #35302B;">
					<h1 class="mb-2 text-2xl font-bold text-gray-200">Per Ankh</h1>
					<p class="text-xs leading-relaxed text-tan opacity-90">
						Parse Old World Save Files
					</p>
					<ul
						class="mt-2 list-disc pl-4 text-xs leading-relaxed text-tan opacity-90"
					>
						<li>Interactive charts</li>
						<li>Explorable map</li>
						<li>Share saves</li>
					</ul>
					<div class="mt-3 space-y-2">
						{#each SCREENSHOTS as shot (shot.src)}
							<img
								src={shot.src}
								alt={shot.alt}
								class="block h-auto w-full rounded border border-black"
								loading="lazy"
							/>
						{/each}
					</div>
				</div>
			</aside>

			<!--
				Center: recently shared saves (the dominant list). No wrapper
				panel — the #35302b RecentSaveCards float directly on the page
				background, matching the tournaments-listing pattern.
			-->
			<section class="lg:col-span-8">
				{#if data.recentGames.length === 0}
					<p class="text-sm text-tan opacity-70">
						No public saves yet. Be the first — upload a save and toggle
						visibility to public.
					</p>
				{:else}
					<div class="space-y-3">
						{#each data.recentGames as game (game.game_id)}
							<RecentSaveCard {game} />
						{/each}
					</div>
				{/if}
			</section>

			<!-- Right: profile (welcome / sign-in) + active tournaments -->
			<aside class="space-y-3 lg:col-span-2">
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
				{:else}
					<div class="rounded-lg p-3" style="background-color: #35302B;">
						<h2 class="text-sm font-bold text-gray-200">Sign in</h2>
						{#if !hasSeenBefore}
							<label class="mt-2 block">
								<span class="mb-1 block text-[11px] text-tan">
									Invite code
									<span class="text-tan opacity-60">(new users only)</span>
								</span>
								<input
									type="text"
									bind:value={inviteCode}
									autocomplete="off"
									spellcheck="false"
									class="w-full rounded bg-[#1f1c19] px-2 py-1 text-xs text-tan placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-orange"
								/>
							</label>
						{/if}
						<button
							type="button"
							onclick={signIn}
							disabled={busy}
							class="mt-2 w-full rounded bg-[#5865F2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4752c4] disabled:opacity-60"
						>
							{busy ? "Redirecting…" : "Login with Discord"}
						</button>
						{#if error}
							<p class="mt-2 text-[11px] text-red-400">{error}</p>
						{/if}
					</div>
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
		</div>
	</div>
</main>
