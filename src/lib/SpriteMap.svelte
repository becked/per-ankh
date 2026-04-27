<script lang="ts">
	import { onMount } from "svelte";
	import { Deck, OrthographicView } from "@deck.gl/core";
	import { IconLayer, PathLayer, PolygonLayer } from "@deck.gl/layers";
	import type { MapTile } from "$lib/types/MapTile";
	import { getCivilizationColor } from "$lib/config";

	// Hex geometry from atlas reference (pointy-top, matching sprite masks).
	// Atlases are pre-baked by scripts/bake-atlases.ts: hex-clip + bevel-trim
	// upscale happen at build time. The runtime feeds the baked atlas straight
	// to deck.gl IconLayer, which samples it as-is. The dimensions also drive
	// overlay polygons (religion fill) and edge segments (political borders).
	const HEX_H_SPACING = 199;
	const HEX_V_SPACING = 132;
	// Elliptical hex radii derived from grid spacing so polygons tessellate
	// exactly: H_SPACING = 2 * apothem = R_X * sqrt(3); V_SPACING = 1.5 * R_Y.
	const HEX_RADIUS_X = HEX_H_SPACING / Math.sqrt(3);
	const HEX_RADIUS_Y = HEX_V_SPACING / 1.5;

	const TERRAIN_ATLAS_URL = "/atlases/terrain.webp";
	const HEIGHT_ATLAS_URL = "/atlases/height.webp";
	const IMPROVEMENT_ATLAS_URL = "/atlases/improvements-test.webp";

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

	// Atlas manifests (loaded once). The matching .webp URLs are passed to
	// IconLayer's iconAtlas prop, which fetches and decodes the texture itself.
	let terrainManifest: AtlasManifest | null = $state(null);
	let heightManifest: AtlasManifest | null = $state(null);
	let improvementManifest: AtlasManifest | null = $state(null);
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
		// coordinate convention here means IconLayer, PolygonLayer, and view
		// target all stay aligned.
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

	async function loadManifest(name: string): Promise<AtlasManifest> {
		const response = await fetch(`/atlases/${name}.json`);
		return (await response.json()) as AtlasManifest;
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

	// Memoized derivatives — recomputed only when `tiles` change, not on
	// layer-toggle flips.
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

	// Assemble layers. Toggling showPolitical / showReligion only flips the
	// `visible` prop — deck.gl reuses GPU buffers because each layer's `data`
	// reference is unchanged. Buffers rebuild only when `tiles` (and thus the
	// political/religion derivatives + the inline-filtered IconLayer data) change.
	$effect(() => {
		if (!deck) return;
		if (!assetsLoaded) return;
		const tm = terrainManifest;
		const hm = heightManifest;
		const im = improvementManifest;
		if (!tm || !hm || !im) return;
		const political = politicalData;
		const fills = religionFills;
		const pol = showPolitical;
		const rel = showReligion;

		deck.setProps({
			layers: [
				new IconLayer<MapTile>({
					id: "terrain-icons",
					data: tiles.filter(
						(t) => t.terrain != null && tm.sprites[t.terrain] != null,
					),
					iconAtlas: TERRAIN_ATLAS_URL,
					iconMapping: tm.sprites,
					getIcon: (d: MapTile) => d.terrain as string,
					getPosition: (d: MapTile) => hexToPixel(d.x, d.y),
					getSize: () => tm.cellWidth,
					sizeUnits: "common",
					sizeBasis: "width",
					pickable: false,
				}),
				new IconLayer<MapTile>({
					id: "height-icons",
					data: tiles.filter((t) => {
						if (t.height == null) return false;
						if (
							t.height === "HEIGHT_FLAT" ||
							t.height === "HEIGHT_OCEAN" ||
							t.height === "HEIGHT_COAST" ||
							t.height === "HEIGHT_LAKE"
						)
							return false;
						return hm.sprites[t.height] != null;
					}),
					iconAtlas: HEIGHT_ATLAS_URL,
					iconMapping: hm.sprites,
					getIcon: (d: MapTile) => d.height as string,
					getPosition: (d: MapTile) => hexToPixel(d.x, d.y),
					getSize: () => hm.cellWidth,
					sizeUnits: "common",
					sizeBasis: "width",
					pickable: false,
				}),
				new IconLayer<MapTile>({
					id: "improvement-icons",
					data: tiles.filter(
						(t) =>
							t.improvement != null && im.sprites[t.improvement] != null,
					),
					iconAtlas: IMPROVEMENT_ATLAS_URL,
					iconMapping: im.sprites,
					getIcon: (d: MapTile) => d.improvement as string,
					getPosition: (d: MapTile) => hexToPixel(d.x, d.y),
					getSize: () => im.cellWidth,
					sizeUnits: "common",
					sizeBasis: "width",
					pickable: false,
				}),
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
		Promise.all([
			loadManifest("terrain"),
			loadManifest("height"),
			loadManifest("improvements-test"),
		])
			.then(([terrain, height, improvements]) => {
				terrainManifest = terrain;
				heightManifest = height;
				improvementManifest = improvements;
				assetsLoaded = true;
			})
			.catch((err) => {
				console.error("Failed to load map atlas manifests:", err);
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
