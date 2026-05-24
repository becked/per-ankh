# Aggregate statistics — implementation notes

Companion to `docs/aggregate-statistics-design.md`. Records _what was
built_, _what we deferred_, and _what is fragile or load-bearing_ so a
follow-up session can pick up cleanly.

## Scope of the session

Two coupled changes shipped together in one big diff (not split for
atomic commits; `/dashboard` → `/users/[user_id]` was a prerequisite for
the natural stats URL):

1. **Dashboard → user-profile migration.** `/dashboard` is gone as a
   route; its content moved to `/users/[user_id]`. Owner sees their full
   library (private + public); any other viewer sees only the target
   user's `is_public=1` games. `/dashboard` itself is a 308 redirect to
   `/users/{current_user_id}` for old bookmarks.
2. **Aggregate stats feature.** New `/users/[user_id]/stats` and
   `/tournaments/[slug]/stats` routes backed by a single Worker endpoint
   per corpus that returns a `ChartBundle` JSON. Caching is KV-backed
   under the existing `SESSIONS_KV` binding with a `stats:` prefix.
   Tournament-corpus stats stay behind the existing beta gate.

No migrations, no parser bump.

## Architecture at a glance

```
Browser
  /users/[user_id]                ← was /dashboard
  /users/[user_id]/stats          ← new, public visibility
  /tournaments/[slug]/stats       ← new, beta-gated
       │
       ▼
  /v1/users/:user_id              ← new (public profile)
  /v1/users/:user_id/stats        ← new (KV-cached ChartBundle)
  /v1/tournaments/:slug/stats     ← new (KV-cached ChartBundle)
       │
  resolveCorpus → game_id[]       ← cloud/src/stats/resolve.ts
       │
  buildChartBundle                ← cloud/src/stats/aggregate.ts
   (3 SQL passes + JS rollup)
       │
  KV under "stats:" prefix        ← cloud/src/stats/cache.ts
   (mutation hooks invalidate)
```

The chart layer never knows which corpus it is drawing — `buildChartBundle`
takes a `CorpusContext` with a `mode: "tournament" | "user"` and branches
internally only where the SQL paths genuinely differ (head-to-head joins).

## File map

### Worker

| Path | Purpose |
|---|---|
| `cloud/src/stats/types.ts` | `ChartBundle` interface — canonical source of truth for the JSON shape. |
| `cloud/src/stats/resolve.ts` | `resolveUserCorpus` / `resolveTournamentCorpus` → `CorpusContext`. Applies visibility scope + game-type filter for user corpus. |
| `cloud/src/stats/aggregate.ts` | `buildChartBundle` — three SQL passes (base join, per-turn yields, tech+law events) + JS rollup into every chart's pre-aggregated shape. |
| `cloud/src/stats/cache.ts` | KV get / put / invalidate. Keys: `stats:v{schema}-p{parser_version}:tournament:{id}` and `stats:v{schema}-p{parser_version}:user:{id}:{scope}:{filter}`. |
| `cloud/src/stats/handlers.ts` | `handleUserStats`, `handleTournamentStats`. |
| `cloud/src/users.ts` | Added `handleUserProfile` next to existing `handleUserSearch`. |
| `cloud/src/schemas/game.ts` | Added `CURRENT_PARSER_VERSION` constant. |

### Worker — modified for visibility + invalidation

- `cloud/src/games.ts` — `handleGameList`, `handleStats`/`handleCollectionsList`
  caller (and `handleStats` itself in `cloud/src/stats.ts`) extended with
  `?user_id` query param + visitor-view `AND is_public=1`. Three call
  sites also have cache-invalidation calls: `handleGameUpload`,
  `handleGameDelete`, `handleGamePatch`.
- `cloud/src/stats.ts` — extended with `?user_id` + visibility branching.
- `cloud/src/collections.ts` — same; visitor view returns empty
  `collections` array (collections are owner-only in v1).
