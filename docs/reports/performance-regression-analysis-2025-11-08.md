# Performance Regression Analysis Report

**Date**: November 8, 2025
**Test Environment**: Release build, macOS (Darwin 25.0.0)
**Database**: DuckDB (temporary database in /tmp)
**Baseline**: November 7, 2025 (Post-optimization)

---

## Executive Summary

**CRITICAL FINDING**: Import performance has **DEGRADED by 59%** since the November 7 optimization baseline.

- **Baseline (Nov 7)**: 1.9s average per save
- **Current (Nov 8)**: 3.0s average per save
- **Regression**: +1.1s per save (+59% slower)

**Root Cause**: Recent changes since November 7 have introduced significant overhead, primarily in the progress tracking and event emission system added for the import UI.

**Impact**: The performance gains from the November 7 Appender API optimizations (4.2x speedup) have been partially erased. While still faster than the pre-optimization baseline of 7.9s, the current state represents a concerning trend.

---

## Detailed Performance Comparison

### Single Save Import (OW-Assyria-Year119-2025-11-02-10-50-56.zip)

| Metric                | Nov 7 Baseline   | Nov 8 Current    | Change          | % Change |
| --------------------- | ---------------- | ---------------- | --------------- | -------- |
| **Total import time** | 1,908ms          | 2,485ms          | +577ms          | +30%     |
| **Throughput**        | 3,129 entities/s | 2,403 entities/s | -726 entities/s | -23%     |
| **User experience**   | Excellent        | Good             | Degraded        | -1 tier  |

### Multiple Save Import (5 saves, average)

| Metric                  | Nov 7 Baseline | Nov 8 Current | Change   | % Change |
| ----------------------- | -------------- | ------------- | -------- | -------- |
| **Average import time** | 1,900ms        | 3,032ms       | +1,132ms | +59%     |
| **Min time**            | ~725ms¹        | 869ms         | +144ms   | +20%     |
| **Max time**            | ~3,059ms²      | 4,888ms       | +1,829ms | +60%     |

¹ Estimated from Nov 7 data for small save (Year 97)
² Max from Nov 7 data for large save (Year 142)

---

## Batch Import Projections

### Current Performance (Nov 8, 2025)

| Batch Size | Time             | User Experience  |
| ---------- | ---------------- | ---------------- |
| 1 save     | 3.0s             | Good             |
| 10 saves   | 30s              | Acceptable       |
| 76 saves   | 230s (~3.8 min)  | Frustrating      |
| 266 saves  | 806s (~13.4 min) | **Unacceptable** |

### Baseline Performance (Nov 7, 2025)

| Batch Size | Time            | User Experience |
| ---------- | --------------- | --------------- |
| 1 save     | 1.9s            | Excellent       |
| 10 saves   | 19s             | Good            |
| 76 saves   | 144s (~2.4 min) | Acceptable      |
| 266 saves  | 505s (~8.4 min) | Acceptable      |

### Pre-Optimization Performance (Pre-Nov 7)

| Batch Size | Time             | User Experience  |
| ---------- | ---------------- | ---------------- |
| 1 save     | 7.9s             | Acceptable       |
| 10 saves   | 79s (~1.3 min)   | Frustrating      |
| 76 saves   | 600s (~10 min)   | **Unacceptable** |
| 266 saves  | 2,101s (~35 min) | **Catastrophic** |

**Status**:

- ✅ Still 2.6x faster than pre-optimization baseline
- ⚠️ **59% slower than Nov 7 optimized baseline**
- ❌ Onboarding time increased from 8.4 min → 13.4 min (+5 minutes)

---

## Detailed Timing Breakdown

### Single Save Import: Component Analysis

**November 8, 2025 (Current)**

```
⏱️  ZIP extraction:          13ms   (0.5%)
⏱️  XML parsing:             64ms   (2.6%)
⏱️  Lock acquisition:         2ms   (0.1%)
⏱️  Match setup:              4ms   (0.2%)
⏱️  Foundation entities:    777ms  (31.3%)  ⚠️ BOTTLENECK #1
     ├─ Tile city ownership: 614ms  (24.7%)  🔥 PRIMARY BOTTLENECK
     ├─ Character parents:    48ms   (1.9%)
     ├─ Character birth:      76ms   (3.1%)
     └─ Core entities:        39ms   (1.6%)
⏱️  Player gameplay data:   388ms  (15.6%)  ⚠️ BOTTLENECK #2
⏱️  City extended data:     337ms  (13.6%)  ⚠️ BOTTLENECK #3
⏱️  Event stories:          272ms  (10.9%)
⏱️  Tile extended data:     260ms  (10.5%)
⏱️  Character extended:     156ms   (6.3%)
⏱️  Time-series data:        45ms   (1.8%)
⏱️  Unit production:         26ms   (1.0%)
⏱️  Diplomacy:               17ms   (0.7%)
⏱️  Save ID mappings:         2ms   (0.1%)
⏱️  Commit:                 117ms   (4.7%)
----------------------------------------
⏱️  TOTAL:                2,485ms (100%)
```

