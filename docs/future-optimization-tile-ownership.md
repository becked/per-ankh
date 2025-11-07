# Future Optimization: Pre-Parse Tile City Ownership

**Status**: TODO (not implemented yet)
**Estimated Impact**: 18x speedup on tile city ownership (743ms → ~40ms)
**Complexity**: Medium (architectural change)

---

## Current Approach (Two-Pass)

### Pass 1: Insert Tiles (without city ownership)
```rust
// src-tauri/src/parser/entities/tiles.rs:9-172
pub fn parse_tiles(...) {
    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        // owner_city_id is set to None
        let owner_city_db_id: Option<i32> = None;

        app.append_row(params![
            // ... other fields ...
            owner_city_db_id,  // NULL for now
            // ...
        ])?;
    }
}
```

### Pass 2: Update Tiles (with city ownership)
```rust
// src-tauri/src/parser/entities/tiles.rs:179-207
pub fn update_tile_city_ownership(...) {
    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        if let Some(city_xml_id) = tile_node.opt_child_text("CityTerritory") {
            // Individual UPDATE per tile
            conn.execute(
                "UPDATE tiles SET owner_city_id = ? WHERE tile_id = ? AND match_id = ?",
                params![city_db_id, tile_db_id, match_id],
            )?;
        }
    }
}
```

**Problem**: ~1,000 individual UPDATE statements at ~743μs each = 743ms total

---

## Proposed Approach (Single-Pass with Pre-Parse)

### Step 1: Pre-Parse City Ownership Data
```rust
pub fn parse_tiles(doc: &XmlDocument, conn: &Connection, id_mapper: &mut IdMapper) -> Result<usize> {
    let root = doc.root_element();

    // NEW: Pre-parse all CityTerritory elements into HashMap
    let mut tile_city_map: HashMap<i32, i32> = HashMap::new();
    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        if let Some(city_xml_id_str) = tile_node.opt_child_text("CityTerritory") {
            if let Ok(city_xml_id) = city_xml_id_str.parse::<i32>() {
                let tile_xml_id = tile_node.req_attr("ID")?.parse::<i32>()?;
                tile_city_map.insert(tile_xml_id, city_xml_id);
            }
        }
    }

    // Now insert tiles with city ownership included
    let mut app = conn.appender("tiles")?;
    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        let xml_id = tile_node.req_attr("ID")?.parse::<i32>()?;

        // Look up city ownership from pre-parsed map
        let owner_city_db_id = tile_city_map.get(&xml_id)
            .map(|&city_xml_id| id_mapper.get_city(city_xml_id))
            .transpose()?;

        app.append_row(params![
            // ... other fields ...
            owner_city_db_id,  // Set during initial INSERT
            // ...
        ])?;
    }

    drop(app);
    Ok(count)
}
```

### Step 2: Delete `update_tile_city_ownership` Function

The entire second pass becomes unnecessary.

---

## Benefits

1. **Performance**: 18x faster (743ms → ~40ms)
   - Eliminates entire UPDATE pass
   - No index updates needed
   - No row lookups needed

2. **Simpler Architecture**: One-pass tile insertion
   - Less code to maintain
   - Clearer data flow
   - No multi-pass coordination

3. **Better Consistency**: City ownership is atomic with tile creation

---

## Challenges

1. **Double XML Traversal**: Must iterate tiles twice
   - Once to build city ownership map
   - Once to insert tiles
   - Overhead: ~10-20ms for 5,476 tiles

2. **Memory Usage**: HashMap for ~1,000 city ownership mappings
   - Negligible: ~8KB for 1,000 entries

3. **Code Complexity**: More logic in single function
   - Offset by deleting `update_tile_city_ownership` entirely

---

## Implementation Order

**Current Priority**: LOW (implement after critical bottlenecks fixed)

**Sequence**:
1. ✅ Fix ID mapper (2.6s → 0.2s savings)
2. ✅ Fix character extended data (2.8s → 0.25s savings)
3. ⏸️ Fix tile city ownership (743ms → 40ms savings) ← **Deferred**

**Reason for Deferral**:
- Smaller impact (9.4% of total time vs 33-35%)
- Higher implementation risk (architectural change)
- Current batch UPDATE approach provides good-enough speedup (~10x)

---

## Alternative: Batch UPDATEs (Current Implementation)

Instead of pre-parsing, batch the UPDATEs into fewer statements:

```rust
pub fn update_tile_city_ownership(...) -> Result<usize> {
    // Collect all updates
    let mut updates = Vec::new();
    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        if let Some(city_xml_id) = tile_node.opt_child_text("CityTerritory") {
            updates.push((tile_db_id, city_db_id));
        }
    }

    // Batch UPDATE in chunks of 500
    for chunk in updates.chunks(500) {
        let mut sql = String::from("UPDATE tiles SET owner_city_id = CASE tile_id ");
        let mut params = Vec::new();
        let mut tile_ids = Vec::new();

        for (tile_id, city_id) in chunk {
            sql.push_str("WHEN ? THEN ? ");
            params.push(tile_id);
            params.push(city_id);
            tile_ids.push(tile_id);
        }

        sql.push_str("END WHERE tile_id IN (");
        sql.push_str(&vec!["?"; tile_ids.len()].join(", "));
        sql.push_str(") AND match_id = ?");

        params.extend(tile_ids);
        params.push(match_id);

        conn.execute(&sql, params)?;
    }
}
```

**Benefit**: 5-10x speedup with minimal code change
**Trade-off**: Still slower than pre-parse approach, but much safer

---

## Recommendation

**Phase 1 (Current)**: Implement batch UPDATEs
- Lower risk
- Good speedup (5-10x)
- Minimal code changes

**Phase 2 (Future)**: Migrate to pre-parse approach
- After P1 and P2 optimizations are validated
- When confidence in architecture is high
- When additional 10x speedup becomes important

---

**Generated**: November 7, 2025
**Status**: TODO - deferred until after critical bottlenecks fixed
