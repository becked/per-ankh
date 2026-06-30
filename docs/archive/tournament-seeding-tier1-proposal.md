# Tournament Seeding: Replace Tier 1 ("Match Wins") with Losses Ascending

> **⚠️ Historical — archived 2026-06-30.** Implemented May 2026; preserved as the rationale for the seeding cascade. Superseded by `cloud/src/tournament/standings.ts` + `docs/tournament-rules.md`. Audit: [`doc-audit-2026-06-30`](../doc-audit-2026-06-30.md).

## Status

**Implemented** (May 2026). Drafted after investigating siontific's seed-12 result in 2025-redux.

The shipped cascade went beyond this proposal's Tier-1-only change. The full
6-tier cascade in `cloud/src/tournament/standings.ts` is now:

1. Losses asc (composite `(wins desc, losses asc)` for the full-standings view)
2. Head-to-head
3. Buchholz cut-1
4. **Opponents' Buchholz** — a deeper strength-of-schedule tier, added because
   cumulative is a structural no-op in the zero-loss bucket (where top-bracket
   seeding matters most) and Buchholz alone routinely left multi-way ties there.
5. Cumulative (Harkness)
6. **Initial swiss seed, then slot_id** — an explicit deterministic terminal key,
   so the bracket seed order is always fully determined automatically.
   `override_ranks` is now reserved for `INSUFFICIENT_QUALIFIERS` only, never ties.

The rest of this document is the original Tier-1 analysis, preserved as the
rationale for the change.

## Summary

The bracket-seeding cascade in `cloud/src/tournament/standings.ts` is:

1. Match wins (descending)
2. Head-to-head within tied group
3. Buchholz cut-1 within tied group
4. Cumulative (Harkness) within tied group

For our early-exit Swiss format (advance at `swiss_wins_to_advance` wins, eliminate at `swiss_losses_to_eliminate` losses), **Tier 1 contributes nothing to bracket seeding**: every qualifier has exactly `swiss_wins_to_advance` wins by definition. All qualifiers collapse into one Tier 1 group, and the entire seeding job falls on Tiers 2-4 — applied to a tied set whose members played different numbers of rounds.

Replace Tier 1 with **losses ascending**. This gives meaningful separation at Tier 1, and as a side effect, restricts each downstream tier to a sub-population that played the same number of rounds.

## Problem

### The 2025-redux observation

`siontific` went 3-0 in division B and seeded **12th** in the combined bracket. The cascade math is correct per the implementation, but produces a result where three 3-2 players (`moroten`, `nizar` and their cohort) seed above a 3-0.

Computed standings for the 16-player qualifier set (combined across divisions):

| Seed   | Player          | Div   | W-L     | H2H   | Buch  | Cum    |
| ------ | --------------- | ----- | ------- | ----- | ----- | ------ |
| 1      | ninjaa          | B     | 3-0     | 3     | 6     | 12     |
| 2      | auro            | A     | 3-1     | 2     | 9     | 11     |
| 2      | purplebullmoose | B     | 3-1     | 2     | 9     | 11     |
| 4      | klass           | A     | 3-0     | 2     | 6     | 12     |
| 4      | aran            | A     | 3-0     | 2     | 6     | 12     |
| 6      | nizar           | B     | 3-2     | 1     | 11    | 10     |
| 7      | moroten         | A     | 3-2     | 1     | 11    | 9      |
| 8      | fluffy          | A     | 3-1     | 1     | 8     | 11     |
| 9      | blaj            | A     | 3-1     | 1     | 8     | 10     |
| 9      | alcaras         | B     | 3-1     | 1     | 8     | 10     |
| 9      | sabertooth      | B     | 3-1     | 1     | 8     | 10     |
| **12** | **siontific**   | **B** | **3-0** | **1** | **5** | **12** |

### Why this happens

Two structural facts compound:

**(a) Tier 1 (`wins desc`) is degenerate.** All 16 qualifiers have `wins = 3`. They form one combined group; Tier 1 has no separation power for the bracket.

**(b) The remaining tiers don't normalize for rounds played.** Players exit Swiss at different rounds (3-0s after round 3, 3-1s after round 4, 3-2s after round 5). When all are pooled at Tier 1:

- **H2H** is computed against the full 16-player tied set, but a 3-0 had only 3 opponents (so max possible H2H = 3) while a 3-2 had 5 opponents (max H2H = 5). The opportunity to score H2H is asymmetric.
- **Buchholz cut-1** sums opponent wins across the player's actual opponent list. A 3-0 has 3 opponents to draw from; a 3-2 has 5. Cut-1 trims one, leaving 2 vs 4 contributing opponents. siontific's Buch=5 (sorted [1,2,3], drop 1, sum 2+3) reflects his small opponent pool plus the bad luck of one opponent finishing 1-3.
- **Cumulative** captures running-wins-per-round across `swiss_max_rounds`. A 3-0 player's running W is frozen at 3 after round 3; a 3-2 player's running W climbs across all 5 rounds with the same final, but a different trajectory.

