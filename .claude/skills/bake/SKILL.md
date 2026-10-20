---
name: bake
description: >-
  Regenerate Per-Ankh's baked assets — terrain/hex/resource/improvement
  atlases, sprites, and the XML-derived data tables — via the `npm run bake:*`
  pipeline. Use when the user asks to bake or re-bake assets, after refreshing
  pinacotheca renders or `Reference/XML/`, or when a `zType`/sprite isn't
  rendering on a game's map view. NOT for routine coding.
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
npm run bake:sprites           # Misc sprites (crests, techs, units, laws, religions, yields, projects, resources, effect-units, icons)
```

Data tables from `Reference/XML/`. These leave a `.bake/*.json` sidecar that `bake:finalize` turns into the committed TS module — running one of them alone changes nothing until finalize runs:

```bash
npm run bake:tech-names        # TECH_NAMES override table (in-game display names)
npm run bake:improvement-names # IMPROVEMENT_NAMES override table
npm run bake:difficulty-names  # DIFFICULTY_NAMES override table
npm run bake:game-option-names # GAME_OPTION_NAMES override table
npm run bake:goal-names        # GOAL_NAMES override table
npm run bake:name-text         # NAME_TEXT override table (character names)
npm run bake:nation-names      # NATION_NAMES override table (Hatti, Tamilakam)
npm run bake:project-icons     # PROJECT_ICON table (project zType → its 2D icon name)
npm run bake:project-names     # PROJECT_NAMES override table
npm run bake:victory-ordering  # Global victory ordering table
npm run bake:map-options       # Map option/script definition tables
npm run bake:law-classes       # Law class table (emitted to src/ AND cloud/src/)
npm run bake:specialists       # Specialist/class/eligible-improvement tables
```

Self-contained bakers — each writes its `src/lib/generated/` module directly, with no sidecar, so `bake:finalize` leaves them alone when they haven't been run:

```bash
npm run bake:science-yields    # science-yields.ts (from Reference/XML)
npm run bake:unit-stats        # unit-stats.ts (src/ AND cloud/src/; unit name/strength/tech/
                               # naval/cycle + bonus-card grants — the Worker copy is what
                               # the challenge scorer reads, and `unitName` reads the name)
npm run bake:atlas-pool        # atlas-pool.ts (src/ AND cloud/src/; needs an owtournamentatlas checkout)
npm run bake:family-pools      # cloud/src/generated/family-pools.ts — each nation's
                               # family pool, the baseline every cut rate is measured against
npm run bake:owtt              # owtt.ts (needs a local owtt checkout, OWTT_DIR)
npm run bake:momentum          # momentum.ts (src/ AND cloud/src/; fits on a local blob corpus)
npm run bake:family-opinion    # family-opinion.ts (opinion bands + their city-upkeep effect)
npm run bake:character-opinion # character-opinion.ts (the coefficients a character's opinion
                               # of their own leader is summed from, and the bands that sum
                               # falls in — one of which modifies the strength of any unit
                               # that character leads)
npm run bake:effect-units      # effect-units.ts (the effect units a unit can carry — its
                               # type's, its promotions' and its general's traits' — each
                               # one's game name, its <zIconName> glyph, the six columns the
                               # game's own attack and defense are summed from, and the
                               # display gate resolved per unit type)
npm run bake:improvement-builds # improvement-builds.ts (src/ AND cloud/src/; worker-turn build
                               # cost per improvement, plus the in-place upgrade chains the
                               # challenge scorer reads)
npm run bake:starting-techs    # starting-techs.ts (each nation's starting techs)
npm run bake:family-colors     # family-colors.ts (each family's in-game colour)
npm run bake:civilization-colors # civilization-colors.ts (each nation's and tribe's in-game
                               # colour, plus the base nation roster the /stats facet offers)
npm run bake:yield-colors      # yield-colors.ts (each yield's chart colour)
npm run bake:orders-sources    # orders-sources.ts (orders-per-turn + legitimacy constants)
npm run bake:power-tiers       # power-tiers.ts (military-power comparison tiers)
npm run bake:cognomens         # cognomens.ts (cognomen → legitimacy + display string)
npm run bake:trait-names       # trait-names.ts (TRAIT_NAMES override table — 105 of the 306
                               # traits, self-contained rather than sidecar+finalize, so a
                               # checkout that hasn't run it keeps the committed table
                               # instead of getting an empty one; the only name baker that
                               # resolves a link() against another info table, since
                               # TRAIT_ENVOY_TO_THE_HUNS names a tribe)
npm run bake:wonders           # wonders.ts (src/ AND cloud/src/)
npm run bake:dynasty-traits    # dynasty-traits.ts (src/ AND cloud/src/; the traits the game
                               # ties to a historical ruler) + leader-traits.ts (frontend only)
npm run bake:theology-tiers    # theology-tiers.ts (src/ AND cloud/src/; each theology's tier)
```

Not a table baker at all — `bake:challenge-mirror` regenerates the Worker's copy of the challenge scorer from the frontend source, the way `bake:momentum -- --mirror-only` does for momentum. It reads no XML, and it is in `bake:all`, so a full bake leaves no mirror stale; `cloud/src/challenges/mirror.test.ts` fails when an on-disk mirror isn't what the transform produces:

```bash
npm run bake:challenge-mirror  # cloud/src/challenges/{scoring,types}.ts from src/lib/challenges/
```

Then:

```bash
npm run bake:finalize          # Emits committed manifest TS modules + reconciles orphans
npm run bake:all               # Every baker above except owtt + momentum, then finalize
```

`bake:all` runs 37 of the 39 bakers above, then `finalize`. The fences above group them by route, not by run order — which lives only in the `bake:all` chain in `package.json`, where a new baker goes at the position it needs to run. It deliberately omits `bake:owtt` and `bake:momentum` — rerun those by hand when their sources change. Membership doesn't follow from what a baker reads: `bake:atlas-pool` needs an owtournamentatlas checkout and is in `bake:all`, while `bake:owtt` needs one of its own and isn't — so a new baker records its choice here either way. Separately, `bake:favicon` / `bake:og` generate site icons and OG images, and the UX-review bundle under `docs/ux-review/` is captured by `./per-ankh ux-review` (a CLI command, not an npm script).

## Adding a name-override table

The eight `*-names` bakers are the same script with the nouns swapped, and `bake-game-option-names.ts` is the copy to crib from when the text carries `link(...)` markup, `bake-name-text.ts` when it doesn't. The shape: read the info XML's `<zType>` + name key, resolve that key against every merged `text-*.xml` `<en-US>`, run it through `stripMarkup` (which already resolves OW's `link(...)` markup and plural forms), and **emit only entries whose resolved name differs from `formatEnum`** so the table holds real overrides and everything else falls through at runtime.

Two ways to land the output, and the choice is the one decision worth making. The sidecar route — seven of the eight — means four edits to `scripts/build-manifests.ts` (sidecar path const, `read*Sidecar`, `emit*Ts`, and the read/format/write/log quartet in `main`) plus a `package.json` entry in both `bake:*` and `bake:all`. The self-contained route — `bake-trait-names.ts`, cribbing its emit from `bake-character-opinion.ts` — writes `src/lib/generated/` directly and needs no `build-manifests.ts` edit at all, which also means `bake:finalize` can't empty the table in a checkout where that baker hasn't run. Prefer it for a new table; the seven predate it.

Two wrinkles the newer bakers handle. OW packs a string's grammatical variants into one `~`-separated field — `TEXT_NATION_HITTITE` is `Hatti~Hittite~a Hittite~Hittites` (noun ~ adjective ~ member ~ plural) — so take field 0 for the display form. And some infos reach their text through a second hop: `nation.xml` names a `<GenderedName>` that `genderedText*.xml` maps per grammatical gender to the `TEXT_*` key (take the masculine row) — `bake-nation-names.ts` is the one that does this.

Reach for a table whenever a `zType`'s display name might diverge from its enum — that divergence is common and not cosmetic. `GAMEOPTION_NO_BONUS_IMPROVEMENTS` is "No Ancient Ruins" in game, `GAMEOPTION_PLAY_TO_WIN` is "Ruthless AI", and every `DIFFICULTY_*` was remapped wholesale. Assuming `formatEnum` is good enough is how wrong names ship.

## Content-hashed paths

Every baked output (atlas `.webp`/`.json` pair, every sprite PNG, `nation-asset-aliases.json`) is content-hashed. The filename embeds the first 8 hex chars of `sha256(outputBytes)` (e.g. `static/atlases/terrain-3d.a1b2c3d4.webp`). Direct unhashed URLs no longer resolve — `curl http://localhost:1420/atlases/terrain-3d.webp` returns 404.

Resolve URLs at runtime via the generated manifests:

- `ATLAS_MANIFEST` and `NATION_ALIASES_URL` from `$lib/generated/atlas-manifest`
- `SPRITE_MANIFEST` from `$lib/generated/sprite-manifest`
- `TECH_NAMES` from `$lib/generated/tech-names` (tech display-name overrides from `Reference/XML/Infos/text-infos.xml`; use as `TECH_NAMES[t] ?? formatEnum(t, "TECH_")` so non-overridden techs fall through to the generic formatter)

The XML bakers above also emit committed data tables (not URL manifests) under `src/lib/generated/`: `difficulty-names.ts`, `game-option-names.ts`, `goal-names.ts`, `improvement-names.ts`, `name-text.ts`, `nation-names.ts`, `project-icons.ts`, `victory-ordering.ts`, `map-option-defs.ts`, `map-script-options.ts`, `law-classes.ts`, `specialists.ts`. `law-classes.ts` and `nation-names.ts` are each emitted twice — to `src/lib/generated/` and `cloud/src/generated/` — from the one sidecar, so never hand-mirror them.

These manifest/data modules are committed to git and regenerated by `npm run bake:finalize` (which also runs reconcile and asserts every referenced atlas/sprite file exists). The intermediate JSON sidecars are gitignored under `.bake/` (one per data baker, plus `{atlas,sprite}-manifest.json`). An empty/missing `{atlas,sprite}-manifest.json` throws, but a **missing data sidecar reads as an empty map and finalize happily emits an empty table** — so run the data baker before finalize, or you'll silently blank a table that was fine a minute ago. Hand-editing the generated TS modules will fail the existence check on the next bake; add a new asset by re-running the appropriate baker.

Hashed paths get `Cache-Control: immutable, max-age=1y` via `_headers` at the repo root.

## Re-bake when

- Pinacotheca ships refreshed renders.
- `Reference/XML/` is refreshed against a current Old World install (picks up new DLC `zType`s, nation aliases, and tech display-name changes).

`zType`s present in saves but absent from `Reference/XML/` silently won't render until Reference is updated. The bake logs any `zType → zIconName` whose target is missing and falls those `zType`s back to a generic city sprite.

Visually inspect the `Map` tab in the dev server after re-baking. Bakes are deterministic: re-running with no source changes should produce byte-identical generated TS modules (`git diff src/lib/generated/` shows nothing).
