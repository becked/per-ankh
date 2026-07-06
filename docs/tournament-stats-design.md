# Tournament stats — design & build plan

> **Status:** forward-looking design doc, not an as-built record. Written to be *built from* in a future session. Grounded in a code read of the stats layer (`cloud/src/stats/`, `src/lib/stats/`), the tournament tables (`cloud/migrations/0006`–`0030`, `cloud/src/tournament/`), and the save-derivation layer (`cloud/src/derive-player-summary.ts`, `cloud/migrations/0002`). Companion to `docs/aggregate-statistics.md` (the user-stats as-built record), which this extends.

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
- The declarative catalog shell: `CATEGORIES` + `CHART_SPECS` (`charts/registry.ts`) + the spec-loop in `StatsView.svelte` (category subtabs, `hasData`/`height`/`emptyMessage`, in-chart title injection). Two caveats: the spec-loop only drives the nations and cities categories today — yields/families/laws/tech are special-cased to their panels in the category dispatch (`StatsView.svelte:121-128`), their registry entries being anchor-only stubs — and `buildOption()` maps spec ids to builders through a hardcoded switch (`StatsView.svelte:62-73`) that new charts must extend.
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
  ```
  (the join is required — `tournament_matches` has no `tournament_id` column). That alone feeds `buildChartBundle` unchanged and yields Plane B1. Open (§8): whether to also require `m.status = 'complete'` — an admin retro-edit can leave a linked game on a `forfeit` match (`PatchMatchSchema` accepts `game_id`; status flips don't clear it).
- **Aggregator widening — per-field, not one switch.** The `is_uploader=1` "self" convention lives in one SQL clause (`loadYieldCurves`, `aggregate.ts:224`) and the JS `selfRows`/`selfMembership` set (`aggregate.ts:145-151`, `401-404`). For an all-humans tournament corpus the bundle fields split three ways:
  - **No change needed:** `lawTiming` and `techTiming` already aggregate all `is_human=1` rows; `save_dates`, `favorite_day_of_week`, `summary.total_games`, `summary.avg_total_turns` are per-game.
  - **Correct once widened:** `nationWinRate`, `nationAvgPoints`, `nations`, `familyByNation`, `yieldCurves`, `openingLaws`, `techFirst`, `expansionWinRate`. Each (game, human) pair is a sample; a 1v1 game contributing one win row and one loss row is the intended semantics for these charts.
  - **Broken by widening:** `win_rate`/`games_with_outcome` (`aggregate.ts:451-456`) assume one self row per game — over an all-humans 1v1 corpus, win rate is ~50% by construction and the game count doubles. `summary.top_nation`/`top_archetype` turn into "most-played across all participants" (a different stat, possibly still wanted). These need tournament-specific replacements or omission, not widening.

  Flag vs. separate code path is still open (§8) — but either way the mechanism has to carry the third group's exclusions, so it's bigger than a WHERE-clause toggle.
- **Cache:** the existing bundle cache is KV (`SESSIONS_KV`, `stats:` prefix, 24h TTL), keyed `stats:v{BUNDLE_SCHEMA_VERSION}-p{parser_version}:user:…` (`cache.ts:43-48`), so a parser bump orphans every entry with no purge step. Add a `kind:"tournament"` variant to `StatsCacheKey`, keyed on `tournament_id` + `tournaments.updated_at`. Note `updated_at` is **not consumed as a cache key anywhere today** — `/standings` and `/bracket` recompute on every read, with no ETag/Cache-Control — but it *is* bumped on every mutation (`bumpTournamentUpdatedAt`, `data.ts`), which is exactly what key-embedded invalidation needs: a mutation drifts the key, the next read recomputes, and the orphaned entry dies by TTL (the same expiry-by-drift pattern the parser-version segment uses; no `invalidateStatsCache` analog required). Whether v1 ships with caching at all is an open decision (§8).

**(2) Tournament competition stats (Plane A) — new, tournament-native.**
- A separate response shape (not a `ChartBundle`) computed largely by reusing `standings.ts` / `computePairwiseH2H` / bracket logic. Own handler, own cache key (same `tournament_id`+`updated_at`).
- Renders through the same reused `ChartContainer` + spec-loop shell.

**Recommendation on the open question** (shared layer vs separate set): **separate.** Plane A is keyed by slot/match/round and doesn't fit the "ChartBundle over a game-id corpus" model; forcing it in is the same mistake as the removed `CorpusContext` union. Keep the ChartBundle machinery for Planes B/C and give Plane A its own shape — unified only at the UI-shell level.

**Placement (open):** a Stats tab on `/tournaments/[slug]`, mirroring the user Stats tab, is the natural home. Confirm with the user before building routes.

## 7. Suggested build phases

1. **Plane A, standings + H2H first** — highest value, data already computed, no aggregator changes. Proves the tournament-native response shape + reused UI shell.
2. **Plane A remainder** — maps, pick-order, rounds, byes/forfeits, casters, schedule, funnel.
3. **Plane B1** — tournament corpus resolver + the per-field `is_uploader` widening (§6) + cache variant (if caching is in scope — §8). Lights up the save-content charts at tournament scope, minus the Overview-style self metrics.
4. **UI dimension generalization + Plane B2** — nation→entity selector, participant grouping.
5. **Plane C** — match deep-dive (per-match, two-player overlays).
6. **Plane D** — pick specific charts, do the parser-bump + reparse work per chart.

## 8. Open decisions for the build session

- **Scope of B1's aggregator change:** corpus flag vs. separate path for the `is_uploader` widening. ("Self" has no meaning in a tournament corpus — settled by the §6 breakdown; either mechanism must also exclude the broken fields.) Remaining: what replaces the `win_rate`/`top_nation`-style Overview tiles — tournament-specific summary numbers, or omission?
- **Which matches feed the game-id list** — any non-null `game_id`, or `status='complete'` only (§6)? Related: Plane B charts count *save* outcomes (`is_winner`), which a retro-edit can put at odds with the official `winner_slot_id`; acceptable, but decide whether to filter or just say so.
- **Shared vs separate chart set** — recommended separate (§6); confirm.
- **Participant identity key** — slot_id? user_id? Slots persist across substitutions and are per-phase (`tournament_slots.phase`), so one person holds different slot rows in swiss vs championship (the transition copies `user_id`/`discord_id`/`discord_username` onto the new championship slot). Match rows freeze `slot_a/b_user_id`+`username` at report (`0024`); substitution clears the slot's `user_id`/`discord_id` but leaves those snapshots intact. Leaning: attribute matches via the 0024 snapshots (`user_id` when claimed, else the frozen username) and group participant stats by `user_id`. Decide before B2.
- **Route & UX** — `/tournaments/[slug]/stats` tab? Anonymous-visible (tournaments are public) — reuse the viewer-scope logic or is everything public here?
- **Ship caching in v1?** The KV bundle cache is cheap to reuse for Plane B (a key variant; invalidation is free via `updated_at` key-drift + TTL). Plane A costs about the same as the already-uncached `/standings` compute — defer unless it measures slow.
- **Setup-phase / mid-tournament** — show partial stats during `swiss`, or gate on `complete`? (The removed v1 had a mid-tournament "provisional" banner — `docs/aggregate-statistics.md:211`.)
- **Which Plane D charts justify a parser bump** — reparse-all is heavy; prioritize.
