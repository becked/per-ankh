<script lang="ts">
	import "../app.css";
	import type { Snippet } from "svelte";
	import { page } from "$app/state";
	import CloudHeader from "$lib/CloudHeader.svelte";
	import { PUBLIC_ORIGIN, type PageMeta } from "$lib/page-meta";
	import { tournamentNotices } from "$lib/stores/tournamentNotice";
	import TournamentBanner from "$lib/tournament/TournamentBanner.svelte";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Push the SSR-fetched tournament notices into the module-scoped store
	// so TournamentBanner reads them. Re-runs on navigation; the store value
	// is the source of truth for the dismiss optimistic update.
	$effect(() => {
		tournamentNotices.set(data.tournamentNotices ?? []);
	});

	// Cloud header is shown on every route except the auth flow (OAuth
	// callback) and the marketing/login landing — none of those have a
	// user context that would make the nav meaningful.
	const showCloudHeader = $derived(
		page.url.pathname !== "/" && !page.url.pathname.startsWith("/auth/"),
	);

	// Single source of truth for OG / Twitter metadata. Pages override by
	// returning `{ meta: PageMeta }` from their +page.ts load; otherwise
	// they inherit DEFAULT_META from +layout.ts. Rendering once here
	// avoids duplicate <meta> tags that crawlers handle inconsistently.
	//
	// Read from `page.data` (merged parent+child, child wins), not from
	// the layout's own `data` prop (which is only LayoutData and would
	// always be DEFAULT_META, losing per-page overrides).
	const meta = $derived(page.data.meta as PageMeta);
	const ogImage = $derived(meta.image ?? `${PUBLIC_ORIGIN}/og-default.png`);
	const ogUrl = $derived(`${PUBLIC_ORIGIN}${page.url.pathname}`);
</script>

<svelte:head>
	<title>{meta.title}</title>
	<meta name="description" content={meta.description} />
	<meta property="og:title" content={meta.title} />
	<meta property="og:description" content={meta.description} />
	<meta property="og:image" content={ogImage} />
	<meta property="og:url" content={ogUrl} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Per-Ankh" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={meta.title} />
	<meta name="twitter:description" content={meta.description} />
	<meta name="twitter:image" content={ogImage} />
</svelte:head>

{#if showCloudHeader}
	<!--
		Cloud chrome: fixed-viewport flex column. CloudHeader sits at top;
		children take remaining space via flex-1. Pages either fill the
		slot (flex-1 flex-col overflow-hidden, with their own internal
		scroll) or scroll the slot directly (flex-1 overflow-y-auto).
	-->
	<div class="flex h-screen flex-col overflow-hidden bg-blue-gray">
		<CloudHeader
			user={data.user}
			myTournaments={data.myTournaments}
			adminTournaments={data.adminTournaments}
		/>
		<TournamentBanner />
		{@render children()}
	</div>
{:else}
	{@render children()}
{/if}
