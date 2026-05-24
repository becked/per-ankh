# Aggregate statistics — redesign status

Status of the **user-stats** work after the redesign session. Supersedes the
container/UX direction in `aggregate-statistics-implementation-notes.md` for the
user corpus; the data-model premise from `aggregate-statistics-design.md` still
holds. Tournament stats were deliberately set aside and are unchanged.

Companion docs:
- `aggregate-statistics-design.md` — original design premise (still valid).
- `aggregate-statistics-implementation-notes.md` — the *first* implementation
  (dedicated `/stats` route + persistent sidebar). Largely replaced below.
- `per-ankh-home-redesign-spec.html` — the UX designer's spec this session built
  from (its two-axis scope model was later simplified — see §2).

## Where we are

The dedicated `/users/[user_id]/stats` route and the persistent
`CloudGameSidebar` are gone. The user home `/users/[user_id]` is now a single
tabbed surface — **Overview · Games · Stats** — with a profile card on top, one
**scope selector**, and a navigational header search. All static checks pass
(`npm run check`, `npm run lint`, `npm run format:check`, `cd cloud && npm run
typecheck`). **Not committed, not deployed, no manual browser pass yet** (§7).

## 1. Page shape (`/users/[user_id]`)

- **Profile card** (top, shown for owner and visitor): avatar + display name +
  four all-time stat boxes — Saves, Win Rate, Favorite Nation (crest), Favorite
  Day. The scope selector sits on this row, right-aligned.
- **Tabs** (`?tab=`, default `overview`): Overview / Games / Stats. bits-ui
  `Tabs`, controlled one-directionally (value from URL, change → `goto`).
- **Overview tab** — `OverviewTab.svelte`: calendar heatmap + games-by-nation
  bar. Scoped (tracks the selector).
- **Games tab** — `GamesTable.svelte`: a table (Nation · Victory · Map · Turns ·
  Result · Date · chevron) in a 12-col grid mirroring the `/` feed (filters
  `col-span-2` · list `col-span-8` · sort `col-span-2`) on one dark
  (`#211a12`) panel. Rows are filled `#2a2622` panels; nation names tinted by
  civ color; infinite scroll; month dividers on date sorts. Lazy-loaded (only
  fetched when `tab=games`).
- **Stats tab** — `StatsView.svelte`: the 22-chart `ChartBundle` catalog as
  bits-ui **category subtabs** (`?category=`), one category at a time, styled
  like the game-detail tabs and using `ChartContainer` (in-chart titles +
  fullscreen expand). The old `summary` category is gone; a new `map` category
  holds the win-rate-by-map-size chart.

## 2. Scope model — one selector, not two axes

The spec's orthogonal collection × game-type controls were collapsed into a
single **`UserScope`**: `all | public | vs_ai | mp | tournament | <collection_id>`.
Mutually exclusive; the user picks one. URL: `?scope=`.

- `cloud/src/games-scope.ts` (new) — `buildUserScopeWhere({ scope, viewerOwnsTarget })`
  returns the shared `{ clause, binds }` scope predicate, plus `parseScopeParam`.
  Used by **both** `handleGameList` and `resolveUserCorpus`, so the Games table
  and the Stats/Overview bundle always agree on what's "in scope". Identity
  visibility (owner → all, visitor → `is_public=1`) is folded in.
- Games-tab chips (Nation / Result / Date) and free-text `q` are *additional*
  AND filters within the chosen scope. `q` matches game name, owner rename, **and
  nation** (so "maurya" finds Maurya saves).

This is effectively the design doc's deferred "free assembly", delivered via the
existing collections primitive (stable, cacheable named sets).

## 3. One scoped `ChartBundle` feeds Overview + Stats

`handleStats` / `GET /v1/stats` were **retired** (`cloud/src/stats.ts` deleted).
Their data folded into the bundle: `win_rate`, `games_with_outcome`,
`save_dates`, `favorite_day_of_week`, `nations` (see `aggregate.ts`
`loadSaveDates` + the existing self-row passes). One scoped payload drives both
tabs.