- `cloud/src/tournament/admin.ts` — five sites invalidate the tournament
  corpus cache: `handlePatchSlot`, `handleStartTournament`,
  `handleRetroEditMatch`, `handleTransitionChampionship`,
  `maybeAdvanceAfterMatchReport`. The last one's env type widened from
  `TournamentEnv` to `TournamentEnv & SessionEnv` for KV access.
- `cloud/src/index.ts` — three new ROUTES entries:
  `GET /v1/users/:user_id`, `GET /v1/users/:user_id/stats`,
  `GET /v1/tournaments/:slug/stats`. The slug-with-stats regex is
  ordered _before_ the bare-slug regex for dispatch correctness.

### Frontend

| Path | Purpose |
|---|---|
| `src/lib/stats/types.ts` | Mirror of `cloud/src/stats/types.ts`. |
| `src/lib/stats/StatsView.svelte` | Catalog renderer. Sticky category nav with `IntersectionObserver` scroll-spy, grouped grid below. |
| `src/lib/stats/CorpusChrome.svelte` | Title + save-count badge, optional provisional banner, optional game-type filter chip. |
| `src/lib/stats/ChartCard.svelte` | Generic chart wrapper — title + subtitle + empty-state fallback. |
| `src/lib/stats/SummaryTiles.svelte` | Four-up tile header for the Summary category (not a chart). |
| `src/lib/stats/charts/*.ts` | One file per category: `summary`, `nations`, `families`, `rulers`, `yields`, `laws`, `cities`, `tech`. Each exports option-builder functions of shape `(bundle) => EChartsOption \| null`. |
| `src/lib/stats/charts/helpers.ts` | `fmtNation` / `fmtArchetype` / `fmtTrait` / `fmtClass` / `fmtTech` / `fmtLaw` / `fmtMapSize` wrappers around `formatEnum`. Re-exports `CHART_THEME`. |
| `src/lib/stats/charts/registry.ts` | `CATEGORIES` array (drives nav order) and `CHART_SPECS` (drives rendering). Each spec has `{id, category, title, subtitle?, hasData, emptyMessage?}`. |
| `src/routes/users/[user_id]/stats/+page.{ts,svelte}` | User-stats route. URL `?filter=` for the game-type filter chip. |
| `src/routes/tournaments/[slug]/stats/+page.{ts,svelte}` | Tournament-stats route. |

### Frontend — modified for the migration

| Path | Change |
|---|---|
| `src/routes/dashboard/+page.{ts,svelte}` | Both files `git mv`'d to `src/routes/users/[user_id]/`, then heavily edited. The old path now contains a single `+page.ts` that 308-redirects to `/users/{current_user_id}` (anon → `/?next=…`). |
| `src/routes/users/[user_id]/+page.ts` | Loads via `getUserProfile`, `getStats`, `listGames`, `listCollections` (all with `userId`). Computes `isOwner = data.user?.user_id === params.user_id`. |
| `src/routes/users/[user_id]/+page.svelte` | Branches H1 chrome on `isOwner` (visitor sees avatar + display name); adds the "View stats →" link. |
| `src/lib/CloudHeader.svelte` | Avatar+name in the dropdown is now the profile link (`/users/{user.user_id}`); explicit "Dashboard" item dropped. `searchVisible` widened to `pathname.startsWith("/users/")`. |
| `src/lib/CloudGameSidebar.svelte` | New `userId` + `isOwner` props. Pagination calls thread `userId`. Collection-picker dropdown and right-click context menu gate on `isOwner`. The whole `border-b` filter band is conditionally rendered to avoid an empty bordered row when a visitor has no chart-filter chips. |
| `src/lib/api-cloud.ts` | Added `UserProfile` interface, `getUserProfile`, `getUserStats`, `getTournamentStats`. Existing `listGames` / `getStats` / `listCollections` now accept an optional `userId`. |
| `src/lib/GameActions.svelte` | After-delete redirect goes to the owner's `/users/{id}` (or `/` if no session, which can't actually happen here). |
| `src/lib/BulkUploadModal.svelte` | Imports `page` from `$app/state` for the same redirect logic on bulk-upload done. |
| `src/routes/games/[id]/+page.svelte` | Sidebar invocation passes `userId` + `isOwner=true` (the sidebar there is owner-only). |
| `src/routes/tournaments/[slug]/+page.svelte` | "Stats" link added next to the status badge. |
| `src/routes/+page.{ts,svelte}` | "Go to dashboard" CTA → "Library" pointing at `/users/{user.user_id}`. |
| `src/routes/+layout.svelte` | Comment update only. |

