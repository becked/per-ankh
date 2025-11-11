# Tile City Ownership Performance Investigation

**Date**: November 11, 2025
**Investigation**: Why tile city ownership is 622ms instead of the expected 49ms
**Status**: ✅ SOLVED - Not a regression, intentional reversion due to DuckDB bug

---

## Executive Summary

The tile city ownership operation takes **622ms** (57% of total import time), but the Nov 7 performance report showed it at **49ms**. This appears to be a regression, but investigation reveals:

**Conclusion**: This is **NOT a regression**. The batched CASE UPDATE optimization that achieved 49ms was **intentionally reverted** on Nov 7 (same day!) due to a **DuckDB MVCC bug** that caused spurious PRIMARY KEY constraint violations.

**Current state**: Using individual parameterized UPDATEs (slow but stable)
**Why**: Batched approaches trigger DuckDB bugs with composite PRIMARY KEYs
**Performance impact**: 622ms vs 49ms = 12.7x slower, but necessary for correctness

---

## Timeline of Optimization Attempts

### 1. Initial Implementation: Individual UPDATEs (Pre-Nov 7)
**Performance**: ~740ms
**Method**: Loop with individual UPDATE statements
**Status**: Baseline (slow but working)

### 2. Batched CASE UPDATE Optimization (Nov 7 - commit 75a2f65)
**Performance**: **49ms** (15x faster!)
**Method**: Batched CASE UPDATE statements
```sql
UPDATE tiles SET owner_city_id = CASE tile_id
  WHEN 1 THEN 100
  WHEN 2 THEN 101
  ...
END WHERE tile_id IN (1, 2, ...) AND match_id = 123
```
**Status**: ✅ Fast but ❌ Buggy

### 3. Reversion to Individual UPDATEs (Nov 7 - commit ad75e3b)
**Performance**: ~770ms (slower than batched, similar to baseline)
**Reason**: DuckDB threw spurious PRIMARY KEY violations
**Commit message excerpt**:
> "DuckDB was throwing spurious PRIMARY KEY constraint violations during batched
> CASE UPDATE statements, even when all diagnostic checks showed no actual
> duplicates existed. After extensive debugging..."
>
> "Root cause: DuckDB bug/limitation with batched CASE UPDATE statements that
> causes false PRIMARY KEY violations."

**Status**: ❌ Slow but ✅ Reliable

### 4. INSERT ON CONFLICT Optimization (Post-Nov 7 - commit cbfadd2)
**Performance**: Unknown (not measured in current benchmarks)
**Method**: Tried using INSERT ON CONFLICT instead
**Status**: Also reverted (commit b6c1f74)

### 5. Current State (Nov 11)
**Performance**: 622ms
**Method**: Individual parameterized UPDATEs
**Comment in code (lines 336-338)**:
> "Use individual parameterized UPDATEs - slower but stable
> NOTE: Batched approaches (CASE UPDATE, UPDATE FROM, INSERT ON CONFLICT) all trigger
> DuckDB MVCC bugs with composite PRIMARY KEYs."

**Status**: Current production code

---

## Why Nov 7 Performance Report Showed 49ms

The Nov 7 performance results document states:
- "Tile city ownership: 49ms (2.6%) ⚡ 15x faster"

This measurement was taken **during testing of the batched CASE UPDATE optimization** (commit 75a2f65), but **before it was reverted** due to the DuckDB bug (commit ad75e3b).

**Both commits happened on Nov 7, 2025:**
1. Morning: Implemented batched CASE UPDATE (49ms) ✅
2. Afternoon: Discovered DuckDB bug, reverted to individual UPDATEs (770ms) ❌

The performance document was likely written mid-day after the optimization but before discovering the bug.

---

## Current Implementation Details

**Location**: `src-tauri/src/parser/entities/tiles.rs:334-345`

```rust
// Use individual parameterized UPDATEs - slower but stable
// NOTE: Batched approaches (CASE UPDATE, UPDATE FROM, INSERT ON CONFLICT) all trigger
// DuckDB MVCC bugs with composite PRIMARY KEYs.
let mut stmt = conn.prepare(
    "UPDATE tiles SET owner_city_id = ? WHERE tile_id = ? AND match_id = ?"
)?;

for (tile_id, city_id) in unique_updates {
    stmt.execute(params![city_id, tile_id, id_mapper.match_id])?;
}
```

**Performance characteristics:**
- **Time**: 622ms for ~5,476 tiles
- **Per-tile**: ~114μs per tile
- **Method**: Prepared statement executed in a loop
- **Why slow**:
  - Each execute() call requires a query plan
  - Each update validates foreign key constraints individually
  - No batch optimization
  - No parallel execution possible (database lock)

---

## The DuckDB MVCC Bug

**Bug description**: DuckDB throws PRIMARY KEY constraint violations when using batched UPDATE operations (CASE UPDATE, UPDATE FROM, INSERT ON CONFLICT) on tables with composite PRIMARY KEYs.

