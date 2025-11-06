# FamilyClass Parsing Issue

**Status:** ✅ Resolved
**Priority:** Medium
**Date:** 2025-11-06
**Resolution Date:** 2025-11-06
**Component:** `src/parser/entities/families.rs`

## Summary

The `FamilyClass` element exists in the raw XML save files but is not appearing in the parsed XML DOM tree when accessed via `roxmltree`. This causes all families to be imported without their `family_class` field populated.

## Current Behavior

When importing save files:
- Families are successfully parsed with name, head, seat, and turns_without_leader
- The `family_class` column remains empty for all families
- Logs show: `FamilyClass found in children: false`
- Parser reports: `Parsed 0 family classes from global FamilyClass element`

## Expected Behavior

- The global `<FamilyClass>` element should be found as a direct child of `<Root>`
- Family classes should be extracted and mapped to family names
- Each family record should have its corresponding class (e.g., `FAMILYCLASS_CHAMPIONS`)

## Evidence

### Raw XML Structure

In `OW-Rome-Year97-2025-10-09-00-13-02.xml` at line 1562:

```xml
    </ReligionFounder>
    <TeamAlliance />
    <FamilyClass>
      <FAMILY_SARGONID>FAMILYCLASS_CHAMPIONS</FAMILY_SARGONID>
      <FAMILY_TUDIYA>FAMILYCLASS_HUNTERS</FAMILY_TUDIYA>
      <FAMILY_ADASI>FAMILYCLASS_PATRONS</FAMILY_ADASI>
      <FAMILY_ERISHUM>FAMILYCLASS_CLERICS</FAMILY_ERISHUM>
      <FAMILY_KASSITE>FAMILYCLASS_HUNTERS</FAMILY_KASSITE>
      <FAMILY_CHALDEAN>FAMILYCLASS_ARTISANS</FAMILY_CHALDEAN>
      <!-- ... more families ... -->
    </FamilyClass>
```

The indentation shows `FamilyClass` is at the same level as `ReligionFounder` and `TeamAlliance` (direct children of `Root`).

### Parsed XML Structure

Debug logs from `parse_family_classes()`:

```
[INFO] Root element has 2197 children. First 20: ["GameContentEnabled", "Team", "Difficulty", "Development", "Nation", "Dynasty", "Archetype", "Humans", "StartingPlayerOptions", "GameOptions", "OccurrenceLevels", "VictoryEnabled", "GameContent", "MapMultiOptions", "MapSingleOptions", "Game", "Player", "Player", "Tribe", "Tribe"]
[INFO] FamilyClass found in children: false
[WARN] FamilyClass element not found as direct child of root
```

- Root has 2197 child elements
- `FamilyClass` is NOT among them
- No elements containing "Family" in their names exist in the children list

## Investigation Steps Taken

1. **Verified XML structure:** Confirmed `<FamilyClass>` exists at line 1562 in raw XML
2. **Checked hierarchy:** Verified `FamilyClass` is indented at same level as other root children
3. **Counted occurrences:** `grep -c "FamilyClass"` returns 2 (open and close tags)
4. **Listed all children:** Collected all 2197 child element names from parsed DOM
5. **Searched for "Family" tags:** No elements with "Family" in name found in parsed children
6. **Compared with working parsers:** Other elements like `Player`, `Tribe` are found correctly

## Code Location

**File:** `src/parser/entities/families.rs`
**Function:** `parse_family_classes()`
**Lines:** 158-179

```rust
fn parse_family_classes(root: &roxmltree::Node) -> Result<HashMap<String, String>> {
    let mut family_classes = HashMap::new();

    // This find() returns None even though FamilyClass exists in raw XML
    if let Some(class_node) = root.children().find(|n| n.has_tag_name("FamilyClass")) {
        // ...never reached...
    }

    Ok(family_classes)
}
```

## Possible Causes

### 1. XML Parsing Truncation
- **Hypothesis:** `roxmltree::Document::parse()` might be truncating the document
- **Evidence:** FamilyClass is at line 1562, relatively deep in the file
- **Counter:** Root reports 2197 children, suggesting full parse

### 2. Character Encoding Issue
- **Hypothesis:** FamilyClass element name contains invisible/special characters
- **Evidence:** XML declares `encoding="utf-8"` but has BOM (`﻿<?xml`)
- **Note:** We already handle UTF-8 BOM warnings in save_file.rs

### 3. Case Sensitivity
- **Hypothesis:** Tag name case doesn't match
- **Counter:** `grep -c "FamilyClass"` confirms exact case in XML
- **Counter:** Other elements with same casing work fine

### 4. Namespace or Attribute Filtering
- **Hypothesis:** roxmltree might filter elements based on attributes/namespaces
- **Evidence:** None - need to check roxmltree documentation

