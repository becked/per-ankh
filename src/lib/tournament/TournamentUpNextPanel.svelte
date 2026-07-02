<script lang="ts">
	// "Up next" panel for the tournament overview page: the next handful of
	// upcoming (scheduled, not-yet-reported) matches, soonest first, plus a
	// count of matches still awaiting a time. Surfaces the most-used view during
	// a running tournament without a trip to the full /matches page (which the
	// title links to). Times render in the viewer's local zone — the compact
	// panel has no room for the full page's UTC/Local toggle.
	import { resolve } from "$app/paths";
	import {
		type TournamentDetail,
		type TournamentMatch,
		type UserMe,
	} from "$lib/api-cloud";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import MatchPopover from "$lib/tournament/MatchPopover.svelte";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import {
		matchSlotAvatarUrl,
		matchSlotDisplayName,
		matchSlotNation,
	} from "$lib/tournament/match-occupant";
	import { partitionSchedule } from "$lib/tournament/schedule";
	import Popover from "$lib/ui/Popover.svelte";
	import { formatEnum, formatScheduledInZone } from "$lib/utils/formatting";

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

	// How many upcoming matches to preview before deferring to the full page.
	const MAX_ROWS = 5;

	const partition = $derived(partitionSchedule(matches));
	const upNext = $derived(partition.scheduled.slice(0, MAX_ROWS));
	const unscheduledCount = $derived(partition.unscheduled.length);

	const matchesHref = $derived(
		resolve("/tournaments/[slug]/matches", { slug: tournament.slug }),
	);

	// Bracket label for a match: "Championship" or the tournament's division name.
	function phaseLabel(m: TournamentMatch): string {
		if (m.phase === "championship") return "Championship";
		if (m.division)
			return m.division === "A"
				? tournament.division_a_name
				: tournament.division_b_name;
		return "";
	}

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

	function pick(matchId: string, e: MouseEvent) {
		const x = e.clientX;
		const y = e.clientY;
		detailAnchor = { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
		detailMatchId = matchId;
	}
</script>

<!-- One player's cell: crest + avatar + name. slot_b_id is null only for an
     as-yet-undetermined feeder in a synthesized bracket cell — but those carry
     no scheduled_at, so a scheduled row always has both sides. -->
{#snippet playerCell(m: TournamentMatch, side: "a" | "b")}
	{@const slotId = side === "a" ? m.slot_a_id : m.slot_b_id}
	{#if slotId === null}
		<span class="opacity-60">TBD</span>
	{:else}
		{@const nation = matchSlotNation(m, side)}
		{@const name = matchSlotDisplayName(m, side, slotLabels) ?? "—"}
		<span class="inline-flex min-w-0 items-center gap-1.5">
			{#if nation}
				<SpriteIcon
					category="crests"
					value={nation}
					size={16}
					alt={formatEnum(nation, "NATION_")}
				/>
			{/if}
			<PlayerAvatar
				avatarUrl={matchSlotAvatarUrl(m, side, slotAvatars)}
				size={16}
			/>
			<span class="truncate">{name}</span>
		</span>
	{/if}
{/snippet}

<section
	class="mb-8 rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<div
		class="mb-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<h2 class="text-lg font-bold text-tan">Matches</h2>
		<!-- matchesHref is a resolve() result; the rule can't trace it through the
		local var, so disable around the two links that use it. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href={matchesHref}
			class="whitespace-nowrap rounded border border-tan px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
		>
			View all →
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>

	{#if upNext.length > 0}
		<ul class="flex flex-col gap-1">
			{#each upNext as m (m.match_id)}
				<li>
					<button
						type="button"
						class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-tan transition-colors hover:bg-surface-raised"
						onclick={(e) => pick(m.match_id, e)}
					>
						<span
							class="min-w-[9rem] shrink-0 whitespace-nowrap text-xs text-tan opacity-80"
						>
							{formatScheduledInZone(m.scheduled_at, "local")}
						</span>
						<span class="flex min-w-0 flex-1 items-center gap-2">
							{@render playerCell(m, "a")}
							<span class="shrink-0 opacity-60">v</span>
							{@render playerCell(m, "b")}
						</span>
						<span
							class="hidden shrink-0 whitespace-nowrap text-xs text-tan opacity-70 sm:inline"
						>
							{phaseLabel(m)}
						</span>
						{#if m.stream_url}
							<span
								class="inline-flex shrink-0 items-center gap-1 rounded bg-orange bg-opacity-20 px-1.5 py-0.5 text-[11px] font-bold text-orange"
								title="Stream available"
							>
								▶ Live
							</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="px-3 py-2 text-sm text-tan opacity-70">
			No matches scheduled yet.
		</p>
	{/if}

	{#if unscheduledCount > 0}
		<!-- eslint-disable svelte/no-navigation-without-resolve -- matchesHref is a resolve() result; not traceable through the local var -->
		<a
			href={matchesHref}
			class="mt-1 block rounded-lg px-3 py-2 text-xs text-tan opacity-70 transition-opacity hover:opacity-100"
		>
			{unscheduledCount}
			{unscheduledCount === 1 ? "match still needs" : "matches still need"} scheduling
			→
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/if}
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
	contentClass={detailMatch?.game_id
		? "w-[min(92vw,35.2rem)]"
		: "w-fit max-w-[92vw]"}
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
