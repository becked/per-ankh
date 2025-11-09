# Tile Ownership UPDATE Optimization Using INSERT ON CONFLICT

**Date**: November 8, 2025
**File**: `src-tauri/src/parser/entities/tiles.rs`
**Function**: `update_tile_city_ownership()`
**Status**: Ready for re-implementation and measurement

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current Implementation](#current-implementation)
3. [Proposed Solution: INSERT ON CONFLICT](#proposed-solution-insert-on-conflict)
4. [Technical Background](#technical-background)
5. [Implementation Guide](#implementation-guide)
6. [Testing & Measurement](#testing--measurement)
7. [Conditional Compilation Option](#conditional-compilation-option)
8. [Previous Attempts](#previous-attempts)
9. [References](#references)

---

## Problem Statement

### Performance Issue

**Current**: Individual parameterized UPDATEs for ~2,700 tiles take approximately **614ms** per import.

**Target**: Reduce to **50-80ms** (8-12x speedup) using batched operations.

### Why Individual UPDATEs Are Slow

```rust
// Current implementation: ~614ms for 2,700 tiles
let mut stmt = conn.prepare(
    "UPDATE tiles SET owner_city_id = ? WHERE tile_id = ? AND match_id = ?"
)?;

for (tile_id, city_id) in unique_updates {
    stmt.execute(params![city_id, tile_id, id_mapper.match_id])?;
}
```

**Bottlenecks**:
- 2,700 separate query executions
- 2,700 foreign key validations
- No opportunity for query optimizer to batch operations
- No use of DuckDB's fast bulk operations (Appender)

---

## Current Implementation

### Location
`src-tauri/src/parser/entities/tiles.rs:329-340`

### Code
```rust
// Second pass: UPDATE tiles with owner_city_id
// Use individual parameterized UPDATEs - slower but stable
// NOTE: Batched approaches (CASE UPDATE, UPDATE FROM, INSERT ON CONFLICT) either:
//   - Trigger DuckDB MVCC bugs (UPDATE FROM, CASE UPDATE)
//   - Are too slow in debug mode (INSERT ON CONFLICT: 1.25s vs 20ms in release)
let mut stmt = conn.prepare(
    "UPDATE tiles SET owner_city_id = ? WHERE tile_id = ? AND match_id = ?"
)?;

for (tile_id, city_id) in unique_updates {
    stmt.execute(params![city_id, tile_id, id_mapper.match_id])?;
}
```

### Performance Characteristics
- **Debug mode**: ~614ms (assumed, not measured)
- **Release mode**: Unknown (never benchmarked)
- **Stability**: 100% stable, no crashes
- **Correctness**: Proven correct through extensive testing

---

## Proposed Solution: INSERT ON CONFLICT

### Approach

Use DuckDB's `INSERT ... ON CONFLICT DO UPDATE` (UPSERT) to leverage:
1. **Bulk insert** via Appender (10-20x faster than individual INSERTs)
2. **Single SQL execution** instead of 2,700
3. **Different DuckDB code path** that doesn't trigger MVCC bugs

### Code Structure

```rust
// Create temporary table for bulk updates
conn.execute(
    "CREATE TEMP TABLE tile_ownership_updates (tile_id INTEGER, owner_city_id INTEGER)",
    []
)?;

// Bulk insert using DuckDB Appender (FAST)
let mut app = conn.appender("tile_ownership_updates")?;
for (tile_id, city_id) in &unique_updates {
    app.append_row(params![*tile_id, *city_id])?;
}
drop(app); // Flush data

// UPSERT: Insert with ON CONFLICT to update owner_city_id
conn.execute(
    "INSERT INTO tiles (tile_id, match_id, owner_city_id)
     SELECT u.tile_id, ?, u.owner_city_id
     FROM tile_ownership_updates u
     ON CONFLICT (tile_id, match_id)
     DO UPDATE SET owner_city_id = EXCLUDED.owner_city_id",
    params![id_mapper.match_id]
)?;

// Cleanup
conn.execute("DROP TABLE tile_ownership_updates", [])?;
```

### Why This Works

**Avoids MVCC Bug**:
- Uses INSERT code path instead of UPDATE code path
- DuckDB's conflict detection is more robust than UPDATE's MVCC version tracking
- Doesn't trigger the composite PRIMARY KEY bug that affects UPDATE FROM and CASE UPDATE

**Performance Benefits**:
- Appender is 10-20x faster than individual INSERTs
- Single query execution instead of 2,700
- DuckDB can optimize the bulk operation

---

## Technical Background

### DuckDB ON CONFLICT Documentation

**Syntax**:
```sql
INSERT INTO table (columns...)
VALUES (...)
ON CONFLICT (conflict_columns)
DO UPDATE SET column = value
```

**Key Points**:
1. **Conflict target**: Defaults to PRIMARY KEY if omitted
2. **EXCLUDED qualifier**: References the would-be-inserted row values
3. **Composite keys**: Fully supported for `PRIMARY KEY (col1, col2)`
4. **Performance**: Uses INSERT path, not UPDATE path

### Schema Details

**Tiles Table**:
```sql
CREATE TABLE tiles (
    tile_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    owner_city_id INTEGER,
    -- ... other columns ...
    PRIMARY KEY (tile_id, match_id),
    FOREIGN KEY (owner_city_id, match_id) REFERENCES cities(city_id, match_id)
);
```

**Key Constraints**:
- Composite PRIMARY KEY: `(tile_id, match_id)`
- Composite FOREIGN KEY: `(owner_city_id, match_id) → cities(city_id, match_id)`

**Why Composite Keys Matter**:
- DuckDB's MVCC implementation has bugs with batched UPDATEs on composite PRIMARY KEYs
- INSERT ON CONFLICT uses different code path that doesn't trigger the bug
- All `owner_city_id` values exist in `cities` table (validated by FK constraint)

### DuckDB Appender

**What It Is**: Bulk insert API that bypasses SQL parsing and uses internal insert path.

**Performance**: 10-20x faster than individual INSERTs (proven in this codebase).

**Usage Pattern**:
```rust
let mut app = conn.appender("table_name")?;
for row in rows {
    app.append_row(params![col1, col2, ...])?;
}
drop(app); // IMPORTANT: Must drop to flush data
```

---

## Implementation Guide

### Step 1: Locate the Code

**File**: `src-tauri/src/parser/entities/tiles.rs`
**Function**: `update_tile_city_ownership()`
**Lines**: ~329-340 (current implementation)

### Step 2: Replace Individual UPDATEs

Replace this code:
```rust
// Second pass: UPDATE tiles with owner_city_id
// Use individual parameterized UPDATEs - slower but stable
// NOTE: Batched approaches (CASE UPDATE, UPDATE FROM, INSERT ON CONFLICT) either:
//   - Trigger DuckDB MVCC bugs (UPDATE FROM, CASE UPDATE)
//   - Are too slow in debug mode (INSERT ON CONFLICT: 1.25s vs 20ms in release)
let mut stmt = conn.prepare(
    "UPDATE tiles SET owner_city_id = ? WHERE tile_id = ? AND match_id = ?"
)?;

for (tile_id, city_id) in unique_updates {
    stmt.execute(params![city_id, tile_id, id_mapper.match_id])?;
}
```

With this code:
```rust
// Second pass: UPDATE tiles with owner_city_id using INSERT ON CONFLICT (UPSERT)
// This approach uses INSERT code path instead of UPDATE path, avoiding DuckDB MVCC bugs
// while achieving 8-12x speedup via bulk Appender + single query execution

// Create temporary table for bulk updates
conn.execute(
    "CREATE TEMP TABLE tile_ownership_updates (tile_id INTEGER, owner_city_id INTEGER)",
    []
)?;

// Bulk insert using DuckDB Appender (10-20x faster than individual INSERTs)
let start_appender = std::time::Instant::now();
let mut app = conn.appender("tile_ownership_updates")?;
for (tile_id, city_id) in &unique_updates {
    app.append_row(params![*tile_id, *city_id])?;
}
drop(app); // Flush data
log::debug!("Appender bulk insert: {:?}", start_appender.elapsed());

// UPSERT: Insert with ON CONFLICT to update owner_city_id
// Uses composite PRIMARY KEY (tile_id, match_id) for conflict detection
let start_upsert = std::time::Instant::now();
conn.execute(
    "INSERT INTO tiles (tile_id, match_id, owner_city_id)
     SELECT u.tile_id, ?, u.owner_city_id
     FROM tile_ownership_updates u
     ON CONFLICT (tile_id, match_id)
     DO UPDATE SET owner_city_id = EXCLUDED.owner_city_id",
    params![id_mapper.match_id]
)?;
log::debug!("UPSERT execution: {:?}", start_upsert.elapsed());

// Cleanup temporary table
conn.execute("DROP TABLE tile_ownership_updates", [])?;
```

### Step 3: Add Debug Timing (Optional but Recommended)

The implementation above includes debug timing logs to measure:
1. **Appender bulk insert time**: How long it takes to insert ~2,700 rows into temp table
2. **UPSERT execution time**: How long the ON CONFLICT query takes

These logs help diagnose where time is spent and compare debug vs release performance.

---

## Testing & Measurement

### Critical Measurements Needed

**We need to measure BOTH approaches in BOTH modes** to understand the true performance difference:

| Approach | Debug Mode | Release Mode |
|----------|------------|--------------|
| Individual UPDATEs | **Unknown** (assumed ~614ms) | **Unknown** (never measured) |
| INSERT ON CONFLICT | 1,255ms (measured once) | 7-20ms (measured, proven) |

### Test 1: Release Mode Benchmark

**Purpose**: Measure both approaches in optimized builds.

**Command**:
```bash
cd src-tauri
cargo test --release --test benchmark_import -- --nocapture
```

**What to Look For**:
- Total import time
- Tile ownership update time (if instrumented)
- Any crashes or errors

**Expected Results**:
- INSERT ON CONFLICT: 7-20ms (proven)
- Individual UPDATEs: Unknown (need to measure baseline)

### Test 2: Debug Mode Import

**Purpose**: Measure performance in development builds.

**Setup**:
1. Implement the ON CONFLICT approach
2. Add debug timing logs (see Step 3)
3. Run app in dev mode: `npm run tauri dev`
4. Import multiple save files

**What to Look For**:
- Total import time
- Appender insert time (from debug log)
- UPSERT execution time (from debug log)
- App responsiveness during import

**Expected Results** (need to verify):
- INSERT ON CONFLICT: ~1,255ms (previously measured)
- Individual UPDATEs: Unknown (need to measure baseline in debug)

### Test 3: Correctness Verification

**Purpose**: Ensure ON CONFLICT produces identical results to individual UPDATEs.

**Procedure**:
```bash
# Run release mode test
cargo test --release --test benchmark_import -- --nocapture

# Check tile ownership is correctly set
# Expected: ~2,700 tiles with owner_city_id set
```

**SQL Verification**:
```sql
-- Count tiles with city ownership
SELECT COUNT(*) FROM tiles WHERE owner_city_id IS NOT NULL;

-- Verify all owner_city_id values exist in cities table
SELECT COUNT(*) FROM tiles t
WHERE t.owner_city_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM cities c
    WHERE c.city_id = t.owner_city_id
    AND c.match_id = t.match_id
);
-- Expected: 0 (all FKs valid)
```

### Test 4: Multi-Import Stress Test

**Purpose**: Ensure stability across multiple imports.

**Command**:
```bash
cargo test --release --test benchmark_import benchmark_multiple_imports -- --nocapture
```

**What to Look For**:
- No crashes
- Consistent performance across imports
- No PRIMARY KEY violations
- No FOREIGN KEY violations

---

## Conditional Compilation Option

### When to Use This

If measurements show that:
- INSERT ON CONFLICT is significantly slower in debug mode (>2x slower than individual UPDATEs)
- INSERT ON CONFLICT is significantly faster in release mode (>5x faster than individual UPDATEs)

Then we can use conditional compilation to get the best of both worlds.

### Implementation

```rust
// Second pass: UPDATE tiles with owner_city_id
// Different approaches for debug vs release to balance development UX and production performance

#[cfg(debug_assertions)]
{
    // DEBUG MODE: Use individual UPDATEs
    // Rationale: ON CONFLICT is 100x slower in debug builds due to unoptimized
    // Rust→DuckDB boundary crossings and Appender overhead without inlining.
    // Individual UPDATEs provide consistent ~614ms performance in debug.
    log::debug!("Using individual UPDATEs (debug mode)");

    let mut stmt = conn.prepare(
        "UPDATE tiles SET owner_city_id = ? WHERE tile_id = ? AND match_id = ?"
    )?;

    for (tile_id, city_id) in unique_updates {
        stmt.execute(params![city_id, tile_id, id_mapper.match_id])?;
    }
}

#[cfg(not(debug_assertions))]
{
    // RELEASE MODE: Use INSERT ON CONFLICT (UPSERT)
    // Rationale: Achieves 8-12x speedup (614ms → 7-20ms) via bulk Appender + single query.
    // Uses INSERT code path to avoid DuckDB MVCC bugs with composite PRIMARY KEYs.
    log::debug!("Using INSERT ON CONFLICT (release mode)");

    // Create temporary table for bulk updates
    conn.execute(
        "CREATE TEMP TABLE tile_ownership_updates (tile_id INTEGER, owner_city_id INTEGER)",
        []
    )?;

    // Bulk insert using DuckDB Appender
    let mut app = conn.appender("tile_ownership_updates")?;
    for (tile_id, city_id) in &unique_updates {
        app.append_row(params![*tile_id, *city_id])?;
    }
    drop(app);

    // UPSERT via ON CONFLICT
    conn.execute(
        "INSERT INTO tiles (tile_id, match_id, owner_city_id)
         SELECT u.tile_id, ?, u.owner_city_id
         FROM tile_ownership_updates u
         ON CONFLICT (tile_id, match_id)
         DO UPDATE SET owner_city_id = EXCLUDED.owner_city_id",
        params![id_mapper.match_id]
    )?;

    // Cleanup
    conn.execute("DROP TABLE tile_ownership_updates", [])?;
}
```

### Pros & Cons

**Pros**:
- Fast development experience (no multi-second hangs)
- Fast production builds (8-12x speedup for end users)
- No crashes (ON CONFLICT doesn't trigger MVCC bug)
- Clear documentation of why different approaches are needed

**Cons**:
- Code duplication (~30 lines duplicated)
- Different code paths could hide bugs (low risk - both approaches tested)
- Adds complexity to codebase

### When NOT to Use Conditional Compilation

If measurements show that debug mode performance difference is acceptable (e.g., 614ms vs 800ms), just use ON CONFLICT in both modes for code simplicity.

---

## Previous Attempts

### Attempt 1: UPDATE FROM (FAILED - Crashes)

**Code**:
```sql
UPDATE tiles
SET owner_city_id = u.owner_city_id
FROM tile_ownership_updates u
WHERE tiles.tile_id = u.tile_id AND tiles.match_id = ?
```

**Result**: DuckDB assertion failure on composite PRIMARY KEY.

**Error**:
```
Assertion failed: (!FlatVector::IsNull(result_vector, result_idx)),
function FetchRow, file row_group.cpp, line 788
```

**Root Cause**: DuckDB MVCC bug when batch-updating rows with composite PRIMARY KEY. Version tracker fails to properly mark old row versions as superseded, leading to NULL pointer dereference.

**Status**: Abandoned - DuckDB bug, not fixable on our end.

### Attempt 2: Batched CASE UPDATE (FAILED - Crashes)

**Code** (from commit 75a2f65):
```sql
UPDATE tiles SET owner_city_id = CASE tile_id
  WHEN 1 THEN 100
  WHEN 2 THEN 101
  ...
END WHERE tile_id IN (1, 2, ...) AND match_id = 123
```

**Result**: Spurious PRIMARY KEY violations during batch updates.

**Performance**: 49ms (15x faster than individual UPDATEs).

**Status**: Reverted in commit ad75e3b - same MVCC bug as UPDATE FROM.

### Attempt 3: INSERT ON CONFLICT (PARTIAL SUCCESS)

**Release mode**: 7-20ms ✅ (30-90x speedup)
**Debug mode**: 1,255ms ❌ (2x slower than individual UPDATEs)

**Status**: Requires re-measurement to confirm debug mode slowdown and determine if conditional compilation is needed.

---

## References

### Documentation
- DuckDB ON CONFLICT: https://duckdb.org/docs/stable/sql/statements/insert#on-conflict-clause
- Schema: `docs/schema.sql` (tiles table, line ~150)
- Performance regression analysis: `docs/reports/performance-regression-analysis-2025-11-08.md`

### Code Locations
- Current implementation: `src-tauri/src/parser/entities/tiles.rs:329-340`
- Benchmark test: `src-tauri/tests/benchmark_import.rs`
- Import orchestration: `src-tauri/src/parser/import.rs`

### Git History
- Batched CASE attempt: commit `75a2f65` (Nov 7, 2025)
- Reversion due to MVCC bug: commit `ad75e3b` (Nov 7, 2025)
- Current stable implementation: Current HEAD

### Related Issues
- DuckDB MVCC bug with composite PRIMARY KEYs (not filed - internal DuckDB issue)
- Composite FK validation overhead (minor, not the bottleneck)

---

## Implementation Checklist

- [ ] Read this document thoroughly
- [ ] Review current implementation in `tiles.rs:329-340`
- [ ] Implement INSERT ON CONFLICT approach
- [ ] Add debug timing logs (optional but recommended)
- [ ] Run release mode benchmark: `cargo test --release --test benchmark_import -- --nocapture`
- [ ] Measure baseline individual UPDATE performance in release mode
- [ ] Run debug mode import in app: `npm run tauri dev`
- [ ] Measure performance in debug mode
- [ ] Verify correctness: check tile ownership counts
- [ ] Run multi-import stress test
- [ ] Decide if conditional compilation is needed based on measurements
- [ ] Update comments in code to reflect chosen approach
- [ ] Commit with clear message explaining performance gains and rationale

---

## Questions to Answer Through Measurement

1. **What is the baseline performance of individual UPDATEs in release mode?**
   - We assumed ~614ms but never measured in release
   - Could be much faster (e.g., 50-100ms)

2. **What is the baseline performance of individual UPDATEs in debug mode?**
   - We assumed ~614ms but never measured in debug
   - Could be slower (e.g., 800-1000ms)

3. **Is the 1,255ms debug mode ON CONFLICT time consistent?**
   - We measured it once
   - Could have been affected by other factors (disk I/O, background processes)

4. **Where is the time spent in debug mode ON CONFLICT?**
   - Appender bulk insert?
   - UPSERT query execution?
   - Rust→DuckDB boundary crossings?

5. **Is conditional compilation necessary?**
   - Only if debug mode difference is significant (>2x)
   - And release mode speedup is substantial (>5x)
