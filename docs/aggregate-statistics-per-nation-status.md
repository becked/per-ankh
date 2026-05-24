# Aggregate statistics — per-nation panels, baked references, label polish

Continues `aggregate-statistics-charts-status.md` (the chart-redesign session).
That doc covered the page shell, the one-axis scope model, and the first pass of
chart-by-chart rework. **This doc covers the follow-on session**: per-nation
selector panels (Laws, Tech, Families), a baked law→class reference, succession /
turn-1 filtering, the Cities rework, the Map tab (built then removed), Nations
label/colour polish, and the global white-axis-label change.

Companion docs (still valid): `aggregate-statistics-design.md` (data-model
premise), `aggregate-statistics-redesign-status.md` (page shell/scope),
`aggregate-statistics-charts-status.md` (prior chart pass).

## State

Static checks pass (`npm run check`, `npm run lint`, `cd cloud && npm run
typecheck`, `npm run format:check` clean for touched files). **Not committed, not
deployed, no automated tests added, no full browser pass by the assistant** —
changes were reviewed locally chart-by-chart.

`BUNDLE_SCHEMA_VERSION` is **still 4** (the bump was made in the prior session and
has **not** shipped). We did **not** bump it again despite repeated bundle-shape
changes this session, because the pending v3→v4 flush on first deploy regenerates
every cache entry anyway. **Locally** the stats cache was cleared after each
Worker change by deleting `stats:%` keys from the miniflare KV sqlite:
`cloud/.wrangler/state/v3/kv/miniflare-KVNamespaceObject/7ad7a8…sqlite`
(`DELETE FROM _mf_entries WHERE key LIKE 'stats:%';`). Frontend-only changes need
no clear.

**Deploy ordering still matters**: the Worker now imports
`cloud/src/generated/law-classes.ts`, so Worker-before-frontend as usual.

## Stats subtabs now

Yields · Nations · Families · Laws · Cities · Tech. **Map was removed** (see §5).
Yields/Families/Laws/Tech are dedicated panels (special-cased in `StatsView`);
Nations and Cities go through the generic spec loop.

## 1. Per-nation panels + the shared selector

Three panels are driven by one **shared `NationSelect.svelte`** (extracted from
the duplicated bits-ui `Select` blocks): controlled (`value` / `options` /
`onChange`), labels via `nationLabel()`. It renders as a **sticky, left-aligned
bar styled like the Yields toolbar** (`sticky top-1 z-10 -ml-4`, `#241f1b`
chrome) so it pins while scrolling and aligns flush with the tab bars.

- **`ALL_NATIONS` sentinel** (`"__all__"`) + `nationLabel()` live in
  `charts/helpers.ts`. Every per-nation panel prepends `ALL_NATIONS` to its
  options and **defaults to it**.
- **Families** (`FamilyStatsPanel`): the "All nations" view aggregates pick/win
  across nations — flagged as confounded (family classes are pool-bound per
  nation) but kept as a rough overview default.
- **Laws** (`LawsStatsPanel`, replaced `OpeningLawsPanel`): one selector drives
  **both** the Law-adoption and opening-sequence charts.
- **Tech** (`TechStatsPanel`): one selector drives **both** first-tech and
  tech-timing.

