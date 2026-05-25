# Aggregate statistics

The analysis surface at `/users/[user_id]` — a tabbed view (Overview / Games /
Stats) over a single user's save library, with one scope selector driving every
tab. The Stats tab renders ~22 charts across six categories (Yields, Nations,
Families, Laws, Cities, Tech) from a single cached `ChartBundle`.

This doc is the durable record of the feature as built. It supersedes the
`aggregate-statistics-*-status.md` session docs (removed) and the
`aggregate-statistics-design.md` draft — several of that draft's decisions were
revised during the build (see "What changed from the original design").

## The surface

- **`GET /v1/users/:user_id`** — public profile (display name, avatar, all-time
  summary card). `cloud/src/users.ts` → `handleUserProfile`.
- **`GET /v1/users/:user_id/stats`** — the `ChartBundle` for one scoped corpus.
  `cloud/src/stats/handlers.ts` → `handleUserStats`.
- Frontend: `src/routes/users/[user_id]/` (page + load). Tabs, scope, and
  Games-tab filters all live in the URL. `/dashboard` and the old
  `/users/[user_id]/stats` route 308/307-redirect here.

## Core idea: a chart catalog over a variable corpus

The feature separates two things the old site fused: the **corpus** (the set of
saves analyzed) and the **chart catalog** (visualizations that run over whatever
corpus is selected). The chart-computing layer takes an **opaque list of
game-ids** as input — never a user-id directly — so the corpus is resolved
behind one seam:

```
scope selection ──▶ resolveUserCorpus ──▶ { gameIds, userId, display_name } ──▶ buildChartBundle
```

This game-id-list seam (`cloud/src/stats/resolve.ts` → `cloud/src/stats/aggregate.ts`)
is the one piece deliberately kept general. A future corpus type (a tournament,
"all public saves", free assembly) is just another resolver feeding the
identical chart layer.

> **History:** v1 originally shipped a second corpus type — tournament stats —
> behind a `CorpusContext` discriminated union. That was removed: the union
> forced tournament data into a nation-shaped mold and bought nothing a real
> tournament-stats redesign would reuse. The corpus is now user-only and charts
> are honestly nation-keyed. See "Future work" for how tournament stats should
> return.

## The scope predicate (keystone)

`cloud/src/games-scope.ts` is the single source of "what's in scope":

- `buildUserScopeWhere({ scope, viewerOwnsTarget })` returns the SQL
  `AND`-fragment + binds to append after a base `WHERE user_id = ?`.
- `parseScopeParam(raw)` parses the `?scope` query param.

Both the **Games list** (`handleGameList`) and the **stats corpus**
(`resolveUserCorpus`) build their `WHERE` from it, so the games table and the
aggregate numbers cannot desync on which saves are in scope. The
`scope_counts` shown on the scope selector (`handleCollectionsList`) mirror the
same predicates.

Scope is one mutually-exclusive selection:

| Scope             | Predicate                                   |
| ----------------- | ------------------------------------------- |
| `all`             | none                                        |
| `public`          | `is_public = 1`                             |
| `vs_ai`           | not tournament-linked AND exactly one human |
| `mp`              | not tournament-linked AND ≥2 humans         |
| `tournament`      | linked to a `tournament_matches` row        |
| `<collection_id>` | `collection_id = ?` (owner-only)            |

**Identity visibility composes on top** via `viewerOwnsTarget`: a visitor/anon
viewing someone else's library is forced to `is_public = 1` and cannot select a
private collection (the existence of private collections must not leak via
0-count splits). The `?user_id` targeting block (validate 21-char nanoid →
derive `viewerOwnsTarget`) is implemented identically in `handleGameList` and
`handleCollectionsList`.

## Data model: aggregate from existing rows, no new pipeline

There is **no separate stats-extraction pipeline and no dedicated stats
columns**. The bundle is computed on cache-miss by aggregating the
`player_summaries` rows already derived at upload (`cloud/src/derive-player-summary.ts`)
plus the `games` table. No D1 migration and no parser bump were needed to ship
the feature.

Aggregator (`cloud/src/stats/aggregate.ts`) notes:

- **`is_uploader = 1` is "self".** For the user corpus the bundle reports the
  uploader's own picks (nation, family classes, law/tech timing, win rate), not
  opponent AI rows.
- **D1 bind-param cap** — `gameIds` are chunked (`CHUNK_SIZE`) so every
  `IN (?, ?, …)` stays under the per-statement parameter limit; each SQL pass
  loops chunks and merges in JS.
- **Per-turn yield curves** re-average across chunks weighted by per-chunk
  sample count (`sums += avg * count`, then `sums / counts`) to a corpus-wide
  curve.
- **Empty corpus** — `buildChartBundle` short-circuits to a fully-shaped empty
  bundle when `gameIds.length === 0`. Every bundle field is always present; the
  frontend renders per-chart empty-state cards, never expects an undefined
  field.

## Caching

KV-backed, reusing the existing `SESSIONS_KV` binding under a `stats:` prefix
(`cloud/src/stats/cache.ts`). No client `Cache-Control` header — Worker-side
only (a leaked `max-age` broke `invalidateAll` in the standings episode; the
same mistake is available here).

Key shape:

```
stats:v{BUNDLE_SCHEMA_VERSION}-p{parser_version}:user:{user_id}:{viewerScope}:{scope}
```

- `viewerScope` (`self` | `public`) keeps owner and visitor views in separate
  entries so a private upload can't leak into the public-scope cache.
- `parser_version` (`CURRENT_PARSER_VERSION`) in the key means a parser bump
  naturally orphans every old entry — there's no separate `stats_schema_version`.
