<script lang="ts">
	// "Your Next Match" — the one row a signed-in player came to the page for,
	// pinned directly under the header so their own match (and the Schedule
	// button on it) is the first thing they see. The panel is entirely
	// self-hiding: nothing for an anonymous viewer, for someone not playing in
	// this tournament, or once they're eliminated or finished.
	//
	// Rows render through the shared MatchTable with the same columns as the
	// Live & Upcoming panel below, so a match reads identically wherever it
	// appears — and inherits the inline Schedule button for free.
	import type {
		TournamentDetail,
		TournamentMatch,
		UserMe,
	} from "$lib/api-cloud";
	import MatchDetailPopover, {
		pointerAnchor,
	} from "$lib/tournament/MatchDetailPopover.svelte";
	import MatchTable from "$lib/tournament/MatchTable.svelte";
	import {
		matchSortInstant,
		pickColumns,
		toMatchRows,
	} from "$lib/tournament/matches-table";
	import type { ScheduleZone } from "$lib/tournament/schedule";
	import type { Measurable } from "$lib/ui/types";

	interface Props {
		tournament: TournamentDetail;
		matches: TournamentMatch[];
		// Client-synthesized cells for bracket rounds the backend hasn't
		// generated yet. A semifinal winner has no pending match until the other
		// semi reports, and that window can run days — exactly when a player asks
		// "when's my next game?" — so the placeholder is shown rather than the
		// panel silently vanishing.
		placeholders: TournamentMatch[];
		// The active clock every row's time reads, owned by the page's top-right
		// toggle so this panel stays in lockstep with the rest of the page.
		zone: ScheduleZone;
		slotLabels: Record<string, string>;
		slotUserIds: Record<string, string | null>;
		slotSlugs: Record<string, string | null>;
		slotAvatars: Record<string, string | null>;
		// Each slot occupant's timezone, threaded to the match card's "Copy DM"
		// template (see MatchPopover). Not read by the table rows.
		slotSchedulingZones: Record<string, string | null>;
		user: UserMe | null;
		// Passed through to the table's actions column. An admin who is also playing
		// reaches their own match here like any other player; the flag only widens
		// what the Schedule button covers, so it never subtracts a row.
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
		placeholders,
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

	// Every slot the viewer occupies, by value-matching their account against the
	// live slot→user map. `viewer_slot` on the tournament payload can't serve
	// here: its query is swiss-only, and the championship transition mints a NEW
	// slot_id per bracket seat, so it never equals a championship match's
	// slot_a/b_id. buildSlotMaps already unions swiss standings with the bracket
	// slots, so deriving the set from it covers both phases with no API change.
	const mySlotIds = $derived(
		new Set<string>(
			user === null
				? []
				: Object.entries(slotUserIds)
						.filter(([, userId]) => userId === user.user_id)
						.map(([slotId]) => slotId),
		),
	);

	// The instant a candidate sorts by: its next sitting, or (for a match already
	// under way) when it started — the shared rule the tables sort by. Unscheduled
	// matches have none and sort last, which is where they belong even though
	// they're the reason this panel exists: a scheduled game comes first.
	function instantKey(m: TournamentMatch): number {
		const iso = matchSortInstant(m);
		return iso ? Date.parse(iso) : Infinity;
	}

	// Your next match. Deliberately NOT routed through liveAndUpcoming: that
	// resolves through scheduledParts, which drops every part with no
	// scheduled_at — precisely the match a player is here to schedule.
	// Placeholders join the candidates so an advanced player still sees the seat
	// they're waiting on; ties break on match_number (the catch-up game a
	// reinstated player can be given alongside their round match).
	const nextMatch = $derived.by((): TournamentMatch | null => {
		if (mySlotIds.size === 0) return null;
		const mine = [...matches, ...placeholders].filter(
			(m) =>
				m.status === "pending" &&
				(mySlotIds.has(m.slot_a_id) ||
					(m.slot_b_id !== null && mySlotIds.has(m.slot_b_id))),
		);
		mine.sort((a, b) => {
			// Compared rather than subtracted: both keys can be Infinity, and
			// Infinity - Infinity is NaN, which would make the sort incoherent.
			const ai = instantKey(a);
			const bi = instantKey(b);
			if (ai !== bi) return ai < bi ? -1 : 1;
			const an = a.match_number ?? Infinity;
			const bn = b.match_number ?? Infinity;
			if (an !== bn) return an < bn ? -1 : 1;
			return 0;
		});
		return mine[0] ?? null;
	});

	const rows = $derived(nextMatch ? toMatchRows([nextMatch]) : []);
	const columns = pickColumns(["time", "matchup", "broadcast", "actions"]);

	// --- Match card, anchored at the click point (see MatchDetailPopover).
	// Resolved back off nextMatch — the panel's only row — so an edit made in the
	// card reflects as soon as data refreshes, and the card closes by itself if
	// the match stops being your next one.
	let detailMatchId = $state<string | null>(null);
	let detailAnchor = $state<Measurable | null>(null);
	const detailMatch = $derived(
		detailMatchId !== null && nextMatch?.match_id === detailMatchId
			? nextMatch
			: null,
	);

	function pick(match: TournamentMatch, e: MouseEvent) {
		detailAnchor = pointerAnchor(e);
		detailMatchId = match.match_id;
	}
</script>

{#if nextMatch}
	<section
		class="mb-3 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<div
			class="mb-3 flex items-center gap-3 rounded-lg px-3 py-2"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<h2 class="text-lg font-bold text-tan">Your Next Match</h2>
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
		/>
	</section>
{/if}

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
