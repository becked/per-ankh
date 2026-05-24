# Aggregate statistics — tournament-stats removal + user-only collapse

Continues the aggregate-statistics status docs. Prior session docs (still
useful for the chart/page history):

- `aggregate-statistics-design.md` (data-model premise)
- `aggregate-statistics-redesign-status.md` (page shell / one-axis scope)
- `aggregate-statistics-charts-status.md` (first chart-rework pass)
- `aggregate-statistics-per-nation-status.md` (per-nation panels, baked
  law→class reference, label polish) — **its §9 line "Tournament stats share
  StatsView" is now stale; tournament stats was removed in this session.**

**This doc covers the follow-on session: removing tournament stats entirely and
collapsing the shared "corpus" abstraction down to user-only.**

## State

- **All static checks pass**: `cd cloud && npm run typecheck`, `npm run check`
  (svelte-check 0/0), `npm run lint` (eslint src). `npm run format:check` is
  clean for every file touched this session (the remaining warnings are
  pre-existing untouched files — the aggregate-stats docs and the untracked
  `src/routes/users/[user_id]/+page.svelte`).
- **Not committed, not deployed.** The entire aggregate-statistics feature
  (this session included) is still uncommitted working-tree state — the
  `cloud/src/stats/` and `src/lib/stats/` directories are untracked; other edits
  are unstaged.
- `BUNDLE_SCHEMA_VERSION` is **still 4** and has **not** shipped. No bump needed
  this session — the pending v3→v4 flush regenerates every cache entry on first
  deploy anyway. (Locally, clear `stats:%` keys from the miniflare KV sqlite
  after a Worker change if a stale bundle interferes — see the per-nation doc.)
- **Deploy ordering unchanged**: Worker before frontend (the Worker imports
  `cloud/src/generated/law-classes.ts`, and the bundle shape leads the client).

## Why tournament stats was removed (the decision)

Tournament stats had been built to **share a generic "corpus" abstraction** with
user/player stats: a discriminated `CorpusContext` union (`user | tournament`)
feeding one `ChartBundle` whose every per-entity chart is keyed by **nation**.

We concluded that abstraction is the **wrong seam**. The real unit of reuse
between player stats and a future tournament stats is **the chart, parameterized
over a group-by dimension** — not the corpus:

- "win rate by X", "avg points by X", "law timing by X", "first tech by X" are
  the *same chart*; only X differs.
- Player stats: X = **nation** (selector = nation; axis labels = crest + name).
- Tournament stats: X = **player/participant** (selector = participant; labels =
  avatar + display name).
- A few charts have **no entity axis** and are trivially shared either way:
  yield curves (corpus-wide band), expansion-speed win-rate buckets.

The tournament-only head-to-head charts that *would* have justified a separate
corpus type were already built and removed in an earlier session. So the
`CorpusContext` union forced tournament data into a nation-shaped mold and bought
nothing a real tournament-stats redesign would reuse.

**Decision (chosen by the user — "Option 1"):** remove the tournament-facing
surface **and** collapse the corpus abstraction to user-only now. Keep charts
honestly nation-specific. When tournament stats returns (the rethink is **fuzzy
and someday**, per the user), re-generalize the **chart layer** along the
group-by-dimension axis against its real design — do **not** rebuild the
corpus-type union.

## What was removed / collapsed this session

**Tournament-stats surface (removed):**

- Deleted `src/routes/tournaments/[slug]/stats/` (`+page.svelte`, `+page.ts`).
- Deleted `src/lib/stats/CorpusChrome.svelte` — it was the *only* frontend
  reader of `bundle.meta`, and only the tournament route used it (the user page
  uses `ScopeRow`).
- Removed the "Stats" link on `src/routes/tournaments/[slug]/+page.svelte` and
  collapsed the now single-child header wrapper.
- Removed `cloudApi.getTournamentStats` (`src/lib/api-cloud.ts`).
- Worker: removed `handleTournamentStats` + the `/v1/tournaments/:slug/stats`
  route (`cloud/src/index.ts`, `cloud/src/stats/handlers.ts`), and
  `resolveTournamentCorpus` / `TournamentCorpusContext` (`cloud/src/stats/
  resolve.ts`).
- Cache: removed the `kind: "tournament"` variant from `StatsCacheKey`,
  `cacheKeyToString`, and `invalidateStatsCache` (`cloud/src/stats/cache.ts`).

**Tournament-cache invalidation calls (removed):**

