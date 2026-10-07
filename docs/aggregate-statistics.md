# Aggregate statistics

The analysis surface at `/users/[user_id]` — a tabbed view (Overview / Games / Stats) over a single user's save library, with one scope selector driving every tab. The Stats tab's categories are `CATEGORIES` in `src/lib/stats/charts/registry.ts` and are not restated here — they sat three categories stale in this sentence, which is what a list copied out of the registry does. All but one render from a single cached `ChartBundle`; Records fetches its own payload (see "The record boards" below).

This doc is the durable record of the feature as built. It supersedes the
`aggregate-statistics-*-status.md` session docs (removed) and the
`aggregate-statistics-design.md` draft — several of that draft's decisions were
revised during the build (see "What changed from the original design").

## The surface

- **`GET /v1/users/:user_id`** — public profile (display name, avatar, all-time
  summary card). `cloud/src/users.ts` → `handleUserProfile`.
- **`GET /v1/users/:user_id/stats`** — the `ChartBundle` for one scoped corpus.
  `cloud/src/stats/handlers.ts` → `handleUserStats`.
- **`GET /v1/stats`** — the `ChartBundleCore` for one **global** corpus: a composition slice of every `is_public = 1` game, optionally faceted to one nation. `handleGlobalStats`, same module. Frontend: `src/routes/stats/`. See "The global corpus" below.
- **`GET /v1/users/:user_id/stats/records`**, **`GET /v1/stats/records`**, **`GET /v1/tournaments/:id/stats/records`** — the `RecordsBundle` for the same three corpora, on the same selection each bundle endpoint takes. One per surface because the Records tab is the only consumer and the payload is ~60–70 KB gzipped; see "The record boards" below.
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

That prediction has since been cashed twice, and both times the resolver really was the whole cost: `resolveTournamentCorpus`, and then `resolveGlobalCorpus` for the public corpus behind `/stats`. The seam held — `buildChartBundle` still takes an opaque id list and a focal mode and nothing else.

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

## The global corpus

`/stats` (`src/routes/stats/`) runs the same chart catalog over the **whole public corpus** instead of one library. `is_public = 1` is the entire visibility rule, and it already means "public because the uploader said so, **or** because it is a tournament game" — tournament-linked uploads force the flag, and a game linked to a match in a non-`complete` tournament can't be un-published. So no union predicate and no viewer-dependent half: every caller gets the same bytes.

**Slices and the facet.** The selection is a **composition slice** plus an optional **nation facet**, both in the URL (`?slice=`, `?nation=`), both parsed forgivingly the way `?scope=` is — and parsed a second time client-side (`src/lib/stats/global-facets.ts`) so the controls light the selection the Worker actually answered with. The slices are `all` (every public game), `duel` (exactly two players, both human), `ffa` (≥3 humans) and `single_player` (exactly one human), and they **do not partition the corpus**: a two-human game with any AI matches none of the three compositions and appears only under `all`. Default is `duel`, because ~94% of public games are 1v1 — the all-public numbers *are* the duel numbers, so landing on the label that describes the distribution beats landing on a superset. The composition predicates are shared helpers in `cloud/src/games-scope.ts`, and unlike the user-scope ones they **count players, not humans** (`HAVING COUNT(*) = 2 AND SUM(is_human) = 2`), which is what keeps a 2-human + 2-AI game out of the duel bucket.

**A nation narrows twice.** The corpus becomes the slice's games holding at least one seat of that nation, *and* the focal set becomes those seats. Both, not either: narrowing only the games feeds the opponent's rows into a bundle labelled for one nation, and narrowing only the focal set leaves `meta.game_count` reporting the whole slice — a control that visibly fails to move a headline number. This is the rule the `lawTiming`/`techTiming` bug broke, and why it was found here.

**Precomputed whole.** 13 playable nations × 4 slices + the 4 unfaceted slices = **56 selections**, all of them enumerable, which is what makes the cache tractable. `cloud/src/stats/precompute.ts` builds them nightly on **one cron pattern per slice** — both the 1,000-query and the 128 MB ceilings are charged per invocation, so a pattern each buys a fresh budget and a fresh isolate. A separate hourly pattern re-warms only the four *unfaceted* bundles and only when missing (a deploy is what orphans keys, since both key version segments are Worker-compiled). Every pattern stays at an interval ≥ 1 hour to hold the 15-minute CPU tier. Staging declares the stats patterns and **not** the retention sweep's, so the dispatch in `scheduled` matches by exact pattern with no fallback.

