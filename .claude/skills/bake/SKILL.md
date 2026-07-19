---
name: bake
description: >-
  Regenerate Per-Ankh's baked assets — terrain/hex/resource/improvement
  atlases, sprites, and the XML-derived data tables — via the `npm run bake:*`
  pipeline. Use when the user asks to bake or re-bake assets, after refreshing
  pinacotheca renders or `Reference/XML/`, or when a `zType`/sprite isn't
  rendering on the Map tab. NOT for routine coding.
metadata:
  type: project
  geometry-source: scripts/lib/atlas-bake.ts
---
# Asset Bake Pipeline

The sprite map's terrain, hex, resource, and improvement atlases are baked from a local [pinacotheca](https://github.com/becked/pinacotheca) checkout. Both source PNGs (`assets/atlas-sources/`) and outputs (`static/atlases/`, `static/sprites/`) are gitignored — bake locally on demand.

Shared cell geometry / hex masking lives in `scripts/lib/atlas-bake.ts` (`CELL_W=211`, `CELL_H=167`, `HEX_H_SPACING=199`, `HEX_V_SPACING=122`). `src/lib/SpriteMap.svelte` mirrors only the **HEX spacing** constants (`HEX_H_SPACING`/`HEX_V_SPACING`) — keep those two in sync between both sites. Cell dimensions are not mirrored: SpriteMap reads them at runtime from the atlas manifest (`cellWidth`/`cellHeight`, with literal `?? 211` / `?? 167` fallbacks).

## Commands

Assets, from a pinacotheca checkout:

```bash
npm run bake:terrain-3d        # Terrain atlas (terrain-3d.{webp,json})
npm run bake:improvements      # Improvements (base + per-family urban atlases) + nation-asset-aliases.json
npm run bake:resources         # Resource icons
npm run bake:sprites           # Misc sprites (crests, techs, units, laws, religions, yields, icons)
```

Data tables from `Reference/XML/`. These leave a `.bake/*.json` sidecar that `bake:finalize` turns into the committed TS module — running one of them alone changes nothing until finalize runs:

```bash
npm run bake:tech-names        # TECH_NAMES override table (in-game display names)
npm run bake:improvement-names # IMPROVEMENT_NAMES override table
npm run bake:difficulty-names  # DIFFICULTY_NAMES override table
npm run bake:game-option-names # GAME_OPTION_NAMES override table
npm run bake:goal-names        # GOAL_NAMES override table
npm run bake:victory-ordering  # Global victory ordering table
npm run bake:map-options       # Map option/script definition tables
npm run bake:law-classes       # Law class table (emitted to src/ AND cloud/src/)
npm run bake:specialists       # Specialist/class/eligible-improvement tables
```

Self-contained bakers — each writes its `src/lib/generated/` module directly, with no sidecar, so `bake:finalize` leaves them alone when they haven't been run:

```bash
npm run bake:science-yields    # science-yields.ts (from Reference/XML)
npm run bake:unit-stats        # unit-stats.ts (from Reference/XML)
npm run bake:map-caveats       # map-caveats.ts (needs an owtournamentatlas checkout)
npm run bake:owtt              # owtt.ts (needs a local owtt checkout, OWTT_DIR)
```

Then:

```bash
npm run bake:finalize          # Emits committed manifest TS modules + reconciles orphans
npm run bake:all               # Every baker above except unit-stats + owtt (15), then finalize
```

`bake:all` deliberately omits `bake:unit-stats` and `bake:owtt` — rerun those by hand when their sources change. Separately, `bake:favicon` / `bake:og` generate site icons and OG images, and `bake:screenshots` / `ux:review` drive Playwright capture for UX review (output under `docs/ux-review/`).

## Adding a name-override table

The five `*-names` bakers are the same script with the nouns swapped, and `bake-game-option-names.ts` is the newest copy to crib from. The shape: read the info XML's `<zType>` + name key, resolve that key against every merged `text-*.xml` `<en-US>`, run it through `stripMarkup` (which already resolves OW's `link(...)` markup and plural forms), and **emit only entries whose resolved name differs from `formatEnum`** so the table holds real overrides and everything else falls through at runtime. Wiring a new one means four edits to `scripts/build-manifests.ts` (sidecar path const, `read*Sidecar`, `emit*Ts`, and the read/format/write/log quartet in `main`) plus a `package.json` entry in both `bake:*` and `bake:all`.

Reach for a table whenever a `zType`'s display name might diverge from its enum — that divergence is common and not cosmetic. `GAMEOPTION_NO_BONUS_IMPROVEMENTS` is "No Ancient Ruins" in game, `GAMEOPTION_PLAY_TO_WIN` is "Ruthless AI", and every `DIFFICULTY_*` was remapped wholesale. Assuming `formatEnum` is good enough is how wrong names ship.

## Content-hashed paths

Every baked output (atlas `.webp`/`.json` pair, every sprite PNG, `nation-asset-aliases.json`) is content-hashed. The filename embeds the first 8 hex chars of `sha256(outputBytes)` (e.g. `static/atlases/terrain-3d.a1b2c3d4.webp`). Direct unhashed URLs no longer resolve — `curl http://localhost:1420/atlases/terrain-3d.webp` returns 404.

Resolve URLs at runtime via the generated manifests:

- `ATLAS_MANIFEST` and `NATION_ALIASES_URL` from `$lib/generated/atlas-manifest`
- `SPRITE_MANIFEST` from `$lib/generated/sprite-manifest`
- `TECH_NAMES` from `$lib/generated/tech-names` (tech display-name overrides from `Reference/XML/Infos/text-infos.xml`; use as `TECH_NAMES[t] ?? formatEnum(t, "TECH_")` so non-overridden techs fall through to the generic formatter)

The XML bakers above also emit committed data tables (not URL manifests) under `src/lib/generated/`: `difficulty-names.ts`, `game-option-names.ts`, `goal-names.ts`, `improvement-names.ts`, `victory-ordering.ts`, `map-option-defs.ts`, `map-script-options.ts`, `law-classes.ts`, `specialists.ts`. `law-classes.ts` is emitted twice — to `src/lib/generated/` and `cloud/src/generated/` — from the one sidecar, so never hand-mirror it.

These manifest/data modules are committed to git and regenerated by `npm run bake:finalize` (which also runs reconcile and asserts every referenced atlas/sprite file exists). The intermediate JSON sidecars are gitignored under `.bake/` (one per data baker, plus `{atlas,sprite}-manifest.json`). An empty/missing `{atlas,sprite}-manifest.json` throws, but a **missing data sidecar reads as an empty map and finalize happily emits an empty table** — so run the data baker before finalize, or you'll silently blank a table that was fine a minute ago. Hand-editing the generated TS modules will fail the existence check on the next bake; add a new asset by re-running the appropriate baker.

Hashed paths get `Cache-Control: immutable, max-age=1y` via `_headers` at the repo root (and mirrored in `web/static/_headers` for the legacy share viewer).

## Re-bake when

- Pinacotheca ships refreshed renders.
- `Reference/XML/` is refreshed against a current Old World install (picks up new DLC `zType`s, nation aliases, and tech display-name changes).

`zType`s present in saves but absent from `Reference/XML/` silently won't render until Reference is updated. The bake logs any `zType → zIconName` whose target is missing and falls those `zType`s back to a generic city sprite.

Visually inspect the `Map` tab in the dev server after re-baking. Bakes are deterministic: re-running with no source changes should produce byte-identical generated TS modules (`git diff src/lib/generated/` shows nothing).
