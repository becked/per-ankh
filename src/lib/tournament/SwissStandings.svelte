<script lang="ts">
	import type { SlotStanding } from "$lib/api-cloud";
	import SlotUsernameCell from "$lib/tournament/SlotUsernameCell.svelte";

	let {
		divisionName,
		standings,
		isViewerAdmin = false,
		busy = false,
		onSubstitute,
	}: {
		divisionName: string;
		standings: SlotStanding[];
		isViewerAdmin?: boolean;
		busy?: boolean;
		// eslint-disable-next-line no-unused-vars -- param names documentary
		onSubstitute?: (slotId: string, newUsername: string) => void;
	} = $props();

	// Empty divisionName suppresses the heading — used when the parent
	// section already labels the division (e.g. under SwissFlowBracket).
	const showHeader = $derived(divisionName.length > 0);

	function statusBadge(s: SlotStanding["status"]): string {
		return s === "advanced" ? "✓" : s === "eliminated" ? "✗" : "";
	}

	function slotLabel(s: SlotStanding): string {
		return s.discord_username ?? `slot ${s.slot_id.slice(0, 6)}`;
	}
</script>

<section class="rounded-lg p-3" style="background-color: #35302B;">
	{#if showHeader}
		<h3
			class="mb-2 pb-1 text-sm font-bold text-tan"
			style="border-bottom: 1px solid #2a2622;"
		>
			{divisionName}
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
					<th class="py-1 pr-2 text-right">MB</th>
					<th class="py-1 pr-2 text-right">Sk</th>
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
						<td class="py-1 pr-2 text-right font-mono">{s.median_buchholz}</td>
						<td class="py-1 pr-2 text-right font-mono">{s.solkoff}</td>
						<td class="py-1 text-right">
							<span
								class="text-orange"
								class:opacity-50={s.status === "active"}
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
