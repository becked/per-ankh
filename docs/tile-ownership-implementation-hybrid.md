# Tile Ownership Implementation - Hybrid Approach

**Date:** November 6, 2025
**Status:** Implemented (requires deduplication fix)

## Overview

This document describes the hybrid approach to tile ownership tracking that combines specialized ownership history with the existing generic tile_changes table.

## Problem Statement

The original parser was looking for non-existent XML elements:

- `<OwnerPlayer>` - does not exist in XML
- `<OwnerCity>` - does not exist in XML

As a result, the `owner_player_id` and `owner_city_id` columns in the `tiles` table were always NULL.

**Actual XML Structure:**

```xml
<Tile ID="100">
  <CityTerritory>23</CityTerritory>  <!-- Which city owns this tile -->
  <OwnerHistory>
    <T36>0</T36>   <!-- Turn 36: player 0 took ownership -->
    <T70>1</T70>   <!-- Turn 70: player 1 conquered it -->
    <T95>-1</T95>  <!-- Turn 95: became unowned -->
  </OwnerHistory>
</Tile>
```

## Solution Architecture

### Hybrid Approach Components

**1. Specialized Ownership Tracking**

- New `tile_ownership_history` table for ownership data
- Proper INTEGER type with foreign key validation
- Optimized indexes for territorial expansion queries
- Current ownership stored in `tiles` table

**2. Generic Change Tracking**

- Keep existing `tile_changes` table for terrain/vegetation
- Remove ownership parsing from `tile_data.rs`
- Maintain unified audit log for non-ownership changes

### Schema

#### New Table: tile_ownership_history

```sql
CREATE TABLE tile_ownership_history (
    tile_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    owner_player_id INTEGER,  -- NULL if unowned (-1 in XML)
    PRIMARY KEY (tile_id, match_id, turn),
    FOREIGN KEY (tile_id, match_id) REFERENCES tiles(tile_id, match_id),
    FOREIGN KEY (owner_player_id, match_id) REFERENCES players(player_id, match_id)
);

-- Optimized indexes for common queries
CREATE INDEX idx_tile_ownership_history_lookup
    ON tile_ownership_history(match_id, turn);
CREATE INDEX idx_tile_ownership_history_player
    ON tile_ownership_history(owner_player_id, match_id)
    WHERE owner_player_id IS NOT NULL;
```

#### Updated: tiles table

```sql
-- Current ownership columns (previously always NULL)
owner_player_id INTEGER,  -- Derived from latest OwnerHistory entry
owner_city_id INTEGER,    -- Parsed from CityTerritory element
```

#### Unchanged: tile_changes table

```sql
-- Continues to track terrain and vegetation changes
CREATE TABLE tile_changes (
    change_id INTEGER NOT NULL,
    tile_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    change_type VARCHAR NOT NULL,  -- 'terrain', 'vegetation' (no longer 'owner')
    old_value VARCHAR,
    new_value VARCHAR,
    PRIMARY KEY (change_id, match_id)
);
```

## Implementation Details

### XML Parsing (src-tauri/src/parser/entities/tiles.rs)

**City Ownership:**

```rust
// Parse CityTerritory element
let owner_city_xml_id = tile_node
    .opt_child_text("CityTerritory")
    .and_then(|s| s.parse::<i32>().ok());
let owner_city_db_id = match owner_city_xml_id {
    Some(id) => Some(id_mapper.map_city(id)),
    None => None,
};
```

**Player Ownership:**

```rust
// Parse OwnerHistory and derive current owner
let mut owner_player_db_id = None;
if let Some(history_node) = tile_node.children().find(|n| n.has_tag_name("OwnerHistory")) {
    let mut max_turn = -1;
    let mut latest_owner_xml_id = None;

    for turn_node in history_node.children() {
        if let Some(tag_name) = turn_node.tag_name().name().strip_prefix('T') {
            if let Ok(turn) = tag_name.parse::<i32>() {
                if let Some(text) = turn_node.text() {
                    if let Ok(owner_xml_id) = text.parse::<i32>() {
                        // Track latest ownership change
                        if turn > max_turn {
                            max_turn = turn;
                            latest_owner_xml_id = Some(owner_xml_id);
                        }

                        // Insert into ownership history (-1 means unowned)
                        let owner_db_id = if owner_xml_id >= 0 {
                            Some(id_mapper.get_player(owner_xml_id)?)
                        } else {
                            None
                        };

                        ownership_app.append_row(params![
                            db_id,              // tile_id
                            id_mapper.match_id, // match_id
                            turn,               // turn
                            owner_db_id,        // owner_player_id (NULL if -1)
                        ])?;
                    }
                }
            }
        }
    }

    // Set current owner from latest history entry
    if let Some(owner_xml_id) = latest_owner_xml_id {
        if owner_xml_id >= 0 {
            owner_player_db_id = Some(id_mapper.get_player(owner_xml_id)?);
        }
    }
}
```

### Required Code Changes

**1. Remove Duplicate Parsing (src-tauri/src/parser/entities/tile_data.rs)**

Delete lines 142-170 that parse OwnerHistory into tile_changes:

```rust
// DELETE THIS SECTION:
// Parse OwnerHistory
if let Some(owner_history) = tile_node
    .children()
    .find(|n| n.has_tag_name("OwnerHistory"))
{
    for turn_node in owner_history.children().filter(|n| n.is_element()) {
        // ... ownership parsing code ...
        conn.execute(
            "INSERT INTO tile_changes
             (change_id, tile_id, match_id, turn, change_type, old_value, new_value)
             VALUES (?, ?, ?, ?, 'owner', NULL, ?)",
            // ...
        )?;
    }
}
```

**2. Update Documentation**

Update `tile_data.rs` module documentation to clarify it no longer handles ownership:

```rust
// Tile extended data parsers
//
// This module handles parsing of tile-specific nested data:
// - Tile visibility (RevealedTurn, RevealedOwner) -> tile_visibility table
// - Tile terrain history (TerrainHistory) -> tile_changes table
// - Tile vegetation history (VegetationHistory) -> tile_changes table
//
// NOTE: Ownership history is handled by tiles.rs -> tile_ownership_history table
```

## Benefits of Hybrid Approach

### Advantages

**1. Optimized Ownership Queries**

```sql
-- Fast territorial expansion analysis
SELECT
    owner_player_id,
    COUNT(*) as tiles_controlled,
    turn
FROM tile_ownership_history
WHERE match_id = 1
  AND owner_player_id IS NOT NULL
GROUP BY owner_player_id, turn
ORDER BY turn;
```

**2. Proper Type Safety**

- `owner_player_id INTEGER` with foreign key validation
- NULL for unowned tiles (semantic meaning)
- No string parsing required

**3. Minimal Disruption**

- Keep existing terrain/vegetation tracking
- No need to migrate existing tile_changes data
- Single focused change

**4. Best of Both Worlds**

- Specialized table for high-value ownership analytics
- Generic table for less-critical terrain/vegetation changes
- Follows principle of optimizing what matters most

### Trade-offs vs Full Normalization (Option B)

| Aspect             | Hybrid                                   | Full Normalization                                                        |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------- |
| Tables             | 2 (tile_ownership_history, tile_changes) | 3 (tile_ownership_history, tile_terrain_history, tile_vegetation_history) |
| Query Performance  | Excellent for ownership, good for others | Excellent for all                                                         |
| Code Complexity    | Low (minimal changes)                    | Medium (3 parsers to update)                                              |
| Schema Consistency | Mixed (specialized + generic)            | Fully normalized                                                          |
| Migration Effort   | Low                                      | Medium-High                                                               |

## Testing

### Test Results (2024 Save File)

**Before Fix:**

- `tiles.owner_player_id`: All NULL ❌
- `tiles.owner_city_id`: All NULL ❌
- `tile_changes` ownership records: 2,201 ✅

**After Implementation:**

- `tiles.owner_player_id`: Populated ✅
- `tiles.owner_city_id`: Populated ✅
- `tile_ownership_history` records: 2,201 ✅
- `tile_changes` ownership records: **0** (deduplicated) ✅

### Validation Queries

```sql
-- Check current ownership is populated
SELECT COUNT(*)
FROM tiles
WHERE match_id = 1
  AND owner_player_id IS NOT NULL;

-- Check ownership history is complete
SELECT COUNT(*)
FROM tile_ownership_history
WHERE match_id = 1;

-- Verify no ownership entries in tile_changes
SELECT COUNT(*)
FROM tile_changes
WHERE match_id = 1
  AND change_type = 'owner';  -- Should be 0
```

## Example Queries

### Current Ownership

```sql
-- All tiles owned by a player
SELECT t.tile_id, t.x, t.y, t.terrain
FROM tiles t
WHERE t.match_id = 1
  AND t.owner_player_id = 0;  -- Player 0's current tiles
```

### Ownership History

```sql
-- Territorial expansion timeline for player 0
SELECT
    turn,
    COUNT(*) as tiles_owned
FROM tile_ownership_history
WHERE match_id = 1
  AND owner_player_id = 0
GROUP BY turn
ORDER BY turn;
```

### Conquest Detection

```sql
-- Find tiles that changed ownership (conquest events)
WITH ownership_changes AS (
    SELECT
        tile_id,
        turn,
        owner_player_id,
        LAG(owner_player_id) OVER (PARTITION BY tile_id ORDER BY turn) as prev_owner
    FROM tile_ownership_history
    WHERE match_id = 1
)
SELECT
    tile_id,
    turn as conquest_turn,
    prev_owner as conquered_from,
    owner_player_id as conquered_by
FROM ownership_changes
WHERE prev_owner IS DISTINCT FROM owner_player_id
  AND prev_owner IS NOT NULL  -- Only count conquests, not initial claims
ORDER BY turn;
```

### Territory Control Over Time

```sql
-- Territory size by player per turn
SELECT
    turn,
    owner_player_id,
    COUNT(*) as territory_size
FROM tile_ownership_history
WHERE match_id = 1
  AND owner_player_id IS NOT NULL
GROUP BY turn, owner_player_id
ORDER BY turn, owner_player_id;
```

## Backward Compatibility

### Migration for Existing Databases

If tile_changes already contains ownership data:

```sql
-- Optional: Migrate existing ownership data
INSERT INTO tile_ownership_history (tile_id, match_id, turn, owner_player_id)
SELECT
    tile_id,
    match_id,
    turn,
    CASE
        WHEN new_value = '-1' THEN NULL
        ELSE CAST(new_value AS INTEGER)
    END as owner_player_id
FROM tile_changes
WHERE change_type = 'owner';

-- Remove ownership entries from tile_changes
DELETE FROM tile_changes WHERE change_type = 'owner';
```

## Future Enhancements

If terrain/vegetation queries become performance-critical, consider:

1. **Create tile_terrain_history** (separate table)
2. **Create tile_vegetation_history** (separate table)
3. **Deprecate tile_changes** (full Option B normalization)

See `tile-ownership-option-b-assessment.md` for full normalization analysis.

## References

- Task document: `docs/next-parser-tasks.md` (Task #5)
- Schema: `docs/schema.sql`
- Parser code: `src-tauri/src/parser/entities/tiles.rs`
- Existing tile data parser: `src-tauri/src/parser/entities/tile_data.rs`
- External project recommendation: Confirmed that specialized ownership table with OwnerHistory parsing is preferred approach for analytics
