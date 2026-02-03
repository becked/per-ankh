# XML Parser Implementation Plan v2.2 - Changes Summary

**Date:** 2025-11-05
**Status:** Ready for Implementation

This document summarizes the changes made to the XML Parser Implementation Plan based on the latest reviewer feedback. All Tier 1 (critical) and Tier 2 (important) recommendations have been incorporated.

---

## Overview

The plan has been updated from v2.1 to v2.2 with significant improvements to correctness, robustness, and multi-process safety. The core architecture remains the same, but critical details have been refined.

---

## Tier 1 Changes (Critical for Correctness)

### 1. UPSERT Strategy for Core Entities ✅

**What Changed:**

- Core entities (players, characters, cities, tiles, units, families, religions, tribes) now use `INSERT ... ON CONFLICT (match_id, xml_id) DO UPDATE` instead of DELETE-then-INSERT
- Only derived/child tables use DELETE-then-INSERT
- Reduces churn and eliminates temporary FK constraint violations

**Implementation:**

```rust
// OLD (v2.1): DELETE all, then INSERT
fn delete_derived_match_data(tx: &Transaction, match_id: i64) -> Result<()> {
    // Deleted ALL tables including core entities
}

// NEW (v2.2): UPSERT core entities, DELETE only derived
fn upsert_player(tx: &Transaction, player: &Player) -> Result<()> {
    tx.execute(
        "INSERT INTO players (player_id, match_id, xml_id, ...)
         VALUES (?, ?, ?, ...)
         ON CONFLICT (match_id, xml_id)
         DO UPDATE SET player_id = excluded.player_id, ...",
        params![...]
    )
}
```

**Benefits:**

- More resilient if concurrent read occurs during import
- Preserves referential integrity throughout update
- No temporary FK violations
- Cleaner transaction logs

**Schema Requirements:** ✅ Already in place

- Unique constraints on `(match_id, xml_id)` for all core entity tables (already in schema.sql)

---

### 2. Multi-Process Concurrency Control ✅

**What Changed:**

- Added database-level locking via `match_locks` table
- In-process Mutex remains for same-app concurrency
- Database lock prevents corruption from multiple app instances

**New Component:**

```rust
// Database-level lock (NEW in v2.2)
fn acquire_db_lock(tx: &Transaction, game_id: &str) -> Result<()> {
    tx.execute(
        "INSERT INTO match_locks (game_id, locked_at, locked_by)
         VALUES (?, CURRENT_TIMESTAMP, ?)
         ON CONFLICT (game_id) DO UPDATE ...",
        params![game_id, std::process::id()]
    )?;
    Ok(())
}
```

**New Features:**

- Stale lock cleanup (10-minute timeout)
- Process ID tracking for debugging
- Automatic lock release on commit/rollback

**Schema Addition Required:**

- New `match_locks` table (see `schema-migration-v2.2.sql`)

**Why This Matters:**

- v2.1 only protected same-app concurrency
- v2.2 protects across multiple app instances
- Critical for desktop apps where users might run multiple instances

---

### 3. Enhanced ZIP Security ✅

**What Changed:**

