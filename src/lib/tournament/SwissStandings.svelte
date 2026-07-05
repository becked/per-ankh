<script lang="ts">
	import type { SlotStanding } from "$lib/api-cloud";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import SlotUsernameCell from "$lib/tournament/SlotUsernameCell.svelte";

	let {
		divisionName,
		standings,
		isViewerAdmin = false,
		busy = false,
		onSubstitute,
		onWithdraw,
		onReinstate,
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
		// eslint-disable-next-line no-unused-vars -- param name documentary
		onWithdraw?: (slotId: string) => void;
		// eslint-disable-next-line no-unused-vars -- param name documentary
		onReinstate?: (slotId: string) => void;
		onOpenInfo?: () => void;
	} = $props();

	// Empty divisionName suppresses the heading — used when the parent
	// section already labels the division (e.g. under SwissFlowBracket).
	const showHeader = $derived(divisionName.length > 0);

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
							<span class="flex items-center gap-1">
								<PlayerAvatar avatarUrl={s.avatar_url} size={15} />
								{#if isViewerAdmin && onSubstitute}
									<SlotUsernameCell
										slotId={s.slot_id}
										username={s.display_name}
										handle={s.discord_username}
										disabled={busy}
										onSubstitute={(u, userId) =>
											onSubstitute(s.slot_id, u, userId)}
									/>
								{:else}
									<span class:line-through={s.withdrawn}>{slotLabel(s)}</span>
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
								{#if isViewerAdmin && onWithdraw && onReinstate}
									{#if s.withdrawn}
										<button
											type="button"
											class="ml-auto rounded border border-black border-opacity-50 px-1.5 text-[10px] text-tan opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
											disabled={busy}
											onclick={() => onReinstate(s.slot_id)}
											title="Reinstate this player (takes effect from the next round)"
										>
											Reinstate
										</button>
									{:else}
										<button
											type="button"
											class="ml-auto rounded border border-black border-opacity-50 px-1.5 text-[10px] text-tan opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
											disabled={busy}
											onclick={() => onWithdraw(s.slot_id)}
											title="Withdraw this player — removes them from all future rounds"
										>
											Withdraw
										</button>
									{/if}
								{/if}
							</span>
						</td>
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
