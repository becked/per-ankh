# Schema Fix: Composite Primary Keys for Multi-Match Support

**Date:** 2025-11-06
**Status:** Critical - Blocks multi-match imports
**Priority:** High

## Problem Statement

The current database schema prevents importing multiple game saves (matches) into the same database due to PRIMARY KEY conflicts. Several entity tables use single-column PRIMARY KEYs (e.g., `family_id`, `religion_id`) instead of composite keys that include `match_id`. When importing a second match, the IdMapper generates IDs starting from 1 for each entity type, causing PRIMARY KEY violations with existing data.

### Example Error

```
Database error: Constraint Error: Violates foreign key constraint because key
"character_id: 70, match_id: 1" is still referenced by a foreign key in a
different table.
```

This occurs because UPDATE statements were missing `match_id` in WHERE clauses, attempting to update rows across all matches instead of just the current match.

## Root Cause Analysis

### Issue 1: Single-Column PRIMARY KEYs

The following tables use single-column PRIMARY KEYs when they should use composite `(id, match_id)` keys:

1. **families**: `family_id BIGINT NOT NULL PRIMARY KEY`
2. **religions**: `religion_id BIGINT NOT NULL PRIMARY KEY`
3. **missions** (if exists): `mission_id BIGINT NOT NULL PRIMARY KEY`
4. **city_production_queue**: `queue_id BIGINT NOT NULL PRIMARY KEY`
5. **tile_changes**: `change_id BIGINT NOT NULL PRIMARY KEY`
6. **player_goals**: `goal_id BIGINT NOT NULL PRIMARY KEY`
7. **event_logs**: `log_id BIGINT NOT NULL PRIMARY KEY`
8. **event_stories**: `event_id BIGINT NOT NULL PRIMARY KEY`
9. **event_story_outcomes**: `outcome_id BIGINT NOT NULL PRIMARY KEY`
10. **memory_data**: `memory_id BIGINT NOT NULL PRIMARY KEY`

### Issue 2: Missing match_id in UPDATE/UPSERT Statements

Several parsers had SQL statements that didn't properly scope operations to the current match:

1. **character_data.rs** (FIXED):
   - `parse_character_parent_relationships`: UPDATE lacked `AND match_id = ?`
   - `parse_character_birth_city`: UPDATE lacked `AND match_id = ?`

2. **religions.rs** (FIXED):
   - Used `ON CONFLICT (religion_id)` instead of proper composite key conflict resolution

## Correctly Designed Tables

These tables already use composite PRIMARY KEYs and serve as reference examples:

```sql
-- Good: Composite primary key
CREATE TABLE players (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    PRIMARY KEY (player_id, match_id),
    ...
);

CREATE TABLE characters (
    character_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    PRIMARY KEY (character_id, match_id),
    ...
);

CREATE TABLE cities (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    PRIMARY KEY (city_id, match_id),
    ...
);

CREATE TABLE tiles (
    tile_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    PRIMARY KEY (tile_id, match_id),
    ...
);

CREATE TABLE tribes (
    tribe_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    PRIMARY KEY (tribe_id, match_id),
    ...
);
```

## Solution Methodology

### Phase 1: Schema Updates

For each affected table, change from single-column PRIMARY KEY to composite PRIMARY KEY:

#### Before (families example):
```sql
CREATE TABLE families (
    family_id BIGINT NOT NULL PRIMARY KEY,
    match_id BIGINT NOT NULL,
    xml_id INTEGER,
    player_id INTEGER NOT NULL,
    family_name VARCHAR NOT NULL,
    family_class VARCHAR NOT NULL,
    head_character_id INTEGER,
    seat_city_id INTEGER,
    turns_without_leader INTEGER DEFAULT 0,
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id),
    FOREIGN KEY (head_character_id, match_id) REFERENCES characters(character_id, match_id)
);
```

