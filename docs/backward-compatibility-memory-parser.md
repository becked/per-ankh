# Backward Compatibility: Memory Parser (2024 Save Format)

**Date:** November 6, 2025
**Status:** Not Implemented
**Priority:** Medium

## Problem

The memory parser (`parse_player_memories` in `src-tauri/src/parser/entities/events.rs:414-508`) only supports the 2025 save format. 2024 saves use a different XML structure, causing 0 memory records to be imported from older save files.

**Impact:** Babylonia save (2024-01-31) has 173+ memory entries that are currently ignored.

## Format Differences

### 2024 Format (Not Supported)

```xml
<Player ID="0">
  <MemoryPlayerList>
    <MemoryPlayerData>
      <Type>MEMORYPLAYER_HOSTED_COUNSEL</Type>
      <Player>1</Player>
      <Turn>64</Turn>
    </MemoryPlayerData>
  </MemoryPlayerList>

  <MemoryFamilyList>
    <MemoryFamilyData>
      <Type>MEMORYFAMILY_FAMILY_GIFTS</Type>
      <Family>4</Family>  <!-- Numeric ID -->
      <Turn>84</Turn>
    </MemoryFamilyData>
  </MemoryFamilyList>

  <MemoryCharacterList>
    <MemoryCharacterData>
      <Type>MEMORYCHARACTER_LET_KEEP_LOOT</Type>
      <CharacterID>11</CharacterID>
      <Turn>110</Turn>
    </MemoryCharacterData>
  </MemoryCharacterList>

  <MemoryTribeList>
    <MemoryTribeData>
      <Type>MEMORYTRIBE_ATTACKED_UNIT</Type>
      <Tribe>2</Tribe>  <!-- Numeric ID -->
      <Turn>104</Turn>
    </MemoryTribeData>
  </MemoryTribeList>

  <MemoryReligionList>
    <MemoryReligionData>
      <Type>MEMORYRELIGION_ADOPTED_BURIAL_PRACTICES</Type>
      <Religion>0</Religion>  <!-- Numeric ID -->
      <Turn>56</Turn>
    </MemoryReligionData>
  </MemoryReligionList>
</Player>
```

### 2025 Format (Currently Supported)

```xml
<Player ID="0">
  <MemoryList>
    <MemoryData>
      <Type>MEMORYPLAYER_ATTACKED_CITY</Type>
      <Player>1</Player>
      <Turn>30</Turn>
    </MemoryData>
    <MemoryData>
      <Type>MEMORYFAMILY_FOUNDED_CITY</Type>
      <Family>FAMILY_DIDONIAN</Family>  <!-- String name -->
      <Turn>21</Turn>
    </MemoryData>
    <MemoryData>
      <Type>MEMORYCHARACTER_UPGRADED_RECENTLY</Type>
      <CharacterID>12</CharacterID>
      <Turn>38</Turn>
    </MemoryData>
    <MemoryData>
      <Type>MEMORYTRIBE_ATTACKED_UNIT</Type>
      <Tribe>TRIBE_NUMIDIANS</Tribe>  <!-- String name -->
      <Turn>20</Turn>
    </MemoryData>
    <MemoryData>
      <Type>MEMORYRELIGION_SPREAD_RELIGION</Type>
      <Religion>RELIGION_MANICHAEISM</Religion>  <!-- String name -->
      <Turn>132</Turn>
    </MemoryData>
  </MemoryList>
</Player>
```

## Key Differences

| Aspect                 | 2024                                  | 2025                                                      |
| ---------------------- | ------------------------------------- | --------------------------------------------------------- |
| **Element structure**  | 5 separate lists                      | 1 unified list                                            |
| **List names**         | `Memory{Type}List`                    | `MemoryList`                                              |
| **Data element names** | `Memory{Type}Data`                    | `MemoryData`                                              |
| **Family targets**     | Numeric ID (`<Family>4</Family>`)     | String name (`<Family>FAMILY_DIDONIAN</Family>`)          |
| **Tribe targets**      | Numeric ID (`<Tribe>2</Tribe>`)       | String name (`<Tribe>TRIBE_NUMIDIANS</Tribe>`)            |
| **Religion targets**   | Numeric ID (`<Religion>0</Religion>`) | String name (`<Religion>RELIGION_MANICHAEISM</Religion>`) |

## Implementation Approach (DRY + YAGNI)

### Option 1: Fallback Pattern (Recommended)

Extend the existing `parse_player_memories()` function to:

1. Try parsing `MemoryList` (2025 format) - already works
2. If empty, try parsing legacy lists (2024 format)

**Benefits:**

- Minimal code duplication
- Single function handles both formats
- No need to detect format version upfront

### Option 2: Wrapper Function

Create a new `parse_player_memories_legacy()` function and call both from import.rs.

**Drawbacks:**

- Violates DRY (duplicate logic)
- More complex call site
- Not recommended

## Implementation Steps

### 1. Add ID Mapper Support for Legacy Numeric IDs

The 2024 format stores families/tribes/religions as numeric IDs that need mapping. Check if IdMapper already has methods like:

- `get_family_by_xml_id(i32) -> Result<String>`
- `get_tribe_by_xml_id(i32) -> Result<String>`
- `get_religion_by_xml_id(i32) -> Result<String>`

