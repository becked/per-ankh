<script lang="ts">
	// The tournament's three top-level views as a segmented tab group. Lives in the
	// centre of the tournament header — between the title and the action cluster —
	// on the overview, matches, and stats surfaces, so "which view am I on" reads
	// at a glance. These are cross-route links (not a bits-ui Tabs panel); the
	// active tab is matched on the *exact* pathname, not a prefix, so Overview
	// ("/tournaments/[slug]") doesn't also light up on its /matches and /stats pages.
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import type { TournamentDetail } from "$lib/api-cloud";

	let { tournament }: { tournament: TournamentDetail } = $props();

	const navTabs = $derived([
		{
			label: "Overview",
			href: resolve("/tournaments/[slug]", { slug: tournament.slug }),
		},
		{
			label: "Matches",
			href: resolve("/tournaments/[slug]/matches", { slug: tournament.slug }),
		},
		{
			label: "Stats",
			href: resolve("/tournaments/[slug]/stats", { slug: tournament.slug }),
		},
	]);
</script>

<!-- Active tab uses the app's selected-tab convention — a raised-surface fill with
     the text staying tan; orange is reserved for hover and emphasis. -->
<nav
	class="inline-flex items-center overflow-hidden rounded-lg border-2 border-surface"
	style="background-color: rgb(var(--color-surface));"
	aria-label="Tournament views"
>
	<!-- eslint-disable svelte/no-navigation-without-resolve -- tab.href is a resolve() result; not traceable through the array -->
	{#each navTabs as tab (tab.href)}
		{@const active = page.url.pathname === tab.href}
		<a
			href={tab.href}
			aria-current={active ? "page" : undefined}
			class="px-3 py-1 text-xs font-bold text-tan transition-colors {active
				? 'bg-surface-raised'
				: 'hover:bg-tan-hover'}"
		>
			{tab.label}
		</a>
	{/each}
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</nav>