- `BUNDLE_SCHEMA_VERSION` (currently **4**) is a manual flush lever: bump it when
  the `ChartBundle` shape changes in a backwards-incompatible way. Data-only
  changes (a new chart over existing fields) need no bump.
- **Invalidation** is a prefix walk (`invalidateStatsCache`) over every
  viewerScope × scope variant for the user, fired on upload, patch, and delete
  in `cloud/src/games.ts`. 24h TTL is the safety net.

## ChartBundle and the chart catalog

`cloud/src/stats/types.ts` is canonical; `src/lib/stats/types.ts` mirrors it —
when the bundle shape changes in the Worker, mirror it on the frontend.

The frontend treats each named bundle field as an opaque slice for one chart's
ECharts option builder. The catalog is declarative:

- `src/lib/stats/charts/registry.ts` — `CATEGORIES` (nav order) and
  `CHART_SPECS` (one entry per chart: `hasData`, height, empty message).
- `src/lib/stats/charts/*.ts` — the option builders.
- `src/lib/stats/StatsView.svelte` — renders categories as subtabs. Nations and
  Cities go through the generic spec loop; **Yields, Families, Laws, Tech** are
  dedicated panels (per-nation selectors, multi-chart layouts), with a
  category-anchor `CHART_SPECS` entry that exists only to surface the subtab.
- Per-nation panels share `NationSelect` with an `ALL_NATIONS` sentinel; the
  bundle carries an `__all__` aggregate row per law/tech so "all nations" needs
  no client-side median recombining.

**Adding a chart over existing data:** add a field to `ChartBundle` (both type
files), populate it in `aggregate.ts`, add a `CHART_SPECS` entry + an option
builder. No Worker schema bump unless the change is backwards-incompatible.

Law→class reference (used by the Laws/Families panels) is baked from
`Reference/XML` by `scripts/bake-law-classes.ts` and emitted byte-identically to
both `src/lib/generated/law-classes.ts` and `cloud/src/generated/law-classes.ts`
via the two-emit pattern in `scripts/build-manifests.ts` (`npm run bake:finalize`).

## Known limitations / caveats

- **Opening-laws "sequence" is order-insensitive** — `openingLaws` groups the
  first four enacted laws as a _sorted set_, so the "sequence" label is a
  deliberate naming mismatch (the four track the in-game unit-unlock breakpoint,
  not enactment order).
- **Families "All nations" pick-rate is across-pool confounded** — aggregating
  pick rate across nations mixes different family pools; treat the all-nations
  view as approximate.
- **Family availability-normalization deferred** — `familyOmittedClass` uses a
  hardcoded `ALL_CLASSES` list rather than introspecting the corpus.
- **Profile-card summary vs Overview are computed separately.** The profile
  header (`handleUserProfile`) computes win rate / favorite day / favorite
  nation over the user's _whole, unscoped_ library; the Overview tab computes
  the same shapes _scoped_ in `aggregate.ts`. This is intentional (the header
  sits above the scope selector and shouldn't move with it) but means two SQL
  implementations of "win rate" and "modal weekday" must stay aligned.
- **No aggregator tests.** Option builders are presentation code; the SQL/JS
  aggregations have no fixture-driven test. The natural one if drift becomes a
  concern is a single fixture → `ChartBundle` round-trip.
- **Calendar heatmap remounts on scope change** (`OverviewTab.svelte`, keyed on
  `save_dates`) — ECharts' calendar + custom-series doesn't re-render correctly
  through an in-place `setOption`.

## Future work

- **Tournament stats (fuzzy, someday).** When it returns, generalize the
  **chart layer over a group-by dimension** (nation | participant), not the
  corpus type: `NationSelect` → an entity selector, `ALL_NATIONS` → a generic
  `ALL`, the crest axis label → a dimension-aware label resolver, nation-keyed
  bundle fields → key-keyed. Do **not** resurrect the `CorpusContext` union.
  Decide then whether tournament-only charts (standings, head-to-head, round
  progression) belong to a separate set rather than the shared layer.
- **Chart catalog gaps needing new extraction** (each requires a
  `parser_version` bump + admin reparse-all, which already supports this):
  pick-order win rate (column dropped in migration 0004), city distribution by
  class and city production strategies (per-city data lives in the R2 blob, not
  D1), family-opinion charts, event-category timeline (events not in D1 outside
  tech/law), military unit-type breakdown.
- **Out of v1 scope, seam preserved:** cross-user / "all public saves"
  aggregation and free assembly. The game-id-list corpus seam keeps these open;
  the cost they add is caching (an arbitrary game-id set hashes to a poor
  hit-rate key), not the chart layer.

## What changed from the original design

`aggregate-statistics-design.md` (removed) was a pre-implementation draft. The
parts that survived: the query-tool framing, the opaque game-id-list seam, and
"no client cache header." The parts that were revised in build:

- Tournament corpus and the `CorpusContext` union were built, then removed
  (user-only now).
- No pre-extraction into dedicated D1 stat columns — the bundle aggregates
  existing `player_summaries`/`games` rows on cache-miss.
- No `stats_schema_version` — `CURRENT_PARSER_VERSION` + `BUNDLE_SCHEMA_VERSION`
  in the cache key play that role.
- No provisional / mid-tournament banner (it was tournament-only chrome).

## Deploy ordering

Worker before frontend: the bundle shape and the `/v1/users/:id/stats` route
lead the client, and the Worker imports `cloud/src/generated/law-classes.ts`. A
`BUNDLE_SCHEMA_VERSION` bump flushes the cache on first deploy.
