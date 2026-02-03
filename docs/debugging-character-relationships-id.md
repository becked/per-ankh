# Bug: Character Relationships Parser Failing on Missing ID Field

**Status:** Open
**Priority:** Medium
**Discovered:** 2025-11-05
**Affects:** Milestone 5 - Character Extended Data

## Issue Summary

The save file import fails when parsing character relationships due to a missing `ID` field in some `RelationshipData` elements. The parser expects this field to always be present, but the actual XML structure shows it can be optional.

## Error Message

```
Missing required element: RelationshipData.ID
```

## Impact

- Import fails after successfully parsing ~30,000 records
- Character relationships are not imported
- Subsequent data (city extended data, tile data, events) is not imported
- Transaction rolls back, so partial data is not saved

## Reproduction Steps

1. Run the import tool on the Babylonia save file:

   ```bash
   cd src-tauri
   cargo run --example import_save -- ../test-data/saves/OW-Babylonia-Year123-2024-01-31-22-44-04.zip
   ```

2. Observe the import progresses through:
   - Core entities (players, characters, cities, tiles, tribes)
   - Unit production data
   - Player gameplay data (resources, tech, laws, council, goals)
   - Diplomacy
   - Time-series data (30,556 records)

3. Import fails at character extended data parsing with the error above

## Root Cause

The character relationships parser in `src-tauri/src/parser/entities/character_data.rs` uses `req_child_text()` to parse the `ID` field:

```rust
// Current code (line ~250):
let target_character_xml_id: i32 = rel_node.req_child_text("ID")?;
```

However, the actual XML structure in Old World save files shows that `RelationshipData` can have different structures:

**Case 1: Standard relationship (has ID)**

```xml
<RelationshipData>
    <Type>RELATIONSHIP_PLOTTING_AGAINST</Type>
    <ID>10</ID>
    <Turn>15</Turn>
</RelationshipData>
```

**Case 2: Self-relationship or special case (no ID)**

```xml
<RelationshipData>
    <Type>RELATIONSHIP_SOME_TYPE</Type>
    <Turn>20</Turn>
</RelationshipData>
```

The parser needs to handle both cases gracefully.

## Affected Code Location

**File:** `src-tauri/src/parser/entities/character_data.rs`
**Function:** `parse_character_relationships()` (approximately line 215-280)
**Specific Line:** `let target_character_xml_id: i32 = rel_node.req_child_text("ID")?;`

## Proposed Solution

Change the `ID` field from required to optional:

```rust
// BEFORE (fails if ID is missing):
let target_character_xml_id: i32 = rel_node.req_child_text("ID")?;
let target_character_id = id_mapper.get_character(target_character_xml_id)?;

// AFTER (skip relationships without target ID):
let target_character_id = if let Some(xml_id) = rel_node.opt_child_text::<i32>("ID") {
    Some(id_mapper.get_character(xml_id)?)
} else {
    None
};

// Skip relationships without a target character
if target_character_id.is_none() {
    continue;
}

let target_character_id = target_character_id.unwrap();
```

### Alternative Solution (More Robust)

If relationships without IDs represent special cases (like self-relationships), consider logging them:

```rust
let target_character_id = match rel_node.opt_child_text::<i32>("ID") {
    Some(xml_id) => id_mapper.get_character(xml_id)?,
    None => {
        // Log for analysis
        log::debug!(
            "Skipping relationship without target ID: type={}, character={}, turn={}",
            relationship_type,
            character_id,
            turn_started
        );
        continue;
    }
};
```

## Database Schema

The `character_relationships` table already supports this change:

```sql
CREATE TABLE character_relationships (
    character_id BIGINT NOT NULL,
    target_character_id BIGINT NOT NULL,  -- Currently NOT NULL
    ...
);
```

**Options:**

1. Keep `target_character_id NOT NULL` and skip relationships without IDs
2. Change to `target_character_id BIGINT` (nullable) to preserve all relationships

**Recommendation:** Option 1 (skip) - relationships without target IDs are likely incomplete or special cases not worth tracking.

## Testing

After fixing, verify:

1. **Import completes successfully:**

   ```bash
   cargo run --example import_save -- ../test-data/saves/OW-Babylonia-Year123-2024-01-31-22-44-04.zip
   ```

   Should complete without errors.

2. **Check imported relationships:**

   ```sql
   -- Verify relationships were imported
   SELECT COUNT(*) FROM character_relationships WHERE match_id = 1;

   -- Check relationship types distribution
   SELECT relationship_type, COUNT(*)
   FROM character_relationships
   WHERE match_id = 1
   GROUP BY relationship_type
   ORDER BY COUNT(*) DESC;
   ```

3. **Run full test suite:**

   ```bash
   cargo test test_import_babylonia_save --release -- --nocapture
   ```

4. **Test with multiple save files:**
   ```bash
   for save in test-data/saves/*.zip; do
       cargo run --example import_save -- "$save"
   done
   ```

## Expected Results After Fix

With the fix in place, the import should:

- ✅ Complete successfully without errors
- ✅ Import all character relationships that have target IDs
- ✅ Skip relationships without target IDs (log count at debug level)
- ✅ Proceed to import city extended data, tile data, and events
- ✅ Commit the full transaction with all data

## Additional Context

### Import Performance (Before Failure)

The import successfully processed:

- **Core entities:** ~5,800 records (players, characters, cities, tiles, tribes)
- **Derived data:** ~500 records (unit production, resources, tech, laws, council, goals)
- **Time-series:** ~30,500 records (yield prices, military history, family opinions)
- **Diplomacy:** 75 relations
- **Total:** ~37,000 records before failure

Import time: ~40 seconds to point of failure

### Known Working Imports

All data through Milestone 4 (time-series data) imports successfully. The issue only affects Milestone 5 (character extended data).

### Related Issues

None currently. This is the first parsing issue discovered during integration testing.

## References

- **Implementation Plan:** `docs/plans/xml-parser-implementation.md`
- **Milestone Updates:** `docs/plans/xml-parser-milestone-4-6-updates.md`
- **Character Data Parser:** `src-tauri/src/parser/entities/character_data.rs`
- **XML Helpers:** `src-tauri/src/parser/xml_loader.rs` (contains `req_child_text()` and `opt_child_text()`)

## Notes for Developer

- The fix is straightforward - just change one line from `req_child_text()` to `opt_child_text()`
- Consider reviewing other parsers for similar issues (cities, tiles, events may have similar patterns)
- The `XmlNodeExt` trait in `xml_loader.rs` provides both `req_child_text()` and `opt_child_text()` helpers
- Error messages include full element paths for debugging (e.g., `/Root/Character[ID=5]/RelationshipList/RelationshipData`)
- All parsers use the same error handling patterns, so this fix sets a precedent
