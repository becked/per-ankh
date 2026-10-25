<script lang="ts">
	import { onMount } from "svelte";
	import { Deck, OrthographicView } from "@deck.gl/core";
	import {
		IconLayer,
		PathLayer,
		PolygonLayer,
		ScatterplotLayer,
	} from "@deck.gl/layers";
	import type { MapTile } from "$lib/types/MapTile";
	import type { CityInfo } from "$lib/types/CityInfo";
	import type { PlayerNationEntry } from "$lib/parser/types";
	import {
		UNOWNED_CITY_BORDER_COLOR,
		getCivilizationColor,
		getMutedTerrainColor,
		getTribeColor,
	} from "$lib/config";
	import {
		ATLAS_MANIFEST,
		NATION_ALIASES_URL,
	} from "$lib/generated/atlas-manifest";
	import {
		CREST_SPRITE_NAMES,
		TRIBE_CRESTS,
	} from "$lib/generated/crest-sprites";
	import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
	import { familyCrestKey, familyForOwner } from "$lib/game-detail/helpers";
	import { hexNeighbors } from "$lib/utils/hex";
	import { circularPng } from "$lib/utils/circular-image";
	import MapTooltip from "$lib/MapTooltip.svelte";
	import MapCityBanners, {
		bannerFoot,
		type CityBanner,
	} from "$lib/MapCityBanners.svelte";
	import MapPinMarkers from "$lib/MapPinMarkers.svelte";
	import { pinsOnTile, type MapPin } from "$lib/game-detail/map-pins";
	import {
		projectToCanvas,
		type TileCoord,
		type UnitMarker,
		type ViewState,
	} from "$lib/game-detail/map-chrome";
	import { formatEnum } from "$lib/utils/formatting";

	// Hex geometry from atlas reference (pointy-top, matching sprite masks).
	// Atlases are pre-baked by scripts/bake-terrain-3d.ts (terrain),
	// scripts/bake-improvements.ts (urban), and scripts/bake-resources.ts:
	// hex-clip + cover-fit happen at build time. The runtime feeds each baked
	// atlas straight to deck.gl IconLayer, which samples it as-is. The
	// dimensions also drive the political borders' edge segments.
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

	// A unit marker's plate, in WORLD units, so it holds the same share of its
	// hex at every zoom. The painted art draws at one fixed width rather than
	// at its own pixel size, and a world unit is an atlas pixel here — the
	// terrain cell is `cellWidth` units wide — so a 48-unit radius seats that
	// disc with a ring of the owner's colour around it: 96 across against a
	// 199-unit hex. Two units on one hex sit a plate's width apart, which still
	// leaves both inside the hex — the pair reaches 98 units from the hex
	// centre against its 99.5 apothem (3 of the corpus's 1,408 occupied
	// military tiles hold two).
	const UNIT_PLATE_RADIUS = 48;
	const UNIT_PLATE_LINE_WIDTH = 3;
	const UNIT_STACK_SPACING = 100;

	// The art disc over it. One drawn width for every type, so the portrait
	// set's three outliers (226–253 px against a 128 median) stop mattering,
	// and a 128-pixel raster, which is what 99 of the 102 already ship at. The
	// square crop sits high in a portrait taller than it is wide: these are
	// painted vignettes, and the bottom of the frame is ground rather than
	// subject.
	const UNIT_ART_DIAMETER = 80;
	const UNIT_ART_RASTER_PX = 128;
	const UNIT_ART_CROP_Y = 0.1;

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
		units = [],
		pins = [],
		showPolitical = true,
		showUnits = true,
		showPins = true,
		isFinalTurn,
		lockedTiles,
		onToggleLock,
		onCityHover,
		onCityLeave,
		onCityToggleLock,
		cardCity,
		onCardOffCanvas,
		onUnitHover,
		onUnitLeave,
		onUnitToggleLock,
		cardUnit,
		onUnitCardOffCanvas,
	}: {
		tiles: MapTile[];
		// Used to resolve owner_city → family for the tooltip's family crest.
		// Empty array is fine — tooltip just omits the family crest.
		cities?: CityInfo[];
		// player_xml_id → nation, used to resolve each city's founding nation
		// (CityInfo.first_owner_player_xml_id) for architecture rendering. Empty
		// is fine — rendering then falls back to the tile's current owner_nation.
		playerNations?: PlayerNationEntry[];
		// The military units standing on the map at the FINAL turn, already
		// filtered and placed by the map page (see UnitMarker). `UnitInfo` is a
		// snapshot of `<Tile>/<Unit>` and the save carries no position history,
		// so there is no per-turn arm to draw — the layer is gated on
		// `isFinalTurn` below. Empty is fine: the layer draws nothing.
		units?: UnitMarker[];
		// The map pins standing at the represented turn, already resolved and
		// filtered by the map page (see `resolveMapPins` / `pinsAtTurn`). Unlike
		// `units` these DO follow the turn slider: a pin carries the turn it was
		// placed, so there is a per-turn answer to draw. Empty is fine — the
		// layer draws nothing.
		pins?: MapPin[];
		// Layer visibility. The toggles live in the map view's chrome.
		showPolitical?: boolean;
		showUnits?: boolean;
		showPins?: boolean;
		// Whether `tiles` is the final turn. CityInfo.citizens is an
		// end-of-game count, so the banners carry it only then — and it is what
		// gates the units layer, which has no other turn to stand at.
		isFinalTurn: boolean;
		// The tiles whose panels are locked to the map. Held by the map page,
		// not here: this component is kept across /games/A/map →
		// /games/B/map and takes no game identity, so a coordinate locked in
		// one game would re-derive onto the next game's tile at the same
		// coordinate.
		lockedTiles: TileCoord[];
		// A right-click landed on a tile: lock its panel, or unlock it if it
		// already carries one. Raised too by a locked panel's own ✕.
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onToggleLock: (tile: TileCoord) => void;
		// A banner was hovered or focused: the city, and the banner element the
		// city popover anchors to. The map view opens the popover off this;
		// the tile panel below stays with the tiles, which is what the hex
		// UNDER a banner still raises.
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onCityHover: (cityName: string, element: HTMLElement) => void;
		// The pointer or focus left the banner.
		onCityLeave: () => void;
		// A banner was right-clicked — lock that city's card to it, or unlock
		// it again.
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onCityToggleLock: (cityName: string, element: HTMLElement) => void;
		// The city the page's card stands open on, or null. It lives there with
		// the rest of the card's state and comes back in so the cull below can
		// say when the camera has carried that city's banner off the canvas.
		cardCity: string | null;
		// That verdict, raised on every crossing.
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onCardOffCanvas: (offCanvas: boolean) => void;
		// The unit half of the same four. A marker is drawn IN the canvas rather
		// than beside it, so there is no element of its own to hang the card
		// from: the anchor is the zero-size div below, which follows whichever
		// marker the card belongs to.
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onUnitHover: (unitXmlId: number, element: HTMLElement) => void;
		onUnitLeave: () => void;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onUnitToggleLock: (unitXmlId: number, element: HTMLElement) => void;
		cardUnit: number | null;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onUnitCardOffCanvas: (offCanvas: boolean) => void;
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

	// The tribe a capture hands a city to. `Unit.doCityCapture` (Unit.cs:2004)
	// calls `setPlayer(PlayerType.NONE, infos().Globals.ANARCHY_TRIBE, ...)`, so
	// this is the tribe every city under capture carries — as opposed to a city
	// a real tribe holds, which carries its own.
	const ANARCHY_TRIBE = "TRIBE_ANARCHY";

	// city_name → the tribe holding it, or null/undefined when a nation does.
	// Feeds the crest, which the game takes from the city's tribe when it has
	// one (`City.getCrest`, City.cs:3319).
	const cityTribeByName = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const map = new Map<string, string | null | undefined>();
		for (const c of cities) {
			if (!map.has(c.city_name)) map.set(c.city_name, c.tribe);
		}
		return map;
	});

	// city_name → the tribe it READS AS, for the cities no player holds at the
	// represented turn. Membership is the test for "unowned city": a city
	// absent from this map has an owner, so its tiles belong to the nation
	// outline and its crest to its nation.
	//
	// An ABSENT `tribe` resolves to anarchy rather than to nothing, which is
	// what makes this one map rather than two readings that can disagree. A
	// blob from before PARSER_VERSION 2.26.0 carries no `tribe` at all, and a
	// `PARSER_VERSION` bump leaves most blobs on the old shape — so that
	// default decides the common case, not the edge one. It is also the right
	// reading: all 6 of the corpus's frozen captures are anarchy, and the
	// anarchy treatment is what the map already gave every one of them.
	const unownedCityTribeByName = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const map = new Map<string, string>();
		for (const t of tiles) {
			if (!t.is_city_center || !t.owner_city || t.owner_nation) continue;
			map.set(t.owner_city, cityTribeByName.get(t.owner_city) ?? ANARCHY_TRIBE);
		}
		return map;
	});

	// …and the colour that tribe's territory border draws in. The game colours
	// territory from the CITY rather than from the tile's owning player
	// (`Game.getBorderColors`, Game.cs:21782), and the tribe picks the colour:
	//   - under capture (TRIBE_ANARCHY) → the near-black every tribe shares,
	//     which is what the game paints a city being taken;
	//   - held by a real tribe → that tribe's own colour, the one
	//     `InfoHelpers.getTribeColor` reads. The corpus holds no such city at
	//     save time, so this branch is unmeasured; it exists because the two
	//     states have to be told apart, and until `tribe` was parsed nothing
	//     could.
	const unownedCityBorderColors = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const map = new Map<string, [number, number, number, number]>();
		for (const [cityName, tribe] of unownedCityTribeByName) {
			const tribeHex =
				tribe === ANARCHY_TRIBE ? undefined : getTribeColor(tribe);
			map.set(cityName, tribeHex ? opaqueRgba(tribeHex) : CAPTURE_BORDER_COLOR);
		}
		return map;
	});

	// city_name → who is taking it, for a city under capture at the FINAL turn.
	// The three states the readers need are the map's own: absent is "not being
	// captured", a `nation` is the captor, and a null `nation` is "under capture
	// by someone this blob can't name" — a pre-2.26.0 blob, which recorded no
	// captor at all, or a tribe doing the capturing, which has no nation.
	//
	// Final turn only, because the save holds no capture HISTORY: `<Tribe>` and
	// `<CapturePlayer>` are single current values, and the eventual owner from
	// `tile_ownership_history` is the captor for 1,320 of the corpus's 1,342
	// closed released spans and the DEFENDER for the other 22. So an earlier
	// turn shows the state, through the border, without a name — the same
	// reason `citizens` is carried on the banner only at the final turn.
	const captureByCity = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const map = new Map<string, { nation: string | null }>();
		if (!isFinalTurn) return map;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const nationByPlayer = new Map<number, string | null>();
		for (const p of playerNations) {
			nationByPlayer.set(p.player_xml_id, p.nation);
		}
		for (const c of cities) {
			// The game's own test for "is being captured" — `ClientUI.cs:7319`
			// gates the capture label on `hasCapturePlayer() || hasCaptureTribe()`.
			if (c.capture_player_xml_id == null && c.capture_tribe == null) continue;
			map.set(c.city_name, {
				nation:
					c.capture_player_xml_id != null
						? (nationByPlayer.get(c.capture_player_xml_id) ?? null)
						: null,
			});
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
	//
	// One value with two arms rather than two values, because the pointer is
	// only ever on one thing. A city banner gets that for free by being a DOM
	// sibling: the pointer leaving the canvas for it clears the hover. A unit
	// marker is drawn IN the canvas, so without the union the hex's tile panel
	// and the unit's card would stand at once over the same pixel.
	type HoverState =
		| { kind: "tile"; tile: MapTile; x: number; y: number }
		| { kind: "unit"; marker: UnitMarker; x: number; y: number };
	let hoverState = $state<HoverState | null>(null);

	// Where a tile panel sits: the tile it names, and its anchor in
	// canvas-local CSS pixels. The hover panel's anchor is the pointer's own
	// position; a locked panel's is its hex, re-projected.
	interface TilePanel {
		tile: MapTile;
		x: number;
		y: number;
	}

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
	const hoverPanel = $derived.by<TilePanel | null>(() => {
		const hover = hoverState;
		// A marker takes the pointer off the hex it stands on, as a banner does:
		// the unit's card answers instead.
		if (!hover || hover.kind !== "tile") return null;
		// One panel per tile: a locked panel already stands over this hex, and
		// the hover copy would render the same content on top of it.
		if (lockedTiles.some((l) => l.x === hover.tile.x && l.y === hover.tile.y))
			return null;
		const tile = tiles.find(
			(t) => t.x === hover.tile.x && t.y === hover.tile.y,
		);
		return tile ? { tile, x: hover.x, y: hover.y } : null;
	});

	// Whether the units layer is on screen. The layers take it as their own
	// `visible`, and everything OUTSIDE the canvas — the cursor, the hover arm,
	// the card's anchor — takes it too, so a marker that isn't drawn can't
	// still be hovered after a toggle or a scrub off the final turn.
	const unitsVisible = $derived(showUnits && isFinalTurn);

	// The pins on screen. No turn gate beside the toggle, where the units layer
	// needs one: the page has already cut `pins` to the selected turn. The tile
	// panel's rows read this too, so switching the layer off takes the pin off
	// the hex and out of the hex's panel together.
	const visiblePins = $derived(showPins ? pins : []);

	// Those of them the map can actually place. A pin on no tile (`Tile="-1"`)
	// has no hex to hang from; the Map Pins tab lists it, the overlay skips it.
	const placedPins = $derived(
		visiblePins.filter((p) => p.x !== null && p.y !== null),
	);

	// The marker the pointer is on, or null. Read by the cursor below and by
	// the card's anchor; `getCursor` is re-evaluated every frame, so a plain
	// read of this is enough to turn the hand into a pointer.
	const hoveredUnit = $derived(
		unitsVisible && hoverState?.kind === "unit" ? hoverState.marker : null,
	);

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
	// Deck via setProps — and so the DOM overlays can project world points
	// through it.
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

	// ─── Locked tile panels ───────────────────────────────────────────
	// A locked panel holds its anchor in WORLD units and re-projects off
	// `currentViewState`, so it keeps its hex through a pan and a zoom.
	// Deriving off that one value covers every camera path: deck's controller
	// raises `onViewStateChange`, and the overlay zoom buttons go around the
	// controller but assign the same value themselves (`applyViewState`).
	//
	// Each panel re-reads its tile from the live `tiles` array by coordinate,
	// as `hoverPanel` does, so the turn slider moves a locked panel's CONTENT
	// while its anchor stays put — a panel locked at turn 40 names turn 80's
	// tile once the slider is there. A coordinate the array has no entry for
	// drops that panel.
	//
	// So does an anchor the camera has carried off the canvas: `MapTooltip`
	// clamps to the canvas box, which keeps a panel beside its hex near an
	// edge but would park it at `left: 4px` once the hex is off-canvas,
	// naming a tile that isn't on screen.
	const lockedPanels = $derived.by<TilePanel[]>(() => {
		const viewState = currentViewState;
		if (!viewState) return [];
		const out: TilePanel[] = [];
		for (const coord of lockedTiles) {
			const tile = tiles.find((t) => t.x === coord.x && t.y === coord.y);
			if (!tile) continue;
			const [x, y] = projectToCanvas(
				hexToPixel(tile.x, tile.y),
				viewState,
				deckWidth,
				deckHeight,
			);
			if (x < 0 || x > deckWidth || y < 0 || y > deckHeight) continue;
			out.push({ tile, x, y });
		}
		return out;
	});

	// Right-click toggles the lock on whatever is under the cursor: a unit's
	// card when the pick landed on its marker, the hex's own panel otherwise.
	//
	// It also suppresses the browser's own menu, which answers a right-click
	// over a canvas with "Save image as…" / "Copy image". The handler sits on
	// the container rather than the canvas because the DOM overlays — the city
	// banners, and the locked panels themselves — are the canvas's SIBLINGS: a
	// right-click on one would miss a canvas handler and get the browser's
	// page menu. So the container suppresses the menu everywhere over the map,
	// and only an event that landed on the canvas itself goes on to pick. A
	// banner answers its own right-click (MapCityBanners), locking the city's
	// card rather than the hex it stands on.
	async function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		// `isInitialized` is deck's own "safe to call public methods" flag: the
		// Deck creates its device asynchronously, and picking before that
		// trips an assertion inside it.
		if (e.target !== deckCanvas || !deck?.isInitialized) return;
		// Canvas-local CSS pixels, deck's own picking coordinates. The canvas
		// keeps the size it was constructed with however the container is
		// resized (see deckWidth), so the offset is read off the canvas.
		const rect = deckCanvas.getBoundingClientRect();
		const picked = await deck.pickObjectAsync({
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
			radius: 0,
		});
		if (!picked) return;
		// The plate layer sits after `tile-picking`, so it wins the pick over
		// the hex it stands on — which is what makes a marker behave like a
		// banner rather than like part of its tile.
		if (picked.layer?.id === UNIT_PLATE_LAYER_ID) {
			const placed = picked.object as PlacedUnit;
			if (unitAnchorEl) onUnitToggleLock(placed.marker.xmlId, unitAnchorEl);
			return;
		}
		// The pickable PolygonLayer is fed the MapTile array directly, as
		// `onHover` reads it.
		const tile = picked.object as MapTile | undefined;
		if (tile) onToggleLock(tile);
	}

	// Resolve the crest sprite key for whoever holds a tile's city — the value
	// `getSpritePath("crests", …)` takes, so without the CREST_ prefix it adds.
	//
	// A TRIBE first, when one holds the city: `City.getCrest` (City.cs:3319)
	// returns `tribeInfo().meCrest` before it looks at a nation, which is what
	// gives a city under capture the anarchy badge rather than an empty slot.
	// Both legs are baked, because neither is a naming rule — TRIBE_BARBARIANS
	// wears CREST_TRIBE_GENERIC, and CREST_TRIBE_ANARCHY's art ships as
	// CREST_TRIBE_REBELS (scripts/bake-crest-sprites.ts).
	//
	// Else the nation, with the same 3-tier fallback as before:
	//   1. The nation's own crest if shipped (handles MAURYA/TAMIL/YUEZHI,
	//      KUSH/HYKSOS/MITANNI — which all have their own crest but whose
	//      urban-family alias points elsewhere).
	//   2. The urban-family alias's crest if shipped (handles variant
	//      nations like NATION_AMUN/ATHENS/PTOLEMY that have no own crest).
	//   3. CREST_TRIBE_GENERIC as a last resort (e.g. INDIA family — no
	//      CREST_NATION_INDIA exists in the game).
	// Existence is checked against the SPRITE_MANIFEST baked from
	// static/sprites/crests/CREST_*.png.
	function resolveCityCrestKey(
		ownerNation: string | null,
		tribe?: string | null,
	): string | null {
		if (tribe) {
			const crest = TRIBE_CRESTS[tribe];
			if (crest) {
				const sprite = CREST_SPRITE_NAMES[crest] ?? crest;
				if (SPRITE_MANIFEST[`crests/${sprite}`] != null) {
					return sprite.replace(/^CREST_/, "");
				}
			}
			return "TRIBE_GENERIC";
		}
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

	// One banner per city-centre tile that STANDS at the represented turn,
	// joined to CityInfo by name. Taking the per-turn tiles as the source of
	// truth means a banner appears one turn AFTER founded_turn — the centre
	// tile's first ownership row lands at founded_turn + 1 in 3,601 of the
	// 3,604 cities measured across the 122 local blobs (2 at +0, 1 at −3).
	//
	// A city nobody holds keeps its banner, because the game keeps drawing it:
	// `reconstructMapTiles` admits a RELEASED tile's city chrome, and the name
	// there stays the unowned tan — nobody owns the city, and painting it in
	// the captor's colour would read as ownership.
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
				worldX,
				worldY,
				// Resolved as MapTooltip resolves it, so a tile's hover colour
				// and its banner agree.
				nationColor: t.owner_nation
					? (getCivilizationColor(t.owner_nation) ?? "rgb(var(--color-tan))")
					: "rgb(var(--color-tan))",
				civilizationCrestKey: resolveCityCrestKey(
					t.owner_nation,
					unownedCityTribeByName.get(t.owner_city),
				),
				familyCrestKey: cityFamilyCrestByName.get(t.owner_city) ?? null,
				isCapital: t.is_capital,
				citizens: isFinalTurn
					? (byName.get(t.owner_city)?.citizens ?? null)
					: null,
			});
		}
		return out;
	});

	// ─── Unit markers ─────────────────────────────────────────────────
	// The two layers' ids, named once. The plate's is what both `onHover` and
	// the right-click discriminate on to tell a marker from the hex under it,
	// so a literal in either place would drift from the layer it names; the
	// art's sits beside it so the pair reads as one marker.
	const UNIT_PLATE_LAYER_ID = "unit-plates";
	const UNIT_ART_LAYER_ID = "unit-art";

	/** A marker placed in world units, with its share of a shared hex. */
	interface PlacedUnit {
		marker: UnitMarker;
		worldX: number;
		worldY: number;
	}

	// Two units on one hex draw side by side, each its own hover target —
	// measured at 3 of the corpus's 1,408 occupied military tiles, each a naval
	// and a land unit of the same player on a city centre. Nothing caps the
	// count: `Tile.canBothUnitsOccupy` (`Tile.cs:10438`) admits more, so the
	// row is centred on the hex at whatever width it comes out.
	//
	// Ordered by `xmlId` within a tile so a rebuild can't swap two markers
	// under the pointer.
	const placedUnits = $derived.by<PlacedUnit[]>(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- locally-scoped Map, not reactive state
		const byTile = new Map<string, UnitMarker[]>();
		for (const marker of units) {
			const key = `${marker.x},${marker.y}`;
			const held = byTile.get(key);
			if (held) held.push(marker);
			else byTile.set(key, [marker]);
		}
		const out: PlacedUnit[] = [];
		for (const stack of byTile.values()) {
			const ordered = [...stack].sort((a, b) => a.xmlId - b.xmlId);
			const [cx, cy] = hexToPixel(ordered[0].x, ordered[0].y);
			for (const [i, marker] of ordered.entries()) {
				out.push({
					marker,
					worldX: cx + (i - (ordered.length - 1) / 2) * UNIT_STACK_SPACING,
					worldY: cy,
				});
			}
		}
		return out;
	});

	// Each distinct portrait, cut to a disc once and kept as the PNG the icon
	// layer hands deck.gl. `IconLayer` draws a rectangular image and has no
	// round crop of its own, so the circle has to be in the pixels — the same
	// reason `loadCircularAvatars` rasterizes Discord avatars for ECharts. A
	// portrait that hasn't been cut yet is simply absent from the layer's data,
	// so the plate draws alone for a frame, exactly as it does for a unit we
	// ship no art for.
	let artDiscs = $state<Record<string, Blob>>({});
	// Which portraits have been asked for, as a plain Set so the effect below
	// doesn't read the state it writes — the same arrangement `ensureFamilyAtlas`
	// uses for the urban atlases. A url stays in it after a failed load too:
	// one attempt per portrait per session, and the plate draws alone for the
	// rest, rather than re-requesting a 404 on every rebuild.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- module-scope guard, not reactive state
	const artRequested = new Set<string>();

	$effect(() => {
		// Nothing is fetched until the layer is actually on: a portrait with no
		// disc is absent from the layer's data, so `getIcon` never runs on it
		// and deck.gl's own auto-packing doesn't fetch it either. A map nobody
		// switched the layer on over costs no unit art.
		if (!unitsVisible) return;
		for (const { marker } of placedUnits) {
			const url = marker.portraitUrl;
			if (url == null || artRequested.has(url)) continue;
			artRequested.add(url);
			void circularPng(url, UNIT_ART_RASTER_PX, UNIT_ART_CROP_Y).then(
				(disc) => {
					artDiscs = { ...artDiscs, [url]: disc };
				},
				// A portrait that won't load leaves its plate drawing alone.
				() => {},
			);
		}
	});

	// `IconLayer` loads every icon by fetching its url, and the url we give it
	// names a portrait whose disc is already in hand. Answer that fetch from
	// the cut PNG: deck.gl re-reading `/sprites/units/*.png` would get the
	// uncut rectangle, and handing it a `data:` url instead is refused — an
	// icon is fetched rather than assigned to an `<img>`, so it answers to
	// `connect-src`, which doesn't carry `data:` the way `img-src` does (the
	// policy in svelte.config.js).
	const fetchArtDisc = (url: string): Promise<Response> =>
		Promise.resolve(new Response(artDiscs[url]));

	// The markers whose disc is ready to draw. Separate from `placedUnits` so
	// the plate layer — which is the pick target, and so what the card hangs
	// off — never waits on an image.
	const artUnits = $derived(
		placedUnits.filter(
			(p) =>
				p.marker.portraitUrl != null && artDiscs[p.marker.portraitUrl] != null,
		),
	);

	// ─── The unit card's anchor ───────────────────────────────────────
	// A marker is drawn in the canvas, so unlike a banner it has no element of
	// its own. One zero-size div stands in: it follows whichever marker the
	// card belongs to, which is the LOCKED one while a card is locked (so
	// hovering another marker can't drag a locked card off its unit) and the
	// hovered one otherwise — during the open delay, before the page has a
	// card to name.
	const anchorUnit = $derived.by<PlacedUnit | null>(() => {
		const wanted = cardUnit ?? hoveredUnit?.xmlId ?? null;
		if (wanted == null) return null;
		return placedUnits.find((p) => p.marker.xmlId === wanted) ?? null;
	});

	// Its place on the canvas, at the plate's TOP — where the card hangs from,
	// the way the city card hangs off a banner's foot. Null once the camera has
	// carried it out of the box, which is also the cull below.
	const anchorPoint = $derived.by<[number, number] | null>(() => {
		const placed = anchorUnit;
		const viewState = currentViewState;
		if (!placed || !viewState) return null;
		return projectToCanvas(
			[placed.worldX, placed.worldY - UNIT_PLATE_RADIUS],
			viewState,
			deckWidth,
			deckHeight,
		);
	});

	// The same cull the city card gets: bits-ui doesn't hide a floating panel
	// whose anchor has been clipped away, so a card would sit against the box's
	// edge naming a unit that is no longer on screen.
	const unitCardOffCanvas = $derived.by(() => {
		if (cardUnit === null) return false;
		const point = anchorPoint;
		// A card whose unit has no marker is the page's own close, not a cull.
		if (!point) return false;
		const [x, y] = point;
		return x < 0 || x > deckWidth || y < 0 || y > deckHeight;
	});

	$effect(() => {
		onUnitCardOffCanvas(unitCardOffCanvas);
	});

	// The anchor element, handed to the page on every hover and right-click.
	// Its identity never changes — only its position — so the page can capture
	// it at hover time and still have it when its open delay fires.
	let unitAnchorEl = $state<HTMLElement | null>(null);

	// Raise the hover across to the page, which owns the card and its delays.
	// Only on a CHANGE of marker: `onHover` reassigns `hoverState` on every
	// pointer move, and the page restarts its open delay each time it is told
	// about a new unit — so raising every move would mean a card that only
	// opens once the pointer stops dead. A banner gets this from the DOM,
	// whose `mouseenter` fires once on arrival.
	//
	// No held-button guard, unlike a banner's: deck's `_onPointerMove` bails
	// on the left or right button, so a marker sliding under a dragged pointer
	// raises no hover to begin with.
	let raisedUnit: number | null = null;
	$effect(() => {
		const marker = hoveredUnit;
		const element = unitAnchorEl;
		// Without the anchor there is nothing to hang a card off, so that reads
		// as no hover — and when the element arrives the id changes, which
		// raises the hover then rather than swallowing it.
		const id = marker != null && element != null ? marker.xmlId : null;
		if (id === raisedUnit) return;
		raisedUnit = id;
		if (id != null && element != null) onUnitHover(id, element);
		else onUnitLeave();
	});

	// ─── The city card's anchor ───────────────────────────────────────
	// The map page floats the city card off a BANNER, so the card rides the
	// camera as the banner does — and as a locked tile panel does, the camera
	// can carry it off the canvas. The panels above cull themselves; bits-ui
	// doesn't, so the card stayed parked against the box's edge naming a city
	// `.sprite-map-container`'s `overflow: hidden` had clipped away
	// (`hideWhenDetached` is false and `sticky` "partial" by default). The
	// camera and the canvas box are here, so the crossing is answered here;
	// the page owns the card and takes it down, and puts it back on the way
	// in, the way a locked panel reappears.
	//
	// Against the banner's FOOT rather than the hex centre, because that is
	// where the card hangs from: the frame stands BANNER_WORLD_OFFSET_Y above
	// the hex, which is 1,296 CSS pixels of it at the top zoom.
	const cardOffCanvas = $derived.by(() => {
		const city = cardCity;
		const viewState = currentViewState;
		if (city === null || !viewState) return false;
		const banner = cityBanners.find((b) => b.cityName === city);
		// A city with no banner at the represented turn is the page's own
		// close, not a cull.
		if (!banner) return false;
		const [x, y] = bannerFoot(banner, viewState, deckWidth, deckHeight);
		return x < 0 || x > deckWidth || y < 0 || y > deckHeight;
	});

	$effect(() => {
		onCardOffCanvas(cardOffCanvas);
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

	/** The same colour as deck.gl's fully opaque RGBA. */
	function opaqueRgba(hex: string): [number, number, number, number] {
		const [r, g, b] = hexToRgb(hex);
		return [r, g, b, 255];
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
		// The territory outline of each city NO PLAYER holds — under capture,
		// or held by a tribe. Its own list rather than part of `borders`
		// because it is keyed on the city instead of on the owning nation,
		// which is how the game colours it too (`Game.getBorderColors`).
		unownedCityBorders: NationBorder[];
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
	// A city no player holds resolves to owner_nation === null on every one of
	// its tiles, and its border is what says so. The game draws that border
	// from the CITY rather than from the tile's owning player
	// (`Game.getBorderColors`, Game.cs:21782 → `City.getPrimaryPlayerColor`,
	// City.cs:3279), which for a city under capture is the near-black every
	// tribe shares — so it renders at a nation border's own weight and full
	// alpha, as the city's dominant colour, not as a faint marker.
	const CAPTURE_BORDER_COLOR = opaqueRgba(UNOWNED_CITY_BORDER_COLOR);

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
	// Used for both nation borders (keyed on owner_nation) and the borders of
	// cities no player holds (keyed on owner_city); `colorFor` returns the
	// stroke colour for a group, or null to drop it.
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

	function computePoliticalData(
		mapTiles: MapTile[],
		borderByCity: Map<string, [number, number, number, number]>,
	): PoliticalData {
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
			colorFor: (key) => opaqueRgba(getCivilizationColor(key)!),
			width: NATION_BORDER_WIDTH,
		});

		// The border of a city no player holds, keyed on owner_city — its
		// territory tiles are exactly the ones with a city and no owner nation.
		// `borderByCity` says which cities those are and in what colour; a city
		// absent from it has an owner, so its tiles belong to the nation
		// outline above.
		const unownedCityBorders = buildTerritoryOutline({
			mapTiles,
			tileMap,
			vertexMap,
			keyOf: (t) =>
				!t.owner_nation && t.owner_city && borderByCity.has(t.owner_city)
					? t.owner_city
					: null,
			colorFor: (key) => borderByCity.get(key) ?? null,
			width: NATION_BORDER_WIDTH,
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

		return { borders, subBorders, unownedCityBorders };
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
			return { borders: [], subBorders: [], unownedCityBorders: [] };
		if (import.meta.env.DEV) console.time("computePoliticalData");
		const result = computePoliticalData(tiles, unownedCityBorderColors);
		if (import.meta.env.DEV) console.timeEnd("computePoliticalData");
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
			// Hover dispatch: deck.gl returns the picked layer's data item, so
			// which arm of `hoverState` this is comes off the layer's id. The
			// pickable PolygonLayer is fed the MapTile array directly and the
			// plate layer its PlacedUnit array, so `object` is one or the other
			// (or undefined, off every pickable layer).
			//
			// The pick itself is what answers "on the marker or on the hex", and
			// it is the PLATE that is pickable rather than the glyph — a solid
			// circle, so the hit area is the whole marker and not the flag's
			// strokes with the gaps between them falling through to the tile.
			onHover: (info: {
				object?: MapTile | PlacedUnit;
				layer?: { id: string } | null;
				x: number;
				y: number;
			}) => {
				if (!info.object) {
					hoverState = null;
					return;
				}
				if (info.layer?.id === UNIT_PLATE_LAYER_ID) {
					const placed = info.object as PlacedUnit;
					hoverState = {
						kind: "unit",
						marker: placed.marker,
						x: info.x,
						y: info.y,
					};
					return;
				}
				hoverState = {
					kind: "tile",
					tile: info.object as MapTile,
					x: info.x,
					y: info.y,
				};
			},
			// A marker reads as something to click; everything else on the map
			// is the camera's. deck's own default ignores hovering altogether
			// (`({isDragging}) => isDragging ? 'grabbing' : 'grab'`), which is
			// why the map is a hand everywhere today — and `isHovering` can't
			// stand in for the test, because the tile-picking layer is pickable
			// and would point at every hex. `_updateCursor` runs each frame off
			// `props.getCursor`, so reading `hoveredUnit` here is enough.
			getCursor: ({ isDragging }: { isDragging: boolean }) =>
				isDragging ? "grabbing" : hoveredUnit ? "pointer" : "grab",
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
	// Keys on the founding nation (see renderNationFor) so an unowned, captured
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
		const riv = rivers;
		const pol = showPolitical;
		const unitsOn = unitsVisible;

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
			// political overlay. Rounded joints/caps let the per-edge
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
			// The border of each city no player holds — the anarchy near-black for
			// one under capture, the tribe's own colour for one a tribe holds.
			// Always visible, and at a nation border's own weight: it is the
			// city's dominant colour, the way the game paints it, not a marker
			// the political overlay can switch off.
			new PathLayer<NationBorder>({
				id: "unowned-city-borders",
				data: political.unownedCityBorders,
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
			// The units, over everything else their tile holds — a resource, an
			// improvement, a city centre. AFTER `tile-picking`, which otherwise
			// takes every pick: a pickable layer placed before it never wins
			// one, and the plate has to, or a marker would read as part of the
			// hex under it.
			//
			// The plate is the pick target, so the hit area is the whole marker.
			// Its colour is the owner's, which is the one thing on the map that
			// says whose army this is. It reads as the ring around the art disc
			// and through the disc itself, where the portrait's painted sky is
			// transparent — a median 39% of the disc across the 102, 7% at the
			// most covered.
			new ScatterplotLayer<PlacedUnit>({
				id: UNIT_PLATE_LAYER_ID,
				data: placedUnits,
				getPosition: (d: PlacedUnit) => [d.worldX, d.worldY],
				getRadius: UNIT_PLATE_RADIUS,
				getFillColor: (d: PlacedUnit) => hexToRgb(d.marker.color),
				getLineColor: [0, 0, 0, 200],
				getLineWidth: UNIT_PLATE_LINE_WIDTH,
				radiusUnits: "common",
				lineWidthUnits: "common",
				stroked: true,
				filled: true,
				pickable: true,
				visible: unitsOn,
			}),
			// The game's painted unit art over the plate, one disc per type.
			// `IconLayer`'s auto-packing fetches a url once per id and packs it
			// into an atlas itself, so the content-hashed
			// `/sprites/units/*.png` identify the discs and no atlas bake is
			// needed — a game holds at most 40 distinct unit types.
			new IconLayer<PlacedUnit>({
				id: UNIT_ART_LAYER_ID,
				data: artUnits,
				getIcon: (d: PlacedUnit) => ({
					id: d.marker.portraitUrl as string,
					url: d.marker.portraitUrl as string,
					width: UNIT_ART_RASTER_PX,
					height: UNIT_ART_RASTER_PX,
				}),
				loadOptions: { fetch: fetchArtDisc },
				getPosition: (d: PlacedUnit) => [d.worldX, d.worldY],
				getSize: UNIT_ART_DIAMETER,
				sizeUnits: "common",
				sizeBasis: "width",
				pickable: false,
				visible: unitsOn,
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
		void rivers;
		void showPolitical;
		void showUnits;
		void isFinalTurn;
		void placedUnits;
		void artUnits;

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

{#snippet tilePanel(panel: TilePanel & { onUnlock?: () => void })}
	<MapTooltip
		tile={panel.tile}
		cityFamily={panel.tile.owner_city
			? (cityFamilyCrestByName.get(panel.tile.owner_city) ?? null)
			: null}
		civilizationCrestKey={resolveCityCrestKey(
			panel.tile.owner_nation,
			panel.tile.owner_city
				? unownedCityTribeByName.get(panel.tile.owner_city)
				: null,
		)}
		capture={panel.tile.owner_city
			? (captureByCity.get(panel.tile.owner_city) ?? null)
			: null}
		pins={pinsOnTile(visiblePins, panel.tile.x, panel.tile.y)}
		screenX={panel.x}
		screenY={panel.y}
		canvasWidth={deckWidth}
		canvasHeight={deckHeight}
		onUnlock={panel.onUnlock}
	/>
{/snippet}

<!-- The container carries the right-click, for the reason handleContextMenu
     gives; the gesture is pointer-only (#270), and no role describes a box
     holding the canvas and its overlays. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sprite-map-container" oncontextmenu={handleContextMenu}>
	<canvas bind:this={deckCanvas} class="sprite-map-canvas"></canvas>

	{@render zoomControls()}

	{#if currentViewState}
		<MapCityBanners
			banners={cityBanners}
			viewState={currentViewState}
			canvasWidth={deckWidth}
			canvasHeight={deckHeight}
			onBannerHover={onCityHover}
			onBannerLeave={onCityLeave}
			onBannerToggleLock={onCityToggleLock}
		/>
		<MapPinMarkers
			pins={placedPins}
			{hexToPixel}
			viewState={currentViewState}
			canvasWidth={deckWidth}
			canvasHeight={deckHeight}
		/>
	{/if}

	{#each lockedPanels as panel (`${panel.tile.x},${panel.tile.y}`)}
		{@render tilePanel({
			...panel,
			onUnlock: () => onToggleLock(panel.tile),
		})}
	{/each}

	{#if hoverPanel}
		{@render tilePanel(hoverPanel)}
	{/if}

	<!-- The unit card's anchor: a zero-size point at the current marker's
	     plate top, which the page's Popover hangs off as it hangs the city
	     card off a banner. Not a button and not a hover target — the marker
	     in the canvas is both; this only has to be somewhere, so it takes
	     neither the pointer nor the tab order. -->
	<div
		bind:this={unitAnchorEl}
		class="unit-card-anchor"
		style={anchorPoint
			? `left: ${anchorPoint[0]}px; top: ${anchorPoint[1]}px;`
			: "display: none;"}
		aria-hidden="true"
	></div>
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

	.unit-card-anchor {
		position: absolute;
		width: 0;
		height: 0;
		pointer-events: none;
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