If not, you may need to:

1. Store numeric-to-string mappings during entity parsing
2. OR just store the numeric ID as a string in the database (simpler, loses semantic info)

**YAGNI Decision:** If family/tribe/religion names aren't used elsewhere, just store numeric IDs as strings (`target_family = "4"`). Don't build infrastructure you don't need.

### 2. Extend `parse_player_memories()` Function

Location: `src-tauri/src/parser/entities/events.rs:414-508`

Add after line 430 (after checking for `MemoryList`):

```rust
// Try 2025 format first (MemoryList)
if let Some(memory_list_node) = player_node
    .children()
    .find(|n| n.has_tag_name("MemoryList"))
{
    // Existing logic (lines 434-505)
}

// Fall back to 2024 format (separate Memory*List elements)
if count == 0 {
    count += parse_legacy_memory_lists(
        player_node,
        conn,
        player_id,
        match_id,
        next_memory_id
    )?;
}
```

### 3. Add Helper Function

Add new function in the same file:

```rust
/// Parse legacy 2024 format with separate Memory*List elements
fn parse_legacy_memory_lists(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
    next_memory_id: &mut i64,
) -> Result<usize> {
    let mut count = 0;

    // List of legacy list types to check
    let legacy_lists = [
        "MemoryPlayerList",
        "MemoryFamilyList",
        "MemoryCharacterList",
        "MemoryTribeList",
        "MemoryReligionList",
    ];

    for list_name in &legacy_lists {
        if let Some(list_node) = player_node
            .children()
            .find(|n| n.has_tag_name(list_name))
        {
            // Determine child element name (e.g., MemoryPlayerData)
            let data_element_name = list_name.replace("List", "Data");

            for memory_node in list_node
                .children()
                .filter(|n| n.has_tag_name(&data_element_name))
            {
                count += parse_legacy_memory_data(
                    &memory_node,
                    conn,
                    player_id,
                    match_id,
                    next_memory_id,
                )?;
            }
        }
    }

    Ok(count)
}

/// Parse a single legacy Memory*Data element
fn parse_legacy_memory_data(
    memory_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
    next_memory_id: &mut i64,
) -> Result<usize> {
    // Extract Type and Turn (required)
    let memory_type = memory_node
        .children()
        .find(|n| n.has_tag_name("Type"))
        .and_then(|n| n.text())
        .ok_or_else(|| ParseError::MissingElement("Memory*Data.Type".to_string()))?;

    let turn: i32 = memory_node
        .children()
        .find(|n| n.has_tag_name("Turn"))
        .and_then(|n| n.text())
        .ok_or_else(|| ParseError::MissingElement("Memory*Data.Turn".to_string()))?
        .parse()
        .map_err(|_| ParseError::InvalidFormat("Memory*Data.Turn must be integer".to_string()))?;

    // Extract optional targets (one will be present)
    // NOTE: 2024 format uses numeric IDs for families/tribes/religions
    let target_player_id = memory_node
        .children()
        .find(|n| n.has_tag_name("Player"))
        .and_then(|n| n.text())
        .and_then(|t| t.parse::<i32>().ok());

    let target_character_id = memory_node
        .children()
        .find(|n| n.has_tag_name("CharacterID"))
        .and_then(|n| n.text())
        .and_then(|t| t.parse::<i32>().ok());

    // YAGNI: Store numeric IDs as strings rather than mapping to names
    // If you need name lookups later, add IdMapper integration then
    let target_family = memory_node
        .children()
        .find(|n| n.has_tag_name("Family"))
        .and_then(|n| n.text());

    let target_tribe = memory_node
        .children()
        .find(|n| n.has_tag_name("Tribe"))
        .and_then(|n| n.text());

    let target_religion = memory_node
        .children()
        .find(|n| n.has_tag_name("Religion"))
        .and_then(|n| n.text());

    let memory_id = *next_memory_id;
    *next_memory_id += 1;

    // Same INSERT as existing function (DRY)
    conn.execute(
        "INSERT INTO memory_data
         (memory_id, player_id, match_id, memory_type, turn,
          target_player_id, target_character_id, target_family, target_tribe, target_religion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            memory_id,
            player_id,
            match_id,
            memory_type,
            turn,
            target_player_id,
            target_character_id,
            target_family,
            target_tribe,
            target_religion
        ],
    )?;

    Ok(1)
}
```

## Testing

1. Import Babylonia 2024 save: Should now import ~173 memory records
2. Import Carthage 2025 save: Should still import 242 memory records (no regression)
3. Query both: `SELECT * FROM memory_data WHERE match_id = X LIMIT 10;`

Expected differences:

- 2024: `target_family` will be "4", `target_tribe` will be "2", etc.
- 2025: `target_family` will be "FAMILY_DIDONIAN", etc.

## Non-Issues (YAGNI)

**Don't implement these unless actually needed:**

1. Name resolution for legacy numeric IDs - just store them as-is
2. Format version detection - fallback pattern handles it automatically
3. Schema changes - existing `memory_data` table works for both formats
4. Migration scripts - data is append-only, no conflicts

## Legitimacy History

**No work needed.** The 2024 format doesn't have `LegitimacyHistory` - it was added in later game versions. The current parser correctly returns 0 rows for older saves.
