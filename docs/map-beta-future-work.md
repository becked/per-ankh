# Map Beta: Future Work

Items deferred from the initial sprite-based map implementation. Each builds on the terrain + ownership foundation.

## Deferred Features

### Territory Borders (PathLayer)
Colored border lines at hex edges where ownership changes. The prospector uses 5 stacked PathLayers at decreasing widths/increasing opacity for a glow effect. Requires neighbor comparison logic to identify border edges.

### Improvement/Resource/Specialist/City Icons (IconLayer)
Render actual game sprites for tile contents using deck.gl IconLayer with atlas textures. Atlases already exist in pinacotheca output (`improvement.webp`, `resource.webp`, `specialist.webp`, `city.webp`) — need to be bundled into `static/atlases/`. Religious building names need a swap lookup (DB: `IMPROVEMENT_MONASTERY_CHRISTIANITY`, sprite: `IMPROVEMENT_CHRISTIANITY_MONASTERY`).

### Toggle Controls
Layer visibility toggles for ownership overlay, borders, improvements, resources, specialists, cities. deck.gl layers with `visible: false` have zero GPU cost.

### Tooltips
Make ownership PolygonLayer pickable, wire up `onHover` callback to show tile details. Can reuse tooltip content builder from HexMap.

### Turn Slider / Playback
Reuse the existing turn change callback pattern (`onTurnChange` prop). Terrain compositing runs once per turn change (~50ms), so playback should be smooth.

### Fullscreen Mode
Native `<dialog>` with a second Deck instance, same pattern as HexMap.

### Color Mode Switching
The sprite map inherently shows terrain + political ownership. Additional modes (religion, resource, height, vegetation) could override the ownership overlay color or switch to analytical flat-color view.

### City Name Labels (TextLayer)
Text labels below city center tiles. Deferred because it depends on city IconLayer being in place.

## Known Visual Issues

### Ownership Polygon Misalignment
The PolygonLayer hex polygons (using radii 120x88 from the atlas reference) don't perfectly align with the terrain sprite hex masks. Visible as a slight offset between the ownership tint and the terrain hex border. Needs investigation — could be the documented radii being slightly different from the actual sprite mask, or BitmapLayer texture interpolation shifting the rendered image at certain zoom levels.

### Extra Water Tiles at Coastlines
Our map renders more water tiles than the game shows at coastlines (e.g., 4 water tiles west of a coastal city where the game shows 2). The land and mountain tiles match correctly, so this isn't a coast-vs-ocean terrain type issue. Troubleshooting steps:
1. Check if the row offset `(y+1)%2` is inverted — try `y%2` and compare coastlines. Wrong offset shifts every other row by half a hex, which at vertical coastlines adds/removes a visible water tile per row.
2. Check if the DB includes tiles beyond the game's playable boundary that the game doesn't render (fog-of-war, map edges). Compare tile count against `map_info.width * map_info.height` if available.
3. Pick specific coastal tiles from the screenshot, find their (x,y) coordinates, and check what terrain/height values the DB has for them vs their neighbors.

### Hex Grid Borders
Dark borders visible between adjacent terrain tiles. These are baked into the terrain sprites from the game's art style (hex grid lines are part of the 3D rendering). Not a compositing bug. Could potentially be addressed in pinacotheca's masking pipeline by clipping a few pixels further inward, but this is cosmetic.

### Map Orientation / Sprite Flipping
Atlas sprites from pinacotheca are stored with Y=0 at bottom (Unity texture convention). The SpriteMap compositing flips each sprite vertically via `ctx.scale(1, -1)` during `drawImage`. When adding future IconLayers for improvements/resources/etc., these will need the same vertical flip treatment — or pinacotheca could be updated to flip sprites at extraction time, which would be cleaner.

The prospector's `hexToPixel` uses `(mapHeight - 1 - y) * spacing` to flip Y for Pixi.js (screen coords, Y-down). Per-ankh uses `y * spacing` with no negation, relying on deck.gl's Y-up coordinate system to put north at top. Both produce the same visual result. Reference: `~/Projects/Old World/prospector/docs/map-viewer-implementation.md` lines 222-229.

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