**Symptoms**:
- Error: "PRIMARY KEY or UNIQUE constraint violated"
- Diagnostic checks show NO actual duplicates in database
- Diagnostic checks show NO duplicates in update list
- Error occurs randomly/inconsistently (MVCC race condition)

**Tables affected**: Any table with composite PRIMARY KEY, specifically:
- `tiles` (PRIMARY KEY: `tile_id, match_id`)
- `characters` (PRIMARY KEY: `character_id, match_id`)
- Others with similar schema

**Workaround**: Use individual parameterized UPDATEs instead of batched operations

**DuckDB version**: Unknown (should check if newer DuckDB versions fix this)

---

## Proposed Solution: UPDATE FROM with Temp Table

**Document**: `docs/implementation/tile-ownership-update-optimization.md`

**Approach**:
1. Create temp table
2. Bulk insert updates using Appender API (fast)
3. Single `UPDATE FROM` query
4. Drop temp table

**Expected performance**: 50-80ms (8-12x speedup vs current)

**Why it might work**: Uses `UPDATE FROM` instead of `CASE UPDATE`, might avoid MVCC bug

**Why it might not work**: The code comment says "Batched approaches... all trigger DuckDB MVCC bugs", which includes UPDATE FROM

**Status**: Not yet attempted (documented but not implemented)

---

## Why This Matters (and Doesn't)

### Impact on Total Import Time

**Current breakdown** (1,099ms total):
- Tile city ownership: 622ms (57%)
- All other operations: 477ms (43%)

**If optimized to 50ms**:
- Tile city ownership: 50ms (10%)
- All other operations: 477ms (90%)
- **Total**: ~527ms (52% faster overall!)

### User Experience Impact

| Scenario | Current | If Optimized | Difference |
|----------|---------|--------------|------------|
| Single save | 1.1s | ~0.5s | 0.6s saved |
| 10 saves | 11s | ~5s | 6s saved |
| 266 saves | 5 min | ~2.3 min | 2.7 min saved |

**Significant improvement**: Would make imports feel nearly instant.

---

## Recommendations

### Priority 1: Test UPDATE FROM Approach (Medium Risk)

**Why**: The optimization doc suggests UPDATE FROM might avoid the bug

**How**:
1. Implement temp table + Appender + UPDATE FROM (see `tile-ownership-update-optimization.md`)
2. Test with multiple saves
3. Monitor for PRIMARY KEY violations
4. If stable after 10+ imports, keep it
5. If any failures, revert immediately

**Expected outcome**: Either 50-80ms (success) or same PRIMARY KEY errors (failure)

**Risk**: Medium - might trigger same MVCC bug, but easy to revert

### Priority 2: Upgrade DuckDB (Low Risk)

**Current DuckDB version**: Unknown (check `Cargo.toml`)
**Action**:
1. Check DuckDB release notes for MVCC or PRIMARY KEY bug fixes
2. Test with latest DuckDB version
3. If bug is fixed upstream, batched approaches should work

**Expected outcome**: Possible fix, but uncertain

**Risk**: Low - can always downgrade if new version has issues

### Priority 3: Accept Current Performance (No Risk)

**Rationale**:
- Current performance (1.1s per save) is already **excellent**
- User experience is good even with 266 saves (5 min)
- System is **stable and correct**
- The 622ms overhead is acceptable for data correctness

**When to choose this**: If attempts to optimize fail or cause instability

---

## Conclusion

**Is this a regression?** ❌ No - it's an intentional reversion for correctness

**Can it be optimized?** ⚠️ Maybe - UPDATE FROM approach is documented but untested

**Should it be optimized?** 🤔 Depends on risk tolerance:
- **Low risk tolerance**: Keep current implementation (stable, correct, acceptable performance)
- **High risk tolerance**: Try UPDATE FROM optimization (might gain 50% speedup, might fail)

**Current recommendation**: Document the situation, keep current implementation unless user feedback demands faster imports. The hybrid parser already achieved 7.2x overall speedup - chasing the last 50% might not be worth the instability risk.

---

## References

- **Current implementation**: `src-tauri/src/parser/entities/tiles.rs:334-345`
- **Batched CASE optimization**: commit `75a2f65` (Nov 7, 2025)
- **Reversion due to bug**: commit `ad75e3b` (Nov 7, 2025)
- **INSERT ON CONFLICT attempt**: commit `cbfadd2` (after Nov 7)
- **INSERT ON CONFLICT revert**: commit `b6c1f74` (after Nov 7)
- **Optimization proposal**: `docs/implementation/tile-ownership-update-optimization.md`
- **Nov 7 performance results**: `docs/performance-results-2025-11-07.md`

---

**Generated**: November 11, 2025
**Investigation Status**: ✅ Complete
**Action Required**: Document findings, no immediate code changes needed
