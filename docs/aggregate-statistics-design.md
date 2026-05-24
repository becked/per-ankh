# Per-Ankh Aggregate Statistics — Design Notes

**Status:** Draft for team discussion. Not yet a spec.
**Scope:** First version of the aggregate statistics / charting feature on the
Cloudflare web rewrite.
**Companion docs:** `tournament-implementation-notes.md` (tournament feature as
built), `prospector-xml-data-sources-for-charts.md` (chart catalog inherited
from the old tournament visualizer).

This doc captures the design direction we've converged on so the team can
poke holes in it before implementation. It is deliberately opinionated on the
parts that are hard to change later (data model, caching, the corpus seam) and
deliberately loose on the parts that aren't (which charts ship first, visual
design).

---

## 1. The core idea: a query tool, not a stats tab

The old site fused two separate things: the _charts_ and the _thing the charts
run over_. Charts lived under an "Overview Page" and a "Matches Page," so the
data set being analyzed was implied by which page you were on.

We're separating them. The feature is an analysis surface with two independent
parts:

1. **A corpus** — the set of saves being analyzed.
2. **A chart catalog** — the visualizations that run against whatever corpus is
   selected.

A tournament is not special. It is just one named, pre-defined corpus: a set of
public saves with recorded outcomes. A user's library is another named corpus.
"Free assembly" (arbitrarily picking and mixing saves) is a third — and is
explicitly **out of scope for v1** (see §7).

Holding this separation in the architecture is the single most important
decision in this doc. Everything below follows from it.

---

## 2. v1 scope

Two corpus types, nothing else:

- **Tournament stats** — one tournament, under ~100 saves.
- **User stats** — one user's saves, expected under ~500 in the near/mid term.

No free assembly, no cross-tournament aggregation, no "all public saves" in v1.
Those are real and probably where this goes, but they make caching and
performance materially harder and we should not pay that cost yet. §7 covers
how to avoid walling ourselves off from them.

---

## 3. Charts and corpus validity

Both v1 corpora support the full range of charts, including win-rate charts:

- A **tournament** has paired matches with recorded outcomes by construction.
- A **user's saves** have win/loss resolved per save. Per-nation win rate
  ("do I win more with Persia or Rome?") is a coherent and desirable stat over
  a single user's corpus.

