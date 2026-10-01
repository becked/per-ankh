# Global stats — design

A public `/stats` surface that runs the existing chart catalog over the **whole public corpus** rather than one user's library or one tournament's games. Written forward-looking, as the plan; §16's nine steps have since been built. The plan is kept intact and a **Built:** note marks every place the outcome diverged from it — the reasoning is why the code looks as it does, and deleting it would leave the divergences unexplained. When it ships, fold the outcome into `docs/aggregate-statistics.md` and retire this doc.

Status: **built, not deployed.** Written 2026-08-28; built 2026-08-29 on `feat/global-stats`; §8.1's field drop landed 2026-08-30 ahead of merge. All nine steps of §16 landed. One thing specified here did not, and it was deferred by the plan itself: the tournament chart tabs (§9). §17 says which of its doc updates are done.

## 1. What this is

Today the chart catalog answers "how do *my* games look" (`/users/[user_id]?tab=stats`) and "how did *this tournament* look" (`/tournaments/[slug]/stats`). It cannot answer "how do multiplayer duels look, across everyone" — the question the charts are actually best at, because it is the only corpus large enough for the distributions to mean something.

`/stats` is that surface: pick a **slice** (a corpus), optionally narrow it to one **nation**, read the same charts.

## 2. What already exists

Most of the machinery is in place, and this is deliberate — `docs/aggregate-statistics.md` §"Core idea" kept the seam open on purpose.

- **The corpus seam.** `buildChartBundle(env, corpus, parserVersion, focal)` (`cloud/src/stats/aggregate.ts:684`) takes an opaque game-id list and nothing else. Two resolvers feed it: `resolveUserCorpus` and `resolveTournamentCorpus` (`cloud/src/stats/resolve.ts`). A global slice is a third resolver.
- **The focal widening.** `focal: "humans"` (`aggregate.ts:40`) already counts every human player rather than only the uploader — built for tournaments, and exactly right for a global corpus where both sides of a duel matter. It returns `ChartBundleCore`, which correctly omits the one-focal-per-game fields (`win_rate`, `summary.top_nation`) that read ~50% by construction over an all-humans corpus.
- **Composition predicates.** The `vs_ai` / `mp` game-type fragments in `cloud/src/games-scope.ts:63-79` are pure `game_id IN (subquery)` with no `user_id` reference, so they lift to a global corpus unchanged.
- **The KV bundle cache.** `cloud/src/stats/cache.ts` — parser-version and schema-version embedded in the key, 24h TTL, prefix-walk invalidation.
- **The cron.** `wrangler.toml` already declares `crons = ["47 3 * * *"]` with a `scheduled` handler (`cloud/src/index.ts:1201`) that reads `controller.cron`.

What did **not** exist when this was written — a global resolver, a facet vocabulary, precomputation, the route, and the frontend's ability to render a `ChartBundleCore` through the chart registry (see §9) — is exactly what §16's steps built.

**Built:** `resolveGlobalCorpus` and `listGlobalSliceNations` (`cloud/src/stats/resolve.ts`), the composition fragments in `cloud/src/games-scope.ts`, `cloud/src/stats/precompute.ts`, `GET /v1/stats` (`cloud/src/stats/handlers.ts`), the registry typed at `ChartBundleCore` (`src/lib/stats/types.ts`), and the route at `src/routes/stats/`.

## 3. Slices

Four, each `is_public = 1`. Counts are from the 2026-08-25 corpus snapshot; §15 re-derives them.

| Slice | Predicate | Public games | Focal rows |
| --- | --- | --- | --- |
| All public games | (no composition filter) | 572 | 90,406 |
| Multiplayer duels | exactly 2 players, both human | 538 | 78,878 |
| Multiplayer FFA | 3 or more human players | 19 | 9,363 |
| Single-player | exactly 1 human player | 10 | 1,209 |

*Focal rows* are the human `game_player_turn` rows a slice feeds to `loadYieldCurves` — the quantity §7 is denominated in, and the one that governs whether a slice fits.

**The corpus is duels.** 94% of public games are 1v1, so "All public games" and "Multiplayer duels" are the same charts to within 34 games, and the other two slices are small enough that a facet applied to them is decorative. Ship all four regardless: the taxonomy is the point, and the two thin slices cost at most 126 queries and ~20 MB each. Expect the duel slice to carry the page.

**Tournament is not a slice.** A tournament match is two humans playing each other, so tournament games are a subset of multiplayer duels — not a sibling category. Per-tournament stats already have their own page. This is deliberate and is the same taxonomy defect that issue #228 records against the existing `?scope` selector.

**The duel predicate counts players, not humans:** `HAVING COUNT(*) = 2 AND SUM(is_human) = 2`. The existing scope predicates filter `WHERE is_human = 1` and *then* count, which lets a 2-human + 2-AI game pass as a duel. The shared helper implements the player-counting form; the divergence covers 5 public games today, at player/human compositions 3/2, 4/2, 5/2 and 6/2.

**The three composition slices do not partition the corpus.** Those same 5 games match no composition predicate — too few humans for FFA, too many for single-player, too many players for a duel — and so appear only under "All public games". That is the intended reading, and it is why the all-public slice is not the union of the other three (its 90,406 focal rows against their 89,450).

## 4. Facets

One facet: **nations**, single-select, ANDed with the slice.

Eight bundle fields are already nation-keyed (§4.3), so the unfaceted bundle puts every nation side by side and cross-nation *comparison* needs no control at all. What the facet adds is the other eight fields — `yieldCurves` above all — narrowed to one nation. That is a single-select question, and answering it single-select is what keeps the whole selection space precomputable.

**Map size is not a facet.** Its cells do not hold: 395 of 538 public duels are `MAPSIZE_SMALLEST`, and crossing map size with nations gives 68 non-empty cells of which 47 hold fewer than 10 players. It is deferred with a measured trigger (§14). No bundle field is keyed by map size, so deferring the facet keeps map size off this surface entirely — that is the cost, and it buys a facet space small enough to precompute whole.

### 4.1 The selection space is precomputable

13 playable nations in the public corpus, single-select, across 4 slices: **52 faceted bundles plus the 4 unfaceted slices, 56 in all.** Every one is precomputed nightly (§5).

A faceted selection is a subset of its slice, so it costs `ceil(N/50) × 9` against its own smaller N rather than the slice's:

| Slice | Unfaceted | 13 nation bundles | Total |
| --- | --- | --- | --- |
| All public games | 108 | 261 | 369 |
| Multiplayer duels | 99 | 243 | 342 |
| Multiplayer FFA | 9 | ≤ 117 | ≤ 126 |
| Single-player | 9 | ≤ 117 | ≤ 126 |

