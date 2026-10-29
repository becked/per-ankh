<script lang="ts">
	// "Live & Upcoming" panel for the tournament overview page — the most-used
	// view during a running tournament. Lists the sittings that are live right now
	// (started within the live window, so plausibly still streaming) followed by
	// the next handful still ahead, soonest first. A match split across days shows
	// one row per sitting. The title row carries a Matches button linking to the
	// full /matches page; the active clock comes from the page (whose top-right
	// toggle owns it), so this panel and that toggle can't drift. Rows render
	// through the shared MatchTable (part-row granularity), live ones flagged with
	// a LIVE badge; clicking one opens the match card.
	import { resolve } from "$app/paths";
	import {
		type TournamentDetail,
		type TournamentMatch,
		type UserMe,
	} from "$lib/api-cloud";
	import MatchDetailPopover, {
		pointerAnchor,
	} from "$lib/tournament/MatchDetailPopover.svelte";
	import MatchTable from "$lib/tournament/MatchTable.svelte";
	import { pickColumns, type MatchRow } from "$lib/tournament/matches-table";
	import { liveAndUpcoming, type ScheduleZone } from "$lib/tournament/schedule";
	import { nowMs } from "$lib/stores/now.svelte";
	import type { Measurable } from "$lib/ui/types";

	interface Props {
		tournament: TournamentDetail;
		matches: TournamentMatch[];
		// The active clock every row's time reads, owned by the page's top-right
		// toggle so this panel stays in lockstep with it.
		zone: ScheduleZone;
		slotLabels: Record<string, string>;
		slotUserIds: Record<string, string | null>;
		slotSlugs: Record<string, string | null>;
		slotAvatars: Record<string, string | null>;
		// Each slot occupant's timezone, threaded to the match card's "Copy DM"
		// template (see MatchPopover). Not read by the table rows.
		slotSchedulingZones: Record<string, string | null>;
		user: UserMe | null;
		// Passed through to the table's actions column. Every row here is a
		// scheduled sitting, so it changes nothing on this panel today — but the
		// column decides Schedule-vs-cast from it, and a surface that withheld it
		// would be the one place the rule reads differently.
		isAdmin?: boolean;
		// Admin substitute, threaded into the match card; undefined for non-admins.
		onSubstitute?: (
			// eslint-disable-next-line no-unused-vars -- documentary param names
			slotId: string,
			// eslint-disable-next-line no-unused-vars -- documentary param names
			newUsername: string,
			// eslint-disable-next-line no-unused-vars -- documentary param names
			userId: string | null,
		) => void;
	}

	let {
		tournament,
		matches,
		zone,
		slotLabels,
		slotUserIds,
		slotSlugs,
		slotAvatars,
		slotSchedulingZones,
		user,
		isAdmin = false,
		onSubstitute,
	}: Props = $props();

	// How many upcoming sittings (parts) to preview before deferring to the full
	// page. A match split across days contributes one row per scheduled sitting.
	// The cap is on upcoming only — every live sitting always shows.
	const MAX_ROWS = 5;

	// Live sittings (uncapped) + the next few upcoming, from the shared definition
	// so this panel and the matches page's Live & Upcoming tab can't drift.
	// Reactive via nowMs(): a sitting crosses upcoming → live → gone as the clock
	// advances. partition order is soonest-first, so live sittings (earlier,
	// already-started times) precede the upcoming ones in the concatenation.
	const split = $derived(liveAndUpcoming(matches, nowMs()));
	const rows = $derived<MatchRow[]>([
		...split.live,
		...split.upcoming.slice(0, MAX_ROWS),
	]);
	// Reference-identity set for the LIVE badge: `rows` reuses the same
	// NumberedPart objects, so membership flags exactly the live sittings.
	const liveSet = $derived(new Set<MatchRow>(split.live));

	const columns = pickColumns(["time", "matchup", "broadcast", "actions"]);

	const matchesHref = $derived(
		resolve("/tournaments/[slug]/matches", { slug: tournament.slug }),
	);

	// --- Match card, anchored at the click point (see MatchDetailPopover for why
	// the panels anchor this way rather than off the page-level popover).
	// Resolved from `matches` by id so an edit reflects as soon as data refreshes.
	let detailMatchId = $state<string | null>(null);
	let detailAnchor = $state<Measurable | null>(null);
	const detailMatch = $derived(
		detailMatchId
			? (matches.find((m) => m.match_id === detailMatchId) ?? null)
			: null,
	);

	function pick(match: TournamentMatch, e: MouseEvent) {
		detailAnchor = pointerAnchor(e);
		detailMatchId = match.match_id;
	}
</script>

<section
	class="mb-3 rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<div
		class="mb-3 flex items-center gap-3 rounded-lg px-3 py-2"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<h2 class="text-lg font-bold text-tan">Live &amp; Upcoming Matches</h2>
		<!-- Link to the full matches page. The primary CTA of this panel during a
		     live tournament, so it's a filled-orange button (not the tan ghost
		     outline the rest of the UI uses) to stand out as the main action. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -- matchesHref is a resolve() result; not traceable through the local var -->
		<a
			href={matchesHref}
			class="whitespace-nowrap rounded bg-orange px-3 py-1.5 text-xs font-bold text-black transition-colors hover:bg-orange/80"
		>
			View All
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>

	<MatchTable
		{columns}
		{rows}
		{zone}
		{tournament}
		{user}
		{slotLabels}
		{slotUserIds}
		{slotSlugs}
		{slotAvatars}
		{isAdmin}
		onRowClick={pick}
		isLive={(row) => liveSet.has(row)}
		emptyMessage="No live or upcoming matches."
	/>
</section>

<MatchDetailPopover
	match={detailMatch}
	anchor={detailAnchor}
	{tournament}
	{slotLabels}
	{slotUserIds}
	{slotSlugs}
	{slotAvatars}
	{slotSchedulingZones}
	{user}
	{onSubstitute}
	onClose={() => (detailMatchId = null)}
/>
