<script lang="ts">
	import { onMount } from "svelte";
	import { Deck, OrthographicView } from "@deck.gl/core";
	import { BitmapLayer, PolygonLayer } from "@deck.gl/layers";
	import type { MapTile } from "$lib/types/MapTile";
	import { getCivilizationColor } from "$lib/config";

	// Hex geometry from atlas reference (pointy-top, matching sprite masks)
	const HEX_H_SPACING = 199;
	const HEX_V_SPACING = 132;
	// Elliptical hex radii matching the sprite mask (pointy-top)
	const HEX_RADIUS_X = 120;
	const HEX_RADIUS_Y = 88;

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

	/**
	 * Convert hex grid coordinates to pixel position.
	 * Pointy-top orientation with even-r offset, Y-flipped for screen coords.
	 */
	function hexToPixel(x: number, y: number): [number, number] {
		const px = x * HEX_H_SPACING + ((y + 1) % 2) * (HEX_H_SPACING / 2);
		// No Y negation: game Y increases northward, deck.gl Y increases upward.
		// This keeps sprites right-side up (shadows/lighting match game orientation).
		const py = y * HEX_V_SPACING;
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

		// Atlas sprites are stored with Y=0 at bottom (Unity convention).
		// Flip each sprite vertically during compositing using canvas transforms.
		function drawFlipped(
			atlas: ImageBitmap,
			sx: number,
			sy: number,
			sw: number,
			sh: number,
			dx: number,
			dy: number,
		) {
			ctx.save();
			ctx.translate(dx, dy + sh);
			ctx.scale(1, -1);
			ctx.drawImage(atlas, sx, sy, sw, sh, 0, 0, sw, sh);
			ctx.restore();
		}

		// Draw terrain base for every tile
		for (const tile of mapTiles) {
			if (!tile.terrain) continue;
			const sprite = terrainManifest.sprites[tile.terrain];
			if (!sprite) continue;

			const [px, py] = hexToPixel(tile.x, tile.y);
			drawFlipped(
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
				drawFlipped(
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
	function createLayers(mapTiles: MapTile[]) {
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
		const ownedTiles = mapTiles.filter((t) => t.owner_nation);
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
			layers: createLayers(tiles),
		});
	}

	// Re-render layers when tiles change
	$effect(() => {
		const currentTiles = tiles;
		if (deck && assetsLoaded && currentTiles.length > 0) {
			deck.setProps({ layers: createLayers(currentTiles) });
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

<div class="sprite-map-container" style="height: {height};">
	<canvas bind:this={deckCanvas} class="sprite-map-canvas"></canvas>
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
</style>
