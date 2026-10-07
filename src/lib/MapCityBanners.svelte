<script module lang="ts">
	import type { MapTile } from "$lib/types/MapTile";

	/** One city's banner: where it sits on the map and what it says. */
	export interface CityBanner {
		cityName: string;
		/** Display name, already run through formatEnum. */
		label: string;
		/** The city-centre tile, handed back on hover so the tile panel shows. */
		tile: MapTile;
		/** Projected centre of the city-centre tile, in world units. */
		worldX: number;
		worldY: number;
		/** Owner nation's colour, resolved as the tile hover panel resolves it. */
		nationColor: string;
		nationCrestKey: string | null;
		familyCrestKey: string | null;
		isCapital: boolean;
		/** Citizens, or null away from the final turn — the count is end-of-game. */
		citizens: number | null;
	}
</script>

<script lang="ts">
	// City banners: a DOM overlay inside SpriteMap, one absolutely-positioned
	// button per city, sitting above the city sprite and following the camera.
	//
	// Not deck.gl layers: a banner wears the chrome's frame, its crests are
	// per-file sprites rather than atlas cells, and it's the click target for
	// the city popover — so it needs focus and keyboard.
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import { CHROME_PANEL_CLASS } from "$lib/game-detail/map-chrome";

	// How far above the tile centre the banner's foot sits, in WORLD units, so
	// it holds the same place at every zoom. This is the tile's own hex top
	// vertex — SpriteMap's HEX_RADIUS_Y, HEX_V_SPACING / 1.5 — so the frame
	// never floats past the hex it names. The atlas cell is 167 units tall
	// against a 122-unit row pitch, so the earlier 95 put the foot above the
	// vertex and into the neighbouring row, which is what made the centre tile
	// ambiguous; the caret under the frame points out the rest. The sprite's
	// top edge is ~84 units up, so the frame overlaps its topmost 3 units.
	const BANNER_WORLD_OFFSET_Y = 81;

	// Above this zoom a city gets the full framed banner; below it, the
	// name-only label the game falls back to when zoomed out. Measured over the
	// 122 local blobs, the closest pair of city centres in a game is 860 world
	// units apart at the median, 732 at p5 and 379 at the floor (hex spacing is
	// 199 × 122). At 2^-3.2 ≈ 0.109 screen px per world unit the median gap is
	// ~94 px, which a framed banner fits in. The threshold lands between the
	// fit-to-view zooms of the two map sizes in a 1440 × 775 viewport: a 46 × 46
	// map fits at -2.80 (framed banners), a 74 × 74 at -3.55 (labels, 74 px of
	// screen per median gap).
	const FULL_BANNER_MIN_ZOOM = -3.2;

	let {
		banners,
		viewState,
		canvasWidth,
		canvasHeight,
		onBannerHover,
		onBannerClick,
	}: {
		banners: CityBanner[];
		// The deck's current camera. The parent only renders this component
		// once it has one, so no banner is ever placed without it (and SSR
		// emits none).
		viewState: { target: [number, number, number]; zoom: number };
		canvasWidth: number;
		canvasHeight: number;
		// Hover hands the centre tile and the banner's foot (canvas-local CSS
		// pixels) back, so the parent can keep its tile panel up.
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onBannerHover: (tile: MapTile, screenX: number, screenY: number) => void;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onBannerClick: (cityName: string, element: HTMLElement) => void;
	} = $props();

	const scale = $derived(Math.pow(2, viewState.zoom));
	const full = $derived(viewState.zoom >= FULL_BANNER_MIN_ZOOM);

	/**
	 * World → canvas-local CSS pixels, the orthographic view's own affine:
	 * (world − target) × 2^zoom, centred on the canvas. OrthographicView's
	 * default flipY means growing world Y runs down the screen, which is the
	 * convention hexToPixel already negates into.
	 */
	function project(worldX: number, worldY: number): [number, number] {
		const [tx, ty] = viewState.target;
		return [
			(worldX - tx) * scale + canvasWidth / 2,
			(worldY - ty) * scale + canvasHeight / 2,
		];
	}

	function footOf(banner: CityBanner): [number, number] {
		return project(banner.worldX, banner.worldY - BANNER_WORLD_OFFSET_Y);
	}
</script>

{#each banners as banner (banner.cityName)}
	{@const [left, top] = footOf(banner)}
	{@const anchor = project(banner.worldX, banner.worldY)}
	<button
		type="button"
		class="city-banner {full ? CHROME_PANEL_CLASS : 'is-label'}"
		style="left: {left}px; top: {top}px;"
		onmouseenter={(e) => {
			// A held button means the map is being dragged under the cursor, so a
			// banner sliding past it isn't a hover — deck.gl suppresses its own
			// hover picking on the same test (`Deck._onPointerMove`). Without
			// this, the panel the pan just dropped comes straight back, pinned to
			// whichever city the cursor swept over.
			if (e.buttons === 0) onBannerHover(banner.tile, anchor[0], anchor[1]);
		}}
		onfocus={() => onBannerHover(banner.tile, anchor[0], anchor[1])}
		onclick={(e) => onBannerClick(banner.cityName, e.currentTarget)}
	>
		{#if full && banner.nationCrestKey}
			<SpriteIcon category="crests" value={banner.nationCrestKey} size={10} />
		{/if}
		{#if full && banner.familyCrestKey}
			<SpriteIcon category="crests" value={banner.familyCrestKey} size={10} />
		{/if}
		<span class="banner-name" style="color: {banner.nationColor};">
			{#if banner.isCapital}<span class="capital-marker">★</span
				>{/if}{banner.label}
		</span>
		{#if full && banner.citizens != null}
			<span class="citizens">{banner.citizens}</span>
		{/if}
	</button>
{/each}

<style>
	.city-banner {
		position: absolute;
		/* Anchored by its foot, so the name sits directly over the sprite. */
		transform: translate(-50%, -100%);
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 1px 4px;
		font-size: 9px;
		line-height: 1.3;
		white-space: nowrap;
		cursor: pointer;
		z-index: 5;
	}

	/* Caret under the frame, pointing into the hex the banner names. Fixed in
	   CSS pixels like the frame it hangs from, so it stays legible at every
	   zoom. The label variant drops it with the rest of the frame. */
	.city-banner:not(.is-label)::after {
		content: "";
		position: absolute;
		top: 100%;
		left: 50%;
		margin-left: -4px;
		border-left: 4px solid transparent;
		border-right: 4px solid transparent;
		border-top: 5px solid rgb(var(--color-tan) / 0.5);
	}

	/* Zoomed out: the name alone, legible against the map with no frame. */
	.city-banner.is-label {
		padding: 0;
		background: none;
		border: none;
		box-shadow: none;
		text-shadow:
			0 0 3px rgb(var(--color-black)),
			0 1px 2px rgb(var(--color-black));
	}

	.city-banner:hover:not(.is-label) {
		border-color: rgb(var(--color-orange));
	}

	.city-banner:focus-visible {
		outline: 2px solid rgb(var(--color-orange));
		outline-offset: 1px;
	}

	.banner-name {
		font-weight: 600;
	}

	.capital-marker {
		margin-right: 2px;
		font-size: 8px;
		opacity: 0.85;
	}

	.citizens {
		padding-left: 4px;
		border-left: 1px solid rgb(var(--color-border-tooltip));
		color: rgb(var(--color-tan));
		font-variant-numeric: tabular-nums;
	}
</style>
