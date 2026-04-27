<script lang="ts">
	import { onMount } from "svelte";
	import { Deck, OrthographicView } from "@deck.gl/core";
	import { BitmapLayer, PathLayer, PolygonLayer } from "@deck.gl/layers";
	import type { MapTile } from "$lib/types/MapTile";
	import { getCivilizationColor } from "$lib/config";

	// Hex geometry from atlas reference (pointy-top, matching sprite masks).
	// Atlases are pre-baked by scripts/bake-atlases.ts: the bevel masking
	// (hex-clip + upscale + Y-flip) happens at build time, so the runtime
	// just blits each cell directly. The dimensions also drive overlay
	// polygons (religion fill) and edge segments (political borders).
	const HEX_H_SPACING = 199;
	const HEX_V_SPACING = 132;
	// Elliptical hex radii derived from grid spacing so polygons tessellate
	// exactly: H_SPACING = 2 * apothem = R_X * sqrt(3); V_SPACING = 1.5 * R_Y.
	const HEX_RADIUS_X = HEX_H_SPACING / Math.sqrt(3);
	const HEX_RADIUS_Y = HEX_V_SPACING / 1.5;

	// Maps ≥82 wide produce composite bitmaps that exceed WebGL's
	// GL_MAX_TEXTURE_SIZE (typically 16384). compositeTerrainImage splits the
	// composite into N horizontal chunks where each chunk's offscreen canvas
	// stays under SAFE_CHUNK_WIDTH. Chunk count = ceil(totalWidth / SAFE_CHUNK_WIDTH).
	// 16000 leaves margin under 16384 for cell rounding and the half-shift on
	// odd rows. See docs/map-beta-future-work.md "BitmapLayer Texture-Size Ceiling".
	const SAFE_CHUNK_WIDTH = 16000;

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
	let showPolitical = $state(true);
	let showReligion = $state(false);

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

	// Pointy-top even-r neighbors. hexToPixel shifts even rows right by half-spacing,
	// so even/odd rows have different diagonal neighbor offsets. Returned in the
	// order [NE, E, SE, SW, W, NW] to match hexPolygon's edge index — edge i
	// connects vertex i to vertex i+1 and faces neighbor i. Note: hexToPixel
	// negates Y, so game y+1 renders as "north" (top of screen).
	function hexNeighbors(x: number, y: number): [number, number][] {
		if (y % 2 === 0) {
			return [
				[x + 1, y + 1], // NE
				[x + 1, y], // E
				[x + 1, y - 1], // SE
				[x, y - 1], // SW
				[x - 1, y], // W
				[x, y + 1], // NW
			];
		}
		return [
			[x, y + 1], // NE
			[x + 1, y], // E
			[x, y - 1], // SE
			[x - 1, y - 1], // SW
			[x - 1, y], // W
			[x - 1, y + 1], // NW
		];
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
	 * Blit a sprite cell from the baked atlas. Hex-clipping, upscale, and
	 * Y-flip are pre-applied by scripts/bake-atlases.ts.
	 */
	function drawSprite(
		ctx: OffscreenCanvasRenderingContext2D,
		atlas: ImageBitmap,
		sx: number,
		sy: number,
		sw: number,
		sh: number,
		dx: number,
		dy: number,
	) {
		ctx.drawImage(atlas, sx, sy, sw, sh, dx, dy, sw, sh);
	}

	/**
	 * Composite terrain + height sprites into one or more bitmaps.
	 * Runs once per tile data change.
	 *
	 * Returns an array of chunks because the full-map composite can exceed
	 * WebGL's GL_MAX_TEXTURE_SIZE on maps ≥82 wide. Each chunk owns a
	 * contiguous range of columns; tiles are painted in exactly one chunk
	 * (the one containing their column). Adjacent chunks' BitmapLayer bounds
	 * may overlap by ~one sprite width in world coords, but each chunk only
	 * holds its own sprites, so there's no double-painting.
	 */
	function compositeTerrainImage(mapTiles: MapTile[]): Array<{
		bitmap: ImageBitmap;
		bounds: MapBounds;
	}> | null {
		if (!terrainAtlas || !terrainManifest) return null;

		const overall = calculateMapBounds(mapTiles);
		const chunkCount = Math.max(
			1,
			Math.ceil(overall.width / SAFE_CHUNK_WIDTH),
		);

		// Column-based chunking: tiles assigned by floor(x / colsPerChunk).
		let mapColCount = 0;
		for (const t of mapTiles) {
			if (t.x + 1 > mapColCount) mapColCount = t.x + 1;
		}
		const colsPerChunk = Math.ceil(mapColCount / chunkCount);

		const chunks: Array<{ bitmap: ImageBitmap; bounds: MapBounds }> = [];

		for (let i = 0; i < chunkCount; i++) {
			const colStart = i * colsPerChunk;
			const colEnd = (i + 1) * colsPerChunk;
			const chunkTiles = mapTiles.filter(
				(t) => t.x >= colStart && t.x < colEnd,
			);
			if (chunkTiles.length === 0) continue;

			const b = calculateMapBounds(chunkTiles);
			const canvas = new OffscreenCanvas(b.width, b.height);
			const ctx = canvas.getContext("2d");
			if (!ctx) continue;

			// Terrain
			for (const tile of chunkTiles) {
				if (!tile.terrain) continue;
				const sprite = terrainManifest.sprites[tile.terrain];
				if (!sprite) continue;

				const [px, py] = hexToPixel(tile.x, tile.y);
				drawSprite(
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

			// Heights
			if (heightAtlas && heightManifest) {
				for (const tile of chunkTiles) {
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
					drawSprite(
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

			chunks.push({ bitmap: canvas.transferToImageBitmap(), bounds: b });
		}

		return chunks.length > 0 ? chunks : null;
	}

	interface NationBorder {
		path: [number, number][];
		color: [number, number, number, number];
		width: number;
	}

	interface PoliticalData {
		borders: NationBorder[];
		subBorders: NationBorder[];
	}

	interface ReligionFill {
		polygon: [number, number][];
		color: [number, number, number, number];
	}

	// Nation borders are inset slightly into the territory so adjacent nations'
	// borders are clearly distinct, but kept close to the actual edge to match the
	// in-game look. Per-vertex inset uses the centroid of same-nation tiles meeting
	// at that vertex, so adjacent same-nation tiles' segments share endpoints and
	// chain into closed paths around each territory island. The chained paths are
	// then smoothed via Chaikin corner-cutting so the rendered borders read as
	// continuous curves rather than crystalline hex-vertex polygons.
	// Sub-borders within a nation sit on the actual hex edge, deduped per shared
	// edge, in the same nation hue at reduced alpha so they read as subordinate.
	const NATION_BORDER_INSET = 0.1;
	const NATION_BORDER_WIDTH = 3;
	const NATION_BORDER_SMOOTH_ITERATIONS = 3;
	const SUB_BORDER_ALPHA = 200;
	const SUB_BORDER_WIDTH = 1.5;

	// Stable key for a hex vertex pixel coord. Hex tessellation is exact, so the
	// same physical vertex computed from neighboring tiles produces identical (or
	// FP-equivalent) coordinates; rounding to 2 decimals collapses any drift.
	function vertexKey(v: [number, number]): string {
		return `${Math.round(v[0] * 100)},${Math.round(v[1] * 100)}`;
	}

	// Chaikin's corner-cutting algorithm. Each iteration replaces every vertex
	// with two new points at 1/4 and 3/4 along the adjacent edges. Converges to
	// a smooth quadratic B-spline curve and never overshoots, which avoids the
	// bulging that uniform Catmull-Rom can produce at sharp 60° peninsulas.
	// Operates on closed paths (no repeated start vertex).
	function chaikinSmoothClosed(
		pts: [number, number][],
		iterations: number,
	): [number, number][] {
		let current = pts;
		for (let iter = 0; iter < iterations; iter++) {
			const m = current.length;
			const next: [number, number][] = new Array(m * 2);
			for (let i = 0; i < m; i++) {
				const p1 = current[i];
				const p2 = current[(i + 1) % m];
				next[i * 2] = [
					0.75 * p1[0] + 0.25 * p2[0],
					0.75 * p1[1] + 0.25 * p2[1],
				];
				next[i * 2 + 1] = [
					0.25 * p1[0] + 0.75 * p2[0],
					0.25 * p1[1] + 0.75 * p2[1],
				];
			}
			current = next;
		}
		return current;
	}

	// Open-path variant: preserves first and last vertices (used for sub-border
	// chains that terminate at city-junction vertices or nation-border transitions).
	function chaikinSmoothOpen(
		pts: [number, number][],
		iterations: number,
	): [number, number][] {
		let current = pts;
		for (let iter = 0; iter < iterations; iter++) {
			const m = current.length;
			if (m < 2) break;
			const next: [number, number][] = [current[0]];
			for (let i = 0; i < m - 1; i++) {
				const p1 = current[i];
				const p2 = current[i + 1];
				next.push([0.75 * p1[0] + 0.25 * p2[0], 0.75 * p1[1] + 0.25 * p2[1]]);
				next.push([0.25 * p1[0] + 0.75 * p2[0], 0.25 * p1[1] + 0.75 * p2[1]]);
			}
			next.push(current[m - 1]);
			current = next;
		}
		return current;
	}

	function computePoliticalData(mapTiles: MapTile[]): PoliticalData {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const tileMap = new Map<string, MapTile>();
		for (const t of mapTiles) tileMap.set(`${t.x},${t.y}`, t);

		// Per-vertex list of meeting tiles, so adjacent same-nation tiles converge
		// on the same inset position at shared corners. Adjacent tiles' boundary
		// edges then share endpoints, which lets us chain them into closed paths.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const vertexMap = new Map<string, MapTile[]>();
		for (const tile of mapTiles) {
			const [cx, cy] = hexToPixel(tile.x, tile.y);
			const verts = hexPolygon(cx, cy);
			for (let i = 0; i < 6; i++) {
				const k = vertexKey(verts[i]);
				const list = vertexMap.get(k);
				if (list) list.push(tile);
				else vertexMap.set(k, [tile]);
			}
		}

		interface BoundaryEdge {
			source: [number, number];
			target: [number, number];
			sourceKey: string;
			targetKey: string;
		}

		interface SubBorderEdge {
			a: [number, number];
			b: [number, number];
			aKey: string;
			bKey: string;
		}

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const edgesByNation = new Map<string, BoundaryEdge[]>();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const subEdgesByNation = new Map<string, SubBorderEdge[]>();

		for (const tile of mapTiles) {
			if (!tile.owner_nation) continue;
			const nationKey = tile.owner_nation;
			const colorHex = getCivilizationColor(nationKey.replace("NATION_", ""));
			if (!colorHex) continue;

			const [cx, cy] = hexToPixel(tile.x, tile.y);
			const verts = hexPolygon(cx, cy);
			const neighbors = hexNeighbors(tile.x, tile.y);

			// Inset position for each of this tile's 6 vertices: toward the centroid
			// of same-nation tiles meeting at that vertex. Adjacent same-nation tiles
			// compute identical centroids → identical inset positions at shared
			// corners → adjacent boundary edges chain cleanly.
			const insetPos: [number, number][] = [];
			for (let i = 0; i < 6; i++) {
				const v = verts[i];
				const meetingTiles = vertexMap.get(vertexKey(v)) ?? [tile];
				let sumX = 0;
				let sumY = 0;
				let count = 0;
				for (const t of meetingTiles) {
					if (t.owner_nation !== nationKey) continue;
					const [tcx, tcy] = hexToPixel(t.x, t.y);
					sumX += tcx;
					sumY += tcy;
					count++;
				}
				if (count === 0) {
					sumX = cx;
					sumY = cy;
					count = 1;
				}
				const cenX = sumX / count;
				const cenY = sumY / count;
				insetPos.push([
					v[0] + (cenX - v[0]) * NATION_BORDER_INSET,
					v[1] + (cenY - v[1]) * NATION_BORDER_INSET,
				]);
			}

			for (let i = 0; i < 6; i++) {
				const [nx, ny] = neighbors[i];
				const neighbor = tileMap.get(`${nx},${ny}`);
				const sameNation = neighbor && neighbor.owner_nation === nationKey;

				if (!sameNation) {
					const src = insetPos[i];
					const dst = insetPos[(i + 1) % 6];
					const edge: BoundaryEdge = {
						source: src,
						target: dst,
						sourceKey: vertexKey(src),
						targetKey: vertexKey(dst),
					};
					const list = edgesByNation.get(nationKey);
					if (list) list.push(edge);
					else edgesByNation.set(nationKey, [edge]);
				} else if (
					tile.owner_city &&
					neighbor.owner_city &&
					neighbor.owner_city !== tile.owner_city &&
					(tile.x < nx || (tile.x === nx && tile.y < ny))
				) {
					// Sub-border: collect as undirected edge for per-nation chaining.
					// Stays on the actual hex edge (no inset) so it sits between the
					// two cities visually, like the in-game style.
					const a = verts[i];
					const b = verts[i + 1];
					const edge: SubBorderEdge = {
						a,
						b,
						aKey: vertexKey(a),
						bKey: vertexKey(b),
					};
					const list = subEdgesByNation.get(nationKey);
					if (list) list.push(edge);
					else subEdgesByNation.set(nationKey, [edge]);
				}
			}
		}

		// Chain each nation's boundary edges into closed paths (one per territory
		// island). Walks the directed-edge graph; each boundary vertex has exactly
		// one in-edge and one out-edge (per island), so the chain is unambiguous.
		const borders: NationBorder[] = [];
		for (const [nationKey, edges] of edgesByNation) {
			const colorHex = getCivilizationColor(nationKey.replace("NATION_", ""));
			if (!colorHex) continue;
			const rgb = hexToRgb(colorHex);

			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
			const adjacency = new Map<string, BoundaryEdge[]>();
			for (const e of edges) {
				const list = adjacency.get(e.sourceKey);
				if (list) list.push(e);
				else adjacency.set(e.sourceKey, [e]);
			}

			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Set used locally in function, not as reactive state
			const visited = new Set<BoundaryEdge>();
			for (const startEdge of edges) {
				if (visited.has(startEdge)) continue;
				// Build the chain as unique vertices (don't repeat start at end yet —
				// Chaikin operates on a closed-path point list with no duplicate).
				const chain: [number, number][] = [startEdge.source];
				let current: BoundaryEdge | undefined = startEdge;
				while (current && !visited.has(current)) {
					visited.add(current);
					const candidates = adjacency.get(current.targetKey);
					const nextEdge = candidates?.find((e) => !visited.has(e));
					if (nextEdge) chain.push(current.target);
					current = nextEdge;
				}
				const smoothed =
					chain.length >= 4
						? chaikinSmoothClosed(chain, NATION_BORDER_SMOOTH_ITERATIONS)
						: chain;
				// PathLayer treats the path as a polyline; repeat the first point at
				// the end so it renders the closing segment.
				const path = [...smoothed, smoothed[0]];
				borders.push({
					path,
					color: [rgb[0], rgb[1], rgb[2], 255],
					width: NATION_BORDER_WIDTH,
				});
			}
		}

		// Chain sub-border edges per nation. Sub-borders are undirected and can
		// branch at multi-city junctions (3+ cities meeting at one vertex), so the
		// walk from a starting edge proceeds in BOTH directions and stops as soon
		// as a vertex has anything other than exactly one unvisited neighbor —
		// either a branch point or a terminal.
		const subBorders: NationBorder[] = [];
		for (const [nationKey, subEdges] of subEdgesByNation) {
			const colorHex = getCivilizationColor(nationKey.replace("NATION_", ""));
			if (!colorHex) continue;
			const rgb = hexToRgb(colorHex);
			const color: [number, number, number, number] = [
				rgb[0],
				rgb[1],
				rgb[2],
				SUB_BORDER_ALPHA,
			];

			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
			const adj = new Map<string, SubBorderEdge[]>();
			for (const e of subEdges) {
				const aList = adj.get(e.aKey);
				if (aList) aList.push(e);
				else adj.set(e.aKey, [e]);
				const bList = adj.get(e.bKey);
				if (bList) bList.push(e);
				else adj.set(e.bKey, [e]);
			}

			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Set used locally in function, not as reactive state
			const visited = new Set<SubBorderEdge>();
			for (const start of subEdges) {
				if (visited.has(start)) continue;
				visited.add(start);

				const walk = (
					fromKey: string,
				): { edges: SubBorderEdge[]; endKey: string } => {
					const out: SubBorderEdge[] = [];
					let cur = fromKey;
					for (;;) {
						const candidates = adj.get(cur)?.filter((e) => !visited.has(e));
						if (!candidates || candidates.length !== 1) break;
						const next = candidates[0];
						visited.add(next);
						out.push(next);
						cur = next.aKey === cur ? next.bKey : next.aKey;
					}
					return { edges: out, endKey: cur };
				};

				const forward = walk(start.bKey);
				const backward = walk(start.aKey);

				// Build the path vertex list: walk backward edges in reverse, then
				// the start edge, then the forward edges. Track the previous vertex
				// key to know which endpoint to push next.
				const path: [number, number][] = [];
				let prevKey: string;
				if (backward.edges.length > 0) {
					// Start from the outer end of the backward walk. The outermost
					// backward edge has endKey as one of its endpoints — push the
					// matching pixel position.
					const outermost = backward.edges[backward.edges.length - 1];
					path.push(
						outermost.aKey === backward.endKey ? outermost.a : outermost.b,
					);
					prevKey = backward.endKey;
					for (let k = backward.edges.length - 1; k >= 0; k--) {
						const e = backward.edges[k];
						if (e.aKey === prevKey) {
							path.push(e.b);
							prevKey = e.bKey;
						} else {
							path.push(e.a);
							prevKey = e.aKey;
						}
					}
					if (start.aKey === prevKey) {
						path.push(start.b);
						prevKey = start.bKey;
					} else {
						path.push(start.a);
						prevKey = start.aKey;
					}
				} else {
					path.push(start.a);
					path.push(start.b);
					prevKey = start.bKey;
				}
				for (const e of forward.edges) {
					if (e.aKey === prevKey) {
						path.push(e.b);
						prevKey = e.bKey;
					} else {
						path.push(e.a);
						prevKey = e.aKey;
					}
				}

				const closed =
					path.length >= 3 &&
					Math.abs(path[0][0] - path[path.length - 1][0]) < 0.01 &&
					Math.abs(path[0][1] - path[path.length - 1][1]) < 0.01;

				let smoothed: [number, number][];
				if (closed) {
					const unique = path.slice(0, -1);
					smoothed =
						unique.length >= 4
							? chaikinSmoothClosed(unique, NATION_BORDER_SMOOTH_ITERATIONS)
							: unique;
					smoothed.push(smoothed[0]);
				} else if (path.length >= 3) {
					smoothed = chaikinSmoothOpen(path, NATION_BORDER_SMOOTH_ITERATIONS);
				} else {
					smoothed = path;
				}

				subBorders.push({ path: smoothed, color, width: SUB_BORDER_WIDTH });
			}
		}

		return { borders, subBorders };
	}

	function computeReligionFills(mapTiles: MapTile[]): ReligionFill[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const tileMap = new Map<string, MapTile>();
		for (const t of mapTiles) tileMap.set(`${t.x},${t.y}`, t);

		const fills: ReligionFill[] = [];
		for (const tile of mapTiles) {
			const founder = tile.religions[0]?.founder_nation;
			if (!founder) continue;
			const colorHex = getCivilizationColor(founder.replace("NATION_", ""));
			if (!colorHex) continue;
			const rgb = hexToRgb(colorHex);
			const [cx, cy] = hexToPixel(tile.x, tile.y);
			const verts = hexPolygon(cx, cy);

			// Match the political layer's per-vertex centroid inset so the fill
			// stops at the nation border instead of bleeding past it. At each
			// vertex i of the hex, the 3 meeting tiles are T plus the two
			// corner-adjacent neighbors (across edge i-1 and edge i). Centroid of
			// same-nation tiles at the vertex; interior nation vertices have all
			// 3 same-nation, centroid lands on the vertex, no inset → fill still
			// extends to the hex edge along city sub-borders.
			let polygon: [number, number][];
			if (!tile.owner_nation) {
				polygon = hexPolygon(cx, cy);
			} else {
				const neighbors = hexNeighbors(tile.x, tile.y);
				polygon = [];
				for (let i = 0; i < 6; i++) {
					const [n1x, n1y] = neighbors[(i + 5) % 6];
					const [n2x, n2y] = neighbors[i];
					const adj1 = tileMap.get(`${n1x},${n1y}`);
					const adj2 = tileMap.get(`${n2x},${n2y}`);

					let sumX = cx;
					let sumY = cy;
					let count = 1;
					if (adj1?.owner_nation === tile.owner_nation) {
						const [tx, ty] = hexToPixel(adj1.x, adj1.y);
						sumX += tx;
						sumY += ty;
						count++;
					}
					if (adj2?.owner_nation === tile.owner_nation) {
						const [tx, ty] = hexToPixel(adj2.x, adj2.y);
						sumX += tx;
						sumY += ty;
						count++;
					}
					const cenX = sumX / count;
					const cenY = sumY / count;
					const v = verts[i];
					polygon.push([
						v[0] + (cenX - v[0]) * NATION_BORDER_INSET,
						v[1] + (cenY - v[1]) * NATION_BORDER_INSET,
					]);
				}
			}

			fills.push({
				polygon,
				color: [rgb[0], rgb[1], rgb[2], 80],
			});
		}
		return fills;
	}

	// Memoized derivatives — recomputed only when `tiles` (or atlas state) change,
	// not on layer-toggle flips.
	const terrainComposite = $derived.by(() => {
		if (!assetsLoaded || tiles.length === 0) return null;
		return compositeTerrainImage(tiles);
	});
	const politicalData = $derived.by<PoliticalData>(() => {
		if (tiles.length === 0) return { borders: [], subBorders: [] };
		return computePoliticalData(tiles);
	});
	const religionFills = $derived.by<ReligionFill[]>(() => {
		if (tiles.length === 0) return [];
		return computeReligionFills(tiles);
	});

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
			// Layers populated by the $effect below as soon as derivatives resolve.
			layers: [],
		});
	}

	// Assemble layers from memoized derivatives. Toggling showPolitical / showReligion
	// only flips the `visible` prop — deck.gl reuses GPU buffers because each layer's
	// `data` reference is unchanged. Buffers rebuild only when `tiles` change, which
	// invalidates the derivatives.
	$effect(() => {
		if (!deck) return;
		const composite = terrainComposite;
		const political = politicalData;
		const fills = religionFills;
		const pol = showPolitical;
		const rel = showReligion;
		if (!composite || composite.length === 0) return;

		const terrainLayers = composite.map((chunk, i) => {
			const b = chunk.bounds;
			return new BitmapLayer({
				id: `terrain-layer-${i}`,
				image: chunk.bitmap,
				bounds: [
					b.minPx - b.halfW,
					b.minPy - b.halfH,
					b.maxPx + b.halfW,
					b.maxPy + b.halfH,
				],
			});
		});

		deck.setProps({
			layers: [
				...terrainLayers,
				new PolygonLayer<ReligionFill>({
					id: "religion-layer",
					data: fills,
					getPolygon: (d: ReligionFill) => d.polygon,
					getFillColor: (d: ReligionFill) => d.color,
					stroked: false,
					filled: true,
					pickable: false,
					visible: rel,
				}),
				new PathLayer<NationBorder>({
					id: "political-sub-borders",
					data: political.subBorders,
					getPath: (d: NationBorder) => d.path,
					getColor: (d: NationBorder) => d.color,
					getWidth: (d: NationBorder) => d.width,
					widthUnits: "pixels",
					widthMinPixels: 1,
					jointRounded: true,
					capRounded: true,
					pickable: false,
					visible: pol,
				}),
				new PathLayer<NationBorder>({
					id: "political-borders",
					data: political.borders,
					getPath: (d: NationBorder) => d.path,
					getColor: (d: NationBorder) => d.color,
					getWidth: (d: NationBorder) => d.width,
					widthUnits: "pixels",
					widthMinPixels: 1,
					jointRounded: true,
					capRounded: true,
					pickable: false,
					visible: pol,
				}),
			],
		});
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
			<input type="checkbox" bind:checked={showPolitical} />
			<span class="marker-label">Political</span>
		</label>
		<label class="marker-toggle">
			<input type="checkbox" bind:checked={showReligion} />
			<span class="marker-label">Religion</span>
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
