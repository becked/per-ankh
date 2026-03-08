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

<div
	class="mb-4 rounded-lg p-4"
	style="background-color: #2a2622;"
>
<h2 class="mb-4 mt-0 font-bold text-tan">Game Settings</h2>
<div
	class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-3"
>
	{#if gameDetails.map_size}
		<div class="flex flex-col gap-1 rounded-lg p-3" style="background-color: #35302B;">
			<span class="text-sm font-bold text-brown">Map Size:</span>
			<span class="text-base text-tan">{formatEnum(gameDetails.map_size, "MAPSIZE_")}{#if gameDetails.map_width && gameDetails.map_height}&nbsp;({gameDetails.map_width} × {gameDetails.map_height}){/if}</span>
		</div>
	{/if}
	{#if gameDetails.game_mode || gameDetails.difficulty}
		<div class="flex flex-col gap-3 rounded-lg p-3" style="background-color: #35302B;">
			{#if gameDetails.game_mode}
				<div class="flex flex-col gap-1">
					<span class="text-sm font-bold text-brown">Game Mode:</span>
					<span class="text-base text-tan">{gameDetails.game_mode}</span>
				</div>
			{/if}
			{#if gameDetails.difficulty}
				<div class="flex flex-col gap-1">
					<span class="text-sm font-bold text-brown">Difficulty:</span>
					<span class="text-base text-tan">{formatEnum(gameDetails.difficulty, "DIFFICULTY_")}</span>
				</div>
			{/if}
		</div>
	{/if}
	{#if gameDetails.victory_conditions}
		<div class="flex flex-col gap-1 rounded-lg p-3" style="background-color: #35302B;">
			<span class="text-sm font-bold text-brown">Victory Conditions:</span>
			<ul class="list-disc pl-5 text-base text-tan">
				{#each victoryConditions.split(", ") as item}
					<li>{item}</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if gameDetails.enabled_dlc}
		<div class="flex flex-col gap-1 rounded-lg p-3" style="background-color: #35302B;">
			<span class="text-sm font-bold text-brown">DLC Enabled:</span>
			<ul class="list-disc pl-5 text-base text-tan">
				{#each dlcList.split(", ") as item}
					<li>{item}</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if gameDetails.enabled_mods}
		<div class="flex flex-col gap-1 rounded-lg p-3" style="background-color: #35302B;">
			<span class="text-sm font-bold text-brown">Mods Enabled:</span>
			<ul class="list-disc pl-5 text-base text-tan">
				{#each modsList.split(", ") as item}
					<li>{item}</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
</div>

<div
	class="rounded-lg p-4"
	style="background-color: #2a2622;"
>
	<h3 class="mb-4 mt-0 text-xl font-bold text-tan">Players</h3>
	<div class="overflow-x-auto rounded-lg" style="background-color: #35302B;">
	<table class="w-full">
		<thead>
			<tr>
				<th
					class="border-b-2 border-[#2a2622] p-3 text-left font-bold text-brown"
					>Player</th
				>
				<th
					class="border-b-2 border-[#2a2622] p-3 text-left font-bold text-brown"
					>Nation</th
				>
				<th
					class="border-b-2 border-[#2a2622] p-3 text-left font-bold text-brown"
					>Type</th
				>
				<th
					class="border-b-2 border-[#2a2622] p-3 text-left font-bold text-brown"
					>Legitimacy</th
				>
				<th
					class="border-b-2 border-[#2a2622] p-3 text-left font-bold text-brown"
					>State Religion</th
				>
			</tr>
		</thead>
		<tbody>
			{#each gameDetails.players as player (player.nation)}
				<tr class="hover:bg-brown/20 transition-colors duration-200">
					<td class="border-b border-[#2a2622] p-3 text-left text-tan"
						>{player.player_name}</td
					>
					<td class="border-b border-[#2a2622] p-3 text-left text-tan"
						>{formatEnum(player.nation, "NATION_")}</td
					>
					<td class="border-b border-[#2a2622] p-3 text-left text-tan"
						>{player.is_human ? "Human" : "AI"}</td
					>
					<td class="border-b border-[#2a2622] p-3 text-left text-tan"
						>{player.legitimacy ?? "—"}</td
					>
					<td class="border-b border-[#2a2622] p-3 text-left text-tan"
						>{formatEnum(player.state_religion, "RELIGION_")}</td
					>
				</tr>
			{/each}
		</tbody>
	</table>
	</div>
</div>
