# Aggregate statistics — Stats-tab chart redesign status

Follows on from `aggregate-statistics-redesign-status.md`. That doc covered the
page shell (Overview · Games · Stats tabs), the one-axis scope model, and the
Games table. **This doc covers the Stats-tab chart catalog itself** — the charts
were reworked chart-by-chart for legibility, several were cut, and the tab /
subtab chrome was restyled. Session date: 2026-05-24.

Companion docs: `aggregate-statistics-redesign-status.md` (page shell/scope, still
valid), `aggregate-statistics-design.md` (data-model premise, still valid).

## Where we are

Static checks pass (`npm run check`, `npm run lint`, `npm run format:check`, `cd
cloud && npm run typecheck`). **Not committed, not deployed, no manual browser
pass.** The Worker (`cloud/src/stats/`) changes only take effect against local
`wrangler dev` or after a deploy (Worker before frontend). The stats cache schema
`BUNDLE_SCHEMA_VERSION` **was bumped** (2 → 3 for the yields shape → 4 for
`familyByNation.wins`), so the cache fully regenerates on first read. Separately,
there is **no D1 migration and no `PARSER_VERSION` bump** (a different version, for
the save parser) — every new field derives from existing D1 columns.

The Stats tab is rendered by `StatsView.svelte`: bits-ui category **subtabs**
(`?category=`), one category at a time. Yields and Families are dedicated
interactive panels; the rest go through the generic spec loop + `ChartContainer`.

## 1. Catalog now (per subtab)

- **Yields** (first / default) — `YieldsStatsPanel`. One chart per series.
- **Nations** — Win rate by nation (stacked wins/losses bar); Average final
  points by nation (bar).
- **Families** — `FamilyStatsPanel`. One per-nation chart, nation selector.
- **Laws** — Law timing; First three laws.
- **Cities** — City expansion pace.
- **Tech** — First tech; Tech timing.
- **Map** — Win rate by map size.

`Rulers` is gone entirely (see §5).

## 2. Yields — `YieldsStatsPanel.svelte`