The standings comment at `standings.ts:14-17` acknowledges the design: "A 3-0 player never gets cut by the cascade; they may just receive a different bracket seed than a 3-2 player with stronger Buchholz." The implication is stronger than it sounds — because of (a), the cascade routinely pushes 3-0s below 3-2s.

### Why this isn't a "match points" problem

Standard Swiss "match points" (W=1, L=0, D=0.5) only differentiates when players play different numbers of games _with different outcomes_. With no draws, match points = match wins, and in this format every qualifier has the same number of wins — so plain match points doesn't help either.

The thing that _does_ separate 3-0 from 3-2 is the difference in **losses** (equivalently `wins - losses`, equivalently `win percentage`, equivalently `round-at-which-clinched`). All four orderings are identical for this format.

## Proposal

### Tier 1: replace `wins desc` with `losses asc`

```typescript
// Before — standings.ts:198
let groups: SlotStanding[][] = groupByKey(standings, (s) => -s.wins);

// After
let groups: SlotStanding[][] = groupByKey(standings, (s) => s.losses);
```

For the bracket-seeding cascade (qualifier-only), `losses asc` alone is sufficient. For the full standings view (which includes non-qualifiers), the composite key `(wins desc, losses asc)` is needed so a 2-3 still ranks above a 1-3 above a 0-3. For qualifiers `wins desc` is a no-op, so the composite key handles both cases.

### Buckets for current format (5 rounds, advance at 3 wins, eliminate at 3 losses)

| Bucket | Players (2025-redux) | Games played per player |
| ------ | -------------------- | ----------------------- |
| 3-0    | 4                    | 3                       |
| 3-1    | 6                    | 4                       |
| 3-2    | 6                    | 5                       |

For a 60-player tournament (likely 7 rounds, advance at 4 wins), buckets would be 4-0, 4-1, 4-2, 4-3.

### Resulting seed order for 2025-redux (qualifier-only)

| Seed | Player          | Div | W-L | H2H | Buch | Cum |
| ---- | --------------- | --- | --- | --- | ---- | --- |
| 1    | klass           | A   | 3-0 | 0   | 6    | 12  |
| 1    | aran            | A   | 3-0 | 0   | 6    | 12  |
| 1    | ninjaa          | B   | 3-0 | 0   | 6    | 12  |
| 4    | siontific       | B   | 3-0 | 0   | 5    | 12  |
| 5    | purplebullmoose | B   | 3-1 | 1   | 9    | 11  |
| 6    | auro            | A   | 3-1 | 0   | 9    | 11  |
| 7    | fluffy          | A   | 3-1 | 0   | 8    | 11  |
| 8    | blaj            | A   | 3-1 | 0   | 8    | 10  |
| 8    | alcaras         | B   | 3-1 | 0   | 8    | 10  |
| 8    | sabertooth      | B   | 3-1 | 0   | 8    | 10  |
| 11   | moroten         | A   | 3-2 | 1   | 11   | 9   |
| 12   | nizar           | B   | 3-2 | 0   | 11   | 10  |
| 13   | cliff           | B   | 3-2 | 0   | 10   | 8   |
| 14   | rincewind       | B   | 3-2 | 0   | 9    | 8   |
| 15   | marauder        | A   | 3-2 | 0   | 9    | 7   |
| 15   | mongreleyes     | A   | 3-2 | 0   | 9    | 7   |

siontific moves from seed 12 → 4.

## Why losses-asc is the right key

It's not just an "also works" choice. In an early-exit Swiss, the only signal the format produces about qualifier quality at Tier 1 is _how long they took to clinch_. Losses encodes that directly:

- `losses = 0` → clinched at round `swiss_wins_to_advance`
- `losses = 1` → clinched at round `swiss_wins_to_advance + 1`
- … etc.

Sorting by losses ascending is identical to sorting by "rounds taken to clinch, ascending."

Beyond Tier 1, the change has a clean structural property: **within each losses bucket, every player played the same number of rounds.**

- All 3-0s played 3 rounds.
- All 3-1s played 4 rounds.
- All 3-2s played 5 rounds.

This means H2H, Buchholz cut-1, and cumulative — all of which were designed assuming uniform rounds-played — now operate on populations where that assumption actually holds. The opportunity-to-score-H2H skew, the Buchholz-sample-size skew, and the cumulative-trajectory skew all vanish _within_ a bucket. Cross-bucket comparison was always degenerate; under the proposal, Tier 1 has already separated cross-bucket players so the cascade never has to compare them.

