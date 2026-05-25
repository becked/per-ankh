<script lang="ts">
	import type { SlotStanding } from "$lib/api-cloud";
	import SlotUsernameCell from "$lib/tournament/SlotUsernameCell.svelte";

	let {
		divisionName,
		standings,
		isViewerAdmin = false,
		busy = false,
		onSubstitute,
		onOpenInfo,
	}: {
		divisionName: string;
		standings: SlotStanding[];
		isViewerAdmin?: boolean;
		busy?: boolean;
		// eslint-disable-next-line no-unused-vars -- param names documentary
		onSubstitute?: (slotId: string, newUsername: string) => void;
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
		return s.discord_username ?? `slot ${s.slot_id.slice(0, 6)}`;
	}

	// Surface H2H only when this slot is part of a tied group — outside of
	// ties, H2H is 0 and uninformative.
	function showH2H(s: SlotStanding): boolean {
		return s.tied_with.length > 0;
	}
</script>

<section class="rounded-lg p-3" style="background-color: #35302B;">
	{#if showHeader}
		<h3
			class="mb-2 flex items-baseline justify-between pb-1 text-sm font-bold text-tan"
			style="border-bottom: 1px solid #2a2622;"
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
						title="Head-to-head within tied group">H2H</th
					>
					<th
						class="py-1 pr-2 text-right"
						title="Buchholz cut-1 (strength of schedule)">B1</th
					>
					<th
						class="py-1 pr-2 text-right"
						title="Opponents' Buchholz (depth of schedule)">B2</th
					>
					<th class="py-1 pr-2 text-right" title="Cumulative running win total"
						>Cum</th
					>
					<th class="py-1 text-right">St</th>
				</tr>
			</thead>
			<tbody>
				{#each standings as s (s.slot_id)}
					<tr
						class="border-b border-black border-opacity-30 last:border-0"
						class:opacity-60={s.status === "eliminated"}
					>
						<td class="py-1 pr-2 font-mono">{s.rank}</td>
						<td class="py-1 pr-2">
							{#if isViewerAdmin && onSubstitute}
								<SlotUsernameCell
									slotId={s.slot_id}
									username={s.discord_username}
									disabled={busy}
									onSubstitute={(u) => onSubstitute(s.slot_id, u)}
								/>
							{:else}
								{slotLabel(s)}
							{/if}
						</td>
						<td class="py-1 pr-2 text-right font-mono">
							{s.wins}-{s.losses}
						</td>
						<td class="py-1 pr-2 text-right font-mono">
							{#if showH2H(s)}
								{s.h2h}
							{:else}
								<span class="opacity-30">–</span>
							{/if}
						</td>
						<td class="py-1 pr-2 text-right font-mono">{s.buchholz_cut1}</td>
						<td class="py-1 pr-2 text-right font-mono"
							>{s.opponents_buchholz}</td
						>
						<td class="py-1 pr-2 text-right font-mono">{s.cumulative}</td>
						<td class="py-1 text-right">
							<span
								class="text-orange"
								class:opacity-50={s.status === "active"}
								title={statusTitle(s.status)}
							>
								{statusBadge(s.status)}
							</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>
