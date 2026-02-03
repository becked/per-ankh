# Asset Support Proposal

This document captures ideas and considerations for adding game asset support to Per-Ankh, including 2D graphics (logos, icons) and 3D models (units, buildings, terrain).

## Motivation

Per-Ankh currently provides data visualizations and analytics for Old World save files. Adding visual assets from the game would enhance the experience:

- **Nation/family/religion logos** throughout the UI for visual identity
- **Unit and building viewers** with 3D models users can rotate and inspect
- **Enhanced map view** that renders the actual game terrain with zoom capability beyond what the game allows

## Asset Categories

### 2D Assets (Essential)

| Asset Type                 | Usage                                      |
| -------------------------- | ------------------------------------------ |
| Nation emblems             | Headers, legends, player identification    |
| Family crests              | Family displays, tooltips, genealogy views |
| Religion symbols           | Religion-related displays and filters      |
| Unit portraits             | Unit info panels, lists                    |
| Resource/improvement icons | Various info displays                      |

Estimated size: 10-30MB

### 3D Assets (Enhanced Features)

| Asset Type                 | Usage                         |
| -------------------------- | ----------------------------- |
| Unit models (animated)     | Unit info viewer, map overlay |
| Building models (animated) | Building info, city views     |
| Terrain meshes             | 3D map reconstruction         |

Estimated size: 400MB+ (full extraction is ~462MB)

## Licensing Approach

To avoid distributing copyrighted game assets, **Per-Ankh will extract assets from the user's own game installation**. This approach:

- Requires users to own Old World
- Keeps Per-Ankh legally clean
- Follows precedent set by mod managers and companion tools
- Means assets are extracted on-demand, not bundled with the app

## Technical Architecture

### Asset Extraction

**Source**: Old World's Unity `resources.assets` files

