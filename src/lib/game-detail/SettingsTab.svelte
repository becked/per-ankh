<script lang="ts">
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { DetailPlayer } from "./helpers";
	import { formatEnum } from "$lib/utils/formatting";
	import { DIFFICULTY_NAMES } from "$lib/generated/difficulty-names";
	import {
		mapScriptLabel,
		mapSizeLabel,
		mapAspectRatioLabel,
		gameModeLabel,
		nonDefaultMapOptions,
	} from "$lib/map-settings";
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

	// Non-default map options the save recorded (empty on pre-2.7.0 blobs, which
	// don't carry map_options). Rendered under the Map Settings card.
	const mapOptions = $derived(nonDefaultMapOptions(gameDetails.map_options));
	const showMapSettings = $derived(
		gameDetails.map_class != null ||
			gameDetails.map_size != null ||
			gameDetails.map_aspect_ratio != null ||
			mapOptions.length > 0,
	);
</script>

<div
	class="mb-4 rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<h3 class="mb-3 text-base font-bold text-tan">Game Settings</h3>
	<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
		{#if gameDetails.game_mode || showDifficultySection}
			<div
				class="flex flex-col gap-3 rounded-lg p-3"
				style="background-color: rgb(var(--color-surface-raised));"
			>
				{#if gameDetails.game_mode}
					<div class="flex flex-col gap-1">
						<span class="text-xs font-bold text-gray-400">Game Mode:</span>
						<ul class="list-disc pl-5 text-sm text-bright">
							<li>{gameModeLabel(gameDetails.game_mode)}</li>
						</ul>
					</div>
				{/if}
				{#if showDifficultySection}
					<div class="flex flex-col gap-1">
						<span class="text-xs font-bold text-gray-400">Difficulty:</span>
						<ul class="list-disc pl-5 text-sm text-bright">
							{#if gameDetails.difficulty && !showBreakdown}
								<li>
									{DIFFICULTY_NAMES[gameDetails.difficulty] ??
										formatEnum(gameDetails.difficulty, "DIFFICULTY_")}
								</li>
							{/if}
							{#if showBreakdown}
								{#each humansWithDifficulty as p (p.playerId)}
									<li>
										{p.player_name}: {(p.difficulty &&
											DIFFICULTY_NAMES[p.difficulty]) ??
											formatEnum(p.difficulty, "DIFFICULTY_")}
									</li>
								{/each}
							{/if}
						</ul>
					</div>
				{/if}
			</div>
		{/if}
		{#if gameDetails.victory_conditions}
			<div
				class="flex flex-col gap-1 rounded-lg p-3"
				style="background-color: rgb(var(--color-surface-raised));"
			>
				<span class="text-xs font-bold text-gray-400">Victory Conditions:</span>
				<ul class="list-disc pl-5 text-sm text-bright">
					{#each victoryConditions.split(", ") as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if showMapSettings}
			<div
				class="flex flex-col gap-3 rounded-lg p-3"
				style="background-color: rgb(var(--color-surface-raised));"
			>
				{#if gameDetails.map_class}
					<div class="flex flex-col gap-1">
						<span class="text-xs font-bold text-gray-400">Script:</span>
						<ul class="list-disc pl-5 text-sm text-bright">
							<li>{mapScriptLabel(gameDetails.map_class)}</li>
						</ul>
					</div>
				{/if}
				{#if gameDetails.map_size}
					<div class="flex flex-col gap-1">
						<span class="text-xs font-bold text-gray-400">Map Size:</span>
						<ul class="list-disc pl-5 text-sm text-bright">
							<li>
								{mapSizeLabel(
									gameDetails.map_size,
								)}{#if gameDetails.map_width && gameDetails.map_height}&nbsp;({gameDetails.map_width}
									× {gameDetails.map_height}){/if}
							</li>
						</ul>
					</div>
				{/if}
				{#if gameDetails.map_aspect_ratio}
					<div class="flex flex-col gap-1">
						<span class="text-xs font-bold text-gray-400">Aspect Ratio:</span>
						<ul class="list-disc pl-5 text-sm text-bright">
							<li>{mapAspectRatioLabel(gameDetails.map_aspect_ratio)}</li>
						</ul>
					</div>
				{/if}
				{#if mapOptions.length > 0}
					<div class="flex flex-col gap-1">
						<span class="text-xs font-bold text-gray-400">Options:</span>
						<ul class="list-disc pl-5 text-sm text-bright">
							{#each mapOptions as opt (opt.option)}
								<li>{opt.label}: {opt.value}</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}
		{#if gameDetails.enabled_dlc}
			<div
				class="flex flex-col gap-1 rounded-lg p-3"
				style="background-color: rgb(var(--color-surface-raised));"
			>
				<span class="text-xs font-bold text-gray-400">DLC Enabled:</span>
				<ul class="list-disc pl-5 text-sm text-bright">
					{#each dlcList.split(", ") as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if gameDetails.enabled_mods}
			<div
				class="flex flex-col gap-1 rounded-lg p-3"
				style="background-color: rgb(var(--color-surface-raised));"
			>
				<span class="text-xs font-bold text-gray-400">Mods Enabled:</span>
				<ul class="list-disc pl-5 text-sm text-bright">
					{#each modsList.split(", ") as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
</div>

<div
	class="rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<h3 class="mb-3 text-base font-bold text-tan">Players</h3>
	<div
		class="overflow-x-auto rounded-lg"
		style="background-color: rgb(var(--color-surface-raised));"
	>
		<table class="w-full">
			<thead>
				<tr>
					<th
						class="border-b-2 border-surface p-3 text-left text-xs font-bold text-gray-400"
						>Player</th
					>
					<th
						class="border-b-2 border-surface p-3 text-left text-xs font-bold text-gray-400"
						>Nation</th
					>
					<th
						class="border-b-2 border-surface p-3 text-left text-xs font-bold text-gray-400"
						>Type</th
					>
					<th
						class="border-b-2 border-surface p-3 text-left text-xs font-bold text-gray-400"
						>Legitimacy</th
					>
					<th
						class="border-b-2 border-surface p-3 text-left text-xs font-bold text-gray-400"
						>State Religion</th
					>
				</tr>
			</thead>
			<tbody>
				{#each players as player (player.playerId)}
					<tr class="transition-colors duration-200 hover:bg-brown/20">
						<td class="border-b border-surface p-3 text-left text-tan"
							>{player.player_name}</td
						>
						<td class="border-b border-surface p-3 text-left text-tan">
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
						<td class="border-b border-surface p-3 text-left text-tan"
							>{player.is_human ? "Human" : "AI"}</td
						>
						<td class="border-b border-surface p-3 text-left text-tan"
							>{player.legitimacy ?? "—"}</td
						>
						<td class="border-b border-surface p-3 text-left text-tan">
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