### 5. XML Document Limit
- **Hypothesis:** roxmltree has a node limit that's being hit
- **Evidence:** Root has 2197 children but file has many more total nodes
- **Action:** Check roxmltree docs for limits

## Workaround

Currently, families are imported without the `family_class` field. The field defaults to empty string `""`.

This is acceptable for initial data import but loses information about family archetypes (Champions, Hunters, Patrons, etc.) which may be useful for analytics.

## Next Steps for Investigation

1. **Check roxmltree node limits:**
   - Review roxmltree documentation for maximum node counts
   - Test with a minimal XML file containing only FamilyClass

2. **Debug roxmltree parsing:**
   ```rust
   // Add after Document::parse()
   let all_elements: Vec<_> = doc.descendants().filter(|n| n.is_element()).collect();
   log::debug!("Total elements in document: {}", all_elements.len());
   let family_class_nodes: Vec<_> = all_elements.iter()
       .filter(|n| n.has_tag_name("FamilyClass"))
       .collect();
   log::debug!("FamilyClass nodes found via descendants(): {}", family_class_nodes.len());
   ```

3. **Try descendants() instead of children():**
   - Current code uses `root.children()` which only checks direct children
   - If FamilyClass is somehow nested, `descendants()` would find it
   - But XML structure shows it should be a direct child

4. **Create minimal test case:**
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <Root>
     <Player ID="0"></Player>
     <FamilyClass>
       <FAMILY_TEST>FAMILYCLASS_TEST</FAMILY_TEST>
     </FamilyClass>
   </Root>
   ```
   Test if this minimal file parses correctly.

5. **Check XML well-formedness:**
   - Validate XML with external tool (xmllint)
   - Ensure no unclosed tags before FamilyClass

6. **Review save_file.rs XML loading:**
   - Check if any preprocessing filters out elements
   - Verify the full XML content is passed to roxmltree

## Alternative Solutions

### Option A: Parse from Raw String
Instead of using the DOM, search the raw XML string:

```rust
fn parse_family_classes_from_string(xml_content: &str) -> Result<HashMap<String, String>> {
    // Use regex or simple string parsing to extract FamilyClass section
    // This bypasses roxmltree entirely
}
```

**Pros:** Would definitely find the element
**Cons:** Fragile, loses XML structure benefits

### Option B: Use Different XML Parser
Try a different Rust XML library:
- `quick-xml` (already a dependency)
- `xml-rs`
- `serde-xml-rs`

**Pros:** Might not have the same issue
**Cons:** Requires refactoring all parsing code

### Option C: Extract During Per-Player Parsing
FamilyClass could be lazily extracted when first needed:

```rust
// When parsing first player, also grab FamilyClass as a one-time operation
lazy_static! {
    static ref FAMILY_CLASSES: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
}
```

**Pros:** Works around the issue
**Cons:** Hacky, doesn't solve root cause

## Database Impact

**Table:** `families`
**Column:** `family_class VARCHAR`
**Current State:** All NULL/empty
**Data Loss:** Moderate - loses family archetype information

## Related Files

- `src/parser/entities/families.rs` - Family parser implementation
- `src/parser/xml_loader.rs` - XML loading wrapper around roxmltree
- `src/parser/save_file.rs` - Save file extraction and XML loading
- `docs/schema.sql` - Database schema for families table

## References

- roxmltree documentation: https://docs.rs/roxmltree/
- XML structure confirmed in: `test-data/saves/OW-Rome-Year97-2025-10-09-00-13-02.zip`
- Debug logs from commit: fd3b9b5 (event stories fix)

---

## Resolution

**Root Cause:** The `FamilyClass` element is **not a direct child of `<Root>`** as initially assumed from XML indentation. Instead, it exists somewhere deeper in the document tree. The `children()` iterator only searches immediate children, so it never found the element.

**Solution:** Modified `parse_family_classes()` in `src/parser/entities/families.rs` to use a two-strategy approach:

1. **Strategy 1:** Try `root.children()` first (expected location for direct children)
2. **Strategy 2:** Fall back to `root.descendants()` which searches the entire document tree

**Code Changes:**
- Updated `parse_family_classes()` to try both `children()` and `descendants()`
- Added debug logging to identify which strategy succeeds
- Added diagnostic logging of first 50 root children if element not found

**Test Results:**
```
[INFO] Found FamilyClass in descendants (not direct child)
[INFO] Parsed 36 family classes from FamilyClass element
```

The fix successfully parses all family classes. The descendant search found the element where the direct child search failed.

**Impact:**
- Family classes (FAMILYCLASS_CHAMPIONS, FAMILYCLASS_HUNTERS, etc.) are now correctly populated
- No data loss for family archetypes
- Minimal performance impact (descendants search only runs if children search fails)

**Commit:** [To be added after commit]