**Worker mechanism for per-nation + "All":** `lawTiming`, `techFirst`,
`techTiming` carry a `nation` field **plus an explicit `__all__` aggregate row**
per item — because medians can't be recombined from per-nation medians, the
Worker computes the all-nations aggregate directly. `openingLaws` and
`familyByNation` are per-nation only; their "All" is summed **frontend-side**
(safe — they're counts). `nationByPlayer` (`(game,player)→nation`) is built once
near the top of `aggregate()` and shared by the law/tech sections.

## 2. Baked law→class reference (two-location emit pattern)

`scripts/bake-law-classes.ts` parses `Reference/XML/Infos/{law.xml,lawClass.xml}`
→ `.bake/law-classes.json` → `build-manifests.ts` emits the **same module to
both** `src/lib/generated/law-classes.ts` (frontend) **and**
`cloud/src/generated/law-classes.ts` (Worker, picked up by `cloud/tsconfig`'s
`src/**` include). `LAW_CLASSES` (`{laws, succession, techPrereq, startingLaw}`)
+ `LAW_TO_CLASS`. Added `bake:law-classes` to `package.json` + `bake:all`.

**This is the preferred pattern** for XML-derived data the Worker needs: emit to
both packages from one sidecar, no hand-maintenance. Contrast the older
`map-options` approach (hand-written `cloud/` mirror + an equality test) — that
still exists and could later migrate to the two-emit pattern, but we didn't touch
it.

Succession laws = the one class flagged `bSuccession` in `lawClass.xml`
(`LAWCLASS_ORDER`). `SUCCESSION_LAWS` is derived at the call site in
`aggregate.ts` from `LAW_CLASSES`.

## 3. Laws

- **Law adoption** (was "Law timing"): left-aligned labels, height resolver
  (~26px/row, de-scrunched), tooltip shows **median + IQR (P25–P75) + n**
  (`lawTiming` gained `p25_turn`/`p75_turn` via the existing `percentile()`
  helper). Per-nation (+`__all__`).
- **Opening law sequence** (was "First three laws"): now the **order-insensitive
  first 4 laws** (sorted set, joined " + "), grouped by nation, most-common at
  top. Title `"{nation} opening law sequence"`. (Note: order-insensitive but the
  title says "sequence" — intentional wording.)
- **Filters** (in `aggregate.ts`): the **timing** chart excludes succession laws
  **and** turn-1 adoptions (starting-law picks). The **opening** chart excludes
  succession only and **keeps turn-1** (the 4 are meant to track the in-game
  4-law unit-unlock breakpoint).

## 4. Tech

- Both charts: left-aligned labels, **turn-1 techs dropped** (nations are granted
  starting techs at game start), height resolvers (first capped 15, timing 25),
  timing subtitle dropped.
- Per-nation via `TechStatsPanel` (+`__all__` aggregate rows).

## 5. Cities + Map

- **Cities**: removed the old "City expansion pace" bucket chart entirely
  (and its `cityPace` bundle field). Replaced with **"Win rate by expansion
  speed"** — win rate bucketed by 5th-city founding turn (`cityTurnBucket`),
  over `selfRows`. Bundle field `expansionWinRate`.
- **Map**: a full Map tab was **built and then removed by request**. The
  removal also deleted the **map-class name bake** it depended on
  (`scripts/bake-map-class-names.ts`, `src/lib/generated/map-class-names.ts`,
  `charts/maps.ts`, `charts/summary.ts`, `MapStatsPanel.svelte`), the Worker map
  aggregations, and the `summaryMapWinRate` / `mapSummary` /
  `mapLengthByClassSize` bundle fields. **`games.map_class` / `map_size` columns
  and all non-stats consumers (parser, RecentSaveCard, GameDetailView) are
  untouched.** If maps come back, the C#-`GetName()` → `TEXT_MAP_NAME_*` → en-US
  bake (keyed by prefix-normalized script name) is documented in this session's
  history and worth recreating — it produced authoritative names ("Inland Sea",
  "Mediterranean", "Random") the heuristic `formatMapClass` gets wrong.

## 6. Nations + label polish

- **"Win rate"** (was "Win rate by nation"), **"Average final points"** (was
  "Average final points by nation", x-axis label also dropped).
- Avg-points bars recoloured to **copper `#C87941`** (matches the Win-rate
  chart's wins colour); dropped the per-nation civ colours.
- **Larger crest+name labels** on both Nations charts and the Families chart:
  `crestAxisLabel()` gained a `fontSize` param; nations/families now call it with
  icon `20` / font `14` (was `16` / default), `grid.left` `120→140`.
- **More row spacing** on the Nations charts via height resolvers (~34px/row).
- Families chart renamed **"{nation} families"** (dropped "classes" — not shown
  in-game).

## 7. Global: white axis labels

ECharts' default axis-label colour is a grey that the root `textStyle` doesn't
override, so labels read poorly on the dark background. Fixed globally by
registering a **`perankh` ECharts theme** in `Chart.svelte` (`<script module>`)
that defaults `categoryAxis`/`valueAxis`/`logAxis`/`timeAxis` `axisLabel.color` to
`#FFFFFF`, and init-ing every chart with it. **Affects all charts app-wide,
including game-detail** (shares `Chart.svelte`). Note: the header logo is actually
`text-gray-200` (#E5E7EB); we used pure white for max readability — switch the
nation labels to gray-200 if an exact logo match is wanted.

## 8. File map (this session)

- **New:** `scripts/bake-law-classes.ts`; `src/lib/generated/law-classes.ts` +
  `cloud/src/generated/law-classes.ts` (committed generated); `NationSelect`,
  `LawsStatsPanel`, `TechStatsPanel` (`src/lib/stats/`).
- **Deleted:** `OpeningLawsPanel` (→ LawsStatsPanel); and the Map set —
  `MapStatsPanel`, `charts/maps.ts`, `charts/summary.ts`,
  `generated/map-class-names.ts`, `scripts/bake-map-class-names.ts`.
- **Notable edits:** `cloud/src/stats/{aggregate,types}.ts`;
  `src/lib/stats/{types,StatsView}.ts(.svelte)`; `src/lib/stats/charts/{registry,
  helpers,nations,laws,tech,cities,families}.ts`; `src/lib/Chart.svelte`
  (theme); `scripts/build-manifests.ts` + `package.json` (law-classes bake).

## 9. Open threads / not done

- **Not committed / not deployed / no browser pass by assistant / no tests.**
- **Order-insensitive opening "sequence"** naming mismatch (kept intentionally).
- **Families "All nations"** pick-rate is across-pool confounded (acceptable as
  overview; per-nation is the clean view).
- **Family availability-normalization** still deferred (needs nation→class-pool
  reference) — carried over from the prior session.
- **`map-options` hand-mirror** could migrate to the two-emit bake pattern.
- **Schema bump**: if anything ships v4 before this work deploys, a fresh
  `BUNDLE_SCHEMA_VERSION` bump would be needed to flush stale caches; today it
  rides the pending v4.
- Tournament stats share `StatsView` + the same bundle, so all of this applies
  there too — not separately reviewed.
