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
	import UnitPopover from "$lib/game-detail/UnitPopover.svelte";
	import {
		GameTabState,
		gameTabs,
		resolveTabId,
		setGameTabState,
		type GameTabId,
	} from "$lib/game-detail/game-tabs.svelte";
	import {
		classifyUnit,
		getSpritePath,
		resolveGamePlayers,
		saveOwnerPlayer,
		unitOwner,
		type DetailPlayer,
	} from "$lib/game-detail/helpers";
	import { HoverLockCard } from "$lib/game-detail/hover-lock-card.svelte";
	import {
		CHROME_PANEL_CLASS,
		type TileCoord,
		type UnitMarker,
	} from "$lib/game-detail/map-chrome";
	import {
		reconstructMapTiles,
		tileXmlId,
	} from "$lib/game-detail/reconstruct-map-tiles";
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
	// Off by default, as Religion is: borders are part of reading a map, a
	// final-turn army is a question you go looking for.
	let showUnits = $state(false);

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
			// Same reason the locked coordinates clear: a unit's `xml_id` is a
			// per-save id, so a card left standing would re-derive onto whatever
			// unit holds that id in the next game — and small integers collide
			// freely across saves.
			unitCard.close();
		});
	});

	async function handleMapTurnChange(turn: number) {
		selectedMapTurn = turn;
		mapTiles = reconstructMapTiles(game, turn);
	}

	// Whether the map is showing the final turn, which is the only turn the
	// save records unit positions at. Read by the units layer and by the unit
	// card's own close.
	const isFinalTurn = $derived(
		selectedMapTurn >= game.game_details.total_turns,
	);

	// ─── Unit markers ─────────────────────────────────────────────────
	// The military units standing on the map at the final turn, placed on
	// their hex and coloured by owner. Derived off `game` alone and not off the
	// selected turn: `UnitInfo` is a snapshot of `<Tile>/<Unit>`, the save
	// carries no position history, and `<LastSeenUnits>` records no turn, so it
	// is remembered end-of-game state rather than a second source
	// (`docs/save-file-format.md:625`). SpriteMap hides the layer away from the
	// final turn.
	//
	// Military only, this pass: `classifyUnit` resolves each unit from the
	// game's own `<UnitCycle>`, and non-null is a combat unit — which agrees
	// with `InfoHelpers.canDamage` (`InfoHelpers.cs:741`, `mbMelee ||
	// miRangeMax > 0`) on all 91 `unit.xml` types, in both directions. 1,411 of
	// the 2,179 units in `test-data/saves/` qualify.
	//
	// A tribe's unit is one whose `player_xml_id` is null. `tribe` is NOT the
	// test: the save writes `Tribe="NONE"`, which the parser keeps as a string,
	// so the field is non-null on every player-owned unit — all 1,157 of them
	// across the corpus.
	const unitMarkers = $derived.by<UnitMarker[]>(() => {
		const mapWidth = game.game_details.map_width;
		// Without map_width there is no (x, y) → tile_xml_id key, so no join.
		if (mapWidth == null) return [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const tileById = new Map<number, MapTile>();
		for (const t of game.map_tiles) {
			tileById.set(tileXmlId(t.x, t.y, mapWidth), t);
		}
		// `units` isn't required by the Worker's blob schema, so a blob parsed
		// before it existed doesn't carry it — the same default CityPopover
		// applies.
		const military = (game.units ?? []).filter(
			(u) => classifyUnit(u.unit_type) != null,
		);

		const out: UnitMarker[] = [];
		for (const u of military) {
			const tile = tileById.get(u.tile_xml_id);
			// A unit whose tile the snapshot has no entry for doesn't draw. None
			// across the corpus — all 1,411 resolve — but a blob is only as good
			// as the parser that wrote it.
			if (!tile) continue;
			out.push({
				xmlId: u.xml_id,
				x: tile.x,
				y: tile.y,
				// The same resolver the unit card's heading runs, so the plate and
				// the card it opens agree on whose colour this is.
				color: unitOwner(u, players).color,
				glyphUrl: getSpritePath("units", u.unit_type, { glyph: true }),
			});
		}
		return out;
	});

	// ─── The map's two cards ──────────────────────────────────────────
	// A city's, opened from its banner, and a unit's, opened from its marker.
	// Both behave the same way — hover to open, right-click to pin, ✕ or a
	// second right-click to let go — because both run on the same state (see
	// HoverLockCard, which holds the reasoning).
	//
	// Each closes when the thing it names leaves the map. The city card does so
	// once the selected turn is one its city has no banner at — before it was
	// founded, or while it sits unowned mid-capture. The unit card does so when
	// its marker goes, which is the Units layer being switched off, the slider
	// leaving the final turn, or a navigation to another game: a unit's
	// `xml_id` is a per-save id, so a card left standing would re-derive onto
	// whatever unit holds that id next.
	const cityCard = new HoverLockCard<string>();
	const unitCard = new HoverLockCard<number>();

	const bannerCities = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Set, not reactive state
		const names = new Set<string>();
		for (const t of mapTiles) {
			if (t.is_city_center && t.owner_city) names.add(t.owner_city);
		}
		return names;
	});

	$effect(() => {
		if (cityCard.key !== null && !bannerCities.has(cityCard.key)) {
			cityCard.close();
		}
	});

	$effect(() => {
		if (unitCard.key === null) return;
		if (
			!showUnits ||
			!isFinalTurn ||
			!unitMarkers.some((m) => m.xmlId === unitCard.key)
		) {
			unitCard.close();
		}
	});

	$effect(() => () => {
		cityCard.dispose();
		unitCard.dispose();
	});

	// bits-ui renders a card on `document.body` — floating panels are
	// portaled so an ancestor's `overflow: hidden` can't clip them, and the
	// map box has one. That puts the card outside `.sprite-map-container`,
	// whose handler suppresses the browser's context menu over the map and
	// its overlays, so a right-click on the card opened the page menu on top
	// of the map. Locking is the marker's gesture and not the card's, so the
	// card has nothing to do with the event beyond swallowing it.
	function suppressCardContextMenu(e: MouseEvent) {
		e.preventDefault();
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
				units={unitMarkers}
				{showPolitical}
				{showReligion}
				{showUnits}
				{isFinalTurn}
				{lockedTiles}
				onToggleLock={toggleTileLock}
				onCityHover={(name, el) => cityCard.hover(name, el)}
				onCityLeave={() => cityCard.leave()}
				onCityToggleLock={(name, el) => cityCard.toggleLock(name, el)}
				cardCity={cityCard.key}
				onCardOffCanvas={(off) => cityCard.setOffCanvas(off)}
				onUnitHover={(id, el) => unitCard.hover(id, el)}
				onUnitLeave={() => unitCard.leave()}
				onUnitToggleLock={(id, el) => unitCard.toggleLock(id, el)}
				cardUnit={unitCard.key}
				onUnitCardOffCanvas={(off) => unitCard.setOffCanvas(off)}
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
				bind:showUnits
			/>
		</div>
	{/if}

	<Popover
		open={cityCard.open}
		onOpenChange={(o) => {
			if (!o) cityCard.close();
		}}
		customAnchor={cityCard.anchor}
		updatePositionStrategy="always"
		interactOutsideBehavior={cityCard.locked ? "ignore" : "close"}
		side="top"
		align="center"
		contentClass="w-[min(94vw,44rem)]"
		frameClass="{CHROME_PANEL_CLASS} p-3"
		ariaLabel="City detail"
		autoFocus={false}
		onpointerenter={() => cityCard.cancelClose()}
		onpointerleave={() => cityCard.leave()}
		oncontextmenu={suppressCardContextMenu}
	>
		{#if cityCard.key !== null}
			<CityPopover
				{game}
				{players}
				cityName={cityCard.key}
				turn={selectedMapTurn}
				onUnlock={cityCard.locked ? () => cityCard.close() : undefined}
			/>
		{/if}
	</Popover>

	<!-- The unit card. Narrower than the city's: it is one unit's record
	     rather than a city's four zones, and it hangs over a marker that can
	     sit anywhere on the map. -->
	<Popover
		open={unitCard.open}
		onOpenChange={(o) => {
			if (!o) unitCard.close();
		}}
		customAnchor={unitCard.anchor}
		updatePositionStrategy="always"
		interactOutsideBehavior={unitCard.locked ? "ignore" : "close"}
		side="top"
		align="center"
		contentClass="w-[min(94vw,22rem)]"
		frameClass="{CHROME_PANEL_CLASS} p-3"
		ariaLabel="Unit detail"
		autoFocus={false}
		onpointerenter={() => unitCard.cancelClose()}
		onpointerleave={() => unitCard.leave()}
		oncontextmenu={suppressCardContextMenu}
	>
		{#if unitCard.key !== null}
			<UnitPopover
				{game}
				{players}
				unitXmlId={unitCard.key}
				onUnlock={unitCard.locked ? () => unitCard.close() : undefined}
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