- Cache key gained the scope dimension: `stats:v{N}-p{parser}:user:{id}:{viewerScope}:{scope}`.
  `BUNDLE_SCHEMA_VERSION` bumped to **2** (new fields ⇒ old cached bundles
  orphaned). Prefix-walk invalidation (`:user:{id}:`) still nukes every variant;
  the 8 existing invalidation callers are unchanged.

## 4. Profile summary is intentionally UNSCOPED

The profile-card stats must reflect the user's *entire* library regardless of the
scope selector (it sits above the selector). So they come from the profile
endpoint, not the bundle:

- `GET /v1/users/:id` (`handleUserProfile`) now returns a `summary`
  `{ total_games, win_rate, favorite_nation, favorite_day_of_week }` computed over
  all the user's saves, visibility-scoped only (owner all, visitor public).
- `GET /v1/collections` (`handleCollectionsList`) now returns `scope_counts`
  `{ all, public, vs_ai, mp, tournament }` (replacing the old single
  `public_count`) — the per-option counts shown in the scope dropdown.

## 5. Chrome: header search + avatar; sidebar gone

- `HeaderGameSearch.svelte` (new) — navigational dropdown over the *signed-in*
  user's own games (independent of the profile being viewed); click → game
  detail. Recent-saved order, fetches 50, fixed-height scroll, arrow-key
  nav with scroll-into-view. Replaces the old `?q`-filters-the-sidebar search.
- The signed-in user's **avatar** sits to the right of the header search,
  linking to their profile. Header wordmark is plain "𓉑 Per Ankh".
- `CloudGameSidebar` removed from the home page **and** `/games/[id]`
  (game detail keeps a "← Back to games" link; rename / move-to-collection live
  there via `GameActions`, not in the games table).

## 6. File map

**New:** `cloud/src/games-scope.ts`; `src/lib/users/{ScopeRow,OverviewTab,GamesTable,HeaderGameSearch}.svelte`.

**Deleted:** `cloud/src/stats.ts`; `src/lib/CloudGameSidebar.svelte`;
`src/lib/stores/{search,sidebarWidth}.ts`; `src/lib/stats/{SummaryTiles,ChartCard}.svelte`;
the old `users/[user_id]/stats/+page.svelte`.

**Notable edits:** cloud — `games.ts` (scope params + `?result` + `?sort`),
`stats/{resolve,cache,handlers,aggregate,types}.ts`, `collections.ts`,
`users.ts`, `index.ts` (route removed). Frontend — `api-cloud.ts`
(`UserScope`, `ScopeCounts`, profile `summary`, retired `getStats`),
`stats/{types,StatsView,CorpusChrome}`, `stats/charts/{registry,summary}`,
`CloudHeader.svelte`, `users/[user_id]/{+page.ts,+page.svelte}`,
`users/[user_id]/stats/+page.ts` (now a 307 → `?tab=stats`),
`games/[id]/{+page.ts,+page.svelte}`, `tournaments/[slug]/stats/+page.svelte`.

## 7. Not done / deferred

- **Not committed; Worker not deployed.** The Worker changes (scope params,
  bundle fields, retired `/v1/stats`, profile `summary`, `scope_counts`) only
  take effect against local `wrangler dev` or after a deploy. Deploy ordering as
  usual: Worker before frontend.
- **No manual browser verification** this session — only static checks. Suggested
  pass: scope switching across all tabs; Stats category subtabs + `?category`
  deep-links; Games table filter/sort/infinite-scroll; calendar survives scope
  changes; header search (incl. nation match, keyboard nav); old `/stats` 307;
  visitor view (public-only, profile summary public); cache invalidation after an
  upload / visibility toggle.
- **No D1 migration, no parser bump** — everything derives from existing columns.
- **Dropped** (vs the first implementation / spec): chart→games cross-filter;
  per-game stat boxes + VP sparkline in the games list (the table uses the
  lighter `GameListItem`); rename/move from the games list (now game-detail only);
  the game-title column in the table (rows are identified by nation; custom names
  still show on game detail + search).
- **Tournament stats** (`/tournaments/[slug]/stats`) unchanged — still
  `CorpusChrome` + the (now subtab-based) `StatsView`; it ignores `scope`.
- **Profile page** is still just the stats home; a richer profile surface was
  discussed but deferred.
