# Tile History Normalization - Full Option B Assessment

**Date:** November 6, 2025
**Status:** Assessment / Not Implemented
**Alternative To:** Hybrid approach (implemented)

## Overview

This document assesses the full normalization approach (Option B) where each type of tile history (ownership, terrain, vegetation) gets its own dedicated table, replacing the generic `tile_changes` table entirely.

## Current State

### Generic Audit Log Approach

```sql
CREATE TABLE tile_changes (
    change_id INTEGER NOT NULL,
    tile_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    change_type VARCHAR NOT NULL,  -- 'owner', 'terrain', 'vegetation'
    old_value VARCHAR,               -- All values as strings
    new_value VARCHAR,
    PRIMARY KEY (change_id, match_id),
    FOREIGN KEY (tile_id, match_id) REFERENCES tiles(tile_id, match_id)
);
```

**Issues:**

- All values stored as VARCHAR (type unsafe)
- Must filter by `change_type` for queries
- No foreign key validation on ownership
- Unowned tiles represented as "-1" string
- Generic indexes not optimized for specific queries

## Proposed Full Normalization (Option B)

### Schema Design

```sql
-- Ownership history (properly typed, with FKs)
CREATE TABLE tile_ownership_history (
    tile_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    owner_player_id INTEGER,  -- NULL for unowned, FK to players
    PRIMARY KEY (tile_id, match_id, turn),
    FOREIGN KEY (tile_id, match_id) REFERENCES tiles(tile_id, match_id),
    FOREIGN KEY (owner_player_id, match_id) REFERENCES players(player_id, match_id)
);

-- Terrain history
CREATE TABLE tile_terrain_history (
    tile_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    terrain VARCHAR NOT NULL,  -- TERRAIN_WATER, TERRAIN_TEMPERATE, TERRAIN_ARID, etc.
    PRIMARY KEY (tile_id, match_id, turn),
    FOREIGN KEY (tile_id, match_id) REFERENCES tiles(tile_id, match_id)
);

-- Vegetation history
CREATE TABLE tile_vegetation_history (
    tile_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    vegetation VARCHAR,  -- VEGETATION_TREES, VEGETATION_SCRUB, or NULL (cleared)
    PRIMARY KEY (tile_id, match_id, turn),
    FOREIGN KEY (tile_id, match_id) REFERENCES tiles(tile_id, match_id)
);

-- Optimized indexes for each table
CREATE INDEX idx_tile_ownership_history_lookup
    ON tile_ownership_history(match_id, turn);
CREATE INDEX idx_tile_ownership_history_player
    ON tile_ownership_history(owner_player_id, match_id)
    WHERE owner_player_id IS NOT NULL;

CREATE INDEX idx_tile_terrain_history_lookup
    ON tile_terrain_history(match_id, turn);

CREATE INDEX idx_tile_vegetation_history_lookup
    ON tile_vegetation_history(match_id, turn);
```

## Comparative Analysis

### Query Performance

#### Ownership Query Example

**Current (tile_changes):**

```sql
-- Must filter by change_type, scan all records
SELECT tile_id, turn, new_value as owner_id
FROM tile_changes
WHERE match_id = 1
  AND change_type = 'owner'  -- Not in index, full scan
  AND CAST(new_value AS INTEGER) = 0  -- Type conversion required
ORDER BY turn;

-- Index used: PRIMARY KEY on (change_id, match_id) - not optimal
```

**Option B (tile_ownership_history):**

```sql
-- Direct query with optimized index
SELECT tile_id, turn, owner_player_id
FROM tile_ownership_history
WHERE match_id = 1
  AND owner_player_id = 0  -- Direct INTEGER comparison
ORDER BY turn;

-- Index used: idx_tile_ownership_history_player - optimal
```

**Performance Gain:** Estimated 10-50x faster for ownership queries

#### Terrain Query Example

**Current (tile_changes):**

