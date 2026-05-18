<script lang="ts">
	import { onMount } from "svelte";
	import { Deck, OrthographicView } from "@deck.gl/core";
	import { IconLayer, PathLayer, PolygonLayer } from "@deck.gl/layers";
	import type { MapTile } from "$lib/types/MapTile";
	import type { CityInfo } from "$lib/types/CityInfo";
	import { getCivilizationColor } from "$lib/config";
	import {
		ATLAS_MANIFEST,
		NATION_ALIASES_URL,
	} from "$lib/generated/atlas-manifest";
	import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
	import MapTooltip from "$lib/MapTooltip.svelte";

	// Hex geometry from atlas reference (pointy-top, matching sprite masks).
	// Atlases are pre-baked by scripts/bake-terrain-3d.ts (terrain),
	// scripts/bake-improvements.ts (urban), and scripts/bake-resources.ts:
	// hex-clip + cover-fit happen at build time. The runtime feeds each baked
	// atlas straight to deck.gl IconLayer, which samples it as-is. The
	// dimensions also drive overlay polygons (religion fill) and edge segments
	// (political borders).
	//
	// Aspect tracks the game's on-screen hex: pointy-top R = 5 world units
	// (8.66 × 10) viewed at the camera's fixed 45° pitch → 8.66 × 7.07
	// pixel-projected, aspect 1.225. Pinacotheca renders at the same tilt,
	// so cell hex matches its image hex up to a uniform scale.
	const HEX_H_SPACING = 199;
	const HEX_V_SPACING = 122;
	// Elliptical hex radii derived from grid spacing so polygons tessellate
	// exactly: H_SPACING = 2 * apothem = R_X * sqrt(3); V_SPACING = 1.5 * R_Y.
	const HEX_RADIUS_X = HEX_H_SPACING / Math.sqrt(3);
	const HEX_RADIUS_Y = HEX_V_SPACING / 1.5;

	// Atlas paths come from the bake-pipeline manifest. URLs are content-
	// hashed (e.g. /atlases/terrain-3d.a1b2c3d4.webp), so they're safe to
	// serve with Cache-Control: immutable, max-age=1y. See
	// docs/section-3.4-content-hashing.html.
	const TERRAIN_3D_ATLAS_URL = ATLAS_MANIFEST["terrain-3d"].webp;
	const IMPROVEMENTS_BASE_ATLAS_URL = ATLAS_MANIFEST["improvements-base"].webp;
	const RESOURCES_ATLAS_URL = ATLAS_MANIFEST["resources"].webp;
	const familyAtlasUrl = (family: string): string =>
		ATLAS_MANIFEST[`improvements-urban-${family}`]?.webp ?? "";

	interface NationAliasEntry {
		urban: string;
		capital: string;
	}

	interface AtlasManifest {
		atlas: string;
		cellWidth: number;
		cellHeight: number;
		bakedAt?: string;
		pinacothecaVersion?: string;
		sprites: Record<
			string,
			{ x: number; y: number; width: number; height: number }
		>;
		// Optional generic-improvement cell. Drawn on any tile whose
		// `improvement` value isn't a key in `sprites` — e.g. zTypes from mod
		// content not vendored into Reference/XML. Only the improvements-base
		// manifest emits this; terrain/height/resources/family manifests don't.
		fallbackSprite?: { x: number; y: number; width: number; height: number };
	}

	interface NationAliasPayload {
		bakedAt?: string;
		aliases: Record<string, NationAliasEntry>;
	}

	// Lookup helpers parameterized over the alias map and family-manifest
	// cache so they can run inside reactive layer-build effects without
	// closing over module-scope state. Returning null is the "no render path
	// available" signal — the caller falls through to the next layer.

	function urbanFamilyFor(
		owner: string | null,
		aliases: Map<string, NationAliasEntry>,
	): string | null {
		if (!owner) return null;
		return aliases.get(owner)?.urban ?? null;
	}

	function capitalFamilyFor(
		owner: string | null,
		aliases: Map<string, NationAliasEntry>,
	): string | null {
		if (!owner) return null;
		return aliases.get(owner)?.capital ?? null;
	}

	// Returns the urban family whose composite atlas covers (tile.improvement,
	// owner_nation), or null. Used both to filter tiles into per-family
	// composite IconLayers AND to decide whether the urban-empty / base /
	// fallback layers should suppress drawing on this tile (composite wins).
	function compositeFamilyFor(
		tile: MapTile,
		aliases: Map<string, NationAliasEntry>,
		familyManifests: Record<string, AtlasManifest>,
	): string | null {
		if (!tile.improvement || !tile.owner_nation) return null;
		const family = urbanFamilyFor(tile.owner_nation, aliases);
		if (!family) return null;
		const fm = familyManifests[family];
		return fm?.sprites[tile.improvement] ? family : null;
	}

	// Returns the CAPITAL_<family> sprite key from improvements-base for a
	// capital tile, or null if the tile isn't a capital or the resolved family
	// has no capital render. Capital sprites include their own ground patch
	// (pinacotheca 2.2.0+), so no URBAN underlay is drawn beneath them.
	function capitalSpriteKeyFor(
		tile: MapTile,
		aliases: Map<string, NationAliasEntry>,
		baseManifest: AtlasManifest,
	): string | null {
		if (!tile.is_capital || !tile.owner_nation) return null;
		const cf = capitalFamilyFor(tile.owner_nation, aliases);
		if (!cf) return null;
		const key = `CAPITAL_${cf}`;
		return baseManifest.sprites[key] ? key : null;
	}

	// Resolve a tile to its packed terrain-3d sprite keys. Two layers stack
	// per tile: a FLAT base that fills per-ankh's hex extent edge-to-edge, and
	// (only on HILL/MOUNTAIN/VOLCANO) a relief sprite drawn on top.
	//
	// Why two layers: pinacotheca's HILL/MOUNTAIN/VOLCANO renders include
	// spire/peak content that legitimately extends past the hex bbox (e.g.
	// MOUNTAIN's groundHex is only 81% × 85% of source image). Cover-fit
	// shrinks the hex base into the cell to fit the full image, leaving a
	// visible canvas-color ring around relief tiles. Mirroring the URBAN /
	// CATHEDRAL pattern, we draw the matching FLAT sprite (which fills the
	// hex edge-to-edge) underneath, then layer the relief on top — same
	// trick that makes nation-owned urban tiles and tall improvements work.
	//
	// Resolution rules (apply to both base and relief):
	//   FROST → TUNDRA   pinacotheca clarified that in-game frost tiles are
	//                    literally TERRAIN_TUNDRA; TERRAIN_FROST is an orphan
	//                    icon with no 3D backing.
	//   WATER            HEIGHT_OCEAN/COAST/LAKE → TERRAIN_3D_WATER_*; no
	//                    relief layer (water has no spire content).
	//   URBAN, no nation TERRAIN_3D_URBAN_FLAT for the base; no relief
	//                    (only URBAN_FLAT is rendered).
	//   URBAN, owned     TERRAIN_3D_TEMPERATE_FLAT base + TEMPERATE_<height>
	//                    relief — pinacotheca composes urban renders on a
	//                    TERRAIN_TEMPERATE base, so a temperate underlay
	//                    matches the source composition and gives the
	//                    URBAN/CAPITAL overlay's hex-clip the right
	//                    backstop.
	//   Land biomes      TERRAIN_3D_<biome>_FLAT base + <biome>_<height>
	//                    relief.
	function terrain3dBaseKey(
		tile: MapTile,
		aliases: Map<string, NationAliasEntry>,
		manifest: AtlasManifest,
	): string | null {
		const t = tile.terrain;
		if (!t) return null;
		const biomePart =
			t === "TERRAIN_FROST" ? "TUNDRA" : t.replace(/^TERRAIN_/, "");
		if (biomePart === "WATER") {
			const heightPart = tile.height
				? tile.height.replace(/^HEIGHT_/, "")
				: "OCEAN";
			const key = `TERRAIN_3D_WATER_${heightPart}`;
			return manifest.sprites[key] ? key : null;
		}
		if (biomePart === "URBAN") {
			const family = urbanFamilyFor(tile.owner_nation, aliases);
			if (family) {
				return manifest.sprites.TERRAIN_3D_TEMPERATE_FLAT
					? "TERRAIN_3D_TEMPERATE_FLAT"
					: null;
			}
			return manifest.sprites.TERRAIN_3D_URBAN_FLAT
				? "TERRAIN_3D_URBAN_FLAT"
				: null;
		}
		const key = `TERRAIN_3D_${biomePart}_FLAT`;
		return manifest.sprites[key] ? key : null;
	}

	function terrain3dReliefKey(
		tile: MapTile,
		aliases: Map<string, NationAliasEntry>,
		manifest: AtlasManifest,
	): string | null {
		const t = tile.terrain;
		if (!t) return null;
		const heightPart = tile.height
			? tile.height.replace(/^HEIGHT_/, "")
			: "FLAT";
		if (
			heightPart !== "HILL" &&
			heightPart !== "MOUNTAIN" &&
			heightPart !== "VOLCANO"
		) {
			return null;
		}
		const biomePart =
			t === "TERRAIN_FROST" ? "TUNDRA" : t.replace(/^TERRAIN_/, "");
		if (biomePart === "WATER") return null;
		if (biomePart === "URBAN") {
			const family = urbanFamilyFor(tile.owner_nation, aliases);
			if (!family) return null;
			const key = `TERRAIN_3D_TEMPERATE_${heightPart}`;
			return manifest.sprites[key] ? key : null;
		}
		const key = `TERRAIN_3D_${biomePart}_${heightPart}`;
		return manifest.sprites[key] ? key : null;
	}

	// Resource variant pick: SOLO with a rural improvement, HERD without.
	// Falls back to the other variant if only one is in the atlas (handles a
	// pinacotheca render set that ships only HERD or only SOLO for some
	// resource). Returns null if neither variant exists.
	function resourceSpriteKeyFor(
		tile: MapTile,
		resourceManifest: AtlasManifest,
	): string | null {
		if (tile.resource == null) return null;
		const preferred = tile.improvement != null ? "SOLO" : "HERD";
		const fallback = preferred === "SOLO" ? "HERD" : "SOLO";
		const preferredKey = `${tile.resource}_${preferred}`;
		if (resourceManifest.sprites[preferredKey]) return preferredKey;
		const fallbackKey = `${tile.resource}_${fallback}`;
		if (resourceManifest.sprites[fallbackKey]) return fallbackKey;
		return null;
	}

	let {
		tiles,
		cities = [],
		height = "600px",
		totalTurns = null,
		selectedTurn = null,
		onTurnChange = null,
	}: {
		tiles: MapTile[];
		// Used to resolve owner_city → family for the tooltip's family crest.
		// Empty array is fine — tooltip just omits the family crest.
		cities?: CityInfo[];
		height?: string;
		totalTurns?: number | null;
		selectedTurn?: number | null;
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onTurnChange?: ((turn: number) => Promise<void> | void) | null;
	} = $props();

	// city_name → resolved crest sprite key (or null when no crest is
	// renderable). Resolution prefers a per-family crest when we ship the
	// art; otherwise falls back to the family-class archetype crest, which
	// always exists for non-null family_class values. Recomputed when the
	// cities prop changes; tile lookups stay O(1) inside the tooltip resolver.
	// Existence is checked against the SPRITE_MANIFEST baked from
	// static/sprites/crests/CREST_FAMILY_*.png.
	const cityFamilyCrestByName = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const map = new Map<string, string | null>();
		for (const c of cities) {
			let key: string | null = null;
			if (
				c.family &&
				SPRITE_MANIFEST[`crests/CREST_FAMILY_${c.family}`] != null
			) {
				key = c.family;
			} else if (c.family_class) {
				// FAMILYCLASS_CHAMPIONS → ARCHETYPE_CHAMPIONS
				key = c.family_class.replace(/^FAMILYCLASS_/, "ARCHETYPE_");
			}
			map.set(c.city_name, key);
		}
		return map;
	});

	let deckCanvas: HTMLCanvasElement;
	let deck: Deck<OrthographicView> | null = $state(null);

	// Always-loaded atlases — fetched once at mount and cached for the session.
	// The matching .webp URLs are passed to IconLayer's iconAtlas prop, which
	// fetches and decodes the texture itself.
	let terrain3dManifest: AtlasManifest | null = $state(null);
	let improvementsBaseManifest: AtlasManifest | null = $state(null);
	let resourcesManifest: AtlasManifest | null = $state(null);
	// Nation → {urban, capital} family alias, baked from nation.xml. Single
	// source of truth at runtime for resolving owner_nation to atlas keys.
	let nationAliases: Map<string, NationAliasEntry> = $state(new Map());
	// Lazy-loaded urban-composite atlases keyed by urban family. Each entry
	// fetched on first sight of a tile whose nation maps to that family.
	// Treated as a frozen record so $effect tracks shallow changes by
	// reassigning the whole object on insert (simpler than per-key reactivity).
	let familyManifests: Record<string, AtlasManifest> = $state({});
	let assetsLoaded = $state(false);

	// Layer visibility toggles
	let showPolitical = $state(true);
	let showReligion = $state(false);

	// ─── Tooltip state ────────────────────────────────────────────────
	// Hover position is in canvas-local CSS pixels (deck.gl onHover already
	// converts). Locked tooltips store world coords and reproject on every
	// view-state change so they stay anchored to their tile when the user
	// pans/zooms.
	interface HoverState {
		tile: MapTile;
		x: number;
		y: number;
	}
	interface LockedTooltip {
		key: string; // `${tile.x},${tile.y}` — used to dedupe & identify
		tile: MapTile;
		worldX: number;
		worldY: number;
	}
	let hoverState = $state<HoverState | null>(null);
	let lockedTooltips = $state<LockedTooltip[]>([]);
	// Bumped from Deck.onViewStateChange to force re-derivation of locked
	// tooltips' screen positions. Cheaper than tracking the full viewState
	// object (we only ever need to read-only re-project, not the whole state).
	let viewVersion = $state(0);
	let containerEl: HTMLDivElement | null = $state(null);
	let containerWidth = $state(0);
	let containerHeight = $state(0);

	// Camera-control state. Tracked here (in addition to viewVersion) so the
	// overlay zoom buttons can read the current zoom and pan target and feed
	// adjusted values back into the Deck via setProps.
	type ViewState = { target: [number, number, number]; zoom: number };
	const MIN_ZOOM = -6;
	const MAX_ZOOM = 4;
	const ZOOM_STEP = 0.75;
	let currentViewState = $state<ViewState | null>(null);

	// deck.gl's OrthographicViewState.target is [x,y] | [x,y,z] | undefined;
	// normalize to a 3-tuple so the rest of our code can rely on a single shape.
	function normalizeViewState(vs: {
		target?: number[] | [number, number] | [number, number, number];
		zoom?: number | [number, number];
	}): ViewState {
		const t = vs.target ?? [0, 0, 0];
		const zoom = typeof vs.zoom === "number" ? vs.zoom : 0;
		return {
			target: [t[0] ?? 0, t[1] ?? 0, t[2] ?? 0],
			zoom,
		};
	}

	// ─── Fullscreen state (mirror of normal view) ─────────────────────
	// Same dual-deck pattern as HexMap: WebGL contexts can't move between
	// canvases, so a separate Deck instance is bound to the dialog's canvas
	// and fed the same layers via the layer-build $effect. Hover + view
	// version are tracked independently so the two views' tooltips don't
	// fight each other; locked tooltips are shared (pinning persists).
	let dialogRef: HTMLDialogElement | null = $state(null);
	let isClosing = $state(false);
	let fullscreenCanvas: HTMLCanvasElement;
	let fullscreenDeck: Deck<OrthographicView> | null = $state(null);
	let fullscreenHoverState = $state<HoverState | null>(null);
	let fullscreenViewVersion = $state(0);
	let fullscreenCurrentViewState = $state<ViewState | null>(null);
	let fullscreenContainerEl: HTMLDivElement | null = $state(null);
	let fullscreenContainerWidth = $state(0);
	let fullscreenContainerHeight = $state(0);
	const ANIMATION_DURATION = 200; // ms — keep in sync with CSS

	function tileKey(t: MapTile): string {
		return `${t.x},${t.y}`;
	}

	function toggleLockedTile(tile: MapTile) {
		const key = tileKey(tile);
		const existing = lockedTooltips.find((l) => l.key === key);
		if (existing) {
			lockedTooltips = lockedTooltips.filter((l) => l.key !== key);
			return;
		}
		const [wx, wy] = hexToPixel(tile.x, tile.y);
		lockedTooltips = [...lockedTooltips, { key, tile, worldX: wx, worldY: wy }];
	}

	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		if (!deck || !deckCanvas) return;
		const rect = deckCanvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const picked = deck.pickObject({ x, y, radius: 0 });
		if (picked && picked.object) {
			toggleLockedTile(picked.object as MapTile);
		}
	}

	function handleFullscreenContextMenu(e: MouseEvent) {
		e.preventDefault();
		if (!fullscreenDeck || !fullscreenCanvas) return;
		const rect = fullscreenCanvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const picked = fullscreenDeck.pickObject({ x, y, radius: 0 });
		if (picked && picked.object) {
			toggleLockedTile(picked.object as MapTile);
		}
	}

	// Resolve owner_nation → crest sprite key with a 3-tier fallback:
	//   1. The nation's own crest if shipped (handles MAURYA/TAMIL/YUEZHI,
	//      KUSH/HYKSOS/MITANNI — which all have their own crest but whose
	//      urban-family alias points elsewhere).
	//   2. The urban-family alias's crest if shipped (handles variant
	//      nations like NATION_AMUN/ATHENS/PTOLEMY that have no own crest).
	//   3. CREST_TRIBE_GENERIC as a last resort (e.g. INDIA family — no
	//      CREST_NATION_INDIA exists in the game).
	// Existence is checked against the SPRITE_MANIFEST baked from
	// static/sprites/crests/CREST_NATION_*.png.
	function resolveNationCrestKey(ownerNation: string | null): string | null {
		if (!ownerNation) return null;
		const stem = ownerNation.replace(/^NATION_/, "");
		if (SPRITE_MANIFEST[`crests/CREST_NATION_${stem}`] != null) {
			return `NATION_${stem}`;
		}
		const alias = nationAliases.get(ownerNation);
		if (
			alias?.urban &&
			SPRITE_MANIFEST[`crests/CREST_NATION_${alias.urban}`] != null
		) {
			return `NATION_${alias.urban}`;
		}
		return "TRIBE_GENERIC";
	}

	// Project a world-space tile center to canvas-local screen pixels via the
	// current Deck viewport. Returns null if Deck or viewport isn't ready.
	interface PickViewport {
		// eslint-disable-next-line no-unused-vars -- arg name documents the call shape
		project(coords: [number, number, number]): [number, number, number];
	}
	interface DeckWithViewports {
		getViewports(): PickViewport[];
	}
	function projectWorld(
		wx: number,
		wy: number,
		target: Deck<OrthographicView> | null = deck,
	): [number, number] | null {
		if (!target) return null;
		// getViewports lives on Deck's runtime API but isn't on its public TS
		// surface. Narrow via a local interface rather than `any`.
		const viewports = (target as unknown as DeckWithViewports).getViewports?.();
		if (!viewports || viewports.length === 0) return null;
		const screen = viewports[0].project([wx, wy, 0]);
		return [screen[0], screen[1]];
	}

	interface LockedScreen extends LockedTooltip {
		sx: number;
		sy: number;
	}

	// Re-project locked tooltips on every view-state change. Anchors that
	// project off-canvas (e.g. extreme zoom-out) are dropped from the render.
	const lockedScreen = $derived.by<LockedScreen[]>(() => {
		// Track viewVersion so this re-derives when the camera moves.
		void viewVersion;
		const out: LockedScreen[] = [];
		for (const l of lockedTooltips) {
			const screen = projectWorld(l.worldX, l.worldY, deck);
			if (!screen) continue;
			out.push({ ...l, sx: screen[0], sy: screen[1] });
		}
		return out;
	});

	// Same logic, projected through the fullscreen deck so locked tooltips
	// follow camera moves in the dialog independently of the normal view.
	const lockedScreenFullscreen = $derived.by<LockedScreen[]>(() => {
		void fullscreenViewVersion;
		const out: LockedScreen[] = [];
		for (const l of lockedTooltips) {
			const screen = projectWorld(l.worldX, l.worldY, fullscreenDeck);
			if (!screen) continue;
			out.push({ ...l, sx: screen[0], sy: screen[1] });
		}
		return out;
	});

	// Suppress hover tooltip when the hovered tile is already pinned — avoids
	// double-rendering on the same anchor. Deck still emits hover; we just
	// don't render the floating one.
	const showHover = $derived.by(() => {
		if (!hoverState) return false;
		const k = tileKey(hoverState.tile);
		return !lockedTooltips.some((l) => l.key === k);
	});

	const showFullscreenHover = $derived.by(() => {
		if (!fullscreenHoverState) return false;
		const k = tileKey(fullscreenHoverState.tile);
		return !lockedTooltips.some((l) => l.key === k);
	});

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
		const entry = ATLAS_MANIFEST[name];
		if (!entry) throw new Error(`unknown atlas: ${name}`);
		const response = await fetch(entry.json);
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
	// layer-toggle flips. The console.time blocks are DEV-only so we can
	// profile during turn-slider scrubbing without shipping log spam.
	const politicalData = $derived.by<PoliticalData>(() => {
		if (tiles.length === 0) return { borders: [], subBorders: [] };
		if (import.meta.env.DEV) console.time("computePoliticalData");
		const result = computePoliticalData(tiles);
		if (import.meta.env.DEV) console.timeEnd("computePoliticalData");
		return result;
	});
	const religionFills = $derived.by<ReligionFill[]>(() => {
		if (tiles.length === 0) return [];
		if (import.meta.env.DEV) console.time("computeReligionFills");
		const result = computeReligionFills(tiles);
		if (import.meta.env.DEV) console.timeEnd("computeReligionFills");
		return result;
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
		// Cell-bbox margin around the map's hex-center extent, so the
		// outermost tiles aren't clipped at the viewport edge. Read from
		// the loaded manifest (pinacotheca's atlas is the source of truth
		// for cell dimensions) — falling back to the per-ankh constants
		// if the manifest hasn't loaded yet.
		const cellMarginW = improvementsBaseManifest?.cellWidth ?? 211;
		const cellMarginH = improvementsBaseManifest?.cellHeight ?? 167;
		const mapWidth = maxPx - minPx + cellMarginW;
		const mapHeight = maxPy - minPy + cellMarginH;

		// Calculate zoom to fit map in canvas
		const canvasWidth = target.clientWidth;
		const canvasHeight = target.clientHeight;
		const zoomX = Math.log2(canvasWidth / mapWidth);
		const zoomY = Math.log2(canvasHeight / mapHeight);
		const zoom = Math.min(zoomX, zoomY);

		return { target: [centerX, centerY, 0] as [number, number, number], zoom };
	}

	// Programmatic camera control for the overlay zoom buttons. deck.gl
	// re-applies initialViewState when a new object reference is passed via
	// setProps, which jumps the camera without disturbing the controller's
	// drag/wheel handling.
	function applyViewState(isFullscreen: boolean, next: ViewState) {
		const target = isFullscreen ? fullscreenDeck : deck;
		if (!target) return;
		target.setProps({
			initialViewState: { ...next, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM },
		});
		if (isFullscreen) {
			fullscreenCurrentViewState = next;
			fullscreenViewVersion++;
		} else {
			currentViewState = next;
			viewVersion++;
		}
	}

	function adjustZoom(delta: number, isFullscreen: boolean) {
		const cur = isFullscreen ? fullscreenCurrentViewState : currentViewState;
		if (!cur) return;
		const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cur.zoom + delta));
		if (newZoom === cur.zoom) return;
		applyViewState(isFullscreen, { ...cur, zoom: newZoom });
	}

	function fitView(isFullscreen: boolean) {
		const canvas = isFullscreen ? fullscreenCanvas : deckCanvas;
		if (!canvas) return;
		applyViewState(isFullscreen, calculateViewState(canvas));
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
		currentViewState = viewState;

		deck = new Deck({
			canvas: deckCanvas,
			width,
			height: canvasHeight,
			useDevicePixels: true,
			views: new OrthographicView({ id: "ortho" }),
			initialViewState: {
				...viewState,
				minZoom: MIN_ZOOM,
				maxZoom: MAX_ZOOM,
			},
			controller: true,
			// Bump viewVersion so locked tooltips re-project on every camera
			// change. Locked screen positions are derived from worldX/worldY
			// against the current viewport (see lockedScreen $derived).
			onViewStateChange: ({ viewState: vs }) => {
				currentViewState = normalizeViewState(vs);
				viewVersion++;
			},
			// Hover dispatch: deck.gl returns the picked layer's data item.
			// Our pickable PolygonLayer is fed the MapTile array directly,
			// so `object` is a MapTile (or undefined when off any tile).
			onHover: (info: { object?: MapTile; x: number; y: number }) => {
				if (info.object) {
					hoverState = { tile: info.object, x: info.x, y: info.y };
				} else {
					hoverState = null;
				}
			},
			// Layers populated by the $effect below as soon as derivatives resolve.
			layers: [],
		});
	}

	function initFullscreenDeck() {
		if (!fullscreenCanvas || !assetsLoaded) return;

		const width = fullscreenCanvas.clientWidth;
		const canvasHeight = fullscreenCanvas.clientHeight;
		if (width === 0 || canvasHeight === 0) return;

		if (fullscreenDeck) {
			fullscreenDeck.finalize();
			fullscreenDeck = null;
		}

		fullscreenCanvas.width = width * window.devicePixelRatio;
		fullscreenCanvas.height = canvasHeight * window.devicePixelRatio;

		const viewState = calculateViewState(fullscreenCanvas);
		fullscreenCurrentViewState = viewState;

		fullscreenDeck = new Deck({
			canvas: fullscreenCanvas,
			width,
			height: canvasHeight,
			useDevicePixels: true,
			views: new OrthographicView({ id: "ortho" }),
			initialViewState: {
				...viewState,
				minZoom: MIN_ZOOM,
				maxZoom: MAX_ZOOM,
			},
			controller: true,
			onViewStateChange: ({ viewState: vs }) => {
				fullscreenCurrentViewState = normalizeViewState(vs);
				fullscreenViewVersion++;
			},
			onHover: (info: { object?: MapTile; x: number; y: number }) => {
				if (info.object) {
					fullscreenHoverState = {
						tile: info.object,
						x: info.x,
						y: info.y,
					};
				} else {
					fullscreenHoverState = null;
				}
			},
			layers: [],
		});
	}

	function openFullscreen() {
		dialogRef?.showModal();
		// `tick()` resolves on the microtask queue, before the browser commits
		// layout for the dialog's display flip. At that point the canvas still
		// reports clientWidth/Height === 0 and initFullscreenDeck bails out at
		// its early-return guard, leaving the dialog with the bare container
		// background visible. Poll on rAF until the canvas has been laid out.
		const tryInit = () => {
			if (!fullscreenCanvas || fullscreenDeck) return;
			// Bail if the dialog was closed before layout completed —
			// otherwise the rAF chain would keep polling against a hidden
			// canvas forever.
			if (!dialogRef?.open) return;
			if (
				fullscreenCanvas.clientWidth === 0 ||
				fullscreenCanvas.clientHeight === 0
			) {
				requestAnimationFrame(tryInit);
				return;
			}
			initFullscreenDeck();
		};
		requestAnimationFrame(tryInit);
	}

	function closeFullscreen() {
		if (!dialogRef || isClosing) return;
		isClosing = true;
		setTimeout(() => {
			dialogRef?.close();
			isClosing = false;
			// Tear down the fullscreen deck so we don't accumulate WebGL
			// contexts on repeat open/close (browsers cap at ~16).
			if (fullscreenDeck) {
				fullscreenDeck.finalize();
				fullscreenDeck = null;
			}
			fullscreenHoverState = null;
		}, ANIMATION_DURATION);
	}

	function handleDialogClose() {
		// Strip focus from whichever button triggered the close so the focus
		// ring doesn't end up on the expand button.
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === dialogRef) {
			closeFullscreen();
		}
	}

	// Lazy-load the urban-composite atlas for `family` if it isn't already
	// cached. Idempotent: concurrent calls for the same family race on the
	// fetch but resolve to the same manifest write. We swap the whole record
	// so the layers $effect tracks insertions via reassignment.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- module-scope guard, not reactive state
	const familyLoadsInFlight = new Set<string>();
	async function ensureFamilyAtlas(family: string): Promise<void> {
		if (familyManifests[family] || familyLoadsInFlight.has(family)) return;
		familyLoadsInFlight.add(family);
		try {
			const manifest = await loadManifest(`improvements-urban-${family}`);
			familyManifests = { ...familyManifests, [family]: manifest };
		} catch (err) {
			console.error(`Failed to load family atlas ${family}:`, err);
		} finally {
			familyLoadsInFlight.delete(family);
		}
	}

	// React to tile changes by ensuring every present-on-map nation's urban
	// family atlas is loaded. Reads `tiles` and `nationAliases`; mutates
	// `familyManifests` (which the layers effect tracks separately). Doesn't
	// re-trigger on its own writes since it doesn't read familyManifests.
	$effect(() => {
		if (nationAliases.size === 0) return;
		const al = nationAliases;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Set, not reactive state
		const needed = new Set<string>();
		for (const tile of tiles) {
			if (!tile.owner_nation) continue;
			const family = al.get(tile.owner_nation)?.urban;
			if (family) needed.add(family);
		}
		for (const f of needed) {
			ensureFamilyAtlas(f);
		}
	});

	// Build the full layer set for a single Deck. Each Deck instance owns
	// its own GL context, and a Layer instance binds GPU resources to the
	// first context it draws into; sharing a Layer between two Decks
	// silently breaks rendering in the second. So when both the inline and
	// fullscreen decks are live we call this twice to get fresh instances
	// per deck.
	function buildLayers() {
		const t3d = terrain3dManifest;
		const ibm = improvementsBaseManifest;
		const rm = resourcesManifest;
		const al = nationAliases;
		const fms = familyManifests;
		if (!t3d || !ibm || !rm) return null;
		const political = politicalData;
		const fills = religionFills;
		const pol = showPolitical;
		const rel = showReligion;

		// Per-family composite IconLayers — one per family that has any tile
		// AND a loaded manifest. Iterating over loaded manifests means
		// pre-fetch families that aren't on the current map don't add empty
		// layers, and tiles whose family hasn't loaded yet fall through to
		// the urban-empty + base layers until the fetch resolves.
		const compositeLayers = Object.keys(fms).map((family) => {
			const fm = fms[family];
			return new IconLayer<MapTile>({
				id: `urban-composite-${family}`,
				data: tiles.filter((t) => compositeFamilyFor(t, al, fms) === family),
				iconAtlas: familyAtlasUrl(family),
				iconMapping: fm.sprites,
				getIcon: (d: MapTile) => d.improvement as string,
				getPosition: (d: MapTile) => hexToPixel(d.x, d.y),
				getSize: () => fm.cellWidth,
				sizeUnits: "common",
				sizeBasis: "width",
				pickable: false,
			});
		});

		return [
			// Terrain base layer: <BIOME>_FLAT for every land tile,
			// WATER_<height> for water, URBAN_FLAT (or TEMPERATE_FLAT if
			// nation-owned) for urban. Always draws — fills per-ankh's
			// hex extent edge-to-edge so adjacent tiles tessellate cleanly.
			// Also serves as the backstop under nation URBAN/CAPITAL
			// overlays whose hex-clip leaves the cell corners transparent.
			new IconLayer<MapTile>({
				id: "terrain-3d-base",
				data: tiles.filter((t) => terrain3dBaseKey(t, al, t3d) != null),
				iconAtlas: TERRAIN_3D_ATLAS_URL,
				iconMapping: t3d.sprites,
				getIcon: (d: MapTile) => terrain3dBaseKey(d, al, t3d) as string,
				getPosition: (d: MapTile) => hexToPixel(d.x, d.y),
				getSize: () => t3d.cellWidth,
				sizeUnits: "common",
				sizeBasis: "width",
				pickable: false,
			}),
			// Terrain relief layer: HILL/MOUNTAIN/VOLCANO sprites drawn
			// on top of the base. Pinacotheca's relief renders include
			// spire/peak content extending past the hex bbox (the hex
			// base is only ~80–98% of source image), so cover-fit shrinks
			// the hex to ~80% of per-ankh's hex extent. The base layer
			// underneath fills the ring; the relief sprite contributes
			// the actual mountain/hill content on top.
			new IconLayer<MapTile>({
				id: "terrain-3d-relief",
				data: tiles.filter((t) => terrain3dReliefKey(t, al, t3d) != null),
				iconAtlas: TERRAIN_3D_ATLAS_URL,
				iconMapping: t3d.sprites,
				getIcon: (d: MapTile) => terrain3dReliefKey(d, al, t3d) as string,
				getPosition: (d: MapTile) => hexToPixel(d.x, d.y),
				getSize: () => t3d.cellWidth,
				sizeUnits: "common",
				sizeBasis: "width",
				pickable: false,
			}),
			// Per-nation tile render — capital city for capital tiles, the
			// nation's urban backdrop everywhere else. Both come from
			// improvements-base, both fully cover the inscribed hex, and
			// neither is ever overdrawn by a composite (capitals don't have
			// composite-eligible improvements; urban-empty tiles already
			// filter out composite-covered ones).
			new IconLayer<MapTile>({
				id: "nation-tile-icons",
				data: tiles.filter((t) => {
					const cap = capitalSpriteKeyFor(t, al, ibm);
					if (cap != null) return true;
					if (t.terrain !== "TERRAIN_URBAN") return false;
					const family = urbanFamilyFor(t.owner_nation, al);
					if (family == null) return false;
					if (compositeFamilyFor(t, al, fms) != null) return false;
					return ibm.sprites[`URBAN_${family}`] != null;
				}),
				iconAtlas: IMPROVEMENTS_BASE_ATLAS_URL,
				iconMapping: ibm.sprites,
				getIcon: (d: MapTile) => {
					const cap = capitalSpriteKeyFor(d, al, ibm);
					if (cap != null) return cap;
					return `URBAN_${urbanFamilyFor(d.owner_nation, al)}`;
				},
				getPosition: (d: MapTile) => hexToPixel(d.x, d.y),
				getSize: () => ibm.cellWidth,
				sizeUnits: "common",
				sizeBasis: "width",
				pickable: false,
			}),
			// Resource sprites (animals/fish/minerals). Drawn after the
			// terrain layer so they sit on the underlying biome/relief,
			// and before the improvement layer so rural improvements
			// (Pasture/Camp/Mine) draw their structure on top.
			//
			// Variant selection: SOLO when the tile carries a rural
			// improvement (a single figure tucks neatly inside the fence
			// or mining structure), HERD on bare tiles (the herd reads as
			// the wild resource). Falls back to whichever variant the
			// atlas has if only one is present.
			//
			// Aliased urban tiles are skipped — pinacotheca's urban-tile
			// renders (composites and standalones) already incorporate the
			// scene without wild-resource visuals, matching the game's own
			// behavior of replacing the resource model with city imagery.
			new IconLayer<MapTile>({
				id: "resource-icons",
				data: tiles.filter((t) => {
					if (resourceSpriteKeyFor(t, rm) == null) return false;
					if (
						t.terrain === "TERRAIN_URBAN" &&
						urbanFamilyFor(t.owner_nation, al) != null
					) {
						return false;
					}
					return true;
				}),
				iconAtlas: RESOURCES_ATLAS_URL,
				iconMapping: rm.sprites,
				getIcon: (d: MapTile) => resourceSpriteKeyFor(d, rm) as string,
				getPosition: (d: MapTile) => hexToPixel(d.x, d.y),
				getSize: () => rm.cellWidth,
				sizeUnits: "common",
				sizeBasis: "width",
				pickable: false,
			}),
			// Single-improvement renders (rural, ruins, settlements,
			// non-urban-buildable wonders). Synthesizes a __FALLBACK__
			// icon for zTypes the base manifest doesn't know — typically
			// mod content not vendored into Reference/XML — by extending
			// the iconMapping with the manifest's fallbackSprite cell.
			// Excludes tiles already covered by a composite layer or by
			// the nation-tile layer (capitals).
			new IconLayer<MapTile>({
				id: "improvement-icons",
				data: tiles.filter((t) => {
					if (t.improvement == null) return false;
					if (
						ibm.sprites[t.improvement] == null &&
						ibm.fallbackSprite == null
					) {
						return false;
					}
					if (capitalSpriteKeyFor(t, al, ibm) != null) return false;
					if (compositeFamilyFor(t, al, fms) != null) return false;
					return true;
				}),
				iconAtlas: IMPROVEMENTS_BASE_ATLAS_URL,
				iconMapping: {
					...ibm.sprites,
					...(ibm.fallbackSprite ? { __FALLBACK__: ibm.fallbackSprite } : {}),
				},
				getIcon: (d: MapTile) =>
					ibm.sprites[d.improvement as string] != null
						? (d.improvement as string)
						: "__FALLBACK__",
				getPosition: (d: MapTile) => hexToPixel(d.x, d.y),
				getSize: () => ibm.cellWidth,
				sizeUnits: "common",
				sizeBasis: "width",
				pickable: false,
			}),
			...compositeLayers,
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
			// Invisible pickable layer so hover/right-click resolve to the
			// correct hex regardless of which sprite layer happens to draw
			// on top. Uses the exact hexPolygon shape so picking matches
			// the inscribed hex (no slop into neighboring tiles at corners).
			// Sits last so it receives picks above all visual layers.
			new PolygonLayer<MapTile>({
				id: "tile-picking",
				data: tiles,
				getPolygon: (d: MapTile) => {
					const [cx, cy] = hexToPixel(d.x, d.y);
					return hexPolygon(cx, cy);
				},
				getFillColor: [0, 0, 0, 0],
				stroked: false,
				filled: true,
				pickable: true,
			}),
		];
	}

	$effect(() => {
		const targetDeck = deck;
		const targetFullscreenDeck = fullscreenDeck;
		if (!targetDeck && !targetFullscreenDeck) return;
		if (!assetsLoaded) return;

		// Touch all reactive deps that buildLayers reads, so the effect
		// re-runs when any of them change. buildLayers itself isn't called
		// inside a tracked context for both decks (we call it twice), so we
		// list the deps explicitly here.
		void terrain3dManifest;
		void improvementsBaseManifest;
		void resourcesManifest;
		void nationAliases;
		void familyManifests;
		void tiles;
		void politicalData;
		void religionFills;
		void showPolitical;
		void showReligion;

		const inlineLayers = buildLayers();
		if (inlineLayers) targetDeck?.setProps({ layers: inlineLayers });
		// Fresh layer instances for the second deck — Layer objects bind GPU
		// state to a single Deck's GL context, so reusing the same instances
		// breaks rendering in the second one.
		const fsLayers = buildLayers();
		if (fsLayers) targetFullscreenDeck?.setProps({ layers: fsLayers });
	});

	// ─── Turn slider + playback ───────────────────────────────────────
	// Same pattern as HexMap: debounce slider input so we don't fire a backend
	// fetch on every intermediate value while the user drags.
	let sliderDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	function handleSliderChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const turn = parseInt(target.value, 10);
		if (sliderDebounceTimer) clearTimeout(sliderDebounceTimer);
		sliderDebounceTimer = setTimeout(() => {
			void onTurnChange?.(turn);
		}, 100);
	}

	const showTurnSlider = $derived(
		totalTurns != null && selectedTurn != null && onTurnChange != null,
	);

	let isPlaying = $state(false);
	let isFastPlaying = $state(false);
	let playbackInterval: ReturnType<typeof setInterval> | null = null;
	const PLAYBACK_SPEED_MS = 300;
	const FAST_PLAYBACK_SPEED_MS = 150;

	function startPlayback(fast: boolean) {
		if (totalTurns == null || selectedTurn == null) return;
		stopPlayback();
		if (selectedTurn >= totalTurns) {
			void onTurnChange?.(1);
		}
		isPlaying = !fast;
		isFastPlaying = fast;
		const speed = fast ? FAST_PLAYBACK_SPEED_MS : PLAYBACK_SPEED_MS;
		playbackInterval = setInterval(() => {
			if (selectedTurn != null && totalTurns != null) {
				if (selectedTurn >= totalTurns) {
					stopPlayback();
				} else {
					void onTurnChange?.(selectedTurn + 1);
				}
			}
		}, speed);
	}

	function stopPlayback() {
		isPlaying = false;
		isFastPlaying = false;
		if (playbackInterval) {
			clearInterval(playbackInterval);
			playbackInterval = null;
		}
	}

	function togglePlayback() {
		if (isPlaying) stopPlayback();
		else startPlayback(false);
	}

	function toggleFastPlayback() {
		if (isFastPlaying) stopPlayback();
		else startPlayback(true);
	}

	$effect(() => {
		return () => {
			if (playbackInterval) clearInterval(playbackInterval);
			if (sliderDebounceTimer) clearTimeout(sliderDebounceTimer);
		};
	});

	async function loadNationAliases(): Promise<Map<string, NationAliasEntry>> {
		const response = await fetch(NATION_ALIASES_URL);
		const payload = (await response.json()) as NationAliasPayload;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- assigned to $state Map below
		const map = new Map<string, NationAliasEntry>();
		for (const [nation, entry] of Object.entries(payload.aliases)) {
			map.set(nation, entry);
		}
		return map;
	}

	onMount(() => {
		Promise.all([
			loadManifest("terrain-3d"),
			loadManifest("improvements-base"),
			loadManifest("resources"),
			loadNationAliases(),
		])
			.then(([terrain3d, improvementsBase, resources, aliases]) => {
				terrain3dManifest = terrain3d;
				improvementsBaseManifest = improvementsBase;
				resourcesManifest = resources;
				nationAliases = aliases;
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

		// Track container size for tooltip edge-flip clamping. ResizeObserver
		// fires on initial mount too, so no separate initialization needed.
		let resizeObserver: ResizeObserver | null = null;
		if (containerEl) {
			resizeObserver = new ResizeObserver(() => {
				if (!containerEl) return;
				containerWidth = containerEl.clientWidth;
				containerHeight = containerEl.clientHeight;
			});
			resizeObserver.observe(containerEl);
		}

		return () => {
			clearInterval(visibilityCheck);
			resizeObserver?.disconnect();
			if (deck) {
				deck.finalize();
				deck = null;
			}
			if (fullscreenDeck) {
				fullscreenDeck.finalize();
				fullscreenDeck = null;
			}
		};
	});

	// Track fullscreen container size for tooltip edge-clamping. The
	// container only exists in the DOM after the first dialog open; bind
	// reactivity to fullscreenContainerEl so the observer attaches as soon
	// as it appears and tears down if the element is replaced.
	$effect(() => {
		const el = fullscreenContainerEl;
		if (!el) return;
		const ro = new ResizeObserver(() => {
			fullscreenContainerWidth = el.clientWidth;
			fullscreenContainerHeight = el.clientHeight;
		});
		ro.observe(el);
		return () => ro.disconnect();
	});
</script>

{#snippet controlsBar(trailingBtn: "expand" | "close" | "none")}
	<div class="flex flex-wrap items-center gap-4 text-sm">
		<div class="flex items-center gap-3">
			<label class="marker-toggle">
				<input type="checkbox" bind:checked={showPolitical} />
				<span class="marker-label">Political</span>
			</label>
			<label class="marker-toggle">
				<input type="checkbox" bind:checked={showReligion} />
				<span class="marker-label">Religion</span>
			</label>
		</div>

		<div class="ml-auto flex items-center gap-6">
			{#if showTurnSlider}
				<div class="flex items-center gap-3">
					<span class="text-sm font-bold text-brown">Turn:</span>
					<div class="flex items-center">
						<button
							onclick={togglePlayback}
							class="rounded p-1.5 transition-colors {isPlaying
								? 'bg-brown text-tan'
								: 'bg-brown/30 hover:bg-brown/50'}"
							aria-label={isPlaying ? "Pause" : "Play"}
							title={isPlaying ? "Pause" : "Play (1x)"}
						>
							{#if isPlaying}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4 text-tan"
									fill="currentColor"
									viewBox="0 0 24 24"
								>
									<rect x="6" y="4" width="4" height="16" />
									<rect x="14" y="4" width="4" height="16" />
								</svg>
							{:else}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4 text-tan"
									fill="currentColor"
									viewBox="0 0 24 24"
								>
									<path d="M8 5v14l11-7z" />
								</svg>
							{/if}
						</button>
						<button
							onclick={toggleFastPlayback}
							class="rounded p-1.5 transition-colors {isFastPlaying
								? 'bg-brown text-tan'
								: 'bg-brown/30 hover:bg-brown/50'}"
							aria-label={isFastPlaying ? "Pause" : "Fast Forward"}
							title={isFastPlaying ? "Pause" : "Fast Forward (2x)"}
						>
							{#if isFastPlaying}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4 text-tan"
									fill="currentColor"
									viewBox="0 0 24 24"
								>
									<rect x="6" y="4" width="4" height="16" />
									<rect x="14" y="4" width="4" height="16" />
								</svg>
							{:else}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4 text-tan"
									fill="currentColor"
									viewBox="0 0 24 24"
								>
									<path d="M4 5v14l8-7z" />
									<path d="M12 5v14l8-7z" />
								</svg>
							{/if}
						</button>
					</div>
					<input
						type="range"
						min="1"
						max={totalTurns}
						value={selectedTurn}
						oninput={handleSliderChange}
						class="turn-slider w-48"
					/>
					<span class="w-8 text-right text-sm font-bold text-tan"
						>{selectedTurn}</span
					>
				</div>
			{/if}

			{#if trailingBtn === "expand"}
				<!-- Expand button (chart-style: semi-transparent overlay icon) -->
				<button
					onclick={openFullscreen}
					class="bg-black/20 hover:bg-black/40 cursor-pointer rounded p-1.5 transition-colors focus:outline-none"
					aria-label="Expand map to fullscreen"
					title="Expand to fullscreen"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-4 w-4 text-white"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
						/>
					</svg>
				</button>
			{:else if trailingBtn === "close"}
				<!-- Close button (matches expand styling so it slots into the same row) -->
				<button
					onclick={closeFullscreen}
					class="bg-black/20 hover:bg-black/40 cursor-pointer rounded p-1.5 transition-colors focus:outline-none"
					aria-label="Close fullscreen"
					title="Close fullscreen (Esc)"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-4 w-4 text-white"
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
			{/if}
		</div>
	</div>
{/snippet}

{#snippet zoomControls(isFullscreen: boolean)}
	{@const cur = isFullscreen ? fullscreenCurrentViewState : currentViewState}
	{@const zoom = cur?.zoom ?? 0}
	<div class="zoom-controls">
		<button
			type="button"
			class="zoom-btn"
			onclick={() => adjustZoom(ZOOM_STEP, isFullscreen)}
			disabled={zoom >= MAX_ZOOM}
			aria-label="Zoom in"
			title="Zoom in"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2.5"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12 5v14M5 12h14"
				/>
			</svg>
		</button>
		<button
			type="button"
			class="zoom-btn"
			onclick={() => adjustZoom(-ZOOM_STEP, isFullscreen)}
			disabled={zoom <= MIN_ZOOM}
			aria-label="Zoom out"
			title="Zoom out"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2.5"
			>
				<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
			</svg>
		</button>
		<button
			type="button"
			class="zoom-btn"
			onclick={() => fitView(isFullscreen)}
			aria-label="Fit map to view"
			title="Fit map to view"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M9 4H5a1 1 0 00-1 1v4m16 0V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4m6 0h4a1 1 0 001-1v-4"
				/>
			</svg>
		</button>
	</div>
{/snippet}

<div class="flex flex-col gap-4">
	<!-- Layer toggles + turn controls + expand button -->
	{@render controlsBar("expand")}

	<div
		class="sprite-map-container"
		style="height: {height};"
		bind:this={containerEl}
	>
		<canvas
			bind:this={deckCanvas}
			class="sprite-map-canvas"
			oncontextmenu={handleContextMenu}
		></canvas>

		{@render zoomControls(false)}

		{#if showHover && hoverState}
			<MapTooltip
				tile={hoverState.tile}
				cityFamily={hoverState.tile.owner_city
					? (cityFamilyCrestByName.get(hoverState.tile.owner_city) ?? null)
					: null}
				nationCrestKey={resolveNationCrestKey(hoverState.tile.owner_nation)}
				screenX={hoverState.x}
				screenY={hoverState.y}
				{containerWidth}
				{containerHeight}
			/>
		{/if}

		{#each lockedScreen as locked (locked.key)}
			<MapTooltip
				tile={locked.tile}
				cityFamily={locked.tile.owner_city
					? (cityFamilyCrestByName.get(locked.tile.owner_city) ?? null)
					: null}
				nationCrestKey={resolveNationCrestKey(locked.tile.owner_nation)}
				pinned
				screenX={locked.sx}
				screenY={locked.sy}
				{containerWidth}
				{containerHeight}
				onClose={() => toggleLockedTile(locked.tile)}
			/>
		{/each}
	</div>
</div>

<!-- Fullscreen dialog (chart-style: native <dialog> in browser top layer) -->
<dialog
	bind:this={dialogRef}
	onclick={handleBackdropClick}
	onclose={handleDialogClose}
	class="fullscreen-dialog {isClosing ? 'closing' : ''}"
>
	<div class="dialog-content">
		<!-- Mirrored controls bar with the close button slotted in the same
		     position the expand button occupies in the normal view. -->
		<div class="bg-black/90 mb-4 flex-shrink-0 rounded-lg px-4 py-3">
			{@render controlsBar("close")}
		</div>

		<!-- Fullscreen sprite map -->
		<div
			class="sprite-map-container relative min-h-0 flex-1"
			bind:this={fullscreenContainerEl}
		>
			<canvas
				bind:this={fullscreenCanvas}
				class="sprite-map-canvas"
				oncontextmenu={handleFullscreenContextMenu}
			></canvas>

			{@render zoomControls(true)}

			{#if showFullscreenHover && fullscreenHoverState}
				<MapTooltip
					tile={fullscreenHoverState.tile}
					cityFamily={fullscreenHoverState.tile.owner_city
						? (cityFamilyCrestByName.get(
								fullscreenHoverState.tile.owner_city,
							) ?? null)
						: null}
					nationCrestKey={resolveNationCrestKey(
						fullscreenHoverState.tile.owner_nation,
					)}
					screenX={fullscreenHoverState.x}
					screenY={fullscreenHoverState.y}
					containerWidth={fullscreenContainerWidth}
					containerHeight={fullscreenContainerHeight}
				/>
			{/if}

			{#each lockedScreenFullscreen as locked (locked.key)}
				<MapTooltip
					tile={locked.tile}
					cityFamily={locked.tile.owner_city
						? (cityFamilyCrestByName.get(locked.tile.owner_city) ?? null)
						: null}
					nationCrestKey={resolveNationCrestKey(locked.tile.owner_nation)}
					pinned
					screenX={locked.sx}
					screenY={locked.sy}
					containerWidth={fullscreenContainerWidth}
					containerHeight={fullscreenContainerHeight}
					onClose={() => toggleLockedTile(locked.tile)}
				/>
			{/each}
		</div>
	</div>
</dialog>

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

	.zoom-controls {
		position: absolute;
		right: 0.75rem;
		bottom: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		z-index: 10;
		pointer-events: auto;
	}

	.zoom-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0.375rem;
		background-color: rgb(0 0 0 / 0.5);
		color: white;
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.zoom-btn:hover:not(:disabled) {
		background-color: rgb(0 0 0 / 0.75);
	}

	.zoom-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
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

	.turn-slider {
		-webkit-appearance: none;
		appearance: none;
		height: 6px;
		background: #4a4540;
		border-radius: 3px;
		outline: none;
		cursor: pointer;
	}

	.turn-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 16px;
		height: 16px;
		background: var(--color-brown);
		border-radius: 50%;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.turn-slider::-webkit-slider-thumb:hover {
		background: var(--color-tan);
	}

	.turn-slider::-moz-range-thumb {
		width: 16px;
		height: 16px;
		background: var(--color-brown);
		border-radius: 50%;
		cursor: pointer;
		border: none;
		transition: background 0.15s ease;
	}

	.turn-slider::-moz-range-thumb:hover {
		background: var(--color-tan);
	}

	/* Fullscreen dialog — mirrors ChartContainer.svelte's behavior. */
	.fullscreen-dialog {
		border: none;
		padding: 0;
		background: transparent;
		max-width: none;
		max-height: none;
		width: 100vw;
		height: 100vh;
		outline: none;
	}

	.fullscreen-dialog:not([open]) {
		display: none;
	}

	.fullscreen-dialog[open] {
		display: flex;
		align-items: center;
		justify-content: center;
		animation: dialogFadeIn 0.2s ease-out;
	}

	.fullscreen-dialog[open] .dialog-content {
		animation: dialogZoomIn 0.2s ease-out;
	}

	.fullscreen-dialog[open]::backdrop {
		animation: backdropFadeIn 0.2s ease-out;
	}

	.fullscreen-dialog.closing {
		animation: dialogFadeOut 0.2s ease-in forwards;
	}

	.fullscreen-dialog.closing .dialog-content {
		animation: dialogZoomOut 0.2s ease-in forwards;
	}

	.fullscreen-dialog.closing::backdrop {
		animation: backdropFadeOut 0.2s ease-in forwards;
	}

	@keyframes dialogFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes dialogFadeOut {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	@keyframes dialogZoomIn {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	@keyframes dialogZoomOut {
		from {
			opacity: 1;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(0.95);
		}
	}

	@keyframes backdropFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes backdropFadeOut {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	.fullscreen-dialog::backdrop {
		background: rgba(0, 0, 0, 0.8);
	}

	.dialog-content {
		position: relative;
		width: 95vw;
		height: 90vh;
		max-width: 95vw;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
	}
</style>
