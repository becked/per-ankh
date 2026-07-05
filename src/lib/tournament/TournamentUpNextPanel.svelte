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
	import MatchPopover from "$lib/tournament/MatchPopover.svelte";
	import MatchTable from "$lib/tournament/MatchTable.svelte";
	import { pickColumns, type MatchRow } from "$lib/tournament/matches-table";
	import { liveAndUpcoming, type ScheduleZone } from "$lib/tournament/schedule";
	import { nowMs } from "$lib/stores/now.svelte";
	import Popover from "$lib/ui/Popover.svelte";

	interface Props {
		tournament: TournamentDetail;
		matches: TournamentMatch[];
		// The active clock every row's time reads, owned by the page's top-right
		// toggle so this panel stays in lockstep with it.
		zone: ScheduleZone;
		slotLabels: Record<string, string>;
		slotUserIds: Record<string, string | null>;
		slotAvatars: Record<string, string | null>;
		user: UserMe | null;
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
		slotAvatars,
		user,
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

	// --- Match card, anchored at the click point (mirrors the matches page). A
	// virtual anchor from the pointer keeps the card beside the clicked row.
	let detailMatchId = $state<string | null>(null);
	let detailAnchor = $state<{ getBoundingClientRect: () => DOMRect } | null>(
		null,
	);
	const detailMatch = $derived(
		detailMatchId
			? (matches.find((m) => m.match_id === detailMatchId) ?? null)
			: null,
	);

	function pick(match: TournamentMatch, e: MouseEvent) {
		const x = e.clientX;
		const y = e.clientY;
		detailAnchor = { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
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
		<!-- Link to the full matches page, bordered button like the others. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -- matchesHref is a resolve() result; not traceable through the local var -->
		<a
			href={matchesHref}
			class="whitespace-nowrap rounded border border-tan px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
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
		{slotAvatars}
		onRowClick={pick}
		isLive={(row) => liveSet.has(row)}
		emptyMessage="No live or upcoming matches."
	/>
</section>

<!-- Match card, anchored at the click point. Independent of the overview page's
     bracket-cell modal (this one uses a virtual pointer anchor), so the two
     never fight over the same [data-match-id] element. -->
<Popover
	open={detailMatchId !== null}
	onOpenChange={(o) => {
		if (!o) detailMatchId = null;
	}}
	customAnchor={detailAnchor}
	side="right"
	align="start"
	contentClass="w-[min(92vw,35.2rem)]"
	frameClass="bg-surface p-3 shadow-[0_24px_64px_-12px_rgb(var(--color-black)/0.85)]"
	ariaLabel="Match detail"
>
	{#if detailMatch}
		{#key detailMatch.match_id}
			<MatchPopover
				match={detailMatch}
				{tournament}
				{slotLabels}
				{slotUserIds}
				{slotAvatars}
				{user}
				{onSubstitute}
				onClose={() => (detailMatchId = null)}
			/>
		{/key}
	{/if}
</Popover>
