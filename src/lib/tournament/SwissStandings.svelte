<script lang="ts">
	import type { SlotStanding } from "$lib/api-cloud";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import SlotTimezoneCell from "$lib/tournament/SlotTimezoneCell.svelte";
	import SlotUsernameCell from "$lib/tournament/SlotUsernameCell.svelte";
	import SlotPickerPopover from "$lib/tournament/SlotPickerPopover.svelte";

	let {
		divisionName,
		standings,
		isViewerAdmin = false,
		busy = false,
		onSubstitute,
		onSetTimezone,
		onWithdraw,
		onReinstate,
		onSwap,
		opponentBySlot = {},
		onAddMatch,
		unpairedInOpenRound = {},
		onOpenInfo,
	}: {
		divisionName: string;
		standings: SlotStanding[];
		isViewerAdmin?: boolean;
		busy?: boolean;
		onSubstitute?: (
			// eslint-disable-next-line no-unused-vars -- param names documentary
			slotId: string,
			// eslint-disable-next-line no-unused-vars -- param names documentary
			newUsername: string | undefined,
			// eslint-disable-next-line no-unused-vars -- param names documentary
			userId: string | null,
		) => void;
		// Set the seat's own timezone column (null clears it). Admin-only, and
		// the presence of the callback is what renders the Zone column at all —
		// a non-admin viewer gets neither the column nor the values behind it,
		// which the server already nulls for them.
		onSetTimezone?: (
			// eslint-disable-next-line no-unused-vars -- param names documentary
			slotId: string,
			// eslint-disable-next-line no-unused-vars -- param names documentary
			zone: string | null,
		) => void;
		// eslint-disable-next-line no-unused-vars -- param name documentary
		onWithdraw?: (slotId: string) => void;
		// eslint-disable-next-line no-unused-vars -- param name documentary
		onReinstate?: (slotId: string) => void;
		// Trade the occupants of two slots. slotId is this row's player; the
		// admin picks otherSlotId from the same-division swap picker.
		onSwap?: (
			// eslint-disable-next-line no-unused-vars -- param names documentary
			slotId: string,
			// eslint-disable-next-line no-unused-vars -- param names documentary
			otherSlotId: string,
		) => void;
		// slot_id → its current pending-opponent slot_id, across this division's
		// pending swiss matches. Drives the swap picker's "vs <opponent>" labels
		// and excludes a player's own opponent (that swap is a no-op).
		opponentBySlot?: Record<string, string>;
		// Late pairing: add a catch-up match to the division's open round
		// between this row's player and a picked partner — the follow-through
		// on a mid-round reinstate, which otherwise leaves the substitute
		// idle until the next round generates.
		onAddMatch?: (
			// eslint-disable-next-line no-unused-vars -- param names documentary
			slotId: string,
			// eslint-disable-next-line no-unused-vars -- param names documentary
			otherSlotId: string,
		) => void;
		// slot_id → true when the slot has no match (bye included) in the
		// division's current open round — the "Pair" affordance's audience.
		unpairedInOpenRound?: Record<string, boolean>;
		onOpenInfo?: () => void;
	} = $props();

	// A slot is swap-eligible exactly when it has no decided match this phase —
	// the client mirror of the server's SLOT_HAS_RESULTS guard. Swiss wins/losses
	// come only from decided matches (a bye is +1 win), so wins+losses===0 means
	// nothing has been banked yet; a withdrawn seat's forfeits belong to the
	// player who withdrew, so it's out too.
	function isSwapEligible(s: SlotStanding): boolean {
		return s.wins + s.losses === 0 && !s.withdrawn;
	}

	function opponentLabelOf(slotId: string): string | null {
		const oppId = opponentBySlot[slotId];
		if (!oppId) return null;
		const opp = standings.find((r) => r.slot_id === oppId);
		return opp ? slotLabel(opp) : null;
	}

	// Eligible same-division partners for `s`, minus itself and its own current
	// opponent (swapping with your own opponent just flips the same match).
	function swapCandidatesFor(s: SlotStanding) {
		const ownOpponent = opponentBySlot[s.slot_id];
		return standings
			.filter(
				(c) =>
					c.slot_id !== s.slot_id &&
					c.slot_id !== ownOpponent &&
					isSwapEligible(c),
			)
			.map((c) => ({
				slotId: c.slot_id,
				label: slotLabel(c),
				seed: c.swiss_seed,
				// Swap eligibility is wins+losses===0, so every candidate is
				// 0-0 — the record would be a column of identical noise.
				record: null,
				opponentLabel: opponentLabelOf(c.slot_id),
			}));
	}

	// Pair-eligible: still playing Swiss and without a match in the open
	// round — the client mirror of the server's SLOT_WITHDRAWN /
	// SLOT_INACTIVE / ALREADY_PAIRED gates.
	function isPairEligible(s: SlotStanding): boolean {
		return (
			!s.withdrawn &&
			s.status === "active" &&
			unpairedInOpenRound[s.slot_id] === true
		);
	}

	// Unpaired slots have no pending opponent by definition, so the picker's
	// "vs" column stays empty. It carries the W-L instead: Swiss pairs within
	// (wins, losses) buckets, so the record — not the seed — is what makes a
	// late pairing look like one the engine would have generated.
	function pairCandidatesFor(s: SlotStanding) {
		return standings
			.filter((c) => c.slot_id !== s.slot_id && isPairEligible(c))
			.map((c) => ({
				slotId: c.slot_id,
				label: slotLabel(c),
				seed: c.swiss_seed,
				record: `${c.wins}-${c.losses}`,
				opponentLabel: null,
			}));
	}

	// Empty divisionName suppresses the heading — used when the parent
	// section already labels the division (e.g. under SwissFlowBracket).
	const showHeader = $derived(divisionName.length > 0);

	// The Zone column: the organiser's coverage view of who still has no
	// timezone, and the only place a seat's zone can be set once signups
	// close. One flag for the `th` and the `td` so they can't come apart.
	const showZone = $derived(isViewerAdmin && onSetTimezone !== undefined);

	function statusBadge(s: SlotStanding["status"]): string {
		// In the new model, "advanced" means "qualified for the championship
		// bracket" (no cutoff cuts after the cascade; everyone who clinched
		// makes the bracket).
		return s === "advanced" ? "✓" : s === "eliminated" ? "✗" : "";
	}

	function statusTitle(s: SlotStanding["status"]): string {
		return s === "advanced"
			? "Qualified for championship bracket"
			: s === "eliminated"
				? "Eliminated"
				: "Active";
	}

	function slotLabel(s: SlotStanding): string {
		return s.display_name ?? `slot ${s.slot_id.slice(0, 6)}`;
	}
