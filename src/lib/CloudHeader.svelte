<script lang="ts">
	// Persistent top-of-page navigation for cloud routes. Rendered from the
	// root +layout.svelte for routes that aren't /login or /auth/*.
	//
	// Auth-aware: when `user` is null (signed out) the right side shows a
	// Sign in link. The middle nav links stay visible regardless — they
	// each trigger their own auth redirect on click via the page's load
	// guard, so showing them when signed out is harmless and keeps the
	// chrome stable as the user signs in/out.

	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import type { UserMe } from "$lib/api-cloud";

	let { user }: { user: UserMe | null } = $props();

	const navItems = [
		{ href: "/dashboard", label: "Dashboard" },
		{ href: "/upload", label: "Upload" },
	] as const;

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		return path === href || path.startsWith(href + "/");
	}
</script>

<header
	class="flex shrink-0 flex-wrap items-center gap-3 border-b border-brown bg-[#2a2622] px-4 py-2"
>
	<a href={resolve("/dashboard")} class="text-sm font-bold text-tan hover:text-orange">
		Per-Ankh
	</a>

	<nav class="flex items-center gap-1">
		{#each navItems as item (item.href)}
			<a
				href={resolve(item.href)}
				class="rounded px-2 py-1 text-xs hover:bg-brown/40 hover:text-orange {isActive(
					item.href,
				)
					? 'text-orange'
					: 'text-tan'}"
			>
				{item.label}
			</a>
		{/each}
	</nav>

	<div class="ml-auto flex items-center gap-2">
		{#if user}
			<a
				href={resolve("/account")}
				class="flex items-center gap-2 rounded px-2 py-1 hover:bg-brown/40"
				title="Account settings"
			>
				<img
					src={user.avatar_url}
					alt=""
					class="h-6 w-6 rounded-full"
					width="24"
					height="24"
				/>
				<span class="text-xs text-tan">{user.display_name}</span>
			</a>
		{:else}
			<a
				href={resolve("/login")}
				class="rounded bg-orange px-3 py-1 text-xs font-bold text-white hover:bg-orange/80"
			>
				Sign in
			</a>
		{/if}
	</div>
</header>
