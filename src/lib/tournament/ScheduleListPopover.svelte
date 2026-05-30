<script lang="ts">
	// Tournament-wide schedule view, opened from a button in the header. Lists
	// every upcoming (pending, time-set) match across all brackets/divisions —
	// the phase toggles can't show this since they're scoped to one bracket.
	// Styled to match the bracket/standings cards.
	//
	// Clicking a row opens that match's detail as a nested popover anchored at
	// the click position (so it sits to the side of the mouse), layered above
	// this list and leaving it open underneath — because the detail popover is
	// a descendant in the component tree, bits-ui's floating tree keeps the
	// list from dismissing while the detail is interacted with.
	import type {
		TournamentDetail,
		TournamentMatch,
		UserMe,
	} from "$lib/api-cloud";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import Popover from "$lib/ui/Popover.svelte";
	import { formatEnum, formatScheduledUtc } from "$lib/utils/formatting";
	import MatchPopover from "./MatchPopover.svelte";
	import PlayerAvatar from "./PlayerAvatar.svelte";
	import {
		matchSlotAvatarUrl,
		matchSlotNation,
		matchSlotUsername,
	} from "./match-occupant";

	let {
		scheduledMatches,
		slotLabels,
		slotUserIds,
		slotAvatars,
		tournament,
		user,
		onSubstitute,
	}: {
		scheduledMatches: TournamentMatch[];
		slotLabels: Record<string, string>;
		slotUserIds: Record<string, string | null>;
		slotAvatars: Record<string, string | null>;
		tournament: TournamentDetail;
		user: UserMe | null;
		onSubstitute?: (
			// eslint-disable-next-line no-unused-vars -- param names are documentary
			slotId: string,
			// eslint-disable-next-line no-unused-vars -- param names are documentary
			newUsername: string,
			// eslint-disable-next-line no-unused-vars -- param names are documentary
			userId: string | null,
		) => void;
	} = $props();

	let open = $state(false);

	// Match-detail state. detailAnchor is a virtual floating-ui anchor at the
	// click point, so the detail opens to the side of the mouse rather than off
	// a list row. detailMatch resolves live from the list so an edit (e.g.
	// clearing the schedule) reflects immediately.
	let detailMatchId = $state<string | null>(null);
	let detailAnchor = $state<{ getBoundingClientRect: () => DOMRect } | null>(
		null,
	);
	const detailMatch = $derived(
		detailMatchId
			? (scheduledMatches.find((m) => m.match_id === detailMatchId) ?? null)
			: null,
	);

	function phaseLabel(m: TournamentMatch): string {
		if (m.phase === "championship") return "Championship";
		if (m.division)
			return m.division === "A"
				? tournament.division_a_name
				: tournament.division_b_name;
		return "";
	}

	function pick(matchId: string, e: MouseEvent) {
		const x = e.clientX;
		const y = e.clientY;
		detailAnchor = { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
		detailMatchId = matchId;
	}
</script>

<Popover
	bind:open
	side="bottom"
	align="end"
	contentClass="w-[min(92vw,30rem)]"
	frameClass="border-2 border-[#2a2623] bg-[#2a2622] p-3 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.85)]"
	ariaLabel="Upcoming schedule"
>
	{#snippet trigger({ props })}
		<button
			{...props}
			type="button"
			class="whitespace-nowrap rounded border border-tan px-2.5 py-1 text-xs text-tan opacity-80 transition-opacity hover:opacity-100"
			aria-label="Upcoming schedule"
			title="Upcoming schedule"
		>
			Schedule
		</button>
	{/snippet}

	<div class="flex flex-col gap-2">
		<div class="rounded-lg px-3 py-2" style="background-color: #35302b;">
			<h2 class="text-sm font-bold text-tan">Upcoming schedule</h2>
		</div>

		{#if scheduledMatches.length === 0}
			<p class="px-3 py-6 text-center text-xs text-tan opacity-70">
				No games scheduled yet.
			</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each scheduledMatches as m (m.match_id)}
					{@const aLabel = matchSlotUsername(m, "a", slotLabels) ?? "—"}
					{@const bLabel =
						m.slot_b_id !== null
							? (matchSlotUsername(m, "b", slotLabels) ?? "—")
							: "Bye"}
					{@const aNation = matchSlotNation(m, "a")}
					{@const bNation = matchSlotNation(m, "b")}
					<li>
						<button
							type="button"
							class="flex w-full flex-col gap-1 rounded-lg p-2.5 text-left transition-colors hover:bg-[#3d3832]"
							style="background-color: #35302b;"
							onclick={(e) => pick(m.match_id, e)}
						>
							<div class="flex items-center justify-between gap-2">
								<span class="text-xs font-bold text-tan">
									{formatScheduledUtc(m.scheduled_at)} UTC
								</span>
								{#if phaseLabel(m)}
									<span class="text-[11px] text-tan opacity-60">
										{phaseLabel(m)}
									</span>
								{/if}
							</div>

							<div
								class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-tan"
							>
								<span class="inline-flex min-w-0 items-center gap-1.5">
									{#if aNation}
										<SpriteIcon
											category="crests"
											value={aNation}
											size={16}
											alt={formatEnum(aNation, "NATION_")}
										/>
									{/if}
									<PlayerAvatar
										avatarUrl={matchSlotAvatarUrl(m, "a", slotAvatars)}
										size={14}
									/>
									<span class="truncate">{aLabel}</span>
								</span>
								<span class="opacity-50">v</span>
								<span class="inline-flex min-w-0 items-center gap-1.5">
									{#if m.slot_b_id !== null}
										{#if bNation}
											<SpriteIcon
												category="crests"
												value={bNation}
												size={16}
												alt={formatEnum(bNation, "NATION_")}
											/>
										{/if}
										<PlayerAvatar
											avatarUrl={matchSlotAvatarUrl(m, "b", slotAvatars)}
											size={14}
										/>
									{/if}
									<span
										class="truncate"
										class:opacity-50={m.slot_b_id === null}
									>
										{bLabel}
									</span>
								</span>
							</div>

							{#if m.stream_url || m.caster_name}
								<div
									class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-tan opacity-80"
								>
									{#if m.stream_url}
										<!-- External stream URL (youtube/twitch), validated
										     host-side; not an app route, so resolve() doesn't
										     apply. Stop propagation so opening the link doesn't
										     also trigger the row's match-open. -->
										<!-- eslint-disable svelte/no-navigation-without-resolve -->
										<a
											href={m.stream_url}
											target="_blank"
											rel="noopener noreferrer"
											class="inline-flex items-center gap-1 text-orange hover:underline"
											onclick={(e) => e.stopPropagation()}
										>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												class="h-3 w-3"
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
											Stream
										</a>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									{/if}
									{#if m.caster_name}
										<span class="inline-flex items-center gap-1.5">
											<span class="opacity-60">Caster:</span>
											{#if m.caster_avatar_url}
												<PlayerAvatar
													avatarUrl={m.caster_avatar_url}
													size={12}
												/>
											{/if}
											{m.caster_name}
										</span>
									{/if}
								</div>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<!-- Match detail, anchored at the click point and layered above this
		     list. Nested inside the list popover so the floating tree keeps the
		     list open while the detail is open. -->
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
			frameClass="bg-[#2a2623] p-3 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.85)]"
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
	</div>
</Popover>
