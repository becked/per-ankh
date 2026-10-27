<script module lang="ts">
	import type { MapPin } from "$lib/game-detail/map-pins";

	/**
	 * One pin the map can place: the pin itself, and the centre of the hex it
	 * hangs from in WORLD units. Derived in SpriteMap beside `cityBanners`, for
	 * the reason a `CityBanner` carries its own `worldX`/`worldY` — the hex
	 * geometry is that component's, and a second copy of it on this side would
	 * drift off the tiles it marks.
	 */
	export interface PlacedPin {
		pin: MapPin;
		worldX: number;
		worldY: number;
	}
</script>

<script lang="ts">
	// Map-pin markers: a DOM overlay inside SpriteMap, one teardrop per pin,
	// following the camera the way the city banners do.
	//
	// A DOM overlay rather than a deck.gl layer, and for the opposite reason to
	// the unit plates: a plate is the pick target its card hangs off, where a
	// pin raises nothing of its own. The hex UNDER it already opens the tile
	// panel, and that panel is where the pin's own row goes — so the marker is
	// `pointer-events: none` and the hover it would have taken stays with the
	// tile.
	//
	// Drawn in CSS rather than from a sprite because the game ships none we
	// have: SPRITE_MANIFEST carries no PING_* entry, and `SpriteIcon` renders
	// nothing at all when `getSpritePath` returns null, so a sprite-only marker
	// would be invisible. The head is a fixed-size box either way — an
	// improvement pin fills it with the improvement's own icon, a note leaves
	// it empty — so the two kinds line up on the hex instead of sitting at
	// different heights.
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import { projectToCanvas, type ViewState } from "$lib/game-detail/map-chrome";

	let {
		pins,
		viewState,
		canvasWidth,
		canvasHeight,
	}: {
		// Already cut to the selected turn and to the pins the grid can place.
		// A pin on no tile is not in here — `resolveMapPins` leaves its
		// position null and the Map Pins tab lists it instead.
		pins: PlacedPin[];
		viewState: ViewState;
		canvasWidth: number;
		canvasHeight: number;
	} = $props();

	function footOf(placed: PlacedPin): [number, number] {
		return projectToCanvas(
			[placed.worldX, placed.worldY],
			viewState,
			canvasWidth,
			canvasHeight,
		);
	}
</script>

{#each pins as placed (placed.pin.key)}
	{@const [left, top] = footOf(placed)}
	<div
		class="map-pin"
		style="left: {left}px; top: {top}px; --pin-color: {placed.pin.ownerColor};"
		aria-hidden="true"
	>
		<span class="pin-head">
			{#if placed.pin.improvementSprite}
				<SpriteIcon
					category="improvements"
					value={placed.pin.improvementSprite}
					size={12}
				/>
			{/if}
		</span>
	</div>
{/each}

<style>
	/* Anchored by its point, which sits on the hex centre. */
	.map-pin {
		position: absolute;
		transform: translate(-50%, -100%);
		pointer-events: none;
		z-index: 4;
	}

	/* The head: the seat's colour behind the improvement icon, ringed in the
	   same black the unit plate wears so it reads against both the painted
	   terrain and a political fill. */
	.pin-head {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background-color: var(--pin-color);
		border: 1px solid rgb(var(--color-black) / 0.8);
		box-shadow: 0 1px 3px rgb(var(--color-black) / 0.6);
	}

	/* The point, below the head and pointing into the hex. */
	.map-pin::after {
		content: "";
		position: absolute;
		top: 100%;
		left: 50%;
		margin-left: -4px;
		margin-top: -2px;
		border-left: 4px solid transparent;
		border-right: 4px solid transparent;
		border-top: 6px solid var(--pin-color);
		filter: drop-shadow(0 1px 1px rgb(var(--color-black) / 0.6));
	}
</style>