## Visibility model

A user corpus has two scopes:

| Viewer | Scope used | SQL filter |
|---|---|---|
| Self | `self` | none |
| Other authed user | `public` | `AND is_public = 1` |
| Anonymous | `public` | `AND is_public = 1` |

The scope is part of the cache key (`…:user:{user_id}:{self|public}:{filter}`),
so a private-save upload doesn't poison the public-scope cache.

The game-type filter is also baked into the user-corpus cache key, so
`all`, `vs_ai`, `mp`, `tournament` are four separate cache entries per
scope. Invalidating a user (e.g. on upload) deletes every key whose
prefix matches `stats:…:user:{user_id}:` — see
`invalidateStatsCache` in `cloud/src/stats/cache.ts`.

Tournament-corpus has no scope variants — tournament stats are visible
to anyone (subject to the beta gate). One cache entry per tournament.

## "Tournament game lives in both corpora"

A save uploaded with `tournament_match_id` lands in the uploader's
`games` row _and_ in the tournament via `tournament_matches.game_id`. So:
- `resolveUserCorpus` includes it via the user's `games` rows.
- `resolveTournamentCorpus` includes it via the join from
  `tournament_matches`.
- `handleGameUpload` invalidates _both_ caches when `tournamentContext`
  is set.

Head-to-head charts (counter-pick, archetype matchup) work for the user
corpus too — `buildUserHeadToHead` in `aggregate.ts` looks for 2-human
games where the uploader's row is present and pairs them with the other
human. Tournament-linked games qualify naturally.

## Cache invalidation hooks (8 sites)

All call `invalidateStatsCache(env, {kind, …id})`:

| File:line (approx) | Why |
|---|---|
| `cloud/src/games.ts` `handleGameUpload` end | new game, possibly tournament-linked |
| `cloud/src/games.ts` `handleGameDelete` end | save removed; tournament_id captured up-front from the linkage query, before the DELETE clears it |
| `cloud/src/games.ts` `handleGamePatch` end | `is_public` toggle / rename / collection move |
| `cloud/src/tournament/admin.ts` `handlePatchSlot` end | slot ↔ user mapping shifts |
| `cloud/src/tournament/admin.ts` `handleStartTournament` end | rounds spawn |
| `cloud/src/tournament/admin.ts` `handleRetroEditMatch` end | result flip |
| `cloud/src/tournament/admin.ts` `handleTransitionChampionship` end | swiss → championship |
| `cloud/src/tournament/admin.ts` `maybeAdvanceAfterMatchReport` end | match completion |

`handleAdminReparseUpload` does NOT have its own hook — it wraps
`handleGameUpload` with `adminOverride`, so the upload hook fires for
free.

If a future mutation handler is added (e.g. a tournament-name edit), it
needs a matching invalidation call. Otherwise the bundle goes stale
until the 24h TTL safety net fires.

## ChartBundle shape (cheat sheet)

Top-level `meta` carries corpus-type, name, save count, parser_version,
and optional provisional banner data. Then ~22 fields:

- `summary` — tile data (counts, top nation, top archetype)
- `summaryMapWinRate` — array of `{map_size, games, wins, rate}`
- `nationWinRate`, `nationAvgPoints` — per-nation
- `nationCounterPick` — `Nullable` array of head-to-head pairs
- `familyClassWinRate`, `familyClassPopularity`,
  `familyOmittedClass`, `familyTopCombos`, `familyByNation`
- `rulerArchetype`, `rulerTrait`, `rulerPopularCombos`,
  `rulerArchetypeMatchup` (`Nullable`), `rulerReignWinRate`,
  `rulerSuccessionWinRate`, `rulerSurvival`
