<script lang="ts">
	import type { GameDetails } from "$lib/types/GameDetails";
	import { formatEnum } from "$lib/utils/formatting";

	let {
		gameDetails,
		victoryConditions,
		dlcList,
		modsList,
	}: {
		gameDetails: GameDetails;
		victoryConditions: string;
		dlcList: string;
		modsList: string;
	} = $props();
</script>

<h2 class="mb-4 mt-0 font-bold text-tan">Game Settings</h2>
<div
	class="mb-8 grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4 rounded-lg border-2 border-black p-4"
	style="background-color: #201a13;"
>
	{#if gameDetails.map_size}
		<div class="flex flex-col gap-1">
			<span class="text-sm font-bold text-brown">Map Size:</span>
			<span class="text-base text-tan"
				>{formatEnum(gameDetails.map_size, "MAPSIZE_")}</span
			>
		</div>
	{/if}
	{#if gameDetails.map_width && gameDetails.map_height}
		<div class="flex flex-col gap-1">
			<span class="text-sm font-bold text-brown">Map Dimensions:</span>
			<span class="text-base text-tan"
				>{gameDetails.map_width} × {gameDetails.map_height}</span
			>
		</div>
	{/if}
	{#if gameDetails.game_mode}
		<div class="flex flex-col gap-1">
			<span class="text-sm font-bold text-brown">Game Mode:</span>
			<span class="text-base text-tan">{gameDetails.game_mode}</span>
		</div>
	{/if}
	{#if gameDetails.difficulty}
		<div class="flex flex-col gap-1">
			<span class="text-sm font-bold text-brown">Difficulty:</span>
			<span class="text-base text-tan"
				>{formatEnum(gameDetails.difficulty, "DIFFICULTY_")}</span
			>
		</div>
	{/if}
	{#if gameDetails.victory_conditions}
		<div class="flex flex-col gap-1">
			<span class="text-sm font-bold text-brown"
				>Victory Conditions:</span
			>
			<span class="text-base text-tan">{victoryConditions}</span>
		</div>
	{/if}
	{#if gameDetails.enabled_dlc}
		<div class="flex flex-col gap-1">
			<span class="text-sm font-bold text-brown">DLC Enabled:</span>
			<span class="text-base text-tan">{dlcList}</span>
		</div>
	{/if}
	{#if gameDetails.enabled_mods}
		<div class="flex flex-col gap-1">
			<span class="text-sm font-bold text-brown">Mods Enabled:</span>
			<span class="text-base text-tan">{modsList}</span>
		</div>
	{/if}
</div>

<div
	class="mt-8 rounded-lg border-2 border-black p-4"
	style="background-color: #201a13;"
>
	<h3 class="mb-4 mt-0 text-xl font-bold text-tan">Players</h3>
	<table class="mt-2 w-full">
		<thead>
			<tr>
				<th
					class="border-b-2 border-brown p-3 text-left font-bold text-brown"
					>Player</th
				>
				<th
					class="border-b-2 border-brown p-3 text-left font-bold text-brown"
					>Nation</th
				>
				<th
					class="border-b-2 border-brown p-3 text-left font-bold text-brown"
					>Type</th
				>
				<th
					class="border-b-2 border-brown p-3 text-left font-bold text-brown"
					>Legitimacy</th
				>
				<th
					class="border-b-2 border-brown p-3 text-left font-bold text-brown"
					>State Religion</th
				>
			</tr>
		</thead>
		<tbody>
			{#each gameDetails.players as player (player.nation)}
				<tr class="hover:bg-brown/20 transition-colors duration-200">
					<td class="border-brown/50 border-b p-3 text-left text-tan"
						>{player.player_name}</td
					>
					<td class="border-brown/50 border-b p-3 text-left text-tan"
						>{formatEnum(player.nation, "NATION_")}</td
					>
					<td class="border-brown/50 border-b p-3 text-left text-tan"
						>{player.is_human ? "Human" : "AI"}</td
					>
					<td class="border-brown/50 border-b p-3 text-left text-tan"
						>{player.legitimacy ?? "—"}</td
					>
					<td class="border-brown/50 border-b p-3 text-left text-tan"
						>{formatEnum(player.state_religion, "RELIGION_")}</td
					>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
