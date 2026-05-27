<script lang="ts">
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { DetailPlayer } from "./helpers";
	import { formatEnum } from "$lib/utils/formatting";
	import SpriteIcon from "./SpriteIcon.svelte";

	let {
		gameDetails,
		players,
		victoryConditions,
		dlcList,
		modsList,
	}: {
		gameDetails: GameDetails;
		players: DetailPlayer[];
		victoryConditions: string;
		dlcList: string;
		modsList: string;
	} = $props();

	// Per-human difficulty breakdown. AI rows in single-player carry the AI
	// baseline tier (e.g. STRONG when the human is on GLORIOUS), which isn't
	// player-chosen — include only humans in the divergence check.
	const showBreakdown = $derived(
		new Set(
			players
				.filter((p) => p.is_human)
				.map((p) => p.difficulty)
				.filter((d): d is string => d != null),
		).size > 1,
	);
	const showDifficultySection = $derived(
		gameDetails.difficulty != null || showBreakdown,
	);
	const humansWithDifficulty = $derived(
		players.filter((p) => p.is_human && p.difficulty != null),
	);
</script>

<div class="mb-4 rounded-lg p-4" style="background-color: #2a2622;">
	<h3 class="mb-3 text-base font-bold text-tan">Game Settings</h3>
	<div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-3">
		{#if gameDetails.map_size}
			<div
				class="flex flex-col gap-1 rounded-lg p-3"
				style="background-color: #35302B;"
			>
				<span class="text-xs font-bold text-gray-400">Map Size:</span>
				<span class="text-sm text-[#DBDEE3]"
					>{formatEnum(
						gameDetails.map_size,
						"MAPSIZE_",
					)}{#if gameDetails.map_width && gameDetails.map_height}&nbsp;({gameDetails.map_width}
						× {gameDetails.map_height}){/if}</span
				>
			</div>
		{/if}
		{#if gameDetails.game_mode || showDifficultySection}
			<div
				class="flex flex-col gap-3 rounded-lg p-3"
				style="background-color: #35302B;"
			>
				{#if gameDetails.game_mode}
					<div class="flex flex-col gap-1">
						<span class="text-xs font-bold text-gray-400">Game Mode:</span>
						<span class="text-sm text-[#DBDEE3]">{gameDetails.game_mode}</span>
					</div>
				{/if}
				{#if showDifficultySection}
					<div class="flex flex-col gap-1">
						<span class="text-xs font-bold text-gray-400">Difficulty:</span>
						{#if gameDetails.difficulty}
							<span class="text-sm text-[#DBDEE3]"
								>{formatEnum(gameDetails.difficulty, "DIFFICULTY_")}</span
							>
						{/if}
						{#if showBreakdown}
							<ul class="m-0 list-none p-0 text-sm text-[#DBDEE3]">
								{#each humansWithDifficulty as p (p.playerId)}
									<li>
										{p.player_name}: {formatEnum(p.difficulty, "DIFFICULTY_")}
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
		{#if gameDetails.victory_conditions}
			<div
				class="flex flex-col gap-1 rounded-lg p-3"
				style="background-color: #35302B;"
			>
				<span class="text-xs font-bold text-gray-400">Victory Conditions:</span>
				<ul class="list-disc pl-5 text-sm text-[#DBDEE3]">
					{#each victoryConditions.split(", ") as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if gameDetails.enabled_dlc}
			<div
				class="flex flex-col gap-1 rounded-lg p-3"
				style="background-color: #35302B;"
			>
				<span class="text-xs font-bold text-gray-400">DLC Enabled:</span>
				<ul class="list-disc pl-5 text-sm text-[#DBDEE3]">
					{#each dlcList.split(", ") as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if gameDetails.enabled_mods}
			<div
				class="flex flex-col gap-1 rounded-lg p-3"
				style="background-color: #35302B;"
			>
				<span class="text-xs font-bold text-gray-400">Mods Enabled:</span>
				<ul class="list-disc pl-5 text-sm text-[#DBDEE3]">
					{#each modsList.split(", ") as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
</div>

<div class="rounded-lg p-4" style="background-color: #2a2622;">
	<h3 class="mb-3 text-base font-bold text-tan">Players</h3>
	<div class="overflow-x-auto rounded-lg" style="background-color: #35302B;">
		<table class="w-full">
			<thead>
				<tr>
					<th
						class="border-b-2 border-[#2a2622] p-3 text-left text-xs font-bold text-gray-400"
						>Player</th
					>
					<th
						class="border-b-2 border-[#2a2622] p-3 text-left text-xs font-bold text-gray-400"
						>Nation</th
					>
					<th
						class="border-b-2 border-[#2a2622] p-3 text-left text-xs font-bold text-gray-400"
						>Type</th
					>
					<th
						class="border-b-2 border-[#2a2622] p-3 text-left text-xs font-bold text-gray-400"
						>Legitimacy</th
					>
					<th
						class="border-b-2 border-[#2a2622] p-3 text-left text-xs font-bold text-gray-400"
						>State Religion</th
					>
				</tr>
			</thead>
			<tbody>
				{#each players as player (player.playerId)}
					<tr class="hover:bg-brown/20 transition-colors duration-200">
						<td class="border-b border-[#2a2622] p-3 text-left text-tan"
							>{player.player_name}</td
						>
						<td class="border-b border-[#2a2622] p-3 text-left text-tan">
							<span class="flex items-center gap-2">
								{#if player.nation}
									<SpriteIcon
										category="crests"
										value={player.nation}
										size={16}
										alt={formatEnum(player.nation, "NATION_")}
									/>
								{/if}
								{formatEnum(player.nation, "NATION_")}
							</span>
						</td>
						<td class="border-b border-[#2a2622] p-3 text-left text-tan"
							>{player.is_human ? "Human" : "AI"}</td
						>
						<td class="border-b border-[#2a2622] p-3 text-left text-tan"
							>{player.legitimacy ?? "—"}</td
						>
						<td class="border-b border-[#2a2622] p-3 text-left text-tan">
							<span class="flex items-center gap-2">
								{#if player.state_religion}
									<SpriteIcon
										category="religions"
										value={player.state_religion}
										size={16}
										alt={formatEnum(player.state_religion, "RELIGION_")}
									/>
								{/if}
								{formatEnum(player.state_religion, "RELIGION_")}
							</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
