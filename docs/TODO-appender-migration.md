# TODO: Migrate Remaining Entity Parsers to Appender API

## Status: ✅ COMPLETED

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
  - Re-import skip in 0.06s
  - Removed delete_derived_match_data function

- **Tiles parser** (src-tauri/src/parser/entities/tiles.rs)
  - 5,476 rows converted to Appender
  - Added missing fields: improvement_disabled, improvement_turns_left, improvement_develop_turns, init_seed, turn_seed
  - Removed UPSERT logic

- **Cities parser** (src-tauri/src/parser/entities/cities.rs)
  - 28 rows converted to Appender
  - Added missing field: first_owner_player_id
  - Removed UPSERT logic

- **Families parser** (src-tauri/src/parser/entities/families.rs)
  - 15 rows converted to Appender
  - Removed UPSERT logic

- **Tribes parser** (src-tauri/src/parser/entities/tribes.rs)
  - 10 rows converted to Appender
  - Removed UPSERT logic

- **Players parser** (src-tauri/src/parser/entities/players.rs)
  - 5 rows converted to Appender
  - Added missing fields: online_id, email, last_turn_completed, turn_ended, time_stockpile, succession_gender, founder_character_id, chosen_heir_id, original_capital_city_id, tech_researching, ambition_delay, tiles_purchased, state_religion_changes, tribe_mercenaries_hired
  - Removed UPSERT logic

### Final Performance Results 🚀

All entity parsers have been successfully migrated to the Appender API!

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

## Actual Final Performance

- **Before (all UPSERT)**: ~160s original baseline
- **After time-series + characters**: 15.21s
- **After ALL migrations**: **5.08s** ✨
- **Re-import detection**: **0.06s**

**Total speedup: 160s → 5.08s = 31.5x faster** 🚀

The migration achieved the target performance of 5-7s, landing at 5.08s for a full import!
