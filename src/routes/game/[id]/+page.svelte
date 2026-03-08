<script lang="ts">
	import { page } from "$app/stores";
	import { api } from "$lib/api";
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
	import type { GameReligion } from "$lib/types/GameReligion";
	import type { PlayerWonder } from "$lib/types/PlayerWonder";
	import type { MapTile } from "$lib/types/MapTile";
	import GamePageSkeleton from "$lib/GamePageSkeleton.svelte";
	import ShareControl from "$lib/ShareControl.svelte";
	import { GameDetailView } from "$lib/game-detail";
	import { YIELD_TYPES } from "$lib/game-detail/helpers";

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
	let gameReligions = $state<GameReligion[] | null>(null);
	let playerWonders = $state<PlayerWonder[] | null>(null);
	let mapTiles = $state<MapTile[] | null>(null);
	let selectedMapTurn = $state<number | null>(null);
	let mapTilesLoading = $state(false);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Fetch game data when route changes
	$effect(() => {
		const matchId = Number($page.params.id);

		loading = true;
		error = null;

		Promise.all([
			api.getGameDetails(matchId),
			api.getPlayerHistory(matchId),
			api.getYieldHistory(matchId, Array.from(YIELD_TYPES)),
			api.getEventLogs(matchId),
			api.getLawAdoptionHistory(matchId),
			api.getCurrentLaws(matchId),
			api.getTechDiscoveryHistory(matchId),
			api.getCompletedTechs(matchId),
			api.getUnitsProduced(matchId),
			api.getCityStatistics(matchId),
			api.getImprovementData(matchId),
			api.getGameReligions(matchId),
			api.getPlayerWonders(matchId),
			api.getMapTiles(matchId),
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
					religions,
					wonders,
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
					gameReligions = religions;
					playerWonders = wonders;
					mapTiles = tiles;
					selectedMapTurn = details.total_turns;
				},
			)
			.catch((err) => {
				error = String(err);
			})
			.finally(() => {
				loading = false;
			});
	});

	// Handle map turn slider change
	async function handleMapTurnChange(turn: number) {
		if (!gameDetails || mapTilesLoading) return;

		selectedMapTurn = turn;

		if (turn === gameDetails.total_turns) {
			mapTilesLoading = true;
			try {
				mapTiles = await api.getMapTiles(gameDetails.match_id);
			} catch (err) {
				console.error("Failed to fetch map tiles:", err);
			} finally {
				mapTilesLoading = false;
			}
		} else {
			mapTilesLoading = true;
			try {
				mapTiles = await api.getMapTilesAtTurn(gameDetails.match_id, turn);
			} catch (err) {
				console.error("Failed to fetch map tiles at turn:", err);
			} finally {
				mapTilesLoading = false;
			}
		}
	}
</script>

{#if loading}
	<GamePageSkeleton />
{:else if error}
	<main class="isolate flex-1 overflow-y-auto bg-blue-gray px-4 pb-8 pt-4">
		<p class="rounded border-2 border-orange bg-brown p-4 font-bold text-white">
			Error: {error}
		</p>
	</main>
{:else if gameDetails && playerHistory && allYields && eventLogs && lawAdoptionHistory && currentLaws && techDiscoveryHistory && completedTechs && unitsProduced && cityStatistics && improvementData && gameReligions && playerWonders}
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
			{gameReligions}
			{playerWonders}
			{mapTiles}
			{selectedMapTurn}
			onMapTurnChange={handleMapTurnChange}
		>
			{#snippet headerActions()}
				<ShareControl matchId={gameDetails!.match_id} />
			{/snippet}
		</GameDetailView>
	</main>
{/if}
