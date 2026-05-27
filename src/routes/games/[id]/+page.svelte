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
	import { formatGameTitle } from "$lib/utils/formatting";
	import Breadcrumb, { type Crumb } from "$lib/Breadcrumb.svelte";
	import ReimportButton from "$lib/ReimportButton.svelte";
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

	// Effective game title — same derivation GameDetailView used for its old
	// H1. Forms the breadcrumb's leaf (current page) segment.
	const gameTitle = $derived(
		formatGameTitle({
			display_name: game.display_name ?? null,
			game_name: game.game_details.game_name,
			save_owner_nation:
				game.user_nation ??
				game.game_details.players.find((p) => p.is_human)?.nation ??
				null,
			total_turns: game.game_details.total_turns,
			match_id: game.game_details.match_id,
		}),
	);

	// Canonical breadcrumb trail, derived from the game's own data so it's
	// stable across direct links, refreshes, and re-entry. A tournament game's
	// parent is its tournament; otherwise the parent is the uploader's profile.
	const crumbs = $derived.by((): Crumb[] => {
		const trail: Crumb[] = [{ label: "Home", href: resolve("/") }];
		if (data.tournamentLink) {
			trail.push({ label: "Tournaments", href: resolve("/tournaments") });
			trail.push({
				label: data.tournamentLink.tournament.name,
				href: resolve("/tournaments/[slug]", {
					slug: data.tournamentLink.tournament.slug,
				}),
			});
		} else if (game.user_id && game.user_display_name) {
			trail.push({
				label: game.user_display_name,
				href: resolve("/users/[user_id]", { user_id: game.user_id }),
			});
		}
		trail.push({ label: gameTitle });
		return trail;
	});
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-screen-2xl">
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
					playerRoster={game.player_roster}
					userNation={game.user_nation ?? null}
					userDisplayName={game.user_display_name ?? null}
					userWon={game.user_won ?? null}
					displayName={game.display_name ?? null}
					{mapTiles}
					{selectedMapTurn}
					onMapTurnChange={handleMapTurnChange}
				>
					{#snippet titleSlot()}
						<Breadcrumb {crumbs} class="min-w-0" />
					{/snippet}
					{#snippet headerActions()}
						<!--
						currentCollectionId is omitted: with the sidebar gone we no
						longer load the games list here, so the "already in this
						collection" checkmark is unavailable. The move action still
						works; the Games-tab row menu shows the indicator instead.
					-->
						<GameActions
							{gameId}
							{isOwner}
							bind:isPublic
							collections={data.collections ?? []}
							displayName={game.display_name ?? null}
							gameName={game.game_details.game_name ?? null}
						/>
					{/snippet}
					{#snippet preTabs()}
						{#if isReimportAvailable}
							<div
								class="mb-4 flex w-fit flex-wrap items-center gap-3 rounded-lg border border-[#2a2622] bg-[#241f1b] p-2 shadow-lg"
							>
								<p class="rounded bg-[#2a2622] px-2.5 py-1 text-xs italic text-tan">
									This game was parsed with version {game.parser_version}. Reparse
									to use the latest version ({PARSER_VERSION}).
								</p>
								<ReimportButton {gameId} />
							</div>
						{/if}
					{/snippet}
				</GameDetailView>
			</div>
		</div>
	</main>
</div>