This is unusual in tiebreaker design — usually you're adding a knob. Here you're getting cleaner per-bucket math as a side effect of fixing Tier 1.

## How it propagates through the cascade

### Tier 2 (H2H) within each bucket

H2H is "wins against currently-tied opponents." Because each bucket is restricted to a single records cohort and (in this format) those players largely didn't play each other, H2H is most useful in the 3-2 bucket where players had 5 rounds to bump into other qualifiers, less useful in the 3-1 bucket, and structurally near-zero in the 3-0 bucket (3-0 players didn't play each other — they all hit 3 wins after round 3 against non-3-0 opponents).

In 2025-redux's 3-0 bucket, all four players have H2H = 0. The tier passes through without breaking ties.

### Tier 3 (Buchholz cut-1) within each bucket

Buchholz cut-1 still applies. Because every player in the bucket has the same number of opponents (modulo byes), the cut-1 trim affects everyone symmetrically. In 2025-redux's 3-0 bucket: klass / aran / ninjaa each have Buch = 6 (opponents at wins=[2,3,3], drop 2, sum 3+3); siontific has Buch = 5 (opponents at wins=[1,2,3], drop 1, sum 2+3). Buchholz alone seeds siontific 4th and ties the other three at 1st.

### Tier 4 (Cumulative) within each bucket

The cumulative _calculation_ doesn't change, but its discriminating power varies by bucket:

- **3-0 bucket: Tier 4 becomes a no-op.** Only one sequence produces a 3-0 record (W,W,W), giving running wins 1,2,3,3,3 → cum = 12 for every 3-0 player.
- **3-1 bucket: Tier 4 retains power.** Three sequences are possible (L,W,W,W / W,L,W,W / W,W,L,W), giving distinct cumulatives 9 / 10 / 11.
- **3-2 bucket: Tier 4 retains power.** Even more variation across 5 rounds.

Today the wins=3 group at Tier 1 includes 3-2 players whose cumulatives vary across all 5 rounds, so cumulative can still break ties at the bottom of the cascade. Under the proposal, ties in the 3-0 bucket reach end-of-cascade more often.

### End-of-cascade ties

Today, end-of-cascade ties at the top of the bracket already happen — in 2025-redux, klass and aran are currently tied at rank 4 with identical Buch and Cum. The admin tiebreaker endpoint (`admin.ts:1532+`) and `override_ranks` mechanism already exist for this. The proposal increases the frequency of end-of-cascade ties in the top bucket but doesn't introduce a new failure mode.

## How

### Single-line change in standings.ts

```typescript
// standings.ts:198 — for the bracket-seeding cascade
let groups: SlotStanding[][] = groupByKey(standings, (s) => s.losses);
```

For the full standings view, use a composite key (either by deriving a single sort value `s.losses - 1000 * s.wins`, or by replacing `groupByKey` with a two-key group). The bracket-seeding cascade can use `losses` alone since `wins` is constant at the advance threshold.

### Byes

The known under-counting documented at `standings.ts:19-25` persists. A 3-0 with a bye still has 2 Buchholz opponents (the bye doesn't enter the opponent list) and gets cut-1 trimmed against that 2-opponent pool — Buch caps at the higher single opponent's win count, vs a clean 3-0 with 3 opponents and a Buch summing the top two. Wins/losses are unaffected (bye = +1 win), so the bye'd 3-0 stays in the 3-0 bucket. The proposal doesn't fix this; the comment at `standings.ts:19-25` continues to apply.

### Tests

`standings.test.ts` has cases for the current cascade. Update or add cases that assert:

- 3-0 ranks above 3-1 ranks above 3-2 at Tier 1.
- Within each bucket, the existing tiebreakers behave as documented.
- Non-qualifier standings (the full standings view) still order 2-3 > 1-3 > 0-3.
- `override_ranks` resolution path (already covered) handles end-of-cascade ties in the 3-0 bucket.

### Documentation

- Update the cascade comment block at `standings.ts:8-17` to reflect the new Tier 1 and the within-bucket invariant.
- Update the tournament feature spec (`docs/tournament-feature-spec.md`) where the cascade is described to players.

## What this proposal explicitly does not solve

- **Cross-format intuition.** Players familiar with standard (play-all-rounds) Swiss may still find the buckets surprising; this is inherent to early-exit Swiss, not to the cascade.
- **Bye under-counting in Buchholz.** Pre-existing, documented, intentionally untreated.
- **Single-game noise within small buckets.** A 4-player 3-0 bucket only has a few Buchholz values to work with, so seed order can swing on individual opponent records.
- **H2H weakness in the 3-0 bucket.** Since 3-0 players generally don't play each other, H2H rarely breaks ties at the top — the cascade leans heavily on Buchholz there.

These were known limitations under the current cascade as well; the proposal moves the cascade onto a saner foundation but doesn't address them.