The only charts that need a _paired opponent_ are the matchup heatmaps (Nation
vs Nation, archetype vs archetype) and counter-pick effectiveness. These need
no special machinery — they get a normal empty state ("no head-to-head matches
in this corpus") like any other chart with no data.

**Action:** do not build a chart tiering/validity system in v1. Treat
insufficient-data as a per-chart empty state.

### One open question worth resolving in the data model now

A user's library may mix solo-vs-AI games with competitive games. Blending
those into a single Persia win rate is misleading. We don't need a corpus
_builder_ to handle this, but the flat stat row (see §4) **should carry a
game-type / opponent-type column from the first extraction**, so a cheap
game-type filter on the user corpus is possible without a later migration.
Decide the column now even if the filter UI ships later.

---

## 4. Data model: pre-extract at upload, don't compute on read

### The problem

The tournament feature computes standings on read (`standings.ts` derives
W/L and tiebreakers per request). That is fine for one tournament's worth of
D1 rows. It will **not** scale to aggregate charts:

- Save files are zipped XML; tile data alone is ~200k records per match.
- Per-turn history covers 14 yield types plus military/legitimacy/etc.
- A Worker cannot parse XML out of R2 and aggregate it within CPU budget on
  every chart load.

### The approach

Extract stats **once, at upload time**, as an output of the parse we already
run to derive the match winner. This is not a second pipeline — it is another
output of the existing one.

Two kinds of extracted data, stored differently:

**(a) Flat scalar stats → D1 columns.**
Things we filter and aggregate on: nation, family classes, ruler archetype,
win/loss, game-type/opponent-type, final yield totals, law-timing milestones
(turn reached 4 laws / 7 laws), final unit counts, map metadata. These need
`WHERE` / `GROUP BY` / `AVG`, so they must be queryable columns. One row per
player-per-match.

**(b) Per-turn time series → a JSON/TEXT column in D1, alongside the scalar row.**
Things we never filter _by_, only fetch _whole_ to draw a line: yield-rate-per-turn,
military power over time, legitimacy over time. These are small (low tens of KB
as JSON). The expensive part was the XML walk, not the size — and that walk now
happens once at upload.

> **Note on storage choice.** At <100 saves per tournament / <500 per user, a
> JSON column in D1 is the simpler choice for time series: it's written once
> with the rest of the row and read with the rest of the row — no second store
> to keep in sync. R2 for time series would only earn its place if "all public
> saves" comes back and per-row size starts hurting bulk reads. Revisit then.

**(c) The exception: map/tile data → R2 from day one.**
The ~200k-record tile dataset is genuinely large and only one chart category
touches it. Keep it as a separate R2 object keyed by game-id, loaded lazily
only when a map chart is opened. Do not put it in the D1 row.

### Schema versioning + reparse

Every extracted row carries a `stats_schema_version` (mirror the existing
`parser_version` pattern). When extraction logic changes, old rows are stale —
the answer is the **reparse-all admin UI that already exists**. Reparse-all
becomes "rebuild every stat row to the current schema version." This is the
entire maintenance story for pre-extraction: it is not fragile if we can always
rebuild. Make sure reparse-all writes the current `stats_schema_version`.

### Reuse from the tournament feature

Migration `0007` (`slot_a_player_index` / `slot_b_player_index`) records which
roster position in a save maps to which tournament slot. That is exactly the
join from a save's per-player XML data to a tournament participant. The
extraction layer should lean on it for the tournament corpus.

---

## 5. Caching

Caching is critical, and the v1 scoping makes it tractable.

Because a corpus is always either "tournament X" or "user Y" (never an
arbitrary set), the cache key is stable and obvious:

```
(corpus_type, corpus_id, chart_id, stats_schema_version)
```

- A tournament's charts are identical for every viewer → high hit rate.
- A user's charts are identical between their own visits → high hit rate.
- `stats_schema_version` in the key means a reparse-all naturally orphans stale
  cache entries instead of requiring an explicit purge.

**Invalidation** hangs off events we already fire:

- Tournament corpus → invalidate on match completion (same hook as standings
  invalidation, `maybeAdvanceAfterMatchReport`).
- User corpus → invalidate on that user's upload.

**Worker-side cache only. No client `Cache-Control` header.** This is the
lesson from the standings episode: a `max-age` header leaked client-side and
broke `invalidateAll`. Same mistake is available here; don't make it.

---

## 6. UX / chrome

Because the corpus is a variable, the user must always be able to see two
things at once: _what am I looking at_ and _which corpus is it_. The chrome's
job is to keep both unambiguous. Concretely, three zones:

- **Corpus context header (persistent, never scrolls away).** States the active
  corpus in plain language and a count — e.g. "Spring 2026 Tournament · 48
  saves" or "Your saves · 312 saves." In v1 this is a _context indicator with a
  switcher_, not a builder — there are only two corpus types to move between.
- **Chart category navigation.** The catalog is large (~60 charts in the old
  site). The old Overview/Matches tab taxonomy (Nations, Families, Rulers,
  Yields, Laws, Cities, Military, …) is a reasonable grouping — keep it as
  category nav _within_ the analysis surface, not as separate pages.
- **Chart canvas.** One category's charts at a time, responsive grid.

### Async states are first-class, not polish

Even with pre-extraction, aggregating a corpus takes a moment. The chrome must
handle this honestly:

- Skeleton charts shaped like the real chart — no layout jump on data arrival.
- Charts resolve and render independently as their data arrives; one slow chart
  does not block the grid.
- Real empty states that say _why_ ("no head-to-head matches in this corpus",
  "stats appear once matches complete"), not blank rectangles.
- Provisional marker while a tournament is mid-flight (`status != 'complete'`) —
  tiebreaker-style aggregates shift every round; a quiet "provisional through
  Round N" line stops people screenshotting mid-tournament numbers as final.

### Trim the inherited catalog deliberately

The old catalog has redundancy that's a feature-count flex, not user value.
Clearest example: the Military tab renders the _same_ `UnitsProduced` data
seven ways (stacked, grouped, waffle, treemap, icon grid, portrait, marimekko).
That is one chart with a representation toggle, not seven charts. Look for this
pattern across the catalog — pick the clearest default per dataset, make
alternates a toggle, don't ship them as separate scrolling entries.

---

## 7. Designing the seam for free assembly (without building it)

Free assembly is out of scope, but it's clearly where this goes. Cheap
insurance so we don't wall ourselves off:

**The chart-computing layer takes an opaque list of game-ids as its corpus
input — never a tournament-id or user-id directly.**

Then:

- "Tournament stats" is a thin resolver: `tournament_id → [game_id]`.
- "User stats" is another resolver: `user_id → [game_id]`.
- Free assembly later is just a third resolver: `assembled set → [game_id]`,
  feeding the _identical_ chart layer.

The chart layer never knows which kind of corpus it's drawing.

The one thing that does **not** generalize for free is the cache key: an
arbitrary list of game-ids hashes to something with a poor hit rate. That's
acceptable — named corpora keep the stable `(corpus_type, corpus_id, …)` key,
and if free assembly ships it either gets a weaker set-hash cache or no cache.
We don't solve that now. We only ensure the chart layer doesn't care, and the
game-id-list seam buys exactly that.

---

## 8. Summary of decisions

| Area                   | Decision                                                      |
| ---------------------- | ------------------------------------------------------------- |
| Mental model           | Query tool over a variable corpus, not a stats tab            |
| v1 corpora             | Tournament (<~100 saves) and single user (<~500 saves) only   |
| Free assembly          | Out of scope for v1; preserve the seam (§7)                   |
| Chart validity tiering | Not building it; insufficient data is a per-chart empty state |
| Extraction             | At upload time, as an output of the existing parse            |
| Flat scalar stats      | D1 columns (one row per player-per-match)                     |
| Time series            | JSON/TEXT column in D1 — **not** R2 in v1                     |
| Tile/map data          | Separate R2 object, lazy-loaded                               |
| Schema versioning      | `stats_schema_version` on each row; reparse-all rebuilds      |
| Cache key              | `(corpus_type, corpus_id, chart_id, stats_schema_version)`    |
| Cache invalidation     | Match completion (tournament) / upload (user); existing hooks |
| Client cache header    | None — Worker-side cache only                                 |
| Chart layer input      | Opaque list of game-ids                                       |

---

## 9. Open questions for the team

1. **Game-type column** — confirm the exact shape of the game-type /
   opponent-type field on the flat stat row (§3). It's cheap now, a migration
   later.
2. **Catalog cut list** — which of the ~60 inherited charts ship in v1? Suggest
   starting from the descriptive/whole-corpus charts (yields, unit composition,
   map distribution, nation/family popularity, per-nation win rate) and the
   collapse-redundant-charts pass (§6).
3. **Extraction cost at upload** — how much does the added stats extraction add
   to upload latency? If it's material, does it move to a queued/async step
   after the winner-derivation that the upload flow blocks on?
4. **Time-series column size** — sanity-check the JSON blob size against D1 row
   limits with a real late-game save before committing to the in-row approach.
5. **User corpus definition** — is "user stats" all of a user's saves, or only
   their public ones? Affects both the resolver and the privacy story.
6. **Where the feature lives in the route tree** — given the tournament
   feature's modal-driven, no-nested-routes pattern, decide whether stats is a
   dedicated route or a region on existing pages.
