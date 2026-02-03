# Cities Tab Data Bugs

**STATUS: RESOLVED** (schema version 2.10.0)

Two data parsing issues affected the Cities tab display. Both have been fixed.

---

## Issue 1: Culture Level Always NULL - RESOLVED

**Symptom:** Culture column showed "—" for all cities.

**Root Cause:** Parser tried to parse culture level as integer, but XML stores it as a string enum.

**Solution Implemented:** Changed `culture_level` from `INTEGER` to `VARCHAR` throughout the stack:

- Schema: `culture_level VARCHAR` in `city_culture` table
- Rust structs: `culture_level: Option<String>`
- Parser: Stores string directly without conversion
- TypeScript: `culture_level: string | null`

**Files Modified:**

- `docs/schema.sql` - Schema type change
- `src-tauri/src/db/schema.rs` - Bumped schema version to 2.10.0
- `src-tauri/src/lib.rs` - CityInfo struct
- `src-tauri/src/parser/game_data.rs` - CityCulture struct
- `src-tauri/src/parser/parsers/city_data.rs` - Struct parser
- `src-tauri/src/parser/entities/city_data.rs` - Entity parser
- `src-tauri/src/parser/inserters/city_data.rs` - Inserter (clone for Option<String>)
- `docs/reference/city-data.md` - Updated documentation

**Culture Level Values:**
| String | Display Level |
|--------|---------------|
| CULTURE_WEAK | 0 |
| CULTURE_DEVELOPING | 1 |
| CULTURE_STRONG | 2 |
| CULTURE_ESTABLISHED | 3 |
| CULTURE_LEGENDARY | 4 |

---

## Issue 2: Units Produced Always 0 - RESOLVED

**Symptom:** Units Produced column showed 0 for all cities.

**Root Cause:** Parser looked for `<UnitProductionCount>` element which doesn't exist in newer saves (2025+). Only the breakdown `<UnitProductionCounts>` exists.

**Solution Implemented:** Parser now tries `<UnitProductionCount>` first (older saves), then falls back to summing `<UnitProductionCounts>` children (newer saves):

```rust
let unit_production_count = city_node
    .opt_child_text("UnitProductionCount")
    .and_then(|s| s.parse::<i32>().ok())
    .unwrap_or_else(|| {
        // Fall back: sum from UnitProductionCounts breakdown
        city_node
            .children()
            .find(|n| n.has_tag_name("UnitProductionCounts"))
            .map(|counts_node| {
                counts_node
                    .children()
                    .filter(|n| n.is_element())
                    .filter_map(|n| n.text().and_then(|s| s.parse::<i32>().ok()))
                    .sum()
            })
            .unwrap_or(0)
    });
```

**Files Modified:**

- `src-tauri/src/parser/parsers/cities.rs` - Added fallback logic and tests
- `docs/reference/city-data.md` - Updated documentation

---

## Testing

1. All 181 Rust tests pass: `cargo test --lib`
2. Re-import a save file to repopulate data (database reset required due to schema change)
3. Check Cities tab displays culture levels and unit counts

## Reference

See `docs/reference/city-data.md` for complete city data model documentation.
