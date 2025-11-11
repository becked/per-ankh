# DuckDB INSERT Performance Optimization Guide

**Goal**: Reduce database insertion time from 1,100ms to <500ms
**Primary Bottleneck**: Tile city ownership UPDATE (622ms, 57% of import time)

---

## Benchmark Command

```bash
# Run this after EACH change to measure impact
cd src-tauri
cargo test --release --test benchmark_import -- --nocapture

# Look for these metrics:
# - Tile city ownership: XXXms
# - Commit: XXXms
# - TOTAL: XXXms
```

---

## Phase 1: Transaction Tuning (< 1 hour)

**Expected gain**: 20-80ms on commit, minimal on UPDATEs
**File**: `src-tauri/src/db/connection.rs`

### Implementation

```rust
pub fn get_connection(db_path: &PathBuf) -> Result<Connection> {
    let conn = Connection::open(db_path)?;

    // Delay checkpoints until explicit CHECKPOINT call
    // Default is 16MB - imports trigger multiple checkpoints
    conn.execute_batch("
        SET checkpoint_threshold='1GB';
        SET wal_autocheckpoint='1GB';
    ")?;

    Ok(conn)
}
```

**File**: `src-tauri/src/parser/import.rs` (in `import_save_file`, before commit)

```rust
// Line ~220 (before tx.commit()?)
release_db_lock(&tx, &game_id)?;
tx.execute("CHECKPOINT", [])?;  // Add this line
tx.commit()?;
```

### Benchmark & Decide

```bash
cargo test --release --test benchmark_import -- --nocapture
```

- If commit time drops by >50ms → Keep it ✅
- If commit time unchanged → Remove `CHECKPOINT` call, keep config ⚠️
- Document result in this file

**Result**: _[Developer fills in]_

---

## Phase 2: Mega-Batch UPDATE (< 1 hour)

**Expected gain**: 0-100ms (speculative - quick test)
**File**: `src-tauri/src/parser/entities/tiles.rs`

### Current Approach
```rust
// Batches of 500 tiles (11 batches for 5,476 tiles)
for batch in tile_id_mappings.chunks(500) {
    // Build CASE statement for 500 tiles
    conn.execute(&sql, [])?;
}
```

### Test: Single Mega-Batch
```rust
// Single batch of all 5,476 tiles
let all_cases: Vec<String> = tile_id_mappings.iter()
    .map(|(tile_id, city_id)| {
        format!("WHEN {} THEN {}", tile_id, city_id)
    })
    .collect();

let all_ids: Vec<String> = tile_id_mappings.iter()
    .map(|(tile_id, _)| tile_id.to_string())
    .collect();

let sql = format!(
    "UPDATE tiles SET city_id = CASE tile_id {} END WHERE tile_id IN ({})",
    all_cases.join(" "),
    all_ids.join(",")
);

conn.execute(&sql, [])?;
```

### Benchmark & Decide

```bash
cargo test --release --test benchmark_import -- --nocapture
```

- If tile ownership drops by >50ms → Keep it ✅
- If unchanged or slower → Revert to 500-batch ❌
- Document result in this file

**Result**: _[Developer fills in]_

---

## Phase 3: JOIN-Based UPDATE (2-4 hours)

**Expected gain**: 50-200ms
**File**: `src-tauri/src/parser/entities/tiles.rs`
**DuckDB docs recommend**: "FROM clause approaches complete UPDATE in bulk for increased performance"

### Current Approach
```rust
// CASE-based UPDATE (batch of 500)
UPDATE tiles
SET city_id = CASE tile_id
  WHEN 1 THEN 10
  WHEN 2 THEN 11
  ...
END
WHERE tile_id IN (1, 2, ...);
```

### New Approach: Temp Table + JOIN

Find the function `update_tile_city_ownership` in `src-tauri/src/parser/entities/tiles.rs`.

**Replace batched CASE UPDATE with**:

```rust
pub fn update_tile_city_ownership(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &IdMapper,
) -> Result<()> {
    // 1. Collect all tile→city mappings
    let root = doc.root_element();
    let mut tile_city_mappings: Vec<(i64, i32)> = Vec::new();

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id: i32 = city_node.req_attr("ID")?.parse()
            .map_err(|_| ParseError::InvalidFormat("City ID not int".into()))?;
        let city_db_id = id_mapper.get_city(city_xml_id)?;

        for tile_node in city_node.children().filter(|n| n.has_tag_name("TileList")) {
            if let Some(tile_xml_id_str) = tile_node.opt_attr("Value") {
                let tile_xml_id: i32 = tile_xml_id_str.parse()
                    .map_err(|_| ParseError::InvalidFormat("Tile ID not int".into()))?;
                let tile_db_id = id_mapper.get_tile(tile_xml_id)?;
                tile_city_mappings.push((tile_db_id, city_db_id));
            }
        }
    }

    if tile_city_mappings.is_empty() {
        return Ok(());
    }

    // 2. Create temp table
    conn.execute_batch("
        CREATE TEMP TABLE IF NOT EXISTS tile_city_updates (
            tile_id BIGINT NOT NULL,
            city_id INTEGER NOT NULL
        );
    ")?;

    // 3. Bulk insert mappings using Appender (fast)
    let mut app = conn.appender("tile_city_updates")?;
    for (tile_id, city_id) in tile_city_mappings {
        app.append_row(params![tile_id, city_id])?;
    }
    drop(app); // Flush

    // 4. UPDATE via JOIN (DuckDB bulk-optimized)
    conn.execute("
        UPDATE tiles
        SET city_id = u.city_id
        FROM tile_city_updates u
        WHERE tiles.tile_id = u.tile_id
    ", [])?;

    // 5. Cleanup
    conn.execute("DROP TABLE tile_city_updates", [])?;

    Ok(())
}
```

### Benchmark & Decide

```bash
cargo test --release --test benchmark_import -- --nocapture
```

- If tile ownership drops by >50ms → Keep it ✅
- If unchanged → Consider reverting (but likely small win) ⚠️
- Document result in this file

**Result**: _[Developer fills in]_

---

## Phase 4: Eliminate UPDATEs (2-3 days) - ONLY IF NEEDED

**Target**: Tile ownership <100ms (currently 622ms)
**Trigger**: If Phases 1-3 don't achieve <500ms total import time

### Strategy

Insert tiles with `city_id` resolved upfront → No UPDATE needed.

**Current flow**:
1. Parse & insert tiles (city_id = NULL)
2. Parse & insert cities
3. UPDATE tiles.city_id ← 622ms bottleneck

**New flow**:
1. Parse tiles
2. Parse cities
3. **Build FK resolution map** (tile_xml_id → city_db_id)
4. Insert tiles with city_id already set ← No UPDATE

### Implementation Outline

**File**: `src-tauri/src/parser/import.rs`

```rust
// CURRENT (Line ~348):
let (players_data, characters_data, cities_data, tiles_data) =
    super::parsers::parse_foundation_entities_parallel(doc)?;

// Insert tiles without city_id
super::inserters::insert_tiles_core(tx, &tiles_data, &mut id_mapper)?;
super::inserters::insert_cities(tx, &cities_data, &mut id_mapper)?;

// UPDATE tiles.city_id (622ms)
super::entities::update_tile_city_ownership(doc, tx, &id_mapper)?;

// NEW:
let (players_data, characters_data, cities_data, tiles_data) =
    super::parsers::parse_foundation_entities_parallel(doc)?;

// NEW: Build tile→city FK map BEFORE insertion
let tile_city_map = build_tile_city_map(doc, &tiles_data, &cities_data)?;

// Insert tiles with city_id resolved
super::inserters::insert_tiles_with_city(
    tx,
    &tiles_data,
    &tile_city_map,  // ← Resolve FKs during insert
    &mut id_mapper
)?;
super::inserters::insert_cities(tx, &cities_data, &mut id_mapper)?;

// No UPDATE needed - tiles already have city_id
```

