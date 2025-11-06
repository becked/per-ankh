# Investigation Report: get_player(-1) Error

**Date**: 2025-11-05
**Status**: UNRESOLVED
**Severity**: BLOCKING - Prevents successful import of real save files

## Problem Summary

The XML parser is attempting to look up a player with ID `-1` during the import process, causing the import to fail with:

```
Import failed: Some("Unknown player ID: -1 at lookup")
```

This error occurs during parsing of a real Old World save file (`OW-Carthage-Year39-2025-11-04-21-38-46.zip`) after successfully parsing:
- 2 Players
- Multiple Tribes
- 74 Characters
- 3000+ Tiles (26 seconds of parsing)
- Multiple Cities

## Technical Context

### ID Mapping System

The parser uses an `IdMapper` to convert XML IDs (which can be reused across different matches) to stable database IDs. The `get_player()` function is defined in `src/parser/id_mapper.rs:258-264`:

```rust
pub fn get_player(&self, xml_id: i32) -> Result<i64> {
    log::debug!("get_player called with xml_id={}, mapped players: {:?}",
                xml_id, self.players.keys().collect::<Vec<_>>());
    self.players
        .get(&xml_id)
        .copied()
        .ok_or_else(|| ParseError::UnknownPlayerId(xml_id, "lookup".to_string()))
}
```

### -1 Sentinel Value Convention

In Old World XML files, `-1` is used as a sentinel value to indicate "no player" or "unowned" for various entities:

1. **Tribal Characters**: `<Character Player="-1">` - characters belonging to tribes, not players
2. **Unowned Tiles**: Tiles that haven't been claimed by any player
3. **Tribal Leaders**: Characters who died or don't exist in the character list
4. **Non-allied Tribes**: `<Tribe AlliedPlayer="-1">` - tribes not allied with any player

## What We've Fixed

### Successfully Handled -1 Cases

We've already added filtering for several entity types to handle `-1` properly:

#### 1. Characters Parser (src/parser/entities/characters.rs:33-41)
```rust
let player_xml_id = char_node
    .opt_attr("Player")
    .and_then(|s| s.parse::<i32>().ok())
    .filter(|&id| id >= 0); // Filter out -1 (tribal characters)
let player_db_id = match player_xml_id {
    Some(id) => Some(id_mapper.get_player(id)?),
    None => None,
};
```

#### 2. Tiles Parser (src/parser/entities/tiles.rs:64-72)
```rust
let owner_player_xml_id = tile_node
    .opt_child_text("OwnerPlayer")
    .and_then(|s| s.parse::<i32>().ok())
    .filter(|&id| id >= 0); // Filter out -1 for unowned tiles
let owner_player_db_id = match owner_player_xml_id {
    Some(id) => Some(id_mapper.get_player(id)?),
    None => None,
};
```

#### 3. Tribes Parser (src/parser/entities/tribes.rs:30-37)
```rust
let allied_player_xml_id = tribe_node
    .opt_child_text("AlliedPlayer")
    .and_then(|s| s.parse::<i32>().ok())
    .filter(|&id| id >= 0); // Filter out -1 for non-allied tribes
let allied_player_db_id = match allied_player_xml_id {
    Some(id) => Some(id_mapper.get_player(id)?),
    None => None,
};
```

### Remaining get_player() Call Sites

Grepping for `get_player` reveals these locations that could still be problematic:

```bash
$ grep -n "get_player" src/parser/entities/*.rs

src/parser/entities/characters.rs:39:    Some(id) => Some(id_mapper.get_player(id)?),
src/parser/entities/cities.rs:22:       let player_db_id = id_mapper.get_player(player_xml_id)?;
src/parser/entities/families.rs:26:     let player_db_id = id_mapper.get_player(player_xml_id)?;
src/parser/entities/religions.rs:34:    Some(id) => Some(id_mapper.get_player(id)?),
src/parser/entities/tiles.rs:70:        Some(id) => Some(id_mapper.get_player(id)?),
src/parser/entities/tribes.rs:35:       Some(id) => Some(id_mapper.get_player(id)?),
```

## What We Know

### 1. Debug Logging Doesn't Fire

When running the test with `RUST_LOG=debug`, the debug log statement inside `get_player()` doesn't appear before the error. This suggests:

- The error might be thrown during a different phase (e.g., during import orchestration setup)
- OR there's a code path that bypasses the logging
- OR the error occurs so early that logging isn't initialized

### 2. The Error Is ParseError::UnknownPlayerId

The error message matches the format from `id_mapper.rs:263`:
```rust
.ok_or_else(|| ParseError::UnknownPlayerId(xml_id, "lookup".to_string()))
```

The second parameter is hardcoded to `"lookup"`, which appears in the error message.

### 3. Families and Religions Parsers Are Disabled

