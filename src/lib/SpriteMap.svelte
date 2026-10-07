<script lang="ts">
	import { onMount } from "svelte";
	import { Deck, OrthographicView } from "@deck.gl/core";
	import { IconLayer, PathLayer, PolygonLayer } from "@deck.gl/layers";
	import type { MapTile } from "$lib/types/MapTile";
	import type { CityInfo } from "$lib/types/CityInfo";
	import type { PlayerNationEntry } from "$lib/parser/types";
	import { getCivilizationColor, getMutedTerrainColor } from "$lib/config";
	import {
		ATLAS_MANIFEST,
		NATION_ALIASES_URL,
	} from "$lib/generated/atlas-manifest";
	import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
	import { familyCrestKey, familyForOwner } from "$lib/game-detail/helpers";
	import { hexNeighbors } from "$lib/utils/hex";
	import MapTooltip from "$lib/MapTooltip.svelte";
	import MapCityBanners, { type CityBanner } from "$lib/MapCityBanners.svelte";
	import { formatEnum } from "$lib/utils/formatting";

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
	// docs/archive/section-3.4-content-hashing.html.
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

	// The nation whose architecture a tile renders in. The game styles a city by
	// its FOUNDING nation regardless of later captures — and keeps that style
	// even while the city is unowned mid-capture (owner_nation === null on every
	// tile). So resolve the founder nation for the tile's city; fall back to the
	// tile's current owner when the founder is unknown (pre-2.6.0 blob with no
	// first_owner_player_xml_id, which leaves founderByCity empty).
	function renderNationFor(
		tile: MapTile,
		founderByCity: Map<string, string | null>,
	): string | null {
		if (tile.owner_city) {
			const founder = founderByCity.get(tile.owner_city);
			if (founder) return founder;
		}
		return tile.owner_nation;
	}

	// Returns the urban family whose composite atlas covers (tile.improvement,
	// owner_nation), or null. Used both to filter tiles into per-family
	// composite IconLayers AND to decide whether the urban-empty / base /
	// fallback layers should suppress drawing on this tile (composite wins).
	function compositeFamilyFor(
		tile: MapTile,
		aliases: Map<string, NationAliasEntry>,
		familyManifests: Record<string, AtlasManifest>,
		founderByCity: Map<string, string | null>,
	): string | null {
		const nation = renderNationFor(tile, founderByCity);
		if (!tile.improvement || !nation) return null;
		const family = urbanFamilyFor(nation, aliases);
		if (!family) return null;
		const fm = familyManifests[family];
		return fm?.sprites[tile.improvement] ? family : null;
	}

	// Returns the CAPITAL_<family> sprite key from improvements-base for a
	// city-centre tile, or null if the tile isn't a centre or the resolved
	// family has no city render. The key is named for nation.xml's
	// <CapitalAsset>, but that asset is the city's head tile rather than the
	// nation's capital: 32 of the 33 nation entries declaring either tag give
	// <CityAsset> the same ASSET_VARIATION_CITY_<FAMILY>_CAPITAL value, and
	// Tile.getUrbanAsset (Tile.cs:13105) hands back the urban asset only when
	// the tile is NOT a revealed city. So every city centre draws it, and the
	// capital is marked by the banner's star instead. (NATION_HYKSOS is the
	// lone split — EGYPT capital, CARTHAGE cities — which the alias bake's
	// urban+capital pair can't express; its centres all render CARTHAGE.)
	// City sprites include their own ground patch (pinacotheca 2.2.0+), so no
	// URBAN underlay is drawn beneath them.
	function cityCenterSpriteKeyFor(
		tile: MapTile,
		aliases: Map<string, NationAliasEntry>,
		baseManifest: AtlasManifest,
		founderByCity: Map<string, string | null>,
	): string | null {
		const nation = renderNationFor(tile, founderByCity);
		if (!tile.is_city_center || !nation) return null;
		const cf = capitalFamilyFor(nation, aliases);
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
		founderByCity: Map<string, string | null>,
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
			const family = urbanFamilyFor(
				renderNationFor(tile, founderByCity),
				aliases,
			);
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
		founderByCity: Map<string, string | null>,
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
			const family = urbanFamilyFor(
				renderNationFor(tile, founderByCity),
				aliases,
			);
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
		playerNations = [],
		showPolitical = true,
		showReligion = false,
		isFinalTurn,
		onCityClick,
	}: {
		tiles: MapTile[];
		// Used to resolve owner_city → family for the tooltip's family crest.
		// Empty array is fine — tooltip just omits the family crest.
		cities?: CityInfo[];
		// player_xml_id → nation, used to resolve each city's founding nation
		// (CityInfo.first_owner_player_xml_id) for architecture rendering. Empty
		// is fine — rendering then falls back to the tile's current owner_nation.
		playerNations?: PlayerNationEntry[];
		// Layer visibility. The toggles live in the map view's chrome.
		showPolitical?: boolean;
		showReligion?: boolean;
		// Whether `tiles` is the final turn. CityInfo.citizens is an
		// end-of-game count, so the banners carry it only then.
		isFinalTurn: boolean;
		// A banner was clicked: the city, and the banner element the city
		// popover anchors to.
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onCityClick: (cityName: string, element: HTMLElement) => void;
	} = $props();

	// city_name → the player owning the city's centre tile at the represented
	// turn, read from the (per-turn reconstructed) tiles. Lets the family crest
	// track ownership as the turn slider moves. A missing entry means "no
	// per-turn owner resolvable" (old blobs without owner_player_xml_id, or the
	// legacy final-state render) — the crest resolver then falls back to the
	// city's current family.
	const cityCenterOwnerByTurn = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const map = new Map<string, number | null>();
		for (const t of tiles) {
			if (t.is_city_center && t.owner_city) {
				map.set(t.owner_city, t.owner_player_xml_id ?? null);
			}
		}
		return map;
	});

	// city_name → resolved crest sprite key (or null when no crest is
	// renderable), via the shared familyCrestKey rule (per-family crest when
	// we ship the art, else the family-class archetype crest).
	//
	// The family is resolved (via familyForOwner) for whoever owns the city at
	// the represented turn, so a captured city shows its founder's family for
	// turns before the capture. Recomputed when the cities prop or the
	// per-turn tiles change.
	const cityFamilyCrestByName = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const map = new Map<string, string | null>();
		for (const c of cities) {
			const { family, familyClass } = familyForOwner(
				c,
				cityCenterOwnerByTurn.get(c.city_name),
			);
			map.set(c.city_name, familyCrestKey(family, familyClass));
		}
		return map;
	});

	// city_name → founding nation, the nation whose architecture the city renders
	// in (see renderNationFor). Resolves each city's first_owner_player_xml_id
	// through the player_nations sidecar. Empty when player_nations is absent,
	// so callers fall back to owner_nation.
	const cityFounderNationByName = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const map = new Map<string, string | null>();
		if (playerNations.length === 0) return map;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const nationByPlayer = new Map<number, string | null>();
		for (const p of playerNations) {
			nationByPlayer.set(p.player_xml_id, p.nation);
		}
		for (const c of cities) {
			const founder =
				c.first_owner_player_xml_id != null
					? (nationByPlayer.get(c.first_owner_player_xml_id) ?? null)
					: null;
			map.set(c.city_name, founder);
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

	// ─── Tooltip state ────────────────────────────────────────────────
	// Hover position is in canvas-local CSS pixels (deck.gl onHover already
	// converts).
	interface HoverState {
		tile: MapTile;
		x: number;
		y: number;
	}
	let hoverState = $state<HoverState | null>(null);

	// What the panel renders: the hovered tile re-read from the live `tiles`
	// array, not the object the hover handed over. A turn change rebuilds every
	// tile object (`reconstructMapTiles` projects the final-turn snapshot into
	// a fresh array), and playback steps the turn every 300ms — 150ms on fast
	// — under a stationary cursor, so a held object would keep naming the turn
	// it was raised at. The camera can't have moved — that clears `hoverState`
	// outright — so the hover's screen position still points at this
	// coordinate. A coordinate the new array has no entry for, which is a
	// navigation to a game with a different map size, drops the panel, as the
	// city popover closes at a turn its city has no banner at.
	const hoverPanel = $derived.by(() => {
		const hover = hoverState;
		if (!hover) return null;
		const tile = tiles.find(
			(t) => t.x === hover.tile.x && t.y === hover.tile.y,
		);
		return tile ? { tile, x: hover.x, y: hover.y } : null;
	});

	// The box both overlays work in, in canvas-local CSS pixels: the hover
	// panel clamps to its edges, and the city banners project into it. It is
	// the CANVAS's size and not the container's — deck.gl pins
	// `canvas.style.width`/`height` to the numbers the Deck is constructed
	// with (`_setCanvasSize`), so the canvas keeps the size it had at init
	// however the container is resized afterwards. A banner placed against the
	// container's size slides off its tile by half the difference.
	let deckWidth = $state(0);
	let deckHeight = $state(0);

	// Camera-control state. Tracked here so the overlay zoom buttons can read
	// the current zoom and pan target and feed adjusted values back into the
	// Deck via setProps.
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

	// One banner per city-centre tile that is OWNED at the represented turn,
	// joined to CityInfo by name. Taking the per-turn tiles as the source of
	// truth has two consequences, both measured across the 122 local blobs and
	// both matching what the sprites already do (reconstructMapTiles nulls
	// `improvement` on an unowned tile):
	//   - a banner appears one turn AFTER founded_turn — the centre tile's
	//     first ownership row lands at founded_turn + 1 in 3,601 of the 3,604
	//     cities (2 at +0, 1 at −3);
	//   - a city sitting unowned mid-capture has no banner until the capture
	//     resolves. 573 cities, in 96 of the 122 games, have a capture or an
	//     unowned span.
	const cityBanners = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const byName = new Map<string, CityInfo>();
		// Duplicate city names across players are rare in OW; first match wins,
		// as reconstructMapTiles does on the same join.
		for (const c of cities) {
			if (!byName.has(c.city_name)) byName.set(c.city_name, c);
		}
		const out: CityBanner[] = [];
		for (const t of tiles) {
			if (!t.is_city_center || !t.owner_city) continue;
			const [worldX, worldY] = hexToPixel(t.x, t.y);
			out.push({
				cityName: t.owner_city,
				label: formatEnum(t.owner_city, "CITYNAME_"),
				tile: t,
				worldX,
				worldY,
				// Resolved as MapTooltip resolves it, so a tile's hover colour
				// and its banner agree.
				nationColor: t.owner_nation
					? (getCivilizationColor(t.owner_nation) ?? "rgb(var(--color-tan))")
					: "rgb(var(--color-tan))",
				nationCrestKey: resolveNationCrestKey(t.owner_nation),
				familyCrestKey: cityFamilyCrestByName.get(t.owner_city) ?? null,
				isCapital: t.is_capital,
				citizens: isFinalTurn
					? (byName.get(t.owner_city)?.citizens ?? null)
					: null,
			});
		}
		return out;
	});

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

	async function loadManifest(name: string): Promise<AtlasManifest> {
		const entry = ATLAS_MANIFEST[name];
		if (!entry) throw new Error(`unknown atlas: ${name}`);
		const response = await fetch(entry.json);
		// A 404 (e.g. a content-hash that never reached the deployed assets)
		// returns the SPA fallback HTML, not JSON. Surface it as a clear error
		// instead of letting response.json() throw a confusing parse error.
		if (!response.ok) {
			throw new Error(
				`atlas "${name}" (${entry.json}) → HTTP ${response.status}`,
			);
		}
		return (await response.json()) as AtlasManifest;
	}

	interface NationBorder {
		path: [number, number][];
		color: [number, number, number, number];
		width: number;
	}

	// Callback shapes for buildTerritoryOutline: which group a tile belongs to,
	// and the stroke colour for a group (null drops it). The param-name labels
	// trip the base no-unused-vars rule (it runs on .svelte files and mis-reads
	// TS type-annotation labels as bindings), so scope-disable it here.
	/* eslint-disable no-unused-vars */
	type TerritoryKeyFn = (tile: MapTile) => string | null;
	type TerritoryColorFn = (
		key: string,
	) => [number, number, number, number] | null;
	/* eslint-enable no-unused-vars */

	interface PoliticalData {
		borders: NationBorder[];
		subBorders: NationBorder[];
		contestedBorders: NationBorder[];
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
	// Cities not held by a playing nation (being captured, or in revolt/anarchy)
	// resolve to owner_nation === null, which is why their urban tiles fall back
	// to the generic sprite. We outline such a city's territory matching the
	// in-game "border turns black while capturing" treatment — kept thin and
	// very translucent (more so than the rivers) so it's a faint marker, and
	// tinted toward the in-game rebel red (#c84732 darkened toward black) to hint
	// at the contested/revolt state rather than drawing a hard black line.
	const CONTESTED_BORDER_COLOR: [number, number, number, number] = [
		56, 20, 14, 100,
	];
	const CONTESTED_BORDER_WIDTH = 2;

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

	// Build inset, smoothed territory outlines for tiles grouped by `keyOf`.
	// A tile joins the group `keyOf(tile)` (or is skipped when that returns
	// null). Each group's outer boundary is inset toward the group's centroid
	// at every vertex — so adjacent same-group tiles share inset corners and
	// their boundary edges chain into closed loops — then Chaikin-smoothed.
	// Used for both nation borders (keyed on owner_nation) and contested-city
	// borders (keyed on owner_city); `colorFor` returns the stroke colour for a
	// group, or null to drop it.
	function buildTerritoryOutline(opts: {
		mapTiles: MapTile[];
		tileMap: Map<string, MapTile>;
		vertexMap: Map<string, MapTile[]>;
		keyOf: TerritoryKeyFn;
		colorFor: TerritoryColorFn;
		width: number;
	}): NationBorder[] {
		const { mapTiles, tileMap, vertexMap, keyOf, colorFor, width } = opts;

		interface BoundaryEdge {
			source: [number, number];
			target: [number, number];
			sourceKey: string;
			targetKey: string;
		}

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const edgesByGroup = new Map<string, BoundaryEdge[]>();
		for (const tile of mapTiles) {
			const key = keyOf(tile);
			if (key == null) continue;

			const [cx, cy] = hexToPixel(tile.x, tile.y);
			const verts = hexPolygon(cx, cy);
			const neighbors = hexNeighbors(tile.x, tile.y);

			// Inset each of this tile's 6 vertices toward the centroid of
			// same-group tiles meeting there, so adjacent tiles converge on the
			// same inset position at shared corners and chain cleanly.
			const insetPos: [number, number][] = [];
			for (let i = 0; i < 6; i++) {
				const v = verts[i];
				const meetingTiles = vertexMap.get(vertexKey(v)) ?? [tile];
				let sumX = 0;
				let sumY = 0;
				let count = 0;
				for (const t of meetingTiles) {
					if (keyOf(t) !== key) continue;
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
				if (neighbor && keyOf(neighbor) === key) continue;
				const src = insetPos[i];
				const dst = insetPos[(i + 1) % 6];
				const edge: BoundaryEdge = {
					source: src,
					target: dst,
					sourceKey: vertexKey(src),
					targetKey: vertexKey(dst),
				};
				const list = edgesByGroup.get(key);
				if (list) list.push(edge);
				else edgesByGroup.set(key, [edge]);
			}
		}

		// Chain each group's boundary edges into closed paths (one per island).
		// Walks the directed-edge graph; each boundary vertex has exactly one
		// in-edge and one out-edge per island, so the chain is unambiguous.
		const out: NationBorder[] = [];
		for (const [key, edges] of edgesByGroup) {
			const color = colorFor(key);
			if (!color) continue;

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
				out.push({ path: [...smoothed, smoothed[0]], color, width });
			}
		}
		return out;
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

		interface SubBorderEdge {
			a: [number, number];
			b: [number, number];
			aKey: string;
			bKey: string;
		}

		// Nation territory borders, keyed on owner_nation and coloured by the
		// nation's civ colour. Nations without a known colour are skipped.
		const borders = buildTerritoryOutline({
			mapTiles,
			tileMap,
			vertexMap,
			keyOf: (t) =>
				t.owner_nation && getCivilizationColor(t.owner_nation)
					? t.owner_nation
					: null,
			colorFor: (key) => {
				const rgb = hexToRgb(getCivilizationColor(key)!);
				return [rgb[0], rgb[1], rgb[2], 255];
			},
			width: NATION_BORDER_WIDTH,
		});

		// Contested-city borders: a city whose centre tile is owner_nation === null
		// (being captured, or in revolt/anarchy — the same condition that makes its
		// urban tiles fall back to the generic sprite). Outline that city's
		// null-owned tiles, keyed on owner_city, in solid black.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Set used locally in function, not as reactive state
		const contestedCities = new Set<string>();
		for (const t of mapTiles) {
			if (t.is_city_center && !t.owner_nation && t.owner_city)
				contestedCities.add(t.owner_city);
		}
		const contestedBorders = buildTerritoryOutline({
			mapTiles,
			tileMap,
			vertexMap,
			keyOf: (t) =>
				!t.owner_nation && t.owner_city && contestedCities.has(t.owner_city)
					? t.owner_city
					: null,
			colorFor: () => CONTESTED_BORDER_COLOR,
			width: CONTESTED_BORDER_WIDTH,
		});

		// Sub-borders: boundaries between two different cities within the same
		// nation. Collected as undirected edges on the actual hex edge (no inset)
		// so they sit between the two cities, like the in-game style. The (x,y)
		// tie-break collects each shared edge from only one of the two tiles.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const subEdgesByNation = new Map<string, SubBorderEdge[]>();
		for (const tile of mapTiles) {
			if (!tile.owner_nation || !getCivilizationColor(tile.owner_nation))
				continue;
			const nationKey = tile.owner_nation;
			const [cx, cy] = hexToPixel(tile.x, tile.y);
			const verts = hexPolygon(cx, cy);
			const neighbors = hexNeighbors(tile.x, tile.y);
			for (let i = 0; i < 6; i++) {
				const [nx, ny] = neighbors[i];
				const neighbor = tileMap.get(`${nx},${ny}`);
				if (
					neighbor &&
					neighbor.owner_nation === nationKey &&
					tile.owner_city &&
					neighbor.owner_city &&
					neighbor.owner_city !== tile.owner_city &&
					(tile.x < nx || (tile.x === nx && tile.y < ny))
				) {
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

		// Chain sub-border edges per nation. Sub-borders are undirected and can
		// branch at multi-city junctions (3+ cities meeting at one vertex), so the
		// walk from a starting edge proceeds in BOTH directions and stops as soon
		// as a vertex has anything other than exactly one unvisited neighbor —
		// either a branch point or a terminal.
		const subBorders: NationBorder[] = [];
		for (const [nationKey, subEdges] of subEdgesByNation) {
			const colorHex = getCivilizationColor(nationKey);
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

		return { borders, subBorders, contestedBorders };
	}

	function computeReligionFills(mapTiles: MapTile[]): ReligionFill[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const tileMap = new Map<string, MapTile>();
		for (const t of mapTiles) tileMap.set(`${t.x},${t.y}`, t);

		const fills: ReligionFill[] = [];
		for (const tile of mapTiles) {
			const founder = tile.religions[0]?.founder_nation;
			if (!founder) continue;
			const colorHex = getCivilizationColor(founder);
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

	interface RiverSegment {
		path: [number, number][];
	}

	// Rivers run along hex edges. Each tile flags only its W/SW/SE edges
	// (river_w/river_sw/river_se); the matching NE/E/NW edges belong to the
	// neighbour's W/SW/SE flags, so iterating every tile's three flags yields
	// each river edge exactly once — no dedup needed. The flag → edge-index
	// mapping follows hexPolygon's convention (edge i connects verts[i] →
	// verts[i+1] and faces neighbour i, where neighbours = [NE, E, SE, SW, W,
	// NW]): river_se = edge 2, river_sw = edge 3, river_w = edge 4.
	//
	// Colour reuses the muted water tone (the same de-emphasised blue used for
	// unclaimed water tiles) at low alpha, so rivers stay subtle against the
	// terrain rather than reading as an opaque UI line; width/hue may be tuned.
	const RIVER_COLOR_RGBA: [number, number, number, number] = [
		...hexToRgb(getMutedTerrainColor("TERRAIN_COAST", null, null)),
		170,
	];
	const RIVER_WIDTH = 2;
	const RIVER_SMOOTH_ITERATIONS = 3;

	function computeRivers(mapTiles: MapTile[]): RiverSegment[] {
		interface RiverEdge {
			a: [number, number];
			b: [number, number];
			aKey: string;
			bKey: string;
		}

		// Collect every flagged river edge as an undirected segment.
		const edges: RiverEdge[] = [];
		for (const tile of mapTiles) {
			if (!tile.river_se && !tile.river_sw && !tile.river_w) continue;
			const [cx, cy] = hexToPixel(tile.x, tile.y);
			const verts = hexPolygon(cx, cy);
			const add = (a: [number, number], b: [number, number]) =>
				edges.push({ a, b, aKey: vertexKey(a), bKey: vertexKey(b) });
			if (tile.river_se) add(verts[2], verts[3]);
			if (tile.river_sw) add(verts[3], verts[4]);
			if (tile.river_w) add(verts[4], verts[5]);
		}

		// Chain edges into polylines and Chaikin-smooth so they read as flowing
		// waterways rather than angular hex fragments. Same branch-aware
		// undirected walk as the city sub-borders: from each unvisited edge,
		// walk both directions and stop at any vertex that isn't exactly one
		// unvisited neighbour (a junction where rivers meet, or a terminal).
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const adj = new Map<string, RiverEdge[]>();
		for (const e of edges) {
			const aList = adj.get(e.aKey);
			if (aList) aList.push(e);
			else adj.set(e.aKey, [e]);
			const bList = adj.get(e.bKey);
			if (bList) bList.push(e);
			else adj.set(e.bKey, [e]);
		}

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Set used locally in function, not as reactive state
		const visited = new Set<RiverEdge>();
		const segments: RiverSegment[] = [];
		for (const start of edges) {
			if (visited.has(start)) continue;
			visited.add(start);

			const walk = (
				fromKey: string,
			): { edges: RiverEdge[]; endKey: string } => {
				const out: RiverEdge[] = [];
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

			// Assemble the ordered vertex list: backward edges in reverse, then
			// the start edge, then forward edges, tracking the previous vertex
			// key to know which endpoint to append next.
			const path: [number, number][] = [];
			let prevKey: string;
			if (backward.edges.length > 0) {
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
						? chaikinSmoothClosed(unique, RIVER_SMOOTH_ITERATIONS)
						: unique;
				smoothed.push(smoothed[0]);
			} else if (path.length >= 3) {
				smoothed = chaikinSmoothOpen(path, RIVER_SMOOTH_ITERATIONS);
			} else {
				smoothed = path;
			}

			segments.push({ path: smoothed });
		}

		return segments;
	}

	// Memoized derivatives — recomputed only when `tiles` change, not on
	// layer-toggle flips. The console.time blocks are DEV-only so we can
	// profile during turn-slider scrubbing without shipping log spam.
	const politicalData = $derived.by<PoliticalData>(() => {
		if (tiles.length === 0)
			return { borders: [], subBorders: [], contestedBorders: [] };
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
	const rivers = $derived.by<RiverSegment[]>(() => {
		if (tiles.length === 0) return [];
		if (import.meta.env.DEV) console.time("computeRivers");
		const result = computeRivers(tiles);
		if (import.meta.env.DEV) console.timeEnd("computeRivers");
		return result;
	});

	/**
	 * Calculate initial view state to fit the map in the canvas.
	 */
	function calculateViewState() {
		if (!deckCanvas || tiles.length === 0) {
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
		const canvasWidth = deckCanvas.clientWidth;
		const canvasHeight = deckCanvas.clientHeight;
		const zoomX = Math.log2(canvasWidth / mapWidth);
		const zoomY = Math.log2(canvasHeight / mapHeight);
		const zoom = Math.min(zoomX, zoomY);

		return { target: [centerX, centerY, 0] as [number, number, number], zoom };
	}

	// Programmatic camera control for the overlay zoom buttons. deck.gl
	// re-applies initialViewState when a new object reference is passed via
	// setProps, which jumps the camera without disturbing the controller's
	// drag/wheel handling.
	function applyViewState(next: ViewState) {
		if (!deck) return;
		deck.setProps({
			initialViewState: { ...next, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM },
		});
		currentViewState = next;
		// Going around the controller goes around `onViewStateChange` too —
		// `Deck.setProps` assigns `initialViewState` straight to its tracked
		// view state and raises nothing — so this path drops the tile panel
		// itself. Reachable with a panel up: a banner raises one on focus, and
		// shift-tab from it reaches these buttons. See `onViewStateChange`.
		hoverState = null;
	}

	function adjustZoom(delta: number) {
		const cur = currentViewState;
		if (!cur) return;
		const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cur.zoom + delta));
		if (newZoom === cur.zoom) return;
		applyViewState({ ...cur, zoom: newZoom });
	}

	function initDeck() {
		if (!deckCanvas || !assetsLoaded) return;

		const width = deckCanvas.clientWidth;
		const canvasHeight = deckCanvas.clientHeight;
		if (width === 0 || canvasHeight === 0) return;

		deckWidth = width;
		deckHeight = canvasHeight;

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
			// A camera move drops the tile panel, because nothing re-resolves
			// its screen position while the map moves: deck.gl re-picks hover
			// only off a pointer move (`Deck._pickAndCallback` runs the request
			// `_onPointerMove` leaves behind, and that bails outright while a
			// button is held). So a pan left the panel frozen at the pixel the
			// drag began from, naming a tile that had slid out from under it,
			// and a wheel zoom — the primary way to zoom here — left it sitting
			// over a map rescaling beneath it. deck raises this for every
			// camera path its controller owns — drag-pan, wheel and pinch zoom,
			// double-click zoom, the keyboard controls — so one rule covers
			// them all; the overlay zoom buttons bypass the controller and
			// clear the panel in `applyViewState` instead. The next hover puts
			// it back.
			onViewStateChange: ({ viewState: vs }) => {
				currentViewState = normalizeViewState(vs);
				hoverState = null;
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
	// family atlas is loaded. Reads `tiles`, `nationAliases`, and the founder
	// map; mutates `familyManifests` (which the layers effect tracks separately).
	// Doesn't re-trigger on its own writes since it doesn't read familyManifests.
	// Keys on the founding nation (see renderNationFor) so a captured/contested
	// city's founder family atlas is fetched even when no playing nation uses it.
	$effect(() => {
		if (nationAliases.size === 0) return;
		const al = nationAliases;
		const founderByCity = cityFounderNationByName;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Set, not reactive state
		const needed = new Set<string>();
		for (const tile of tiles) {
			const nation = renderNationFor(tile, founderByCity);
			if (!nation) continue;
			const family = al.get(nation)?.urban;
			if (family) needed.add(family);
		}
		for (const f of needed) {
			ensureFamilyAtlas(f);
		}
	});

	// Build the full layer set for the Deck.
	function buildLayers() {
		const t3d = terrain3dManifest;
		const ibm = improvementsBaseManifest;
		const rm = resourcesManifest;
		const al = nationAliases;
		const fms = familyManifests;
		const founderByCity = cityFounderNationByName;
		// terrain + improvements are the structural base — without them there is
		// no meaningful map. resources is a separate, decorative atlas: if it
		// failed to load (rm == null) the resource-icons layer below is simply
		// omitted rather than blanking the whole map.
		if (!t3d || !ibm) return null;
		const political = politicalData;
		const fills = religionFills;
		const riv = rivers;
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
				data: tiles.filter(
					(t) => compositeFamilyFor(t, al, fms, founderByCity) === family,
				),
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
				data: tiles.filter(
					(t) => terrain3dBaseKey(t, al, t3d, founderByCity) != null,
				),
				iconAtlas: TERRAIN_3D_ATLAS_URL,
				iconMapping: t3d.sprites,
				getIcon: (d: MapTile) =>
					terrain3dBaseKey(d, al, t3d, founderByCity) as string,
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
				data: tiles.filter(
					(t) => terrain3dReliefKey(t, al, t3d, founderByCity) != null,
				),
				iconAtlas: TERRAIN_3D_ATLAS_URL,
				iconMapping: t3d.sprites,
				getIcon: (d: MapTile) =>
					terrain3dReliefKey(d, al, t3d, founderByCity) as string,
				getPosition: (d: MapTile) => hexToPixel(d.x, d.y),
				getSize: () => t3d.cellWidth,
				sizeUnits: "common",
				sizeBasis: "width",
				pickable: false,
			}),
			// Per-nation tile render — the nation's city for a city centre,
			// its urban backdrop everywhere else. Both come from
			// improvements-base, both fully cover the inscribed hex, and
			// neither is ever overdrawn by a composite: of the 3,662 centre
			// tiles in the local corpus 3,660 carry no improvement and 2 carry
			// IMPROVEMENT_MINOR_CITY, which no family atlas renders, while
			// urban-empty tiles already filter out composite-covered ones.
			new IconLayer<MapTile>({
				id: "nation-tile-icons",
				data: tiles.filter((t) => {
					const city = cityCenterSpriteKeyFor(t, al, ibm, founderByCity);
					if (city != null) return true;
					if (t.terrain !== "TERRAIN_URBAN") return false;
					const family = urbanFamilyFor(renderNationFor(t, founderByCity), al);
					if (family == null) return false;
					if (compositeFamilyFor(t, al, fms, founderByCity) != null)
						return false;
					return ibm.sprites[`URBAN_${family}`] != null;
				}),
				iconAtlas: IMPROVEMENTS_BASE_ATLAS_URL,
				iconMapping: ibm.sprites,
				getIcon: (d: MapTile) => {
					const city = cityCenterSpriteKeyFor(d, al, ibm, founderByCity);
					if (city != null) return city;
					return `URBAN_${urbanFamilyFor(renderNationFor(d, founderByCity), al)}`;
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
			// Conditional: the resources atlas loads independently of terrain and
			// improvements. If it failed (rm == null) this layer is dropped and
			// the rest of the map still renders. See settleAtlas above.
			...(rm
				? [
						new IconLayer<MapTile>({
							id: "resource-icons",
							data: tiles.filter((t) => {
								if (resourceSpriteKeyFor(t, rm) == null) return false;
								if (
									t.terrain === "TERRAIN_URBAN" &&
									urbanFamilyFor(renderNationFor(t, founderByCity), al) != null
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
					]
				: []),
			// Single-improvement renders (rural, ruins, settlements,
			// non-urban-buildable wonders). Synthesizes a __FALLBACK__
			// icon for zTypes the base manifest doesn't know — typically
			// mod content not vendored into Reference/XML — by extending
			// the iconMapping with the manifest's fallbackSprite cell.
			// Excludes tiles already covered by a composite layer or by
			// the nation-tile layer (city centres).
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
					if (cityCenterSpriteKeyFor(t, al, ibm, founderByCity) != null)
						return false;
					if (compositeFamilyFor(t, al, fms, founderByCity) != null)
						return false;
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
			// Rivers sit on tile edges, above terrain/improvements but below the
			// political/religion overlays. Rounded joints/caps let the per-edge
			// segments read as continuous waterways where they share vertices.
			new PathLayer<RiverSegment>({
				id: "rivers",
				data: riv,
				getPath: (d: RiverSegment) => d.path,
				getColor: RIVER_COLOR_RGBA,
				getWidth: RIVER_WIDTH,
				widthUnits: "pixels",
				widthMinPixels: 1,
				jointRounded: true,
				capRounded: true,
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
			// Contested (being-captured / in-revolt) city outlines, in black.
			// Always visible — they flag a city in flux regardless of the political
			// overlay toggle, matching the in-game black capture border.
			new PathLayer<NationBorder>({
				id: "contested-city-borders",
				data: political.contestedBorders,
				getPath: (d: NationBorder) => d.path,
				getColor: (d: NationBorder) => d.color,
				getWidth: (d: NationBorder) => d.width,
				widthUnits: "pixels",
				widthMinPixels: 1,
				jointRounded: true,
				capRounded: true,
				pickable: false,
			}),
			// Invisible pickable layer so hover resolves to the
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
		if (!targetDeck) return;
		if (!assetsLoaded) return;

		// Touch all reactive deps that buildLayers reads, so the effect
		// re-runs when any of them change.
		void terrain3dManifest;
		void improvementsBaseManifest;
		void resourcesManifest;
		void nationAliases;
		void familyManifests;
		void tiles;
		void politicalData;
		void religionFills;
		void rivers;
		void showPolitical;
		void showReligion;

		const layers = buildLayers();
		if (layers) targetDeck.setProps({ layers });
	});

	async function loadNationAliases(): Promise<Map<string, NationAliasEntry>> {
		const response = await fetch(NATION_ALIASES_URL);
		if (!response.ok) {
			throw new Error(
				`nation aliases (${NATION_ALIASES_URL}) → HTTP ${response.status}`,
			);
		}
		const payload = (await response.json()) as NationAliasPayload;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- assigned to $state Map below
		const map = new Map<string, NationAliasEntry>();
		for (const [nation, entry] of Object.entries(payload.aliases)) {
			map.set(nation, entry);
		}
		return map;
	}

	// Unwrap one settled atlas load: keep the value on success, log and fall
	// back to null on failure so a single stale/missing atlas doesn't reject
	// the whole batch. The caller decides which failures are fatal (structural
	// atlases block render) vs. tolerable (the decorative resources atlas).
	function settleAtlas<T>(
		result: PromiseSettledResult<T>,
		label: string,
	): T | null {
		if (result.status === "fulfilled") return result.value;
		console.error(`Failed to load ${label}:`, result.reason);
		return null;
	}

	onMount(() => {
		// Load each atlas independently so one stale/missing manifest doesn't
		// reject the whole batch (see the resource-icons incident). terrain,
		// improvements, and nation-aliases are STRUCTURAL — without terrain or
		// improvements there is no map, and without aliases every city/capital
		// silently vanishes — so render is gated on all three loading. resources
		// is DECORATIVE: if it fails, only its own layer is dropped (see
		// buildLayers) and the rest of the map still renders. The deploy-time
		// preflight (assets.atlas/assets.sprites) is the first line of defense
		// against a manifest that references un-shipped hashes; this is the
		// runtime net.
		void Promise.allSettled([
			loadManifest("terrain-3d"),
			loadManifest("improvements-base"),
			loadManifest("resources"),
			loadNationAliases(),
		]).then(([terrain3d, improvementsBase, resources, aliases]) => {
			terrain3dManifest = settleAtlas(terrain3d, "terrain-3d atlas");
			improvementsBaseManifest = settleAtlas(
				improvementsBase,
				"improvements-base atlas",
			);
			resourcesManifest = settleAtlas(resources, "resources atlas");
			const al = settleAtlas(aliases, "nation aliases");
			if (al) nationAliases = al;
			// Gate render on the structural atlases. If any failed, leave
			// assetsLoaded false so initDeck never builds a deck — an empty,
			// inert canvas rather than a pannable map that's blank or missing
			// every city with no signal that anything is wrong.
			assetsLoaded =
				terrain3dManifest != null &&
				improvementsBaseManifest != null &&
				al != null;
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

{#snippet zoomControls()}
	{@const zoom = currentViewState?.zoom ?? 0}
	<div class="zoom-controls">
		<button
			type="button"
			class="zoom-btn"
			onclick={() => adjustZoom(ZOOM_STEP)}
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
			onclick={() => adjustZoom(-ZOOM_STEP)}
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
	</div>
{/snippet}

<div class="sprite-map-container">
	<canvas bind:this={deckCanvas} class="sprite-map-canvas"></canvas>

	{@render zoomControls()}

	{#if currentViewState}
		<MapCityBanners
			banners={cityBanners}
			viewState={currentViewState}
			canvasWidth={deckWidth}
			canvasHeight={deckHeight}
			onBannerHover={(tile, x, y) => (hoverState = { tile, x, y })}
			onBannerClick={onCityClick}
		/>
	{/if}

	{#if hoverPanel}
		<MapTooltip
			tile={hoverPanel.tile}
			cityFamily={hoverPanel.tile.owner_city
				? (cityFamilyCrestByName.get(hoverPanel.tile.owner_city) ?? null)
				: null}
			nationCrestKey={resolveNationCrestKey(hoverPanel.tile.owner_nation)}
			screenX={hoverPanel.x}
			screenY={hoverPanel.y}
			canvasWidth={deckWidth}
			canvasHeight={deckHeight}
		/>
	{/if}
</div>

<style>
	.sprite-map-container {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background-color: rgb(var(--color-surface-deep));
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
		background-color: rgb(var(--color-black) / 0.5);
		color: rgb(var(--color-white));
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.zoom-btn:hover:not(:disabled) {
		background-color: rgb(var(--color-black) / 0.75);
	}

	.zoom-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
