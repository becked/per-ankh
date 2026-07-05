<script lang="ts">
	// "Up next" panel for the tournament overview page: the next handful of
	// upcoming (scheduled, not-yet-reported) sittings, soonest first — the
	// most-used view during a running tournament. A match split across days shows
	// one row per sitting. The title row carries a UTC/Local toggle (picks the
	// clock every row reads; defaults to local) and a Matches button linking to
	// the full /matches page. Rows render through the shared MatchTable (part-row
	// granularity); clicking one opens the match card.
	import { resolve } from "$app/paths";
	import {
		type TournamentDetail,
		type TournamentMatch,
		type UserMe,
	} from "$lib/api-cloud";
	import MatchPopover from "$lib/tournament/MatchPopover.svelte";
	import MatchTable from "$lib/tournament/MatchTable.svelte";
	import { pickColumns, type MatchRow } from "$lib/tournament/matches-table";
	import {
		partitionSchedule,
		type ScheduleZone,
	} from "$lib/tournament/schedule";
	import { nowMs } from "$lib/stores/now.svelte";
	import Popover from "$lib/ui/Popover.svelte";

	interface Props {
		tournament: TournamentDetail;
		matches: TournamentMatch[];
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
		slotLabels,
		slotUserIds,
		slotAvatars,
		user,
		onSubstitute,
	}: Props = $props();

	// How many upcoming sittings (parts) to preview before deferring to the full
	// page. A match split across days contributes one row per scheduled sitting.
	const MAX_ROWS = 5;

	const partition = $derived(partitionSchedule(matches));
	// Only sittings still ahead belong in "up next" — a part whose time has
	// passed (an already-played earlier sitting of a split match, or a fully
	// overdue match) isn't upcoming and would otherwise sort to the top under a
	// panel titled "Upcoming". Reactive via nowMs(), so a sitting drops off as
	// its scheduled time arrives. Overdue/in-progress matches surface on the full
	// matches page (its "In progress" filter) and the bracket status chips.
	const upNext = $derived<MatchRow[]>(
		partition.scheduled
			.filter((np) => {
				const t = Date.parse(np.part.scheduled_at ?? "");
				return !Number.isNaN(t) && t >= nowMs();
			})
			.slice(0, MAX_ROWS),
	);

	const columns = pickColumns([
		"number",
		"matchup",
		"time",
		"caster",
		"stream",
	]);

	const matchesHref = $derived(
		resolve("/tournaments/[slug]/matches", { slug: tournament.slug }),
	);

	// Active clock every row's time reads. The title-row toggle flips it;
	// defaults to local (the full matches page offers the same toggle, defaulting
	// to UTC there for a shared reference).
	let zone = $state<ScheduleZone>("local");
	// Segmented UTC/Local control, mirroring the matches page: transparent text
	// buttons over a sliding highlight thumb.
	const viewTriggerClass =
		"relative z-10 cursor-pointer px-3 py-1.5 text-center text-xs font-bold text-tan transition-colors";

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
		class="mb-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<div class="flex items-center gap-3">
			<h2 class="text-lg font-bold text-tan">Upcoming Matches</h2>
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
		<!-- UTC / Local: a segmented toggle picking the clock every row reads. -->
		<div
			class="relative grid grid-cols-2 overflow-hidden rounded-lg border-2 border-surface"
			style="background-color: rgb(var(--color-surface));"
			role="group"
			aria-label="Timezone"
		>
			<div
				class="pointer-events-none absolute inset-y-0 left-0 w-1/2 transition-transform duration-200 ease-out"
				style:background-color="rgb(var(--color-surface-raised))"
				style:transform={zone === "local"
					? "translateX(100%)"
					: "translateX(0)"}
			></div>
			<button
				type="button"
				class={viewTriggerClass}
				aria-pressed={zone === "utc"}
				onclick={() => (zone = "utc")}
			>
				UTC
			</button>
			<button
				type="button"
				class={viewTriggerClass}
				aria-pressed={zone === "local"}
				onclick={() => (zone = "local")}
			>
				Local
			</button>
		</div>
	</div>

	<MatchTable
		{columns}
		rows={upNext}
		{zone}
		{tournament}
		{slotLabels}
		{slotAvatars}
		onRowClick={pick}
		emptyMessage="No matches scheduled yet."
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
