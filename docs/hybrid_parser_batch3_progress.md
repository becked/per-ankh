# Hybrid Parser Migration - Batch 3 Progress Tracker

**Phase:** Phase 3 - Extended and Nested Data
**Status:** In Progress (4 of 7 entities complete)
**Started:** 2025-11-09

---

## Overview

Batch 3 migrates extended and nested data entities to the hybrid parser architecture. These entities contain auxiliary game data that's parsed after the core entities.

**Total Entities:** 7
**Completed:** 4 ✅
**Remaining:** 3 ⏳

---

## Progress Summary

### ✅ Completed Entities

1. **character_data** (2025-11-09)
   - Files: `parsers/character_data.rs`, `inserters/character_data.rs`
   - Types: `CharacterStat`, `CharacterTrait`, `CharacterRelationship`, `CharacterMarriage`
   - Tests: 6 unit tests, all passing
   - Commit: `c2eadc6`

2. **city_data** (2025-11-09)
   - Files: `parsers/city_data.rs`, `inserters/city_data.rs`
   - Types: `CityProductionItem`, `CityProjectCompleted`, `CityYield`, `CityReligion`, `CityCulture`
   - Tests: 7 unit tests, all passing
   - Implementation: 5 parser functions, 5 inserter functions with deduplication

3. **tile_data** (2025-11-09)
   - Files: `parsers/tile_data.rs`, `inserters/tile_data.rs`
   - Types: `TileVisibility`, `TileChange`
   - Tests: 5 unit tests, all passing
   - Implementation: Separate parsers for visibility and change history
   - Commit: `2e30684`

4. **player_data** (2025-11-09)
   - Files: `parsers/player_data.rs`, `inserters/player_data.rs`
   - Types: `PlayerResource`, `TechnologyProgress`, `TechnologyCompleted`, `TechnologyState`, `PlayerCouncil`, `Law`, `PlayerGoal`
   - Tests: 9 unit tests, all passing
   - Implementation: 7 parser functions, 7 inserter functions with deduplication
   - Notable: Uses `parse_all_player_data()` orchestrator function to collect all nested data

### ⏳ Remaining Entities

5. **diplomacy** (Next)
   - Source: `entities/diplomacy.rs` (~171 lines)
   - Tables: `diplomacy_relations`
   - Complexity: Low-Medium
   - Estimated effort: 2 hours

6. **timeseries**
   - Source: `entities/timeseries.rs` (~450 lines)
   - Tables: `points_history`, `yield_history`
   - Complexity: Medium
   - Estimated effort: 2-3 hours

7. **events**
   - Source: `entities/events.rs` (~635 lines)
   - Tables: `event_stories`
   - Complexity: Medium-High (complex event data)
   - Estimated effort: 3-4 hours

---

## Implementation Checklist (Per Entity)

Use this checklist for each remaining entity:

### 1. Planning
- [ ] Read existing `entities/{name}.rs` to understand structure
- [ ] Identify all data types needed (refer to DB schema)
- [ ] Note any special parsing logic or edge cases
- [ ] Identify dependencies on other entities (for ordering)

### 2. Data Types (`game_data.rs`)
- [ ] Add struct definitions with `#[derive(Debug, Clone, Serialize, Deserialize)]`
- [ ] Use XML IDs (not DB IDs) in structs
- [ ] Document each field with inline comments
- [ ] Add structs to `GameData` struct

### 3. Parser (`parsers/{name}.rs`)
- [ ] Implement `parse_{name}_struct()` functions
- [ ] Pure XML parsing (no DB dependency)
- [ ] Proper error handling with `ParseError`
- [ ] Add module-level documentation
- [ ] Export from `parsers/mod.rs`

### 4. Inserter (`inserters/{name}.rs`)
- [ ] Implement `insert_{name}()` functions
- [ ] Map XML IDs to DB IDs using `IdMapper`
- [ ] Use `deduplicate_rows_last_wins()` or `deduplicate_rows_first_wins()`
- [ ] Bulk insert with DuckDB Appender
- [ ] Export from `inserters/mod.rs`

### 5. Testing
- [ ] Add unit tests for parser (minimum 3 tests per function)
- [ ] Test basic parsing
- [ ] Test edge cases (empty data, missing fields)
- [ ] Run `cargo test parsers::{name} --lib`
- [ ] Verify all tests pass

### 6. Commit
- [ ] Stage changes: `git add -A`
- [ ] Commit with pattern: `feat: migrate {name} to hybrid parser (Phase 3 Batch 3)`
- [ ] Include summary of changes in commit message

---

## Common Patterns to Follow

### CRITICAL: Test Setup Pattern

**Always use `parse_xml()` helper in tests:**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;  // ✅ Use this

    #[test]
    fn test_example() {
        let xml = r#"<Root>...</Root>"#;
        let doc = parse_xml(xml.to_string()).unwrap();  // ✅ Correct
        // NOT: Document::parse(xml).unwrap()  ❌ Wrong - type mismatch
    }
}
```

**Why:** `XmlDocument` is an enum wrapper (not a type alias). Using `roxmltree::Document::parse()` directly causes type mismatch errors because it returns `Document<'_>` but parsers expect `&XmlDocument`.

