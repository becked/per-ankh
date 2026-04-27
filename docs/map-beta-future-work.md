# Map Beta: Future Work

Items deferred from the initial sprite-based map implementation. Each builds on the terrain + ownership foundation.

## Deferred Features

### Improvement/Resource/Specialist/City Icons (IconLayer)
Render actual game sprites for tile contents using deck.gl IconLayer with atlas textures. Atlases already exist in pinacotheca output (`improvement.webp`, `resource.webp`, `specialist.webp`, `city.webp`) — drop them into `assets/atlas-sources/` and extend `scripts/bake-atlases.ts` to process them, then they end up in `static/atlases/`. Religious building names need a swap lookup (DB: `IMPROVEMENT_MONASTERY_CHRISTIANITY`, sprite: `IMPROVEMENT_CHRISTIANITY_MONASTERY`). Each new layer should follow the memoize-on-tiles + `visible`-toggle pattern (see "Implementation Patterns" below).

### Additional Toggles
The Political and Religion toggles exist; remaining deferred toggles are City Sites, Capitals, Urban improvements, Rural improvements (and any future overlay). Each should be its own `$state(boolean)`, its own data prep memoized via `$derived.by(() => …)` keyed on `tiles`, and an always-built deck.gl layer whose `visible` is bound to the toggle. This keeps toggle latency at zero buffer rebuilds.

### Tooltips
Add a separate `PolygonLayer` covering all tiles with full hex polygons and a fully transparent fill (`getFillColor: [0,0,0,0]`) marked `pickable: true`, then wire `onHover` to surface tile details. A dedicated invisible picking layer keeps the visible overlays (PathLayer borders, religion fills) free of pickability concerns and produces consistent hit testing whether or not Political/Religion are toggled on. Tooltip content can reuse the builder from HexMap.

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

### Sprite Vertical-Flip Convention
Pinacotheca-extracted sprites are right-side-up in the source webp, but the SpriteMap's offscreen-canvas / deck.gl BitmapLayer pipeline consumes vertically-flipped content. The terrain and height atlases handle this in `scripts/bake-atlases.ts` — the bake applies a vertical flip alongside the bevel-clip — so the runtime can blit cells directly. When adding new atlas-backed layers (improvement/resource/specialist/city IconLayers), either route them through the same bake script so the flip is pre-applied, or apply the flip per-draw at runtime. The prospector's Pixi.js renderer takes a different approach (`(mapHeight - 1 - y) * spacing` in `hexToPixel` for screen coords, Y-down); reference: `~/Projects/Old World/prospector/docs/map-viewer-implementation.md` lines 222-229.

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