**A miss always computes.** Precomputation is an optimization, never a dependency — `handleGlobalStats` computes in-request on a miss and never refuses. That is what keeps the facet model a UI decision: widening to multi-select later would cost the nightly table, not the architecture, which is also why the resolver, the cache key and the handler all take a nation **set** while the UI sends one value.

**Access.** Session-gated, checked *before* the rate limit so a refused call spends no budget. Not because the payload is viewer-dependent — it isn't — but because an anonymous caller could otherwise trigger a whole-corpus aggregation, which would put the abuse ceiling and the cold-start ceiling on the same knob. Its own per-IP budget (`global_stats_view`, `GLOBAL_STATS_VIEW_PER_HOUR = 600`) rather than a share of `anon_read`, for the reason the tournament budgets are separate from each other. The cost of the gate is conceded rather than answered: `/stats` no longer brings anyone to the site, and link-preview bots get a `401` (scraper User-Agents are exempt from the *budget*, never from authentication), so a shared URL unfurls as the home page. The route bounces anonymous visitors to login carrying `?next=`, so the selection survives the round trip.

**Nation options are the roster, not the payload.** A faceted bundle reports only the nation it was faceted to, so the option list can't be read off it, and fetching the unfaceted slice alongside would double a page load's budgeted reads. The list is `Object.keys(NATION_COLORS)` — so a nation with no seat in the selected slice is still offerable and resolves to the empty state. `listGlobalSliceNations` already computes the seated set for the precompute, so the fix, if the thin slices ever earn it, is an **optional** `facet_nations` field with the roster as its fallback (optional, so it costs no schema bump).

**The per-panel `NationSelect` is hidden here.** Families/Laws/Tech each carry one, and at panel level it's right — every field those panels draw is nation-keyed, so it's a free client-side row filter. On `/stats` it asks the same question the page facet answers, so `StatsView` takes `showNationSelect` (default `true`) and the route passes `false`. The profile and tournament stats pages keep theirs: neither has a page-level facet.

Design record: `docs/global-stats-design.md`, which keeps the plan and marks each place the build diverged from it.

## Data model: aggregate from existing rows, no new pipeline

There is **no separate stats-extraction pipeline and no dedicated stats
columns**. The bundle is computed on cache-miss by aggregating the
`player_summaries` rows already derived at upload (`cloud/src/derive-player-summary.ts`)
plus the `games` table. No D1 migration and no parser bump were needed to ship
the feature.

Aggregator (`cloud/src/stats/aggregate.ts`) notes:

- **`is_uploader = 1` is "self".** For the user corpus the bundle reports the uploader's own picks (nation, family classes, law/tech timing, win rate), not opponent AI rows. `focal: "humans"` widens "self" to every human seat, for the tournament and global corpora; the two sites that decide it are `buildSelfMembership` and `loadYieldCurves`'s `selfClause`.
- **A field is focal only if it filters on `selfMembership`.** Deciding the population is not the same as consulting it, and `lawTiming`/`techTiming` did not — they aggregated every seat in the corpus's games, so a user's profile pooled their opponents' laws and techs into charts labelled as the user's. Fixed 2026-08-29 at the loop that feeds them; the nation facet on `/stats` is what made it visible (a Rome bundle carrying Greek laws), but the bug was always on the profile. **Adding a bundle field means saying which population it draws from**, and `cloud/test/integration/stats/round-trip.test.ts` states the invariant for both focal modes.
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
(`cloud/src/stats/cache.ts`).