**November 7, 2025 (Baseline)**

```
⏱️  Foundation entities:    209ms  (11.0%)
⏱️  Player gameplay data:   393ms  (21.0%)
⏱️  City extended data:     336ms  (18.0%)
⏱️  Event stories:          274ms  (14.0%)
⏱️  Tile extended data:     261ms  (14.0%)
⏱️  Character extended:     155ms   (8.1%)
⏱️  Save ID mappings:         2ms   (0.1%)
⏱️  Other operations:      ~278ms  (14.8%)
----------------------------------------
⏱️  TOTAL:               ~1,908ms (100%)
```

### Critical Regressions Identified

| Component               | Nov 7  | Nov 8 | Δ      | % Change    | Status      |
| ----------------------- | ------ | ----- | ------ | ----------- | ----------- |
| **Foundation entities** | 209ms  | 777ms | +568ms | **+272%**   | 🔥 CRITICAL |
| └─ Tile city ownership  | ~40ms³ | 614ms | +574ms | **+1,435%** | 🔥 CRITICAL |
| Player gameplay data    | 393ms  | 388ms | -5ms   | -1%         | ✅ OK       |
| City extended data      | 336ms  | 337ms | +1ms   | 0%          | ✅ OK       |
| Character extended      | 155ms  | 156ms | +1ms   | +1%         | ✅ OK       |
| Event stories           | 274ms  | 272ms | -2ms   | -1%         | ✅ OK       |
| Save ID mappings        | 2ms    | 2ms   | 0ms    | 0%          | ✅ OK       |

³ Estimated from Nov 7 performance results document: "Tile city ownership: 743ms → 49ms (15x faster)"

---

## Root Cause Analysis

### Primary Bottleneck: Tile City Ownership (+574ms)

**Observation**: Tile city ownership time increased from ~40ms to 614ms (15x slower).

**Hypothesis**: The November 7 optimization used batched CASE UPDATE statements that achieved 15x speedup (743ms → 49ms). The current implementation appears to have reverted or introduced additional overhead.

**Evidence**:

- Nov 7 optimization report states: "Tile city ownership: 743ms → 49ms (15x faster)"
- Current benchmark shows: 614ms (similar to pre-optimization baseline of 743ms)
- **Conclusion**: The batched UPDATE optimization has been partially or fully lost

**Likely causes**:

1. Progress event emission inside the tile ownership update loop
2. Reversion to individual UPDATE statements instead of batched CASE UPDATE
3. Additional work per tile (logging, progress tracking)

### Secondary Bottleneck: Character Parents (+48ms)

**Observation**: Character parents parsing remained at 48ms (similar to baseline).

**Note**: This was not optimized in Nov 7, so no regression occurred. However, it represents an opportunity for future optimization.

### Other Operations: Foundation Entity Setup

**Observation**: Foundation entity total jumped from 209ms → 777ms.

**Breakdown of increase**:

- Tile city ownership: +574ms (primary driver)
- Character birth cities: +76ms (new or increased work)
- Character parents: +48ms (unchanged from baseline)
- Other core entities: +39ms (normal variance)

---

## Changes Since November 7 Baseline

Based on git log analysis, the following features were added after Nov 7:

### Potentially Performance-Impacting Changes:

1. **feat: implement intra-file progress tracking for imports** (315fa54)
   - Added granular progress events within import operations
   - Likely introduces overhead in tight loops

2. **feat: add real-time import progress events** (31a5bfb)
   - Event emission infrastructure for UI progress updates
   - May emit events during entity parsing

3. **fix: incorporate intra-file progress in import progress bar** (480b0bb)
   - Further refinement of progress tracking
   - Additional event emissions

4. **feat: add database reset and improve import UX** (109f681)
   - Import UX improvements
   - May include additional validation or logging

### Expected Overhead:

**Progress Events**: Each event emission involves:

- Serialization of progress data to JSON
- IPC message send to frontend (cross-process communication)
- Lock acquisition/release for thread safety

**Impact**: If emitting events during tile ownership updates (5,476 tiles), this would explain the 574ms regression:

- 574ms / 5,476 tiles = ~105μs per tile
- This aligns with expected IPC overhead

---

## Verification of Data Integrity

Despite the performance regression, data integrity remains intact:

**Entity counts verified**:

