<script lang="ts">
	import { untrack } from "svelte";
	import { page } from "$app/state";
	import type { PageData } from "./$types";
	import type { MapTile } from "$lib/types/MapTile";
	import { GameDetailView } from "$lib/game-detail";
	import { reconstructMapTiles } from "$lib/game-detail/reconstruct-map-tiles";
	import { isNewer } from "$lib/utils/semver";
	import { PARSER_VERSION } from "$lib/parser/types";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import { resolve } from "$app/paths";
	import ReimportButton from "$lib/ReimportButton.svelte";
	import CloudGameSidebar from "$lib/CloudGameSidebar.svelte";
	import GameActions from "$lib/GameActions.svelte";

	let { data }: { data: PageData } = $props();
	const game = $derived(data.game);
	const isOwner = $derived(data.isOwner);
	// Cloud game id from URL — distinct from the in-game `xml_game_id`
	// which is the GameId attribute on the save's <Root> element.
	const gameId = $derived(page.params.id ?? "");

	let selectedMapTurn = $state<number | null>(null);
	let mapTiles = $state<MapTile[]>([]);
	// Visibility toggle state — read from the server-injected `is_public`
	// field on owner responses. Initialise at component construction (not in
	// $effect) so the SSR'd HTML renders the correct toggle position;
	// $effect doesn't run during SSR. The $effect below re-syncs on
	// client-side navigation between games. Public viewers don't see the
	// toggle.
	// svelte-ignore state_referenced_locally
	let isPublic = $state(
		(data.game as { is_public?: boolean }).is_public ?? false,
	);

	// Re-import banner: shown to owners when the stored parser_version is
	// older than the current build's PARSER_VERSION. The blob carries
	// parser_version through from the gzipped JSON in R2, so this works
	// without a separate API call. Hidden for anonymous viewers (public
	// games) and non-owner signed-in viewers (`isOwner` is false in both).
	const isReimportAvailable = $derived(
		isOwner && isNewer(PARSER_VERSION, game.parser_version),
	);

	// Re-sync state when the route navigates to a different game. Only
	// the match id is tracked; the body reads via untrack(). This avoids
	// clobbering an in-flight optimistic visibility toggle if the page is
	// revalidated for the same game (e.g. invalidateAll() from a sidebar
	// action) — the new server `is_public` would race the optimistic flip.
	$effect(() => {
		game.game_details.match_id;
		untrack(() => {
			selectedMapTurn = game.game_details.total_turns;
			mapTiles = game.map_tiles;
			isPublic = (game as { is_public?: boolean }).is_public ?? false;
		});
	});

	async function handleMapTurnChange(turn: number) {
		selectedMapTurn = turn;
		mapTiles = reconstructMapTiles(game, turn);
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
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
				userNation={game.user_nation ?? null}
				userDisplayName={game.user_display_name ?? null}
				userWon={game.user_won ?? null}
				{mapTiles}
				{selectedMapTurn}
				onMapTurnChange={handleMapTurnChange}
			>
				{#snippet headerActions()}
					<GameActions
						{gameId}
						{isOwner}
						bind:isPublic
						collections={data.collections ?? []}
						currentCollectionId={data.games?.find((g) => g.game_id === gameId)
							?.collection_id ?? null}
					/>
				{/snippet}
				{#snippet preTabs()}
					{#if isReimportAvailable}
						<div
							class="bg-orange/10 mb-4 flex items-center justify-between rounded border border-orange px-4 py-2"
						>
							<p class="text-xs text-tan">
								This game was parsed with an older version ({game.parser_version}).
								Click Reparse for the latest version ({PARSER_VERSION}).
							</p>
							<ReimportButton {gameId} />
						</div>
					{/if}
					{#if data.tournamentLink}
						<div
							class="bg-orange/10 mb-4 rounded border border-orange px-4 py-2 text-xs text-tan"
						>
							<a
								class="font-bold text-orange hover:underline"
								href="{resolve('/tournaments/[slug]', {
									slug: data.tournamentLink.tournament.slug,
								})}?match={data.tournamentLink.match.match_id}"
							>
								{data.tournamentLink.tournament.name}
							</a>
							<span class="opacity-80">
								— Round {data.tournamentLink.match.round_number}: {data
									.tournamentLink.match.slot_a_username ?? "—"} vs
								{data.tournamentLink.match.slot_b_username ?? "—"}
							</span>
						</div>
					{/if}
				{/snippet}
			</GameDetailView>
		</div>
	</main>

	{#if isOwner && data.games}
		<CloudGameSidebar
			games={data.games}
			collections={data.collections ?? []}
			publicCount={data.publicCount}
			currentGameId={gameId}
		/>
	{/if}
</div>