**Built: eight loops, not nine, so every figure above is 8/9 of what the plan projected.** §8.1's drop took `loadSaveDates` off the all-humans path — the field it fed is now user-only — so a global bundle costs `ceil(N/50) × 8`. The table becomes 96 / 232 / **328** for all-public, 88 / 216 / **304** for duels, and 8 / ≤ 104 / **≤ 112** for each thin slice: **~856 nightly, not ~963.** Nothing downstream changes its shape — the margin against the 1,000 ceiling widens, and the paragraph below still decides the same way for the same reason.

**One cron pattern per slice.** 963 queries in a single invocation would run against the 1,000 ceiling with no headroom. `crons` is an array and the handler dispatches on `controller.cron`, so a pattern per slice gives each a fresh query budget *and* a fresh isolate, and a fifth slice later adds a pattern instead of eating another's margin. Keep every pattern at an interval ≥ 1 hour to stay on the 15-minute CPU tier.

Within an invocation the bundles are built and written **sequentially, each released before the next**, so peak memory is one bundle rather than fourteen. The unfaceted slice is the largest of them (§7).

Storage is not a constraint: 56 bundles at ~600 KB is ~34 MB against 1 GB included, and 56 nightly writes is ~1,700/month against 1M.

### 4.2 A nation narrows both the games and the focal set

In a Rome-vs-Greece duel with "Rome" selected, narrowing by *game* alone would qualify the match and then feed **both** players' rows into `yieldCurves` — including the Greek's. That is not what anyone means by "Rome stats".

So a nation selection narrows twice: the corpus becomes the slice's games holding at least one Rome player, and the focal set becomes those players' rows. Both, not either — narrowing only the focal set leaves `meta.game_count` reporting the whole slice, a control that visibly fails to move a headline number, and narrowing only the games is the Greek-rows defect above. Map size, were it ever a facet, would need only the first: it is a pure game property.

`summary.total_games` and `meta.game_count` stay derived from the corpus id list, not from focal membership. Deriving them from the focal set would make the two impossible to drift apart, which is the better structure, but it is not free: `buildSelfMembership` selects on `is_uploader = 1` for the user corpus, and the 19 observer uploads carry no such row — they would silently drop out of a count that includes them today.