</script>

<section
	class="rounded-lg p-3"
	style="background-color: rgb(var(--color-surface-raised));"
>
	{#if showHeader}
		<h3
			class="mb-2 flex items-baseline justify-between pb-1 text-sm font-bold text-tan"
			style="border-bottom: 1px solid rgb(var(--color-surface));"
		>
			<span>{divisionName}</span>
			{#if onOpenInfo}
				<button
					type="button"
					class="ml-2 rounded border border-black border-opacity-50 px-1.5 text-[10px] text-tan opacity-60 transition-opacity hover:opacity-100"
					onclick={onOpenInfo}
					aria-label="How tiebreakers and qualification work"
					title="How tiebreakers and qualification work"
				>
					?
				</button>
			{/if}
		</h3>
	{/if}
	{#if standings.length === 0}
		<p class="text-xs text-tan opacity-70">No slots yet.</p>
	{:else}
		<table class="w-full text-xs text-tan">
			<thead>
				<tr class="border-b border-black text-left">
					<th class="py-1 pr-2">#</th>
					<th class="py-1 pr-2">Player</th>
					{#if showZone}
						<th
							class="py-1 pr-2 text-right"
							title="Timezone the scheduling DM will print — the player's account zone when they have set one, else the seat's own"
							>Zone</th
						>
					{/if}
					<th class="py-1 pr-2 text-right">W-L</th>
					<th
						class="py-1 pr-2 text-right"
						title="Buchholz cut-1 (strength of schedule)">Buchholz</th
					>
					<th
						class="py-1 pr-2 text-right"
						title="Opponents' Buchholz (depth of schedule)"
						>Opponents Strength</th
					>
					<th class="py-1 text-right" title="Cumulative running win total"
						>Cumulative</th
					>
				</tr>
			</thead>
			<tbody>
				{#each standings as s (s.slot_id)}
					<tr
						class="border-b border-black border-opacity-30 last:border-0"
						class:opacity-60={s.status === "eliminated" || s.withdrawn}
					>
						<td class="py-1 pr-2 font-mono">{s.rank}</td>
						<td class="py-1 pr-2">
							<!-- The name links to the claiming player's profile; the avatar
							     doesn't. The admin row renders its name inside the substitute
							     editor, which can't sit inside an anchor, so linking the avatar
							     too would mean two adjacent links to one profile on that row
							     and a different link target between admin and non-admin rows of
							     the same table. -->
							<span class="flex items-center gap-1">
								<PlayerAvatar avatarUrl={s.avatar_url} size={15} />
								{#if isViewerAdmin && onSubstitute}
									<SlotUsernameCell
										slotId={s.slot_id}
										userId={s.user_id}
										slug={s.slug}
										username={s.display_name}
										handle={s.discord_username}
										disabled={busy}
										onSubstitute={(u, userId) =>
											onSubstitute(s.slot_id, u, userId)}
									/>
								{:else}
									<ProfileLink
										userId={s.user_id}
										slug={s.slug}
										class="hover:underline"
									>
										<span class:line-through={s.withdrawn}>{slotLabel(s)}</span>
									</ProfileLink>
								{/if}
								{#if s.withdrawn}
									<!-- Withdrawn takes display precedence over the W/L-derived
									     status: a withdrawn player is out regardless of record. -->
									<span
										class="rounded border border-black border-opacity-40 px-1 text-[10px] uppercase leading-tight opacity-70"
										title="Withdrawn by an admin — excluded from future rounds"
									>
										WD
									</span>
								{:else}
									<span
										class="text-orange"
										class:opacity-50={s.status === "active"}
										title={statusTitle(s.status)}
									>
										{statusBadge(s.status)}
									</span>
								{/if}
								{#if isViewerAdmin && ((onWithdraw && onReinstate) || onSwap || onAddMatch)}
									<span class="ml-auto inline-flex items-center gap-1">
										{#if onSwap && !s.withdrawn}
											{@const eligible = isSwapEligible(s)}
											<SlotPickerPopover
												candidates={eligible ? swapCandidatesFor(s) : []}
												disabled={busy}
												actionLabel="Swap"
												ariaLabel="Swap with player"
												ineligibleReason={eligible
													? null
													: "Can't swap — already has a result this phase"}
												titleEnabled="Swap this player's seat with another same-division pending player"
												titleEmpty="No swap-eligible players (others have results this round)"
												onSelect={(otherSlotId) =>
													onSwap?.(s.slot_id, otherSlotId)}
											/>
										{/if}
										{#if onAddMatch && isPairEligible(s)}
											<SlotPickerPopover
												candidates={pairCandidatesFor(s)}
												disabled={busy}
												actionLabel="Pair"
												ariaLabel="Pair against player"
												titleEnabled="Add a match to the open round between this player and a picked partner"
												titleEmpty="No other unpaired active players in this division"
												onSelect={(otherSlotId) =>
													onAddMatch?.(s.slot_id, otherSlotId)}
											/>
										{/if}
										{#if onWithdraw && onReinstate}
											{#if s.withdrawn}
												<button
													type="button"
													class="rounded border border-black border-opacity-50 px-1.5 text-[10px] text-tan opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
													disabled={busy}
													onclick={() => onReinstate(s.slot_id)}
													title="Reinstate this player (takes effect from the next round)"
												>
													Reinstate
												</button>
											{:else}
												<button
													type="button"
													class="rounded border border-black border-opacity-50 px-1.5 text-[10px] text-tan opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
													disabled={busy}
													onclick={() => onWithdraw(s.slot_id)}
													title="Withdraw this player — removes them from all future rounds"
												>
													Withdraw
												</button>
											{/if}
										{/if}
									</span>
								{/if}
							</span>
						</td>
						{#if showZone}
							<td class="py-1 pr-2 text-right">
								<SlotTimezoneCell
									resolved={s.timezone}
									seatZone={s.slot_timezone}
									disabled={busy}
									onSave={(zone) => onSetTimezone?.(s.slot_id, zone)}
								/>
							</td>
						{/if}
						<td class="py-1 pr-2 text-right font-mono">
							{s.wins}-{s.losses}
						</td>
						<td class="py-1 pr-2 text-right font-mono">{s.buchholz_cut1}</td>
						<td class="py-1 pr-2 text-right font-mono"
							>{s.opponents_buchholz}</td
						>
						<td class="py-1 text-right font-mono">{s.cumulative}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>