**Tool**: Python with [unitypy](https://github.com/K0lb3/UnityPy) library (most mature option for Unity asset extraction)

**Output formats**:

- 2D assets → PNG
- 3D models → GLTF/GLB (with animations, textures embedded)

**Rust alternatives explored** (for native integration):

- [unity-asset](https://crates.io/crates/unity-asset) - Exists but explicitly "not production-ready", labeled as learning exercise
- [io_unity](https://lib.rs/crates/io_unity) - Less documented

**Node.js alternatives explored**:

- [unity-parser](https://www.npmjs.com/package/unity-parser) - 9 years old, Unity 5.1.2 only
- [unitiyfs-asset-parser](https://developer.aliyun.com/mirror/npm/package/unitiyfs-asset-parser) - Pure JS, potentially viable but unproven

**Conclusion**: unitypy remains the most mature and reliable option. Extraction will be handled as a separate effort from the main Rust/Tauri app.

### Extraction Distribution Options

| Option                        | Pros                                                  | Cons                                            |
| ----------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| **Separate PyInstaller tool** | Main app stays lean (~5MB vs ~55MB), clear separation | Extra download step, two artifacts to maintain  |
| **Bundled PyInstaller**       | Seamless UX, single download                          | Adds ~50-80MB to app size                       |
| **User runs Python script**   | Simplest for us                                       | Requires Python installed, technical users only |
| **Invest in Rust crate**      | Native integration, long-term ideal                   | Significant development effort                  |

**Recommended**: Start with separate PyInstaller tool. Revisit bundling or Rust native once the feature proves valuable.

### Tiered Extraction

To manage the ~462MB total extraction size:

**Tier 1: 2D Assets Only** (default)

- Logos, icons, portraits
- Fast extraction, small footprint
- Enables UI enhancements without heavy storage

**Tier 2: 3D Assets** (opt-in)

- Unit and building models with animations
- Required for 3D viewer and enhanced map
- User explicitly enables in settings

### Frontend 3D Rendering

**Recommended stack**: [Three.js](https://threejs.org/) via [threlte](https://threlte.xyz/) (Svelte integration)

**Why Three.js over Babylon.js**:

- Smaller bundle (~150KB vs ~500KB+)
- Better fit for "3D embedded in 2D app" use case
- threlte provides idiomatic Svelte 5 components
- Larger community, more examples

**3D format**: GLTF/GLB

- Modern standard with excellent Three.js support
- Supports animations and PBR materials
- Single-file option (GLB) simplifies asset management

## Feature Specifications

### 1. 2D Asset Integration

**Scope**: Display nation, family, and religion logos throughout the app

**Implementation**:

- Extract PNGs during setup
- Store in app data directory
- Load via standard `<img>` tags or CSS backgrounds
- Graceful fallback to text/colored squares if assets unavailable

**User flow**:

1. Settings → Game Installation → Browse to Old World folder
2. App validates path (checks for expected files)
3. "Extract Assets" button triggers Tier 1 extraction
4. Progress indicator during extraction
5. App refreshes to show logos

### 2. Unit/Building Info Viewer

**Scope**: Dedicated view where users can inspect 3D models

**Features**:

- Orbit camera controls (rotate, zoom, pan)
- Animation playback (idle, attack cycles if available)
- Info panel with unit/building stats from XML data
- Search/filter to find specific assets

**Implementation**:

- threlte scene with OrbitControls
- GLTFLoader for model loading
- AnimationMixer for playback
- Lazy-load models on selection

### 3. Enhanced Map View

**Scope**: Render the game map with terrain, cities, units, and borders - with unlimited zoom

**Reference**: The game's 3D map view (see screenshots) showing:

- Hex-based terrain with elevation (hills, mountains)
- Biomes (grassland, forest, desert, water)
- Cities with visible buildings
- Units positioned on tiles
- Territory borders
- Named landmarks (rivers, mountains)

**Complexity assessment**: HIGH

This essentially requires building a game renderer. Components needed:

- Terrain mesh generation from heightmap data
- Biome texturing
- Hex grid positioning system
- Building/unit placement from save file data
- Border rendering
- Camera controls with zoom limits removed

**Data sources**:

- Save file: tile data, unit positions, city locations, borders
- Game assets: terrain textures, building models, unit models
- XML: terrain type definitions, asset mappings
- C# source: reference for how the game renders (available in `/Reference/Source/`)

**Phased approach**:

_Phase 1_: Enhanced 2D map with zoom

- Keep current abstract hex map
- Add smooth zoom (canvas/SVG scaling)
- Show more detail at higher zoom levels

_Phase 2_: Hybrid 2D/3D

- 2D base with 3D unit/building sprites overlaid
- Terrain remains stylized/abstract

_Phase 3_: Full 3D terrain

- Actual terrain meshes with elevation
- Full building and unit models
- Game-accurate rendering

**Recommendation**: Start with Phase 1, evaluate effort for subsequent phases after 2D assets and unit viewer are working.

## Open Questions

1. **Extraction timing**: On first run vs. explicit user action in settings?
   - First run risks slow startup and confusion
   - Settings action is more explicit but adds friction
   - Consider: prompt on first run, allow skip, remind in settings

2. **Asset updates**: What happens when Old World updates?
   - Re-extraction may be needed
   - Store extraction metadata (game version, timestamp)
   - Detect when game files are newer than extracted assets

3. **Cross-platform paths**: Where is Old World typically installed?
   - Steam: `~/.steam/steam/steamapps/common/Old World/` (Linux), standard Steam paths (Windows/Mac)
   - GOG: varies
   - Epic: varies
   - May need auto-detection logic for common paths

4. **Mesh orientation**: Unity assets have inconsistent "forward" directions
   - May need per-asset-type orientation offsets
   - XML asset definitions have rotation hints that could help
   - The extraction tool should handle this, outputting normalized GLTF

5. **Animation mapping**: How to determine which animations to include?
   - Units have idle, walk, attack, death animations
   - Need to map animation names consistently
   - Reference C# source for animation state machine logic

## Implementation Roadmap

### Phase 1: Foundation

- [ ] Create asset extraction tool (Python/unitypy)
- [ ] Define output format and directory structure
- [ ] Extract 2D assets (logos, icons)
- [ ] Add game installation settings UI
- [ ] Integrate 2D assets into existing UI

### Phase 2: 3D Viewer

- [ ] Add threlte dependency
- [ ] Extract 3D models to GLTF (with animations)
- [ ] Build unit/building viewer component
- [ ] Add info panel with game data

### Phase 3: Enhanced Map

- [ ] Implement 2D map zoom (Phase 1 of map)
- [ ] Evaluate feasibility of 3D terrain
- [ ] Reference C# source for rendering logic
- [ ] Prototype terrain rendering

## References

- [unitypy](https://github.com/K0lb3/UnityPy) - Python Unity asset extraction
- [threlte](https://threlte.xyz/) - Svelte Three.js integration
- [Three.js GLTF Loader](https://threejs.org/docs/#examples/en/loaders/GLTFLoader)
- Game reference files: `/Users/jeff/Desktop/Old World/Reference/`
  - `XML/Infos/asset.xml` - Asset registry (791 entries)
  - `XML/Infos/assetVariation.xml` - Rotation and variation rules
  - `Source/` - C# game code for rendering reference