These parsers are currently commented out in `src/parser/import.rs:196-200` because:
- Families and Religions don't exist as separate top-level XML elements
- They are referenced by name (e.g., `FAMILY_BARCID`, `RELIGION_JUDAISM`) but not defined separately
- However, the parser files still exist and contain `get_player()` calls

### 4. Cities Parser Always Requires Player

The Cities parser (src/parser/entities/cities.rs:19-22) doesn't filter `-1`:

```rust
let player_xml_id = city_node
    .req_attr("Player")?
    .parse::<i32>()?;
let player_db_id = id_mapper.get_player(player_xml_id)?;
```

**Question**: Can cities have `Player="-1"`? Need to verify in XML.

### 5. Test File Context

The test save file `OW-Carthage-Year39-2025-11-04-21-38-46.zip` contains:
- 2 players (IDs 0 and 1)
- Player 0: "ninja" (human, Carthage)
- Player 1: "becked" (AI-controlled, Rome)
- 74 characters total
- ~3000 tiles
- Multiple cities
- Multiple tribes

## Attempted Debugging Steps

### 1. Added Debug Logging ❌
```rust
pub fn get_player(&self, xml_id: i32) -> Result<i64> {
    log::debug!("get_player called with xml_id={}, mapped players: {:?}",
                xml_id, self.players.keys().collect::<Vec<_>>());
    // ...
}
```
**Result**: No debug output appeared before the error, suggesting error occurs before any get_player calls or logging isn't captured.

### 2. Searched for -1 References ✓
Confirmed that `-1` appears in multiple contexts:
- Character `Player="-1"` attributes
- Tile `OwnerPlayer` elements
- Tribe `AlliedPlayer` elements

### 3. Added .filter(|&id| id >= 0) to Parsers ✓
Successfully prevented `-1` from reaching `get_player()` in Characters, Tiles, and Tribes parsers.

### 4. Checked XML Structure 🔍
Examined actual XML and found:
- Cities always have valid Player IDs (0 or 1 in test file)
- Families/Religions don't exist as elements (commented out parsers)
- No obvious source of `-1` in required fields

## Investigation Next Steps

### HIGH PRIORITY: Determine Call Stack

Add better error context to pinpoint exactly where the error occurs:

#### Option 1: Add Stack Trace to Error
Modify `ParseError::UnknownPlayerId` to capture stack trace or caller location:

```rust
#[error("Unknown player ID: {0} at {1}\nBacktrace: {2}")]
UnknownPlayerId(i32, String, std::backtrace::Backtrace),
```

#### Option 2: Add Entity Context to get_player Calls
Pass additional context about which entity is being parsed:

```rust
pub fn get_player(&self, xml_id: i32, context: &str) -> Result<i64> {
    self.players
        .get(&xml_id)
        .copied()
        .ok_or_else(|| ParseError::UnknownPlayerId(xml_id, context.to_string()))
}
```

Then update all call sites:
```rust
// In cities.rs
let player_db_id = id_mapper.get_player(player_xml_id, "city owner")?;

// In characters.rs
Some(id) => Some(id_mapper.get_player(id, "character player")?),
```

### MEDIUM PRIORITY: Verify Cities Can't Have Player=-1

Check if cities can be barbarian/neutral/abandoned:

```bash
$ grep '<City' test-data/saves/*.xml | grep 'Player="-1"'
```

If cities CAN have `-1`, add filtering:
```rust
let player_xml_id = city_node
    .req_attr("Player")?
    .parse::<i32>()?;

// Cities must have a player (can't be barbarian), so error on -1
if player_xml_id < 0 {
    return Err(ParseError::InvalidFormat(
        format!("City {} has invalid player ID: {}", xml_id, player_xml_id)
    ));
}

let player_db_id = id_mapper.get_player(player_xml_id)?;
```

### MEDIUM PRIORITY: Check Import Orchestration

Review `src/parser/import.rs:133-217` for any player lookups during:
- Match metadata extraction (line 236-238)
- ID mapper initialization (line 167)
- Delete derived data phase (line 173-175)

### LOW PRIORITY: Check for Attribute vs Element Confusion

Verify no parsers are reading `-1` as a string from the wrong location:
- Attributes vs child elements confusion
- Typos in element/attribute names
- Case sensitivity issues

## Known Workarounds

None currently available. The error is blocking all imports of real save files.

## Related Files

- **Error Definition**: `src/parser/mod.rs:74-75`
- **ID Mapper**: `src/parser/id_mapper.rs:258-264`
- **Import Orchestration**: `src/parser/import.rs:133-217`
- **Entity Parsers**: `src/parser/entities/*.rs`
- **Test**: `src/parser/tests.rs:40-99`

## Test Commands

