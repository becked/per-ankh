# Remove FK Constraints and Simplify Parser

## Phase 1: Remove FK Constraints from Schema

### Files Changed

| File                            | Changes                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/schema.sql`               | Remove all `FOREIGN KEY` constraint lines; add `-- References:` comments; bump schema version; remove obsolete TODO comment about self-referential FKs |
| `src-tauri/src/parser/tests.rs` | Delete the broken `test_import_and_reimport_same_file` test                                                                                            |
| `src-tauri/src/parser/mod.rs`   | Add `SchemaUpgrade(String)` variant to `ParseError` enum                                                                                               |
| `src-tauri/src/db/schema.rs`    | Add schema version check in `ensure_schema_ready()` to detect old schema and trigger reset                                                             |

### Schema Changes

Remove all `FOREIGN KEY (...)` lines from `docs/schema.sql`. Replace with documentation comments.

**Tables with FK constraints to remove:**

| Table                      | FK Constraints to Remove                                      |
| -------------------------- | ------------------------------------------------------------- |
| `matches`                  | `REFERENCES collections(collection_id)`                       |
| `match_settings`           | `FOREIGN KEY (match_id) REFERENCES matches`                   |
| `players`                  | `FOREIGN KEY (match_id) REFERENCES matches`                   |
| `player_resources`         | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `player_council`           | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `characters`               | `FOREIGN KEY (match_id)`, `FOREIGN KEY (player_id, match_id)` |
| `character_traits`         | `FOREIGN KEY (character_id, match_id) REFERENCES characters`  |
| `character_relationships`  | 2x `FOREIGN KEY ... REFERENCES characters`                    |
| `character_marriages`      | 2x `FOREIGN KEY ... REFERENCES characters`                    |
| `character_stats`          | `FOREIGN KEY (character_id, match_id) REFERENCES characters`  |
| `character_missions`       | `FOREIGN KEY (character_id, match_id) REFERENCES characters`  |
| `families`                 | 3x FK (matches, players, characters)                          |
| `family_opinion_history`   | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `family_law_opinions`      | `FOREIGN KEY (family_id, match_id) REFERENCES families`       |
| `religions`                | 3x FK (matches, players, characters)                          |
| `religion_opinion_history` | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `tribes`                   | 3x FK (matches, characters, players)                          |
| `cities`                   | 4x FK (matches, players, 3x characters)                       |
| `city_yields`              | `FOREIGN KEY (city_id, match_id) REFERENCES cities`           |
| `city_culture`             | `FOREIGN KEY (city_id, match_id) REFERENCES cities`           |
| `city_religions`           | `FOREIGN KEY (city_id, match_id) REFERENCES cities`           |
| `city_production_queue`    | `FOREIGN KEY (city_id, match_id) REFERENCES cities`           |
| `city_units_produced`      | `FOREIGN KEY (city_id, match_id) REFERENCES cities`           |
| `city_projects_completed`  | `FOREIGN KEY (city_id, match_id) REFERENCES cities`           |
| `tiles`                    | 3x FK (matches, players, cities)                              |
| `tile_changes`             | `FOREIGN KEY (tile_id, match_id) REFERENCES tiles`            |
| `tile_visibility`          | `FOREIGN KEY (tile_id, match_id) REFERENCES tiles`            |
| `tile_ownership_history`   | 2x FK (tiles, players)                                        |
| `player_units_produced`    | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `technologies_completed`   | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `technology_progress`      | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `technology_states`        | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `laws`                     | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `diplomacy`                | `FOREIGN KEY (match_id) REFERENCES matches`                   |
| `player_goals`             | 2x FK (players, characters)                                   |
| `event_logs`               | 2x FK (matches, players)                                      |
| `story_events`             | 5x FK (matches, players, 2x characters, cities)               |
| `story_choices`            | `FOREIGN KEY (event_id, match_id) REFERENCES story_events`    |
| `event_outcomes`           | 3x FK (matches, story_events, players)                        |
| `memory_data`              | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `yield_history`            | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `points_history`           | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `military_history`         | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `legitimacy_history`       | `FOREIGN KEY (player_id, match_id) REFERENCES players`        |
| `yield_prices`             | `FOREIGN KEY (match_id) REFERENCES matches`                   |

**Example transformation:**

```sql
-- BEFORE
CREATE TABLE cities (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    player_id INTEGER,
    governor_id INTEGER,
    PRIMARY KEY (city_id, match_id),
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id),
    FOREIGN KEY (governor_id, match_id) REFERENCES characters(character_id, match_id)
);

