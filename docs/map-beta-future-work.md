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
