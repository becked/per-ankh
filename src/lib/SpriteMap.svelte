<script lang="ts">
	import { onMount } from "svelte";
	import { Deck, OrthographicView } from "@deck.gl/core";
	import { BitmapLayer, PolygonLayer } from "@deck.gl/layers";
	import type { MapTile } from "$lib/types/MapTile";
	import { getCivilizationColor } from "$lib/config";

	// Hex geometry from atlas reference (pointy-top, matching sprite masks)
	const HEX_H_SPACING = 199;
	const HEX_V_SPACING = 132;
	// Elliptical hex radii derived from grid spacing so polygons tessellate
	// exactly: H_SPACING = 2 * apothem = R_X * sqrt(3); V_SPACING = 1.5 * R_Y.
	const HEX_RADIUS_X = HEX_H_SPACING / Math.sqrt(3);
	const HEX_RADIUS_Y = HEX_V_SPACING / 1.5;
	// Sprites have a dark beveled edge baked in by the game's 3D renderer.
	// We upscale each sprite and clip it to the full hex, pushing the bevel
	// past the hex boundary so it gets clipped off. Adjacent hexes still
	// tessellate exactly (no gaps). 1.0 = no upscale; higher trims more bevel.
	// Y is more aggressive because top/bottom bevels (esp. the hill cliff
	// shadow) are noticeably thicker than the side bevels.
	const SPRITE_SCALE_X = 1.13;
	const SPRITE_SCALE_Y = 1.32;

	interface AtlasManifest {
		atlas: string;
		cellWidth: number;
		cellHeight: number;
		sprites: Record<
			string,
			{ x: number; y: number; width: number; height: number }
		>;
	}

	let {
		tiles,
		height = "600px",
	}: {
		tiles: MapTile[];
		height?: string;
	} = $props();

	let deckCanvas: HTMLCanvasElement;
	let deck: Deck<OrthographicView> | null = $state(null);

	// Atlas assets (loaded once)
	let terrainAtlas: ImageBitmap | null = $state(null);
	let terrainManifest: AtlasManifest | null = $state(null);
	let heightAtlas: ImageBitmap | null = $state(null);
	let heightManifest: AtlasManifest | null = $state(null);
	let assetsLoaded = $state(false);

	// Layer visibility toggles
	let showOwnership = $state(true);

	/**
	 * Convert hex grid coordinates to pixel position.
	 * Pointy-top orientation with even-r offset, Y-flipped for screen coords.
	 */
	function hexToPixel(x: number, y: number): [number, number] {
		const px = x * HEX_H_SPACING + ((y + 1) % 2) * (HEX_H_SPACING / 2);
		// Negate Y so that game-north (high game Y) maps to low world Y.
		// With OrthographicView's default flipY=true, low world Y renders at the
		// top of the screen — matching the game's orientation. Keeping a single
		// coordinate convention here means the BitmapLayer, PolygonLayer, and
		// view target all stay aligned.
		const py = -y * HEX_V_SPACING;
		return [px, py];
	}

	/**
	 * Generate pointy-top elliptical hex polygon vertices centered at a pixel position.
	 */
	function hexPolygon(cx: number, cy: number): [number, number][] {
		const vertices: [number, number][] = [];
		for (let i = 0; i < 6; i++) {
			// Pointy-top: first vertex at 90 degrees (top)
			const angle = (Math.PI / 3) * i - Math.PI / 2;
			vertices.push([
				cx + HEX_RADIUS_X * Math.cos(angle),
				cy + HEX_RADIUS_Y * Math.sin(angle),
			]);
		}
		// Close the polygon
		vertices.push(vertices[0]);
		return vertices;
	}

	/**
	 * Parse a hex color string to [r, g, b] array.
	 */
	function hexToRgb(hex: string): [number, number, number] {
		const n = parseInt(hex.slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}

	/**
	 * Load an atlas image and its JSON manifest.
	 */
	async function loadAtlas(
		name: string,
	): Promise<{ image: ImageBitmap; manifest: AtlasManifest }> {
		const [imageResponse, manifestResponse] = await Promise.all([
			fetch(`/atlases/${name}.webp`),
			fetch(`/atlases/${name}.json`),
		]);
		const manifest: AtlasManifest = await manifestResponse.json();
		const blob = await imageResponse.blob();
		const image = await createImageBitmap(blob);
		return { image, manifest };
	}

	/**
	 * Calculate the pixel bounding box for all tiles in world coordinates.
	 */
	interface MapBounds {
		width: number;
		height: number;
		minPx: number;
		maxPx: number;
		minPy: number;
		maxPy: number;
		halfW: number;
		halfH: number;
	}

	function calculateMapBounds(mapTiles: MapTile[]): MapBounds {
		let minPx = Infinity,
			maxPx = -Infinity;
		let minPy = Infinity,
			maxPy = -Infinity;

		for (const tile of mapTiles) {
			const [px, py] = hexToPixel(tile.x, tile.y);
			minPx = Math.min(minPx, px);
			maxPx = Math.max(maxPx, px);
			minPy = Math.min(minPy, py);
			maxPy = Math.max(maxPy, py);
		}

		const spriteW = terrainManifest?.cellWidth ?? 211;
		const spriteH = terrainManifest?.cellHeight ?? 181;
		const halfW = spriteW / 2;
		const halfH = spriteH / 2;

		return {
			width: Math.ceil(maxPx - minPx + spriteW),
			height: Math.ceil(maxPy - minPy + spriteH),
			minPx,
			maxPx,
			minPy,
			maxPy,
			halfW,
			halfH,
		};
	}

	/**
	 * Draw a sprite flipped vertically. Atlas sprites are stored with Y=0 at
	 * bottom (Unity convention), so we flip during compositing so they render
	 * right-side up in the canvas image.
	 */
	function drawFlippedSprite(
		ctx: OffscreenCanvasRenderingContext2D,
		atlas: ImageBitmap,
		sx: number,
		sy: number,
		sw: number,
		sh: number,
		dx: number,
		dy: number,
	) {
		ctx.save();

		// Clip to the full hex centered on the sprite, then draw upscaled so the
		// baked bevel is pushed past the hex edge and clipped off.
		const cx = dx + sw / 2;
		const cy = dy + sh / 2;
		ctx.beginPath();
		for (let i = 0; i < 6; i++) {
			const angle = (Math.PI / 3) * i - Math.PI / 2;
			const x = cx + HEX_RADIUS_X * Math.cos(angle);
			const y = cy + HEX_RADIUS_Y * Math.sin(angle);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.closePath();
		ctx.clip();

		ctx.translate(cx, cy);
		ctx.scale(SPRITE_SCALE_X, -SPRITE_SCALE_Y);
		ctx.drawImage(atlas, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
		ctx.restore();
	}

	/**
	 * Composite terrain + height sprites into a single image.
	 * Runs once per tile data change.
	 */
	function compositeTerrainImage(mapTiles: MapTile[]): {
		bitmap: ImageBitmap;
		bounds: MapBounds;
	} | null {
		if (!terrainAtlas || !terrainManifest) return null;

		const b = calculateMapBounds(mapTiles);
		const canvas = new OffscreenCanvas(b.width, b.height);
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;

		// Draw terrain base for every tile
		for (const tile of mapTiles) {
			if (!tile.terrain) continue;
			const sprite = terrainManifest.sprites[tile.terrain];
			if (!sprite) continue;

			const [px, py] = hexToPixel(tile.x, tile.y);
			drawFlippedSprite(
				ctx,
				terrainAtlas,
				sprite.x,
				sprite.y,
				sprite.width,
				sprite.height,
				Math.round(px - b.minPx),
				Math.round(b.maxPy - py),
			);
		}

		// Draw heights on top
		if (heightAtlas && heightManifest) {
			for (const tile of mapTiles) {
				if (!tile.height) continue;
				if (
					tile.height === "HEIGHT_FLAT" ||
					tile.height === "HEIGHT_OCEAN" ||
					tile.height === "HEIGHT_COAST" ||
					tile.height === "HEIGHT_LAKE"
				) {
					continue;
				}
				const sprite = heightManifest.sprites[tile.height];
				if (!sprite) continue;

				const [px, py] = hexToPixel(tile.x, tile.y);
				drawFlippedSprite(
					ctx,
					heightAtlas,
					sprite.x,
					sprite.y,
					sprite.width,
					sprite.height,
					Math.round(px - b.minPx),
					Math.round(b.maxPy - py),
				);
			}
		}

		return { bitmap: canvas.transferToImageBitmap(), bounds: b };
	}

	/**
	 * Build deck.gl layers from tile data.
	 */
	function createLayers(mapTiles: MapTile[], showOwnershipLayer: boolean) {
		const result = compositeTerrainImage(mapTiles);
		if (!result) return [];

		const { bitmap, bounds: b } = result;

		// BitmapLayer bounds [left, bottom, right, top] in world coordinates.
		// Canvas was composited with y=0 at maxPy (world top), y=height at minPy (world bottom).
		// BitmapLayer maps: image top-left → (left, top), image bottom-right → (right, bottom).
		const left = b.minPx - b.halfW;
		const right = b.maxPx + b.halfW;
		const top = b.maxPy + b.halfH;
		const bottom = b.minPy - b.halfH;

		const layers = [];

		layers.push(
			new BitmapLayer({
				id: "terrain-layer",
				image: bitmap,
				bounds: [left, bottom, right, top],
			}),
		);

		// Ownership overlay — translucent hex fills for owned tiles
		const ownedTiles = showOwnershipLayer ? mapTiles.filter((t) => t.owner_nation) : [];
		if (ownedTiles.length > 0) {
			interface OwnershipTile {
				polygon: [number, number][];
				color: [number, number, number, number];
			}

			const ownershipData: OwnershipTile[] = ownedTiles.map((tile) => {
				const [px, py] = hexToPixel(tile.x, tile.y);
				const nationKey = tile.owner_nation!.replace("NATION_", "");
				const colorHex = getCivilizationColor(nationKey) ?? "#888888";
				const rgb = hexToRgb(colorHex);
				return {
					polygon: hexPolygon(px, py),
					color: [rgb[0], rgb[1], rgb[2], 80] as [
						number,
						number,
						number,
						number,
					],
				};
			});

			layers.push(
				new PolygonLayer<OwnershipTile>({
					id: "ownership-layer",
					data: ownershipData,
					getPolygon: (d: OwnershipTile) => d.polygon,
					getFillColor: (d: OwnershipTile) => d.color,
					stroked: false,
					filled: true,
					pickable: false,
				}),
			);
		}

		return layers;
	}

	/**
	 * Calculate initial view state to fit the map in the canvas.
	 */
	function calculateViewState(canvas?: HTMLCanvasElement) {
		const target = canvas ?? deckCanvas;
		if (!target || tiles.length === 0) {
			return { target: [0, 0, 0] as [number, number, number], zoom: -3 };
		}

		// Find center of all hex positions
		let sumX = 0,
			sumY = 0;
		for (const tile of tiles) {
			const [px, py] = hexToPixel(tile.x, tile.y);
			sumX += px;
			sumY += py;
		}
		const centerX = sumX / tiles.length;
		const centerY = sumY / tiles.length;

		// Find the extent of the map
		let minPx = Infinity,
			maxPx = -Infinity;
		let minPy = Infinity,
			maxPy = -Infinity;
		for (const tile of tiles) {
			const [px, py] = hexToPixel(tile.x, tile.y);
			minPx = Math.min(minPx, px);
			maxPx = Math.max(maxPx, px);
			minPy = Math.min(minPy, py);
			maxPy = Math.max(maxPy, py);
		}
		const mapWidth = maxPx - minPx + 211;
		const mapHeight = maxPy - minPy + 181;

		// Calculate zoom to fit map in canvas
		const canvasWidth = target.clientWidth;
		const canvasHeight = target.clientHeight;
		const zoomX = Math.log2(canvasWidth / mapWidth);
		const zoomY = Math.log2(canvasHeight / mapHeight);
		const zoom = Math.min(zoomX, zoomY);

		return { target: [centerX, centerY, 0] as [number, number, number], zoom };
	}

	function initDeck() {
		if (!deckCanvas || !assetsLoaded) return;

		const width = deckCanvas.clientWidth;
		const canvasHeight = deckCanvas.clientHeight;
		if (width === 0 || canvasHeight === 0) return;

		// Clean up existing deck
		if (deck) {
			deck.finalize();
			deck = null;
		}

		deckCanvas.width = width * window.devicePixelRatio;
		deckCanvas.height = canvasHeight * window.devicePixelRatio;

		const viewState = calculateViewState();

		deck = new Deck({
			canvas: deckCanvas,
			width,
			height: canvasHeight,
			useDevicePixels: true,
			views: new OrthographicView({ id: "ortho" }),
			initialViewState: {
				...viewState,
				minZoom: -6,
				maxZoom: 4,
			},
			controller: true,
			layers: createLayers(tiles, showOwnership),
		});
	}

	// Re-render layers when tiles or visibility toggles change
	$effect(() => {
		const currentTiles = tiles;
		const currentShowOwnership = showOwnership;
		if (deck && assetsLoaded && currentTiles.length > 0) {
			deck.setProps({ layers: createLayers(currentTiles, currentShowOwnership) });
		}
	});

	onMount(() => {
		// Load atlas assets
		Promise.all([loadAtlas("terrain"), loadAtlas("height")])
			.then(([terrain, heightData]) => {
				terrainAtlas = terrain.image;
				terrainManifest = terrain.manifest;
				heightAtlas = heightData.image;
				heightManifest = heightData.manifest;
				assetsLoaded = true;
			})
			.catch((err) => {
				console.error("Failed to load map atlases:", err);
			});

		// Poll for canvas visibility (same pattern as HexMap)
		const visibilityCheck = setInterval(() => {
			if (deckCanvas && deckCanvas.clientWidth > 0 && assetsLoaded) {
				clearInterval(visibilityCheck);
				initDeck();
			}
		}, 100);

		return () => {
			clearInterval(visibilityCheck);
			if (deck) {
				deck.finalize();
				deck = null;
			}
		};
	});
</script>

<div class="flex flex-col gap-4">
	<!-- Layer toggles -->
	<div class="flex items-center gap-3 text-sm">
		<label class="marker-toggle">
			<input type="checkbox" bind:checked={showOwnership} />
			<span class="marker-label">Ownership</span>
		</label>
	</div>

	<div class="sprite-map-container" style="height: {height};">
		<canvas bind:this={deckCanvas} class="sprite-map-canvas"></canvas>
	</div>
</div>

<style>
	.sprite-map-container {
		position: relative;
		width: 100%;
		overflow: hidden;
		border-radius: 0.5rem;
		background-color: #1a1510;
	}

	.sprite-map-canvas {
		width: 100%;
		height: 100%;
		display: block;
	}

	.marker-toggle {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		cursor: pointer;
	}

	.marker-toggle input[type="checkbox"] {
		appearance: none;
		width: 14px;
		height: 14px;
		border: 2px solid var(--color-tan);
		border-radius: 3px;
		background: transparent;
		cursor: pointer;
		position: relative;
		transition:
			background 0.15s ease,
			border-color 0.15s ease;
	}

	.marker-toggle input[type="checkbox"]:checked {
		background: var(--color-tan);
	}

	.marker-toggle input[type="checkbox"]:checked::after {
		content: "";
		position: absolute;
		left: 3px;
		top: 0px;
		width: 4px;
		height: 8px;
		border: solid #1a1a1a;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}

	.marker-toggle:hover input[type="checkbox"] {
		border-color: white;
	}

	.marker-label {
		color: var(--color-tan);
		user-select: none;
	}

	.marker-toggle:hover .marker-label {
		color: white;
	}
</style>