-- AFTER
CREATE TABLE cities (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    player_id INTEGER,  -- References: players(player_id, match_id)
    governor_id INTEGER,  -- References: characters(character_id, match_id)
    PRIMARY KEY (city_id, match_id)
    -- References: matches(match_id) via match_id
);
```

**Remove obsolete TODO comment** (lines 260-265 in characters table):

```sql
-- REMOVE THIS BLOCK:
-- TODO: Self-referential foreign keys disabled due to DuckDB limitation
-- DuckDB blocks UPDATE statements on rows referenced by other rows, even with DEFERRABLE
-- This prevents updating parent relationships when a character is also a parent
-- We validate parent relationships at application level instead
-- FOREIGN KEY (birth_father_id, match_id) REFERENCES characters(character_id, match_id),
-- FOREIGN KEY (birth_mother_id, match_id) REFERENCES characters(character_id, match_id)
```

**Schema version bump:**

```sql
INSERT INTO schema_migrations (version, description) VALUES
('2.6.0', 'Removed FK constraints for ETL performance - relationships documented in comments');
```

### Delete Broken Test

Delete `test_import_and_reimport_same_file` from `src-tauri/src/parser/tests.rs` (lines 107-160). This test was for unimplemented reimport functionality.

### Schema Upgrade Detection

Existing users have databases with FK constraints. Since DuckDB doesn't support `ALTER TABLE DROP CONSTRAINT`, we must reset the database. Detect old schema and trigger the existing reset dialog flow.

#### 1. `src-tauri/src/parser/mod.rs`

Add new error variant:

```rust
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    // ... existing variants ...

    #[error("Schema upgrade required: {0}")]
    SchemaUpgrade(String),
}
```

#### 2. `src-tauri/src/db/schema.rs`

In `ensure_schema_ready()`, after the `schema_exists` check and before `migrate_schema()`:

```rust
// Check if schema requires breaking upgrade (v2.6.0 removes FK constraints)
// This cannot be migrated incrementally - requires full reset
if schema_exists {
    let has_v260 = conn
        .query_row(
            "SELECT 1 FROM schema_migrations WHERE version = '2.6.0'",
            [],
            |_| Ok(()),
        )
        .is_ok();

    if !has_v260 {
        log::warn!("Schema version < 2.6.0 detected, database reset required for FK removal");
        return Err(crate::parser::ParseError::SchemaUpgrade(
            "Database schema has been updated (v2.6.0) and requires a reset. \
             Your imported games will need to be re-imported after the reset.".to_string()
        ).into());
    }
}
```

This piggybacks on the existing error handling in `lib.rs:1595-1643`:

1. `ensure_schema_ready()` returns error
2. Dialog shown: "Database initialization failed... Would you like to reset?"
3. User clicks OK → recovery marker written → restart prompt
4. On restart → fresh v2.6.0 schema created

### Unit Tests

**File: `src-tauri/src/db/schema.rs`**

```rust
#[test]
fn test_schema_has_no_foreign_keys() {
    let schema_sql = include_str!("../../../docs/schema.sql");
    let fk_count = schema_sql
        .lines()
        .filter(|line| {
            let trimmed = line.trim().to_uppercase();
            trimmed.starts_with("FOREIGN KEY")
        })
        .count();
    assert_eq!(fk_count, 0, "Schema should have no FOREIGN KEY constraints");
}