**No client `Cache-Control` header on the per-viewer surfaces** — Worker-side only (a leaked `max-age` broke `invalidateAll` in the standings episode; the same mistake is available here). The two global endpoints — `GET /v1/stats` and `GET /v1/stats/records` — are the exceptions, and the reason is the rule rather than a hole in it: each payload is byte-identical for every viewer, so both carry `public, max-age=0, s-maxage=60` — a *shared*-cache directive with the browser cache still at zero, the same header `channels.ts`/`featured.ts`/`tournament/public.ts` put on their public reads. They share one `globalStatsResponse` helper, so the header cannot drift between them.

Key shape — one variant per corpus, each holding two payloads:

```
stats:v{BUNDLE_SCHEMA_VERSION}-p{parser_version}:user:{user_id}:{viewerScope}:{scope}
stats:v{BUNDLE_SCHEMA_VERSION}-p{parser_version}:tournament:{tournament_id}:{updated_at}
stats:v{BUNDLE_SCHEMA_VERSION}-p{parser_version}:global:{slice}:{nations}
```

The chart bundle lives at the key as written; the record boards live at that same key with a **`:records`** segment appended. The segment goes last rather than beside the version so the two suffixes stay disjoint — `getStaleGlobalCached` matches on a key's tail, and a marker in front of `global:` would have the bundle's serve-stale walk find a records entry. Everything ahead of the segment is shared, so both payloads expire on one TTL, drift on the same version bumps, and are caught by the single prefix walk in `invalidateStatsCache`.

- `viewerScope` (`self` | `public`) keeps owner and visitor views in separate
  entries so a private upload can't leak into the public-scope cache.
- `parser_version` (`CURRENT_PARSER_VERSION`) in the key means a parser bump
  naturally orphans every old entry — there's no separate `stats_schema_version`.
- `BUNDLE_SCHEMA_VERSION` is a manual flush lever: bump it when the `ChartBundle` shape changes — a dropped field, or a new one. Data-only changes (a new chart over fields the bundle already carries) need no bump. The current value and what each version changed live in `BUNDLE_SCHEMA_CHANGELOG` (`cloud/src/stats/cache.ts`), which is the source of truth. This doc deliberately doesn't restate the number: it sat four versions stale here before it was noticed.
- `nations` on the global variant is **normalized** — sorted and deduped before stringifying — so one selection has one spelling however the caller ordered it. Trivial while the facet is single-select, and it is what would make widening it to multi-select a UI change rather than a key migration.
- **Serve-stale, global variant only.** The key carries two version segments and exactly one is safe to reach across: a `parser_version` bump orphans entries without changing the bundle's shape, so the previous one is merely stale, while a `BUNDLE_SCHEMA_VERSION` bump changes the shape and a consumer on the new shape would break on it. `getStaleGlobalCached` therefore pins the schema in its prefix and leaves only the parser open, and the recompute runs behind `ctx.waitUntil`. Only the global corpus wants it — a user or tournament bundle is cheap enough to just recompute on the request that missed.
- **Invalidation** is a prefix walk (`invalidateStatsCache`), fired from `cloud/src/games.ts`. Upload, patch and delete pass `{kind:"user"}`, which takes every viewerScope × scope variant for that user. Admin reindex passes `{kind:"all"}` and takes the whole prefix — it re-derives `game_player_turn` for one game at the same parser version, which no key drifts on, and that game is counted by the tournament corpus and every global slice as well as its owner's. 24h TTL is the safety net.

## ChartBundle and the chart catalog

`cloud/src/stats/types.ts` is canonical; `src/lib/stats/types.ts` mirrors it —
when the bundle shape changes in the Worker, mirror it on the frontend.

**Two shapes, a structural subtype rather than a union.** `ChartBundleCore` is every field whose aggregation is correct over either focal set; `ChartBundle` extends it with the fields that assume one focal player per game. The tournament and global endpoints return the core, the user endpoint the extension, and `buildChartBundle` is overloaded on the `focal` literal so the caller gets the right one without a runtime check. There is no discriminant field — which is the point, and the lesson of the removed `CorpusContext` union: a builder typed against the core renders either shape.

