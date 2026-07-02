<script lang="ts">
	// "Up next" panel for the tournament overview page: the next handful of
	// upcoming (scheduled, not-yet-reported) sittings, soonest first — the
	// most-used view during a running tournament. A match split across days shows
	// one row per sitting. The title row carries a UTC/Local toggle (picks the
	// clock every row reads; defaults to local) and a Matches button linking to
	// the full /matches page.
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
	import {
		partitionSchedule,
		type ScheduleZone,
	} from "$lib/tournament/schedule";
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

	// How many upcoming sittings (parts) to preview before deferring to the full
	// page. A match split across days contributes one row per scheduled sitting.
	const MAX_ROWS = 5;

	const partition = $derived(partitionSchedule(matches));
	const upNext = $derived(partition.scheduled.slice(0, MAX_ROWS));

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

	{#if upNext.length > 0}
		<ul class="overflow-hidden rounded-lg">
			<!-- Each row is one scheduled *sitting* (part): a match split across days
			     appears once per sitting, so key by match+part (part ids are only
			     unique within a match). The streamer-first caster (casters[0]) and
			     the sitting's first stream drive the channel column. -->
			{#each upNext as np (`${np.match.match_id}:${np.part.id}`)}
				{@const caster = np.part.casters[0]}
				{@const stream = np.part.streams[0]}
				<!-- Zebra striping on the <li> (every second row a raised tint); the
				     row hover (surface-hover) reads over either band. The caster/channel
				     link is a sibling of the button, not nested, so the <a> stays valid
				     and its click doesn't also open the match card. -->
				<li
					class="flex cursor-pointer items-center transition-colors even:bg-surface-raised hover:bg-surface-hover"
				>
					<button
						type="button"
						class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left text-sm text-tan"
						onclick={(e) => pick(np.match.match_id, e)}
					>
						<span
							class="min-w-[9rem] shrink-0 whitespace-nowrap text-xs text-tan opacity-80"
						>
							{formatScheduledInZone(
								np.part.scheduled_at,
								zone,
							)}{#if np.split}<span class="ml-1 opacity-60"
									>· Pt {np.partNumber}</span
								>{/if}
						</span>
						<span class="flex min-w-0 flex-1 items-center gap-2">
							{@render playerCell(np.match, "a")}
							<span class="shrink-0 opacity-60">v</span>
							{@render playerCell(np.match, "b")}
						</span>
					</button>
					<!-- Caster / channel: a fixed-width, left-aligned column so casters
					     line up across rows (a shrink-to-content cell wanders left-edge).
					     A link to the stream when the sitting has one, labelled with the
					     streamer (or "Watch"); the caster's name alone otherwise. Uses the
					     page's usual tan text, not an accent color. -->
					{#if stream || caster}
						<div class="flex w-44 shrink-0 items-center px-3 py-2 text-xs">
							{#if stream}
								<!-- eslint-disable svelte/no-navigation-without-resolve -- external stream URL (youtube/twitch), host-validated; not an app route -->
								<a
									href={stream.url}
									target="_blank"
									rel="noopener noreferrer"
									class="flex min-w-0 items-center gap-1.5 text-tan opacity-80 transition-opacity hover:underline hover:opacity-100"
								>
									{#if caster?.avatar_url}
										<PlayerAvatar avatarUrl={caster.avatar_url} size={16} />
									{/if}
									<span class="min-w-0 truncate"
										>{caster?.display_name ?? caster?.name ?? "Watch"}</span
									>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-3 w-3 shrink-0"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										stroke-width="2"
										aria-hidden="true"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
										/>
									</svg>
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							{:else}
								<span
									class="flex min-w-0 items-center gap-1.5 text-tan opacity-70"
								>
									{#if caster?.avatar_url}
										<PlayerAvatar avatarUrl={caster.avatar_url} size={16} />
									{/if}
									<span class="min-w-0 truncate"
										>{caster?.display_name ?? caster?.name}</span
									>
								</span>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="px-3 py-2 text-sm text-tan opacity-70">
			No matches scheduled yet.
		</p>
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