#### After:
```sql
CREATE TABLE families (
    family_id INTEGER NOT NULL,  -- Changed from BIGINT to INTEGER for consistency
    match_id BIGINT NOT NULL,
    xml_id INTEGER,
    player_id INTEGER NOT NULL,
    family_name VARCHAR NOT NULL,
    family_class VARCHAR NOT NULL,
    head_character_id INTEGER,
    seat_city_id INTEGER,
    turns_without_leader INTEGER DEFAULT 0,
    PRIMARY KEY (family_id, match_id),  -- COMPOSITE KEY
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id),
    FOREIGN KEY (head_character_id, match_id) REFERENCES characters(character_id, match_id)
);
```

**Key Changes:**
1. Change PRIMARY KEY from single column to `(id, match_id)`
2. Change id column type from BIGINT to INTEGER (for consistency with other entity tables)
3. Ensure all FOREIGN KEYs that reference this table include both columns

### Phase 2: Update Unique Indexes

The schema.rs file creates unique indexes for XML ID lookups. These need to be updated:

#### Before:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_families_xml_id ON families(match_id, xml_id);
```

This remains correct - the unique constraint is per-match, which is what we want.

### Phase 3: Foreign Key Cascades

Review all foreign keys that reference the affected tables and ensure they use composite keys:

#### Example - family_opinion_history references families:
```sql
-- If there's a FK to families, it should be:
FOREIGN KEY (family_id, match_id) REFERENCES families(family_id, match_id)
```

### Phase 4: Parser Code Updates

For each affected table, verify that INSERT statements include match_id:

```rust
// Good example from families.rs
app.append_row(params![
    db_id,                      // family_id
    id_mapper.match_id,         // match_id  ← CRITICAL
    xml_id,
    player_db_id,
    &family_name,
    // ...
])?;
```

Ensure no UPSERT statements use `ON CONFLICT (id)` - they should either:
1. Use `ON CONFLICT (id, match_id)` for true updates (same match)
2. Remove ON CONFLICT entirely for fresh imports (current approach)

### Phase 5: Query Updates

Search for any SELECT/UPDATE/DELETE queries that filter by entity IDs and ensure they include match_id:

```rust
// Bad - missing match_id
conn.execute(
    "UPDATE families SET head_character_id = ? WHERE family_id = ?",
    params![head_id, family_id],
)?;

// Good - includes match_id
conn.execute(
    "UPDATE families SET head_character_id = ? WHERE family_id = ? AND match_id = ?",
    params![head_id, family_id, match_id],
)?;
```

## Tables Requiring Changes

### Critical (Prevent imports):
1. ✅ **characters** - Already uses composite key `(character_id, match_id)`
2. ✅ **players** - Already uses composite key `(player_id, match_id)`
3. ✅ **cities** - Already uses composite key `(city_id, match_id)`
4. ✅ **tiles** - Already uses composite key `(tile_id, match_id)`
5. ✅ **tribes** - Already uses composite key `(tribe_id, match_id)`
6. ❌ **families** - Needs change to `(family_id, match_id)`
7. ❌ **religions** - Needs change to `(religion_id, match_id)`

### High Priority (Will cause issues soon):
8. ❌ **city_production_queue** - `queue_id BIGINT NOT NULL PRIMARY KEY`
9. ❌ **tile_changes** - `change_id BIGINT NOT NULL PRIMARY KEY`
10. ❌ **player_goals** - `goal_id BIGINT NOT NULL PRIMARY KEY`
11. ❌ **event_logs** - `log_id BIGINT NOT NULL PRIMARY KEY`
12. ❌ **event_stories** - `event_id BIGINT NOT NULL PRIMARY KEY`
13. ❌ **memory_data** - `memory_id BIGINT NOT NULL PRIMARY KEY`

### Lower Priority (Less commonly used):
14. ❌ **event_story_outcomes** - `outcome_id BIGINT NOT NULL PRIMARY KEY`
15. **match_settings** - `setting_id BIGINT NOT NULL PRIMARY KEY` (may be OK as global)
16. **matches** - `match_id BIGINT NOT NULL PRIMARY KEY` (correct - matches are top-level)

## Implementation Plan

### Step 1: Update docs/schema.sql

For each affected table:
1. Change PRIMARY KEY to composite `(id, match_id)`
2. Change id type from BIGINT to INTEGER if needed
3. Review and update any FKs that reference this table
4. Add comments explaining the composite key design

### Step 2: Update src-tauri/src/db/schema.rs

The schema.rs file reads schema.sql and applies it. Verify:
1. The unique index creation logic handles composite keys correctly
2. Any schema validation code accounts for composite keys

### Step 3: Test Schema Migration

```bash
# Delete existing database
rm src-tauri/per-ankh.db