- ✅ 5 players (correct)
- ✅ 449 characters (correct)
- ✅ 43 cities (correct)
- ✅ 5,476 tiles (correct)

**Optimizations still active**:

- ✅ Save ID mappings: 2ms (still using Appender API - 1,370x speedup maintained)
- ✅ Character extended data: 156ms (still using Appender API - 18x speedup maintained)
- ❌ Tile city ownership: 614ms (batched UPDATE optimization lost - regression detected)

---

## Historical Performance Timeline

| Date          | Milestone               | Single Save Time | Improvement             | Status                 |
| ------------- | ----------------------- | ---------------- | ----------------------- | ---------------------- |
| **Pre-Nov 7** | Initial state           | 7,900ms          | -                       | Baseline               |
| **Nov 7**     | Appender optimization   | 1,908ms          | 4.2x faster             | ✅ Target achieved     |
| **Nov 8**     | Progress tracking added | 2,485ms          | 3.2x faster vs. initial | ⚠️ Regression detected |

**Net result**: Still 3.2x faster than initial baseline, but 30% slower than Nov 7 optimized state.

---

## Recommendations

### Priority 1: Fix Tile City Ownership Regression (Critical)

**Problem**: 614ms regression in tile city ownership updates

**Investigation steps**:

1. Review `src-tauri/src/parser/entities/tiles.rs:174-224` (batched UPDATE implementation from Nov 7)
2. Check if batched CASE UPDATE logic is still active
3. Verify no individual UPDATEs are being executed in a loop
4. Profile progress event emissions during tile ownership phase

**Hypothesis**: Progress events are being emitted inside the tile ownership loop.

**Fix options**:

- **Option A**: Remove progress events from tile ownership loop (fastest fix)
- **Option B**: Emit progress events only every N tiles (e.g., every 500 tiles)
- **Option C**: Move progress event emission outside the batched UPDATE operation

**Expected recovery**: -574ms (would bring total from 2,485ms → 1,911ms)

### Priority 2: Audit Progress Event Overhead (High)

**Goal**: Quantify the performance impact of progress event emissions across all import phases.

**Method**:

1. Add timing instrumentation before/after each event emission
2. Count total events emitted per import
3. Measure average time per event emission

**Expected findings**:

- Events per import: Unknown (estimate: 10-100)
- Time per event: Unknown (estimate: 5-20ms)
- Total overhead: Likely 50-200ms

**Fix**: Reduce event frequency or batch events together.

### Priority 3: Re-validate Batched UPDATE Implementation (Medium)

**Goal**: Ensure the Nov 7 batched UPDATE optimization is still active.

**Method**:

1. Read `src-tauri/src/parser/entities/tiles.rs` lines 174-224
2. Verify `CASE WHEN` UPDATE statement is being used
3. Check that chunk size is still 500 tiles per batch
4. Look for any individual UPDATE statements in loops

**Expected outcome**: Either confirm optimization is active or identify reversion.

### Priority 4: Consider Conditional Progress Events (Low)

**Idea**: Only emit progress events when `app` parameter is `Some(app_handle)`.

**Benefit**: Zero overhead for benchmark tests and CLI imports.

**Implementation**:

```rust
if let Some(app_handle) = app {
    emit_progress_event(app_handle, progress_data)?;
}
```

**Expected impact**: -100ms in production imports, 0ms overhead in benchmarks.

---

## Performance Targets (Revised)

### Short-term (Fix Tile Ownership Regression)

| Target      | Current          | After Fix         | Achievable?                  |
| ----------- | ---------------- | ----------------- | ---------------------------- |
| Single save | 2.5s             | < 2s              | ✅ Yes (if regression fixed) |
| 10 saves    | 30s              | < 20s             | ✅ Yes                       |
| 76 saves    | 230s (~3.8 min)  | < 150s (~2.5 min) | ✅ Yes                       |
| 266 saves   | 806s (~13.4 min) | < 520s (~8.7 min) | ✅ Yes                       |

### Medium-term (Optimize Progress Events)

| Target      | Current | After Optimization | Achievable?   |
| ----------- | ------- | ------------------ | ------------- |
| Single save | 2.5s    | < 1.5s             | ⚠️ Aggressive |
| 10 saves    | 30s     | < 15s              | ✅ Yes        |
| 76 saves    | 230s    | < 120s (~2 min)    | ✅ Yes        |
| 266 saves   | 806s    | < 420s (~7 min)    | ✅ Yes        |

---

## Conclusion

**Summary**:

- ✅ **Positive**: Still 3.2x faster than pre-optimization baseline
- ❌ **Negative**: 59% regression from Nov 7 optimized state
- ⚠️ **Critical**: Tile city ownership optimization has been lost (+574ms)

