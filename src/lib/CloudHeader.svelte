<script lang="ts">
	// Persistent app chrome for cloud routes. Three-zone layout mirrors
	// the deleted desktop Header.svelte: hamburger menu left, centered
	// hieroglyph wordmark, search right. Auth-aware via the `user` prop.

	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import SearchInput from "$lib/SearchInput.svelte";
	import AboutModal from "$lib/AboutModal.svelte";
	import { cloudApi, type UserMe } from "$lib/api-cloud";
	import { searchQuery } from "$lib/stores/search";

	let { user }: { user: UserMe | null } = $props();

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
		// Full page reload, not invalidateAll + goto. Reasons:
		//   1. CloudHeader lives in the layout and stays mounted across
		//      same-app navigations, so `signingOut` would never reset.
		//   2. `/+page.ts` redirects authenticated users to /dashboard,
		//      so a soft navigation to / can bounce right back if the
		//      cookie clear hasn't fully propagated to the next fetch.
		// A hard reload re-runs SSR from scratch with whatever cookies
		// the browser jar actually contains, destroying this component.
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
	class="relative flex w-full shrink-0 items-center justify-between border-b-[3px] border-black bg-blue-gray px-4 pb-2 pt-6"
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
					<a
						href={resolve("/upload")}
						class="block w-full px-3 py-1.5 text-left text-xs text-tan transition-colors hover:bg-[#35302b]"
						onclick={closeMenu}
					>
						Upload saves
					</a>
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
					<div class="border-t border-black"></div>
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
	-->
	<!--
		Logged-out viewers (anonymous on a public game share) get the
		marketing landing; logged-in users get their dashboard. Sending
		anon users to /dashboard would trigger SvelteKit's hover-preload
		of its load function, hitting /v1/stats, /v1/games, /v1/collections
		and producing 401s in the console — visible noise with no UX win.
	-->
	<div class="pointer-events-none absolute left-1/2 -translate-x-1/2">
		<a
			href={resolve(user ? "/dashboard" : "/")}
			class="pointer-events-auto block cursor-pointer transition-opacity hover:opacity-80"
			aria-label={user ? "Per Ankh — go to dashboard" : "Per Ankh — home"}
		>
			<div
				class="border-b-2 border-orange pb-1 text-3xl font-bold text-gray-200"
			>
				𓉑 Per Ankh
			</div>
		</a>
	</div>

	<!--
		Right: search input bound to the global searchQuery store. Visible
		only on routes where the games sidebar is mounted; kept in the DOM
		when hidden so the bound value survives navigation.
	-->
	<SearchInput
		bind:value={$searchQuery}
		variant="dark"
		placeholder="Search games"
		class="-mr-4 w-[171px] flex-shrink-0 pl-1 pr-2 {searchVisible
			? ''
			: 'invisible'}"
	/>
</header>

<AboutModal
	bind:isOpen={isAboutModalOpen}
	onClose={() => {
		isAboutModalOpen = false;
	}}
/>
