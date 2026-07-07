<script lang="ts">
	// Shared chrome for a tournament's three view tabs (Overview / Matches /
	// Stats). Owning the scaffold + header row here — rather than per page — keeps
	// the view toggle a single persistent instance, so its active-tab pill slides
	// across on navigation instead of remounting, and the scroll container stays
	// put. Each page renders only its own content into {@render children()}.
	//
	// Upward flow is nil: the layout fully owns the header (crumbs, status badge,
	// toggle, signup, action cluster) and the one piece of shared state — the
	// active clock — flows strictly DOWN via context (see zone-context). Pages
	// contribute nothing back up.
	import type { Snippet } from "svelte";
	import { fade } from "svelte/transition";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import Breadcrumb, { type Crumb } from "$lib/Breadcrumb.svelte";
	import { cloudApi } from "$lib/api-cloud";
	import { runAction } from "$lib/tournament/async-action";
	import { headerStatusMeta } from "$lib/tournament/header-status";
	import SignedUpPopover from "$lib/tournament/SignedUpPopover.svelte";
	import TournamentActions from "$lib/tournament/TournamentActions.svelte";
	import TournamentViewTabs from "$lib/tournament/TournamentViewTabs.svelte";
	import { resolveInitialZone } from "$lib/tournament/zone-preference";
	import { ZoneClock, setZoneClock } from "$lib/tournament/zone-context.svelte";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const tournament = $derived(data.tournament);

	// Which of the three tabs is active, matched on the exact pathname (same rule
	// as TournamentViewTabs) so Overview doesn't also count on /matches or /stats.
	const overviewHref = $derived(
		resolve("/tournaments/[slug]", { slug: tournament.slug }),
	);
	const isMatches = $derived(
		page.url.pathname ===
			resolve("/tournaments/[slug]/matches", { slug: tournament.slug }),
	);
	const isStats = $derived(
		page.url.pathname ===
			resolve("/tournaments/[slug]/stats", { slug: tournament.slug }),
	);
	const isOverview = $derived(page.url.pathname === overviewHref);

	// Canonical trail. Overview: the name is the tail (no link). Matches/Stats:
	// the name links back to Overview, with a leaf naming the current view.
	const crumbs = $derived.by((): Crumb[] => {
		const base: Crumb[] = [
			{ label: "Home", href: resolve("/") },
			{ label: "Tournaments", href: resolve("/tournaments") },
		];
		if (isMatches)
			return [
				...base,
				{ label: tournament.name, href: overviewHref },
				{ label: "Matches" },
			];
		if (isStats)
			return [
				...base,
				{ label: tournament.name, href: overviewHref },
				{ label: "Stats" },
			];
		return [...base, { label: tournament.name }];
	});

	// Status chip — Overview-only, matching today's header (Matches/Stats carry
	// no badge). Still derived here so the badge and hero read one source.
	const statusMeta = $derived(
		headerStatusMeta(tournament.status, tournament.signups_open),
	);

	// The active clock, owned once here and provided down so all three tabs read
	// one value with no re-init flicker on navigation. Seeded from the deep-link
	// precedence (?zone= param > cookie > local); the toggle persists changes.
	const clock = new ZoneClock(
		resolveInitialZone(page.url.searchParams.get("zone")),
	);
	setZoneClock(clock);

	// The clock toggle shows only where there's time-bearing content: always on
	// Matches and Stats (Stats keeps it for header consistency and to let a
	// visitor set the app-wide preference), and on Overview only while the
	// tournament is running (its Live & Upcoming panel — setup/complete have no
	// schedule to clock).
	const showClock = $derived(
		isMatches ||
			isStats ||
			(isOverview &&
				(tournament.status === "swiss" ||
					tournament.status === "championship")),
	);

	// Open the shared guide, carrying this tournament as origin so the guide's
	// breadcrumb can link back here (see tournaments/guide/+page.svelte).
	function openGuide() {
		const dest = `${resolve("/tournaments/guide")}?from=${tournament.slug}&name=${encodeURIComponent(tournament.name)}`;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- query string appended to a resolved path
		goto(dest);
	}

	// Self-withdraw from the "Signed up" popover, whose explicit Withdraw button
	// is the deliberate confirmation — no extra dialog. The local busy flag just
	// gates that button while the call is in flight.
	let withdrawing = $state(false);
	function withdraw() {
		void runAction(
			() => cloudApi.withdrawFromTournament(tournament.tournament_id),
			{
				setBusy: (b) => (withdrawing = b),
				success: "Withdrew from tournament",
			},
		);
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-screen-2xl">
				<!-- Shared header row: trail (+ Overview-only status badge) on the left,
				     the persistent view toggle between it and the action cluster, the
				     cluster on the right. One instance across tabs, so the toggle's pill
				     slides on navigation instead of remounting.

				     On lg+ this is a 2fr/auto/1fr grid rather than a justify-between flex
				     row. The trail column (2fr) gets the larger share so a long name
				     doesn't wrap; the toggle sits in the auto middle column and the
				     cluster in the 1fr right column. Because the outer columns are
				     proportional — not sized to their content — the toggle's position
				     depends only on the row and cluster widths, not on the trail's
				     length, so it (and the cluster) stay put when the trail grows between
				     tabs (Overview's name-only trail vs. Matches/Stats' longer leafed
				     trail). Below lg the flex-wrap stack returns, so when space is tight
				     the toggle/cluster wrap to their own line and the trail keeps the
				     full width instead of wrapping mid-line. -->
				<div
					class="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 lg:grid lg:grid-cols-[2fr_auto_1fr]"
				>
					<div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
						<Breadcrumb {crumbs} class="min-w-0" />
						{#if isOverview}
							<span
								class="whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide {statusMeta.chipClass}"
							>
								{statusMeta.label}
							</span>
						{/if}
					</div>

					<TournamentViewTabs {tournament} />

					<div
						class="flex flex-shrink-0 items-center gap-2 lg:justify-self-end"
					>
						{#if isOverview && tournament.viewer_slot != null}
							<SignedUpPopover
								{tournament}
								busy={withdrawing}
								onWithdraw={withdraw}
							/>
						{/if}
						<TournamentActions
							{tournament}
							onGuide={openGuide}
							zone={showClock ? clock.zone : undefined}
							onZoneChange={(z) => clock.set(z)}
						/>
					</div>
				</div>

				<!-- Crossfade the view's content on tab switch, keyed on the pathname
				     so Overview⇄Matches⇄Stats fades the old page out as the new one
				     fades in. Reuses the 200ms fade + grid-stacked panes the in-page
				     view toggles use (matches/overview view-stack): both panes share one
				     grid cell, so they overlap during the fade instead of shoving each
				     other down. The persistent header above sits outside the key, so it
				     doesn't fade — only the pill slides. -->
				<div class="view-stack">
					{#key page.url.pathname}
						<div
							class="view-pane"
							in:fade={{ duration: 200 }}
							out:fade={{ duration: 200 }}
						>
							{@render children()}
						</div>
					{/key}
				</div>
			</div>
		</div>
	</main>
</div>

<style>
	.view-stack {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}
	.view-stack > :global(.view-pane) {
		grid-area: 1 / 1;
		min-width: 0;
	}
</style>