### New Function: `build_tile_city_map`

**File**: `src-tauri/src/parser/entities/tiles.rs`

```rust
use std::collections::HashMap;

/// Build map of tile_xml_id → city_xml_id from City.TileList
pub fn build_tile_city_map(
    doc: &XmlDocument,
    tiles_data: &[TileData],
    cities_data: &[CityData],
) -> Result<HashMap<i32, i32>> {
    let mut tile_to_city: HashMap<i32, i32> = HashMap::new();
    let root = doc.root_element();

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id: i32 = city_node.req_attr("ID")?.parse()
            .map_err(|_| ParseError::InvalidFormat("City ID".into()))?;

        for tile_node in city_node.children().filter(|n| n.has_tag_name("TileList")) {
            if let Some(tile_xml_id_str) = tile_node.opt_attr("Value") {
                let tile_xml_id: i32 = tile_xml_id_str.parse()
                    .map_err(|_| ParseError::InvalidFormat("Tile ID".into()))?;
                tile_to_city.insert(tile_xml_id, city_xml_id);
            }
        }
    }

    Ok(tile_to_city)
}
```

### Modified Inserter: `insert_tiles_with_city`

**File**: `src-tauri/src/parser/inserters/tiles.rs`

```rust
/// Insert tiles with city_id resolved upfront (no UPDATE needed)
pub fn insert_tiles_with_city(
    conn: &Connection,
    tiles: &[TileData],
    tile_city_map: &HashMap<i32, i32>,  // ← tile_xml_id → city_xml_id
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    let mut rows = Vec::new();

    for tile in tiles {
        let db_id = id_mapper.map_tile(tile.xml_id);

        // Resolve city FK BEFORE insertion
        let city_db_id = tile_city_map
            .get(&tile.xml_id)
            .and_then(|city_xml_id| id_mapper.get_city(*city_xml_id).ok());

        // ... rest of tile data ...

        rows.push((
            db_id,
            id_mapper.match_id,
            tile.xml_id,
            city_db_id,  // ← Set during insert, not UPDATE
            // ... other fields ...
        ));
    }

    // Deduplicate and insert with Appender (existing logic)
    let unique_rows = deduplicate_rows_last_wins(rows, |(id, match_id, ..)| {
        (*id, *match_id)
    });

    let mut app = conn.appender("tiles")?;
    for row in unique_rows {
        app.append_row(params![/* expand row tuple */])?;
    }
    drop(app);

    Ok(tiles.len())
}
```

### Remove UPDATE Call

**File**: `src-tauri/src/parser/import.rs` (Line ~402)

```rust
// DELETE this line:
super::entities::update_tile_city_ownership(doc, tx, &id_mapper)?;
```

### Benchmark & Decide

```bash
cargo test --release --test benchmark_import -- --nocapture
```

**Expected result**: Tile city ownership time drops from 622ms → 0ms

**Result**: _[Developer fills in]_

---

## Success Criteria

| Phase | Metric | Current | Target | Status |
|-------|--------|---------|--------|--------|
| 1. Transaction tuning | Commit time | 134ms | <100ms | ⬜ |
| 2. Mega-batch | Tile ownership | 622ms | <550ms | ⬜ |
| 3. JOIN-based UPDATE | Tile ownership | 622ms | <450ms | ⬜ |
| 4. Eliminate UPDATEs | Tile ownership | 622ms | <100ms | ⬜ |
| **TOTAL** | **Import time** | **1,100ms** | **<500ms** | ⬜ |

---

## Rollback Instructions

Each phase is independent. To revert:

1. **Phase 1**: Remove checkpoint config from `get_connection()`
2. **Phase 2**: Restore `chunks(500)` loop
3. **Phase 3**: Git revert commit (preserves CASE-based UPDATE)
4. **Phase 4**: Git revert commit (restores UPDATE-based flow)

---

## Notes

- Run benchmark after EACH phase
- Document actual results in "Result" sections above
- Stop when total import <500ms (YAGNI)
- Phase 4 only needed if Phases 1-3 insufficient