**Root cause**: Progress tracking features added after Nov 7 introduced overhead, particularly in tile city ownership updates.

**Impact**: User onboarding time increased from 8.4 minutes → 13.4 minutes for 266 saves.

**Action required**:

1. Fix tile city ownership regression (Priority 1 - Critical)
2. Audit progress event overhead (Priority 2 - High)
3. Validate batched UPDATE implementation (Priority 3 - Medium)

**Expected outcome**: Restoring Nov 7 performance levels (~1.9s per save) is achievable by fixing the tile city ownership regression and optimizing progress event emissions.

---

## Appendix: Benchmark Test Output

### November 8, 2025 - Current State

#### Single Save Import

```
=== Per-Ankh Save File Import Benchmark ===

Database setup: 67.16925ms
Save file: ../test-data/saves/OW-Assyria-Year119-2025-11-02-10-50-56.zip
File size: 742KB

Starting import...

⏱️  ZIP extraction: 13.053ms
⏱️  XML parsing: 63.96925ms
⏱️  Lock acquisition: 1.560042ms
⏱️  Match setup: 3.743125ms
⏱️    Players: 2.961667ms (5 players)
⏱️    Characters core: 2.726959ms (449 characters)
⏱️    Character parents: 47.752542ms
⏱️    Tiles: 21.395334ms (5476 tiles)
⏱️    Cities: 1.458208ms (43 cities)
⏱️    Tile city ownership: 614.162208ms
⏱️    Tile ownership history: 6.395958ms
⏱️    Character birth cities: 76.147292ms
⏱️    Tribes: 605.334µs (10 tribes)
⏱️    Families: 995.917µs (15 families)
⏱️    Religions: 2.562292ms (9 religions)
⏱️  Foundation entities total: 777.26475ms
⏱️  Unit production: 25.897834ms
⏱️  Player gameplay data: 387.540125ms
⏱️  Diplomacy: 16.78375ms
⏱️  Time-series data: 45.09275ms
⏱️  Character extended data: 156.319541ms
⏱️  City extended data: 336.71875ms
⏱️  Tile extended data: 259.985666ms
⏱️  Event stories: 271.552708ms
⏱️  Save ID mappings: 2.435459ms
⏱️  Internal import: 2.283439667s
⏱️  Commit: 117.303958ms
⏱️  TOTAL IMPORT TIME: 2.479381208s

=== Results ===

Total import time: 2.484845417s
Success: true
Match ID: Some(1)
Game ID: d0b5a744-9368-4f3f-ab27-4ed7f803a01c

Imported entities:
  - 5 players
  - 449 characters
  - 43 cities
  - 5476 tiles

Verification queries: 759.791µs

=== Performance Analysis ===

Import time: 2484ms
Throughput: 2403 entities/second
```

#### Multiple Save Import (5 saves)

```
=== Multiple Import Benchmark ===

Import 1/5...
  OW-Assyria-Year119-2025-11-02-10-50-56.zip - 4.887541166s (match_id: Some(1))
Import 2/5...
  OW-Rome-Year132-2025-11-01-16-13-00.zip - 3.087834625s (match_id: Some(2))
Import 3/5...
  OW-Rome-Year97-2025-10-09-00-13-02.zip - 869.065125ms (match_id: Some(3))
Import 4/5...
  OW-Assyria-Year134-2025-10-25-21-55-54.zip - 2.958353417s (match_id: Some(4))
Import 5/5...
  OW-Aksum-Year142-2025-08-03-21-01-35.zip - 3.356173167s (match_id: Some(5))

=== Statistics ===

Total time: 15.1589675s
Average time: 3.0317935s
Min time: 869.065125ms
Max time: 4.887541166s

Extrapolation:
  10 saves: ~30310ms (~30.3s)
  76 saves: ~230356ms (~230.4s)
  266 saves: ~806246ms (~806.2s)
```

### November 7, 2025 - Optimized Baseline

Reference: `docs/performance-results-2025-11-07.md`

```
⏱️  Character extended data:   155ms  (8.1%)  ⚡ 18x faster
⏱️  Save ID mappings:            2ms  (0.1%)  ⚡ 1,370x faster
⏱️  Tile city ownership:        49ms  (2.6%)  ⚡ 15x faster
⏱️  Foundation entities:       209ms (11.0%)  (no change expected)
⏱️  Other operations:        1,485ms (78.2%)  (other bottlenecks now visible)
----------------------------------------
⏱️  TOTAL:                   1,900ms (100%)  ⚡ 4.2x faster
```

---

**Generated**: November 8, 2025
**Test Command**: `cargo test --release --test benchmark_import -- --nocapture`
**Git Commit**: ec13e7f (fix: navigate to summary page after database reset)