```sql
-- Filter by change_type
SELECT tile_id, turn, new_value as terrain
FROM tile_changes
WHERE match_id = 1 AND change_type = 'terrain'
ORDER BY turn;
```

**Option B (tile_terrain_history):**

```sql
-- Direct query
SELECT tile_id, turn, terrain
FROM tile_terrain_history
WHERE match_id = 1
ORDER BY turn;
```

**Performance Gain:** Estimated 5-20x faster (smaller table to scan)

### Type Safety Comparison

| Aspect                 | tile_changes             | Option B               |
| ---------------------- | ------------------------ | ---------------------- |
| Owner ID Type          | VARCHAR ("-1", "0", "1") | INTEGER (NULL, 0, 1)   |
| Type Validation        | None                     | Foreign key to players |
| Unowned Representation | String "-1"              | NULL (semantic)        |
| Query Type Casting     | Required                 | Not needed             |
| Index Efficiency       | Poor (VARCHAR)           | Excellent (INTEGER)    |

### Data Integrity

**Current Approach:**

```sql
-- No validation - can insert invalid data
INSERT INTO tile_changes VALUES
    (1, 100, 1, 50, 'owner', NULL, '999');  -- Invalid player ID, no error!
```

**Option B:**

```sql
-- Foreign key prevents invalid data
INSERT INTO tile_ownership_history VALUES
    (100, 1, 50, 999);  -- ERROR: FK constraint violation
```

## Implementation Requirements

### Code Changes

**1. Remove tile_changes Parser (src-tauri/src/parser/entities/tile_data.rs)**

Delete entire `parse_tile_history()` function (lines 133-233).

**2. Create Three New Parsers**

```rust
// src-tauri/src/parser/entities/tiles.rs (ownership - already implemented)
pub fn parse_tile_ownership_history(
    tile_node: &Node,
    ownership_app: &mut Appender,
    tile_id: i64,
    match_id: i64,
    id_mapper: &IdMapper,
) -> Result<usize> {
    // Parse OwnerHistory elements...
}

// src-tauri/src/parser/entities/tile_data.rs (new)
pub fn parse_tile_terrain_history(
    tile_node: &Node,
    conn: &Connection,
    tile_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    if let Some(terrain_history) = tile_node
        .children()
        .find(|n| n.has_tag_name("TerrainHistory"))
    {
        let mut app = conn.appender("tile_terrain_history")?;

        for turn_node in terrain_history.children().filter(|n| n.is_element()) {
            if let Some(turn_str) = turn_node.tag_name().name().strip_prefix('T') {
                let turn: i32 = turn_str.parse()?;
                let terrain = turn_node.text().ok_or(...)?;

                app.append_row(params![tile_id, match_id, turn, terrain])?;
                count += 1;
            }
        }
    }

    Ok(count)
}

pub fn parse_tile_vegetation_history(
    tile_node: &Node,
    conn: &Connection,
    tile_id: i64,
    match_id: i64,
) -> Result<usize> {
    // Similar to terrain...
}
```

**3. Update Import Flow (src-tauri/src/parser/import.rs)**

```rust
// Current
let (visibility_count, history_count) =
    parse_tile_extended_data_all(doc, tx, &id_mapper, &mut next_change_id)?;

// Option B
let (visibility_count, terrain_count, vegetation_count) =
    parse_tile_extended_data_all(doc, tx, &id_mapper)?;
// Ownership already handled in parse_tiles()
```

### Migration Script

```sql
-- Migrate existing data from tile_changes to new tables

-- 1. Migrate ownership data
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

-- 2. Migrate terrain data
INSERT INTO tile_terrain_history (tile_id, match_id, turn, terrain)
SELECT
    tile_id,
    match_id,
    turn,
    new_value as terrain
FROM tile_changes
WHERE change_type = 'terrain';

-- 3. Migrate vegetation data
INSERT INTO tile_vegetation_history (tile_id, match_id, turn, vegetation)
SELECT
    tile_id,
    match_id,
    turn,
    NULLIF(new_value, '') as vegetation  -- Empty string -> NULL
FROM tile_changes
WHERE change_type = 'vegetation';

-- 4. Drop old table
DROP TABLE tile_changes;
```

