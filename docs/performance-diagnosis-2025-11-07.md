# Performance Diagnosis: Import Bottleneck Analysis

**Date**: November 7, 2025
**Diagnostic Method**: Detailed timing instrumentation
**Test File**: OW-Assyria-Year119 (742KB, 5,973 entities)

---

## Executive Summary

Import performance bottleneck identified: **N+1 query problem across multiple parsing functions**.

**Total import time: 7.9 seconds**

**Top 3 Bottlenecks (77.7% of total time):**

1. Character extended data: **2.8s (35.4%)**
2. Save ID mappings: **2.6s (32.9%)**
3. Tile city ownership updates: **743ms (9.4%)**

**Root Cause**: Individual `INSERT` and `UPDATE` statements instead of batch operations.

**Estimated speedup if fixed**: 4-6x faster (from 7.9s to ~1.5-2s per save)

---

## Detailed Timing Breakdown

```
⏱️  ZIP extraction:                 10.5ms    (0.1%)
⏱️  XML parsing:                     58.4ms    (0.7%)
⏱️  Lock acquisition:                1.5ms     (0.02%)
⏱️  Match setup:                     3.8ms     (0.05%)

⏱️  Foundation entities:             903ms     (11.4%)
    ⏱️    Players:                   2.9ms     (5 players)
    ⏱️    Characters core:           2.7ms     (449 characters)
    ⏱️    Character parents:         49ms
    ⏱️    Tiles:                     18ms      (5,476 tiles)
    ⏱️    Cities:                    1.4ms     (43 cities)
    ⏱️    Tile city ownership:       743ms     ⚠️ BOTTLENECK #3
    ⏱️    Tile ownership history:    6ms
    ⏱️    Character birth cities:    76ms
    ⏱️    Tribes:                    0.6ms     (10 tribes)
    ⏱️    Families:                  1ms       (15 families)
    ⏱️    Religions:                 2.5ms     (9 religions)

⏱️  Unit production:                 26ms      (0.3%)
⏱️  Player gameplay data:            387ms     (4.9%)
⏱️  Diplomacy:                       17ms      (0.2%)
⏱️  Time-series data:                38ms      (0.5%)

⏱️  Character extended data:         2.8s      (35.4%) ⚠️ BOTTLENECK #1
⏱️  City extended data:              331ms     (4.2%)
⏱️  Tile extended data:              260ms     (3.3%)
⏱️  Event stories:                   275ms     (3.5%)

⏱️  Save ID mappings:                2.6s      (32.9%) ⚠️ BOTTLENECK #2

⏱️  Commit:                          195ms     (2.5%)
----------------------------------------
⏱️  TOTAL:                           7.9s      (100%)
```

---

## Bottleneck #1: Character Extended Data (2.8s, 35.4%)

### Location

`src-tauri/src/parser/entities/character_data.rs`

### Problem

**Individual INSERT for every character stat, trait, relationship, and marriage**.

### Code Pattern

```rust
// This loops through ALL 449 characters
for character_node in root.children().filter(|n| n.has_tag_name("Character")) {
    // For each character, parse stats
    for stat_node in rating_node.children().filter(|n| n.is_element()) {
        conn.execute(
            "INSERT INTO character_stats (...) VALUES (?, ?, ?, ?)",
            params![character_id, match_id, stat_name, stat_value],
        )?;  // ← ONE INSERT PER STAT!
    }
    // Similar loops for traits, relationships, marriages...
}
```

### Scale

- 449 characters
- ~20 stats per character = ~8,980 INSERT statements
- Similar counts for traits, relationships, marriages
- **Total: ~15,000-20,000 individual INSERT statements**

### Impact

Each INSERT requires:

1. Statement preparation (parse SQL)
2. Parameter binding
3. Transaction log write
4. Index updates
5. Round-trip overhead

At 140-180 microseconds per INSERT, this adds up to 2.8 seconds.

### Solution

Use DuckDB **Appender API** for batch inserts:

```rust
let mut stats_app = conn.appender("character_stats")?;
for character_node in ... {
    for stat_node in ... {
        stats_app.append_row(params![...])?;  // ← Buffered!
    }
}
stats_app.flush()?;  // ← One bulk operation
```

**Expected speedup**: 10-15x faster (2.8s → ~200-280ms)

---

## Bottleneck #2: Save ID Mappings (2.6s, 32.9%)

### Location

`src-tauri/src/parser/id_mapper.rs:152-183` (function `save_mappings_partial`)

### Problem