```bash
# Run failing test
cargo test test_import_real_save_file --lib -- --nocapture

# With debug logging (though it doesn't show get_player calls)
RUST_LOG=debug cargo test test_import_real_save_file --lib -- --nocapture

# With full backtrace
RUST_BACKTRACE=full cargo test test_import_real_save_file --lib -- --nocapture

# Extract and examine test XML
cd test-data/saves
unzip -o OW-Carthage-Year39-2025-11-04-21-38-46.zip
grep -n '<City' OW-Carthage-Year39-2025-11-04-21-38-46.xml | head -20
```

## Hypothesis to Test

**Primary Hypothesis**: The error occurs in the Cities parser because:
1. Test passes through Players (2), Tribes (~20), Characters (74), Tiles (3000+)
2. Cities are parsed next in sequence (line 194 of import.rs)
3. Cities parser doesn't filter `-1` values
4. One city in the XML might have `Player="-1"` (captured/neutral city?)

**Alternative Hypothesis**: The error occurs during a second pass or relationship update:
1. Some entity parsers update relationships after initial parsing
2. A foreign key lookup might be trying to resolve a `-1` player reference
3. Check for UPDATE statements that modify player_id columns

## Success Criteria

Investigation is complete when we can:
1. Identify the exact line of code calling `get_player(-1)`
2. Understand why that code path exists
3. Either filter the `-1` or fix the data model to handle it appropriately
4. Successfully import the test save file without errors

## Additional Notes

- The 26-second tile parsing time suggests ~3000 tiles (MapWidth=58, estimated ~50 height)
- All entity parsers except Families/Religions are active
- Schema is successfully initialized with all tables and indexes
- DuckDB compatibility issues have been resolved (timestamps, indexes, views)

---

## RESOLUTION (2025-11-05)

**Status**: RESOLVED ✅

### Root Cause

The **Primary Hypothesis was correct**. The error occurred in the Cities parser because:

1. The test file (`OW-Carthage-Year39-2025-11-04-21-38-46.zip`) contains a city with `Player="-1"`:
   - City ID="6", Name="SALONA"
   - In anarchy state: `<Tribe>TRIBE_ANARCHY</Tribe>`
   - Being captured: `<CaptureTurns>1</CaptureTurns>`, `<CapturePlayer>0</CapturePlayer>`
   - Has damage: `<Damage>20</Damage>`

2. The Cities parser did not filter `-1` values like Characters, Tiles, and Tribes parsers do

3. When the parser tried to call `id_mapper.get_player(-1)`, it failed because `-1` is not a valid player

### Solution

**Two-part fix implemented:**

#### 1. Schema Change (docs/schema.sql:400)
Changed cities.player_id to allow NULL for cities in transitional states:

```sql
-- Before:
player_id INTEGER NOT NULL,

-- After:
player_id INTEGER,  -- NULL for cities in anarchy/being captured (Player="-1" in XML)
```

#### 2. Parser Change (src-tauri/src/parser/entities/cities.rs:18-30)
Added filtering to handle `Player="-1"` similar to other entity parsers:

```rust
// Player ID - filter out -1 for cities in anarchy/being captured
let player_xml_id = city_node
    .req_attr("Player")?
    .parse::<i32>()?;
let player_xml_id = if player_xml_id >= 0 {
    Some(player_xml_id)
} else {
    None
};
let player_db_id = match player_xml_id {
    Some(id) => Some(id_mapper.get_player(id)?),
    None => None,
};
```

### Test Results

After implementing the fix:
```
running 1 test
Successfully imported match:
  Match ID: Some(1)
  Game ID: c714db09-fc75-407e-a67c-276e8dc871a7
  Is New: true
test parser::tests::tests::test_import_real_save_file ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 21 filtered out; finished in 31.41s
```

### Cities in Anarchy

**What we learned about cities in transitional states:**

In Old World, cities can be temporarily "unowned" during:
- **Anarchy**: City has revolted or lost control (`Player="-1"`, `<Tribe>TRIBE_ANARCHY</Tribe>`)
- **Capture**: City is being captured by another player (`<CaptureTurns>N</CaptureTurns>`)
- **Damage**: City may have damage from sieges (`<Damage>20</Damage>`)

These cities maintain tracking data:
- `<FirstPlayer>`: Original owner
- `<LastPlayer>`: Previous owner before anarchy
- `<CapturePlayer>`: Player attempting to capture
- `Family`: Set to "NONE" when in anarchy

**Database representation:**
- `player_id` is NULL during transitional states
- Foreign key constraint allows NULL (standard SQL behavior)
- Indexes on player_id handle NULL values correctly

### Files Modified

1. `docs/schema.sql` - Line 400: Allow NULL for cities.player_id
2. `src-tauri/src/parser/entities/cities.rs` - Lines 18-30: Filter Player="-1"

### Lessons Learned

1. **Always check real game data**: The XML files contain edge cases not in early test data
2. **Pattern consistency**: All entity parsers that reference players should filter `-1` uniformly
3. **Schema flexibility**: NOT NULL constraints should be carefully considered for game state data
4. **Better error context**: Would have been faster with context parameter in `get_player()`
