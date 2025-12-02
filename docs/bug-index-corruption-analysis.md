# Bug Analysis: DuckDB Index Corruption After App Restart

**Date:** 2025-12-02
**Status:** Open
**Severity:** Critical

## Symptoms

1. Charts show data correctly immediately after import
2. After closing and reopening the app, charts are empty
3. Games still appear in sidebar (game list works)
4. Easily reproducible: reset DB → import → close → reopen → charts broken

## Root Cause Analysis

### Observed Behavior

Database queries show inconsistent results:

| Query Method | Result |
|--------------|--------|
| `SELECT * FROM players WHERE match_id = 20` | 0 rows |
| `PRAGMA disable_optimizer; SELECT * FROM players WHERE match_id = 20` | 4 rows ✓ |
| `SELECT COUNT(*) FROM players` | 62 (correct) |
| `ORDER BY rowid` scan | Full data ✓ |

This proves the **`idx_players_match` index is corrupted** - filtered queries use the corrupt index and return wrong results, while full table scans return correct data.

### DuckDB Assertion Failure

Terminal output shows:
```
Assertion failed: (index.IsBound()), function operator(), file row_group_collection.cpp, line 671.
```

This is a DuckDB internal error indicating index structures are inconsistent with data.

### Connection Lifecycle Issue

The app has a problematic connection flow:

1. **`ensure_schema_ready`** (schema.rs:392) opens Connection #1 with **default settings**
2. Creates schema (tables, indexes) → writes to WAL
3. Connection #1 is **implicitly dropped** (no explicit CHECKPOINT)
4. **`DbPool::new`** opens Connection #2 with `checkpoint_threshold='1GB'`
5. Imports data using Appender → writes more to WAL
6. On clean close, `DbPool::drop` calls CHECKPOINT

**The Problem:** When Connection #1 drops without checkpointing, the WAL contains uncommitted schema/index creation. Connection #2 opens and starts writing data before WAL is fully replayed, causing index structures to become inconsistent.

### Why This Manifests Now

The FK removal commit (`b4c927d`) made imports ~25% faster by:
- Removing FK constraint validation overhead
- Using two-phase ID mapping for single-pass character insertion

This means more data is written to WAL before the first checkpoint, increasing the window for index corruption.

## Affected Code

- `src-tauri/src/db/schema.rs:392` - `ensure_schema_ready` opens separate connection
- `src-tauri/src/db/connection.rs:147` - `get_connection` sets high checkpoint threshold
- `src-tauri/src/lib.rs:1686` - Sequential calls to `ensure_schema_ready` then `DbPool::new`

## Proposed Fix

### Option A: Add CHECKPOINT in ensure_schema_ready (Quick Fix)

```rust
// At end of ensure_schema_ready, before returning Ok(())
conn.execute_batch("CHECKPOINT")?;
log::info!("Schema checkpointed");
```

### Option B: Unify connection management (Better Fix)

Have `ensure_schema_ready` accept an existing connection from DbPool rather than creating its own:

```rust
pub fn ensure_schema_ready(conn: &Connection) -> Result<()> {
    // Use provided connection instead of opening new one
}
```

Then in lib.rs:
```rust
let pool = db::connection::DbPool::new(&db_path)?;
pool.with_connection(|conn| db::ensure_schema_ready(conn))?;
```

### Option C: Use consistent checkpoint settings (Alternative)

Have `ensure_schema_ready` use the same checkpoint settings as DbPool:

```rust
let conn = Connection::open(db_path)?;
conn.execute_batch("
    SET checkpoint_threshold='1GB';
    SET wal_autocheckpoint='1GB';
")?;
```

## Verification Steps

After fix:
1. Reset database (delete files)
2. Start app, import saves
3. Verify charts show data
4. Close app completely
5. Reopen app
6. Verify charts still show data

Run this query to verify index integrity:
```sql
-- Should return same results
SELECT COUNT(*) FROM players WHERE match_id = 1;
PRAGMA disable_optimizer;
SELECT COUNT(*) FROM players WHERE match_id = 1;
```

## Related Files

- `docs/schema.sql` - Schema definition with indexes
- `src-tauri/src/parser/import.rs` - Import flow using Appender API
- `src-tauri/src/db/connection.rs` - Connection pool with CHECKPOINT on drop