- 5 calls in `cloud/src/tournament/admin.ts` (slot patch, tournament start,
  match retro-edit, championship advance, auto-advance) + the now-unused import.
- **2 calls in `cloud/src/games.ts`** (upload/link path ~1648; delete path
  ~2478) — **not in the original plan; caught by the typecheck.** Kept the
  user-cache invalidation at both sites; `tournamentContext` / `tournamentLinks`
  stay (used for match-linking and the incomplete-tournament delete guard).

**Corpus abstraction (collapsed to user-only):**

- `CorpusContext` union → single `StatsCorpus` interface (`{ gameIds, userId,
  display_name }`); the `mode` discriminant is gone, and every `corpus.mode`
  branch in `cloud/src/stats/aggregate.ts` collapsed to the user path:
  - `buildSelfMembership` — uploader rows only (`is_uploader === 1`).
  - `loadYieldCurves` — dropped the `selfFilter` param; hardcoded
    `ps.is_uploader = 1`.
  - `buildChartBundle` / `emptyBundle` — name comes from `corpus.display_name`;
    removed `provisional`; dropped the `uniquePlayerKey` set and the now-dead
    `humanRows`.
- `ChartBundleMeta` trimmed to `{ game_count, parser_version }` — dropped
  `corpus_type`, `corpus_id`, `corpus_name`, `provisional`. `summary` dropped
  `total_unique_players`. Mirrored in both `cloud/src/stats/types.ts` and
  `src/lib/stats/types.ts`. Stale "tournament-only / head-to-head" comments
  fixed.
  - **Judgment call made:** nothing currently reads `bundle.meta` (its only
    reader, `CorpusChrome`, was deleted). Kept a slim `meta { game_count,
    parser_version }` rather than dropping `meta` entirely — `game_count` is the
    obvious near-term reuse (an "N saves" badge) and `parser_version` is the
    deliberate cache-correctness echo.

**Explicitly preserved:**

- `UserScope`'s `"tournament"` member — that's a user **game-type filter**
  (tournament games the user uploaded), unrelated to tournament-corpus stats.
- All nation-keyed bundle fields and chart builders (stay nation-specific).
- All non-stats tournament code (rounds, matches, admin, brackets), parser,
  games.

## Where the broader aggregate-stats feature stands

(Carried from the per-nation doc; unchanged this session except the removal.)

- **User stats surface is the only consumer.** Lives at
  `/users/[user_id]?tab=stats` (Overview / Games / Stats tabs over one scoped
  corpus, scope on the tab row). The old `/users/[user_id]/stats` route
  redirects there.
- Stats subtabs: **Yields · Nations · Families · Laws · Cities · Tech.**
  Yields/Families/Laws/Tech are dedicated panels in `StatsView`; Nations and
  Cities go through the generic spec loop.
- Per-nation panels (Laws/Tech/Families) share `NationSelect` with an
  `ALL_NATIONS` sentinel. Baked law→class reference via
  `scripts/bake-law-classes.ts` → emitted to both `src/lib/generated/` and
  `cloud/src/generated/law-classes.ts`.

## Open threads / not done

- **Not committed / not deployed / no browser pass this session / no tests.**
  Recommended pre-commit verification: run `./per-ankh`, load
  `/users/<id>?tab=stats`, confirm Overview/Stats render and the nation
  selectors work; confirm `/tournaments/<slug>` has no "Stats" link and
  `/tournaments/<slug>/stats` 404s.
- **Future tournament-stats rethink (fuzzy, someday):** when it returns,
  generalize the **chart layer** over a group-by dimension (nation | player) —
  `NationSelect` → an entity selector, `ALL_NATIONS` → generic `ALL`,
  `crestAxisLabel` → a dimension-aware label resolver, nation-keyed bundle
  fields → key-keyed. Do **not** resurrect the corpus-type union. Also decide
  then whether tournaments need nation-within-tournament breakdowns and whether
  tournament-only charts (standings, head-to-head, round progression) belong to
  a separate set rather than the shared layer.
- Carried-over items from the per-nation doc: order-insensitive opening
  "sequence" naming mismatch (intentional); Families "All nations" pick-rate is
  across-pool confounded; family availability-normalization still deferred;
  `map-options` hand-mirror could migrate to the two-emit bake pattern.
- Optional cleanup: update `aggregate-statistics-per-nation-status.md` §9's
  stale "tournament stats share StatsView" note.