Consequence: the focal convention gains a third form. It currently lives in exactly two places (`buildSelfMembership` and `loadYieldCurves`'s `selfClause`, both in `aggregate.ts`); a nation-restricted focal must thread through both and nowhere else.

**Built: "nowhere else" was wrong, and the facet is what exposed it.** Those two are where the focal set is *decided*, but a field is only focal if it consults the result — and two never did. `lawTiming` and `techTiming` aggregated every seat in the corpus's games, so a Rome selection fed the Greek's laws and techs into a Rome bundle: the precise defect this section exists to prevent, surviving in the fields least likely to be checked for it, since `openingLaws` and `techFirst` are built from the same event arrays a few lines away and filtered correctly all along. Both now filter at the loop that feeds them (`aggregate.ts:1166`, `:1267`); doing it there rather than at each consumer also made `techFirst`'s own check redundant, so the population is decided once. The fix reaches the user surface too — Law adoption and Tech timing on a profile now show that user's seats instead of pooling their opponents' — and `cloud/test/integration/stats/round-trip.test.ts` states the invariant for both focal modes rather than only snapshotting it. The general form of the rule: **a field is focal only if it filters on `selfMembership`, and adding a field means saying which population it draws from** (§8.3).

### 4.3 Rejected: nation as a client-side display filter

Eight bundle fields are already nation-keyed (`nationWinRate`, `nationAvgPoints`, `nations`, `familyByNation`, `lawTiming`, `openingLaws`, `techFirst`, `techTiming`), so a nation filter could be a free client-side row filter over data already in the payload. But the other eight are not nation-keyed (`yieldCurves`, `wonderStats`, `capitalFamilyWinRate`, `expansionWinRate`, `startingArchetypeWinRate`, `startingTraitWinRate`, `summary`, `favorite_day_of_week`) and would silently ignore the filter. Half the page quietly not respecting a control is worse than not offering the control. Rejected.

## 5. Architecture: precompute every selection, compute on a miss

```
cron (nightly)      56 selections ──▶ KV, 24h
request on a miss ──▶ compute in-request ──▶ KV, 24h
```

Every selection the UI can express is precomputed (§4.1), so the steady state is a KV read.

The request path still computes on a miss, and that is not a vestige. A `BUNDLE_SCHEMA_VERSION` bump orphans every key at once (§12) and a deploy warms only the four slices, so a nation selection asked for between the bump and the next cron is served by computing it. **Never refuse on a miss.** Precompute-only is the one shape that would make this facet model expensive to change later; compute-on-miss is what keeps the model a UI decision.

**Built: the warm of the four is an hourly cron, not a deploy step (§12).** The conclusion this paragraph draws is unchanged, and the shape of the diagram above gains a row: a second cron, four unfaceted slices, conditional on the key being missing. What moves is the timing on either side of it. The four unfaceted slices come back within an hour of a bump rather than at the moment of the deploy, so the window in which even a slice is computed in-request is one interval wide instead of zero. And the 52 faceted selections are exactly as this paragraph says — computed in the request until the night's precompute, because the warm deliberately does not reach them (all 56 in one invocation is ~856 queries against the 1,000 ceiling).

**One tier, one TTL.** Both paths write the same kind of entry, so `putCached`'s 24h TTL stays uniform. The cron warms keys the request path could fill on its own; it does not own a separate class of entry with its own expiry.

Three things stay set-shaped for the same reason, at no cost today:

- the resolver takes a set — `resolveGlobalCorpus(slice, { nations: string[] })` — even though the UI sends one value;
- cache keys normalize (sort, dedupe) the nation set before stringifying, so a single value is a one-element list;
- the compute-on-miss path above.

With those three, widening to multi-select later is a UI and URL change with no backend migration: it costs the precompute table in §4.1, not the architecture.

CPU is not what bounds this path. A whole-corpus aggregation costs ~1s of JS (§6.1) against a 30s fetch-handler default (raisable to 5 min via `limits.cpu_ms`), and a faceted selection is a subset of its slice and therefore cheaper still. The request path is bounded by memory instead — §7.

## 6. Budgets and platform limits

Verified against Cloudflare docs, 2026-08-28.

| Limit | Value | Note |
| --- | --- | --- |
| Cron CPU time | 30s if interval < 1h; **15 min if ≥ 1h** | A daily cron gets the 15-min tier |
| D1 queries per invocation | **1,000** (Paid) | The binding constraint, not subrequests |
| Subrequests per invocation | 10,000 (Paid) | D1/KV calls count; not a concern here |
| Isolate memory | **128 MB** | See §7 — the real ceiling |
| D1 rows read | 25 B/month included, then $0.001/M | Effectively free at this scale |
| KV writes | 1M/month included, then $5/M | Nightly × 56 selections ≈ 1,700/month |
| KV storage / max value | 1 GB included / 25 MiB per value | Not a concern |
| D1 max bound params | 100 | Why `CHUNK_SIZE = 50` leaves headroom |

**Query arithmetic.** The aggregator runs 9 chunked query loops at `CHUNK_SIZE = 50`, so a corpus costs exactly `ceil(N/50) × 9` queries. The all-public slice is 108 and the four unfaceted slices together are 225. With their nation bundles the nightly total is ~963, which is why the cron runs a pattern per slice rather than one invocation (§4.1). The ceiling arrives at roughly 5,500 games in a single slice (§14).

**Built: eight loops.** `loadSaveDates` is the ninth, and §8.1's drop made it uploader-only, so the arithmetic above holds with a `× 8` for any corpus the global surface builds — 96 for the all-public slice, 200 for the four unfaceted together, ~856 nightly. The user path still runs all nine. The ceiling moves out to roughly 6,000 games in a single slice (§14).

**Both the query ceiling and the memory ceiling are per invocation**, which is what the per-slice cron pattern in §4.1 buys: each pattern gets a fresh 1,000-query budget *and* a fresh isolate.

### 6.1 Cost of one aggregation

Baseline, established by driving the real `buildChartBundle(env, corpus, version, "humans")` over all nine loaders against the 2026-08-25 snapshot, with D1 replaced by an in-process SQLite shim of `QueryableD1` (Apple M2, Node 25):

| Slice | Queries | JS CPU | Peak live heap | Bundle JSON | gzipped |
| --- | --- | --- | --- | --- | --- |
| All public (572) | 108 | ~0.98 s | 97.7 MB | 622 KB | 154 KB |
| Duels (538) | 99 | ~0.87 s | 86.4 MB | 597 KB | 151 KB |
| FFA (19) | 9 | ~0.09 s | 19.6 MB | 419 KB | 112 KB |
| Single-player (10) | 9 | ~0.02 s | 2.8 MB | 385 KB | 94 KB |

**Built: measured before §8.1's drop, and left as measured.** The Queries column is arithmetic and is now 96 / 88 / 8 / 8 (`× 8`, above). The other three columns are a measurement of code that still loaded and returned `save_dates`, so each is now an overstatement by whatever that field cost — a per-game array, so the overstatement grows with the slice and is largest for all-public. They are not re-derived here rather than guessed at: §15's harness is what re-derives them.

Read these as an order of magnitude, not a contract, in two directions. SQLite runs in-process, so its time is excluded from JS CPU exactly as D1's would be — but workerd charges result deserialization the shim does not, so the deployed figure is some multiple of this rather than equal to it. And Node's `heapUsed` is not workerd's 128 MB accounting; what transfers is the ratio between slices and the slope in §7, not the third digit.

## 7. Memory — the binding constraint

`loadYieldCurves` (`aggregate.ts:286`) pulls **raw** `game_player_turn` rows and retains, per row, one number in each of 32 arrays (16 series × rate + cumulative). Decided games land in `pooled` *and* one of `winners`/`losers`, so they are stored twice.

The rate is **~890 bytes of live heap per focal row**, over a ~17 MB floor for the other eight loaders — a slope confirmed across corpus subsets from 143 to 572 games. `loadYieldCurves` is ~83% of the peak: holding the corpus fixed at 572 games and halving the focal set (`focal: "uploader"`) takes the peak from 97.7 MB to 57.3 MB.

At 90,406 focal rows that puts the all-public slice at **97.7 MB against a 128 MB isolate** — 76% of the ceiling in live objects, before allocation churn. §7.1 is what buys the headroom back, which is why it is a prerequisite rather than a tidy-up.

### 7.1 Required: disjoint cohorts

Accumulate **winners / losers / undecided** as three disjoint cohorts instead of `pooled` + `winners` + `losers`. The pooled bands are then the merge of all three at band time — exactly identical percentiles. Local change to one function, no bundle-shape change.

The saving is set by how much of the corpus is decided, since a decided row is the one stored twice. 89,284 of 90,406 public focal rows — **98.8%** — sit in decided games, so this halves sample storage: `loadYieldCurves` goes from ~81 MB to ~41 MB and the all-public peak lands near 55–60 MB. That is the difference between a slice that fits with room and one that runs at 76% of the isolate.

### 7.2 Contingency: turn-window chunking

Out of v1 scope — with §7.1 the largest slice fits with roughly half the isolate free. If a slice later outgrows it, process turns in windows (1–20, 21–40, …) instead of all at once. Percentiles are computed per turn independently, so windowing partitions the work along an axis the algorithm already partitions along — **byte-identical output, no bundle-shape change**, invisible to every chart.

The trigger is a row count, not a game count: against a 128 MB isolate the ceiling is ~125,000 focal rows as the code stands and ~250,000 with §7.1 — about 1,600 public games at the current ~158 focal rows per game.

Costs: windows must run sequentially (parallel defeats the memory bound), so wall-clock grows and global slices become cron-only rather than on-demand-capable; needs the turn range up front; the window width is a tuning knob whose right value drifts with corpus size.

Alternatives considered and rejected: **t-digest / reservoir sampling** (constant memory, but approximate — the global page's bands would differ from the tournament page's over overlapping data, an invisible inconsistency in charts we deliberately share); **percentiles in SQL** (288 values per turn; unmaintainable as one statement, ~30 queries split up, and structurally unlike the other eight loaders); **a precomputed rollup table** (permanently cheap, but it duplicates in D1 what §4.1 already precomputes into KV — a second storage shape for the same enumerable set of groupings, rebuilt on every bundle-shape change).

## 8. The bundle

**Decision: one bundle per corpus, as today. Not split per category.**

The deciding fact is that the bundle is **size-stable as the corpus grows**. `yieldCurves` is 17 series × 2 (rate/cumulative) × 3 bands × 3 cohorts = 306 arrays of length `turns.length` — that is `O(max_turn)`, not `O(games)`. The per-nation/law/tech rows are `O(nations × laws)`. On the current 152-turn axis the all-public bundle is 622 KB of JSON, 154 KB gzipped, and it stays there as games accumulate. The 10-game single-player slice is 385 KB / 94 KB on the same axis — 57× fewer games for 62% of the payload — which is the property this section rests on.

Two fields scale with game count rather than turn count: `save_dates`, which the global bundle drops (§8.1), and `openingLaws`, which §8.2 bounds. With both handled the size-stability above holds.

**The rule to revisit this:** split per category only if a field is added whose size scales with game count.

### 8.1 Per-field disposition

Which `ChartBundleCore` fields survive the widening to a global corpus.

| Field | Global? | Notes |
| --- | --- | --- |
| `meta.game_count` | keep | |
| `summary.total_games` | keep | |
| `summary.avg_total_turns` | keep | |
| `save_dates` | **drop** | `O(games)`; a calendar heatmap of the whole site is not a chart |
| `favorite_day_of_week` | **drop** | no consumer on any surface — the profile card reads its own copy from `GET /v1/users/:user_id`, not the bundle |
| `nations` | keep | |
| `nationWinRate` | keep | reads as deviation from ~50%, not absolute |
| `nationAvgPoints` | keep | |
| `startingArchetypeWinRate` | keep | |
| `startingTraitWinRate` | keep | |
| `wonderStats` | keep | a row reports the pooled subset when it has a denominator, everything when it has none — §8.3 |
| `capitalFamilyWinRate` | keep | |
| `familyByNation` | keep | |
| `yieldCurves` | keep | the payload and memory driver |
| `lawTiming` | keep | |
| `openingLaws` | keep, bounded | `O(games)` as it stands — §8.2 |
| `expansionWinRate` | keep | |
| `techFirst` | keep | |
| `techTiming` | keep | |

**Built: both drops happened, at `BUNDLE_SCHEMA_VERSION` 9 — but not as a per-corpus disposition.** The first attempt at this stalled on exactly that: `buildChartBundle` has no per-corpus field disposition, and inventing one to drop two fields is a poor trade. The seam that did work was already there. `ChartBundleCore` / `ChartBundle` is a structural subtype split with `withOverview` as its one constructor (built for the tournament widening), so `save_dates` did not need dropping *from a corpus* — it needed **moving to the user-only extension**, which is a question about consumers rather than corpora and answers itself: only the profile Overview calendar (`src/lib/users/OverviewTab.svelte`) has ever rendered it, and that component's prop was already typed `ChartBundle`. `favorite_day_of_week` is simply deleted — the profile card reads its own copy from `GET /v1/users/:user_id` (`cloud/src/users.ts`), so the bundle's copy had no consumer on any surface.

Three consequences beyond the payload the plan was after. The loader goes with the fields — `loadSaveDates` now runs only on the uploader path, since an all-humans bundle has nowhere to put the result — so a global bundle costs eight chunked query loops instead of nine, and every figure in §4.1, §6 and §6.1 moves by that ratio. §8's size-stability claim is restored rather than propped up: `openingLaws`'s bound is no longer carrying it alone, because the field that scaled with game count is off this bundle entirely. And it settles a question `docs/tournament-stats-design.md` §6 left open — whether these two belong in the core or the user extension turned on whether the tournament page renders a save-date calendar, and it never did.

### 8.2 Bounding `openingLaws`

Distinct (nation, four-law-set) rows grow with the corpus — 139 at 143 games, 270 at 286, 469 at 572 — and 67% of them are singletons. At 51 KB it is the third-largest field, and the only one besides `save_dates` without a ceiling.

The chart never shows the tail: `openingLawsOption` (`src/lib/stats/charts/laws.ts`) ranks and takes the top 15. So the field ships hundreds of rows to render fifteen.

Bounding it server-side is not quite a `slice()`, because the "All nations" view sums a combo's counts across nations *before* ranking, so a per-nation top-N can drop a row that would have placed in the aggregate. Two forms work: drop `count == 1` rows, which is safe only while the modal count stays clear of the 13 a singleton could sum to (19 today — a real margin, but one that narrows); or rank after the cross-nation sum and keep the top N per nation plus the top N overall, which has no expiry date and is what to build. **N = 15**, read off the consumer rather than chosen: `openingLawsOption` takes `.slice(0, 15)`, and top-15-overall plus top-15-per-nation is exactly what a rendered chart can reach.

Either changes chart output on the user page as well, so it lands against the round-trip test, not before it.

### 8.3 One population per ratio

The public corpus spans eleven parser versions, and a field is in a game's blob only if the parser that wrote the blob captured it. Coverage is therefore uneven, and the boundaries are sharp:

| Field source | First parser | Public games covered |
| --- | --- | --- |
| `game_player_turn`, `tech_events` | — | 572 / 572 |
| `player_family_cities` | 2.6.0 | 536 / 572 (94%) |
| `starting_ruler_archetype` | 2.9.0 | 427 / 572 (75%) |
| `game_wonder_pool` | 2.12.0 | 237 / 572 (41%) |

The admin reindex sweep rebuilds every derived table from the stored blob, so it closes any gap where the blob already holds the source — that is how `player_family_cities` reached 94%. It cannot close these: `buildWonderPoolStatements` reads `blob.game_details.disabled_improvements`, and a blob written before 2.12.0 has no such key. Only a reparse from the raw save can (§14).

So the corpus is heterogeneous, and the rule that makes it safe to publish is: **every ratio the bundle carries draws its numerator and its denominator from the same population, and the field names which.** `wonderStats` is the worked example — a wonder with pool coverage reports the builds from pooled games, a wonder without reports every build it has, and `eligible: null` is what says so. Any field added later that divides one table's rows by another's holds to the same rule.

The rule's reach is small because the aggregator is already mostly self-consistent: `corpus.gameIds.length` arrives at only `meta.game_count` and `summary.total_games`, and every other field builds its denominator from the rows it drew its numerator from. What remains is presentational — a summary tile reading 572 beside charts resting on 536 or 237 — and it is the thing to weigh before adding a tile.

## 9. Frontend

`ChartSpec` and `StatsView` were typed against `ChartBundle` (the user shape) — `hasData`, `emptyMessage`, and `height` were all `(bundle: ChartBundle) => …` (now `ChartBundleCore`, `src/lib/stats/types.ts:230-237`). The global endpoint returns `ChartBundleCore`, so **the registry must be parameterized over the bundle shape.** This is the prerequisite for everything else on the frontend.

**Built:** the predicates take `ChartBundleCore`, and that was the whole change — no generic parameter, no discriminant. `ChartBundle` extends `ChartBundleCore`, so it satisfies them structurally and the user page passes its richer bundle unchanged.

The registry is also less general than it looks: `buildOption` is a hardcoded `switch` on spec id (`StatsView.svelte:76-92`), and four of eight categories (`yields`, `families`, `laws`, `tech`) are anchor-only stubs special-cased in the template dispatch (`StatsView.svelte:141-149`). Parameterizing the registry did not change that, and did not need to.

Once parameterized, the tournament stats page's **chart tabs** can collapse onto the shared registry — it currently hand-rolls its own tabs and calls option builders directly. Its Plane A tabs (Matches, Players, Casters) stay bespoke: they render a different payload shape and a `MatchTable`, neither of which the spec loop models. **Deferred** — it is a refactor of a live surface with no dependency on the rest, and it is the natural thing to drop if the session runs long. It was dropped; the page still hand-rolls its tabs.

The facet UI is a sibling of `ScopeRow.svelte` — a slice selector plus a single-select nation dropdown, the shape `ScopeRow` already has.

**Built:** `src/lib/stats/GlobalFacetRow.svelte`, on `ScopeRow`'s markup — two hand-rolled popovers, one open at a time, each writing its own param. Both drop their param at the default rather than spelling it out, so the default view has one canonical URL and therefore one edge-cache entry (§11) instead of several spellings of the same bundle.

Selection lives in the URL as `?slice=` and `?nation=`, parsed the way `parseScopeParam` parses `?scope=`: known values pass through, anything else falls back to the default, so a stale or hand-edited URL degrades instead of 400ing. The default slice is **Multiplayer duels**: 94% of the corpus is duels, so the all-public numbers *are* the duel numbers, and landing on the label that describes the distribution beats landing on a superset whose name implies breadth it does not have.

**Built:** parsed a second time client-side, in `src/lib/stats/global-facets.ts`, the way `profileScope` mirrors `parseScopeParam`. The page has to land on the answer the Worker landed on, or the controls light a selection the payload is not for. The client parse is *stricter* on `?nation=`: the Worker only shape-checks, so a token naming no nation passes and then selects nothing, which would leave the control reading "All nations" over an empty bundle.

### 9.1 Where the nation options come from

Not from the payload. A faceted bundle reports only the nation it was faceted to — §4.2 narrows the focal seats, so `bundle.nations` comes back holding exactly one row — which is why the option list cannot be read off it the way the user page reads its nation chip off its own bundle. Fetching the unfaceted slice alongside the faceted one, purely for the list, would put two reads on a page whose rate-limit budget is denominated in one per page load (§11).

So the list is the playable roster, `Object.keys(NATION_COLORS)` — the same 13 §4.1 sizes the precompute table by. The cost is that a nation with no seat in the selected slice is still offerable, and selecting it resolves to an empty corpus and the page's empty state. On the local dev corpus of 2026-08-29 (391 public games — smaller than §3's snapshot, same shape) all 13 are seated in both the all-public and the duel slice, 12 of 13 in FFA and 7 of 13 in single-player: invisible on the two slices that carry the page, confined to the two §3 already calls decorative.

