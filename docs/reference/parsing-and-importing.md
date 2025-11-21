# Parsing and Importing Guide

A comprehensive guide to how Per-Ankh ingests Old World save files and loads them into DuckDB.

**Audience:** Senior Rust developers new to the project

---

## Table of Contents

1. [Overview](#overview)
2. [Save File Format](#save-file-format)
3. [Module Organization](#module-organization)
4. [Data Flow Pipeline](#data-flow-pipeline)
5. [Key Data Structures](#key-data-structures)
6. [ID Mapping System](#id-mapping-system)
7. [Parsing Patterns](#parsing-patterns)
8. [Insertion Patterns](#insertion-patterns)
9. [Concurrency and Locking](#concurrency-and-locking)
10. [Error Handling](#error-handling)
11. [Performance Optimizations](#performance-optimizations)
12. [Adding a New Entity Type](#adding-a-new-entity-type)
13. [Common Gotchas](#common-gotchas)

---

## Overview

Per-Ankh imports Old World game save files through a multi-phase pipeline:

```
ZIP Archive → XML Extraction → DOM Parsing → Typed Structs → Database Insertion
```

Key architectural decisions:

- **Separation of concerns**: Parsers are pure functions (XML → structs), inserters handle DB operations
- **Parallel parsing**: Foundation entities are parsed concurrently via rayon
- **Sequential insertion**: Entity insertion order respects foreign key dependencies
- **ID mapping**: XML IDs are translated to stable database IDs that persist across re-imports
- **Transaction-based locking**: Prevents concurrent imports of the same game

---

## Save File Format

### File Structure

Old World save files are ZIP archives containing a single XML file:

```
match_426504721_player-vs-opponent.zip
└── OW-Persia-Year69-2025-09-20-09-47-27.xml  (2-10 MB uncompressed)
```

### Security Constraints

The save file extractor (`save_file.rs`) enforces:

| Constraint | Value |
|------------|-------|
| Max compressed size | 50 MB |
| Max uncompressed size | 100 MB |
| Max archive entries | 10 |
| Max compression ratio | 100:1 (zip bomb detection) |
| Path validation | No `..`, `/`, control characters |
| Encoding | UTF-8 required |

### XML Structure

```xml
<?xml version="1.0" encoding="utf-8"?>
<Root GameId="abc-123-def" MapSize="MAPSIZE_SMALLEST" ...>
    <Game>
        <Turn>69</Turn>
        <Seed>18046197663754941529</Seed>
        ...
    </Game>
    <Player ID="0" Name="human" Nation="NATION_PERSIA" ...>
        <Legitimacy>100</Legitimacy>
        <TechResearching>TECH_STONECUTTING</TechResearching>
        <PointsHistory>
            <T2>0</T2><T3>2</T3>...
        </PointsHistory>
        ...
    </Player>
    <Player ID="1" Name="opponent" Nation="NATION_GREECE" ...>
        ...
    </Player>
    <Character ID="0" BirthTurn="-20" Player="-1" ...>
        ...
    </Character>
    <City ID="0" TileID="1292" Player="1" ...>
        ...
    </City>
    <Tile>
        <X>15</X><Y>22</Y>
        ...
    </Tile>
    <!-- Thousands more Tile, Character, etc. elements -->
</Root>
```

**Key points:**

- Root element has ~31 attributes (game settings, map configuration)
- Entity IDs are 0-based (`ID="0"` is valid!)
- `Player="-1"` means "no player" (e.g., dead characters, barbarians)
- Time-series data uses `<T{turn}>{value}</T{turn}>` format
- Player elements have ~75 different child element types

For complete XML format documentation, see `docs/save-file-format.md`.

---

## Module Organization

```
src-tauri/src/
├── lib.rs                          # Tauri commands, DB queries
├── parser/
│   ├── mod.rs                      # Module exports, ParseError enum
│   ├── save_file.rs                # ZIP extraction and validation
│   ├── xml_loader.rs               # roxmltree parsing, XmlNodeExt trait
│   ├── id_mapper.rs                # XML ID → DB ID translation
│   ├── import.rs                   # Import orchestration
│   ├── game_data.rs                # Intermediate typed structs (PlayerData, etc.)
│   ├── utils.rs                    # deduplicate_rows_last_wins, etc.
│   │
│   ├── parsers/                    # Pure parsing functions (no DB)
│   │   ├── mod.rs                  # Parallel orchestration
│   │   ├── players.rs              # parse_players_struct()
│   │   ├── characters.rs           # parse_characters_struct()
│   │   ├── cities.rs               # parse_cities_struct()
│   │   ├── tiles.rs                # parse_tiles_struct()
│   │   ├── families.rs
│   │   ├── religions.rs
│   │   ├── tribes.rs
│   │   ├── player_data.rs          # Technology, laws, goals
│   │   ├── character_data.rs       # Stats, traits, relationships
│   │   ├── city_data.rs            # Yields, culture, production
│   │   ├── tile_data.rs            # Visibility, improvements
│   │   ├── timeseries.rs           # Points, military, legitimacy history
│   │   ├── diplomacy.rs
│   │   └── events.rs               # Story events, event logs
│   │
│   ├── inserters/                  # Database insertion functions
│   │   └── [mirrors parsers/ structure]
│   │
│   └── entities/                   # Extended data struct definitions
│       └── [mirrors parsers/ structure]
│
├── db/
│   ├── mod.rs                      # Module exports
│   ├── schema.rs                   # Schema creation from docs/schema.sql
│   └── connection.rs               # Connection pool, path management
│
└── main.rs                         # Tauri app entry point
```

### Design Principle: Parser/Inserter Separation

Each entity type has two corresponding modules:

| Module | Responsibility | Dependencies |
|--------|----------------|--------------|
| `parsers/foo.rs` | XML → `FooData` struct | XML document only |
| `inserters/foo.rs` | `FooData` → database rows | DB connection, IdMapper |

This separation enables:
- **Parallel parsing**: No shared mutable state (DB connection)
- **Testability**: Parsers can be tested without database setup
- **Caching**: Intermediate structs can be reused or inspected

---

## Data Flow Pipeline

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  import_save_file() - src/parser/import.rs:156                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 1: Extract & Parse                                           │
│  ┌─────────────────────┐    ┌─────────────────────┐                │
│  │ validate_and_       │    │ parse_xml()         │                │
│  │ extract_xml()       │───▶│ (roxmltree DOM)     │                │
│  │ ZIP → String        │    │ String → XmlDocument │               │
│  └─────────────────────┘    └─────────────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 2: Acquire Locks                                             │
│  ┌─────────────────────┐    ┌─────────────────────┐                │
│  │ acquire_process_    │    │ acquire_db_lock()   │                │
│  │ lock() (Mutex)      │    │ (INSERT match_locks)│                │
│  └─────────────────────┘    └─────────────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 3: Check Duplicate / Create Match                            │
│  • Query: "SELECT match_id FROM matches WHERE game_id=? AND turn=?" │
│  • If exists: return early (already imported)                       │
│  • Else: generate new match_id, create IdMapper                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 4: Parallel Foundation Parsing                               │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │  rayon::join(                                                  ││
│  │    || rayon::join(parse_players, parse_characters),            ││
│  │    || rayon::join(parse_cities, parse_tiles),                  ││
│  │  )                                                             ││
│  └────────────────────────────────────────────────────────────────┘│
│  Output: (Vec<PlayerData>, Vec<CharacterData>,                      │
│           Vec<CityData>, Vec<TileData>)                             │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 5: Sequential Foundation Insertion (FK order)                │
│                                                                     │
│  1. insert_players()       ← No dependencies                        │
│  2. insert_characters_core() ← depends: players                     │
│  3. Pass 2a: update character parent relationships                  │
│  4. insert_tiles_core()    ← depends: players                       │
│  5. insert_cities()        ← depends: players, tiles                │
│  6. Pass 2b: update tile city ownership                             │
│  7. Pass 2c: parse tile ownership history                           │
│  8. Pass 2d: update character birth cities                          │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 6: Affiliation Entities (parallel parse, sequential insert)  │
│  • Families, Religions, Tribes                                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 7-12: Extended Data                                          │
│  • Unit production, player data (tech, laws, goals)                 │
│  • Diplomacy, time-series history                                   │
│  • Character extended (stats, traits, relationships)                │
│  • City extended (yields, culture, production)                      │
│  • Tile extended (visibility, changes)                              │
│  • Story events, event logs                                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 13: Finalize                                                 │
│  • id_mapper.save_mappings()  ← Persist XML→DB ID mappings          │
│  • release_db_lock()                                                │
│  • tx.commit()                                                      │
│  • app.emit("import-complete", ...)                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### Multi-Pass Architecture

Some data requires multiple passes because:

1. **FK dependencies**: Can't insert cities before tiles (city references tile_id)
2. **Circular references**: Character parent IDs reference other characters
3. **Late-bound data**: Tile city ownership is only known after cities are inserted

The import uses these passes:

| Pass | Purpose | Why separate? |
|------|---------|---------------|
| 2a | Character parent relationships | DuckDB FK constraint: can't update character after it's referenced |
| 2b | Tile city ownership | City must be inserted first to get city_id |
| 2c | Tile ownership history | Depends on tiles being inserted |
| 2d | Character birth cities | Depends on cities being inserted |

---

## Key Data Structures

### Intermediate Data Structs

Located in `parser/game_data.rs`. These hold parsed XML data before DB insertion:

```rust
// parser/game_data.rs

/// Parsed player data - uses XML IDs, not DB IDs
pub struct PlayerData {
    pub xml_id: i32,                          // From <Player ID="0">
    pub player_name: String,
    pub nation: Option<String>,               // NATION_PERSIA
    pub dynasty: Option<String>,              // DYNASTY_CYRUS
    pub team_id: Option<String>,
    pub is_human: bool,
    pub online_id: Option<String>,
    pub email: Option<String>,
    pub difficulty: Option<String>,
    pub last_turn_completed: Option<i32>,
    pub turn_ended: bool,
    pub legitimacy: Option<i32>,
    pub succession_gender: Option<String>,
    pub state_religion: Option<String>,
    pub founder_character_xml_id: Option<i32>,      // XML ID, resolved later
    pub chosen_heir_xml_id: Option<i32>,            // XML ID, resolved later
    pub original_capital_city_xml_id: Option<i32>,  // XML ID, resolved later
    pub time_stockpile: Option<i32>,
    pub tech_researching: Option<String>,
    pub ambition_delay: i32,
    pub tiles_purchased: i32,
    pub state_religion_changes: i32,
    pub tribe_mercenaries_hired: i32,
}

pub struct CharacterData {
    pub xml_id: i32,
    pub first_name: Option<String>,
    pub gender: Option<String>,
    pub player_xml_id: Option<i32>,           // -1 means no player
    pub tribe: Option<String>,
    pub family: Option<String>,
    pub nation: Option<String>,
    pub religion: Option<String>,
    pub birth_turn: i32,
    pub death_turn: Option<i32>,
    pub death_reason: Option<String>,
    pub birth_father_xml_id: Option<i32>,     // Set in Pass 2a
    pub birth_mother_xml_id: Option<i32>,     // Set in Pass 2a
    pub birth_city_xml_id: Option<i32>,       // Set in Pass 2d
    // ... many more fields
}

pub struct CityData {
    pub xml_id: i32,
    pub city_name: String,
    pub tile_xml_id: i32,                     // Location on map
    pub player_xml_id: Option<i32>,           // Owner
    pub family: Option<String>,
    pub founded_turn: Option<i32>,
    pub citizens: Option<i32>,
    pub is_capital: bool,
    // ...
}

pub struct TileData {
    pub xml_id: i32,
    pub x: i32,
    pub y: i32,
    pub terrain: Option<String>,
    pub height: Option<String>,
    pub vegetation: Option<String>,
    pub player_xml_id: Option<i32>,           // Current owner
    pub city_xml_id: Option<i32>,             // Set in Pass 2b
    // ...
}
```

**Key pattern**: Data structs use `xml_id` fields for references, which are translated to `db_id` during insertion via `IdMapper`.

### XmlDocument and XmlNodeExt

Located in `parser/xml_loader.rs`:

```rust
// parser/xml_loader.rs

/// Wrapper around roxmltree Document with owned string lifetime
pub struct XmlDocument {
    // The XML string is leaked to obtain 'static lifetime
    // This is safe because XmlDocument owns the string and drops it
    doc: roxmltree::Document<'static>,
    _xml_string: *const str,  // Raw pointer for deallocation
}

/// Extension trait for convenient XML node access
pub trait XmlNodeExt<'a> {
    /// Required attribute (returns error if missing)
    fn req_attr(&self, name: &str) -> Result<&'a str>;

    /// Optional attribute
    fn opt_attr(&self, name: &str) -> Option<&'a str>;

    /// Required child element text
    fn req_child_text(&self, name: &str) -> Result<&'a str>;

    /// Optional child element text
    fn opt_child_text(&self, name: &str) -> Option<&'a str>;
}
```

Usage in parsers:

```rust
// Example: parsing a player element
let xml_id = player_node.req_attr("ID")?.parse::<i32>()?;
let player_name = player_node.req_attr("Name")?.to_string();
let nation = player_node.opt_attr("Nation").map(|s| s.to_string());
let legitimacy = player_node
    .opt_child_text("Legitimacy")
    .and_then(|s| s.parse::<i32>().ok());
```

---

## ID Mapping System

### Problem Statement

Old World XML uses 0-based integer IDs (`<Player ID="0">`). We need to:

1. Translate these to database IDs
2. Keep IDs stable across re-imports of the same game
3. Handle ID gaps and sparse allocations

### IdMapper Implementation

```rust
// parser/id_mapper.rs

pub struct IdMapper {
    pub match_id: i64,

    // XML ID → Database ID mappings (one per entity type)
    players: HashMap<i32, i64>,
    characters: HashMap<i32, i64>,
    cities: HashMap<i32, i64>,
    units: HashMap<i32, i64>,
    tiles: HashMap<i32, i64>,
    families: HashMap<i32, i64>,
    religions: HashMap<i32, i64>,
    religion_names: HashMap<String, i64>,  // For name-based lookup
    tribes: HashMap<i32, i64>,

    // Sequence generators (next available ID for new entities)
    next_player_id: i64,
    next_character_id: i64,
    // ... etc
}

impl IdMapper {
    /// Map XML ID to DB ID, creating new mapping if needed
    pub fn map_player(&mut self, xml_id: i32) -> i64 {
        *self.players.entry(xml_id).or_insert_with(|| {
            let id = self.next_player_id;
            self.next_player_id += 1;
            id
        })
    }

    /// Get existing mapping (for FK resolution)
    pub fn get_character(&self, xml_id: i32) -> Result<i64> {
        self.characters
            .get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownCharacterId(xml_id))
    }

    /// Save all mappings to database for future re-imports
    pub fn save_mappings(&self, conn: &Connection) -> Result<()> {
        // INSERT INTO id_mappings (match_id, entity_type, xml_id, db_id)
        // ...
    }
}
```

### ID Mapping Workflow

```
First Import:
  XML: <Player ID="0"> → IdMapper.map_player(0) → returns 1 (fresh)
  XML: <Player ID="1"> → IdMapper.map_player(1) → returns 2 (fresh)
  After import: save_mappings() → id_mappings table

Re-Import Same Game:
  IdMapper::new(match_id, conn, is_new=false)
    → loads from id_mappings: {0→1, 1→2}
  XML: <Player ID="0"> → IdMapper.map_player(0) → returns 1 (cached)
  XML: <Player ID="1"> → IdMapper.map_player(1) → returns 2 (cached)
```

### Database Storage

```sql
-- id_mappings table
CREATE TABLE id_mappings (
    match_id BIGINT NOT NULL,
    entity_type VARCHAR NOT NULL,  -- 'player', 'character', etc.
    xml_id INTEGER NOT NULL,
    db_id BIGINT NOT NULL,
    UNIQUE (match_id, entity_type, xml_id)
);
```

---

## Parsing Patterns

### Pure Parser Pattern

Parsers are pure functions: XML in, structs out. No side effects.

```rust
// parser/parsers/players.rs

/// Parse all players from XML document into typed structs
///
/// This function is pure - it only reads XML and returns data structures.
/// No database interaction, no ID mapping. This enables:
/// - Testing without DB setup
/// - Parallel execution (no shared mutable state)
/// - Caching intermediate results
pub fn parse_players_struct(doc: &XmlDocument) -> Result<Vec<PlayerData>> {
    let root = doc.root_element();
    let mut players = Vec::new();

    // Find all Player elements as direct children of Root
    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        // Required attributes (will error if missing)
        let xml_id = player_node.req_attr("ID")?.parse::<i32>()?;
        let player_name = player_node.req_attr("Name")?.to_string();

        // Optional attributes
        let nation = player_node.opt_attr("Nation").map(|s| s.to_string());
        let dynasty = player_node.opt_attr("Dynasty").map(|s| s.to_string());

        // Child element text
        let legitimacy = player_node
            .opt_child_text("Legitimacy")
            .and_then(|s| s.parse::<i32>().ok());

        // Determine human status from AIControlledToTurn
        // Human: AIControlledToTurn="0", AI: AIControlledToTurn="2147483647"
        let is_human = player_node
            .opt_attr("AIControlledToTurn")
            .and_then(|s| s.parse::<i32>().ok())
            .map(|turn| turn == 0)
            .unwrap_or(true);

        // FK references stored as XML IDs (resolved during insertion)
        let founder_character_xml_id = player_node
            .opt_child_text("FounderCharacterID")
            .and_then(|s| s.parse::<i32>().ok());

        players.push(PlayerData {
            xml_id,
            player_name,
            nation,
            dynasty,
            legitimacy,
            is_human,
            founder_character_xml_id,
            // ... remaining fields
        });
    }

    Ok(players)
}
```

### Parallel Parsing Orchestration

```rust
// parser/parsers/mod.rs

/// Parse all 4 foundation entities in parallel
pub fn parse_foundation_entities_parallel(
    doc: &XmlDocument,
) -> Result<(Vec<PlayerData>, Vec<CharacterData>, Vec<CityData>, Vec<TileData>)> {
    // Use rayon::join for nested parallelism
    let ((players_result, characters_result), (cities_result, tiles_result)) = rayon::join(
        || {
            rayon::join(
                || parse_players_struct(doc),
                || parse_characters_struct(doc),
            )
        },
        || {
            rayon::join(
                || parse_cities_struct(doc),
                || parse_tiles_struct(doc),
            )
        },
    );

    // Propagate any errors
    Ok((
        players_result?,
        characters_result?,
        cities_result?,
        tiles_result?,
    ))
}
```

### Time-Series Parsing Pattern

For elements like `<PointsHistory><T2>0</T2><T3>5</T3>...</PointsHistory>`:

```rust
// parser/parsers/timeseries.rs

pub fn parse_points_history(
    player_node: &roxmltree::Node,
) -> Vec<(i32, i32)> {  // Vec<(turn, value)>
    let mut history = Vec::new();

    if let Some(history_node) = player_node
        .children()
        .find(|n| n.has_tag_name("PointsHistory"))
    {
        for child in history_node.children().filter(|n| n.is_element()) {
            let tag = child.tag_name().name();
            // Parse "T{turn}" format
            if let Some(turn_str) = tag.strip_prefix("T") {
                if let (Ok(turn), Some(text)) = (turn_str.parse::<i32>(), child.text()) {
                    if let Ok(value) = text.parse::<i32>() {
                        history.push((turn, value));
                    }
                }
            }
        }
    }

    history
}
```

---

## Insertion Patterns

### Basic Inserter Pattern

```rust
// parser/inserters/players.rs

/// Insert players from parsed structs into database
pub fn insert_players(
    conn: &Connection,
    players: &[PlayerData],
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    let mut rows = Vec::new();

    for player in players {
        // Step 1: Map XML ID → DB ID
        let db_id = id_mapper.map_player(player.xml_id);

        // Step 2: Resolve FK references (may fail if entity not yet inserted)
        let founder_character_db_id = player.founder_character_xml_id
            .and_then(|xml_id| id_mapper.get_character(xml_id).ok());

        let chosen_heir_db_id = player.chosen_heir_xml_id
            .and_then(|xml_id| id_mapper.get_character(xml_id).ok());

        // Step 3: Build row tuple (must match schema column order)
        rows.push((
            db_id,                              // player_id
            id_mapper.match_id,                 // match_id
            player.xml_id,                      // xml_id
            player.player_name.clone(),         // player_name
            player.player_name.to_lowercase(),  // player_name_normalized
            player.nation.clone(),              // nation
            player.dynasty.clone(),             // dynasty
            // ... remaining columns in schema order
            founder_character_db_id,
            chosen_heir_db_id,
        ));
    }

    // Step 4: Deduplicate (last-wins strategy)
    let unique_rows = deduplicate_rows_last_wins(rows, |(player_id, match_id, ..)| {
        (*player_id, *match_id)
    });

    // Step 5: Bulk insert via DuckDB Appender
    let count = unique_rows.len();
    let mut app = conn.appender("players")?;
    for row in unique_rows {
        app.append_row(params![
            row.0,  // player_id
            row.1,  // match_id
            row.2,  // xml_id
            row.3,  // player_name
            // ... expand all fields
        ])?;
    }
    drop(app);  // Flush appender

    Ok(count)
}
```

### Deduplication Helper

XML can have duplicate entries (usually due to game bugs). We use last-wins:

```rust
// parser/utils.rs

/// Deduplicate rows by key, keeping the last occurrence
pub fn deduplicate_rows_last_wins<T, K, F>(rows: Vec<T>, key_fn: F) -> Vec<T>
where
    K: Eq + std::hash::Hash,
    F: Fn(&T) -> K,
{
    let mut seen: HashMap<K, usize> = HashMap::new();
    let mut result = Vec::new();

    for (idx, row) in rows.into_iter().enumerate() {
        let key = key_fn(&row);
        if let Some(existing_idx) = seen.get(&key) {
            // Replace existing with new (last-wins)
            result[*existing_idx] = row;
        } else {
            seen.insert(key, result.len());
            result.push(row);
        }
    }

    result
}
```

### Why Appender Instead of INSERT?

DuckDB's `Appender` is much faster for bulk inserts:

```rust
// Fast: ~100k rows/second
let mut app = conn.appender("table_name")?;
for row in rows {
    app.append_row(params![...])?;
}
drop(app);

// Slow: ~1k rows/second
for row in rows {
    conn.execute("INSERT INTO table_name VALUES (...)", params![...])?;
}
```

---

## Concurrency and Locking

### Dual-Lock Strategy

The import uses two locks to prevent concurrent imports of the same game:

```rust
// parser/import.rs

// 1. In-process lock (prevents same-app concurrent imports)
lazy_static! {
    static ref IMPORT_LOCKS: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

fn acquire_process_lock(game_id: &str) -> Arc<Mutex<()>> {
    let mut locks = IMPORT_LOCKS.lock().unwrap();
    locks
        .entry(game_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

// 2. Database lock (prevents cross-process concurrent imports)
fn acquire_db_lock(conn: &Connection, game_id: &str) -> Result<()> {
    // INSERT with ON CONFLICT handles race conditions atomically
    conn.execute(
        "INSERT INTO match_locks (game_id, locked_at, locked_by)
         VALUES (?, CAST(now() AS TIMESTAMP), ?)
         ON CONFLICT (game_id) DO UPDATE
         SET locked_at = CAST(now() AS TIMESTAMP),
             locked_by = excluded.locked_by
         WHERE locked_at < CAST(now() AS TIMESTAMP) - INTERVAL '10 MINUTES'",
        params![game_id, std::process::id()],
    )?;
    Ok(())
}
```

### Lock Table Schema

```sql
CREATE TABLE match_locks (
    game_id VARCHAR PRIMARY KEY,
    locked_at TIMESTAMP NOT NULL,
    locked_by INTEGER NOT NULL  -- Process ID
);
```

### Lock Timeout

Stale locks (from crashed processes) are automatically cleared after 10 minutes:

```sql
WHERE locked_at < CAST(now() AS TIMESTAMP) - INTERVAL '10 MINUTES'
```

---

## Error Handling

### ParseError Enum

```rust
// parser/mod.rs

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("Invalid ZIP file: {0}")]
    InvalidZipFile(String),

    #[error("Invalid archive structure: {0}")]
    InvalidArchiveStructure(String),

    #[error("File too large: {0} bytes (max: {1})")]
    FileTooLarge(u64, u64),

    #[error("Security violation: {0}")]
    SecurityViolation(String),

    #[error("Malformed XML at {location}: {message}\nContext: {context}")]
    MalformedXML {
        location: String,
        message: String,
        context: String,
    },

    #[error("Missing required attribute: {0}")]
    MissingAttribute(String),

    #[error("Missing required element: {0}")]
    MissingElement(String),

    #[error("Invalid format: {0}")]
    InvalidFormat(String),

    #[error("Unknown character ID: {0}")]
    UnknownCharacterId(i32),

    #[error("Unknown player ID: {0}")]
    UnknownPlayerId(i32),

    #[error("Concurrent import in progress for: {0}")]
    ConcurrencyLock(String),

    #[error("Database error: {0}")]
    DatabaseError(#[from] duckdb::Error),

    // ... more variants
}
```

### Using anyhow::Context

Per project standards (`CLAUDE.md`), use `Context` for cleaner error handling:

```rust
use anyhow::Context;

// Good: concise, preserves error chain
conn.execute(query, params)
    .context("Failed to insert player data")?;

let file = File::open(path)
    .context("Failed to open save file")?;

// Avoid: verbose map_err
conn.execute(query, params)
    .map_err(|e| format!("Failed to insert player data: {}", e))?;
```

### Transaction Rollback on Error

The import uses `unchecked_transaction()` with explicit rollback:

```rust
let tx = conn.unchecked_transaction()?;

match import_save_file_internal(...) {
    Ok(result) => {
        release_db_lock(&tx, &game_id)?;
        tx.commit()?;
        Ok(result)
    }
    Err(e) => {
        // Rollback releases lock automatically
        tx.rollback()?;
        log::error!("Import failed: {}", e);
        Ok(ImportResult {
            success: false,
            error: Some(e.to_string()),
            ...
        })
    }
}
```

---

## Performance Optimizations

### 1. Parallel Foundation Parsing

~2x speedup from parsing 4 entities concurrently:

```rust
let (players, characters, cities, tiles) = rayon::join(
    || rayon::join(parse_players, parse_characters),
    || rayon::join(parse_cities, parse_tiles),
);
```

### 2. DuckDB Appender for Bulk Insert

10-100x faster than individual INSERTs for large tables.

### 3. Checkpoint Threshold

Reduce WAL overhead during imports:

```rust
// db/schema.rs
conn.execute("SET checkpoint_threshold = '1GB'", [])?;
```

### 4. Memory Management

Foundation entity data is freed immediately after insertion:

```rust
// After inserting players
let (players_data, characters_data, cities_data, tiles_data) =
    parse_foundation_entities_parallel(doc)?;

insert_players(tx, &players_data, &mut id_mapper)?;
drop(players_data);  // Free memory

insert_characters(tx, &characters_data, &mut id_mapper)?;
drop(characters_data);  // Free memory
// ...
```

### 5. Timing Instrumentation

All phases are timed for performance debugging:

```rust
let t_players = Instant::now();
let players_count = insert_players(tx, &players_data, &mut id_mapper)?;
log::info!("Players: {:?} ({} players)", t_players.elapsed(), players_count);
```

---

## Adding a New Entity Type

Follow this checklist when adding a new entity type (e.g., "Units"):

### 1. Define Data Struct

```rust
// parser/game_data.rs

pub struct UnitData {
    pub xml_id: i32,
    pub unit_type: String,
    pub player_xml_id: Option<i32>,
    pub tile_xml_id: Option<i32>,
    pub strength: i32,
    pub xp: i32,
    // ...
}
```

### 2. Create Parser

```rust
// parser/parsers/units.rs

pub fn parse_units_struct(doc: &XmlDocument) -> Result<Vec<UnitData>> {
    let root = doc.root_element();
    let mut units = Vec::new();

    for unit_node in root.children().filter(|n| n.has_tag_name("Unit")) {
        let xml_id = unit_node.req_attr("ID")?.parse::<i32>()?;
        // ... parse fields
        units.push(UnitData { xml_id, ... });
    }

    Ok(units)
}
```

### 3. Create Inserter

```rust
// parser/inserters/units.rs

pub fn insert_units(
    conn: &Connection,
    units: &[UnitData],
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    let mut rows = Vec::new();

    for unit in units {
        let db_id = id_mapper.map_unit(unit.xml_id);
        let player_db_id = unit.player_xml_id
            .and_then(|xml_id| id_mapper.get_player(xml_id).ok());
        // ... build row tuple
        rows.push((...));
    }

    let unique_rows = deduplicate_rows_last_wins(rows, |(unit_id, match_id, ..)| {
        (*unit_id, *match_id)
    });

    let mut app = conn.appender("units")?;
    for row in unique_rows {
        app.append_row(params![...])?;
    }
    drop(app);

    Ok(unique_rows.len())
}
```

### 4. Add IdMapper Methods

```rust
// parser/id_mapper.rs

impl IdMapper {
    pub fn map_unit(&mut self, xml_id: i32) -> i64 {
        *self.units.entry(xml_id).or_insert_with(|| {
            let id = self.next_unit_id;
            self.next_unit_id += 1;
            id
        })
    }

    pub fn get_unit(&self, xml_id: i32) -> Result<i64> {
        self.units.get(&xml_id).copied()
            .ok_or_else(|| ParseError::UnknownUnitId(xml_id))
    }
}

// Also update save_mappings() and load_existing_mappings()
```

### 5. Add Database Table

```sql
-- docs/schema.sql

CREATE TABLE units (
    unit_id BIGINT NOT NULL,
    match_id BIGINT NOT NULL,
    xml_id INTEGER NOT NULL,
    unit_type VARCHAR NOT NULL,
    player_id BIGINT REFERENCES players(player_id),
    tile_id BIGINT REFERENCES tiles(tile_id),
    strength INTEGER,
    xp INTEGER,
    PRIMARY KEY (unit_id, match_id)
);
```

### 6. Wire Into Import

```rust
// parser/import.rs

// Add to appropriate phase based on dependencies
// Units depend on players and tiles, so insert after those

let t_units = Instant::now();
let units_data = parse_units_struct(doc)?;
let units_count = insert_units(tx, &units_data, &mut id_mapper)?;
log::info!("Units: {:?} ({} units)", t_units.elapsed(), units_count);
```

### 7. Export Module

```rust
// parser/parsers/mod.rs
pub mod units;
pub use units::parse_units_struct;

// parser/inserters/mod.rs
pub mod units;
pub use units::insert_units;
```

---

## Common Gotchas

### 1. Player ID="0" is Valid

XML uses 0-based IDs. Don't skip ID 0!

```rust
// WRONG
if player_xml_id == 0 { continue; }

// CORRECT
let db_id = id_mapper.map_player(player_xml_id);  // 0 → 1
```

### 2. Player="-1" Means No Player

For entities like characters, `-1` indicates no owning player (barbarians, dead characters):

```rust
let player_db_id = if player_xml_id == -1 {
    None
} else {
    Some(id_mapper.map_player(player_xml_id))
};
```

### 3. FK Order Matters

Insert order must respect foreign key dependencies:

```
players → characters → cities → (anything referencing these)
```

If you insert cities before tiles, the `tile_id` FK will fail.

### 4. DuckDB FK Update Restriction

DuckDB prevents updating a row that's already referenced by another table's FK. This is why character parent relationships are set in a separate pass (2a) **before** any other table references characters.

### 5. Appender Must Be Dropped

DuckDB Appender buffers data. Call `drop(app)` or let it go out of scope to flush:

```rust
let mut app = conn.appender("table")?;
for row in rows {
    app.append_row(...)?;
}
drop(app);  // IMPORTANT: flush buffer to database
```

### 6. Schema Column Order

When using Appender, row values must match schema column order exactly. If schema changes, update inserter.

### 7. UTF-8 Only

The XML parser requires UTF-8. Files with other encodings will fail validation.

### 8. Transaction Scope

All imports use a single transaction. If any phase fails, the entire import rolls back.

### 9. Time-Series Tag Format

History elements use `<T{turn}>{value}</T{turn}>` format:

```xml
<PointsHistory>
    <T2>0</T2>
    <T3>5</T3>
    <T4>12</T4>
</PointsHistory>
```

Parse by stripping the "T" prefix from tag names.

### 10. Test Data Location

Sample save files for testing are in `test-data/saves/`. Use these for development instead of requiring your own saves.

---

## Related Documentation

- `docs/save-file-format.md` - Complete XML format reference
- `docs/schema.sql` - Database schema definition
- `docs/reference/tauri_architecture.md` - How Tauri/Rust/frontend interact
- `CLAUDE.md` - Coding standards and project conventions