## Advantages

### 1. Query Performance

**Ownership Expansion Analysis:**

```sql
-- 10-50x faster than tile_changes approach
SELECT
    p.player_name,
    COUNT(*) as territory_size,
    toh.turn
FROM tile_ownership_history toh
JOIN players p ON toh.owner_player_id = p.player_id AND toh.match_id = p.match_id
WHERE toh.match_id = 1
GROUP BY p.player_name, toh.turn
ORDER BY toh.turn;
```

**Terrain Transformation Analysis:**

```sql
-- Fast direct query, no filtering needed
SELECT terrain, COUNT(*) as change_count
FROM tile_terrain_history
WHERE match_id = 1
GROUP BY terrain;
```

### 2. Schema Clarity

Each table is self-documenting:

- `tile_ownership_history` - obviously stores ownership
- `tile_terrain_history` - obviously stores terrain
- `tile_vegetation_history` - obviously stores vegetation

No need to check `change_type` values or query metadata.

### 3. Type Safety

```sql
-- Strong typing prevents errors
ALTER TABLE tile_ownership_history
    ADD CONSTRAINT check_valid_owner
    CHECK (owner_player_id >= 0 OR owner_player_id IS NULL);

-- Can't do this with VARCHAR in tile_changes
```

### 4. Optimized Indexes

Each table gets indexes tailored to its access patterns:

- Ownership: Index on `(owner_player_id, match_id)` for player territory queries
- Terrain: Index on `(match_id, turn)` for temporal analysis
- Vegetation: Index on `(match_id, turn)` for deforestation tracking

### 5. NULL Semantics

```sql
-- Clear semantic meaning
WHERE owner_player_id IS NULL  -- Unowned territory
WHERE vegetation IS NULL        -- No vegetation (cleared)

-- vs confusing string comparison
WHERE new_value = '-1'  -- What does this mean? Unowned? Missing? Error?
```

## Disadvantages

### 1. More Tables to Maintain

- 3 tables instead of 1
- 3 parsers to write/maintain
- More schema documentation needed

### 2. Unified Timeline Queries

**Current (Easy):**

```sql
-- All changes for a tile in chronological order
SELECT turn, change_type, new_value
FROM tile_changes
WHERE tile_id = 100 AND match_id = 1
ORDER BY turn;
```

**Option B (Complex):**

```sql
-- Need UNION of multiple tables
SELECT turn, 'ownership' as type,
       COALESCE(CAST(owner_player_id AS TEXT), 'unowned') as value
FROM tile_ownership_history
WHERE tile_id = 100 AND match_id = 1

UNION ALL

SELECT turn, 'terrain' as type, terrain as value
FROM tile_terrain_history
WHERE tile_id = 100 AND match_id = 1

UNION ALL

SELECT turn, 'vegetation' as type,
       COALESCE(vegetation, 'none') as value
FROM tile_vegetation_history
WHERE tile_id = 100 AND match_id = 1

ORDER BY turn;
```

**Mitigation:** Create a VIEW for unified timeline queries:

```sql
CREATE VIEW tile_change_timeline AS
SELECT tile_id, match_id, turn, 'ownership' as change_type,
       CAST(owner_player_id AS TEXT) as value
FROM tile_ownership_history
UNION ALL
SELECT tile_id, match_id, turn, 'terrain', terrain
FROM tile_terrain_history
UNION ALL
SELECT tile_id, match_id, turn, 'vegetation',
       COALESCE(vegetation, 'none')
FROM tile_vegetation_history;
```

### 3. Migration Effort

- Must migrate existing tile_changes data
- Must update all parsers
- Must test all three history types
- Risk of data loss if migration fails

### 4. Can't Easily Add New Change Types

