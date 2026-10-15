<script lang="ts">
	import { untrack } from "svelte";
	import { BitsConfig } from "bits-ui";
	import type { PageData } from "./$types";
	import type { MapTile } from "$lib/types/MapTile";
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
	import {
		CHROME_PANEL_CLASS,
		type TileCoord,
	} from "$lib/game-detail/map-chrome";
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

	// ─── Locked tile panels ───────────────────────────────────────────
	// Right-clicking a tile leaves a copy of its hover panel glued to its hex,
	// so two tiles can be compared side by side and a tile's detail stays
	// readable while the pointer is somewhere else. SpriteMap raises the
	// toggle and renders the panels; the coordinates live here, beside the
	// city popover's state, because the route keeps one SpriteMap across
	// /games/A/map → /games/B/map and SpriteMap takes no game identity: a
	// coordinate locked in one game would re-derive onto the next game's tile
	// at the same coordinate. So the list clears with the rest of the
	// per-game state below.
	let lockedTiles = $state<TileCoord[]>([]);

	function toggleTileLock(tile: TileCoord) {
		const held = lockedTiles.some((l) => l.x === tile.x && l.y === tile.y);
		lockedTiles = held
			? lockedTiles.filter((l) => l.x !== tile.x || l.y !== tile.y)
			: [...lockedTiles, { x: tile.x, y: tile.y }];
	}

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
			lockedTiles = [];
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
	//
	// Pointing at a banner is enough to open it. bits-ui has this built in
	// (`openOnHover` on `Popover.Trigger`, with a safe-polygon bridge), but it
	// hangs off the trigger's own node, and this card has no trigger: the
	// banner is drawn inside SpriteMap while the card needs the whole game, so
	// it's anchored from out here. Hence the two halves of hover intent by
	// hand, at the delays already in use — the open delay is the chrome's own
	// tooltips (`delayDuration={200}`, MapChrome and MapYieldStrip), the close
	// delay is bits-ui's `closeDelay` default for the trigger above.
	//
	// A click PINS what hover opened: a touch raises no hover at all, so tap
	// is the only way in on a phone, and a card that evaporated the moment the
	// pointer wandered off would be worse than the click-only card this
	// replaces.
	const HOVER_OPEN_MS = 200;
	const HOVER_CLOSE_MS = 300;

	let popoverCity = $state<string | null>(null);
	let popoverAnchor = $state<HTMLElement | null>(null);
	let popoverPinned = $state(false);
	let openTimer: ReturnType<typeof setTimeout> | null = null;
	let closeTimer: ReturnType<typeof setTimeout> | null = null;

	function cancelOpen() {
		if (openTimer === null) return;
		clearTimeout(openTimer);
		openTimer = null;
	}

	function cancelClose() {
		if (closeTimer === null) return;
		clearTimeout(closeTimer);
		closeTimer = null;
	}

	function closePopover() {
		cancelOpen();
		cancelClose();
		popoverCity = null;
		popoverAnchor = null;
		popoverPinned = false;
	}

	const bannerCities = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Set, not reactive state
		const names = new Set<string>();
		for (const t of mapTiles) {
			if (t.is_city_center && t.owner_city) names.add(t.owner_city);
		}
		return names;
	});

	$effect(() => {
		if (popoverCity !== null && !bannerCities.has(popoverCity)) closePopover();
	});

	// Timers outlive the component otherwise: scrubbing to a turn that drops
	// the banner, or navigating away, can land between the hover and the open.
	$effect(() => () => {
		cancelOpen();
		cancelClose();
	});

	// Hover, or keyboard focus, on a banner. Both arrive here so the card
	// opens the same way either way.
	function hoverCityBanner(cityName: string, element: HTMLElement) {
		cancelClose();
		if (popoverCity === cityName) return;
		cancelOpen();
		openTimer = setTimeout(() => {
			openTimer = null;
			popoverCity = cityName;
			popoverAnchor = element;
			popoverPinned = false;
		}, HOVER_OPEN_MS);
	}

	// The pointer left the banner, or the card. Either way the card has to
	// outlast the crossing between them — they are a `sideOffset` apart, and
	// the card is where a long city's record is read and scrolled.
	function leaveCityBanner() {
		cancelOpen();
		if (popoverCity === null || popoverPinned) return;
		cancelClose();
		closeTimer = setTimeout(() => {
			closeTimer = null;
			popoverCity = null;
			popoverAnchor = null;
		}, HOVER_CLOSE_MS);
	}

	function openCityPopover(cityName: string, element: HTMLElement) {
		cancelOpen();
		cancelClose();
		popoverCity = cityName;
		popoverAnchor = element;
		popoverPinned = true;
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
	let lightboxOpen = $state(false);
	let lightboxDialog = $state<HTMLDialogElement | null>(null);
	const lightboxLabel = $derived(
		tabs.find((tab) => tab.id === lightboxTab)?.label,
	);

	// Only a tab this game has: a hash can name one it doesn't (#leaders on a
	// game with no rulers), or no tab at all.
	function openLightbox(id: string) {
		const tab = tabs.find((t) => t.id === resolveTabId(id));
		if (!tab) return;
		lightboxTab = tab.id;
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
				{lockedTiles}
				onToggleLock={toggleTileLock}
				onCityHover={hoverCityBanner}
				onCityLeave={leaveCityBanner}
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
			if (!o) closePopover();
		}}
		customAnchor={popoverAnchor}
		updatePositionStrategy="always"
		side="top"
		align="center"
		contentClass="w-[min(94vw,44rem)]"
		frameClass="{CHROME_PANEL_CLASS} p-3"
		ariaLabel="City detail"
		autoFocus={false}
		onpointerenter={cancelClose}
		onpointerleave={leaveCityBanner}
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
			<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4">
				{#if lightboxTab && lightboxDialog}
					<!-- The tabs' selects and tooltips portal to body by default,
					     which the modal dialog makes inert. -->
					<BitsConfig defaultPortalTo={lightboxDialog}>
						<!-- The whole game, as the analyst view renders it: never the
						     chrome's player or turn (#269). -->
						<GameTab {game} tab={lightboxTab} />
					</BitsConfig>
				{/if}
			</div>
		</div>
	</FullscreenDialog>
</main>
