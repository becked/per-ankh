# TODO: Migrate Remaining Entity Parsers to Appender API

## Status: In Progress

### Completed ✅
- **Time-series parsers** (src-tauri/src/parser/entities/timeseries.rs)
  - 6 functions converted: yield_prices, military_history, points_history, etc.
  - ~31,000 rows using bulk inserts
  - Performance: ~41s → <1s

- **Characters parser** (src-tauri/src/parser/entities/characters.rs)
  - 297 rows converted to Appender
  - Removed complex UPSERT logic

- **Import infrastructure** (src-tauri/src/parser/import.rs)
  - Upfront (game_id, turn) duplicate detection
  - Re-import skip in 0.07s
  - Removed delete_derived_match_data function

### Remaining Work 🚧

The following entity parsers still use individual `conn.execute()` with `ON CONFLICT` (UPSERT):

| Parser | File | Rows | Complexity | Priority |
|--------|------|------|------------|----------|
| Tiles | tiles.rs | 5,476 | Medium | **HIGH** |
| Cities | cities.rs | 28 | Low | Medium |
| Families | families.rs | 15 | Medium | Low |
| Tribes | tribes.rs | 10 | Low | Low |
| Players | players.rs | 5 | Low | Low |

**Estimated speedup from converting all**: 15s → 5-7s total import time

---

## Migration Pattern

### Before (UPSERT - Slow)
```rust
pub fn parse_tiles(doc: &XmlDocument, conn: &Connection, id_mapper: &mut IdMapper) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        let xml_id = tile_node.req_attr("ID")?.parse::<i32>()?;
        let db_id = id_mapper.map_tile(xml_id);

        // ... parse tile attributes ...

        conn.execute(
            "INSERT INTO tiles (tile_id, match_id, xml_id, x, y, terrain, ...)
             VALUES (?, ?, ?, ?, ?, ?, ...)
             ON CONFLICT (match_id, xml_id) DO UPDATE SET
                 terrain = excluded.terrain,
                 ...",
            params![db_id, id_mapper.match_id, xml_id, x, y, terrain, ...],
        )?;

        count += 1;
    }

    Ok(count)
}
```

### After (Appender - Fast)
```rust
pub fn parse_tiles(doc: &XmlDocument, conn: &Connection, id_mapper: &mut IdMapper) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

    // Create appender ONCE before loop
    let mut app = conn.appender("tiles")?;

    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        let xml_id = tile_node.req_attr("ID")?.parse::<i32>()?;
        let db_id = id_mapper.map_tile(xml_id);

        // ... parse tile attributes ...

        // Bulk append - NO UPSERT, must match schema column order exactly
        app.append_row(params![
            db_id,              // tile_id
            id_mapper.match_id, // match_id
            xml_id,             // xml_id
            x,                  // x
            y,                  // y
            terrain,            // terrain
            // ... rest of columns in schema order
        ])?;

        count += 1;
    }

    Ok(count)
}
```

---

## Migration Checklist

For each parser:

1. **Check schema column order**
   ```bash
   grep -A 30 "CREATE TABLE <table_name>" docs/schema.sql
   ```

2. **Replace `conn.execute()` loop with `conn.appender()`**
   - Move appender creation BEFORE loop
   - Replace `.execute()` with `.append_row()`
   - Remove entire `ON CONFLICT` clause

3. **Match schema columns exactly**
   - Count columns in schema vs params
   - Add comments for each param (see characters.rs:111-145)
   - Use `None::<Type>` for NULL columns

4. **Test compilation**
   ```bash
   cargo check
   ```
   Error `"Call to EndRow before all columns have been appended"` means column count mismatch!

5. **Test import**
   ```bash
   rm -f per-ankh.db
   cargo run --release --example import_save -- ../test-data/saves/OW-Babylonia-Year123-2024-01-31-22-44-04.zip
   ```

---

## Important Notes

### Why Appender is Faster
- **UPSERT**: Each row = parse SQL + check conflict + maybe update = 3 operations
- **Appender**: Batches all rows into single bulk insert = 1 operation

### Why We Can Remove UPSERT
- Import logic now checks `(game_id, turn)` upfront (import.rs:149-171)
- Duplicates are skipped in 0.07s - never reach entity parsers
- Every import is fresh → no conflicts possible

### Column Order Debugging
If you get `EndRow` error:
```rust
// Count schema columns
grep -A 50 "CREATE TABLE tiles" docs/schema.sql | grep -E "^\s+\w+ " | wc -l

// Count your params
# Should match exactly!
```

---

## Expected Final Performance

- **Current**: 15.21s (with time-series + characters optimized)
- **After tiles**: ~8-10s (biggest remaining dataset)
- **After all**: ~5-7s total
- **Re-import**: 0.07s (already optimized)

Compare to original: **160s → 5s = 32x speedup** 🚀