The exact fix, if the thin slices ever earn it: an optional `facet_nations` field on the global bundle. `listGlobalSliceNations` already computes it for the precompute, and keeping the field *optional* — with the roster as the fallback when it is absent — means a pre-bump cached bundle degrades instead of breaking, so it costs no `BUNDLE_SCHEMA_VERSION` bump.

### 9.2 The per-panel nation selectors are hidden on /stats

Families, Laws and Tech each carry their own `NationSelect`. That control is the client-side display filter §4.3 rejects — and at panel level it is right, because every field those three panels draw is nation-keyed, which is the exact condition §4.3 says the rejection turns on.

On `/stats` it is redundant: the page facet answers the same question for the whole bundle, so the two are two ways to ask it, and for these fields they return the same rows. `StatsView` therefore takes `showNationSelect` (default `true`) and the route passes `false`.

Worth recording that the redundancy is not free either way. For a nation-keyed field the panel selector is the *cheaper* control — the rows are already in the payload, so it costs nothing, where the page facet costs a navigation, a fetch and a rate-limit slot for the same answer. What the page facet buys that no panel selector can is the eight fields that are not nation-keyed, `yieldCurves` above all (§4). The profile stats tab and the tournament stats page keep their selectors: neither has a page-level facet, so there the panel control is the only way to read one nation at a time.