**Individual INSERT for every XML ID → DB ID mapping**.

### Code Pattern

```rust
let mut stmt = conn.prepare(
    "INSERT INTO id_mappings (...) VALUES (?, ?, ?, ?)
     ON CONFLICT (...) DO UPDATE SET ..."
)?;

for entity_type in ["player", "character", "city", "tile", ...] {
    let mappings = get_mappings(entity_type);
    for (&xml_id, &db_id) in mappings {
        stmt.execute(params![match_id, entity_type, xml_id, db_id])?;
        // ↑ ONE INSERT PER MAPPING!
    }
}
```

### Scale

- 5 players
- 449 characters
- 43 cities
- 5,476 tiles
- 10 tribes
- 15 families
- 9 religions
- **Total: ~6,007 individual INSERT statements**

### Impact

Similar to Bottleneck #1, each statement has overhead:

- At ~433 microseconds per INSERT
- 6,007 × 433μs = 2.6 seconds

### Solution

Use DuckDB **Appender API** or **batch INSERT**:

```rust
let mut app = conn.appender("id_mappings")?;
for entity_type in ... {
    for (&xml_id, &db_id) in mappings {
        app.append_row(params![match_id, entity_type, xml_id, db_id])?;
    }
}
app.flush()?;
```

**Expected speedup**: 10-15x faster (2.6s → ~200-250ms)

---

## Bottleneck #3: Tile City Ownership (743ms, 9.4%)

### Location

`src-tauri/src/parser/entities/tiles.rs:179-207` (function `update_tile_city_ownership`)

### Problem

**Individual UPDATE for every tile with city ownership**.

### Code Pattern

```rust
for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
    if let Some(city_xml_id) = tile_node.opt_child_text("CityTerritory") {
        conn.execute(
            "UPDATE tiles SET owner_city_id = ? WHERE tile_id = ? AND match_id = ?",
            params![city_db_id, tile_db_id, match_id],
        )?;  // ← ONE UPDATE PER TILE!
    }
}
```

### Scale

- 5,476 total tiles
- Likely 500-1,500 tiles with city ownership
- **~1,000 individual UPDATE statements**

### Impact

UPDATEs are more expensive than INSERTs:

- Must locate existing row
- Update in place
- Update indices
- At ~743 microseconds per UPDATE
- Result: 743ms total

### Solution

**Option 1: Include city ownership in initial tile INSERT** (best approach)

- Parse city ownership data BEFORE inserting tiles
- Include `owner_city_id` in initial INSERT
- Eliminates UPDATE pass entirely

**Option 2: Use batch UPDATE** (if Option 1 not feasible)

```sql
UPDATE tiles SET owner_city_id = CASE tile_id
    WHEN ? THEN ?
    WHEN ? THEN ?
    ...
END
WHERE tile_id IN (?, ?, ...) AND match_id = ?
```

**Expected speedup**: 10-20x faster (743ms → ~40-75ms) with Option 1

---

## Other Performance Notes

### What's Already Fast ✅

- **ZIP extraction**: 10.5ms - roxmltree is efficient
- **XML parsing**: 58.4ms - roxmltree is efficient
- **Foundation entity parsing**: Fast for initial INSERTs (uses Appenders in some places)

### Inconsistent Use of Appenders ⚠️

The codebase **already uses Appenders in some places**:

- `tile_ownership_history` uses Appender (line 222 in tiles.rs)
- But many other functions use individual INSERTs

This suggests developers are aware of the performance benefits of Appenders but haven't applied them consistently.

---

## Impact Analysis

### Current Performance

| Batch Size | Current Time  | User Experience |
| ---------- | ------------- | --------------- |
| 1 save     | 7.9s          | Acceptable      |
| 10 saves   | 79s (~1.3m)   | Frustrating     |
| 76 saves   | 600s (~10m)   | Unacceptable    |
| 266 saves  | 2,101s (~35m) | Catastrophic    |

### After Fixing Top 3 Bottlenecks

**Estimated reduction: 5.1s → 0.6s = 6.5s savings**

| Batch Size | Projected Time | User Experience | Improvement |
| ---------- | -------------- | --------------- | ----------- |
| 1 save     | ~1.3s          | ✅ Excellent    | 6x faster   |
| 10 saves   | ~13s           | ✅ Good         | 6x faster   |
| 76 saves   | ~99s (~1.6m)   | ✅ Acceptable   | 6x faster   |
| 266 saves  | ~346s (~5.8m)  | ✅ Tolerable    | 6x faster   |

