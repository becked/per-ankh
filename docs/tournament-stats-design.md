# Tournament stats — design & build plan

> **Status:** forward-looking design doc, not an as-built record. Written to be *built from* in a future session. Grounded in a code read of the stats layer (`cloud/src/stats/`, `src/lib/stats/`), the tournament tables (`cloud/migrations/0006`–`0030`, `cloud/src/tournament/`), and the save-derivation layer (`cloud/src/derive-player-summary.ts`, `cloud/migrations/0002`). Companion to `docs/aggregate-statistics.md` (the user-stats as-built record), which this extends. **Update (2026-07-06):** the §7 three-chart MVP is now built on branch `tournament-stats`; everything past it remains forward-looking — see the Build status note at the top of §7.

## 1. Why this doc exists

User-facing **user stats** shipped (`/users/[user_id]` → Stats tab, ~22 charts over one user's save library). Tournament stats was deliberately deferred. v1 actually *did* ship a tournament corpus first, behind a `CorpusContext` discriminated union, then removed it — the union "forced tournament data into a nation-shaped mold and bought nothing a real tournament-stats redesign would reuse" (`docs/aggregate-statistics.md:40-45`).

The guidance left for the redo (`docs/aggregate-statistics.md:179-187`): **generalize the chart layer over a group-by dimension (nation | participant), not the corpus type.** Do not resurrect the union. Decide whether tournament-only charts (standings, head-to-head, round progression) belong in the shared chart layer or a separate set.

This doc answers three questions the future build needs settled: **what data we have**, **what charts that data supports**, and **which existing user-stats UI to reuse vs. generalize vs. build new**.

## 2. The two data planes

Tournament stats draws from two structurally different sources. Keeping them separate is the central design decision.

**Plane A — tournament-native relational.** The tournament tables — 4 of the 6 carry competition data (`tournaments`, `tournament_slots`, `tournament_rounds`, `tournament_matches`; `tournament_admins` and `tournament_beta_users` are authz-only). Describes the *competition*: who played whom, on what map, who won, standings, byes, forfeits, casters, scheduling. Entirely self-contained in D1; no save file is ever opened. Much of it is *already computed on read* — records/tiebreakers are derived from `tournament_matches` every time by `cloud/src/tournament/standings.ts`, assembled into the response shape by `computeStandingsResponse` (`public.ts:591`); nothing is stored.

**Plane B — save-content.** Reached from a tournament by walking `tournament_matches.game_id → games.game_id`, and the two bridge columns `tournament_matches.slot_a_player_index` / `slot_b_player_index` (`0007`) that map a bracket slot to a roster index inside the linked save. That `(game_id, player_index)` key joins into `player_summaries` and `game_player_turn`. This is the plane that reuses the existing `ChartBundle` machinery.

The single general seam between "a tournament" and "the chart layer" is a game-id list — see §6.

## 3. What data we have

### 3a. Tournament-native (Plane A) — pure D1, ready now

Source: `cloud/migrations/0006_tournaments.sql` + ALTERs through `0030`; types in `cloud/src/tournament/data.ts`; compute in `standings.ts` (records/tiebreakers), `public.ts` (`computeStandingsResponse`), `bracket.ts` (championship structure).

| Datum | Where | Notes |
| --- | --- | --- |
| Match result | `tournament_matches.winner_slot_id`, `status` (`pending`/`complete`/`forfeit`/`bye`) | authoritative competitive outcome, independent of the save |
| Map played | `map_pool_id` (instance), `map_script` (label) | anti-repeat is by instance; `map_pool` JSON on the tournament defines the pool (`0019`) |
| First-pick | `pick_order_winner_slot_id` | who chose the map first; enables pick-order-advantage analysis |
| Bracket position | `tournament_slots.swiss_seed`, `championship_seed`, `division` (A/B/NULL), `phase` (`swiss`/`championship`) | slots are per-phase; the championship transition creates new slots that copy `user_id`/`discord_id`/`discord_username` from the swiss slot |
| Round structure | `tournament_rounds` (phase, division, round_number, status, generated/started/completed_at) | round-by-round timing |
| Config & lifecycle | `tournaments.swiss_wins_to_advance`, `swiss_losses_to_eliminate`, `swiss_max_rounds`, `status`, `starts_at`, `completed_at` | context for advancement/participation charts |
| Records & tiebreakers | `computeStandings` + `rankStandings` (`standings.ts`) | `wins`, `losses`, `status` (advanced/eliminated/active), `buchholz_cut1`, `opponents_buchholz`, `cumulative`, `rank`, `tied_with`, `h2h`, plus `slot_id`/`swiss_seed`/`withdrawn` — all already derived. Forfeit wins are indistinguishable from played wins here; use match `status` for that |
| Head-to-head | `computePairwiseH2H` (`standings.ts:165-181`) | pairing-result counting already implemented (module-private today — export it for reuse) |
| Casters / streams / VODs / schedule | `tournament_matches.parts` JSON (`0029`) | ordered sittings, each with `scheduled_at`, ordered `casters[]`, `streams[]` (POV-labelled) |
| Match numbering | `match_number` (`0030`), `match_index` (within round, `0008`) | `match_number` is NULL for byes (never numbered) |
| Occupant snapshots | `slot_a/b_username`, `slot_a/b_user_id` on the match (`0024`) | frozen at report so substitutions don't rewrite history |
| Withdrawals | `tournament_slots.withdrawn_at` (`0027`) | played matches stand; excluded from pairing/qualification |
| Signup funnel | `tournament_slots.user_id` (NULL = unclaimed), `signup_answer`, plus `events` rows (`tournament_self_signup`, `tournament_slot_substituted`, `tournament_self_withdraw`) | |

> Do **not** read the dead columns `scheduled_at`/`stream_url`/`caster_user_id`/`caster_name` on `tournament_matches` (`0025`) — superseded by `parts` (`0029`) and excluded from `MATCH_COLUMNS` (`data.ts:242-267`). Likewise dead on `tournaments`: `allowed_map_scripts`/`map_script_options` (replaced by `map_pool`, `0019`); `swiss_advance_count` was dropped outright (`0014`).

### 3b. Save-derived, already in D1 (Plane B, cheap) — ready now

Two things make this bigger than it looks: **both** players in a match already have rows — the derivation writes every roster entry, human and AI alike (`games.ts:463`), so the opponent is an `is_uploader=0` row, not blob-only — and per-turn series exist for both.

- **`player_summaries`** — one row per roster entry, PK `(game_id, player_index)` (`0002:75-108`; derivation `cloud/src/derive-player-summary.ts`). Per player: `player_name`, `nation`, `family_classes` (JSON), `starting_ruler_archetype`/`_traits`/`_reign_turns`, `succession_count`, `final_points`, `final_military_power`, `final_legitimacy`, `cities_total`, `cities_founded`, `techs_completed`, `laws_count`, `fifth_city_turn`, `tenth_city_turn`, `fourth_law_turn`, `seventh_law_turn`, `vp_margin`, `is_winner`, `is_human`, `is_uploader`.
- **`game_player_turn`** — wide per-turn series **per player** (`0002:118-142`, +`points` in `0021`): 14 yields × (`_per_turn` + `_cumulative`), plus `military_power`, `legitimacy`, `points` (victory points). Both players' indices are present → per-turn *divergence* curves are computable now.
- **`tech_events`** / **`law_events`** — `(game_id, player_index, tech|law, turn)` (`0002:151-167`). Per-tech / per-law timing for both players. PK nuance: `tech_events` keys on `(game, player, tech)` — one row per tech; `law_events` includes `turn` in its PK (repeal/re-adopt produces multiple rows).
- **`games`** — one row per save (`0002:32-66`, +`0005`/`0017`): `total_turns`, `map_size`, `map_class`, `winner_nation`, `winner_name`, `victory_type`, `user_nation`, `user_won`, `difficulty`, `opponent_level`, `save_date`, `parser_version`, timestamps.

The bridge: `tournament_matches.slot_a/b_player_index → player_summaries(game_id, player_index)`. The bracket serializer already walks it for nations — `loadNationsForMatches` (`public.ts:1241-1263`) batch-loads every player's nation for the linked games, and `buildMatch` (`public.ts:1178-1187`) matches them to slots by player index — and for turn counts (`public.ts:784-800`, an IN-list lookup on `games.total_turns`).

### 3c. Blob-only (Plane B, needs a `parser_version` bump + admin reparse-all)

In the R2 blob (`FullGameData`, `src/lib/parser/types.ts:323-366`); not queryable in SQL. Charting any of these over a corpus means extract → new D1 column/table → parser bump → reparse-all (current `CURRENT_PARSER_VERSION = "2.9.1"`; a bump also naturally orphans the stats cache).

Per-city detail (`city_statistics`), family & religion opinion history, event/story timelines (no event data in D1 outside tech/law), military unit-type breakdown (`units_produced`), player goals/ambitions, full character/dynasty data, map/tile & improvement & territory-history data, resource stockpiles & market prices, diplomacy/war state, wonders, and **opponent `online_id`** (only the uploader's own reaches D1, in `user_online_ids`). Note `pick_order` was dropped from `player_summaries` (`0004`), so pick-order win rate needs re-derivation.

## 4. Chart catalog

Organized by data plane and readiness. **Ready** = data is in D1 today; **Extract** = needs a parser bump + reparse.

### Plane A — competition charts (tournament-native, all Ready)

These are *new* chart types with no user-stats analog. Most of the numbers are already computed in `standings.ts`; the work is option-builders + a response shape, not aggregation.

| Chart | Shows | Source |
| --- | --- | --- |
| Standings visualization | richer-than-table view of the ranking (W/L, status, tiebreak breakdown) | `computeStandingsResponse` (`public.ts`) |
| Head-to-head matrix | pairwise win grid across all participants | `computePairwiseH2H` |
| Standings-over-rounds | each player's cumulative wins / rank trajectory by round | re-run `computeRecord` per round prefix, in-memory (the `cumulative` tiebreaker is a single Harkness sum, not a trajectory) |
| Per-map win rate | win rate by map script / instance; sample size per map | `map_script`/`map_pool_id` × `winner_slot_id` |
| Map usage frequency | how often each map was played | `map_pool_id` |
| Pick-order advantage | does the first-map-picker win more often? | `pick_order_winner_slot_id` vs `winner_slot_id` |
| Bye distribution | who received byes, in which rounds | `status='bye'` (equivalently `slot_b_id IS NULL`; `winner_slot_id = slot_a_id`) |
| Forfeit rate | forfeit share by round / division / player | `status='forfeit'` |
| Championship upsets | bracket seed vs finish (who overperformed their seed) | `championship_seed` + bracket results |
| Match length distribution | turns-to-decide, overall and by map | `games.total_turns` (single-column join) |
| Caster / stream coverage | % matches streamed or casted; caster leaderboard; streams per match | `parts` JSON |
| Schedule view | match calendar; lead time (scheduled_at → reported_at) | `parts[].scheduled_at`, `reported_at` |
| Signup funnel | claimed vs unclaimed slots; signups over time; answer distribution | `tournament_slots` + `events` |
| Participation / survival | active / advanced / eliminated / withdrawn population per round | `tournament_slots` + matches |

### Plane B1 — tournament meta (save-content, nation dimension)

The **existing user-stats charts, pointed at the tournament's games.** `buildChartBundle` is corpus-agnostic — it takes a `StatsCorpus` (a game-id list) and a parser version, nothing else — so a tournament game-id resolver yields the nation-keyed bundle, *after* widening the aggregator's `is_uploader=1` "self" convention to **all humans** (otherwise only uploaders count and opponents vanish). The widening is per-field, not one switch — see the breakdown in §6: two fields need no change, and the Overview-style self metrics don't survive it at all. What carries over as "across this tournament": nation win rate, nation avg points, family pick/win rate, law adoption timing, opening-law sequences, first-tech, tech timing, per-turn yield curves, expansion-speed win rate. **Ready.**

### Plane B2 — participant dimension (the generalization)

The same save-content charts, but **grouped by participant instead of nation** — the `docs/aggregate-statistics.md:181-187` generalization. E.g. per-player yield curves, each player's nation preferences, each player's law/tech timing, each player's win rate. Needs the nation→generic-key generalization (§5) plus the slot→participant mapping via `slot_a/b_player_index`. **Ready** on data; gated on the UI generalization.

### Plane C — head-to-head match deep-dive (save-content, per-match)

A per-*match* surface (not a corpus aggregate). Both players' summaries and both players' per-turn curves are in D1, so: score / military-power / legitimacy / VP divergence over the match, final-stat comparison (cities, techs, laws, VP margin, nation, ruler archetype), yield-curve overlay of the two players. **Ready.** War/diplomacy state between the two, ambition races, and per-city expansion maps are **Extract**.

### Plane D — richer meta (Extract)

Gated on a parser bump: event-category timeline, per-city distribution by class & production strategy, military unit-type breakdown, family/religion-opinion charts, ambition completion, wonder race, territory-growth map. Each follows the extract → column → bump → reparse recipe.

## 5. UI reuse map

Goal from the user: reuse user-stats UI components where it makes sense. Concretely:

### Reuse as-is (corpus/dimension agnostic)
- `ChartContainer`, `CHART_THEME` / `COMMON_GRID` / `getChartColor` (`$lib/config`, `src/lib/stats/charts/helpers.ts`).
- The declarative catalog shell: `CATEGORIES` + `CHART_SPECS` (`charts/registry.ts`) + the spec-loop in `StatsView.svelte` (category subtabs, `hasData`/`height`/`emptyMessage`, in-chart title injection). Three caveats: the spec-loop only drives the nations and cities categories today — yields/families/laws/tech are special-cased to their panels in the category dispatch (`StatsView.svelte:121-128`), their registry entries being anchor-only stubs; `buildOption()` maps spec ids to builders through a hardcoded switch (`StatsView.svelte:62-73`) that new charts must extend; and `ChartSpec`/`StatsView` are typed against `ChartBundle` (`hasData: (b: ChartBundle) => boolean`, `bundle: ChartBundle` prop), so reusing the shell for Plane A means parameterizing those types over the response shape (or instantiating a parallel registry for the tournament shape).
- The **Yields panel** (`YieldsStatsPanel.svelte` + `charts/yields.ts`) — already dimension-neutral (series keyed by yield name, percentile-band rendering). Reusable verbatim for Plane B.
- The cities/expansion chart — bucket-keyed, no nation dependency.
- Empty-state card pattern (every bundle field is always present; frontend renders per-chart empty states).

### Generalize (nation is baked in as the group-by key)
- `NationSelect.svelte` → an entity selector: structurally it's already a controlled single-select over `string[]`; extract the hardcoded `nationLabel` into an injected `labelFor(value)` prop.
- `ALL_NATIONS = "__all__"` sentinel → a generic `ALL`. **Gotcha:** it's defined *twice, independently* (Worker `aggregate.ts:32`, frontend `charts/helpers.ts:33`), kept in sync by eye — the generalization should not make that worse.
- The crest/label resolvers — `crestAxisLabel` (`charts/helpers.ts:55`) is already generic (it takes a `crestUrl(value)` callback); the `SPRITE_MANIFEST['crests/CREST_*']` lookups live in per-chart resolvers (`nationCrestUrl`, `nations.ts:8-10`; `classCrestUrl`, `families.ts:18-21`). Participant charts just supply an avatar/username resolver — half of this generalization already exists.
- The per-nation panels (`FamilyStatsPanel`, `LawsStatsPanel`, `TechStatsPanel`) and their builders hardcode `.nation` as the filter/group key (e.g. `bundle.techTiming.filter(r => r.nation === nation)`) and derive their option lists from `nationWinRate` game counts. These become "group by the active dimension's key."
- Bundle field **keys**: `nation` on `nationWinRate`, `nationAvgPoints`, `nations`, `familyByNation`, `lawTiming`, `openingLaws`, `techFirst`, `techTiming` → a generic key; the label helpers behind every axis and selector (`fmtNation`/`nationLabel`, `charts/helpers.ts:10-12`/`34-36`) thread through it too. Per the removed-union lesson, generalize the *field keying*, don't wrap the bundle in a discriminated union.

### Build new (no user-stats analog)
- Plane A option builders (standings, H2H matrix, map win rates, bracket-upset, round-progression, caster coverage, schedule, funnel). These render through the reused `ChartContainer`/spec-loop shell but compute from a **tournament-native response shape**, not a `ChartBundle`.
- Plane C match deep-dive layout (two-player overlays).

## 6. Proposed architecture

Two subsystems, one shared UI shell.

**(1) Tournament meta stats (Planes B/C) — reuse the ChartBundle machinery.**
- New corpus resolver producing the same `StatsCorpus` shape `resolveUserCorpus` returns (`cloud/src/stats/resolve.ts` — note the user version also threads `viewerScope`/`scope`, which the tournament variant drops since tournaments are public): `resolveTournamentCorpus(env, tournamentId) → { gameIds }` via
  ```sql
  SELECT m.game_id FROM tournament_matches m
  JOIN tournament_rounds r ON r.round_id = m.round_id
  WHERE r.tournament_id = ? AND m.game_id IS NOT NULL
    AND m.status = 'complete'
  ```
  (the join is required — `tournament_matches` has no `tournament_id` column). That alone feeds `buildChartBundle` unchanged and yields Plane B1. **`status = 'complete'` is settled** (was open): an admin retro-edit can leave a linked game on a `forfeit` match (`PatchMatchSchema` accepts `game_id` and `status` independently; flips don't clear it), and such a save is an aborted or adjudicated game whose content would pollute the distributions (match length, yield curves, expansion pace). Byes never carry a `game_id`, and deleted games can't dangle — the `0013` trigger nulls `tournament_matches.game_id` on game deletion. The filter is Plane-B-only; Plane A charts still consume all matches, forfeits and byes included. Related (settled): save `is_winner` can disagree with the official `winner_slot_id` after an admin override — **documented, not filtered**. Standings show official results; charts show what happened in the games. Filtering would drop a real game's content over one disputed field, and overriding `is_winner` would mean threading a tournament-only `(game, player) → won` map through every aggregation that reads it.
- **Aggregator widening — per-field, not one switch.** The `is_uploader=1` "self" convention lives in one SQL clause (`loadYieldCurves`, `aggregate.ts:224`) and the JS `selfRows`/`selfMembership` set (`aggregate.ts:145-151`, `401-404`). For an all-humans tournament corpus the bundle fields split three ways:
  - **No change needed:** `lawTiming` and `techTiming` already aggregate all `is_human=1` rows; `save_dates`, `favorite_day_of_week`, `summary.total_games`, `summary.avg_total_turns` are per-game.
  - **Correct once widened:** `nationWinRate`, `nationAvgPoints`, `nations`, `familyByNation`, `yieldCurves`, `openingLaws`, `techFirst`, `expansionWinRate`. Each (game, human) pair is a sample; a 1v1 game contributing one win row and one loss row is the intended semantics for these charts.
  - **Broken by widening:** `win_rate`/`games_with_outcome` (`aggregate.ts:451-456`) assume one self row per game — over an all-humans 1v1 corpus, win rate is ~50% by construction and the game count doubles. `summary.top_nation`/`top_archetype` turn into "most-played across all participants" (a different stat, possibly still wanted). **Settled:** these are replaced, not widened — tournament-native summary tiles, initial set: matches played, completion rate, most-played nation, average match length (turns).

  **Mechanism (settled): a focal-mode parameter, not a forked path.** `buildChartBundle` gains `focal: "uploader" | "humans"`, threaded into exactly the two sites that encode the self convention (`buildSelfMembership`, `aggregate.ts:145-151`; the `selfClause` in `loadYieldCurves`, `aggregate.ts:224`) — a separate path would duplicate ~600 lines of aggregation to change two. The third group's exclusions are carried by the response **type**, not runtime nulls: split `ChartBundle` into a chart-fields core plus a user-only Overview extension (`win_rate`, `games_with_outcome`, `summary.top_nation`/`top_archetype`); the tournament endpoint returns the core, the user endpoint core + extension. That's a structural subtype, not a resurrected discriminated union — no discriminant field, no tournament data in a nation-shaped mold — and it dovetails with the §5 caveat that `ChartSpec`/`StatsView` need parameterizing over the response type anyway. One detail deferred to UI-spec time: whether the tournament page renders the save-date calendar decides whether `save_dates`/`favorite_day_of_week` stay in the core or join the user-only extension.
- **Cache (settled: ships in v1 for Plane B):** the existing bundle cache is KV (`SESSIONS_KV`, `stats:` prefix, 24h TTL), keyed `stats:v{BUNDLE_SCHEMA_VERSION}-p{parser_version}:user:…` (`cache.ts:43-48`), so a parser bump orphans every entry with no purge step. Add a `kind:"tournament"` variant to `StatsCacheKey`, keyed on `tournament_id` + `tournaments.updated_at`. The target tournament's corpus is hundreds of games — five query families × `ceil(N/50)` chunks, including per-turn `game_player_turn` rows for every game — well past the `/standings` per-read compute, so this is not optional polish. Note `updated_at` is **not consumed as a cache key anywhere today** — `/standings` and `/bracket` recompute on every read, with no ETag/Cache-Control — but it *is* bumped on tournament mutations (`bumpTournamentUpdatedAt`, `data.ts`; the upload-report path bumps it inline, `games.ts:828`), which is exactly what key-embedded invalidation needs: a mutation drifts the key, the next read recomputes, and the orphaned entry dies by TTL (the same expiry-by-drift pattern the parser-version segment uses; no `invalidateStatsCache` analog required). Two paths key-drift does **not** cover: game deletion (the `0013` trigger nulls `tournament_matches.game_id` without bumping `updated_at`) and a single-game re-derivation at the same parser version. Both are bounded by the 24h TTL — accepted for v1; add explicit invalidation from `games.ts` only if that window ever matters.

**(2) Tournament competition stats (Plane A) — new, tournament-native.**
- A separate response shape (not a `ChartBundle`) computed largely by reusing `standings.ts` / `computePairwiseH2H` / bracket logic. Own handler. **Uncached in v1** (settled): its cost ≈ the already-uncached `/standings` compute and scales with matches, not games; the `tournament_id`+`updated_at` key variant is there to add if it measures slow.
- Renders through the reused `ChartContainer` shell. (Spec-loop/registry participation is deferred past the MVP — the MVP renders its charts directly; see §7.)

**Wiring (both subsystems).**

- Endpoints: `GET /v1/tournaments/:id/stats` (Plane A competition shape) and `GET /v1/tournaments/:id/stats/games` (Plane B `ChartBundle`) — one per subsystem, matching the two response shapes and caches. Dispatched alongside `/standings`/`/bracket` in the hand-rolled router (`cloud/src/index.ts`).
- Both endpoints apply `enforceTournamentViewRateLimit` and the `setupGateHides` 404 gate, exactly like `handleTournamentStandings`/`handleTournamentBracket` — every reader records to the rate-limit budget.
- Frontend calls go through `cloudApi` (`src/lib/api-cloud.ts`): add the two fetchers with request/response types adjacent, per the API-layer convention.
- Tests: unit tests beside source for the new pure functions (per-round-prefix records, per-map/pick-order aggregation, the widening split); Miniflare integration tests under `cloud/test/integration/` for the endpoints, alongside the existing tournament suites.

**Shared layer vs separate set (settled): separate.** Plane A is keyed by slot/match/round and doesn't fit the "ChartBundle over a game-id corpus" model; forcing it in is the same mistake as the removed `CorpusContext` union. Keep the ChartBundle machinery for Planes B/C and give Plane A its own shape — unified only at the UI-shell level (the §5 `ChartSpec`/`StatsView` type parameterization).

**Placement (settled):** a `/tournaments/[slug]/stats` subroute, mirroring the existing `/tournaments/[slug]/matches` subroute. The tournament page is a single scrolling page with per-section view toggles, not page-level tabs like the user page, so a sibling subroute — not a `?tab=` — is the fit. Visibility matches the rest of the tournament surface: public, hidden during pre-signup setup via `setupGateHides`.

**Mid-tournament (settled):** stats render whenever the tournament is visible, over the games linked so far — no gating on `complete` and no provisional banner. Researching an in-progress tournament's games is a primary use case; everyone knows the tournament isn't done.

## 7. Build plan — MVP first

The build starts with a deliberately small slice — three charts — chosen so the set exercises both subsystems, both endpoints, both response shapes, and the shared UI shell. Everything after it is mostly option-builders on infrastructure the slice already proved. All code references below were verified against the code in the 2026-07-05 MVP-scoping review (§8).

| # | Chart | Plane / subsystem | Endpoint | What it de-risks |
| --- | --- | --- | --- | --- |
| 1 | Standings visualization | A — tournament-native | `GET /v1/tournaments/:id/stats` | the competition response shape, the new handler + gates, the `/tournaments/[slug]/stats` route, the page rendering a non-ChartBundle shape |
| 2 | Caster leaderboard | A — tournament-native | same | the `parts`-JSON compute path, and a second builder on the same response shape (proves it generalizes past standings) |
| 3 | Nation win rate | B1 — ChartBundle | `GET /v1/tournaments/:id/stats/games` | `resolveTournamentCorpus`, the focal-mode widening, the type split, the tournament cache variant — and that an existing user-stats builder renders unchanged at tournament scope |

Charts 1–2 share one endpoint; chart 3 stands up the entire ChartBundle-at-tournament-scope pipeline. That asymmetry is deliberate: the MVP is two subsystems' worth of scaffolding for three charts, and the payoff is that chart #4 onward — the rest of B1 plus more Plane A — is mostly option-builders. Stage 1 alone yields a live page with two charts; build it first for the fastest visible result. Stage 2 is independent of stage 1 and can proceed in parallel.

Rendered examples of the chart designs: `docs/tournament-stats-chart-examples.html`.

### Build status (2026-07-06)

**Built** on branch `tournament-stats`: the three-chart MVP — standings visualization + caster leaderboard (Plane A) and nation win rate (B1) — with both endpoints (`GET /v1/tournaments/:id/stats` and `/stats/games`), the focal-mode widening, the core/user type split, the tournament KV cache variant, the `/tournaments/[slug]/stats` route, and the tests below (unit `computeCasterLeaderboard`; Miniflare integration for both endpoints; a regression pin on the unchanged user `/stats` path). `svelte-check`/`tsc` clean; the worker suite is green. Everything under "Explicitly out of the MVP" is unbuilt and still forward-looking.

**As-built deviations from the plan below** (recorded so the doc doesn't silently drift from the code — code wins on conflict):

- **`computeCompetitionStats` lives in `public.ts`, not `cloud/src/tournament/stats.ts`.** It reuses `computeStandingsResponse` + `loadUserIdentitiesForMatches` (both in `public.ts`), so co-locating it there avoids a runtime circular import (`public.ts` ↔ `stats.ts`). Only the genuinely-pure `computeCasterLeaderboard` sits in `stats.ts`, which imports `UserIdentity` from `public.ts` type-only.
- **The caster leaderboard loads matches via `loadMatches` (`data.ts`), not `loadMatchesWithRound`.** Casters need no round context, and `loadMatches` is already exported and returns exactly the `MatchRow[]` that `parseParts`/`loadUserIdentitiesForMatches` consume. The duplicate match load (vs. `computeStandingsResponse`'s internal one) is still accepted per §8.
- **`resolveTournamentCorpus` uses `SELECT DISTINCT m.game_id`.** Strictly-safer dedup in case a save ever links to two complete matches; the join, `status = 'complete'`, and non-null `game_id` filters are otherwise the §6 SQL verbatim.
- **The page tabs the three charts rather than stacking them.** §7 stage-3 item 10 says "three `ChartContainer`s rendered directly in the page"; the page instead groups them under bits-ui `Tabs` (Players / Nations / Casters), mirroring the user-stats chip-tab idiom. The "no registry, reuse the shared `ChartContainer` + theme/grid" intent is unchanged — only the layout (tabbed vs. stacked) differs.
- **Both stats handlers share a `loadViewableTournament` preamble helper.** §7 item 2 (and §6) had each handler apply the rate-limit + load + `setupGateHides` preamble inline like `handleTournamentStandings`. Because the two stats handlers need it identically, it's factored into one `loadViewableTournament(env, request, id, cors, session)` in `public.ts` returning the loaded tournament or a short-circuit `Response`. The sibling `/standings`/`/bracket` handlers keep their inline form.

Now wired: the `/tournaments/[slug]/stats` page is linked from the shared `TournamentActions` header cluster (a Stats pill beside Links/Settings), so it surfaces on the overview, matches, and stats headers alike. (There's still no dedicated tournament tab bar — `/matches` remains surfaced only contextually.)

### Stage 1 — Plane A backend (charts 1–2)

1. **`cloud/src/tournament/stats.ts` (new)** — pure compute, unit-tested beside source.
   - `computeCasterLeaderboard(...)` → `{ user_id, name, display_name, avatar_url, appearances }[]`: walk each match's `parseParts(m)` (`data.ts:515`) casters, group by `user_id ?? name`, count appearances, sort descending. Identity enrichment comes from `loadUserIdentitiesForMatches` (`public.ts:1279`, already exported) — the same batch identity map `serializeMatch` uses for casters. **No new users join** (settled — reuse rule #1).
   - `computeCompetitionStats(env, tournament)` → `{ standings, caster_leaderboard }`: the standings block reuses `computeStandingsResponse` (`public.ts:591`) verbatim, so `/stats` is self-contained and the page makes one Plane-A fetch (settled). Pass `viewerIsAdmin=false`: the admin-only standings fields (`signup_answer`, `discord_username`) exist for the standings-page editors, and charts never render them, so the stats payload always uses the public shape. `computeStandingsResponse` loads slots and matches internally, so the leaderboard performs its own `loadMatchesWithRound` (`public.ts:1416`, exported) — **the duplicate match load is accepted for v1** (settled): matches are a small table and the cost class matches the already-uncached `/standings` read. Don't refactor `computeStandingsResponse` to accept preloaded rows unless it measures slow. Response is uncached in v1 (§6/§8).
2. **Handler + dispatch** — `handleTournamentStats` lives in `public.ts` beside `handleTournamentStandings` (the shared preamble helpers `enforceTournamentViewRateLimit` and `setupGateHides` are module-private there); it applies the same preamble — CORS, session, rate limit, load tournament, 404 via `setupGateHides` — then delegates to `computeCompetitionStats`. Dispatch `GET /v1/tournaments/:id/stats` in `cloud/src/index.ts` as a regex+route entry modeled on the `/standings` entry (`index.ts:355-357`).

### Stage 2 — Plane B1 backend (chart 3) — independent of stage 1

3. **Corpus resolver** — `resolveTournamentCorpus(env, tournamentId) → StatsCorpus` in `cloud/src/stats/resolve.ts`, the §6 SQL verbatim (join through `tournament_rounds`, `status='complete'`, `game_id IS NOT NULL`). It drops the `viewerScope`/`scope` threading of `resolveUserCorpus` — tournaments are public — and needs no existence probe: the handler has already loaded the tournament for the gate.
4. **Focal widening** — `buildChartBundle` gains `focal: "uploader" | "humans"`, threaded into exactly the two self-convention sites: `buildSelfMembership` (`aggregate.ts:145-151`) and the `selfClause` in `loadYieldCurves` (`aggregate.ts:224`). The tournament handler passes `"humans"`; the user handler passes `"uploader"` (behavior unchanged — pin with a regression test).
5. **Type split (minimal)** — split the bundle type into a chart-fields core plus the user-only Overview extension (`win_rate`, `games_with_outcome`, `summary.top_nation`/`top_archetype`), per §6. Its only MVP job is keeping the broken-by-widening fields out of the tournament response — go no further. Fallout to expect: the cache module's `ChartBundle`-typed signatures (`getCached`/`putCached`, `cache.ts`) need the split threaded through, and the frontend mirror lives in `src/lib/stats/types.ts:22`. Builders reused at tournament scope are retyped to the core with logic unchanged. `save_dates`/`favorite_day_of_week` stay in the core for now (correct per-game fields; §6 defers their final home).
6. **Cache variant** — add `kind: "tournament"` to `StatsCacheKey` (`cache.ts:33-48`), keyed on `tournament_id` + `tournaments.updated_at` (§6). Key-drift is the invalidation; the two uncovered paths (game deletion, same-version re-derivation) are bounded by the 24h TTL (settled).
7. **Handler + dispatch** — `handleTournamentGamesStats`, same preamble as stage-1's handler (also in `public.ts`), pinned to `CURRENT_PARSER_VERSION` exactly like `handleUserStats` (`stats/handlers.ts:46,62`): check cache → resolve corpus → `buildChartBundle(..., "humans")` → put cache. Dispatch `GET /v1/tournaments/:id/stats/games`.

### Stage 3 — Frontend (all three charts)

8. **API layer** — `getTournamentStats(id)` and `getTournamentGamesStats(id)` on `cloudApi` (`src/lib/api-cloud.ts`), request/response types adjacent, per the API-layer convention.
9. **Route** — `src/routes/tournaments/[slug]/stats/` (`+page.svelte` + `+page.ts`), mirroring the `/matches` subroute (§6 placement). Public; pre-signup hiding comes free from the endpoints' 404 gate.
10. **Rendering — no registry (settled).** Three `ChartContainer`s (`$lib/ChartContainer.svelte`) rendered directly in the page, reusing `CHART_THEME`/`getChartColor` (`$lib/config`) and `COMMON_GRID` (`charts/helpers.ts:41`) as-is. Do **not** instantiate a parallel `CHART_SPECS` registry for the tournament shapes, and do not parameterize `ChartSpec`/`StatsView` yet — the spec-loop earns its keep at user-stats scale (~22 charts, category subtabs), not at three charts on one page. The §5 parameterization happens when Plane A grows past a handful of charts.
11. **Option builders** — `standingsOption` and `casterLeaderboardOption` are new, tournament-native (no user-stats analog; both simple bar charts — see the examples doc), living with the tournament UI code in `src/lib/tournament/`. Chart 3 reuses `nationWinLossStackedOption` (`src/lib/stats/charts/nations.ts:21`) with logic unchanged (retyped to the bundle core per item 5).

### Tests

12. Unit beside source: `computeCasterLeaderboard` (parts walking, `user_id`-vs-`name` grouping, ordering), `resolveTournamentCorpus` (the `status='complete'` + null-`game_id` filters), the focal widening (`"humans"` counts each human row once; `"uploader"` output unchanged from today's). Miniflare integration under `cloud/test/integration/` for both endpoints: 404 pre-signup, rate-limit budget recorded, response shapes, and the `/stats/games` cache write/read path.

### Explicitly out of the MVP (deferred, not dropped)

- Plane A remainder: H2H matrix, standings-over-rounds, per-map win rate / usage, pick-order advantage, bye distribution, forfeit rate, championship upsets, match length, schedule view, signup funnel, participation/survival.
- The tournament-native summary tiles (§6's settled replacement for the user Overview tiles).
- Plane B1 remainder — near-free after stage 2: the bundle already carries every B1 field, so the remaining ~9 charts are frontend-only work.
- Plane B2 (participant dimension + the §5 UI generalization), Plane C (match deep-dive), Plane D (batched parser bump).
- The Plane A cache (uncached v1; the `tournament_id`+`updated_at` key variant exists to add if it measures slow).
- The full `ChartSpec`/`StatsView` parameterization (see item 10).

### After the MVP

The original phase ordering still applies to the remainder: Plane A remainder → B1 remainder (option-builders only) → UI dimension generalization + Plane B2 → Plane C → Plane D → ship-sync (update `docs/aggregate-statistics.md` — its Future-work bullet and History section point at this redo — record the as-built in `docs/tournament-implementation-notes.md`, and retire this doc's forward-looking status by folding it into the notes or archiving).

## 8. Decisions (settled)

All six questions this section used to hold were resolved in a pre-build design review (2026-07-05), verified against the code. A follow-up MVP-scoping review (same day, also code-verified) settled four more — those are the last four bullets, with build detail in §7. This is the record.

- **B1 aggregator mechanism — focal-mode parameter + type split, not a forked path** (§6). The self convention is exactly two code sites; the broken-by-widening Overview fields are excluded by splitting the response type (chart core vs. user-only extension), not by nulling at runtime.
- **Game-id list — `status = 'complete'` only** (§6). Excludes forfeit matches left holding a linked game by retro-edits. Save-vs-official outcome disagreements are **documented, not filtered**: standings show official results, charts show what happened in the games.
- **Shared vs separate chart set — separate**, unified only at the UI-shell level (§6).
- **Participant identity key — the 0024 match snapshots, grouped by `user_id` with frozen-username fallback.** Slots fail twice as a key: they're per-phase (the championship transition splits one person across two slot rows) and substitution rewrites the live slot (`user_id`/`discord_id` nulled, `discord_username` overwritten). The 0024 snapshots (`slot_a/b_user_id` + `slot_a/b_username`, frozen when a match leaves `pending`, backfilled for all pre-0024 non-pending matches) survive both. Composite key: `user_id` when claimed, else the frozen username; display label from the snapshot username; avatar via the `users` join when `user_id` is present (degrading to placeholder, as 0024 intended). Accepted edges: an unclaimed occupant renamed mid-tournament splits into two participants (rare, admin-fixable); pending matches have no snapshot but contribute no stats. Plane B2 attributes save rows through the same match row: side-A/B snapshot + `slot_a/b_player_index` → `(game_id, player_index)` → person.
- **Caching — ships in v1 for Plane B; Plane A uncached** (§6). The target tournament's corpus is hundreds of games, putting the bundle compute well past the `/standings` per-read cost that Plane A shares. Key-drift invalidation covers all tournament mutations; the two uncovered paths (game deletion, same-version re-derivation) are bounded by the 24h TTL.
- **Plane D — one batched parser bump, not per-chart.** Reparse-all is the expensive unit, so batch the chosen extractions into a single bump, riding the next organic parser bump if one lands first. Priority, biased toward the tournament audience (casters, match deep-dive) and extraction cost: (1) military unit-type breakdown (`units_produced`), (2) wonders, (3) ambitions/goals. Deferred: per-city detail, territory/map history, family/religion opinion history, event/story timelines (heavy row volume or niche audience). The dropped `player_summaries.pick_order` re-derivation (`0004`) rides the same bump if it's ever wanted.
- **MVP slice — three charts** (§7): standings visualization + caster leaderboard (Plane A) and nation win rate (B1), chosen so the set exercises both subsystems, both endpoints, both response shapes, and the shared shell. Charts 1–2 ship alone as a live page; chart 3 stands up the full B1 pipeline that makes the remaining ~9 B1 charts frontend-only.
- **`/stats` is self-contained.** The Plane A response embeds the standings block by reusing `computeStandingsResponse`, so the stats page makes one Plane-A fetch instead of also hitting `/standings`. The duplicate match load behind it — `computeStandingsResponse` loads internally, the caster leaderboard loads again — is accepted for v1 (small table, same cost class as the uncached `/standings` read); no preloaded-rows refactor unless it measures slow.
- **Caster identity enrichment reuses the existing batch map** — `parseParts` + `loadUserIdentitiesForMatches`, the same path `serializeMatch` uses for casters. No new users join.
- **No chart registry in the MVP.** The three charts render as direct `ChartContainer`s in the page. Neither a parallel tournament `CHART_SPECS` registry nor the §5 `ChartSpec`/`StatsView` parameterization ships until Plane A grows past a handful of charts — a parallel registry would be the second idiom this repo's contribution rules warn against, and the parameterization has nothing to earn its keep at n=3.
