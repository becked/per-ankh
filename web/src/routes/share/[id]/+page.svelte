<script lang="ts">
	import { page } from "$app/stores";
	import { webApi, type ShareError } from "$lib/api-web";
	import { formatEnum } from "$lib/utils/formatting";
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { YieldHistory } from "$lib/types/YieldHistory";
	import type { EventLog } from "$lib/types/EventLog";
	import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
	import type { PlayerLaw } from "$lib/types/PlayerLaw";
	import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
	import type { PlayerTech } from "$lib/types/PlayerTech";
	import type { PlayerUnitProduced } from "$lib/types/PlayerUnitProduced";
	import type { CityStatistics } from "$lib/types/CityStatistics";
	import type { ImprovementData } from "$lib/types/ImprovementData";
	import type { MapTile } from "$lib/types/MapTile";
	import GamePageSkeleton from "$lib/GamePageSkeleton.svelte";
	import { GameDetailView } from "$lib/game-detail";

	let gameDetails = $state<GameDetails | null>(null);
	let playerHistory = $state<PlayerHistory[] | null>(null);
	let allYields = $state<YieldHistory[] | null>(null);
	let eventLogs = $state<EventLog[] | null>(null);
	let lawAdoptionHistory = $state<LawAdoptionHistory[] | null>(null);
	let currentLaws = $state<PlayerLaw[] | null>(null);
	let techDiscoveryHistory = $state<TechDiscoveryHistory[] | null>(null);
	let completedTechs = $state<PlayerTech[] | null>(null);
	let unitsProduced = $state<PlayerUnitProduced[] | null>(null);
	let cityStatistics = $state<CityStatistics | null>(null);
	let improvementData = $state<ImprovementData | null>(null);
	let mapTiles = $state<MapTile[] | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let shareError = $state<ShareError | null>(null);

	// Build a descriptive page title from game data
	const pageTitle = $derived.by(() => {
		if (!gameDetails) return "Shared Game — Per Ankh";
		const isRealName =
			gameDetails.game_name != null &&
			gameDetails.game_name !== "" &&
			!gameDetails.game_name.match(/^Game\d+$/);
		if (isRealName) return `${gameDetails.game_name} — Per Ankh`;
		const humanPlayer = gameDetails.players.find((p) => p.is_human);
		const nation = humanPlayer?.nation ? formatEnum(humanPlayer.nation, "NATION_") : null;
		if (nation) return `${nation} T${gameDetails.total_turns} — Per Ankh`;
		return `Shared Game — Per Ankh`;
	});

	// Fetch shared game data when route changes
	$effect(() => {
		const shareId = $page.params.id as string;

		loading = true;
		error = null;
		shareError = null;

		Promise.all([
			webApi.getGameDetails(shareId),
			webApi.getPlayerHistory(shareId),
			webApi.getYieldHistory(shareId),
			webApi.getEventLogs(shareId),
			webApi.getLawAdoptionHistory(shareId),
			webApi.getCurrentLaws(shareId),
			webApi.getTechDiscoveryHistory(shareId),
			webApi.getCompletedTechs(shareId),
			webApi.getUnitsProduced(shareId),
			webApi.getCityStatistics(shareId),
			webApi.getImprovementData(shareId),
			webApi.getMapTiles(shareId),
		])
			.then(
				([
					details,
					history,
					yields,
					logs,
					lawHistory,
					laws,
					techHistory,
					techs,
					units,
					cityStats,
					impData,
					tiles,
				]) => {
					gameDetails = details;
					playerHistory = history;
					allYields = yields;
					eventLogs = logs;
					lawAdoptionHistory = lawHistory;
					currentLaws = laws;
					techDiscoveryHistory = techHistory;
					completedTechs = techs;
					unitsProduced = units;
					cityStatistics = cityStats;
					improvementData = impData;
					mapTiles = tiles;
				},
			)
			.catch((err) => {
				const errStr = String(err);
				if (errStr === "SHARE_NOT_FOUND" || errStr === "NETWORK_ERROR" || errStr === "CORRUPT_DATA") {
					shareError = errStr as ShareError;
				} else {
					error = errStr;
				}
			})
			.finally(() => {
				loading = false;
			});
	});
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

{#if loading}
	<GamePageSkeleton />
{:else if shareError === "SHARE_NOT_FOUND"}
	<main class="isolate flex flex-1 flex-col items-center justify-center bg-blue-gray px-4">
		<h1 class="mb-4 text-3xl font-bold text-gray-200">Share Not Found</h1>
		<p class="text-brown">This shared game does not exist or has been deleted.</p>
		<p class="mt-2 text-sm text-brown">Shared links expire after 2 years.</p>
	</main>
{:else if shareError === "NETWORK_ERROR"}
	<main class="isolate flex flex-1 flex-col items-center justify-center bg-blue-gray px-4">
		<h1 class="mb-4 text-3xl font-bold text-gray-200">Connection Error</h1>
		<p class="text-brown">Could not reach the server. Please check your connection and try again.</p>
	</main>
{:else if shareError === "CORRUPT_DATA"}
	<main class="isolate flex flex-1 flex-col items-center justify-center bg-blue-gray px-4">
		<h1 class="mb-4 text-3xl font-bold text-gray-200">Data Error</h1>
		<p class="text-brown">The shared game data could not be loaded. It may be corrupted.</p>
	</main>
{:else if error}
	<main class="isolate flex-1 overflow-y-auto bg-blue-gray px-4 pb-8 pt-4">
		<p class="rounded border-2 border-orange bg-brown p-4 font-bold text-white">
			Error: {error}
		</p>
	</main>
{:else if gameDetails && playerHistory && allYields && eventLogs && lawAdoptionHistory && currentLaws && techDiscoveryHistory && completedTechs && unitsProduced && cityStatistics && improvementData}
	<main class="isolate flex-1 overflow-y-auto bg-blue-gray px-4 pb-8 pt-4">
		<GameDetailView
			{gameDetails}
			{playerHistory}
			{allYields}
			{eventLogs}
			{lawAdoptionHistory}
			{currentLaws}
			{techDiscoveryHistory}
			{completedTechs}
			{unitsProduced}
			{cityStatistics}
			{improvementData}
			{mapTiles}
		>
			{#snippet preTabs()}
				<div class="mb-4 rounded border border-brown/30 bg-[#201a13] px-4 py-2 text-center text-xs text-brown">
					Shared game
				</div>
			{/snippet}
		</GameDetailView>
	</main>
{/if}