# Import first save
cargo run --example import_save -- test-data/saves/OW-Aksum-Year120-2025-07-30-23-03-55.zip

# Import second save (should succeed)
cargo run --example import_save -- test-data/saves/OW-Babylonia-Year123-2024-01-31-22-44-04.zip

# Verify both matches exist
sqlite3 src-tauri/per-ankh.db "SELECT match_id, game_id, total_turns FROM matches;"
```

### Step 4: Update Parsers

Search codebase for:
```bash
# Find potential issues
grep -r "ON CONFLICT" src-tauri/src/parser/entities/
grep -r "UPDATE.*WHERE.*_id = ?" src-tauri/src/parser/entities/
```

Review each instance and ensure match_id is properly included.

### Step 5: Integration Testing

Test importing:
1. Single save file (match_id = 1)
2. Second save file (match_id = 2)
3. Third save file with same GameId but different turn (match_id = 3)
4. Verify data isolation between matches
5. Run queries that join across matches to ensure composite keys work

## Data Type Consistency

Current inconsistency in entity ID types:
- Most entities: `INTEGER` (players, characters, cities, tiles, tribes)
- Some entities: `BIGINT` (families, religions, various auto-generated IDs)

**Recommendation:** Standardize on INTEGER for per-match entity IDs:
- Sufficient range: -2,147,483,648 to 2,147,483,647
- Each match gets independent ID sequences starting from 1
- Only `match_id` should be BIGINT (global counter)

## Testing Checklist

- [ ] Schema applies cleanly to fresh database
- [ ] First save imports successfully
- [ ] Second save imports successfully
- [ ] Third save (different GameId) imports successfully
- [ ] Data is properly isolated by match_id
- [ ] Foreign keys work correctly with composite keys
- [ ] Queries filter correctly by match_id
- [ ] No PRIMARY KEY violations
- [ ] No FOREIGN KEY violations
- [ ] IdMapper generates correct IDs for each match

## References

### Already Fixed Issues

1. **character_data.rs:328** - Added `AND match_id = ?` to parent relationships UPDATE
2. **character_data.rs:370** - Added `AND match_id = ?` to birth city UPDATE
3. **religions.rs:110** - Removed incorrect UPSERT `ON CONFLICT (religion_id)`

### Related Files

- `docs/schema.sql` - Main schema definition
- `src-tauri/src/db/schema.rs` - Schema initialization
- `src-tauri/src/parser/id_mapper.rs` - ID generation logic
- `src-tauri/src/parser/entities/*.rs` - Entity parsers

## Design Principles

1. **Match Isolation**: All entity IDs must be scoped to a specific match via composite PRIMARY KEY
2. **ID Sequence Independence**: Each match gets its own ID sequences starting from 1
3. **Foreign Key Consistency**: All FKs must reference both entity_id and match_id
4. **Query Safety**: All WHERE clauses must include match_id when filtering by entity ID
5. **Type Consistency**: Use INTEGER for per-match entities, BIGINT only for global counters

## Success Criteria

1. Multiple game saves can be imported into the same database without conflicts
2. Each match maintains independent ID sequences (1, 2, 3, ...)
3. Queries correctly isolate data by match_id
4. Foreign key relationships work across matches (e.g., match_id in players references matches)
5. All integration tests pass with multiple matches in database
