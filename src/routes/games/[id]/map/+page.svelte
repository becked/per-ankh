<script lang="ts">
	import { untrack } from "svelte";
	import { BitsConfig } from "bits-ui";
	import type { PageData } from "./$types";
	import type { MapTile } from "$lib/types/MapTile";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import FullscreenDialog from "$lib/ui/FullscreenDialog.svelte";
	import Popover from "$lib/ui/Popover.svelte";
	import CityPopover from "$lib/game-detail/CityPopover.svelte";
	import GameHeader from "$lib/game-detail/GameHeader.svelte";
	import GameTab from "$lib/game-detail/GameTab.svelte";
	import MapChrome from "$lib/game-detail/MapChrome.svelte";
	import {
		GameTabState,
		gameTabs,
		resolveTabId,
		setGameTabState,
		type GameTabId,
	} from "$lib/game-detail/game-tabs.svelte";
	import {
		resolveGamePlayers,
		saveOwnerPlayer,
		type DetailPlayer,
	} from "$lib/game-detail/helpers";
	import { CHROME_PANEL_CLASS } from "$lib/game-detail/map-chrome";
	import { reconstructMapTiles } from "$lib/game-detail/reconstruct-map-tiles";
	import SpriteMap from "$lib/SpriteMap.svelte";

	let { data }: { data: PageData } = $props();
	const game = $derived(data.game);
	const players = $derived(resolveGamePlayers(game));

	// Whose view the chrome opens on: the uploader's player, or player 0 for an
	// observer upload. Keyed on `uploader_nation`, the raw choice — the
	// response's `user_nation` falls back to the first human's nation, so it's
	// never null.
	function defaultPlayerId(
		g: typeof data.game,
		list: DetailPlayer[],
	): number | null {
		const owner =
			g.uploader_nation != null
				? saveOwnerPlayer(list, g.uploader_nation)
				: list.find((p) => p.playerId === 0);
		return (owner ?? list[0])?.playerId ?? null;
	}

	// The map's turn, defaulting to the final one, and the chrome's player.
	// Initialised at component construction (not in $effect) so the SSR'd HTML
	// already has the turn slider at that turn and the chrome in that player's
	// view, rather than adding them on hydration; $effect doesn't run during
	// SSR.
	// svelte-ignore state_referenced_locally
	let selectedMapTurn = $state<number>(data.game.game_details.total_turns);
	// svelte-ignore state_referenced_locally
	let mapTiles = $state<MapTile[]>(data.game.map_tiles);
	// svelte-ignore state_referenced_locally
	let playerId = $state<number | null>(defaultPlayerId(data.game, players));
	let showPolitical = $state(true);
	let showReligion = $state(false);

	// Re-sync when the route navigates to a different game. Only the match id
	// is tracked; the body reads via untrack(), so a revalidation for the same
	// game (e.g. invalidateAll() from a rename) keeps the selected turn and
	// player.
	$effect(() => {
		game.game_details.match_id;
		untrack(() => {
			selectedMapTurn = game.game_details.total_turns;
			mapTiles = game.map_tiles;
			playerId = defaultPlayerId(game, players);
		});
	});

	async function handleMapTurnChange(turn: number) {
		selectedMapTurn = turn;
		mapTiles = reconstructMapTiles(game, turn);
	}

	// ─── City popover ─────────────────────────────────────────────────
	// Opened from a city banner and anchored to it, so it tracks the map as
	// the camera moves. It stays live while the turn slider scrubs, and closes
	// once the selected turn is one the city has no banner at — before it was
	// founded, or while it sits unowned mid-capture.
	let popoverCity = $state<string | null>(null);
	let popoverAnchor = $state<HTMLElement | null>(null);

	const bannerCities = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Set, not reactive state
		const names = new Set<string>();
		for (const t of mapTiles) {
			if (t.is_city_center && t.owner_city) names.add(t.owner_city);
		}
		return names;
	});

	$effect(() => {
		if (popoverCity !== null && !bannerCities.has(popoverCity)) {
			popoverCity = null;
			popoverAnchor = null;
		}
	});

	function openCityPopover(cityName: string, element: HTMLElement) {
		popoverCity = cityName;
		popoverAnchor = element;
	}

	// ─── Lightboxes ───────────────────────────────────────────────────
	// The chrome opens the game's analysis tabs in a lightbox, one at a time.
	// The tabs' filters and sorts live here, so a lightbox reopens as it was
	// left.
	setGameTabState(new GameTabState(() => game));

	const tabs = $derived(gameTabs(game));
	// The lightbox's tab stays set while the lightbox animates closed, and
	// clears once it has.
	let lightboxTab = $state<GameTabId | null>(null);
	// The yield the lightbox opens at, when a yield strip slot opened it: the
	// Yields tab lands on that yield's chart rather than at the top of its
	// stack. Null for every other way in — a menu icon, a panel, a hash.
	let lightboxYield = $state<string | null>(null);
	let lightboxOpen = $state(false);
	let lightboxDialog = $state<HTMLDialogElement | null>(null);
	const lightboxLabel = $derived(
		tabs.find((tab) => tab.id === lightboxTab)?.label,
	);

	// Only a tab this game has: a hash can name one it doesn't (#leaders on a
	// game with no rulers), or no tab at all.
	function openLightbox(id: string, atYield: string | null = null) {
		const tab = tabs.find((t) => t.id === resolveTabId(id));
		if (!tab) return;
		lightboxTab = tab.id;
		lightboxYield = atYield;
		lightboxOpen = true;
	}

	// Deep-link the open lightbox via the URL hash (#techs), as the analyst
	// view does its tab (GameDetailView): a reload or a shared link reopens
	// it. The client opens it on mount, since the hash never reaches the
	// server.
	$effect(() => {
		const fromHash = window.location.hash.replace(/^#/, "");
		if (fromHash) untrack(() => openLightbox(fromHash));
	});
	$effect(() => {
		const target = lightboxTab ? `#${lightboxTab}` : "";
		if (window.location.hash !== target) {
			history.replaceState(
				history.state,
				"",
				`${window.location.pathname}${window.location.search}${target}`,
			);
		}
	});
</script>

<main class="isolate flex flex-1 flex-col overflow-hidden">
	<div class="px-4 pt-4">
		<div class="mx-auto max-w-screen-2xl">
			<GameHeader
				{game}
				isOwner={data.isOwner}
				collections={data.collections}
				tournamentLink={data.tournamentLink}
				challengeLink={data.challengeLink}
			/>
		</div>
	</div>

	{#if game.map_tiles.length === 0}
		<div class="px-4">
			<p class="mx-auto max-w-screen-2xl italic text-tan">
				No map data available for this game.
			</p>
		</div>
	{:else}
		<div class="relative min-h-0 flex-1">
			<SpriteMap
				tiles={mapTiles}
				cities={game.city_statistics.cities}
				playerNations={game.player_nations}
				{showPolitical}
				{showReligion}
				isFinalTurn={selectedMapTurn >= game.game_details.total_turns}
				onCityClick={openCityPopover}
			/>
			<MapChrome
				{game}
				{players}
				bind:playerId
				selectedTurn={selectedMapTurn}
				onTurnChange={handleMapTurnChange}
				onOpenTab={openLightbox}
				bind:showPolitical
				bind:showReligion
			/>
		</div>
	{/if}

	<Popover
		open={popoverCity !== null}
		onOpenChange={(o) => {
			if (!o) {
				popoverCity = null;
				popoverAnchor = null;
			}
		}}
		customAnchor={popoverAnchor}
		updatePositionStrategy="always"
		side="top"
		align="center"
		contentClass="w-[min(94vw,44rem)]"
		frameClass="{CHROME_PANEL_CLASS} p-3"
		ariaLabel="City detail"
	>
		{#if popoverCity}
			<CityPopover
				{game}
				{players}
				cityName={popoverCity}
				turn={selectedMapTurn}
			/>
		{/if}
	</Popover>

	<FullscreenDialog
		bind:open={lightboxOpen}
		bind:dialog={lightboxDialog}
		onclose={() => (lightboxTab = null)}
	>
		<div
			class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-blue-gray"
		>
			<div
				class="flex flex-shrink-0 items-center justify-between border-b border-tan/20 px-4 py-2"
			>
				<h2 class="text-lg font-bold text-bright">{lightboxLabel}</h2>
				<button
					onclick={() => (lightboxOpen = false)}
					class="cursor-pointer rounded bg-black/20 p-1.5 transition-colors hover:bg-black/40 focus:outline-none"
					aria-label="Close {lightboxLabel}"
					title="Close (Esc)"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="block h-4 w-4 text-white"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>
			<!-- Scrolls as the analyst view's page does, so the tabs' sticky
			     headers and toolbars sit where they do there. -->
			<div
				class="cloud-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4"
				use:autohideScroll
			>
				{#if lightboxTab && lightboxDialog}
					<!-- The tabs' selects and tooltips portal to body by default,
					     which the modal dialog makes inert. -->
					<BitsConfig defaultPortalTo={lightboxDialog}>
						<!-- The whole game, as the analyst view renders it: never the
						     chrome's player or turn (#269). -->
						<GameTab {game} tab={lightboxTab} openAtYield={lightboxYield} />
					</BitsConfig>
				{/if}
			</div>
		</div>
	</FullscreenDialog>
</main>
