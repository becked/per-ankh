<script lang="ts">
	import type { SlotStanding } from "$lib/api-cloud";

	let {
		divisionName,
		standings,
	}: { divisionName: string; standings: SlotStanding[] } = $props();

	function statusBadge(s: SlotStanding["status"]): string {
		return s === "advanced" ? "✓" : s === "eliminated" ? "✗" : "";
	}

	function slotLabel(s: SlotStanding): string {
		return s.discord_username ?? `slot ${s.slot_id.slice(0, 6)}`;
	}
</script>

<section class="rounded-lg p-3" style="background-color: #35302B;">
	<h3
		class="mb-2 pb-1 text-sm font-bold text-tan"
		style="border-bottom: 1px solid #2a2622;"
	>
		{divisionName}
	</h3>
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
						<td class="py-1 pr-2">{slotLabel(s)}</td>
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
