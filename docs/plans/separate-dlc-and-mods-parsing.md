# Separate DLC and Mods Parsing

## Overview

The Version attribute in save files contains **mods only**. Actual DLCs are listed in the `<GameContent>` element. This plan separates the two by:

1. Renaming the current `enabled_dlc` column/field to `enabled_mods`
2. Adding new `enabled_dlc` column/field that parses from `<GameContent>`

---

## Phase 1: Schema Update

**Affected Files:**
| File | Changes |
|------|---------|
| `docs/schema.sql` | Rename `enabled_dlc` → `enabled_mods`, add new `enabled_dlc` column |

**Changes:**

In the `matches` table definition, find:

```sql
enabled_dlc TEXT, -- DLC list (e.g., "New Portraits+Nobles of the Settled Lands 1+...")
```

Replace with:

```sql
enabled_mods TEXT, -- Mod list from Version string (e.g., "name-every-child1+different-leaders1")
enabled_dlc TEXT, -- DLC list from GameContent (e.g., "DLC_HEROES_OF_AEGEAN+DLC_THE_SACRED_AND_THE_PROFANE")
```

---

## Phase 2: Parsing Updates

**Affected Files:**
| File | Changes |
|------|---------|
| `src-tauri/src/parser/import.rs` | Rename function, add GameContent parser, update INSERT query |

### 2.1 Rename `parse_version_string` return semantics

Update function at line ~937:

- Rename second tuple element from `dlcs` to `mods` in all variable names
- Update doc comment to clarify it returns mods, not DLCs

```rust
/// Parse version string from Root element
/// Format: "Version: 1.0.70671+mod1+mod2+...=-123456"
/// Returns (version_number, mods_list_string)
fn parse_version_string(version: &str) -> (Option<String>, Option<String>) {
    let parts: Vec<&str> = version.split('+').collect();
    if parts.is_empty() {
        return (None, None);
    }

    let version_num = parts[0]
        .strip_prefix("Version: ")
        .map(|v| v.to_string());

    // Remaining parts are mods (join back, exclude checksum at end)
    let mods = if parts.len() > 1 {
        let mod_parts: Vec<&str> = parts[1..]
            .iter()
            .map(|s| s.split('=').next().unwrap_or(s))
            .collect();
        Some(mod_parts.join("+"))
    } else {
        None
    };

    (version_num, mods)
}
```

### 2.2 Add `parse_game_content` function

Add new function near `parse_version_string`:

```rust
/// Parse GameContent element to extract enabled DLCs
/// Format: <GameContent><DLC_HEROES_OF_AEGEAN /><DLC_THE_SACRED_AND_THE_PROFANE />...</GameContent>
/// Returns DLC names joined with "+" (e.g., "DLC_HEROES_OF_AEGEAN+DLC_THE_SACRED_AND_THE_PROFANE")
fn parse_game_content(root: &Element) -> Option<String> {
    let game_content = root.get_child("GameContent")?;

    let dlcs: Vec<&str> = game_content
        .children()
        .filter_map(|child| child.as_element())
        .map(|el| el.name())
        .filter(|name| name.starts_with("DLC_"))
        .collect();

    if dlcs.is_empty() {
        None
    } else {
        Some(dlcs.join("+"))
    }
}
```

### 2.3 Update import_match_data function

At line ~1117, update variable naming:

```rust
// Before:
let (game_version, enabled_dlc) = root
    .opt_attr("Version")
    .map(parse_version_string)
    .unwrap_or((None, None));

// After:
let (game_version, enabled_mods) = root
    .opt_attr("Version")
    .map(parse_version_string)
    .unwrap_or((None, None));

let enabled_dlc = parse_game_content(root);
```

### 2.4 Update INSERT query

At lines ~1202-1239, update column list and params:

```rust
tx.execute(
    "INSERT INTO matches (
        match_id, file_name, file_hash, game_id, game_name, save_date,
        total_turns,
        map_width, map_height, map_size, map_class, map_aspect_ratio,
        min_latitude, max_latitude,
        game_mode, turn_style, turn_timer, turn_scale, simultaneous_turns,
        opponent_level, tribe_level, development, advantage,
        succession_gender, succession_order, mortality, event_level,
        victory_point_modifier, force_march, team_nation,
        victory_conditions,
        first_seed, map_seed,
        game_version, enabled_mods, enabled_dlc
    ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?,
        ?, ?,
        ?, ?, ?
    )",
    params![
        match_id, file_name, file_hash, game_id, game_name, save_date,
        total_turns,
        map_width, map_height, map_size, map_class, map_aspect_ratio,
        min_latitude, max_latitude,
        game_mode, turn_style, turn_timer, turn_scale, simultaneous_turns,
        opponent_level, tribe_level, development, advantage,
        succession_gender, succession_order, mortality, event_level,
        victory_point_modifier, force_march, team_nation,
        victory_conditions,
        first_seed, map_seed,
        game_version, enabled_mods, enabled_dlc
    ],
)?;
```

