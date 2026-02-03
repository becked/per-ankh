<script lang="ts">
	import { onMount } from "svelte";
	import { api } from "$lib/api";
	import type { NationDynastyRow } from "$lib/types/NationDynastyRow";
	import type { PlayerDebugRow } from "$lib/types/PlayerDebugRow";
	import type { MatchDebugRow } from "$lib/types/MatchDebugRow";

	let nationData: NationDynastyRow[] = [];
	let playerData: PlayerDebugRow[] = [];
	let matchData: MatchDebugRow[] = [];
	let loading = true;
	let error: string | null = null;

	onMount(async () => {
		try {
			[nationData, playerData, matchData] = await Promise.all([
				api.getNationDynastyData(),
				api.getPlayerDebugData(),
				api.getMatchDebugData(),
			]);
			loading = false;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			loading = false;
		}
	});
</script>

<div class="p-8">
	<h1 class="mb-6 text-3xl font-bold">Nation & Dynasty Debug Data</h1>

	{#if loading}
		<p>Loading data...</p>
	{:else if error}
		<p class="text-red-500">Error: {error}</p>
	{:else}
		<div class="mb-8">
			<h2 class="mb-4 text-2xl font-bold">Matches Table</h2>
			<p class="mb-4 text-lg">Total matches: {matchData.length}</p>

			<table class="w-full border-collapse border border-gray-300">
				<thead>
					<tr class="bg-gray-100">
						<th class="border border-gray-300 px-4 py-2 text-left">Match ID</th>
						<th class="border border-gray-300 px-4 py-2 text-left">Game ID</th>
						<th class="border border-gray-300 px-4 py-2 text-left">Game Name</th
						>
						<th class="border border-gray-300 px-4 py-2 text-left">File Name</th
						>
					</tr>
				</thead>
				<tbody>
					{#each matchData as row (row.match_id)}
						<tr class="hover:bg-gray-50">
							<td class="border border-gray-300 px-4 py-2">{row.match_id}</td>
							<td class="border border-gray-300 px-4 py-2">{row.game_id}</td>
							<td class="border border-gray-300 px-4 py-2"
								>{row.game_name ?? "(null)"}</td
							>
							<td class="border border-gray-300 px-4 py-2 font-mono text-sm"
								>{row.file_name}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mb-8">
			<h2 class="mb-4 text-2xl font-bold">Nation/Dynasty Summary</h2>
			<p class="mb-4 text-lg">Total unique combinations: {nationData.length}</p>

			<table class="w-full border-collapse border border-gray-300">
				<thead>
					<tr class="bg-gray-100">
						<th class="border border-gray-300 px-4 py-2 text-left">Nation</th>
						<th class="border border-gray-300 px-4 py-2 text-left">Dynasty</th>
						<th class="border border-gray-300 px-4 py-2 text-right">Count</th>
					</tr>
				</thead>
				<tbody>
					{#each nationData as row (`${row.nation}-${row.dynasty}`)}
						<tr class="hover:bg-gray-50">
							<td class="border border-gray-300 px-4 py-2"
								>{row.nation ?? "(null)"}</td
							>
							<td class="border border-gray-300 px-4 py-2"
								>{row.dynasty ?? "(null)"}</td
							>
							<td class="border border-gray-300 px-4 py-2 text-right"
								>{row.count}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mb-8">
			<h2 class="mb-4 text-2xl font-bold">Players by Match</h2>
			<p class="mb-4 text-lg">Total player records: {playerData.length}</p>

			<table class="w-full border-collapse border border-gray-300">
				<thead>
					<tr class="bg-gray-100">
						<th class="border border-gray-300 px-4 py-2 text-left">Match ID</th>
						<th class="border border-gray-300 px-4 py-2 text-left"
							>Player Name</th
						>
						<th class="border border-gray-300 px-4 py-2 text-left">Nation</th>
						<th class="border border-gray-300 px-4 py-2 text-left">Dynasty</th>
						<th class="border border-gray-300 px-4 py-2 text-center">Human?</th>
					</tr>
				</thead>
				<tbody>
					{#each playerData as row (`${row.match_id}-${row.player_name}`)}
						<tr class="hover:bg-gray-50">
							<td class="border border-gray-300 px-4 py-2">{row.match_id}</td>
							<td class="border border-gray-300 px-4 py-2">{row.player_name}</td
							>
							<td class="border border-gray-300 px-4 py-2"
								>{row.nation ?? "(null)"}</td
							>
							<td class="border border-gray-300 px-4 py-2"
								>{row.dynasty ?? "(null)"}</td
							>
							<td class="border border-gray-300 px-4 py-2 text-center"
								>{row.is_human ? "YES" : "no"}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
