<script lang="ts">
	// Persistent app chrome for cloud routes. Three-zone layout mirrors
	// the deleted desktop Header.svelte: hamburger menu left, centered
	// hieroglyph wordmark, search right. Auth-aware via the `user` prop.

	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import SearchInput from "$lib/SearchInput.svelte";
	import AboutModal from "$lib/AboutModal.svelte";
	import {
		cloudApi,
		type MyAdminTournamentEntry,
		type MyTournamentEntry,
		type UserMe,
	} from "$lib/api-cloud";
	import { searchQuery } from "$lib/stores/search";
	import { sidebarWidth } from "$lib/stores/sidebarWidth";

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

	// Search box has somewhere to act on /dashboard and /games/* — but only
	// when the games sidebar is mounted. On /games/[id] the sidebar is
	// hidden for non-owners, so the search input has nothing to filter.
	// Keep it mounted everywhere so the store value survives navigation;
	// just hide the input visually when the current route can't react.
	const searchVisible = $derived(
		page.url.pathname === "/dashboard" ||
			page.url.pathname === "/games" ||
			(page.url.pathname.startsWith("/games/") && page.data.isOwner === true),
	);

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
					<div class="flex items-center gap-2 border-b border-black px-3 py-2">
						<img
							src={user.avatar_url}
							alt=""
							class="h-6 w-6 rounded-full"
							width="24"
							height="24"
						/>
						<span class="truncate text-xs text-tan">{user.display_name}</span>
					</div>
					<a
						href={resolve("/dashboard")}
						class="block w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
						onclick={closeMenu}
					>
						Dashboard
					</a>
					{#if user.is_beta}
						<div class="border-t border-black"></div>
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
					{/if}
					<div class="border-t border-black"></div>
					<a
						href={resolve("/account")}
						class="block w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
						onclick={closeMenu}
					>
						Account
					</a>
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
					<div class="border-t border-black"></div>
					<a
						href={resolve("/")}
						class="block w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
						onclick={closeMenu}
					>
						Login
					</a>
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
		Right: upload shortcut + search input bound to the global searchQuery
		store. Search is visible only on routes where the games sidebar is
		mounted, but stays in the DOM so the bound value survives navigation.
		Upload icon mirrors the "Upload saves" menu entry and only shows for
		signed-in users.
	-->
	<div class="flex flex-shrink-0 items-center gap-2">
		{#if user}
			<a
				href={resolve("/upload")}
				class="rounded border border-tan p-1 text-tan transition-colors hover:border-orange hover:text-orange {searchVisible
					? ''
					: 'invisible'}"
				aria-label="Upload saves"
				title="Upload saves"
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
						d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M7.5 7.5L12 3m0 0l4.5 4.5M12 3v13.5"
					/>
				</svg>
			</a>
		{/if}
		<SearchInput
			bind:value={$searchQuery}
			variant="dark"
			placeholder="Search games"
			class="-mr-4 flex-shrink-0 pl-1 pr-2 {searchVisible ? '' : 'invisible'}"
			style="width: {$sidebarWidth}px"
		/>
	</div>
</header>

<AboutModal
	bind:isOpen={isAboutModalOpen}
	onClose={() => {
		isAboutModalOpen = false;
	}}
/>
