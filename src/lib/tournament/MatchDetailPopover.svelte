<script lang="ts" module>
	import type { Measurable } from "$lib/ui/types";

	// An anchor frozen at a click's position, so the card opens beside the
	// cursor rather than off a fixed element.
	export function pointerAnchor(e: MouseEvent): Measurable {
		const x = e.clientX;
		const y = e.clientY;
		return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
	}
</script>

<script lang="ts">
	// The match card as a pointer-anchored popover — the shell shared by the
	// overview page's match panels (Your Next Match, Live & Upcoming). The parent
	// owns which match is open and where it was clicked; this owns the overlay,
	// the framing, and the remount-per-match key.
	//
	// Deliberately independent of the page-level popover, which anchors by a
	// `[data-match-id]` selector: document.querySelector returns first-in-DOM
	// order, so the moment a panel row carried that attribute, a match appearing
	// in both a panel and the bracket would resolve to the panel row — and
	// clicking the BRACKET cell would anchor the card, and the matchSide
	// measurement behind it, to the panel above. A virtual pointer anchor keeps
	// the two from ever fighting over the same element.
	import type {
		TournamentDetail,
		TournamentMatch,
		UserMe,
	} from "$lib/api-cloud";
	import MatchPopover from "$lib/tournament/MatchPopover.svelte";
	import Popover from "$lib/ui/Popover.svelte";

	let {
		match,
		anchor,
		tournament,
		slotLabels,
		slotUserIds,
		slotSlugs,
		slotAvatars,
		slotSchedulingZones,
		user,
		onSubstitute,
		onClose,
	}: {
		// The match whose card is open; null closes the popover. Parents derive it
		// live from their row source so an edit reflects as soon as data refreshes.
		match: TournamentMatch | null;
		// Where it was clicked (pointerAnchor above). Null before the first click.
		anchor: Measurable | null;
		tournament: TournamentDetail;
		slotLabels: Record<string, string>;
		slotUserIds: Record<string, string | null>;
		slotSlugs: Record<string, string | null>;
		slotAvatars: Record<string, string | null>;
		// Each slot occupant's timezone for the card's "Copy DM" template; see
		// MatchPopover. Forwarded, not optional — this shell is what the three
		// non-overview surfaces reach the DM through.
		slotSchedulingZones: Record<string, string | null>;
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
		onClose: () => void;
	} = $props();
</script>

<Popover
	open={match !== null}
	onOpenChange={(o) => {
		if (!o) onClose();
	}}
	customAnchor={anchor}
	side="right"
	align="start"
	contentClass="w-[min(92vw,35.2rem)]"
	frameClass="bg-surface p-3 shadow-[0_24px_64px_-12px_rgb(var(--color-black)/0.85)]"
	ariaLabel="Match detail"
>
	{#if match}
		{#key match.match_id}
			<MatchPopover
				{match}
				{tournament}
				{slotLabels}
				{slotUserIds}
				{slotSlugs}
				{slotAvatars}
				{slotSchedulingZones}
				{user}
				{onSubstitute}
				{onClose}
			/>
		{/key}
	{/if}
</Popover>
