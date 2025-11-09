# Tile City Ownership UPDATE Optimization

**Date**: November 8, 2025
**File**: `src-tauri/src/parser/entities/tiles.rs`
**Function**: `update_tile_city_ownership()`
**Goal**: 8-12x speedup (614ms → 50-80ms)

## Problem

Current implementation uses individual UPDATEs for ~2,700 tiles:

```rust
let mut stmt = conn.prepare("UPDATE tiles SET owner_city_id = ? WHERE tile_id = ? AND match_id = ?")?;
for (tile_id, city_id) in unique_updates {
    stmt.execute(params![city_id, tile_id, id_mapper.match_id])?;
}
```

**Performance**: 614ms per import
**Bottleneck**: 2,700 query executions + 2,700 FK validations

## Solution

Use temp table + Appender + single UPDATE FROM:

1. Bulk insert updates into temp table (Appender = 10-20x faster)
2. Single UPDATE FROM query (1 execution instead of 2,700)

**Expected**: 50-80ms per import (8-12x speedup)

## Implementation

Replace lines 329-337 in `src-tauri/src/parser/entities/tiles.rs`:

```rust
// OLD CODE (delete this):
let mut stmt = conn.prepare(
    "UPDATE tiles SET owner_city_id = ? WHERE tile_id = ? AND match_id = ?"
)?;

for (tile_id, city_id) in unique_updates {
    stmt.execute(params![city_id, tile_id, id_mapper.match_id])?;
}
```

```rust
// NEW CODE (replace with this):
// Create temp table for bulk updates
conn.execute(
    "CREATE TEMP TABLE tile_ownership_updates (tile_id INTEGER, owner_city_id INTEGER)",
    []
)?;

// Bulk insert with Appender (fast)
let mut app = conn.appender("tile_ownership_updates")?;
for (tile_id, city_id) in &unique_updates {
    app.append_row(params![*tile_id, *city_id])?;
}
drop(app);

// Single UPDATE FROM (replaces 2,700 individual UPDATEs)
conn.execute(
    "UPDATE tiles
     SET owner_city_id = u.owner_city_id
     FROM tile_ownership_updates u
     WHERE tiles.tile_id = u.tile_id AND tiles.match_id = ?",
    params![id_mapper.match_id]
)?;

// Cleanup temp table
conn.execute("DROP TABLE tile_ownership_updates", [])?;
```

## Why This Works

### Performance Gains

1. **Appender bulk insert**: 10-20x faster than individual INSERTs (proven in your codebase)
2. **Single query execution**: 1 UPDATE instead of 2,700
3. **Batch FK validation**: DuckDB validates foreign keys once, not 2,700 times
4. **Hash join efficiency**: DuckDB builds hash table from 2,700 rows, probes 5,476 tiles

### Safety

- **FK Safe**: All `city_id` values already exist (cities parsed in Pass 2a)
- **PK Safe**: Avoids the DuckDB MVCC bug that batched CASE UPDATE triggered
- **Transaction Safe**: All operations in same transaction (on error, temp table auto-dropped)

## Testing

### 1. Run Benchmark
```bash
cd src-tauri
cargo test --release --test benchmark_import -- --nocapture
```

**Expected output**:
```
⏱️  Tile city ownership: 50-80ms  # Was 614ms
⏱️  TOTAL IMPORT TIME: 1.9-2.0s   # Was 2.5s
```

### 2. Verify Correctness
```bash
# After import, check tile ownership is set
sqlite3 per-ankh.db "SELECT COUNT(*) FROM tiles WHERE owner_city_id IS NOT NULL"
# Should return ~2,700 (same as before)
```

### 3. Test Multiple Saves
```bash
cargo test --release --test benchmark_import benchmark_multiple_imports -- --nocapture
```

**Expected**:
- Average time: ~1.9s per save (was ~3.0s)
- No errors or FK violations

## Rollback Plan

If issues arise, revert to individual UPDATEs:

```rust
// Rollback code (current stable implementation)
let mut stmt = conn.prepare(
    "UPDATE tiles SET owner_city_id = ? WHERE tile_id = ? AND match_id = ?"
)?;

for (tile_id, city_id) in unique_updates {
    stmt.execute(params![city_id, tile_id, id_mapper.match_id])?;
}
```

Performance will regress to 614ms but imports will work.

## Context: Why Not Batched CASE UPDATE?

Previous optimization (commit 75a2f65) used batched CASE UPDATE:

```sql
UPDATE tiles SET owner_city_id = CASE tile_id
  WHEN 1 THEN 100
  WHEN 2 THEN 101
  ...
END WHERE tile_id IN (1, 2, ...) AND match_id = 123
```

**Performance**: 49ms (15x faster)
**Problem**: DuckDB threw spurious PRIMARY KEY violations (commit ad75e3b)
**Root Cause**: DuckDB MVCC bug with batched CASE statements

UPDATE FROM achieves similar performance without triggering the bug.

## References

- Current slow implementation: `src-tauri/src/parser/entities/tiles.rs:329-337`
- Batched CASE attempt: commit `75a2f65` (Nov 7, 2025)
- Reversion due to bug: commit `ad75e3b` (Nov 7, 2025)
- Performance regression analysis: `docs/reports/performance-regression-analysis-2025-11-08.md`
- Schema: `docs/schema.sql` (tiles table with FK to cities)
