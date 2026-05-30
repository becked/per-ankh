# owreference — data extraction pipeline

How the [owreference](https://github.com/alcaras/owreference) site turns Old
World's shipped game files into the structured JSON it renders. Written as a
reference for consuming or replicating that data from a sibling project.

> **TL;DR** — Every fact on the site is a deterministic projection of the
> game's own XML. A sync step mirrors the Steam install's `Reference/` folder,
> ~28 per-domain Python builders parse that XML (sharing one "humanizer" engine
> that renders effect trees into readable strings), and each emits a
> sort-stable `src/data/<thing>.json`. Astro imports those JSON files at build
> time and inlines them into static HTML for GitHub Pages. The JSON is **not**
> served as standalone files on the live site.

---

## 1. Source of truth: the game's XML

Old World ships its own data as XML inside the Steam install:

```
~/Library/Application Support/Steam/steamapps/common/Old World/Reference/XML/Infos/*.xml
```

These files (`nation.xml`, `family.xml`, `tech.xml`, `improvement.xml`,
`effectCity.xml`, `bonus.xml`, `color.xml`, `text-*.xml`, …) are the single
source of truth. owreference's guiding rule:

- **XML wins on facts.** If the XML says `+10 SCIENCE/City`, that's what
  renders — regardless of any human note that says otherwise.
- Nothing on the site is hand-authored "content." Re-running the pipeline after
  a game patch updates the site automatically.
- The legacy reference spreadsheet (`.xlsx`) is **read-only history**. It seeded
  a small annotation layer on day one and is never consulted afterward.

Both owreference and per-ankh point at the same install — per-ankh via its
`Reference ->` symlink, owreference via an `rsync` mirror (below).

---

## 2. The pipeline (`make patch`)

The whole flow is five `make` targets:

```
make patch  =  sync  →  art  →  data  →  changelog  →  build
```

| Stage         | Script(s)                  | Output                                                     |
| ------------- | -------------------------- | ---------------------------------------------------------- |
| **sync**      | `scripts/sync_patch.sh`    | `reference/XML/`, `reference/Graphics/`, `data/patch.json` |
| **art**       | `scripts/extract_art.py`   | `public/img/...` sprites (UnityPy)                         |
| **data**      | ~28 × `scripts/build_*.py` | `src/data/*.json`                                          |
| **changelog** | `scripts/changelog.py`     | `CHANGELOG.md` (diff of JSON snapshots)                    |
| **build**     | `npx astro build`          | `dist/` static site                                        |

Per-patch operator flow: `make patch` → review `CHANGELOG.md` → `git push` →
GitHub Actions deploys.

---

## 3. sync — mirror the install

`scripts/sync_patch.sh`:

```bash
rsync -a --delete \
  --include 'XML/***' \
  --include 'Graphics/***' \
  --exclude '*' \
  "$INSTALL/Reference/" "$ROOT/reference/"
```

- Source install is `$OW_INSTALL` (defaults to the standard Steam path); the
  script aborts if it isn't found.
- Only `XML/` and `Graphics/` are pulled. (`Mods/`, `Source/` and other binary
  game assets are deliberately excluded to keep the repo small.)
- `reference/XML/Infos/*.xml` is therefore a **verbatim, never-hand-edited
  mirror** of the game. Quirks in the data are papered over in the build
  scripts, never by editing the synced XML.
- It also writes `data/patch.json` (a build tag + UTC sync timestamp) used to
  tag changelog snapshots.

---

## 4. data — the `build_*.py` scripts

This is the heart of the pipeline. There is **one builder per domain**, all run
by the `data:` make target:

```
build_data.py            (nations — the flagship, ~825 lines)
build_families.py        build_tribes.py          build_wonders.py
build_laws.py            build_urban_buildings.py build_rural_improvements.py
build_specialists.py     build_harvest_events.py  build_theologies.py
build_world_religion_buildings.py                 build_shrines.py
build_technologies.py    build_promotions.py      build_unit_damage.py
build_jobs.py            build_opinion.py         build_trait_inheritance.py
build_study_events.py    build_archetypes.py      build_cognomens.py
build_stats.py           build_missions.py        build_mission_catalog.py
build_mapscripts.py      build_conversion.py
build_entities.py        build_backlinks.py        ← run last (registries)
```

### Anatomy of a builder

Every builder follows the same shape. Using `build_families.py` as the
canonical example:

1. **Read the relevant XML.** A family class draws from `familyClass.xml`,
   `family.xml`, `effectCity.xml`, `bonus.xml`, plus `text-*.xml` for display
   names.
2. **Pull fields out of the XML tree**, applying documented game quirks in code
   with a comment explaining why. (E.g. read a family's `abNation` before its
   `TeamColor`, because the game data has a `TEAMCOLOR_NATION_YEUZHI` typo —
   `E` before `U` — that doesn't match `NATION_YUEZHI`.)
3. **Call the humanizer** to convert raw effect references into readable
   strings (see §5).
4. **Emit deterministic JSON:**
   ```python
   OUT.write_text(json.dumps(data, indent=2, sort_keys=True,
                             ensure_ascii=False) + "\n")
   ```
   `sort_keys=True` is load-bearing: stable key ordering makes the patch-to-patch
   changelog diff meaningful.

The output of `build_families.py` is a list of family-class objects, each with
`cityBonus`, `seatBonus`, `seatFounding`, `opinions`, `luxuries`, `favored`,
`preferredLaws`, and the list of `nations` that have the class — all derived
from XML.

### Two registry builders run last

- **`build_entities.py` → `entities.json`** — a registry of 367+ entities with
  an alias index. Powers the site's "everything is a link" cross-referencing
  (any mention of `Egypt`, `Wood`, `Orders` resolves to its entity page).
- **`build_backlinks.py` → `backlinks.json`** — a PKM-style backlink graph
  (every entity page shows what links to it).

---

## 5. The humanizer (`scripts/humanize.py`) — shared engine

The XML does not store readable text. It stores **structured effect trees**: an
`EffectCity` points at yield-rate pairs, percentage modifiers, conditions, and
unlock references, all cross-referenced by ID across multiple files. The
humanizer (~787 lines) walks those trees and renders one-line human strings. It
is imported by essentially every builder.

Key entry points:

| Function                                                      | Purpose                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load_xml_indexes(xml_dir)`                                   | Preload + index ~13 cross-referenced XML files (`effectCity`, `effectPlayer`, `effectUnit`, `bonus`, `tech`, `trait`, `promotion`, `improvement`, `law`, `project`, `religion`, `resource`, `specialist`) so builders resolve references by ID |
| `render_effect_city(entry, …)`                                | Per-city / flat yield effects                                                                                                                                                                                                                  |
| `render_effect_player(…)` / `render_effect_player_scalars(…)` | Player-wide effects, bool/int/pct scalars                                                                                                                                                                                                      |
| `render_effect_unit(entry)`                                   | Pillage / kill / fatigue effects                                                                                                                                                                                                               |
| `render_bonus(entry, indexes)`                                | Stockpile, free units, free projects                                                                                                                                                                                                           |
| `render_nation_effects(effect_player_id, indexes)`            | All effects for a nation                                                                                                                                                                                                                       |
| `render_shrine_effects(improvement_entry)`                    | Shrine yield output + tile modifiers                                                                                                                                                                                                           |

### Encoding quirks the humanizer normalizes

- **Yields are stored 10×.** `YIELD_SCIENCE +10` renders as "+1 Science"
  (divide by 10 for display).
- **Link markup is stripped.** Game strings contain `{lowercase:link(TOKEN,N)}`
  templates; these collapse to plain words ("Token Words").
- Handles `aiYieldRate`, `aiYieldModifier`, `aaiEffectCityYieldRate`,
  `aaiTileYieldRate*`, `aiImprovementClassModifier`, `aiMilitaryKillYield`,
  nested `<EffectPlayer>` → `TEXT_PROJECT_*` ("Unlocks X"), and many more.
  New fields are added to the humanizer as builders encounter them.

---

## 6. The annotation fallback layer

A small `src/data/annotations/*.yaml` layer exists for content the
XML/humanizer can't yet express cleanly. The rules are strict:

- **XML always wins.** YAML is a provisional curation layer, migrated into
  XML-driven rendering over time.
- Coverage is shrinking — currently only a couple of DLC nations
  (Aksum/Tamil) fall back to YAML for partial fields, and even those now have
  some XML coverage.
- Don't treat the YAML as authoritative; treat it as "not humanized yet."

---

## 7. How the JSON reaches the page (and why it isn't a public API)

The generated `src/data/*.json` files are **imported as ES modules at build
time**:

```js
// src/pages/nations.astro
import nations from "../data/nations.json";
```

During `astro build`, Astro inlines those values directly into the rendered
HTML/JS. Consequences:

- The data is **baked into the static pages** — there is no runtime data fetch.
- The JSON is **not** emitted as a standalone file. `src/data/` lives under
  `src/`, not `public/`, so it is never served at a URL.
  `https://alcaras.github.io/owreference/data/nations.json` returns **404**.
- Only `public/` is copied verbatim to the deploy root, and it currently holds
  just `img/`.

GitHub Pages does serve assets with `access-control-allow-origin: *`, so _if_
these files were exposed (e.g. copied into `public/data/`) they'd be
cross-origin fetchable. But as deployed today there is no data endpoint.

### Consuming this data from another project

Prefer the **repo** over the **deployed HTML**:

1. **Read `src/data/*.json` directly** from a checkout / git submodule of
   owreference. This is the clean, structured form.
2. **Or run the builders yourself** against the shared `Reference/` install
   (per-ankh already symlinks it) to regenerate the JSON independently.
3. Avoid scraping the deployed HTML — the inlined JSON shape is an internal
   build artifact with no stability contract; keys can change any patch when
   `make data` regenerates everything.

---

## 8. End-to-end data flow

```
Steam install:  Reference/XML/Infos/*.xml
        │
        │  scripts/sync_patch.sh   (rsync --delete, XML + Graphics only)
        ▼
   reference/XML/Infos/*.xml        (verbatim mirror — never hand-edited)
        │
        │  scripts/build_*.py  +  scripts/humanize.py   (+ YAML fallback)
        ▼
   src/data/*.json                  (deterministic, sort_keys=True)
        │
        │  astro build   (import JSON as ES modules → inline into HTML)
        ▼
   dist/  static HTML  ──▶  GitHub Pages
```

---

## 9. Quirks worth knowing (carried from owreference)

- **Yuezhi typo:** `family.xml` uses `TEAMCOLOR_NATION_YEUZHI` while the nation
  is `NATION_YUEZHI`. Always read `abNation` first; alias the color entries.
- **Yields are 10× display values** everywhere — divide by 10.
- **Shrine type = signature yield** (WAR→training, WISDOM→science, SUN→orders,
  WATER→money, …). It's a fixed mapping, not stored per-shrine.
- **`Mods/`, `Source/`, and `Graphics/` binaries are excluded** from the repo;
  the data pipeline only reads `reference/XML/Infos/`.
- **Game-data quirks are fixed in build scripts, not upstream.** The synced XML
  is the user's Steam install — never edit it; paper over quirks in Python with
  a comment.

---

_Source: `/Users/jeff/Projects/Old World/owreference` — see its `CLAUDE.md`,
`Makefile`, `scripts/humanize.py`, and `scripts/build\__.py`.\*
