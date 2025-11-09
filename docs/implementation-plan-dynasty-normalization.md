# Implementation Plan: Parse-Time Dynasty Normalization

**Date**: 2025-11-09
**Status**: READY FOR IMPLEMENTATION
**Priority**: Medium
**Estimated Effort**: 4-6 hours

## Table of Contents

1. [Background](#background)
2. [Investigation Results](#investigation-results)
3. [Implementation Strategy](#implementation-strategy)
4. [Detailed Implementation Steps](#detailed-implementation-steps)
5. [Testing Plan](#testing-plan)
6. [Rollback Plan](#rollback-plan)
7. [Success Criteria](#success-criteria)

---

## Background

### Problem Statement

Greek successor dynasties (Diadochi) appear as separate nations in statistics and charts instead of being grouped under their parent civilization (Greece):

- `NATION_SELEUCUS` → should display as `NATION_GREECE`
- `NATION_ANTIGONUS` → should display as `NATION_GREECE`
- `NATION_PTOLEMY` → should display as `NATION_GREECE` (Macedonian/Greek dynasty ruling Egypt)

This fragments Greece statistics across multiple chart bars.

### Previous Attempt

A parse-time normalization was attempted on 2025-11-09 but resulted in data corruption:
- 2 saves imported successfully (per logs)
- Only 1 game appeared in UI
- Statistics showed "Games Played: 1" while chart displayed 3 nations
- Clear data inconsistency

**The attempt was reverted**, and the code currently reads nation/dynasty values without normalization (`src-tauri/src/parser/entities/players.rs:23-24`).

### Why It Matters

This plan represents a second attempt with **extensive logging** to diagnose and prevent the previous failure mode.

---

## Investigation Results

### Save File Format Analysis

**Analysis Date**: 2025-11-09
**Files Analyzed**: 266 save files (Jan 2022 - Nov 2025)
**Tool**: `scripts/analyze_dynasty_format.py`

**Key Finding: Format is Consistent**

- Only 1/266 saves contains Diadochi players
- All Diadochi use **legacy format** (separate nations)
- **No format evolution detected** across 3+ years
- Dynasty attribute is always `None` or empty string for Diadochi

**Example from `OW-Seleucid Empire-Year65-2025-08-05-00-10-04.zip`**:
```xml
<Player ID="0" Name="Ptolemy Soter" Nation="NATION_PTOLEMY" Dynasty="" />
<Player ID="1" Name="Seleucus Nicator" Nation="NATION_SELEUCUS" Dynasty="" />
<Player ID="2" Name="Antigonus Monophthalmus" Nation="NATION_ANTIGONUS" Dynasty="" />
```

**Note**: All three are Greek (Macedonian) generals. The Ptolemies ruled Egypt but were ethnically Greek.

**Conclusion**: The previous failure was **NOT** due to format ambiguity. All saves can safely be normalized.

---

## Implementation Strategy

### Core Principle: Defense in Depth

This implementation prioritizes **observability** over brevity:

1. **Extensive Logging**: Log every normalization decision and context
2. **Validation Checks**: Verify data integrity at multiple stages
3. **Performance Exception**: Duplicate some logging to avoid function call overhead (acceptable YAGNI violation)
4. **Atomic Commits**: Commit after each logical step for easy rollback

### Normalization Rules

```rust
NATION_SELEUCUS  → nation: NATION_GREECE, dynasty: DYNASTY_SELEUCID
NATION_ANTIGONUS → nation: NATION_GREECE, dynasty: DYNASTY_ANTIGONID
NATION_PTOLEMY   → nation: NATION_GREECE, dynasty: DYNASTY_PTOLEMY
```

**Note**: All three Diadochi normalize to Greece, as they were Macedonian/Greek generals who founded dynasties after Alexander's death. The Ptolemaic dynasty ruled Egypt but were ethnically Greek.

### Why Parse-Time (Not Query-Time)

1. **No format ambiguity**: Investigation proved all saves use the same format
2. **Clean data**: Database stores semantically correct values
3. **Performance**: No query overhead
4. **Simplicity**: Normalization logic in one place

---

## Detailed Implementation Steps

### Step 1: Add Normalization Function with Logging

**File**: `src-tauri/src/parser/entities/players.rs`
**Location**: Before `parse_players` function

```rust
/// Normalize Diadochi (Greek successor) dynasties encoded as nations
///
/// Old World encodes Greek/Egyptian successor states as separate nations.
/// This function normalizes them to their parent civilizations with proper dynasties.
///
/// Normalization Rules:
/// - NATION_ANTIGONUS → NATION_GREECE + DYNASTY_ANTIGONID
/// - NATION_SELEUCUS  → NATION_GREECE + DYNASTY_SELEUCID
/// - NATION_PTOLEMY   → NATION_GREECE + DYNASTY_PTOLEMY
///
/// Returns: (normalized_nation, normalized_dynasty, was_normalized)
fn normalize_nation_dynasty(
    nation: Option<String>,
    dynasty: Option<String>,
    player_xml_id: i32,
    player_name: &str,
) -> (Option<String>, Option<String>, bool) {
    match nation.as_deref() {
        Some("NATION_ANTIGONUS") => {
            log::info!(
                "Normalizing Diadochi player: xml_id={}, name='{}', NATION_ANTIGONUS → NATION_GREECE + DYNASTY_ANTIGONID",
                player_xml_id, player_name
            );
            (
                Some("NATION_GREECE".to_string()),
                Some("DYNASTY_ANTIGONID".to_string()),
                true
            )
        },
        Some("NATION_SELEUCUS") => {
            log::info!(
                "Normalizing Diadochi player: xml_id={}, name='{}', NATION_SELEUCUS → NATION_GREECE + DYNASTY_SELEUCID",
                player_xml_id, player_name
            );
            (
                Some("NATION_GREECE".to_string()),
                Some("DYNASTY_SELEUCID".to_string()),
                true
            )
        },
        Some("NATION_PTOLEMY") => {
            log::info!(
                "Normalizing Diadochi player: xml_id={}, name='{}', NATION_PTOLEMY → NATION_GREECE + DYNASTY_PTOLEMY",
                player_xml_id, player_name
            );
            (
                Some("NATION_GREECE".to_string()),
                Some("DYNASTY_PTOLEMY".to_string()),
                true
            )
        },
        _ => {
            // No normalization needed
            (nation, dynasty, false)
        }
    }
}
```

**Commit Message**: `feat: add dynasty normalization function with detailed logging`

---

### Step 2: Apply Normalization in Parse Loop

**File**: `src-tauri/src/parser/entities/players.rs`
**Location**: In `parse_players` function, replace lines 23-24

**Before**:
```rust
let nation = player_node.opt_attr("Nation").map(|s| s.to_string());
let dynasty = player_node.opt_attr("Dynasty").map(|s| s.to_string());
```

**After**:
```rust
// Read raw values from XML
let raw_nation = player_node.opt_attr("Nation").map(|s| s.to_string());
let raw_dynasty = player_node.opt_attr("Dynasty").map(|s| s.to_string());

// Apply Diadochi normalization
let (nation, dynasty, was_normalized) = normalize_nation_dynasty(
    raw_nation.clone(),
    raw_dynasty.clone(),
    xml_id,
    &player_name,
);

// Log original values if normalization occurred (for debugging)
if was_normalized {
    log::debug!(
        "Player {} (xml_id={}): raw_nation={:?}, raw_dynasty={:?} → normalized_nation={:?}, normalized_dynasty={:?}",
        player_name, xml_id, raw_nation, raw_dynasty, nation, dynasty
    );
}
```

**Commit Message**: `feat: apply dynasty normalization during player parsing`

---

### Step 3: Add Deduplication Logging

**File**: `src-tauri/src/parser/entities/players.rs`
**Location**: After `deduplicate_rows_last_wins` call (line ~130)

```rust
// Deduplicate (last-wins strategy)
// Primary key: (player_id, match_id)
let players_before_dedup = players.len();
let unique_players = deduplicate_rows_last_wins(
    players,
    |(player_id, match_id, ..)| (*player_id, *match_id)
);
let players_after_dedup = unique_players.len();

log::info!(
    "Player deduplication: {} players → {} unique players ({} duplicates removed)",
    players_before_dedup,
    players_after_dedup,
    players_before_dedup - players_after_dedup
);

if players_before_dedup > players_after_dedup {
    log::warn!(
        "Deduplication removed {} player records. This may indicate duplicate player IDs in the save file.",
        players_before_dedup - players_after_dedup
    );
}
```

**Commit Message**: `feat: add deduplication logging for player records`

---

### Step 4: Add Database Insertion Logging

**File**: `src-tauri/src/parser/entities/players.rs`
**Location**: After appender flush (line ~152)

```rust
// Flush appender to commit all rows
drop(app);

log::info!("Parsed {} players", count);

// Log summary of normalized players (if any)
let normalized_count = unique_players.iter().filter(|(_, _, _, _, _, nation, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _)| {
    matches!(nation.as_deref(), Some("NATION_GREECE") | Some("NATION_EGYPT"))
}).count();

if normalized_count > 0 {
    log::info!(
        "Dynasty normalization applied to {} players (Greece/Egypt with Diadochi dynasties)",
        normalized_count
    );
}

Ok(count)
```

**Note**: This logging is intentionally verbose (violates DRY) for debugging. It can be simplified after successful deployment.

**Commit Message**: `feat: add database insertion logging for normalized players`

---

### Step 5: Add Match-Level Validation

**File**: `src-tauri/src/lib.rs`
**Location**: In `import_save_file` function, after player parsing

```rust
// Parse players
let player_count = players::parse_players(&doc, &conn, &mut id_mapper)
    .context("Failed to parse players")?;

// Validation: Check that player count matches expected
let db_player_count: i64 = conn
    .query_row(
        "SELECT COUNT(*) FROM players WHERE match_id = ?",
        [id_mapper.match_id],
        |row| row.get(0),
    )
    .context("Failed to validate player count")?;

if db_player_count != player_count as i64 {
    log::error!(
        "Player count mismatch! Parsed {} players but database contains {} for match_id={}",
        player_count, db_player_count, id_mapper.match_id
    );
    return Err(anyhow::anyhow!(
        "Data corruption detected: player count mismatch ({} parsed vs {} in DB)",
        player_count, db_player_count
    ));
}

log::info!("Player count validation passed: {} players", player_count);
```

**Commit Message**: `feat: add player count validation after import`

---

### Step 6: Add Post-Import Statistics Logging

**File**: `src-tauri/src/lib.rs`
**Location**: End of `import_save_file` function, before return

```rust
// Log final statistics for this import
let total_matches: i64 = conn
    .query_row("SELECT COUNT(DISTINCT match_id) FROM players", [], |row| row.get(0))
    .context("Failed to query total matches")?;

let total_players: i64 = conn
    .query_row("SELECT COUNT(*) FROM players", [], |row| row.get(0))
    .context("Failed to query total players")?;

log::info!(
    "Import complete. Database now contains {} total matches, {} total players",
    total_matches, total_players
);

// Log Greece player counts (to verify normalization)
let greece_count: i64 = conn
    .query_row(
        "SELECT COUNT(DISTINCT match_id) FROM players WHERE nation = 'NATION_GREECE'",
        [],
        |row| row.get(0)
    )
    .unwrap_or(0);

let diadochi_dynasties: i64 = conn
    .query_row(
        "SELECT COUNT(*) FROM players WHERE dynasty IN ('DYNASTY_SELEUCID', 'DYNASTY_ANTIGONID', 'DYNASTY_PTOLEMY')",
        [],
        |row| row.get(0)
    )
    .unwrap_or(0);

if greece_count > 0 && diadochi_dynasties > 0 {
    log::info!(
        "Normalized nations: {} Greece games with {} Diadochi dynasty players",
        greece_count, diadochi_dynasties
    );
}

log::info!("Successfully imported save: {}", save_path.display());
Ok(())
```

**Commit Message**: `feat: add post-import statistics logging`

---

## Testing Plan

### Test Environment Setup

1. **Backup current database**:
   ```bash
   cp "$HOME/Library/Application Support/com.becked.per-ankh/per-ankh.db" \
      "$HOME/Library/Application Support/com.becked.per-ankh/per-ankh.db.backup"
   ```

2. **Enable verbose logging**:
   - Set `RUST_LOG=debug` environment variable
   - Monitor console output during testing

### Test Cases

#### Test 1: Empty Database Import (Baseline)

**Objective**: Verify normalization works on fresh database

**Steps**:
1. Delete existing database
2. Import `test-data/saves/OW-Seleucid Empire-Year65-2025-08-05-00-10-04.zip`
3. Verify logs show:
   - 3 normalization messages (Seleucus, Antigonus, Ptolemy)
   - 0 deduplication removals
   - Player count validation passes
   - Greece games = 1 (containing all 3 Diadochi players)

**Expected Results**:
- Database contains 1 match
- Players table shows `NATION_GREECE` (x3) for all Diadochi
- Dynasty column populated with `DYNASTY_SELEUCID`, `DYNASTY_ANTIGONID`, `DYNASTY_PTOLEMY`
- Charts show all three grouped under Greece

#### Test 2: Re-import Same Save

**Objective**: Verify deduplication works correctly with normalized values

**Steps**:
1. Re-import the same save file
2. Verify logs show:
   - 3 normalization messages again
   - Deduplication may remove duplicates (depends on dedup logic)
   - Still shows 1 match total

**Expected Results**:
- Database still contains only 1 match (not 2)
- No data corruption warnings

#### Test 3: Import Non-Diadochi Save

**Objective**: Verify normalization doesn't affect regular nations

**Steps**:
1. Import any save without Diadochi (e.g., `OW-Rome-Year166-2022-01-11-23-06-07.zip`)
2. Verify logs show:
   - 0 normalization messages
   - Normal import completes

**Expected Results**:
- Regular nations unaffected
- No performance regression

#### Test 4: Mixed Import (Multiple Saves)

**Objective**: Verify normalization works alongside regular imports

**Steps**:
1. Delete database
2. Import 5 regular saves (no Diadochi)
3. Import 1 Diadochi save
4. Import 5 more regular saves
5. Verify final stats show correct counts

**Expected Results**:
- 11 total games
- Greece count includes normalized Diadochi game

#### Test 5: Database Integrity Check

**Objective**: Verify no foreign key violations or orphaned records

**Steps**:
1. After Test 4, run:
   ```sql
   -- Check for orphaned player records
   SELECT COUNT(*) FROM players WHERE match_id NOT IN (SELECT match_id FROM matches);

   -- Check nation distribution
   SELECT nation, COUNT(*) as count FROM players GROUP BY nation ORDER BY count DESC;

   -- Verify dynasty is populated for normalized players
   SELECT nation, dynasty, COUNT(*) FROM players
   WHERE nation = 'NATION_GREECE'
   GROUP BY nation, dynasty;
   ```

**Expected Results**:
- 0 orphaned players
- Greece appears in nation counts with Diadochi dynasties
- Dynasties properly populated (SELEUCID, ANTIGONID, PTOLEMY)

### Performance Testing

**Objective**: Ensure normalization doesn't slow parsing

**Steps**:
1. Import 10 large saves (>500 players each)
2. Compare import time before/after normalization

**Acceptance**: <5% performance regression

---

## Rollback Plan

### If Data Corruption is Detected

**Immediate Actions**:
1. Stop any running imports
2. Restore database from backup:
   ```bash
   cp "$HOME/Library/Application Support/com.becked.per-ankh/per-ankh.db.backup" \
      "$HOME/Library/Application Support/com.becked.per-ankh/per-ankh.db"
   ```
3. Revert commits in reverse order:
   ```bash
   git revert HEAD~6..HEAD  # Revert last 6 commits
   ```

### Root Cause Analysis

**Checklist**:
- [ ] Review all logs for ERROR or WARN messages
- [ ] Check player count mismatches
- [ ] Verify deduplication logic
- [ ] Examine foreign key relationships in schema
- [ ] Test with single Diadochi player (isolate issue)
- [ ] Compare raw XML vs. database values

### Alternative Fallback: Query-Time Normalization

If parse-time proves impossible, fall back to SQL normalization:

```rust
// In get_game_statistics
let mut stmt = conn.prepare("
    SELECT
        CASE
            WHEN nation = 'NATION_ANTIGONUS' THEN 'NATION_GREECE'
            WHEN nation = 'NATION_SELEUCUS' THEN 'NATION_GREECE'
            WHEN nation = 'NATION_PTOLEMY' THEN 'NATION_GREECE'
            ELSE nation
        END as normalized_nation,
        COUNT(DISTINCT match_id) as games_played
    FROM players
    WHERE nation IS NOT NULL
    GROUP BY normalized_nation
    ORDER BY games_played DESC
")?;
```

---

## Success Criteria

### Must Have (Blocking)

- [ ] All 5 test cases pass
- [ ] No player count mismatches logged
- [ ] Charts display combined Greece/Egypt counts
- [ ] Database integrity checks pass
- [ ] No performance regression >5%

### Nice to Have (Non-Blocking)

- [ ] Dynasty column properly populated for all Diadochi
- [ ] Logging is clear and actionable
- [ ] Code is well-documented

### Definition of Done

- [ ] All commits merged to main
- [ ] Documentation updated (this file moved to `docs/completed/`)
- [ ] `docs/greek-dynasty-normalization-issue.md` updated with resolution
- [ ] Analysis script (`scripts/analyze_dynasty_format.py`) kept for future use

---

## Notes for Developer

### Debugging Tips

1. **Enable trace logging**: `RUST_LOG=trace` for maximum verbosity
2. **Use SQLite browser**: Open database directly to inspect values
3. **Compare logs**: Diff successful vs. failed import logs
4. **Test incrementally**: Commit after each step passes tests

### Code Quality Reminders

- Use `anyhow::Context` for error messages
- Follow existing patterns in `players.rs`
- Keep normalization function pure (no side effects)
- Logging can be verbose during initial deployment

### Performance Exceptions

This implementation intentionally:
- Duplicates some logging (YAGNI violation for debugging)
- Includes validation queries (slight performance cost)
- Uses `clone()` for raw values (memory cost)

These are **temporary** and should be optimized after successful deployment if needed.

---

## References

- Save file format analysis: `scripts/analyze_dynasty_format.py`
- Original issue: `docs/greek-dynasty-normalization-issue.md`
- Parser implementation: `src-tauri/src/parser/entities/players.rs`
- Database schema: `docs/schema.sql`

**Last Updated**: 2025-11-09
**Author**: Claude Code Investigation
