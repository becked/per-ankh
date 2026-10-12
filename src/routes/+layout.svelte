<script lang="ts">
	import "../app.css";
	import type { Snippet } from "svelte";
	import { page, updated } from "$app/state";
	import { beforeNavigate } from "$app/navigation";
	import CloudHeader from "$lib/CloudHeader.svelte";
	import { syncFeatured } from "$lib/featured-videos.svelte";
	import Toaster from "$lib/ui/Toaster.svelte";
	import ConfirmDialogHost from "$lib/ui/ConfirmDialogHost.svelte";
	import { PUBLIC_ORIGIN, type PageMeta } from "$lib/page-meta";
	import { markScrolling } from "$lib/scroll-activity";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Cloud header is shown on every route except the OAuth callback —
	// /auth/* keeps the stripped chrome so the round-trip feels visually
	// continuous. The home page (/) now uses the full header so signed-in
	// visitors can navigate from the discovery feed back to their
	// profile, /upload, etc.
	const showCloudHeader = $derived(!page.url.pathname.startsWith("/auth/"));

	// Seed the shared featured set (empty for everyone but a site admin — see
	// +layout.ts) so every VideoCard's star knows its state. In an effect
	// because the set is module-level: populating it during SSR would carry one
	// request's state into the next.
	$effect(() => {
		syncFeatured(data.featuredVideos);
	});

	// Carry a tab that was open across a deploy onto the new build. Client JS
	// is content-hashed under /_app/immutable, and a deploy replaces the asset
	// manifest — the previous build's chunks stop being served once the grace
	// window in scripts/prod/deploy/frontend.ts expires, so client-side routing
	// into a page this tab hasn't visited yet can ask for a file that is gone.
	// `updated.current` goes true once version polling (svelte.config.js) sees
	// a new /_app/version.json; from then on the next navigation goes through
	// the server instead. It latches, so this costs one full load per deploy.
	//
	// Same-route navigations are exempt. Filter and tab state sync through
	// `goto(next, { replaceState, keepFocus, noScroll })` on a dozen pages
	// (StatsView, GamesTable, ScopeRow, the tournament and profile pages), and
	// reloading the document on every filter change would discard focus and
	// scroll — the thing those options exist to preserve. Staying on a route
	// re-renders nodes that are already imported, so it cannot hit the gap.
	beforeNavigate((nav) => {
		if (!updated.current || nav.willUnload || !nav.to) return;
		if (nav.to.route.id === nav.from?.route.id) return;
		location.href = nav.to.url.href;
	});

	// Single source of truth for OG / Twitter metadata. Pages override by
	// returning `{ meta: PageMeta }` from a nested load (their +page.ts, or a
	// +layout.ts such as the game route's); otherwise they inherit
	// DEFAULT_META from +layout.ts. Rendering once here
	// avoids duplicate <meta> tags that crawlers handle inconsistently.
	//
	// Read from `page.data` (merged parent+child, child wins), not from
	// the layout's own `data` prop (which is only LayoutData and would
	// always be DEFAULT_META, losing per-page overrides).
	const meta = $derived(page.data.meta as PageMeta);
	const ogImage = $derived(meta.image ?? `${PUBLIC_ORIGIN}/og-default.png`);
	const ogUrl = $derived(`${PUBLIC_ORIGIN}${page.url.pathname}`);
</script>

<!--
	Scrollbar activity for the whole app: capture-phase so this one handler sees
	scrolls from every container (scroll doesn't bubble). The styling itself is
	global — see the ::-webkit-scrollbar rules in src/app.css.
-->
<svelte:document onscrollcapture={markScrolling} />

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
		<CloudHeader user={data.user} />
		{@render children()}
	</div>
{:else}
	{@render children()}
{/if}

<!-- Always-on global UI hosts (portal / fixed; route-independent) -->
<Toaster />
<ConfirmDialogHost />