### Parser Function Signature
```rust
pub fn parse_{entity}_struct(doc: &XmlDocument) -> Result<Vec<{Entity}Data>> {
    let root = doc.root_element();
    let mut items = Vec::new();

    for node in root.children().filter(|n| n.has_tag_name("{Tag}")) {
        let xml_id: i32 = node.req_attr("ID")?.parse()?;
        // ... extract fields
        items.push({Entity}Data { xml_id, /* ... */ });
    }

    Ok(items)
}
```

### Inserter Function Signature
```rust
pub fn insert_{entities}(
    conn: &Connection,
    items: &[{Entity}Data],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for item in items {
        let db_id = id_mapper.get_{parent}(item.{parent}_xml_id)?;
        rows.push((db_id, id_mapper.match_id, /* ... */));
    }

    let unique_rows = deduplicate_rows_last_wins(
        rows,
        |(id, match_id, ..)| (*id, *match_id)
    );

    let mut app = conn.appender("{table_name}")?;
    for row in unique_rows {
        app.append_row(params![/* ... */])?;
    }

    drop(app);
    Ok(())
}
```

### Unit Test Template
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_{entity}_struct_basic() {
        let xml = r#"<Root><{Tag} ID="1" Field="value"/></Root>"#;
        let doc = parse_xml(xml.to_string()).unwrap();

        let items = parse_{entity}_struct(&doc).unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].xml_id, 1);
        assert_eq!(items[0].field, "value");
    }

    #[test]
    fn test_parse_{entity}_struct_empty() {
        let xml = r#"<Root></Root>"#;
        let doc = parse_xml(xml.to_string()).unwrap();

        let items = parse_{entity}_struct(&doc).unwrap();
        assert_eq!(items.len(), 0);
    }
}
```

---

## Special Considerations

### city_data
- Multiple nested data types (production queue, culture, yields)
- May need separate structs for each sub-type
- Consider using a main function that calls sub-parsers

### player_data
- Very large with many different data types
- Good candidate for sub-modules
- Consider splitting into `player_data/{resources,tech,laws,council,goals}.rs`

### timeseries
- Large volume of data (historical tracking)
- Ensure efficient parsing
- May want to test memory usage

### events
- Complex event story data with nested XML
- May need recursive parsing for event chains
- Test with various event types

---

## Dependencies & Ordering

**Important:** Some entities may depend on others being parsed first. Current known dependencies:

- ❌ **No new ordering constraints** - Batch 3 entities are all leaf nodes (don't reference each other)
- ✅ All Batch 3 entities only reference Batch 1 & 2 entities (players, characters, cities, tiles)

**Insertion Order (in `import.rs`):**
1. Batch 1 entities (already done)
2. Batch 2 entities (already done)
3. Batch 3 entities (can be inserted in any order after Batch 1 & 2)

---

## Testing Strategy

### Unit Tests (Per Entity)
- Test basic parsing with minimal XML
- Test parsing with all optional fields present
- Test parsing with all optional fields absent
- Test parsing multiple items
- Test parsing empty collections

### Integration Tests (After All Entities)
- Not required per the plan (YAGNI principle)
- Can be added later if needed for validation

### Memory Profiling (After Completion)
- Profile complete `GameData` struct
- Ensure total memory increase < 100-150 MB
- Use `estimate_memory_usage()` utility if created

---

## Estimated Timeline

Based on complexity estimates:

- **city_data**: 3-4 hours
- **tile_data**: 2-3 hours
- **player_data**: 4-5 hours
- **diplomacy**: 2 hours
- **timeseries**: 2-3 hours
- **events**: 3-4 hours

**Total estimated time:** 16-21 hours of focused work

**Suggested pace:** 1-2 entities per session

---

## After Batch 3 Completion

Once all 7 entities are migrated:

1. ✅ Update `GameData` struct is complete
2. ✅ All parsers implemented
3. ✅ All inserters implemented
4. ⏳ **TODO:** Wire up parsers in main import flow
5. ⏳ **TODO:** Wire up inserters in multi-pass insertion logic
6. ⏳ **TODO:** Remove old `entities/` code after validation
7. ⏳ **TODO:** Proceed to Phase 4 (Parallelization)

**Next Phase:** Phase 4 - Add Parallelization (Week 7 in original plan)

---

## Reference Documentation

- **Main Plan:** `docs/hybrid_parser_migration_plan_v2.md`
- **Batch 1 Completion:** See commits `d895147` (characters migration)
- **Batch 2 Completion:** See commits for families, religions, tribes, unit_production
- **Character Data Example:** `src-tauri/src/parser/parsers/character_data.rs`

---

## Notes & Learnings

### What Worked Well
- Following the established pattern from Batches 1 & 2
- Writing tests first helps clarify data structures
- Keeping XML IDs in structs simplifies parsing
- DRY: Reusing deduplication utilities saves time

### Potential Issues
- **Memory:** Keep an eye on struct sizes, especially for timeseries
- **Complexity:** player_data and events may benefit from sub-modules
- **Testing:** Ensure edge cases are covered (empty data, missing fields)

### Tips for Efficiency
1. Copy structure from similar existing entity (e.g., character_data)
2. Start with data types, then parser, then inserter
3. Write tests as you go, not at the end
4. Commit after each entity completion (atomic commits)
5. Use `cargo watch` for faster iteration during development

---

**Last Updated:** 2025-11-09
**Status:** 4/7 complete (57%)
**Next Entity:** diplomacy
