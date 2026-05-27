<script lang="ts">
	// Persistent app chrome for cloud routes. Left-aligned hieroglyph
	// wordmark; a right-aligned cluster of search (collapses to an icon),
	// upload, avatar, and the hamburger menu (far right). Auth-aware via
	// the `user` prop.

	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import HeaderGameSearch from "$lib/users/HeaderGameSearch.svelte";
	import AboutModal from "$lib/AboutModal.svelte";
	import { resolveLoginNext } from "$lib/utils/safe-next";
	import { cloudApi, ApiError, type UserMe } from "$lib/api-cloud";

	let { user }: { user: UserMe | null } = $props();

	let isMenuOpen = $state(false);
	let isAboutModalOpen = $state(false);
	let signingOut = $state(false);
	// Search collapses to a single icon; clicking it expands the input inline
	// (to the left of Upload). Collapses again on Escape or blur-while-empty.
	let searchExpanded = $state(false);

	// Signed-out login. Mirrors the (removed) home-page sign-in card: kicks
	// off the Discord OAuth round-trip, returning the viewer to the page they
	// launched from via `next`.
	let signingIn = $state(false);
	let loginError = $state<string | null>(null);

	// Upload link carries the current page as `?from=` so the upload flow's
	// Done button returns the user here rather than to a fixed default. Omit it
	// when already on /upload (nothing meaningful to return to).
	const uploadHref = $derived.by(() => {
		const base = resolve("/upload");
		if (page.url.pathname === "/upload") return base;
		const from = encodeURIComponent(page.url.pathname + page.url.search);
		return `${base}?from=${from}`;
	});

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
	<!--
		Left: hieroglyph wordmark. Always routes to / — the home page is the
		public discovery surface (recent saves, active tournaments) served to
		signed-in and signed-out viewers alike. Signed-in users can still jump
		to their personal dashboard via the hamburger menu.
	-->
	<a
		href={resolve("/")}
		class="flex-shrink-0 cursor-pointer transition-opacity hover:opacity-80"
		aria-label="Per Ankh — home"
	>
		<div class="border-b-2 border-orange pb-1 text-3xl font-bold text-gray-200">
			𓉑 Per Ankh
		</div>
	</a>

	<!--
		Right: search (collapses to an icon, expands inline to the left of
		Upload), upload shortcut, avatar/login, then the hamburger menu on the
		far right. Search and upload show only for signed-in users.
	-->
	<div class="flex flex-shrink-0 items-center gap-2">
		{#if user}
			<!-- Navigational search over the signed-in user's own games. -->
			{#if searchExpanded}
				<HeaderGameSearch
					{user}
					class="w-48 flex-shrink-0"
					autofocus
					onCollapse={() => (searchExpanded = false)}
				/>
			{:else}
				<button
					type="button"
					onclick={(e) => {
						// Stop this click reaching the window listener that
						// HeaderGameSearch registers when it mounts on the same
						// synchronous flush — otherwise its click-outside check
						// fires for this very click and collapses immediately.
						e.stopPropagation();
						searchExpanded = true;
					}}
					class="flex-shrink-0 rounded p-1 text-tan transition-colors hover:text-orange"
					aria-label="Search your games"
					title="Search your games"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/>
					</svg>
				</button>
			{/if}
			<!-- uploadHref is built from resolve("/upload") with a sanitized ?from=
			     query that resolve()'s branded types can't express. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				href={uploadHref}
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
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<!-- Avatar (profile link). -->
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

		<!-- Hamburger menu + dropdown, anchored on the far right. -->
		<div class="menu-container relative flex-shrink-0">
			<button
				class="py-2 pl-2 text-orange transition-colors hover:text-tan"
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
					class="absolute right-0 z-50 mt-2 w-40 rounded border-2 border-black bg-blue-gray shadow-lg"
				>
					{#if user}
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
	</div>
</header>

<AboutModal
	bind:isOpen={isAboutModalOpen}
	onClose={() => {
		isAboutModalOpen = false;
	}}
/>