## 10. Visibility

`is_public = 1` is the whole rule. It already encodes "public because the uploader said so, **or** because it is a tournament game": tournament-linked uploads force `is_public = 1` (`cloud/src/games.ts:982`, `linkTournamentMatch`, on both the fresh-upload and dedup-link paths), and `handleGameUpdate` refuses to un-public a game linked to a match in a non-`complete` tournament (`games.ts:2626-2645`). No union predicate is needed.

One residual edge, accepted: that lockout releases when a tournament reaches `complete`, so an owner can then make a finished tournament game private. It would drop out of `/stats` while remaining on the tournament stats page, whose corpus ignores `is_public` (issue #111).

**Built: the rule above still decides the corpus, but "public" stopped meaning "publicly reachable."** `/stats` and `GET /v1/stats` now require a session (§11's Built note). `is_public = 1` is unchanged and still the only predicate on which games are in — a signed-in viewer sees exactly the games this section describes and nothing more, and the payload is still the same bytes for every one of them. What changed is the door, not the room: this section's argument that no viewer-dependent half exists is why the gate could be a bare existence check on the session rather than anything that reaches the resolver.

## 11. Access and rate limiting

`/stats` is **public** — anonymous access, no session required. It is public data, and it is the surface most likely to bring players to the site.

**Built: reversed after the branch was built — the surface requires a session.** The argument above is kept because it is still the argument *against* the gate, and it is the one to re-read if the gate is ever lifted. What outweighed it: anonymous access makes a whole-corpus aggregation something any unauthenticated caller can trigger, so the cold-start cost of §12 and the abuse ceiling of this section end up defended by the same per-IP counter and nothing else. A session is a second, cheaper gate in front of both — it is checked before the rate limit (`handleGlobalStats`, the shape `handleUserSearch` uses), so a refused call costs one cookie parse and spends no budget.

Three consequences, all accepted:

- **The reach argument is conceded, not answered.** `/stats` no longer brings anyone to the site; it is a reason to stay. The route bounces an anonymous visitor to login carrying `?next=`, so a shared link survives the round trip and lands on the selection it named — but the visitor has to sign in to get there.
- **Link previews degrade.** `enforceReadRateLimit` exempts scraper User-Agents from the *budget*, never from authentication, so a Discord or Slack unfurl of a `/stats` URL is refused like any other anonymous caller and previews as the home page. The `meta.description` the route builds per selection is now only ever seen by a signed-in browser. (`meta.title` is a constant — the tab shouldn't rename itself as the facet row is worked — so the selection reaches an unfurl through the description alone.)
- **The budget stays per-IP and stays its own.** Per-IP rather than per-user because that is the shape every other read budget has, and the session is the door rather than the meter. Its own rather than `anon_read`'s because the reason was never that both were anonymous — it was that the abuse ceiling and the cold-start ceiling should not be the same knob (§12).

Not resolved here: the response still carries `Cache-Control: public, max-age=0, s-maxage=60`, a shared-cache header on a cookie-gated response. §12 leans on that edge cache as its herd control, and the payload really is byte-identical for every viewer, so the header is not obviously wrong — but it is not obviously right either, and it is deliberately left as it was rather than changed alongside the gate.

It gets its **own rate-limit budget**, not a share of `anon_read`. The tournament budgets are separate for exactly this reason: the 2026-08-05 incident was one busy surface deciding when the others started refusing. `GLOBAL_STATS_VIEW_PER_HOUR = "600"` as a `[vars]` entry, so the ceiling can be retuned without a redeploy.

600 follows the rule the tournament block states for itself — convert through the fan-out, don't copy a number across. `/stats` is one bundle read per page load, and the three tournament budgets are each about 600 page loads an hour per visitor.

The payload is byte-identical for every viewer and changes at most nightly, so it takes an edge cache: `public, max-age=0, s-maxage=60`, the same header `channels.ts`, `featured.ts` and `tournament/public.ts` already put on their public reads. (`docs/aggregate-statistics.md` records "no client cache header" for the *user* surface, whose payload is per-viewer. This one is not.)

## 12. Caching and the cold-start problem

A whole-corpus aggregation is ~1s of JS and ~60 MB with §7.1 (§6.1), which fits a fetch handler with room. So precomputation is an optimization and never a dependency: **a miss computes in the request** (§5). The cron warms the cache rather than owning it. Correctness never rests on the warm step; latency does, which is what earns it a place in the deploy runbook.

Two things still need explicit answers.

**Serve-stale is available on one of the key's two version segments, not both.** A `parser_version` bump orphans every entry without changing the bundle's shape, so the previous entry is merely stale and safe to serve while the new one computes. A `BUNDLE_SCHEMA_VERSION` bump does change the shape, and `cache.ts` is explicit that the bundle types declare every field required so consumers dereference them directly — a frontend on the new shape reading a pre-bump bundle breaks on it. So: serve-stale on parser drift, recompute on schema drift. Treating the two segments alike is what makes the option look unavailable.

Serving the previous entry means finding it, and the key embeds the very version that is missing. The lookup is a prefix walk on `stats:v{schema}-p` filtered to the `global:` suffix — the shape `invalidateStatsCache` already uses. The recompute runs behind `ctx.waitUntil` so the stale response never waits on it.

Neither bump is rare enough to wave off — five bundle-schema versions landed between 2026-05-24 and 2026-07-26, and the parser moved several times over the same window.

**The herd is the real cost of a cold key.** Every concurrent request recomputes at 108 queries apiece, bounded only by §11's rate limit — which ties the abuse ceiling to the cold-start ceiling, two knobs that should move independently.

Two mechanisms already in the repo cover it without a lock. A cold key follows a version bump, and a version bump is a deploy, so **the deploy warms the four unfaceted slices** — four requests — and the cron fills the 52 nation bundles on its next pass. Those four are the entry points: a visitor lands on a slice, not on a nation. And the payload is byte-identical for every viewer, which is what the edge cache is for: `caches.default` in `blob-cache.ts`, `s-maxage` on the public reads in `channels.ts`, `featured.ts` and `tournament/public.ts`. That takes the steady state to roughly one recompute per colo.

The Cache API does not single-flight, so a simultaneous burst within one colo can still double up. A KV or Durable Object lock is the answer only if the two mechanisms above measurably don't hold — it would be a third thing doing their job.

**Built: the warm is an hourly cron, not a deploy step.** The deploy has no credential to warm with. `scripts/admin/wrangler.ts` shells out to `wrangler`, so the toolchain authenticates to *Cloudflare*, not to the app — and `GET /v1/stats` requires a session (§11's Built note). `SSR_TRUSTED_KEY` is not the missing credential either: `cloud/src/read-budget.ts` states that the address is the only thing that key buys. A warm endpoint behind a shared secret would mint one, but that is a new public surface and a new secret bought for a latency win. And the same session gate shrank the herd this section feared — it was anonymous internet traffic, and the surface is signed-in only now, so what a cold key costs is one visitor's ~1s of JS.

So: a cron pattern of its own — `STATS_WARM_CRON` (`cloud/src/stats/precompute.ts`), hourly, rebuilding **only the four unfaceted bundles and only the ones actually missing**. Four KV reads an hour in the steady state; four builds, once, after a version bump. Conditional rather than unconditional is the point — an unconditional hourly rebuild is ~4,800 D1 queries a day spent overwriting entries that were already correct. Both segments of the key are Worker-compiled (`BUNDLE_SCHEMA_VERSION`, `CURRENT_PARSER_VERSION`), so every event that orphans a key at once is a Worker deploy, and the worst case the cron leaves open is one interval of cold keys. Hourly and not tighter, because an interval under an hour drops the cron to the 30-second CPU tier (§6). The 52 nation bundles stay with the nightly patterns and compute-on-miss: all 56 in one invocation is ~856 queries against the 1,000 ceiling, which is what §4.1 splits the nightly to avoid, while the four unfaceted are ~200 and fit.

It does not fit `STATS_PRECOMPUTE_CRONS`, which maps one pattern to one slice and which the dispatch reads by exact lookup. A warm invocation covers all four slices, so it has no slice to be the value of — a sentinel would widen that table's value type to something that isn't a `GlobalSlice`, and a second `Record` would be a table shape holding a single fact. It is a standalone constant instead, the shape `RETENTION_CRON` already uses for a single pattern driving a job that isn't per-slice. The dispatch stays a chain of exact matches with no fallback, which is the property staging depends on.

Cache keys stay in `cacheKeyToString` (`cache.ts:99`) with a `global` variant carrying the slice and the nation set. The set is **normalized** — sorted and deduped before stringifying. That is trivial while the UI is single-select, and it is what makes §5's widening a UI change rather than a key migration.

## 13. Testing

**Staging must exercise the cron.** `[env.staging.triggers] crons = []` is currently empty for a stated reason: staging D1 is recloned from prod, and an independent retention sweep there would skew prod/staging diffs. So do not just populate the array — give the stats precompute its **own cron patterns**, one per slice (§4.1), and have staging declare only those. Triggers are per-environment and the handler dispatches on `controller.cron`, so staging runs the stats path and never the retention sweep.

**Close the aggregator-test gap.** `docs/aggregate-statistics.md` lists "No aggregator tests" as a known limitation and names the fix: a fixture → `ChartBundle` round-trip. That gap is load-bearing here — the disjoint-cohort change (§7.1) and any turn-windowing (§7.2) must be provably output-identical for existing corpora, and without a round-trip test there is nothing to diff old against new. Build it first, not last; §13.1 is its shape.

**Re-measure cost as the corpus grows.** §6.1 is a baseline, not a fixed property; §15 and the same harness re-derive it. The figure to watch is focal rows per slice, since that is what §7.2's trigger is denominated in.

### 13.1 The round-trip test

A seeded corpus driven through the real upload path, `buildChartBundle` called directly, and the whole bundle pinned as a **snapshot**. It lands under `cloud/test/integration/`. Direct rather than through `GET /v1/users/:user_id/stats` because the test covers **both focal modes**, and no user endpoint produces `focal: "humans"` — the mode the global surface runs in and the one §7.1 is denominated in.

A snapshot rather than a digest of the payload, because the test has two jobs and only one of them is answered by "identical or not": §7.1 and §7.2 must be byte-identical, while §8.2 deliberately changes chart output and needs its diff readable. Nothing in the repo snapshots today, which is the reason to keep the snapshot narrow and the fixture legible rather than large.

**Seven fields the fixture cannot reach as it stands.** `buildUploadFormData` (`cloud/test/helpers/save-blob.ts`) sends `yield_history`, `player_history`, `law_adoption_history`, `completed_techs`, `characters` and `character_traits` empty, so `yieldCurves`, `lawTiming`, `openingLaws`, `techFirst`, `techTiming`, `startingArchetypeWinRate` and `startingTraitWinRate` come back empty from every corpus it builds. `yieldCurves` is the one that decides the matter: it is the field §7.1 and §7.2 exist to change. `nationAvgPoints` reads the last `player_history` point and `expansionWinRate` needs five founded cities, so both ride on the same additions. Every new input is opt-in and defaulted off, so the files already on this builder keep producing byte-identical blobs.

**Three things make a bundle comparable across runs.** Object arrays are built from `Map` insertion order over D1 rows with no `ORDER BY`, so the test canonicalizes by deep-sorting arrays **of objects** only — arrays of primitives are index-aligned against `yieldCurves.turns` or already sorted by the aggregator, and reordering those would be the defect rather than the fix. `save_dates` carries a per-run `game_id` and `display_name`, redacted to fixture-stable placeholders. `parser_version` is a `buildChartBundle` parameter, so the test pins it instead of tracking `CURRENT_PARSER_VERSION`.

**Structural assertions sit beside the snapshot, not inside it.** Every cohort's band arrays are index-aligned to `turns`, and the pooled counts equal winners plus losers exactly when every game in the corpus is decided, exceeding them by the undecided rows otherwise. That states §7.1's invariant rather than only byte-comparing it, so the fixture carries a decided game and an undecided one to exercise both readings.

## 14. Deferred, with growth triggers

Not in scope; each records the condition that would change that.

- **Predicate corpus** (resolvers return a `SELECT game_id` predicate that loaders inline as a subquery, making query count independent of corpus size, instead of materializing an id list). Trigger: a slice approaching ~6,000 games, where `ceil(N/50) × 8` nears the 1,000-query ceiling. (**Built:** ~5,500 as planned, at nine loops; §8.1's drop took the global path to eight and the trigger out with it.) It would also make the *user* path marginally slower, so it is worth doing only for the global case.
- **Turn-window chunking** (§7.2). Trigger: ~250,000 focal rows in one slice — about 1,600 public games.
- **A map-size facet.** 395 of 538 public duels are `MAPSIZE_SMALLEST`, and crossing map size with nations gives 68 non-empty cells of which 47 hold fewer than 10 players. Trigger: enough corpus that a representative nation × map-size cell holds a usable sample. No bundle field is keyed by map size, so this facet is the only route by which map size reaches this surface.
- **Multi-select nations.** The eight nation-keyed fields already serve comparison (§4), so multi-select buys combination space for a job the unfaceted bundle does. It also takes the selection space from 52 to 4 × 2¹³, past what §4.1 precomputes, trading the nightly table for the on-demand path §5 keeps alive. Trigger: a question the nation-keyed fields demonstrably cannot answer.
- **A reparse sweep for the wonder-pool coverage gap.** §8.3's rule makes the heterogeneous corpus safe to publish, and coverage is 100% of uploads since 2026-08, so the gap narrows on its own as the corpus grows. A sweep would take pool coverage from 41% to ~100% at once, but `BulkReparseModal` reparses one game at a time in the browser against `saves/{game_id}.zip`, and whether every 2.5.0-era upload still has a save needs auditing against R2 first — R2 should hold them, since the retention sweep touches only `events` and a save is deleted with its game. Trigger: the nation facet thinning the pooled subset until a wonder row's denominator stops carrying a reading — the number to watch is pooled games per nation, from §15's coverage query.
- **A single-flight lock for cold-key recomputes** (§12). Trigger: deploy-time warming plus the edge cache measurably failing to hold — duplicate recomputes showing up against the rate-limit budget or in CPU. **Built:** the warming half of that pair is an hourly cron rather than a deploy step (§12), and it covers the same four unfaceted slices this trigger assumed it would; the trigger otherwise reads unchanged. The one thing the cron does not carry over is immediacy — a bump leaves the four cold for up to an interval, which is the window a burst would have to land in.
- **Tournament chart tabs collapsing onto the shared registry** (§9).
- **Issue #228** — migrating the user-page `?scope` selector onto this facet vocabulary. Deliberately out of scope: it changes three live surfaces and a URL contract, and issue #156 wants to move the same call sites. But the facet model here **must be designed to subsume `UserScope`**, and must be validated against the user page's concepts (collections, the `public` subset, `viewerOwnsTarget` visibility) even though only the global consumer ships now.

## 15. Corpus sizing query

Every snapshot-derived figure in this doc is from 2026-08-25 and is re-derived by the two queries below. The first refreshes §3's slice counts and §7.2's trigger; the second refreshes §4.1's per-nation query arithmetic, §4's map-size cell counts, and §8.3's coverage table.

```sql
SELECT
  (SELECT COUNT(*) FROM games) AS games_all,
  (SELECT COUNT(*) FROM games WHERE is_public=1) AS games_public,
  (SELECT COUNT(*) FROM game_player_turn) AS gpt_rows_all,
  (SELECT COUNT(*) FROM game_player_turn gpt
     JOIN player_summaries ps ON ps.game_id=gpt.game_id AND ps.player_index=gpt.player_index
   WHERE ps.is_human=1) AS gpt_rows_human,
  (SELECT COUNT(*) FROM game_player_turn gpt
     JOIN player_summaries ps ON ps.game_id=gpt.game_id AND ps.player_index=gpt.player_index
     JOIN games g ON g.game_id=gpt.game_id
   WHERE ps.is_human=1 AND g.is_public=1) AS gpt_rows_human_public,
  (SELECT MAX(turn) FROM game_player_turn) AS max_turn,
  (SELECT COUNT(*) FROM games g WHERE g.is_public=1 AND g.game_id IN
     (SELECT game_id FROM player_summaries GROUP BY game_id HAVING COUNT(*)=2 AND SUM(is_human)=2)) AS public_duels,
  (SELECT COUNT(*) FROM games g WHERE g.is_public=1 AND g.game_id IN
     (SELECT game_id FROM player_summaries GROUP BY game_id HAVING SUM(is_human)>=3)) AS public_ffa,
  (SELECT COUNT(*) FROM games g WHERE g.is_public=1 AND g.game_id IN
     (SELECT game_id FROM player_summaries GROUP BY game_id HAVING SUM(is_human)=1)) AS public_sp,
  (SELECT COUNT(DISTINCT map_size) FROM games WHERE is_public=1) AS distinct_map_sizes;
```

Facet sizing and per-field coverage:

```sql
-- Games per nation, per slice. `ceil(games/50) * 9` is that bundle's query cost (§4.1).
WITH duels AS (
  SELECT game_id FROM player_summaries GROUP BY game_id HAVING COUNT(*)=2 AND SUM(is_human)=2)
SELECT ps.nation,
       COUNT(DISTINCT CASE WHEN d.game_id IS NOT NULL THEN ps.game_id END) AS duel_games,
       COUNT(DISTINCT ps.game_id) AS all_public_games
FROM player_summaries ps
JOIN games g ON g.game_id=ps.game_id
LEFT JOIN duels d ON d.game_id=ps.game_id
WHERE g.is_public=1 AND ps.is_human=1
GROUP BY ps.nation ORDER BY duel_games DESC;

-- Per-field coverage by parser version (§8.3). A zero column below a version is a
-- field the blob never carried, which only a reparse can fill (§14).
SELECT g.parser_version AS pv, COUNT(*) AS public_games,
  SUM(CASE WHEN EXISTS(SELECT 1 FROM game_wonder_pool w WHERE w.game_id=g.game_id) THEN 1 ELSE 0 END) AS wonder_pool,
  SUM(CASE WHEN EXISTS(SELECT 1 FROM player_summaries p WHERE p.game_id=g.game_id AND p.starting_ruler_archetype IS NOT NULL) THEN 1 ELSE 0 END) AS archetype,
  SUM(CASE WHEN EXISTS(SELECT 1 FROM player_family_cities f WHERE f.game_id=g.game_id) THEN 1 ELSE 0 END) AS family_cities
FROM games g WHERE g.is_public=1 GROUP BY g.parser_version;
```

## 16. Implementation order

One branch, one session. Ordered so each step is verifiable before the next depends on it.

1. **Fixture → bundle round-trip test** (§13.1). Nothing else is safely verifiable without it.
2. **Disjoint cohorts** in `loadYieldCurves` (§7.1) — load-bearing for the all-public slice, not an optimization. Prove byte-identical output against step 1.
3. **Bound `openingLaws`** (§8.2) so the bundle stops scaling with game count. Changes chart output, so it diffs against step 1.
4. **Shared composition predicates** — the player-counting duel/FFA/single-player fragments (§3), in `games-scope.ts`, used by the global resolver.
5. **`resolveGlobalCorpus`** — slice + nation → corpus, narrowing both the game set and the focal set (§4.2), with the set-shaped signature §5 requires.
6. **Cron precompute** for all 56 selections + KV `global` key variant + the serve-stale rule (§12), one pattern per slice (§4.1) and staging declaring only those (§13).
7. **`GET /v1/stats`** — public, own rate-limit budget, compute-on-miss (§5, §11).
8. **Registry parameterized over `ChartBundleCore`** (§9).
9. **`/stats` route + facet UI** (§9).

§8.3's one-population rule is not a step. It governs steps 2, 3 and 5, and every field added after them.

Turn-window chunking (§7.2) is out of scope here; it slots after step 2 only if a slice crosses the row count in §7.2.

**Built:** all nine, in this order, on `feat/global-stats`. Step 1's round-trip test earned its place immediately — step 2 was provably byte-identical against it, step 3's chart-output change was readable as a diff, and it is what caught the §4.2 focal gap when the facet arrived. One step ran over its brief: step 9 also had to fix `lawTiming` / `techTiming` (§4.2), because the facet UI is the first thing that makes that defect visible.

## 17. Docs to update on ship

Checked 2026-08-29; re-checked and largely discharged 2026-08-30.

- **`docs/aggregate-statistics.md`** — **done (2026-08-30).** It now carries a "The global corpus" section as the as-built record, and four corrections. The "Future work" bullet's caching prediction is struck through and answered rather than deleted — being wrong about which cost would bind is the useful part of the record, and free assembly is still open and is the case that would have made it right. The "No aggregator tests" limitation is struck with §13.1's test named. Its flat "no client `Cache-Control` header" rule now states `/stats` as the exception the rule predicts (byte-identical payload → a shared-cache directive), and its key-shape block carries all three variants plus the nation normalization and the serve-stale rule. Two things §17 did not originally list also landed there: the `ChartBundleCore`/`ChartBundle` split, and the §4.2 focal fix — that one changed the **user** page's Law adoption and Tech timing charts, and a live-surface behaviour change had no record outside a doc slated for retirement.
- **`docs/api-reference.md`** — **done.** `GET /v1/stats` and the `global_stats_view` budget are both documented.
- **`docs/cloud-deploy-plan.md`** — **done.** The two checks that pointed at `/v1/stats` have been corrected. The step-7 probe was `curl -I`, which sends HEAD against a GET-only route and 404s regardless of health; it is now a status-code GET expecting the `401` the session gate returns (§11's Built note). The §521 synthetic check moved off `/v1/stats` entirely — a session-gated path can't be probed by a checker with no credential, and it would also have spent the `global_stats_view` budget from one address and triggered a whole-corpus aggregation on a cold key. It now names `/v1/featured-videos` and records the four properties that made it the choice. The warm step for the four unfaceted slices is built, but not here and not as a deploy step: a deploy would have to present an app session the wrangler toolchain has no way to mint, so it is an hourly cron instead (§12's Built note). Nothing in `scripts/prod/` warms anything, and nothing there needs to.
- **`docs/tournament-stats-design.md`** — **done (2026-08-30):** a dated note at the top naming the three points that are stated there as current fact and are no longer true — the registry being user-shaped (§5, and stage-3 item 10's "do not parameterize yet"), `save_dates`/`favorite_day_of_week` "staying in the core" (§6, stage-3 item 5), and its colour guidance pointing at `getChartColor` rather than `getSeriesColor`. The tabs have still not collapsed onto the registry (§9), so the rest of the doc stands.
- **This doc** — **kept, deliberately, for now.** The as-built outcome is folded into `docs/aggregate-statistics.md`, which is the retirement §3 asks for. What is not folded in is the reasoning: the rejected alternatives (§4.3, §7.2), the measured baselines (§6.1, §7), the corpus-sizing queries (§15), and the **Built:** notes marking where the build diverged from the plan. That material is why the code looks as it does, and it would swamp the as-built doc at this length. Retire it when the reasoning stops being load-bearing — when the deferred items in §14 are either built or dead — not on ship.