Replaced the single chart + 16-chip selector with **one chart per yield, stacked**
(mirrors game-detail's YieldsTab). Each chart shows the corpus **median (P50)
line**, an optional **P25–P75 band** (stacked transparent-P25 + filled IQR area),
and an optional **sample-size overlay** (games-per-turn on a faint secondary
axis). Tooltip always shows median / P25–P75 / n.

Page-level controls live in a **sticky floating bits-ui `Toolbar`** at the top of
the panel (stays put while scrolling the ~16-chart stack): Per-Turn / Cumulative
(`ToggleGroup`), P25–P75 band on/off, Game count on/off. Defaults: per-turn, band
on, count off. Axis names removed (the yield is the chart title, x is turns); the
secondary "Games" axis keeps its name.

Backend (`aggregate.ts loadYieldCurves`): rewritten to pull **raw per-(game,turn)
rows** (rate + cumulative columns) and compute **P25/P50/P75 per turn per series
Worker-side** (`percentile()` helper; `YIELD_COLUMNS` table), plus `counts` per
turn. Stocks (`military_power`, `legitimacy`) have no cumulative column, so their
`cumulative` band mirrors `rate`. Bundle shape: `yieldCurves: { turns, counts,
series: Record<key, { rate: YieldBand; cumulative: YieldBand }> }` where
`YieldBand = { p25, p50, p75 }`.

## 3. Families — `FamilyStatsPanel.svelte` (rethought from scratch)

**Why:** family class is a _player choice_ — each nation offers a pool (4
classes, 6 for Maurya) and you pick 3 — but it's pool-bound, so cross-nation
charts (the old heatmap, combos, omitted) were confounded and unreadable. Two
questions matter: _which classes do players pick for a given nation_, and _do some
win more_. Both are inherently **per-nation**.

Chart: a **nation selector** (bits-ui `Select`, defaults to most-played) above
**paired horizontal bars per pool class — Pick rate and Win rate — on a shared
0–100% axis**, sorted by pick rate, crest+name left-aligned labels, title
`"{Nation} family classes"`. No legend (tooltip distinguishes). Colors: pick
`getChartColor(0)` (copper), win `getChartColor(5)` (goldenrod) — deliberately
distinct (they were copper/peru = near-identical at one point).

Data (no reparse): `familyByNation` now carries `wins` per `(nation, class)`;
pick rate = `count ÷ nation games` (from `nationWinRate`), win rate = `wins ÷
count`. The availability-normalized "pick rate ÷ times available" and a
pool-relative "snub" chart were **deferred** — they need a nation→class-pool
reference baked from `nation.xml` + `family.xml`, which we chose not to build yet.

## 4. Nations

- **Win rate by nation** — horizontal **stacked wins/losses bar** (copper wins
  `#C87941` / muted-tan losses `#5a4d3f`); bar length = games, split = rate.
  Sorted by **games played desc** (most at top). Considered (and dropped) a
  lollipop and a vs-sample-size scatter.
- **Average final points by nation** — horizontal bar, civ-colored.

Both use crest+name left-aligned y labels (see §6).

## 5. Removed

- **Rulers subtab** — all of it: archetype performance, trait appearance, popular
  combos, archetype matchup, reign/succession win rate, survival. Frontend +
  backend aggregation + bundle fields. `starting_ruler_archetype` is **kept**
  (feeds the Overview `top_archetype` summary); `starting_ruler_traits`,
  `starting_ruler_reign_turns`, `succession_count` base columns dropped.
- **Counter-pick effectiveness** (nations heatmap) + **ruler archetype matchup** —
  both head-to-head charts gone, plus `buildSlotLookup` / `buildUserHeadToHead`
  and the `TournamentMatchPairing` / `pairings` plumbing in `resolve.ts`
  (tournament corpus now just collects `game_id`s).
- **Family**: class win rate (dual-axis), class popularity, omitted class, top
  combinations, nation×class heatmap — all replaced by §3.

## 6. Centralized / cross-cutting

- **`crestAxisLabel()`** (`charts/helpers.ts`) — shared builder for a left-aligned
  category axis label = crest icon + name (name-only fallback). Used by Nations
  (`CREST_NATION_*`) and Families (`CREST_ARCHETYPE_*`, the class crest art).
  Caller supplies a `crestUrl` fn + `margin ≈ grid.left`. Axis `data` must be raw
  enum values (tooltips format via `dataIndex`).
- **`getNationChartColor()`** moved to `$lib/config` (single source); game-detail's
  `getPlayerColor` is now an alias. Stats charts use it instead of re-inlining
  `getCivilizationColor(...) ?? getChartColor(i)`.
- **`fmtClass` bug fix** — was `formatEnum(v, "CLASS_")` against `FAMILYCLASS_*`
  values (unanchored `.replace` → "Familychampions"); now `"FAMILYCLASS_"`.
- **Tan removed** — chart text accents `#D2B48C` → `CHART_THEME.textStyle.color`
  (theme white), matching game-detail.
- **Axis-title convention** — `AXIS_NAME_X` / `AXIS_NAME_Y` (`nameLocation:
"middle"` + `nameGap`) applied across the value-axis charts, mirroring
  game-detail.

## 7. Tab / subtab chrome

- **Stats subtabs** — floating chip bar: `#241f1b` bg, `#2a2622` border, rounded,
  `shadow-lg`; chips active `#35302B` / inactive `#2a2622`, `text-tan`, borderless.
- **Page tabs** (Overview/Games/Stats, `users/[user_id]/+page.svelte`) — restyled
  to the **same chip style**, moved **inside a `#35302B` light-brown panel** that
  wraps the tab bar + (transparent) tab contents.
- **Spacing** — tab→subtab and subtab→content are both a single 16px margin
  (`mb-4` on each bar; content panels carry no top padding — `px-4 pb-4`).
- A two-row "nest the subtabs into the tab bar" experiment was tried and
  **reverted** — the page tabs and stats subtabs are separate stacked bars.

## 8. File map (this session)

**New:** `src/lib/stats/{YieldsStatsPanel,FamilyStatsPanel}.svelte`.

**Deleted:** `src/lib/stats/charts/rulers.ts`.

**Notable edits:** `src/lib/stats/StatsView.svelte`; `charts/{registry,helpers,
nations,families,yields,laws,cities,tech,summary}.ts`; `src/lib/stats/types.ts`;
`src/lib/config/{nations.ts,index.ts}`; `src/lib/game-detail/helpers.ts`
(`getPlayerColor` alias); `src/routes/users/[user_id]/+page.svelte` (tab chrome);
cloud — `stats/{aggregate,types,cache,resolve}.ts`.

## 9. Not done / deferred

- **Not committed, not deployed, no browser pass.** Suggested manual pass: every
  subtab renders; Yields toggles (per-turn/cumulative no-op for the two stocks;
  band off = median only; count overlay) + sticky toolbar while scrolling; Family
  nation selector + crest labels + distinct bar colors; Nations crest labels;
  ECharts image labels load (crests pop in a beat after first paint, then redraw).
- **Tournament stats** (`/tournaments/[slug]/stats`) shares `StatsView` + the same
  bundle, so all these chart changes (and the Rulers removal) apply there too —
  not separately reviewed this session.
- **Family availability-normalization** (pick-rate ÷ available; pool-relative
  "snub") — needs a baked `nation → family-class pool` reference from
  `Reference/XML` (`nation.xml` + `family.xml`). Deferred.
- **Schema bump (`BUNDLE_SCHEMA_VERSION = 4`)** is backward-incompatible (added
  `familyByNation.wins`, new `yieldCurves` shape) → full cache regen on deploy.