### 2.5 Unit Test

Add test in the `mod tests` section of `import.rs`:

```rust
#[test]
fn test_parse_game_content() {
    // Test with DLCs present
    let xml = r#"<Root><GameContent><DLC_HEROES_OF_AEGEAN /><DLC_THE_SACRED_AND_THE_PROFANE /></GameContent></Root>"#;
    let root = Element::parse(xml.as_bytes()).unwrap();
    let result = parse_game_content(&root);
    assert_eq!(result, Some("DLC_HEROES_OF_AEGEAN+DLC_THE_SACRED_AND_THE_PROFANE".to_string()));

    // Test with no DLCs (empty GameContent)
    let xml_empty = r#"<Root><GameContent></GameContent></Root>"#;
    let root_empty = Element::parse(xml_empty.as_bytes()).unwrap();
    let result_empty = parse_game_content(&root_empty);
    assert_eq!(result_empty, None);

    // Test with no GameContent element
    let xml_missing = r#"<Root></Root>"#;
    let root_missing = Element::parse(xml_missing.as_bytes()).unwrap();
    let result_missing = parse_game_content(&root_missing);
    assert_eq!(result_missing, None);

    // Test filtering non-DLC children
    let xml_mixed = r#"<Root><GameContent><DLC_CALAMITIES /><SOME_OTHER_THING /></GameContent></Root>"#;
    let root_mixed = Element::parse(xml_mixed.as_bytes()).unwrap();
    let result_mixed = parse_game_content(&root_mixed);
    assert_eq!(result_mixed, Some("DLC_CALAMITIES".to_string()));
}
```

---

## Phase 3: Type Updates

**Affected Files:**
| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | Rename field, add new field, update SELECT query |

### 3.1 Update GameDetails struct

At line ~72:

```rust
// Before:
pub enabled_dlc: Option<String>,

// After:
pub enabled_mods: Option<String>,
pub enabled_dlc: Option<String>,
```

### 3.2 Update SELECT query

At lines ~347-349, update the SELECT:

```rust
// Before:
"SELECT m.match_id, m.game_name, CAST(m.save_date AS VARCHAR) as save_date,
        m.total_turns, m.map_size, m.map_width, m.map_height, m.map_class,
        m.game_mode, m.opponent_level, m.victory_conditions, m.enabled_dlc,
        m.winner_player_id,

// After:
"SELECT m.match_id, m.game_name, CAST(m.save_date AS VARCHAR) as save_date,
        m.total_turns, m.map_size, m.map_width, m.map_height, m.map_class,
        m.game_mode, m.opponent_level, m.victory_conditions, m.enabled_mods, m.enabled_dlc,
        m.winner_player_id,
```

### 3.3 Update row mapping

At lines ~370-373, update the field extraction:

```rust
// Before:
game_mode: row.get(8)?,
opponent_level: row.get(9)?,
victory_conditions: row.get(10)?,
enabled_dlc: row.get(11)?,
winner_player_id: row.get(12)?,

// After:
game_mode: row.get(8)?,
opponent_level: row.get(9)?,
victory_conditions: row.get(10)?,
enabled_mods: row.get(11)?,
enabled_dlc: row.get(12)?,
winner_player_id: row.get(13)?,
```

**Important:** All subsequent `row.get(N)` indices after `enabled_dlc` must be incremented by 1.

---

## Phase 4: TypeScript Types (Auto-generated)

**Affected Files:**
| File | Changes |
|------|---------|
| `src/lib/types/GameDetails.ts` | Auto-regenerated by `cargo test` |

Run `cargo test --lib export_bindings` to regenerate TypeScript types.

The generated type will include:

```typescript
enabled_mods: string | null;
enabled_dlc: string | null;
```

---

## Verification

After implementation:

1. `cargo check` - Ensure Rust compiles
2. `cargo test` - Run unit tests including the new `test_parse_game_content`
3. `cargo clippy` - Check for lints
4. Delete database file, restart app, import a save file
5. Verify in UI: mods appear in mods field, DLCs appear in DLC field