- `yieldCurves` — `{turns: number[], series: Record<string, Array<number|null>>}`
  with 16 series (14 yields + military_power + legitimacy). One chart on
  the frontend, selectable series.
- `lawTiming`, `lawFirstThree`
- `cityPace` — `{fifth_city_turn, tenth_city_turn}` buckets
- `techFirst`, `techTiming`

Tournament-only charts (`nationCounterPick`, `rulerArchetypeMatchup`)
return `null` when no 2-human pairings exist. The frontend renders an
empty-state card.

## Aggregator implementation gotchas

- **D1 bind-param cap.** `chunk(gameIds, 50)` in `aggregate.ts` keeps
  every `IN (?,?,…)` under the per-statement parameter limit (~100 in
  D1, leaving headroom). Each SQL pass loops chunks and merges results.
- **Per-turn yield curves** use weighted re-averaging across chunks
  (`sums[f] += AVG_value * row.count`, then `sums[f] / counts[f]`).
  Each chunk produces per-turn averages over its slice; we re-aggregate
  in JS to a corpus-wide curve.
- **"Self" rows.** For tournament corpus, all human rows are "self"
  (the tournament IS the multi-player corpus). For user corpus, only
  the uploader's row is "self" — identified by `is_uploader = 1`. This
  matters for nation popularity, family-class stats, archetype counts —
  user corpus reports the user's own picks, not opponent AI nations.
- **Yield curve self-filter** is in the SQL: tournament uses
  `ps.is_human = 1`, user uses `ps.is_uploader = 1`. See `loadYieldCurves`.
- **`familyOmittedClass`** uses a hardcoded 10-class list (`ALL_CLASSES`)
  in `aggregate.ts` rather than introspecting the corpus. Approximate —
  fine for v1, may need a corpus-driven class set later.
- **Empty corpus.** `buildChartBundle` short-circuits to a fully-shaped
  empty bundle when `gameIds.length === 0`. Don't return an undefined
  field — the frontend assumes every field is present.

## Provisional banner

Active when corpus is tournament AND `tournaments.status !== 'complete'`
AND a `latest_completed_round` is non-null. Surfaces "Provisional
through Round N" in `CorpusChrome.svelte`. User corpora never show it.

## Things not done

- **No manual browser verification.** All compile checks pass
  (`npm run check`, `npm run lint`, `cd cloud && npm run typecheck`,
  `npm run format:check`). The dev-server-driven sweep across the seven
  flows below was not done in-session.
- **No new D1 migrations, no parser bump.** Everything aggregates from
  existing columns.
- **No unit tests for the aggregator.** Each chart's option builder is
  presentation code; the SQL/JS aggregations don't have a fixture-driven
  test yet. If aggregator drift becomes a concern, the natural test is
  one fixture → ChartBundle round-trip.

## Things deferred by design

These came up during planning and were explicitly left for later:

- **Cross-tournament aggregation, "all public saves" corpus.** Out of v1
  scope per design doc §2. The `game_id[]` seam keeps this option open.
- **Chart catalog gaps that need new extraction.** Pick-order win rate
  (column dropped in migration 0004), city distribution by class
  (per-city data is in the R2 blob, not D1), family-opinion charts
  (3, not extracted), event-category timeline (events not in D1 outside
  tech/law), military unit-type breakdown (no per-unit-type column),
  city production strategies (per-city blob). Reviving any of these
  takes a `parser_version` bump + reparse — admin reparse-upload already
  supports this.
- **`stats_schema_version`** — unnecessary; `CURRENT_PARSER_VERSION`
  plays the same role and is the single source.
- **Per-chart progressive loading.** Single bundle per corpus in v1.
- **Collections shown to visitors.** Owner-only.
- **Notifications.** Not in v1.

## Likely follow-up surface

The user flagged "perhaps routing changes, certainly chart changes" as
the next session's intent. Likely-touched surfaces:

- **Chart catalog** — rewrite, reorder, remove. `src/lib/stats/charts/*.ts`
  and `src/lib/stats/charts/registry.ts` are the only places to edit;
  no Worker change needed if the rewrite uses existing bundle fields.
  Adding fields means: ChartBundle in `cloud/src/stats/types.ts`,
  mirror in `src/lib/stats/types.ts`, populate in `aggregate.ts`.
- **Chart styling** — `helpers.ts` exports `CHART_THEME` and the
  `COMMON_GRID`. Color usage is via `getChartColor`, `getCivilizationColor`,
  `getNationColor` from `$lib/config`. Don't hardcode hex.
- **Categorization** — `CATEGORIES` array drives the nav. Reorder by
  reordering the array. Add/remove categories by editing both this and
  the `StatsCategory` union in `src/lib/stats/types.ts`.
- **Routes** — `/users/[user_id]/stats` and `/tournaments/[slug]/stats`
  are independent. The view component (`StatsView`) is shared. Moving
  to a different URL means editing `+page.ts` / `+page.svelte` in the
  route folder + updating link targets (one in
  `src/routes/tournaments/[slug]/+page.svelte`, one in
  `src/routes/users/[user_id]/+page.svelte`, plus any new entry points).
- **`/users/[user_id]` itself** — the page is currently a near-clone of
  the old dashboard with light visitor-view branching. The H1 chrome
  could grow (a real profile header with badges, etc.) without touching
  the sidebar or stats.

## Gotchas to remember mid-rewrite

- **`SPEC_GROUPS` Map** in `StatsView.svelte` triggers
  `svelte/prefer-svelte-reactivity`. There's an eslint-disable on the
  `new Map<>()` line because the Map is built once at module init and
  never mutated reactively. If you rewrite this, either keep the
  disable or use `SvelteMap` properly.
- **`resolve()` and dynamic paths** — the lint rule
  `svelte/no-navigation-without-resolve` doesn't see through a `goto(x)`
  where `x` is a local variable. If you compute a destination in a
  variable, structure as `if (cond) goto(resolve(\`/users/${id}\`))`,
  not `goto(dest)` after `const dest = resolve(...)`.
- **Worker tournament-stats handler** does a slug → tournament_id
  pre-lookup specifically so the cache key uses `tournament_id` (the
  stable identifier). Don't switch the cache to key on slug — the
  mutation invalidation helpers only know tournament_id, and that
  asymmetry would silently break invalidation.
- **`maybeAdvanceAfterMatchReport`'s env type widened** to
  `TournamentEnv & SessionEnv` for KV access. If something else in
  `tournament/admin.ts` is later refactored back to plain `TournamentEnv`,
  the cache call here will fail to compile.
- **`jsonResponse` only accepts `Record<string, unknown>`** so
  `handleUserStats` / `handleTournamentStats` cast the `ChartBundle`
  with `as unknown as Record<string, unknown>`. Ugly; lives until
  `jsonResponse` is generalized.

## Verification checklist (for next session, or before commit)

Run `./per-ankh` and walk through:

1. `/dashboard` while signed in → 308 to `/users/{your_id}`. While
   signed out → `/?next=/dashboard`.
2. `/users/{your_id}` → your library with collection picker, upload
   affordance. Right-click a game → context menu.
3. `/users/{other_user_id}` → public-only games, no upload, no
   collection picker, no right-click menu. Avatar + display name in
   the H1.
4. `/users/{any}/stats` → grid of cards. Category nav at top sticks
   on scroll, highlights the section nearest the top.
5. Tournament-only cards (`nation-counter-pick`,
   `ruler-archetype-matchup`) empty-state in user corpus _unless_ the
   user has 2-human games (tournament-linked or freeform MP).
6. Filter chip on user-stats → URL updates, corpus recomputes,
   numbers shift.
7. Tournament detail page → Stats link in the header. Click → corpus
   loads. Non-beta viewer → 404.
8. Cache: hit a stats URL, observe Worker logs. Upload a save, hit
   again → recompute. Toggle `is_public` on a save → recompute.
