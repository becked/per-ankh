<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import type { PageData } from "./$types";
	import type { MapTile } from "$lib/types/MapTile";
	import { GameDetailView } from "$lib/game-detail";
	import { reconstructMapTiles } from "$lib/game-detail/reconstruct-map-tiles";
	import { cloudApi } from "$lib/api-cloud";

	let { data }: { data: PageData } = $props();
	const game = $derived(data.game);
	// Cloud game id from URL — distinct from the in-game `xml_game_id`
	// which is the GameId attribute on the save's <Root> element.
	const gameId = $derived(page.params.id ?? "");

	let selectedMapTurn = $state<number | null>(null);
	let mapTiles = $state<MapTile[]>([]);
	let deleting = $state(false);

	// Initialise map state when the loaded game changes (route navigation
	// keeps the component alive across game ids).
	$effect(() => {
		const g = game;
		selectedMapTurn = g.game_details.total_turns;
		mapTiles = g.map_tiles;
	});

	async function handleMapTurnChange(turn: number) {
		selectedMapTurn = turn;
		mapTiles = reconstructMapTiles(game, turn);
	}

	async function deleteGame() {
		if (!window.confirm("Delete this game permanently?")) return;
		deleting = true;
		try {
			await cloudApi.deleteGame(gameId);
			await goto("/games", { replaceState: true });
		} catch (err) {
			deleting = false;
			alert(`Delete failed: ${err instanceof Error ? err.message : err}`);
		}
	}
</script>

<svelte:head>
	<title>{game.game_details.game_name ?? "Game"} — Per-Ankh</title>
</svelte:head>

<main class="isolate flex h-screen flex-1 flex-col overflow-hidden bg-blue-gray">
	<header class="flex shrink-0 items-center justify-between border-b border-brown bg-[#2a2622] px-4 py-2">
		<a href="/games" class="text-sm text-tan hover:text-orange">← Games</a>
		<button
			type="button"
			onclick={deleteGame}
			disabled={deleting}
			class="rounded bg-brown px-3 py-1 text-xs text-tan hover:bg-orange disabled:opacity-50"
		>
			{deleting ? "Deleting…" : "Delete game"}
		</button>
	</header>
	<div class="flex-1 overflow-y-auto px-4 pb-8 pt-4">
		<GameDetailView
			gameDetails={game.game_details}
			playerHistory={game.player_history}
			allYields={game.yield_history}
			eventLogs={game.event_logs}
			lawAdoptionHistory={game.law_adoption_history}
			currentLaws={game.current_laws}
			techDiscoveryHistory={game.tech_discovery_history}
			completedTechs={game.completed_techs}
			unitsProduced={game.units_produced}
			cityStatistics={game.city_statistics}
			improvementData={game.improvement_data}
			gameReligions={game.game_religions}
			playerWonders={game.player_wonders}
			{mapTiles}
			{selectedMapTurn}
			onMapTurnChange={handleMapTurnChange}
		/>
	</div>
</main>