If new change types emerge (e.g., `ImprovementHistory`):

- Current: Just add to tile_changes (easy)
- Option B: Create new table, new parser, new indexes (effort)

## Data Volume Analysis

From test save (123 turns, 5476 tiles):

### Current State (tile_changes)

```
Total records: ~2,201 (all types combined)
- Ownership: ~2,201 records (100%)
- Terrain: ~0-50 records (<2%) - rare
- Vegetation: ~0-100 records (<5%) - uncommon
```

### Estimated Separated Table Sizes

```
tile_ownership_history: ~2,201 records (2MB)
tile_terrain_history: ~50 records (50KB)
tile_vegetation_history: ~100 records (100KB)
```

**Observation:** Ownership dominates the data volume. Terrain/vegetation changes are rare.

**Implication:** Most performance benefit comes from optimizing ownership queries specifically (supports hybrid approach).

## Decision Matrix

| Factor                        | Weight | tile_changes | Option B | Winner           |
| ----------------------------- | ------ | ------------ | -------- | ---------------- |
| Ownership Query Performance   | High   | 3/10         | 10/10    | **Option B**     |
| Terrain/Veg Query Performance | Low    | 6/10         | 10/10    | Option B         |
| Type Safety                   | Medium | 2/10         | 10/10    | **Option B**     |
| Schema Simplicity             | Medium | 9/10         | 4/10     | **tile_changes** |
| Code Complexity               | Medium | 8/10         | 5/10     | **tile_changes** |
| Unified Timeline Queries      | Low    | 10/10        | 6/10     | **tile_changes** |
| Foreign Key Validation        | High   | 0/10         | 10/10    | **Option B**     |
| Extensibility                 | Low    | 8/10         | 5/10     | **tile_changes** |

**Weighted Score:**

- tile_changes: 5.2/10
- Option B: 8.1/10

## Recommendation

### When to Use Option B (Full Normalization)

✅ **Recommended if:**

- Territorial expansion analysis is a core feature
- Query performance is critical
- You need strong data integrity (foreign keys)
- You're willing to invest in proper schema design
- You expect frequent ownership queries

### When to Use Hybrid Approach

✅ **Recommended if:**

- You want quick wins (ownership only)
- Terrain/vegetation tracking is secondary
- You want minimal disruption to existing code
- You prioritize simplicity over perfection

### When to Keep tile_changes Only

✅ **Recommended if:**

- You rarely query history data
- Unified timeline view is important
- You expect to add many new change types
- Schema simplicity is paramount

## Implementation Estimate

**Option B Full Implementation:**

- Schema changes: 2 hours
- Parser updates: 4-6 hours
- Testing (3 tables, 2 formats): 4 hours
- Migration script: 2 hours
- Documentation: 2 hours
- **Total: 14-16 hours**

**Hybrid Approach:**

- Schema changes: 1 hour
- Parser updates: 2 hours (ownership only, remove duplicate)
- Testing: 2 hours
- **Total: 5 hours**

**Benefit/Effort Ratio:**

- Option B: High benefit, high effort
- Hybrid: Good benefit, low effort ✅

## Conclusion

Option B provides the best long-term solution for data integrity, query performance, and schema clarity. However, it requires significant implementation effort.

The **hybrid approach is recommended** as a pragmatic middle ground:

1. Implement specialized `tile_ownership_history` (high-value optimization)
2. Keep `tile_changes` for terrain/vegetation (low-value, works fine)
3. Migrate to full Option B later if terrain/vegetation queries become bottlenecks

This provides 80% of the benefits with 20% of the effort, following the Pareto principle.

## References

- Hybrid implementation: `tile-ownership-implementation-hybrid.md`
- Schema: `docs/schema.sql`
- Task document: `docs/next-parser-tasks.md`
- Parser code: `src-tauri/src/parser/entities/tiles.rs`
- Existing tile data parser: `src-tauri/src/parser/entities/tile_data.rs`