What lives in the extension: `win_rate`, `games_with_outcome`, `summary.top_nation`, `summary.top_archetype` — and, since schema 9, `save_dates`. That last one is *not* there because the all-humans reading would be wrong (it is per-game, so it would be fine); it is there because only the profile Overview calendar renders it, and it was the one bundle field whose size grew with the corpus instead of with the turn axis — which a whole-site corpus is what makes matter. Its loader moved with it, so a core bundle costs nine chunked query loops where the user bundle costs ten — ten queries per chunk and eleven, since `loadRecordIdentity` carries two in its one loop (see below). `favorite_day_of_week` was deleted outright at the same version: the profile card reads its own copy from `GET /v1/users/:user_id`, and the bundle's copy had no consumer anywhere.

The frontend treats each named bundle field as an opaque slice for one chart's ECharts option builder. The catalog is declarative:

- `src/lib/stats/charts/registry.ts` — `CATEGORIES` (nav order) and `CHART_SPECS` (one entry per chart: `hasData`, height, empty message).
- `src/lib/stats/charts/*.ts` — the option builders.
- `src/lib/stats/StatsView.svelte` — renders categories as subtabs. Four categories go through the generic spec loop (**Nations, Leaders, Wonders, Cities**); the other six are dedicated panels with a category-anchor `CHART_SPECS` entry that exists only to surface the subtab — **Families, Families fielded, Laws, Tech** for their per-nation selectors, **Yields** for its per-series chart stack, and **Game length** because `turnLength` is one object rather than a row per nation, so the panel is four stat cells over a turn-count histogram. **Records** is the seventh panel and the exception to the pattern: it has no spec at all, because its payload is not in the bundle and asking the Worker up front just to decide whether to draw the tab would spend the read the split exists to save — so `StatsView` lists it unconditionally.
- Per-nation panels share `NationSelect` with an `ALL_NATIONS` sentinel; the bundle carries an `__all__` aggregate row per law/tech so "all nations" needs no client-side median recombining.

Game length is also the first category keyed to a **per-game** fact rather than to a game entity — every other tab is keyed to nations, leaders, wonders, families, laws, cities or techs. A second per-game stat (victory type, map size) belongs beside it in that tab rather than in one of its own.

**Adding a chart over existing data:** add a field to `ChartBundle` (both type files), populate it in `aggregate.ts`, add a `CHART_SPECS` entry + an option builder. Adding the field is a `BUNDLE_SCHEMA_VERSION` bump — see § Caching for the rule and how to bump it; only a chart drawn from fields the bundle already carries escapes one.

Law→class reference (used by the Laws/Families panels) is baked from
`Reference/XML` by `scripts/bake-law-classes.ts` and emitted byte-identically to
both `src/lib/generated/law-classes.ts` and `cloud/src/generated/law-classes.ts`
via the two-emit pattern in `scripts/build-manifests.ts` (`npm run bake:finalize`).

## The record boards

The leaderboard behind the yield bands: per yield series, the biggest numbers posted and the seat that posted them. A `RecordsBundle` rather than a `ChartBundle` field, served by the three `/records` endpoints above.

**Why it is a separate payload.** At 24 board keys x 7 boards x 10 rows the records are ~60-70 KB gzipped on top of a 154 KB bundle, only one tab of one surface reads them, and before the split every stats request on all three surfaces paid for them. They are **built together and stored apart**: `buildChartBundle` returns `{ bundle, records }` from the one pass over `game_player_turn`, and both payloads are written under the one cache key (the `:records` segment, under "Caching"). A miss on either key builds and writes both, which is what lets the nightly precompute go on deciding from the bundle key alone and makes the Records tab's fetch a KV read in the steady state.

**"No new query" is about `game_player_turn` only.** The records ride the rows the bands already read, but `loadRecordIdentity` adds two queries of its own, in one chunked loop — `player_summaries` for the record holder's seat, `games` for the turn count and the save's own id. That is the `× 8` → `× 10` in `docs/global-stats-design.md` §4.1.

**Ranking is per seat, not per row**, so a long game cannot take three adjacent turns of one board, and the two uploads of one duel collapse on the save's `xml_game_id` before anything is ranked — which is also what keeps each board's advertised population equal to the one it ranks. The survivor of that collapse is the upload that saw more turns, and on the tie the lower `game_id`: both uploads of a finished duel saw all of it (192 of 202 multi-upload seats in the 2026-09-22 snapshot), so without the second rule the survivor would be D1's row order and the cached payload would not be a function of the corpus. The ranking sort carries the same tiebreak for the same reason — `Array.sort` is stable, so equal values would otherwise keep the order the rows arrived in, which at an early checkpoint decides which of several tied seats make the top ten.

