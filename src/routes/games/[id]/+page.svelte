<script lang="ts">
	import { untrack } from "svelte";
	import { page } from "$app/state";
	import type { PageData } from "./$types";
	import type { MapTile } from "$lib/types/MapTile";
	import { GameDetailView } from "$lib/game-detail";
	import { reconstructMapTiles } from "$lib/game-detail/reconstruct-map-tiles";
	import { formatEnum } from "$lib/utils/formatting";
	import { isNewer } from "$lib/utils/semver";
	import { PARSER_VERSION } from "$lib/parser/types";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import ReimportButton from "$lib/ReimportButton.svelte";
	import CloudGameSidebar from "$lib/CloudGameSidebar.svelte";
	import GameActions from "$lib/GameActions.svelte";

	let { data }: { data: PageData } = $props();
	const game = $derived(data.game);
	const isOwner = $derived(data.isOwner);
	// Cloud game id from URL — distinct from the in-game `xml_game_id`
	// which is the GameId attribute on the save's <Root> element.
	const gameId = $derived(page.params.id ?? "");

	// OG tags for Discord/Slack/Twitter unfurls. Composed from server-known
	// match metadata only — no PII concerns; same data anonymous viewers
	// already see in the page body.
	const PUBLIC_ORIGIN = (
		import.meta.env.VITE_PUBLIC_ORIGIN ?? "https://per-ankh.app"
	) as string;
	const ogTitle = $derived(game.game_details.game_name ?? "Old World game");
	const ogDescription = $derived(
		(() => {
			const gd = game.game_details;
			const parts: string[] = [];
			if (gd.winner_civilization) {
				parts.push(formatEnum(gd.winner_civilization, "NATION_"));
			} else if (gd.winner_name) {
				parts.push(gd.winner_name);
			}
			if (gd.winner_victory_type) {
				const v = formatEnum(gd.winner_victory_type, "VICTORY_");
				parts.push(`won by ${v}`);
			}
			parts.push(`turn ${gd.total_turns}`);
			return parts.length > 0
				? parts.join(", ")
				: "An Old World save game on Per-Ankh.";
		})(),
	);
	const ogUrl = $derived(`${PUBLIC_ORIGIN}/games/${gameId}`);
	const ogImage = $derived(`${PUBLIC_ORIGIN}/og-default.png`);

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

<svelte:head>
	<title>{ogTitle} — Per-Ankh</title>
	<meta property="og:title" content={ogTitle} />
	<meta property="og:description" content={ogDescription} />
	<meta property="og:url" content={ogUrl} />
	<meta property="og:image" content={ogImage} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Per-Ankh" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={ogTitle} />
	<meta name="twitter:description" content={ogDescription} />
	<meta name="twitter:image" content={ogImage} />
	<meta name="description" content={ogDescription} />
</svelte:head>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4" use:autohideScroll>
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
			>
				{#snippet headerActions()}
					<GameActions {gameId} {isOwner} bind:isPublic />
				{/snippet}
				{#snippet preTabs()}
					{#if isReimportAvailable}
						<div
							class="mb-4 flex items-center justify-between rounded border border-orange bg-orange/10 px-4 py-2"
						>
							<p class="text-xs text-tan">
								This game was parsed with an older version ({game.parser_version}).
								Click Reparse for the latest version ({PARSER_VERSION}).
							</p>
							<ReimportButton {gameId} />
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