#[test]
fn test_old_schema_triggers_upgrade_error() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("test.db");
    let conn = Connection::open(&db_path).unwrap();

    // Create old schema (pre-2.6.0) with just enough to pass schema_exists check
    conn.execute_batch(
        "CREATE TABLE matches (match_id BIGINT PRIMARY KEY);
         CREATE TABLE schema_migrations (version VARCHAR PRIMARY KEY);
         INSERT INTO schema_migrations (version) VALUES ('2.5.0');"
    ).unwrap();
    drop(conn);

    // ensure_schema_ready should return error for old schema
    let result = ensure_schema_ready(&db_path);
    assert!(result.is_err());
    let err_msg = result.unwrap_err().to_string();
    assert!(err_msg.contains("v2.6.0") || err_msg.contains("reset"),
            "Error should mention v2.6.0 or reset: {}", err_msg);
}
```

---

## Phase 2: Simplify Parser - Remove Multi-Pass Logic

### Files Changed

| File                                              | Changes                                                                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src-tauri/src/parser/import.rs`                  | Remove Pass 2a/2d orchestration; merge into single-pass flow; reduce TOTAL_PHASES from 8 to 6                                                                                                                      |
| `src-tauri/src/parser/inserters/characters.rs`    | Accept parent IDs directly in single pass; rename `insert_characters_core` to `insert_characters`; use two-phase ID mapping                                                                                        |
| `src-tauri/src/parser/parsers/characters.rs`      | Parse `BirthFatherID`, `BirthMotherID`, `BirthCityID` inline with core data                                                                                                                                        |
| `src-tauri/src/parser/entities/character_data.rs` | Delete `parse_character_parent_relationships()` and `parse_character_birth_city()` functions; delete wrapper functions `parse_character_parent_relationships_pass2a()` and `parse_character_birth_cities_pass2b()` |
| `src-tauri/src/parser/game_data.rs`               | Add `birth_father_xml_id`, `birth_mother_xml_id`, `birth_city_xml_id` fields to `CharacterData` struct                                                                                                             |

### Code Changes

#### 1. `src-tauri/src/parser/game_data.rs`

Add parent/birth_city fields to `CharacterData`:

```rust
pub struct CharacterData {
    // ... existing fields ...
    pub birth_father_xml_id: Option<i32>,  // NEW
    pub birth_mother_xml_id: Option<i32>,  // NEW
    pub birth_city_xml_id: Option<i32>,    // NEW
}
```

#### 2. `src-tauri/src/parser/parsers/characters.rs`

Parse parent relationships inline:

```rust
// In parse_character_node():
let birth_father_xml_id: Option<i32> = node
    .children()
    .find(|n| n.has_tag_name("BirthFatherID"))
    .and_then(|n| n.text())
    .and_then(|s| s.parse().ok());

let birth_mother_xml_id: Option<i32> = node
    .children()
    .find(|n| n.has_tag_name("BirthMotherID"))
    .and_then(|n| n.text())
    .and_then(|s| s.parse().ok());

let birth_city_xml_id: Option<i32> = node
    .children()
    .find(|n| n.has_tag_name("BirthCityID"))
    .and_then(|n| n.text())
    .and_then(|s| s.parse().ok());
```

#### 3. `src-tauri/src/parser/inserters/characters.rs`

Rename `insert_characters_core` → `insert_characters`. Use two-phase ID mapping:

```rust
pub fn insert_characters(
    conn: &Connection,
    characters: &[CharacterData],
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    // Phase 1: Assign DB IDs to ALL characters first
    for character in characters {
        id_mapper.map_character(character.xml_id);
    }

    // Phase 2: Build rows with parent lookups (now guaranteed to find all IDs)
    let mut rows = Vec::new();
    for character in characters {
        let db_id = id_mapper.get_character(character.xml_id)?;

        let player_db_id = character.player_xml_id
            .and_then(|id| id_mapper.get_player(id).ok());

        // Parent lookups now work because all characters have DB IDs
        let birth_father_db_id = character.birth_father_xml_id
            .and_then(|id| id_mapper.get_character(id).ok());

        let birth_mother_db_id = character.birth_mother_xml_id
            .and_then(|id| id_mapper.get_character(id).ok());

        // Birth city still NULL here - updated after cities inserted
        let birth_city_db_id: Option<i64> = None;

        rows.push((
            db_id,
            id_mapper.match_id,
            character.xml_id,
            // ... rest of fields including birth_father_db_id, birth_mother_db_id ...
        ));
    }

    // ... rest of insertion logic unchanged ...
}
```

#### 4. `src-tauri/src/parser/entities/character_data.rs`

Delete these functions entirely:

- `parse_character_parent_relationships()` (lines 335-377)
- `parse_character_birth_city()` (lines 390-419)
- `parse_character_parent_relationships_pass2a()` wrapper
- `parse_character_birth_cities_pass2b()` wrapper

#### 5. `src-tauri/src/parser/import.rs`

Remove multi-pass orchestration:

```rust
// UPDATE constant
const TOTAL_PHASES: usize = 6;

// REMOVE these blocks (lines 423-431, 465-471):
// - "CRITICAL FIX: Pass 2a - Parse parent relationships..."
// - "Pass 2d - Parse birth cities after cities are created..."
```

**New simplified flow:**

