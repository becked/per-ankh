# Map Beta: Future Work

Items deferred from the initial sprite-based map implementation. Each builds on the terrain + ownership foundation.

## Status snapshot

**What's rendering today:** terrain + height (chunked composite, all map sizes), political borders (Chaikin-smoothed), religion fills, and 22 improvement cells covering 23 DB types via `scripts/bake-improvements-test.ts`. The improvement bake reads a `TIER_FAMILIES` table derived from `pinacotheca/reference/XML/Infos/improvement.xml` and resolves each DB type to its preferred asset PNG with tier-down fallback when missing.

**Recommended next priority: Tooltips** (see below). The map's other features are hard to validate or use without per-tile identification.

**Currently rendered DB types (23):** LIBRARY_1/2/3, MARKET_1/2/3, COURTHOUSE_1/2/3, THEATER_1/2/3, BATHS_1/2/3, GARRISON_1/2/3, BARRACKS, GRANARY, WATERMILL, HANGING_GARDEN(S). No fallbacks active.

**Pinacotheca naming gotchas** baked into the config (see comments in `scripts/bake-improvements-test.ts`):
- Garrison family uses in-game display names (`GARRISON / STRONGHOLD / CITADEL`) rather than XML `zIconName` (`GARRISON_1/2/3`).
- `IMPROVEMENT_HANGING_GARDENS` (DB plural) → 3D export `HANGING_GARDEN` (singular).

Pinacotheca's 3D export naming usually matches the XML `zIconName` convention. Earlier mismatches (`MINISTRY` vs `MINISTRIES`, `BATHS_COLD` vs `COLD_BATHS`) were resolved upstream by renaming. If a re-bake unexpectedly logs `SKIP` for an asset that should exist, check whether the underlying mesh uses the in-game display name instead — that's the Garrison-style case. Open `pinacotheca/reference/XML/Infos/improvement.xml` and the `extracted/sprites/improvements/` listing side by side to find the mapping.

**Pending on pinacotheca's side**, ordered roughly by impact:

- **Settlement assets** (SETTLEMENT_1/2/3/4) — entire family currently skipped (4 DB types).
- **Ruins assets** (HOVEL_RUINS, OUTPOST_RUINS, ENCAMPMENT_RUINS, BASTION_RUINS) — entire family currently skipped (4 DB types).
- **Per-family asset variants** (ask #2) — declined, documented as accepted limitation under "Improvement Sprites Don't Vary by Family/Culture" below.
- **Kushite Pyramid spotlights bug** — visible scene-light fixtures still rendering as geometry. Not blocking.

When pinacotheca adds any of the above, just re-run `npx tsx scripts/bake-improvements-test.ts` — the existence-check + fallback logic auto-picks them up. **Watch for naming-convention surprises** like the BATHS / MINISTRY / GARRISON cases above; the bake's resolution log will print `SKIP` for any asset name it can't find, and you may need to update the asset name in `TIER_FAMILIES` / `SINGLE_IMPROVEMENTS`.

**Pending on per-ankh's side, by impact:**

1. **Tooltips** — see "Deferred Features" below. Largest UX gain remaining.
2. **More improvement coverage in the bake** — the bake currently covers tiered improvements (8 families) plus Granary/Watermill/Hanging Gardens. Wonders not yet wired up: Pyramids (`IMPROVEMENT_PYRAMIDS` → `IMPROVEMENT_3D_PYRAMID_LVL_*`), Kushite Pyramids, Ishtar Gate, Aksum Stelae (1/2/3), Maurya/Tamil/Yuezhi capitals, Mahavihara, Apadana, Acropolis, Al-Khazneh, Yazilikaya, Royal Library, Colossus, Burial Chamber, Altar of Aten, Balearic Range, Stupa, Via Recta Souk. Plus religious shrines/temples/monasteries/cathedrals across faiths (the `MONASTERY_CHRISTIANITY` ↔ `CHRISTIANITY_MONASTERY` swap noted in the bake comments applies here). Add to `SINGLE_IMPROVEMENTS` in the bake config.
3. **Capital marker** — corner-banner overlay or distinct sprite on `is_capital` tiles. Decision pending.
4. **Resources / specialists / city sites** — separate IconLayers with `visible` toggles; sparse data so much smaller compute than terrain.
5. **City name labels (TextLayer)** — depends on city center handling above.
6. **Turn slider / playback** — architecturally supported (memoize-on-tiles); profile once wired up.
7. **Fullscreen mode** — native `<dialog>` + second Deck instance, same pattern as HexMap.
8. **Rename `improvements-test` → `improvements`** — when the `-test` suffix stops being honest. Bake script and atlas filename + the `loadAtlas("improvements-test")` call in `SpriteMap.svelte`.

## Deferred Features

### Improvement Atlas (BitmapLayer composite)
Improvement sprites are currently rendered via `compositeTerrainImage` in `SpriteMap.svelte`, which paints the terrain + height + improvement passes into chunked offscreen canvases (one per X-chunk, see "BitmapLayer Texture-Size Ceiling" below) and uploads each as a `BitmapLayer`. The improvement atlas is built by `scripts/bake-improvements-test.ts`, which reads the `TIER_FAMILIES` and `SINGLE_IMPROVEMENTS` config, checks PNG existence in `pinacotheca/extracted/sprites/improvements/`, applies tier-down fallback for missing assets, dedupes shared cells, and emits `static/atlases/improvements-test.{webp,json}`.

To add a new improvement: drop the new entry into `TIER_FAMILIES` (if tiered) or `SINGLE_IMPROVEMENTS` (if single). Re-run the bake. No runtime change needed — `SpriteMap.svelte` looks up sprites by `tile.improvement` against the manifest.

For sparse layers we'll likely add later (resources, specialists, city sites), the existing future-work plan was deck.gl IconLayer per layer. That decision is still open — see "BitmapLayer vs IconLayer Trade-offs" below for when each pattern wins.

### Additional Toggles
The Political and Religion toggles exist; remaining deferred toggles are City Sites, Capitals, Urban improvements, Rural improvements (and any future overlay). Each should be its own `$state(boolean)`, its own data prep memoized via `$derived.by(() => …)` keyed on `tiles`, and an always-built deck.gl layer whose `visible` is bound to the toggle. This keeps toggle latency at zero buffer rebuilds.

### Tooltips (recommended next priority)
Add a separate `PolygonLayer` covering all tiles with full hex polygons and a fully transparent fill (`getFillColor: [0,0,0,0]`) marked `pickable: true`, then wire `onHover` to surface tile details. A dedicated invisible picking layer keeps the visible overlays (PathLayer borders, religion fills) free of pickability concerns and produces consistent hit testing whether or not Political/Religion are toggled on. Tooltip content can reuse the builder from HexMap.

Without this, validating the per-tile correctness of any other map feature requires DB queries — the "which city / nation / coordinates is this tile?" question can only be answered by code today. Highest-leverage UX work remaining on the map.

### Turn Slider / Playback
Reuse the existing turn change callback pattern (`onTurnChange` prop). Terrain compositing runs once per turn change; political/religion data prep also rebuild on tile change. Playback should be smooth, but worth profiling once wired up since the Chaikin smoothing pass adds work.

### Fullscreen Mode
Native `<dialog>` with a second Deck instance, same pattern as HexMap.

### City Name Labels (TextLayer)
Text labels below city center tiles. Deferred because it depends on city IconLayer being in place.

## Implementation Patterns

### Memoize-on-tiles + Visible-Toggle
The political and religion overlays establish the pattern for all future overlays:

1. Hold per-overlay state as `let showFoo = $state(boolean)`.
2. Compute the overlay's render-ready data via `$derived.by(() => …)` keyed on `tiles`. The derivative re-runs only when tiles change, not when toggles flip.
3. Always build the deck.gl layer in the `$effect`, passing the memoized data as `data`. Bind `visible: showFoo` to the toggle.
4. Toggling becomes a single `setProps` with the same data reference and a different `visible` — deck.gl reuses GPU buffers; flips are effectively free.

### Smoothed Boundary Curves (Chaikin)
Political nation borders chain boundary edges per territory island into closed paths, applying Chaikin's corner-cutting algorithm (3 iterations) for the in-game silky-curve look. Sub-borders chain similarly but use the open-path Chaikin variant since they branch at multi-city junctions. The same pattern can be reused for any future "territory boundary" rendering.

### Per-vertex Centroid Inset
Both nation borders and religion fills use a per-vertex inset toward the centroid of same-nation tiles meeting at that vertex. Adjacent same-nation tiles compute the same centroid → identical inset positions → boundaries chain cleanly without gaps. Religion fills inherit this so they stop at the political border instead of bleeding past it. The current inset constant is `NATION_BORDER_INSET = 0.10` (10%); tunable.

### BitmapLayer Texture-Size Ceiling (Why Terrain Is Chunked)
The terrain + height pass paints all tiles into one offscreen canvas, then uploads the resulting `ImageBitmap` to deck.gl as a single `BitmapLayer`. That texture's max dimension is bound by WebGL's `GL_MAX_TEXTURE_SIZE` — typically 16384 on modern GPUs.

For a pointy-top hex grid with `HEX_H_SPACING = 199` and `cellWidth = 211`, the composite width works out to `(map_width - 1) * 199 + 99.5 + 211`. That crosses 16384 at map width 82 (composite = 16430). Larger maps fail harder: a 100-wide map computes to 20012, ~22% over the limit. About 25% of typical imported games use maps ≥82 wide.

**Failure mode.** WebGL rejects the texture upload (`glTexStorage2D: Desired resource size is greater than max texture size`), `BitmapLayer` renders black. PathLayer/PolygonLayer overlays (political borders, religion fills) still render correctly because they don't go through a single big texture — they're vector geometry.

**Solution: chunk the composite into N horizontal strips.** Each chunk gets its own offscreen canvas, `ImageBitmap`, and `BitmapLayer`. Number of chunks computed as `ceil(totalWidth / safeChunkWidth)` where `safeChunkWidth ≈ 14000` (under-limit with margin). Each tile is painted in exactly one chunk based on its X column; chunks are sized to include the sprite extent of tiles at the chunk's right edge so a sprite straddling the boundary is owned and fully painted by one chunk. Adjacent chunks' BitmapLayers may overlap by a sprite width but no double-painting occurs because each tile is owned by exactly one chunk. Memoize-on-tiles still works — chunks rebuild only when `tiles` changes.

### BitmapLayer vs IconLayer Trade-offs
Terrain + height are stacked into one image and rendered via `BitmapLayer` (with chunking, see above). Improvements / resources / specialists / city sprites are planned as separate `IconLayer`s that render per-tile from an atlas. The two approaches diverge on six axes:

| Axis | BitmapLayer | IconLayer |
|---|---|---|
| Atlas Y-orientation | Wants vertically-flipped pixels (OpenGL `V=0` at bottom) | Expects right-side-up atlas |
| Position model | One image positioned by `bounds: [l, b, r, t]` rectangle | Per-icon `getPosition` (point) + `anchorX`/`anchorY` |
| Stacking | Pre-composited into one image (terrain → height painted over) | Multiple layers stacked by render order |
| Texture-size ceiling | Bound by `GL_MAX_TEXTURE_SIZE` over the whole map | Bound only by atlas size (small) |
| Per-tile-data update cost | Heavy: repaint 6724 sprites + upload ~178MB ImageBitmap | Light: rebuild data array + buffer upload |
| Picking | Whole rectangle, not per-tile | Per-icon, free |

**Today's choice for terrain.** Chunked BitmapLayer wins on minimizing change from the existing pipeline, preserves the carefully-tuned offscreen-canvas blit pattern, and handles all map sizes once chunking is in place. The texture-ceiling concern is contained.

**When to migrate terrain to IconLayer.** Two plausible triggers: (a) the planned turn slider / playback feels slow because every turn change repaints the giant offscreen canvas; (b) we want per-tile picking for terrain (tooltips currently rely on a separate invisible PolygonLayer per the deferred-features list). Migration cost: re-bake atlases without the Y-flip (split bake into two flavors, or run a per-draw flip), replace `compositeTerrainImage` with stacked terrain + height IconLayers, verify render order is preserved across overlay layers.

**For now, new sprite layers.** Improvements / resources / specialists / city follow the IconLayer pattern from day one — they're sparse (most tiles have no improvement) and don't compete for offscreen-canvas pixels. Their atlases need to be right-side-up; either bake them un-flipped or apply the flip per-draw.

## Known Visual Issues

### Extra Water Tiles at Coastlines
Our map renders more water tiles than the game shows at coastlines (e.g., 4 water tiles west of a coastal city where the game shows 2). The land and mountain tiles match correctly, so this isn't a coast-vs-ocean terrain type issue. Troubleshooting steps:
1. Check if the row offset `(y+1)%2` is inverted — try `y%2` and compare coastlines. Wrong offset shifts every other row by half a hex, which at vertical coastlines adds/removes a visible water tile per row.
2. Check if the DB includes tiles beyond the game's playable boundary that the game doesn't render (fog-of-war, map edges). Compare tile count against `map_info.width * map_info.height` if available.
3. Pick specific coastal tiles from the screenshot, find their (x,y) coordinates, and check what terrain/height values the DB has for them vs their neighbors.

### Urban Buildings Rendering on Rural-Looking Tiles
Some tiles with urban improvements (libraries, markets, courthouses, etc.) render with rural terrain underneath them — the building sprite sits on grass/lush/temperate ground rather than the sandy/cobbled urban terrain expected. The earlier DB query (Apr 2026) showed ~95% of `IMPROVEMENT_LIBRARY_*` tiles on `TERRAIN_URBAN` and ~5% on rural terrain types — suggesting it's a small fraction but visibly off when present.

**Hypothesized cause** (not verified): in-game, when a player places an urban improvement adjacent to an existing urban tile, the tile *converts* from rural to urban as part of the placement. If the parser is reading the pre-conversion terrain value from the save XML (rather than the post-placement state), the DB ends up with `terrain = TERRAIN_TEMPERATE` (or similar) on a tile whose `improvement = IMPROVEMENT_LIBRARY_2`. Per-ankh's runtime then composites the rural terrain sprite + the urban building sprite, producing the visual mismatch.

**Troubleshooting steps** when this gets investigated:
1. Pick a specific affected tile from a save (improvement = LIBRARY_*, terrain != URBAN). Check the raw XML in the save zip for that tile's `<TerrainType>` field — does it match the DB value, or did the parser miss a transition?
2. Compare the tile's terrain with neighbouring urban tiles' terrain in the same city. If the in-game rule is "must be adjacent to urban → becomes urban," verify by looking at the save state.
3. Check whether the discrepancy correlates with a specific improvement subset (e.g. only tier 2/3 upgrades, or only certain religious buildings).
4. If the parser is the cause, the fix is in `src-tauri/src/parser/` — likely a tile-state pass that needs to apply urban-conversion rules during import.

**Workaround** (if parser fix is delayed): the runtime in `SpriteMap.svelte` could special-case `if (tile.improvement matches urban-improvement set) draw TERRAIN_URBAN sprite instead of tile.terrain`. Brittle (couples renderer to improvement classification) but contained.

### Improvement Sprites Don't Vary by Family/Culture
The game ships per-family visual variants for several improvements (libraries, monasteries, palaces, capitals) — e.g. a Tamil library is a green-domed white-trimmed temple-style building while an Egyptian library is a tan stone box with a small dome. Pinacotheca currently extracts only one mesh per improvement, so per-ankh renders every culture's library with the same asset. Result: roughly half of cultures see a library that doesn't match the in-game look. We've filed the variant request as ask #2 in `pinacotheca/docs/feature-request-per-ankh-map-atlas.md`; pinacotheca isn't planning to implement it. Known v1 limitation. If it becomes a real problem, fallback options are (a) a screenshotter mod (see `~/Desktop/Old World/docs/improvement-screenshot-mod-spike.md`) that drives the game to render each variant, or (b) manually screenshot the cultural variants and commit them as static assets.

(Asks #1 — strip baked plinths from single-piece improvements like Library / Christian Temple — and #3 — skip splat-shader Plane meshes on composite prefabs like wonders and DLC capitals — have shipped. Single-piece and composite-prefab renders are now clean. The per-family gap above is the only remaining structural mismatch.)

## Known Code Issues

### Frontend Terrain Config is Wrong
`src/lib/config/terrain.ts` uses `TERRAIN_COAST` and `TERRAIN_DESERT` — these values don't exist in the database. Actual DB terrain values (verified by querying): `TERRAIN_ARID`, `TERRAIN_LUSH`, `TERRAIN_MARSH`, `TERRAIN_SAND`, `TERRAIN_TEMPERATE`, `TERRAIN_TUNDRA`, `TERRAIN_URBAN`, `TERRAIN_WATER`. The atlas sprites match the DB values. The existing Map tab's color config works only because misses fall through to a fallback color. Should be corrected to match actual game data.

### DB Table Name
The Rust query functions are called `get_map_tiles` / `get_map_tiles_at_turn`, but the actual DuckDB table is `tiles` (not `map_tiles`). Not a bug — just a naming mismatch to be aware of when querying directly.

## Maintenance Notes

### DLC Sprite Updates
Sprite URLs are dynamically constructed from game data via `getSpritePath()` in `src/lib/game-detail/helpers.ts`. Any new nation, religion, unit, or other entity in a save file triggers a sprite request. When new DLC adds content, run pinacotheca to extract the new sprites, then sync them into `static/sprites/` using:
```bash
diff <(ls ~/Projects/Old\ World/pinacotheca/extracted/sprites/<category>/ | sort) \
     <(ls static/sprites/<category>/ | sort)
```
