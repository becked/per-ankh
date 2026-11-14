<script lang="ts">
	// The featured tournament's next sittings, as an inset of the home hero
	// panel: the ones live right now, then the next still ahead — two rows in
	// all, which is what the inset's fixed height holds.
	//
	// Live-first, matching the tournament overview's own Live & Upcoming panel —
	// and through the same definition (liveAndUpcoming), so what counts as live
	// can't drift between the two. A match split across days contributes one row
	// per sitting.
	//
	// `matches` arrives already narrowed to pending (+page.ts asks the Worker
	// for that status), which is a no-op for liveAndUpcoming — partitionSchedule
	// drops every other status itself — and is why the landing page doesn't
	// carry the tournament's decided matches across to throw them away here.
	//
	// No horizon: the next few by time, however far out they are,
	// because "nothing scheduled" and "nothing scheduled this week" are different
	// claims and only the first is worth a panel's silence.
	//
	// Occupant names come from the standings maps rather than the match payload:
	// a pending match's slot_a_display_name / slot_b_display_name are NULL (the
	// snapshot is taken at report time), which is exactly the case
	// matchSlotDisplayName's live fallback covers.
	import type { TournamentMatch } from "$lib/api-cloud";
	import { nowMs } from "$lib/stores/now.svelte";
	import { clockFaceIs12Hour } from "$lib/stores/clock-face.svelte";
	import {
		matchSlotAvatarUrl,
		matchSlotDisplayName,
	} from "$lib/tournament/match-occupant";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import { liveAndUpcoming } from "$lib/tournament/schedule";
	import type { SlotMaps } from "$lib/tournament/slot-identity";
	import { clockZone } from "$lib/tournament/zone-preference.svelte";
	import { formatScheduledInZone } from "$lib/utils/formatting";

	let { matches, slots }: { matches: TournamentMatch[]; slots: SlotMaps } =
		$props();

	// Sittings previewed here, live first. The cap is on the pair rather than on
	// the upcoming half alone because the inset's box is a fixed height (the
	// panel sizes it, to stop the tile reshaping as the clock moves sittings
	// between the two lists) and two rows are what fits. So live ones are capped
	// too now, where they never were: a third concurrent sitting would paint
	// past the box rather than into it, and a row clipped in half is worse than
	// a row that isn't there. Live still wins the slots it wants — a match being
	// played right now is the most time-sensitive thing this panel has.
	const MAX_ROWS = 2;

	// Reactive via nowMs(): a sitting crosses upcoming → live → gone as the
	// clock advances, without a refetch.
	const split = $derived(liveAndUpcoming(matches, nowMs()));
	const rows = $derived(
		[
			...split.live.map((np) => ({ np, live: true })),
			...split.upcoming.map((np) => ({ np, live: false })),
		].slice(0, MAX_ROWS),
	);

	// The viewer's own clock preference, both halves of it — the same pa_zone and
	// pa_clock the tournament pages' header toggles write, read here from their
	// module singletons because this inset sits outside the [slug] layout and has
	// no ZoneClock context to reach. Unset is the viewer's own zone, which is the
	// right default for a glance surface: the clock a reader can act on without
	// converting is their own. Once they have said otherwise, this honours it —
	// a clock set to UTC on a tournament page reading GMT+3 here was issue #368.
	//
	// There is no toggle here: the home page reads the preference, it never writes
	// it. Absolute, not relative, because "in 1 day" is what a reader has to
	// translate and the exact instant is what they came for.
	const zone = $derived(clockZone());
	const use12Hour = $derived(clockFaceIs12Hour());

	function side(m: TournamentMatch, s: "a" | "b"): string {
		return matchSlotDisplayName(m, s, slots.labels) ?? "TBD";
	}
</script>

{#if rows.length > 0}
	<!-- Indented to the standings inset's text column: its rows open with a `w-4`
	     rank and a `gap-1.5`, and these have no rank of their own, so the 22px is
	     spelled out here to keep the two lists' avatars on one line. The empty
	     state below stays flush, as the standings' does. -->
	<ul class="flex flex-col gap-1 pl-[22px]">
		{#each rows as { np, live } (np.match.match_id + ":" + np.partNumber)}
			<li class="text-[11px]">
				<div class="flex items-center gap-1">
					<PlayerAvatar
						avatarUrl={matchSlotAvatarUrl(np.match, "a", slots.avatars)}
						size={14}
					/>
					<span class="min-w-0 truncate text-tan">{side(np.match, "a")}</span>
					<span class="shrink-0 text-gray-400">v</span>
					<PlayerAvatar
						avatarUrl={matchSlotAvatarUrl(np.match, "b", slots.avatars)}
						size={14}
					/>
					<span class="min-w-0 truncate text-tan">{side(np.match, "b")}</span>
				</div>
				<!-- LIVE leads the time line rather than the names line, where it used
				     to sit. There it was one more item in a flex row, so it moved the
				     avatars and names every time it appeared — at hydration, and again
				     whenever the 30s tick carried a sitting over its start. Here
				     nothing sits beside it, so it can come and go without shifting
				     anything, and both of the row's lines start on the same indent. -->
				<p class="text-[10px] text-gray-400">
					{#if live}<span
							class="mr-1 rounded bg-orange px-1 text-[9px] font-bold text-black"
							>LIVE</span
						>{/if}{formatScheduledInZone(
						np.part.scheduled_at,
						zone,
						use12Hour,
					)}{#if np.split}
						&middot; Part {np.partNumber}{/if}
				</p>
			</li>
		{/each}
	</ul>
{:else}
	<p class="text-[11px] text-tan opacity-70">No matches scheduled right now.</p>
{/if}