```
Phase 1: Parse XML
Phase 2: Insert foundation (players, characters, tiles, cities) + update birth_city_id
Phase 3: Insert affiliations (tribes, families, religions)
Phase 4: Insert extended data (gameplay, diplomacy, time-series)
Phase 5: Insert events
Phase 6: Finalize (save ID mappings)
```

#### 6. Birth city handling

Birth cities reference the `cities` table, which is inserted AFTER characters. Keep a single UPDATE pass for `birth_city_id` after cities are inserted. This is unavoidable due to circular reference (`characters.birth_city_id` ↔ `cities.governor_id`).

```rust
// After cities insertion, update birth_city_id for characters
fn update_character_birth_cities(
    conn: &Connection,
    characters: &[CharacterData],
    id_mapper: &IdMapper,
) -> Result<()> {
    for character in characters {
        if let Some(city_xml_id) = character.birth_city_xml_id {
            if let Ok(city_db_id) = id_mapper.get_city(city_xml_id) {
                let char_db_id = id_mapper.get_character(character.xml_id)?;
                conn.execute(
                    "UPDATE characters SET birth_city_id = ? WHERE character_id = ? AND match_id = ?",
                    params![city_db_id, char_db_id, id_mapper.match_id],
                )?;
            }
        }
    }
    Ok(())
}
```

### Unit Tests

**File: `src-tauri/src/parser/inserters/characters.rs`** (new test module)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::parser::game_data::CharacterData;
    use crate::parser::id_mapper::IdMapper;
    use duckdb::Connection;
    use tempfile::tempdir;

    fn setup_test_db() -> (Connection, tempfile::TempDir) {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        db::ensure_schema_ready(&db_path).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "INSERT INTO matches (match_id, file_name, file_hash, game_id, total_turns)
             VALUES (1, 'test.zip', 'hash', 'game1', 100)",
            [],
        ).unwrap();
        (conn, dir)
    }

    #[test]
    fn test_insert_characters_with_parent_ids() {
        let (conn, _dir) = setup_test_db();
        let mut id_mapper = IdMapper::new(1, &conn, true).unwrap();

        let parent = CharacterData {
            xml_id: 1,
            first_name: Some("Parent".to_string()),
            birth_turn: 0,
            birth_father_xml_id: None,
            birth_mother_xml_id: None,
            birth_city_xml_id: None,
            ..Default::default()
        };

        let child = CharacterData {
            xml_id: 2,
            first_name: Some("Child".to_string()),
            birth_turn: 10,
            birth_father_xml_id: Some(1),
            birth_mother_xml_id: None,
            birth_city_xml_id: None,
            ..Default::default()
        };

        let characters = vec![parent, child];
        let count = insert_characters(&conn, &characters, &mut id_mapper).unwrap();
        assert_eq!(count, 2);

        // Verify parent relationship was set
        let child_father: Option<i64> = conn
            .query_row(
                "SELECT birth_father_id FROM characters WHERE xml_id = 2 AND match_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        let parent_db_id = id_mapper.get_character(1).unwrap();
        assert_eq!(child_father, Some(parent_db_id));
    }

    #[test]
    fn test_insert_characters_missing_parent_graceful() {
        let (conn, _dir) = setup_test_db();
        let mut id_mapper = IdMapper::new(1, &conn, true).unwrap();

        let child = CharacterData {
            xml_id: 2,
            first_name: Some("Orphan".to_string()),
            birth_turn: 10,
            birth_father_xml_id: Some(999),  // Non-existent
            birth_mother_xml_id: None,
            birth_city_xml_id: None,
            ..Default::default()
        };

        let characters = vec![child];
        let count = insert_characters(&conn, &characters, &mut id_mapper).unwrap();
        assert_eq!(count, 1);

        // Parent should be NULL (graceful handling)
        let child_father: Option<i64> = conn
            .query_row(
                "SELECT birth_father_id FROM characters WHERE xml_id = 2 AND match_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(child_father, None);
    }
}
```

**File: `src-tauri/src/parser/tests.rs`**

Add assertion to `test_import_real_save_file` to verify parent relationships are populated:

```rust
// Add after existing assertions:
let parents_set: i64 = conn
    .query_row(
        "SELECT COUNT(*) FROM characters
         WHERE match_id = ? AND (birth_father_id IS NOT NULL OR birth_mother_id IS NOT NULL)",
        [import_result.match_id.unwrap()],
        |row| row.get(0),
    )
    .unwrap();

assert!(parents_set > 0, "Some characters should have parent relationships set");
```