### With Parallel Batch Import (Future)

After fixing bottlenecks + 4-core parallelization:

| Batch Size | Projected Time | User Experience |
| ---------- | -------------- | --------------- |
| 266 saves  | ~90s (~1.5m)   | ✅ Excellent    |

---

## Recommendations

### Priority 1: Fix ID Mapper (Easiest, Biggest Win)

**Estimated effort**: 1-2 hours
**Expected speedup**: 2.6s → 0.2s (13x faster)
**Impact**: Reduces total import time by 33%

Replace individual INSERTs in `save_mappings_partial` with Appender.

**Pseudo-code:**

```rust
pub fn save_mappings_partial(&self, conn: &Connection, entity_types: &[&str]) -> Result<()> {
    let mut app = conn.appender("id_mappings")?;
    for entity_type in entity_types {
        let mappings = self.get_mappings(entity_type);
        for (&xml_id, &db_id) in mappings {
            app.append_row(params![self.match_id, entity_type, xml_id, db_id])?;
        }
    }
    app.flush()?;
    Ok(())
}
```

### Priority 2: Fix Character Extended Data (Medium Effort, Biggest Impact)

**Estimated effort**: 4-6 hours
**Expected speedup**: 2.8s → 0.25s (11x faster)
**Impact**: Reduces total import time by 35%

Replace individual INSERTs in:

- `parse_character_stats`
- `parse_character_traits`
- `parse_character_relationships`
- `parse_character_marriages`

Use Appenders for each table.

### Priority 3: Fix Tile City Ownership (Medium Effort)

**Estimated effort**: 2-3 hours
**Expected speedup**: 743ms → 40ms (18x faster)
**Impact**: Reduces total import time by 9%

Refactor to include `owner_city_id` in initial tile INSERT:

1. Parse all City elements first (already done)
2. Pre-parse tile city ownership data into HashMap
3. Include city ownership when inserting tiles (modify `parse_tiles`)
4. Delete `update_tile_city_ownership` pass entirely

---

## Architecture Document Re-evaluation

The original architecture document estimated 213ms per save.
**Actual performance**: 7,410ms (35x slower)

**The architecture document was correct about**:

- Parsing being fast (ZIP + XML = 69ms ✅)
- Insertion being a potential bottleneck (identified!)

**The architecture document underestimated**:

- The sheer volume of individual INSERT/UPDATE operations
- The overhead of round-trip database calls vs. batch operations
- The impact of N+1 query patterns

**The architecture document's recommendation to use parallel parsing** is good, but **must be done AFTER fixing the N+1 problems**. Otherwise, parallel parsing will just run multiple slow importers concurrently.

---

## Validation Plan

After implementing fixes:

1. **Re-run benchmark** with same test file
2. **Verify timing improvements**:
   - ID mapper: < 300ms
   - Character extended data: < 400ms
   - Tile city ownership: < 50ms
   - Total: < 2 seconds

3. **Test with multiple save sizes**:
   - Small (Year 97): < 1s
   - Medium (Year 119): < 2s
   - Large (Year 142): < 2.5s

4. **Measure batch import**:
   - 10 saves: < 20s
   - 76 saves: < 2 minutes

5. **Profile again** to find next bottleneck (likely commit overhead)

---

## Conclusion

**Problem identified**: Classic N+1 query anti-pattern in 3 critical functions.

**Root cause**: Inconsistent use of DuckDB Appender API (used in some places, not others).

**Solution**: Systematically replace individual INSERTs/UPDATEs with batch operations.

**Expected outcome**: 6-7x performance improvement (7.9s → ~1.3s per save).

**Next steps**:

1. Fix these three bottlenecks
2. Re-benchmark
3. Proceed with hybrid parser migration for parallelization

**Timeline**:

- Week 1: Fix N+1 bottlenecks (< 1-2 days)
- Week 1: Test and validate improvements (< 1 day)
- Week 1: Profile remaining performance (< 1 day)
- Weeks 2-6: Hybrid parser migration (as planned)
- Week 7: Parallel batch import (as planned)

**Final projected performance**:

- Single save: ~1-2s
- 266 saves: ~1.5-2 minutes (sequential) or ~25-30s (parallel)
- **User onboarding: Dramatically improved from 33 minutes to under 2 minutes**

---

**Generated**: November 7, 2025
**By**: Claude Code diagnostic analysis
**Benchmark data**: `docs/benchmark-results-2025-11-07.md`
**Instrumented code**: `src-tauri/src/parser/import.rs` (lines 90-407)