**A row names the record holder's seat and nobody else** — a duel, an FFA and a single-player game render identically, with no per-mode branch. `recordGames[].seats` therefore carries holders only: the five AI a single-player game was won against are payload nothing would read. Its seat fields are `nation` and `player_name`, deliberately not `online_id`.

**Three series get no board at all** — maintenance, happiness and discontent. A leaderboard asserts "biggest is best" and for those the biggest number is a burden; they keep their bands, which make no such claim. Military power and legitimacy are levels rather than flows, so they ship a rate board and no cumulative one, and the panel drops a card on an absent board rather than keeping its own list of which series are levels.

**What the cumulative column means** differs by series — lifetime production for one set, the stockpile held at that turn for the other — and which is which is the `cumulative` field on `YIELD_SERIES` (`src/lib/stats/charts/yields.ts`), read by the card's own badge. It was settled by counting decreases over the local `game_player_turn` rows, not from the manual. Prose elsewhere points at that field instead of restating the list, which had already drifted across four copies once.

**Memory.** The per-seat accumulators are live for the whole aggregation pass, so they are part of the bound `docs/global-stats-design.md` §7 denominates; its Built note has the measurement and what the shape costs.

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
- ~~**No aggregator tests.**~~ **Closed 2026-08-29.** `cloud/test/integration/stats/round-trip.test.ts` drives a seeded corpus through the real upload path, calls `buildChartBundle` directly in **both** focal modes (no user endpoint produces `focal: "humans"`), and pins the whole bundle as a snapshot. A snapshot rather than a digest because the test has two jobs: some changes must be provably byte-identical (the disjoint-cohort rework) and others deliberately change chart output and need the diff readable (bounding `openingLaws`). The bundle is canonicalized first — `test/helpers/chart-bundle.ts` deep-sorts arrays **of objects** only, since arrays of primitives are index-aligned against `yieldCurves.turns` and reordering one would hide a defect rather than normalize it. Structural invariants that canonicalization flattens are asserted beside the snapshot instead.
- **`turnLength.games` is not `summary.total_games`.** The distribution is built from the games that produced a seat row, where `total_games` counts every id the corpus resolved to — the same denominator `summary.avg_total_turns` has always divided by, now carried on the object so a reader doesn't have to assume the two agree. It also means the Game length panel's sample line can read below the corpus size the sibling tabs report.
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
- ~~**Out of v1 scope, seam preserved:** cross-user / "all public saves" aggregation and free assembly.~~ **The first half shipped 2026-08-29** as `/stats` (see "The global corpus"). This bullet predicted the cost would be **caching** — "an arbitrary game-id set hashes to a poor hit-rate key" — and that was wrong in a way worth keeping on the record, because it mis-set what to design around. Caching turned out to be the easy part: constrain the corpus to an enumerable set of slices and the keys enumerate with it, and the whole selection space precomputes nightly. The real costs were the two per-invocation platform ceilings — **isolate memory** (a whole-corpus `loadYieldCurves` ran at 76% of 128 MB before the cohorts were made disjoint) and the **1,000-query-per-invocation** D1 limit (which is why the nightly precompute is one cron pattern per slice rather than one invocation). Free assembly is still open, and it is the case that would have made the original prediction right — an arbitrary id set is exactly what does not enumerate.

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

What that flush now costs, since `/stats` exists: a user or tournament bundle recomputes on the request that missed it, as before. The four unfaceted global bundles are the expensive ones, and the hourly warm cron rebuilds any that are missing, so they are back within one interval rather than at the moment of the deploy. The 52 faceted selections are left to compute-on-miss until the night's precompute. Serve-stale does not help across a schema bump by design — it reaches across `parser_version` only, because that segment moving doesn't change the bundle's shape and this one does. `./per-ankh prod` orders migrate → worker → frontend → smoke, so none of this needs a manual step.