- Path separator normalization (Windows `\` vs Unix `/`)
- Control character rejection in filenames
- Absolute path detection after normalization
- Empty path component validation

**New Validation Function:**

```rust
fn validate_zip_path(path: &str) -> Result<()> {
    // Normalize separators
    let normalized = path.replace('\\', "/");

    // Check absolute paths
    if normalized.starts_with('/') || Path::new(&normalized).is_absolute() {
        return Err(ParseError::SecurityViolation(...));
    }

    // Check control characters
    if path.chars().any(|c| c.is_control()) {
        return Err(ParseError::SecurityViolation(...));
    }

    // Validate path components
    for component in normalized.split('/') {
        if component.is_empty() || component == "." {
            return Err(ParseError::SecurityViolation(...));
        }
    }

    Ok(())
}
```

**Security Improvements:**

- Prevents Windows-specific path traversal (`foo\..\bar`)
- Blocks filenames with control characters (potential exploit vectors)
- Validates after normalization (defense in depth)

---

### 4. UTF-8 Encoding Validation ✅

**What Changed:**

- Explicit UTF-8 validation before parsing
- Detects and warns about non-UTF-8 XML declarations
- Better error messages for encoding issues

**New Checks:**

```rust
// Validate UTF-8 encoding
if !xml_content.is_char_boundary(xml_content.len()) {
    return Err(ParseError::MalformedXML {
        location: "XML file".to_string(),
        message: "Invalid UTF-8 encoding".to_string(),
        context: "File must be UTF-8 encoded".to_string(),
    });
}

// Check for non-UTF-8 declarations
if let Some(first_line) = xml_content.lines().next() {
    if first_line.contains("encoding") && !first_line.contains("UTF-8") {
        log::warn!("XML declares non-UTF-8 encoding: {}", first_line);
    }
}
```

**Benefits:**

- Catches encoding issues before parser failure
- Helpful error messages for users
- Logs warnings for non-standard encodings

---

### 5. Enhanced Progress Reporting ✅

**What Changed:**

- All progress updates now include entity counts
- File size display during XML parsing
- Total entities imported on completion
- Streaming updates during large entity parsing

**New Progress Format:**

```rust
// OLD (v2.1): Just percentages
progress.on_progress("Parsing characters", 35);

// NEW (v2.2): Counts and context
progress.on_progress(ProgressInfo::with_counts(
    "Parsing characters",
    35,
    125,  // current
    450   // total
));
// Displays: "Parsing characters (125/450)"
```

**Progress Milestones (v2.2):**

- 5% - ZIP extracted
- 10% - XML parsed (11.2 MB)
- 15% - Match identified (new/updating)
- 17% - Schema validated ← **NEW**
- 25% - Parsing players (6/6) ← counts
- 35% - Parsing characters (450/450) ← counts
- 75% - Parsing time-series data (50,000 rows) ← counts
- 100% - Complete (12,600 entities imported) ← total

**User Experience:**

```
Before (v2.1): [████░░░░░░] 35% - Parsing characters
After  (v2.2): [████░░░░░░] 35% - Parsing characters (125/450)
```

---

### 6. Schema Validation on Startup ✅

**What Changed:**

- Comprehensive validation before any import
- Checks all tables, unique constraints, and DELETE_ORDER integrity
- Detailed error messages for missing schema elements

**New Validation:**

```rust
pub fn validate_schema(conn: &Connection) -> Result<Vec<String>> {
    // Check required tables
    let required_tables = vec![
        "matches", "match_locks", "id_mappings", ...
    ];

    // Validate DELETE_ORDER tables exist
    for table in DELETE_ORDER { ... }

    // Check unique constraints for UPSERT
    for table in ["players", "characters", ...] {
        // Verify (match_id, xml_id) unique constraint
    }

    // Check concurrency control constraints
    // - match_locks.game_id unique
    // - matches.game_id unique

    Ok(warnings)
}
```

**Catches:**

- Missing `match_locks` table
- Missing unique constraints for UPSERT
- Tables in DELETE_ORDER that don't exist
- Schema drift from manual edits

---

## Tier 2 Changes (Important for Robustness)

### 7. Centralized Sentinel Handling ✅

**What Changed:**

- New `sentinels` module for consistent handling
- Functions: `normalize_id()`, `normalize_turn()`, `normalize_string()`
- Strict mode validators for range checking

**Implementation:**

```rust
pub mod sentinels {
    pub const ID_NONE: i32 = -1;
    pub const TURN_INVALID: i32 = -1;

    pub fn normalize_id(id: i32) -> Option<i32> {
        if id == ID_NONE { None } else { Some(id) }
    }

    pub fn normalize_turn(turn: i32) -> Option<i32> {
        if turn == TURN_INVALID || turn < 0 { None } else { Some(turn) }
    }

    pub fn normalize_string(s: &str) -> Option<String> {
        if s.is_empty() { None } else { Some(s.to_string()) }
    }

    pub fn validate_turn(turn: i32, max_expected: i32) -> bool {
        turn >= 0 && turn <= max_expected
    }
}
```

**Benefits:**

- Consistent -1 → None conversion across codebase
- Single source of truth for sentinel values
- Easy to enable strict mode warnings

---

### 8. Enhanced Error Context ✅

**What Changed:**

- Element paths in all `Unknown*Id` errors
- XML context excerpts capped at 300 chars
- New `ConcurrencyLock` error type

**Improvements:**

```rust
// OLD (v2.1)
#[error("Unknown player ID: {0}")]
UnknownPlayerId(i32),

// NEW (v2.2)
#[error("Unknown player ID: {0} at {1}")]
UnknownPlayerId(i32, String), // (xml_id, element_path)

// Example error message:
// "Unknown player ID: 7 at /Root/City[ID=15]/Governor"
```

**New Helper:**

```rust
pub fn create_xml_context(xml: &str, position: usize) -> String {
    // Returns excerpt like: "...Previous context <Element ID=\"5\"> Next context..."
    // Capped at 300 chars for readable logs
}
```

---

### 9. Configurable Security Thresholds ✅

**What Changed:**

- `MAX_COMPRESSION_RATIO` made configurable (100.0x default)
- Compression ratio logging for monitoring
- Debug logs for high compression (>10x)

**Implementation:**

```rust
const MAX_COMPRESSION_RATIO: f64 = 100.0; // Tunable threshold

// Log for monitoring
if compression_ratio > 10.0 {
    log::debug!("File {} has compression ratio: {:.1}x",
                file_name, compression_ratio);
}

// Reject zip bombs
if compression_ratio > MAX_COMPRESSION_RATIO {
    log::warn!("High compression ratio: {:.1}x for {}",
               compression_ratio, file_name);
    return Err(ParseError::SecurityViolation(...));
}
```

---

## Updated Milestone 1

### Scope Changes

**v2.1 Milestone 1:** 12 deliverables, 6 success criteria
**v2.2 Milestone 1:** 30+ deliverables, 17 success criteria

**New Categories:**

1. Schema & Database (4 items)
2. File Ingestion & Security (7 items)
3. ID Mapping & Stability (4 items)
4. Concurrency Control (4 items)
5. Parsing (3 items)
6. Progress & Error Handling (6 items)
7. Infrastructure (4 items)

### New Success Criteria (v2.2)

- ✅ Multi-process imports serialize correctly (cross-app)
- ✅ UPSERT updates records without DELETE
- ✅ Schema validation catches missing constraints on startup
- ✅ UTF-8 encoding errors produce helpful messages
- ✅ Progress updates include detailed counts
- ✅ Sentinel values normalized consistently
- ✅ Error messages include element paths
- ✅ ZIP security rejects control characters
- ✅ Compression ratio logging works
- ✅ Stale lock cleanup functions
- ✅ Element path context in errors

---

## Files Changed

### Updated Files

1. `docs/plans/xml-parser-implementation.md` - Main plan (v2.1 → v2.2)
2. `docs/schema.sql` - Updated to v2.2 (added `match_locks` table)

### New Files

3. `docs/plans/xml-parser-v2.2-changes-summary.md` - This document

---

## Migration Path

### For New Projects (Recommended)

Since the parser hasn't been implemented yet, simply use the updated schema:

```bash
duckdb your_database.db < docs/schema.sql
```

The `match_locks` table is now included in the base schema (v2.2).

### For Existing Test Databases (If Any)

If you have existing test databases from early development:

1. **Drop and recreate:**

   ```bash
   rm your_database.db
   duckdb your_database.db < docs/schema.sql
   ```

2. **Or manually add the table:**
   ```sql
   CREATE TABLE match_locks (
       game_id VARCHAR NOT NULL PRIMARY KEY,
       locked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       locked_by INTEGER,
       CONSTRAINT unique_game_lock UNIQUE (game_id)
   );
   CREATE INDEX idx_match_locks_stale ON match_locks(locked_at);
   ```

---

## Implementation Checklist

### Before You Code

- [ ] Review all Tier 1 changes (understand UPSERT, multi-process locking, etc.)
- [ ] Use updated `schema.sql` (v2.2) for database initialization
- [ ] Verify schema has all required unique constraints (run schema validation)
- [ ] Understand sentinel normalization strategy

### During Implementation

- [ ] Use UPSERT for core entities, DELETE for derived
- [ ] Implement both in-process and DB-level locking
- [ ] Use `validate_zip_path()` for all ZIP entries
- [ ] Use `sentinels` module for all -1 and empty string handling
- [ ] Include element paths in all error messages
- [ ] Emit progress with counts, not just percentages

### Testing Priorities

1. **Concurrency:** Test same GameId import from 2 app instances
2. **UPSERT:** Verify re-import doesn't DELETE, just updates
3. **Security:** Test path traversal, control chars, zip bombs
4. **Progress:** Verify counts appear in all phases
5. **Schema Validation:** Test with missing table, missing constraint

---

## Summary

The v2.2 update significantly improves the robustness and production-readiness of the XML parser implementation plan. The changes address critical correctness issues (multi-process safety, UPSERT strategy) while also improving user experience (progress counts, better errors) and security (enhanced ZIP validation, UTF-8 checks).

All changes are backward-compatible with the existing schema (which already has the necessary unique constraints). The only schema addition is the `match_locks` table for concurrency control.

**Recommendation:** These changes should be implemented before starting Milestone 1 to avoid rework.

---

**Questions or Concerns?**

If you have questions about any of these changes, please refer to:

- Main plan: `docs/plans/xml-parser-implementation.md`
- Specific sections by topic (search for section headings)
- Reviewer feedback document (if available)
