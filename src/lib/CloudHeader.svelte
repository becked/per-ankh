<script lang="ts">
	// Persistent app chrome for cloud routes. Three-zone layout mirrors
	// the deleted desktop Header.svelte: hamburger menu left, centered
	// hieroglyph wordmark, search right. Auth-aware via the `user` prop.

	import { resolve } from "$app/paths";
	import HeaderGameSearch from "$lib/users/HeaderGameSearch.svelte";
	import AboutModal from "$lib/AboutModal.svelte";
	import { safeNext } from "$lib/utils/safe-next";
	import {
		cloudApi,
		ApiError,
		type MyAdminTournamentEntry,
		type MyTournamentEntry,
		type UserMe,
	} from "$lib/api-cloud";

	let {
		user,
		myTournaments = [],
		adminTournaments = [],
	}: {
		user: UserMe | null;
		myTournaments?: MyTournamentEntry[];
		adminTournaments?: MyAdminTournamentEntry[];
	} = $props();

	// Union of tournaments the user participates in and tournaments they
	// admin, deduplicated by tournament_id. Admin-only entries appear with
	// the ⚙ glyph; participant-and-admin entries also get the glyph.
	type TournamentMenuEntry = {
		tournament_id: string;
		slug: string;
		name: string;
		isAdmin: boolean;
	};
	const tournamentMenuEntries = $derived.by((): TournamentMenuEntry[] => {
		const byId: Record<string, TournamentMenuEntry> = {};
		for (const t of myTournaments) {
			byId[t.tournament_id] = {
				tournament_id: t.tournament_id,
				slug: t.slug,
				name: t.name,
				isAdmin: false,
			};
		}
		for (const t of adminTournaments) {
			const existing = byId[t.tournament_id];
			if (existing) {
				existing.isAdmin = true;
			} else {
				byId[t.tournament_id] = {
					tournament_id: t.tournament_id,
					slug: t.slug,
					name: t.name,
					isAdmin: true,
				};
			}
		}
		return Object.values(byId);
	});

	let isMenuOpen = $state(false);
	let isAboutModalOpen = $state(false);
	let signingOut = $state(false);

	// Signed-out login. Mirrors the (removed) home-page sign-in card: kicks
	// off the Discord OAuth round-trip, returning the viewer to the page they
	// launched from via `next`. Invite-code capture intentionally lives
	// elsewhere — the header button is login-only.
	let signingIn = $state(false);
	let loginError = $state<string | null>(null);

	async function handleSignIn() {
		signingIn = true;
		loginError = null;
		try {
			const redirectUri = `${window.location.origin}/auth/callback`;
			const next = safeNext(window.location.pathname + window.location.search);
			const { authorize_url } = await cloudApi.discordStart(
				redirectUri,
				next,
				null,
			);
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

	function toggleMenu() {
		isMenuOpen = !isMenuOpen;
	}

	function closeMenu() {
		isMenuOpen = false;
	}

	function openAbout() {
		closeMenu();
		isAboutModalOpen = true;
	}

	async function handleSignOut() {
		closeMenu();
		signingOut = true;
		try {
			await cloudApi.logout();
		} catch (err) {
			// Worst case the cookie is still valid server-side; the next
			// request will surface that. Don't strand the user.
			console.warn("Logout request failed:", err);
		}
		// Full page reload, not invalidateAll + goto. CloudHeader lives in
		// the layout and stays mounted across same-app navigations, so
		// `signingOut` would never reset on a soft nav. A hard reload also
		// re-runs SSR from scratch with whatever cookies the browser jar
		// actually contains, so the layout user load can't race the cookie
		// clear and render a stale signed-in header.
		window.location.assign(resolve("/"));
	}

	function handleClickOutside(event: MouseEvent) {
		if (!isMenuOpen) return;
		const target = event.target as HTMLElement;
		if (!target.closest(".menu-container")) closeMenu();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape" && isMenuOpen) closeMenu();
	}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<header
	class="relative flex w-full shrink-0 items-center justify-between border-b-[3px] border-black bg-blue-gray px-4 pb-2 pt-2"
>
	<!-- Left: hamburger + dropdown -->
	<div class="menu-container flex-shrink-0">
		<button
			class="py-2 pr-2 text-orange transition-colors hover:text-tan"
			type="button"
			onclick={toggleMenu}
			aria-label={user ? `Menu — signed in as ${user.display_name}` : "Menu"}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-6 w-6"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M4 6h16M4 12h16M4 18h16"
				/>
			</svg>
		</button>

		{#if isMenuOpen}
			<div
				class="absolute left-0 z-50 mt-2 w-40 rounded border-2 border-black bg-blue-gray shadow-lg"
			>
				{#if user}
					{#if user.is_beta}
						<a
							href={resolve("/tournaments")}
							class="block w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
							onclick={closeMenu}
						>
							Tournaments
						</a>
						{#each tournamentMenuEntries as t (t.tournament_id)}
							<a
								href={resolve(`/tournaments/${t.slug}`)}
								title={t.isAdmin ? `${t.name} (admin)` : t.name}
								class="block w-full truncate py-1.5 pl-6 pr-3 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
								onclick={closeMenu}
							>
								<span aria-hidden="true" class="mr-1.5">•</span
								>{t.name}{#if t.isAdmin}<span
										class="ml-1 opacity-60"
										aria-label="admin"
										title="You administer this tournament">⚙</span
									>{/if}
							</a>
						{/each}
						<div class="border-t border-black"></div>
					{/if}
					<a
						href={resolve("/account")}
						class="block w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
						onclick={closeMenu}
					>
						Settings
					</a>
					{#if user.is_admin}
						<div class="border-t border-black"></div>
						<a
							href={resolve("/admin/reparse")}
							class="block w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
							onclick={closeMenu}
						>
							Admin
						</a>
					{/if}
					<button
						class="w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
						type="button"
						onclick={openAbout}
					>
						About
					</button>
					<button
						class="w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b] disabled:opacity-50"
						type="button"
						onclick={handleSignOut}
						disabled={signingOut}
					>
						{signingOut ? "Logging out…" : "Log out"}
					</button>
				{:else}
					<button
						class="w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
						type="button"
						onclick={openAbout}
					>
						About
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<!--
		Center: hieroglyph wordmark. Absolute-positioned so it stays visually
		centered regardless of the side zones. pointer-events-none on the
		wrapper so the layer doesn't capture clicks meant for the hamburger
		when the two overlap at narrow widths; pointer-events-auto on the
		anchor itself so the wordmark stays clickable.

		Always routes to / — the home page is the public discovery surface
		(recent saves, active tournaments) and is served to signed-in and
		signed-out viewers alike. Signed-in users can still jump to their
		personal dashboard via the hamburger menu.
	-->
	<div class="pointer-events-none absolute left-1/2 -translate-x-1/2">
		<a
			href={resolve("/")}
			class="pointer-events-auto block cursor-pointer transition-opacity hover:opacity-80"
			aria-label="Per Ankh — home"
		>
			<div
				class="border-b-2 border-orange pb-1 text-3xl font-bold text-gray-200"
			>
				𓉑 Per Ankh
			</div>
		</a>
	</div>

	<!--
		Right: upload shortcut + navigational game search (HeaderGameSearch),
		shown only for signed-in users — it searches the viewer's own games
		and navigates to the picked game. Upload icon mirrors the "Upload
		saves" menu entry and only shows for signed-in users.
	-->
	<div class="flex flex-shrink-0 items-center gap-2">
		{#if user}
			<a
				href={resolve("/upload")}
				class="inline-flex items-center gap-1.5 rounded border border-tan px-2 py-1 text-xs font-semibold text-tan transition-colors hover:border-orange hover:text-orange"
				aria-label="Upload saves"
				title="Upload saves"
			>
				<span>Upload</span>
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
						d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M7.5 7.5L12 3m0 0l4.5 4.5M12 3v13.5"
					/>
				</svg>
			</a>
		{/if}
		{#if user}
			<!-- Navigational search over the signed-in user's own games. -->
			<HeaderGameSearch {user} class="w-48 flex-shrink-0" />
			<!-- Avatar (profile link) sits to the right of the search. -->
			<a
				href={resolve(`/users/${user.user_id}`)}
				class="flex-shrink-0"
				aria-label="Your profile"
				title="Your profile"
			>
				<img
					src={user.avatar_url}
					alt=""
					class="h-7 w-7 rounded-full border border-black transition-opacity hover:opacity-80"
					width="28"
					height="28"
				/>
			</a>
		{:else}
			<!-- Signed out: a plain login button stands in for the avatar. -->
			<button
				type="button"
				onclick={handleSignIn}
				disabled={signingIn}
				class="inline-flex flex-shrink-0 items-center rounded border border-tan px-3 py-1 text-xs font-semibold text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-60"
				title={loginError ?? undefined}
			>
				{signingIn ? "Redirecting…" : "Login"}
			</button>
		{/if}
	</div>
</header>

<AboutModal
	bind:isOpen={isAboutModalOpen}
	onClose={() => {
		isAboutModalOpen = false;
	}}
/>
