# XML Parser Implementation Plan

**Project:** Per-Ankh Old World Save Game Parser
**Version:** 1.0
**Date:** 2025-11-05
**Goal:** Parse Old World save game ZIP/XML files into DuckDB database with ~85% data coverage

---

## Executive Summary

This plan outlines the implementation of a Rust-based parser that extracts data from Old World game save files (ZIP archives containing XML) and loads it into a DuckDB database following the schema defined in `docs/schema.sql`.

**Key Decisions:**
- Full data parsing (all schema sections)
- Store complete turn-by-turn history
- Use GameId UUID for match identification
- Generate sequential database IDs (store XML IDs separately)
- Two-pass parsing for self-referential entities
- All-or-nothing transaction model (rollback on error)
- Update-and-replace strategy for same-game imports

---

## Architecture Overview

### High-Level Flow

```
ZIP File → Extract XML → Parse XML → Transform Data → Insert to DuckDB
    ↓           ↓            ↓              ↓              ↓
  unzip     load to      traverse      map XML IDs    transaction
           memory        elements      to DB IDs      commit/rollback
```

### Module Structure

```
src-tauri/src/
├── main.rs                 # Tauri app entry
├── commands.rs             # Tauri commands (import_save_file)
├── db/
│   ├── mod.rs             # Database module exports
│   ├── connection.rs      # DuckDB connection management
│   ├── schema.rs          # Schema initialization
│   └── queries.rs         # Common query helpers
├── parser/
│   ├── mod.rs             # Parser module exports
│   ├── save_file.rs       # ZIP extraction & orchestration
│   ├── xml_loader.rs      # XML parsing with quick-xml
│   ├── id_mapper.rs       # XML ID → Database ID mapping
│   ├── entities/
│   │   ├── mod.rs
│   │   ├── match.rs       # Match metadata parser
│   │   ├── player.rs      # Player parser
│   │   ├── character.rs   # Character parser (two-pass)
│   │   ├── family.rs      # Family parser
│   │   ├── religion.rs    # Religion parser
│   │   ├── tribe.rs       # Tribe parser
│   │   ├── city.rs        # City parser
│   │   ├── tile.rs        # Tile parser
│   │   ├── unit.rs        # Unit parser
│   │   ├── technology.rs  # Tech parser
│   │   ├── law.rs         # Law parser
│   │   ├── diplomacy.rs   # Diplomacy parser
│   │   ├── goal.rs        # Goals/Ambitions parser
│   │   ├── event.rs       # Events/Story parser
│   │   └── timeseries.rs  # Time-series data parser
│   └── transaction.rs     # Transaction coordinator
└── models/
    ├── mod.rs
    ├── match.rs           # Match struct
    ├── player.rs          # Player struct
    ├── character.rs       # Character struct
    └── ...                # Other entity models
```

---

## Data Flow Specification

### Phase 1: File Ingestion

**Input:** Path to `.zip` save file
**Output:** In-memory XML document

**Steps:**
1. Validate file exists and is readable
2. Open ZIP archive using `zip` crate
3. Validate ZIP security (size limits, single XML file, no path traversal)
4. Locate XML file inside (single file with `.xml` extension)
5. Extract XML to memory (11-12 MB typical, enforced limits)
6. **Parse XML using hybrid strategy:**
   - For files < 20 MB: Full DOM with `roxmltree`
   - For files ≥ 20 MB: Hybrid streaming + targeted DOM
7. Validate root element is `<Root>`

**Hybrid Streaming Strategy (for large files):**
```rust
pub enum XmlParseStrategy {
    FullDom(roxmltree::Document),
    StreamingHybrid {
        xml_content: String,
        // Track byte ranges for top-level elements
        entity_ranges: HashMap<String, Vec<(usize, usize)>>,
    },
}

pub fn parse_xml(xml_content: String) -> Result<XmlParseStrategy> {
    if xml_content.len() < 20 * 1024 * 1024 {
        // Small file: full DOM
        let doc = roxmltree::Document::parse(&xml_content)?;
        Ok(XmlParseStrategy::FullDom(doc))
    } else {
        // Large file: hybrid streaming
        let entity_ranges = identify_entity_ranges(&xml_content)?;
        Ok(XmlParseStrategy::StreamingHybrid {
            xml_content,
            entity_ranges,
        })
    }
}

/// Parse specific entity subtrees from byte ranges
pub fn parse_entity_subtree(xml_content: &str, range: (usize, usize))
    -> Result<roxmltree::Document> {
    let subtree = &xml_content[range.0..range.1];
    roxmltree::Document::parse(subtree)
}
```

**Why Hybrid Approach:**
- Saves can grow > 20 MB with long games
- Full DOM wasteful for sequential entity parsing
- Stream at root level, DOM for targeted subtrees
- Time-series data can be streamed directly to column buffers

**Security Constraints:**
- Maximum compressed size: 50 MB
- Maximum uncompressed size: 100 MB
- Maximum entries: 10
- Reject path traversal attempts (paths with `..` or starting with `/`)
- Only accept files with `.xml` extension

**Error Handling:**
- Invalid ZIP → `ParseError::InvalidZipFile`
- Multiple/no XML files → `ParseError::InvalidArchiveStructure`
- File too large → `ParseError::FileTooLarge(size)`
- Path traversal → `ParseError::SecurityViolation(message)`
- XML parse failure → `ParseError::MalformedXML { location, message, context }`

**ZIP Security Validation Implementation:**
```rust
const MAX_COMPRESSED_SIZE: u64 = 50 * 1024 * 1024;   // 50 MB
const MAX_UNCOMPRESSED_SIZE: u64 = 100 * 1024 * 1024; // 100 MB
const MAX_ENTRIES: usize = 10;
const MAX_COMPRESSION_RATIO: f64 = 100.0; // Configurable zip bomb threshold

/// Validate and sanitize a file path from ZIP archive
fn validate_zip_path(path: &str) -> Result<()> {
    use std::path::Path;

    // Normalize path separators (handle Windows backslashes)
    let normalized = path.replace('\\', "/");

    // Check for absolute paths
    if normalized.starts_with('/') || Path::new(&normalized).is_absolute() {
        return Err(ParseError::SecurityViolation(
            format!("Absolute path in ZIP: {}", path)
        ));
    }

    // Check for path traversal after normalization
    if normalized.contains("..") {
        return Err(ParseError::SecurityViolation(
            format!("Path traversal attempt: {}", path)
        ));
    }

    // Check for control characters in filename (potential exploit vector)
    if path.chars().any(|c| c.is_control()) {
        return Err(ParseError::SecurityViolation(
            format!("Control characters in filename: {}", path)
        ));
    }

    // Path component validation (no empty segments)
    for component in normalized.split('/') {
        if component.is_empty() || component == "." {
            return Err(ParseError::SecurityViolation(
                format!("Invalid path component: {}", path)
            ));
        }
    }

    Ok(())
}

fn validate_and_extract_xml(file_path: &str) -> Result<String> {
    use zip::ZipArchive;
    use std::io::Read;

    let file = std::fs::File::open(file_path)?;
    let file_size = file.metadata()?.len();

    // Check compressed file size
    if file_size > MAX_COMPRESSED_SIZE {
        return Err(ParseError::FileTooLarge(file_size, MAX_COMPRESSED_SIZE));
    }

    let mut archive = ZipArchive::new(file)
        .map_err(|e| ParseError::InvalidZipFile(e.to_string()))?;

    // Check number of entries
    if archive.len() > MAX_ENTRIES {
        return Err(ParseError::InvalidArchiveStructure(
            format!("Too many entries: {} (max: {})", archive.len(), MAX_ENTRIES)
        ));
    }

    // Find and validate XML file
    let mut xml_file = None;
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;

        // Security: Validate path (traversal, absolute paths, control chars)
        let file_name = file.name();
        validate_zip_path(file_name)?;

        // Security: Check uncompressed size
        if file.size() > MAX_UNCOMPRESSED_SIZE {
            return Err(ParseError::FileTooLarge(file.size(), MAX_UNCOMPRESSED_SIZE));
        }

        // Security: Check compression ratio (zip bomb detection)
        let compression_ratio = if file.compressed_size() > 0 {
            file.size() as f64 / file.compressed_size() as f64
        } else {
            1.0
        };
        if compression_ratio > MAX_COMPRESSION_RATIO {
            log::warn!(
                "High compression ratio detected: {:.1}x for file: {}",
                compression_ratio,
                file_name
            );
            return Err(ParseError::SecurityViolation(
                format!("Suspicious compression ratio: {:.1}x (threshold: {:.1}x)",
                        compression_ratio, MAX_COMPRESSION_RATIO)
            ));
        }

        // Log compression ratio for monitoring/tuning
        if compression_ratio > 10.0 {
            log::debug!(
                "File {} has compression ratio: {:.1}x",
                file_name,
                compression_ratio
            );
        }

        // Find XML file
        if file_name.to_lowercase().ends_with(".xml") {
            if xml_file.is_some() {
                return Err(ParseError::InvalidArchiveStructure(
                    "Multiple XML files found".to_string()
                ));
            }
            xml_file = Some(i);
        }
    }

    // Extract XML content
    let xml_index = xml_file.ok_or_else(|| {
        ParseError::InvalidArchiveStructure("No XML file found".to_string())
    })?;

    let mut file = archive.by_index(xml_index)?;
    let mut xml_content = String::new();

    // Read with size limit (redundant check but good defense-in-depth)
    let bytes_read = file.take(MAX_UNCOMPRESSED_SIZE + 1)
        .read_to_string(&mut xml_content)?;

    if bytes_read as u64 > MAX_UNCOMPRESSED_SIZE {
        return Err(ParseError::FileTooLarge(bytes_read as u64, MAX_UNCOMPRESSED_SIZE));
    }

    // Validate UTF-8 encoding (roxmltree requires UTF-8)
    if !xml_content.is_char_boundary(xml_content.len()) {
        return Err(ParseError::MalformedXML {
            location: "XML file".to_string(),
            message: "Invalid UTF-8 encoding".to_string(),
            context: "File must be UTF-8 encoded".to_string(),
        });
    }

    // Check for XML encoding declaration and warn if non-UTF-8
    if let Some(first_line) = xml_content.lines().next() {
        if first_line.contains("<?xml") {
            if first_line.contains("encoding") && !first_line.contains("UTF-8") {
                log::warn!(
                    "XML declares non-UTF-8 encoding: {}. Attempting to parse as UTF-8.",
                    first_line
                );
            }
        }
    }

    Ok(xml_content)
}
```

---

### Phase 2: Match Identification

**Input:** XML root element
**Output:** `match_id` (new or existing)

**Steps:**
1. Extract `GameId` attribute from `<Root>`
2. Compute `file_hash` (SHA-256 of file contents)
3. Query database: `SELECT match_id FROM matches WHERE game_id = ?`
4. **If exists:**
   - Log: "Updating existing match {game_id}"
   - Store existing `match_id`
   - Begin DELETE queries for update-and-replace
5. **If new:**
   - Generate new `match_id` (auto-increment or UUID)
   - Log: "Creating new match {game_id}"

**Update Strategy: UPSERT for Core Entities, DELETE for Derived Data**

For match updates, use **UPSERT** on core entities (stable IDs) and **DELETE-then-INSERT** for derived/aggregate tables. This approach:
- Reduces churn and temporary FK holes
- Maintains referential integrity during import
- More resilient if concurrent read occurs mid-update
- Eliminates need for manual DELETE of core entities

**Schema Requirements:**
The schema already includes unique constraints on `(match_id, xml_id)` for all core entity tables:
- `idx_players_xml_id` on players(match_id, xml_id)
- `idx_characters_xml_id` on characters(match_id, xml_id)
- `idx_cities_xml_id` on cities(match_id, xml_id)
- `idx_tiles_xml_id` on tiles(match_id, xml_id)
- `idx_units_xml_id` on units(match_id, xml_id)
- `idx_families_xml_id` on families(match_id, xml_id)
- `idx_religions_xml_id` on religions(match_id, xml_id)
- `idx_tribes_xml_id` on tribes(match_id, xml_id)

```rust
/// Core entities use UPSERT (INSERT...ON CONFLICT UPDATE)
/// These are NOT deleted during updates - UPSERT preserves stable IDs
const UPSERT_ENTITIES: &[&str] = &[
    "players",
    "characters",
    "families",
    "religions",
    "tribes",
    "cities",
    "tiles",
    "units",
];

/// Derived/child tables use DELETE (then reinsert)
/// Order matters: delete children before parents to respect FK constraints
const DELETE_ORDER: &[&str] = &[
    // Child/relationship tables (deepest dependencies first)
    "unit_promotions",
    "character_traits",
    "character_stats",
    "character_missions",
    "character_relationships",
    "character_marriages",
    "city_yields",
    "city_culture",
    "city_religions",
    "city_production_queue",
    "city_units_produced",
    "city_projects_completed",
    "tile_changes",
    "tile_visibility",
    "player_resources",
    "player_council",
    "family_opinion_history",
    "family_law_opinions",
    "religion_opinion_history",
    "technologies_completed",
    "technology_progress",
    "technology_states",
    "laws",
    "diplomacy",
    "player_goals",
    "story_events",
    "story_choices",
    "event_outcomes",
    "event_logs",
    // Time-series tables (heavy, simpler to replace)
    "yield_history",
    "points_history",
    "military_history",
    "legitimacy_history",
    "yield_prices",
    // Match settings
    "match_settings",
];

/// Execute cleanup for update (delete derived data only, UPSERT handles core entities)
fn delete_derived_match_data(tx: &Transaction, match_id: i64) -> Result<()> {
    for table in DELETE_ORDER {
        tx.execute(
            &format!("DELETE FROM {} WHERE match_id = ?", table),
            params![match_id]
        )?;
    }
    Ok(())
}

/// Example UPSERT for core entity using (match_id, xml_id) unique constraint
fn upsert_player(tx: &Transaction, player: &Player) -> Result<()> {
    tx.execute(
        "INSERT INTO players (player_id, match_id, xml_id, player_name, nation,
                              legitimacy, difficulty, last_turn_completed, ...)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ...)
         ON CONFLICT (match_id, xml_id)
         DO UPDATE SET
             player_id = excluded.player_id,
             player_name = excluded.player_name,
             nation = excluded.nation,
             legitimacy = excluded.legitimacy,
             difficulty = excluded.difficulty,
             last_turn_completed = excluded.last_turn_completed,
             ...",
        params![player.player_id, player.match_id, player.xml_id,
                player.player_name, player.nation, player.legitimacy, ...]
    )?;
    Ok(())
}

/// Example UPSERT for character (includes all core fields)
fn upsert_character(tx: &Transaction, character: &Character) -> Result<()> {
    tx.execute(
        "INSERT INTO characters (character_id, match_id, xml_id, first_name, gender,
                                  player_id, birth_turn, death_turn, birth_father_id,
                                  birth_mother_id, family, archetype, ...)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ...)
         ON CONFLICT (match_id, xml_id)
         DO UPDATE SET
             character_id = excluded.character_id,
             first_name = excluded.first_name,
             gender = excluded.gender,
             player_id = excluded.player_id,
             birth_turn = excluded.birth_turn,
             death_turn = excluded.death_turn,
             birth_father_id = excluded.birth_father_id,
             birth_mother_id = excluded.birth_mother_id,
             family = excluded.family,
             archetype = excluded.archetype,
             ...",
        params![character.character_id, character.match_id, character.xml_id,
                character.first_name, character.gender, character.player_id,
                character.birth_turn, character.death_turn, ...]
    )?;
    Ok(())
}
```

**Important Notes:**
- Core entities: **UPSERT** via `ON CONFLICT (match_id, xml_id)` preserves stable database IDs
- The `player_id` field is **updated** during UPSERT to match the IdMapper's stable ID
- Derived tables: **DELETE-then-INSERT** for simplicity
- `id_mappings` table **preserved** (not deleted, only updated via UPSERT)
- `matches` table row **UPSERT** to update metadata
- No manual DELETE needed for core entities - UPSERT handles both insert and update cases

**Concurrency Control: Multi-Process Safety**

To prevent race conditions when two imports of the same GameId run concurrently (including across multiple app instances):

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// In-process lock manager for same-process concurrency
lazy_static! {
    static ref IMPORT_LOCKS: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

/// Acquire in-process lock for a GameId
fn acquire_process_lock(game_id: &str) -> Arc<Mutex<()>> {
    let mut locks = IMPORT_LOCKS.lock().unwrap();
    locks.entry(game_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

/// Acquire database-level lock for multi-process safety
/// Must be called within a transaction
fn acquire_db_lock(tx: &Transaction, game_id: &str) -> Result<()> {
    // Try to insert lock row; if already exists, this will block until released
    // The unique constraint on game_id ensures only one process can hold the lock
    tx.execute(
        "INSERT INTO match_locks (game_id, locked_at, locked_by)
         VALUES (?, CURRENT_TIMESTAMP, ?)
         ON CONFLICT (game_id) DO UPDATE
         SET locked_at = CURRENT_TIMESTAMP,
             locked_by = excluded.locked_by
         WHERE locked_at < CURRENT_TIMESTAMP - INTERVAL 10 MINUTES", // Stale lock timeout
        params![game_id, std::process::id()]
    ).map_err(|e| ParseError::ConcurrencyLock(
        format!("Another process is importing game_id: {} (error: {})", game_id, e)
    ))?;
    Ok(())
}

/// Import with full concurrency protection (in-process + cross-process)
pub fn import_save_file<P: ProgressCallback>(
    file_path: &str,
    db_path: &str,
    progress: P
) -> Result<ImportResult> {
    let xml_content = validate_and_extract_xml(file_path)?;
    let doc = roxmltree::Document::parse(&xml_content)?;

    // Extract GameId to determine lock
    let game_id = doc.root_element()
        .attribute("GameId")
        .ok_or(ParseError::MissingAttribute("Root.GameId"))?;

    // First, acquire in-process lock (prevents same-app concurrency)
    let _process_lock = acquire_process_lock(game_id).lock().unwrap();

    // Open database connection
    let conn = Connection::open(db_path)?;

    // Begin transaction and acquire DB-level lock (prevents cross-process concurrency)
    let tx = conn.transaction()?;
    acquire_db_lock(&tx, game_id)?;

    // Now safe to proceed - we have exclusive access for this GameId
    match import_save_file_internal(&doc, &tx, game_id, progress) {
        Ok(result) => {
            // Release DB lock by committing (deletes lock row)
            tx.execute("DELETE FROM match_locks WHERE game_id = ?", params![game_id])?;
            tx.commit()?;
            Ok(result)
        }
        Err(e) => {
            // Rollback releases the lock automatically
            tx.rollback()?;
            Err(e)
        }
    }
}
```

**Required Schema Addition:**
```sql
-- Lock table for cross-process synchronization
CREATE TABLE IF NOT EXISTS match_locks (
    game_id VARCHAR NOT NULL PRIMARY KEY,
    locked_at TIMESTAMP NOT NULL,
    locked_by INTEGER, -- Process ID
    CONSTRAINT unique_game_lock UNIQUE (game_id)
);

CREATE INDEX idx_match_locks_stale ON match_locks(locked_at);
```

**Lock Cleanup (Stale Lock Detection):**
```rust
/// Clean up stale locks (locks held > 10 minutes, likely from crashed process)
pub fn cleanup_stale_locks(conn: &Connection) -> Result<usize> {
    let deleted = conn.execute(
        "DELETE FROM match_locks
         WHERE locked_at < CURRENT_TIMESTAMP - INTERVAL 10 MINUTES",
        []
    )?;

    if deleted > 0 {
        log::warn!("Cleaned up {} stale import locks", deleted);
    }
    Ok(deleted)
}
```

**Alternative: Unique Constraint Only (Simpler)**
```rust
/// Simpler approach: rely on unique game_id constraint
/// Two concurrent imports will race; first succeeds, second gets constraint violation
pub fn import_save_file_simple(file_path: &str, db_path: &str) -> Result<ImportResult> {
    // ... parse XML ...

    let tx = conn.transaction()?;

    // Try to insert/update match record
    // If another process is mid-transaction, this will block (serializable isolation)
    match tx.execute(
        "INSERT INTO matches (match_id, game_id, ...) VALUES (?, ?, ...)
         ON CONFLICT (game_id) DO UPDATE SET ...",
        params![...]
    ) {
        Ok(_) => {
            // We won the race, proceed with import
            import_save_file_internal(&tx, ...)?;
            tx.commit()?;
        }
        Err(e) if is_lock_error(&e) => {
            return Err(ParseError::ConcurrencyLock(
                format!("Another process is importing this game")
            ));
        }
        Err(e) => return Err(e.into()),
    }
}
```

**Recommendation:**
Use the **database-level lock table** approach for maximum safety across:
- Multiple app instances
- Concurrent imports
- Crash resilience (stale lock cleanup)

**Why This Matters:**
- In-process locks only protect same-app concurrency
- Database locks protect across multiple app instances
- Without DB locks, two processes could corrupt same match data
- Stale lock cleanup prevents indefinite blocks from crashed processes
- Separate GameIds can still import in parallel

---

### Phase 3: XML ID Mapping

**Challenge:** XML IDs are scoped per-file (e.g., Character ID="4" in multiple saves)
**Solution:** Maintain in-memory mapping during parse

**IdMapper Struct:**
```rust
pub struct IdMapper {
    match_id: i64,

    // XML ID → Database ID mappings
    players: HashMap<i32, i64>,
    characters: HashMap<i32, i64>,
    cities: HashMap<i32, i64>,
    units: HashMap<i32, i64>,
    tiles: HashMap<i32, i64>,
    families: HashMap<i32, i64>,
    religions: HashMap<i32, i64>,
    tribes: HashMap<i32, i64>,

    // Sequence generators
    next_player_id: i64,
    next_character_id: i64,
    next_city_id: i64,
    next_unit_id: i64,
    next_tile_id: i64,
    next_family_id: i64,
    next_religion_id: i64,
    next_tribe_id: i64,
}

impl IdMapper {
    /// Create new IdMapper, optionally loading existing mappings for updates
    pub fn new(match_id: i64, conn: &Connection, is_new: bool) -> Result<Self> {
        if is_new {
            // Start fresh with ID 1 for all entity types
            Ok(Self {
                match_id,
                players: HashMap::new(),
                characters: HashMap::new(),
                cities: HashMap::new(),
                units: HashMap::new(),
                tiles: HashMap::new(),
                families: HashMap::new(),
                religions: HashMap::new(),
                tribes: HashMap::new(),
                next_player_id: 1,
                next_character_id: 1,
                next_city_id: 1,
                next_unit_id: 1,
                next_tile_id: 1,
                next_family_id: 1,
                next_religion_id: 1,
                next_tribe_id: 1,
            })
        } else {
            // Load existing mappings from id_mappings table
            Self::load_existing_mappings(conn, match_id)
        }
    }

    /// Load existing XML → DB ID mappings for match update
    fn load_existing_mappings(conn: &Connection, match_id: i64) -> Result<Self> {
        let mut mapper = Self {
            match_id,
            players: HashMap::new(),
            characters: HashMap::new(),
            cities: HashMap::new(),
            units: HashMap::new(),
            tiles: HashMap::new(),
            families: HashMap::new(),
            religions: HashMap::new(),
            tribes: HashMap::new(),
            next_player_id: 1,
            next_character_id: 1,
            next_city_id: 1,
            next_unit_id: 1,
            next_tile_id: 1,
            next_family_id: 1,
            next_religion_id: 1,
            next_tribe_id: 1,
        };

        // Query id_mappings table
        let mut stmt = conn.prepare(
            "SELECT entity_type, xml_id, db_id FROM id_mappings WHERE match_id = ?"
        )?;
        let rows = stmt.query_map(params![match_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i32>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;

        // Populate hashmaps and track max IDs
        for row in rows {
            let (entity_type, xml_id, db_id) = row?;
            match entity_type.as_str() {
                "player" => {
                    mapper.players.insert(xml_id, db_id);
                    mapper.next_player_id = mapper.next_player_id.max(db_id + 1);
                }
                "character" => {
                    mapper.characters.insert(xml_id, db_id);
                    mapper.next_character_id = mapper.next_character_id.max(db_id + 1);
                }
                "city" => {
                    mapper.cities.insert(xml_id, db_id);
                    mapper.next_city_id = mapper.next_city_id.max(db_id + 1);
                }
                "unit" => {
                    mapper.units.insert(xml_id, db_id);
                    mapper.next_unit_id = mapper.next_unit_id.max(db_id + 1);
                }
                "tile" => {
                    mapper.tiles.insert(xml_id, db_id);
                    mapper.next_tile_id = mapper.next_tile_id.max(db_id + 1);
                }
                "family" => {
                    mapper.families.insert(xml_id, db_id);
                    mapper.next_family_id = mapper.next_family_id.max(db_id + 1);
                }
                "religion" => {
                    mapper.religions.insert(xml_id, db_id);
                    mapper.next_religion_id = mapper.next_religion_id.max(db_id + 1);
                }
                "tribe" => {
                    mapper.tribes.insert(xml_id, db_id);
                    mapper.next_tribe_id = mapper.next_tribe_id.max(db_id + 1);
                }
                _ => {} // Ignore unknown types for forward compatibility
            }
        }

        Ok(mapper)
    }

    /// Save specific entity type mappings to database (for phased persistence)
    pub fn save_mappings_partial(&self, conn: &Connection,
                                  entity_types: &[&str]) -> Result<()> {
        let mut stmt = conn.prepare(
            "INSERT INTO id_mappings (match_id, entity_type, xml_id, db_id)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (match_id, entity_type, xml_id)
             DO UPDATE SET db_id = excluded.db_id"
        )?;

        for entity_type in entity_types {
            let mappings = match *entity_type {
                "player" => &self.players,
                "character" => &self.characters,
                "city" => &self.cities,
                "unit" => &self.units,
                "tile" => &self.tiles,
                "family" => &self.families,
                "religion" => &self.religions,
                "tribe" => &self.tribes,
                _ => continue,
            };

            for (&xml_id, &db_id) in mappings {
                stmt.execute(params![self.match_id, entity_type, xml_id, db_id])?;
            }
        }

        Ok(())
    }

    /// Save all mappings to database for future updates
    pub fn save_mappings(&self, conn: &Connection) -> Result<()> {
        self.save_mappings_partial(conn, &[
            "player", "character", "city", "unit",
            "tile", "family", "religion", "tribe"
        ])
    }

    // Map XML ID to database ID (create if doesn't exist)
    pub fn map_player(&mut self, xml_id: i32) -> i64 {
        *self.players.entry(xml_id).or_insert_with(|| {
            let id = self.next_player_id;
            self.next_player_id += 1;
            id
        })
    }

    pub fn map_character(&mut self, xml_id: i32) -> i64 {
        *self.characters.entry(xml_id).or_insert_with(|| {
            let id = self.next_character_id;
            self.next_character_id += 1;
            id
        })
    }

    pub fn map_city(&mut self, xml_id: i32) -> i64 {
        *self.cities.entry(xml_id).or_insert_with(|| {
            let id = self.next_city_id;
            self.next_city_id += 1;
            id
        })
    }

    pub fn map_unit(&mut self, xml_id: i32) -> i64 {
        *self.units.entry(xml_id).or_insert_with(|| {
            let id = self.next_unit_id;
            self.next_unit_id += 1;
            id
        })
    }

    pub fn map_tile(&mut self, xml_id: i32) -> i64 {
        *self.tiles.entry(xml_id).or_insert_with(|| {
            let id = self.next_tile_id;
            self.next_tile_id += 1;
            id
        })
    }

    pub fn map_family(&mut self, xml_id: i32) -> i64 {
        *self.families.entry(xml_id).or_insert_with(|| {
            let id = self.next_family_id;
            self.next_family_id += 1;
            id
        })
    }

    pub fn map_religion(&mut self, xml_id: i32) -> i64 {
        *self.religions.entry(xml_id).or_insert_with(|| {
            let id = self.next_religion_id;
            self.next_religion_id += 1;
            id
        })
    }

    pub fn map_tribe(&mut self, xml_id: i32) -> i64 {
        *self.tribes.entry(xml_id).or_insert_with(|| {
            let id = self.next_tribe_id;
            self.next_tribe_id += 1;
            id
        })
    }

    // Get existing database ID (error if not mapped)
    pub fn get_player(&self, xml_id: i32) -> Result<i64> {
        self.players.get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownPlayerId(xml_id))
    }

    pub fn get_character(&self, xml_id: i32) -> Result<i64> {
        self.characters.get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownCharacterId(xml_id))
    }

    pub fn get_city(&self, xml_id: i32) -> Result<i64> {
        self.cities.get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownCityId(xml_id))
    }

    pub fn get_unit(&self, xml_id: i32) -> Result<i64> {
        self.units.get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownUnitId(xml_id))
    }

    pub fn get_tile(&self, xml_id: i32) -> Result<i64> {
        self.tiles.get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownTileId(xml_id))
    }

    pub fn get_family(&self, xml_id: i32) -> Result<i64> {
        self.families.get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownFamilyId(xml_id))
    }

    pub fn get_religion(&self, xml_id: i32) -> Result<i64> {
        self.religions.get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownReligionId(xml_id))
    }

    pub fn get_tribe(&self, xml_id: i32) -> Result<i64> {
        self.tribes.get(&xml_id)
            .copied()
            .ok_or_else(|| ParseError::UnknownTribeId(xml_id))
    }
}
```

**ID Stability Strategy:**
- For **new matches**: Start all IDs at 1, create fresh mappings
- For **match updates**: Load existing XML→DB mappings from `id_mappings` table
- Database IDs remain **stable** across re-imports of same GameId
- Prevents breaking external references or saved queries
- IdMapper saves all mappings after successful import

**Required Database Table:**
```sql
CREATE TABLE IF NOT EXISTS id_mappings (
    match_id BIGINT NOT NULL,
    entity_type VARCHAR NOT NULL,  -- 'player', 'character', 'city', etc.
    xml_id INTEGER NOT NULL,
    db_id BIGINT NOT NULL,
    PRIMARY KEY (match_id, entity_type, xml_id),
    FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
);

CREATE INDEX idx_id_mappings_match ON id_mappings(match_id);
```

**Why this works:**
- Each new match gets fresh ID mappings
- Same XML ID in different matches → different database IDs
- Re-importing same match preserves database IDs via id_mappings table
- Handles forward/backward references gracefully
- External tools can rely on stable database IDs

---

## Parsing Order & Dependencies

### Pass 1: Foundation Entities (No External Dependencies)

**Order matters due to foreign keys:**

```rust
pub fn parse_save_file(xml: &XmlDocument, db: &Connection) -> Result<()> {
    let tx = db.transaction()?;
    let mut id_mapper = IdMapper::new(match_id);

    // 1. Match metadata (no dependencies)
    parse_match_metadata(xml, &tx, match_id)?;

    // 2. Match settings (depends on match)
    parse_match_settings(xml, &tx, match_id)?;

    // 3. Players (depends on match)
    parse_players(xml, &tx, &mut id_mapper)?;

    // 4. Tribes (depends on match)
    parse_tribes(xml, &tx, &mut id_mapper)?;

    // 5. Characters - PASS 1: Core data only (no relationships yet)
    parse_characters_core(xml, &tx, &mut id_mapper)?;

    // 6. Families (depends on players, characters for head)
    parse_families(xml, &tx, &mut id_mapper)?;

    // 7. Religions (depends on players, characters for head)
    parse_religions(xml, &tx, &mut id_mapper)?;

    // 8. Tiles (depends on players for ownership, cities for city-tile link)
    //    Note: Parse before cities since cities reference tiles
    parse_tiles(xml, &tx, &mut id_mapper)?;

    // 9. Cities (depends on players, characters for governor, tiles)
    parse_cities(xml, &tx, &mut id_mapper)?;

    // 10. Units (depends on players, characters for general, tiles)
    parse_units(xml, &tx, &mut id_mapper)?;

    // COMMIT POINT: All entities exist, now safe to add relationships

    tx.commit()?;
    Ok(())
}
```

### Pass 2: Relationships & Derived Data

After all entities exist, update relationships:

```rust
pub fn parse_relationships(xml: &XmlDocument, db: &Connection,
                          id_mapper: &IdMapper) -> Result<()> {
    let tx = db.transaction()?;

    // Update character parent relationships
    update_character_parents(xml, &tx, id_mapper)?;

    // Insert character marriages
    insert_character_marriages(xml, &tx, id_mapper)?;

    // Insert character relationships (loves, plotting, etc.)
    insert_character_relationships(xml, &tx, id_mapper)?;

    // Insert character traits
    insert_character_traits(xml, &tx, id_mapper)?;

    // Insert character stats
    insert_character_stats(xml, &tx, id_mapper)?;

    // Insert character missions
    insert_character_missions(xml, &tx, id_mapper)?;

    // City-specific data
    insert_city_yields(xml, &tx, id_mapper)?;
    insert_city_religions(xml, &tx, id_mapper)?;
    insert_city_production_queues(xml, &tx, id_mapper)?;

    // Unit promotions
    insert_unit_promotions(xml, &tx, id_mapper)?;

    // Technology
    insert_technologies_completed(xml, &tx, id_mapper)?;
    insert_technology_progress(xml, &tx, id_mapper)?;

    // Laws
    insert_laws(xml, &tx, id_mapper)?;

    // Diplomacy
    insert_diplomacy(xml, &tx, id_mapper)?;

    // Goals/Ambitions
    insert_player_goals(xml, &tx, id_mapper)?;

    // Events
    insert_story_events(xml, &tx, id_mapper)?;
    insert_event_outcomes(xml, &tx, id_mapper)?;

    tx.commit()?;
    Ok(())
}
```

### Pass 3: Time-Series Data

Handled separately due to volume and sparse format:

```rust
pub fn parse_timeseries(xml: &XmlDocument, db: &Connection,
                        id_mapper: &IdMapper) -> Result<()> {
    let tx = db.transaction()?;

    // These can be very large (100 turns × many yields × 6 players)
    insert_yield_history(xml, &tx, id_mapper)?;
    insert_points_history(xml, &tx, id_mapper)?;
    insert_military_history(xml, &tx, id_mapper)?;
    insert_legitimacy_history(xml, &tx, id_mapper)?;
    insert_family_opinion_history(xml, &tx, id_mapper)?;
    insert_religion_opinion_history(xml, &tx, id_mapper)?;
    insert_yield_prices(xml, &tx, id_mapper)?;

    tx.commit()?;
    Ok(())
}
```

---

## XML Parsing Patterns

### Pattern 1: Top-Level Siblings (Cities, Tiles)

**XML Structure:**
```xml
<Root>
  <City ID="15" Player="0">
    <Name>Hattusa</Name>
    <Founded>1</Founded>
    <Citizens>5</Citizens>
  </City>
  <City ID="23" Player="0">
    <Name>Kanesh</Name>
    ...
  </City>
</Root>
```

**Parsing Code (using roxmltree):**
```rust
pub fn parse_cities(doc: &roxmltree::Document, tx: &Transaction,
                    id_mapper: &mut IdMapper) -> Result<()> {
    // Find all City elements as direct children of Root
    for city_node in doc.root_element().children().filter(|n| n.has_tag_name("City")) {
        let xml_id = city_node.attribute("ID")
            .ok_or(ParseError::MissingAttribute("City.ID"))?
            .parse::<i32>()?;
        let db_id = id_mapper.map_city(xml_id);

        let player_xml_id = city_node.attribute("Player")
            .ok_or(ParseError::MissingAttribute("City.Player"))?
            .parse::<i32>()?;
        let db_player_id = id_mapper.get_player(player_xml_id)?;

        // Find child elements
        let name = city_node.children()
            .find(|n| n.has_tag_name("Name"))
            .and_then(|n| n.text())
            .ok_or(ParseError::MissingElement("City.Name"))?;

        let founded_turn = city_node.children()
            .find(|n| n.has_tag_name("Founded"))
            .and_then(|n| n.text())
            .ok_or(ParseError::MissingElement("City.Founded"))?
            .parse::<i32>()?;

        tx.execute(
            "INSERT INTO cities (city_id, match_id, player_id, city_name,
                                 founded_turn, xml_id)
             VALUES (?, ?, ?, ?, ?, ?)",
            params![db_id, id_mapper.match_id, db_player_id,
                   name, founded_turn, xml_id]
        )?;
    }
    Ok(())
}
```

### Pattern 2: Nested Within Player (UnitsProduced, YieldStockpile)

**XML Structure:**
```xml
<Player ID="0">
  <YieldStockpile>
    <YIELD_CIVICS>7967</YIELD_CIVICS>
    <YIELD_TRAINING>2267</YIELD_TRAINING>
  </YieldStockpile>
  <UnitsProduced>
    <UNIT_SETTLER>5</UNIT_SETTLER>
    <UNIT_WARRIOR>12</UNIT_WARRIOR>
  </UnitsProduced>
</Player>
```

**Parsing Code (using roxmltree):**
```rust
pub fn parse_player_resources(player_node: &roxmltree::Node, tx: &Transaction,
                               player_id: i64, match_id: i64) -> Result<()> {
    // Find YieldStockpile child element
    if let Some(yields_node) = player_node.children()
        .find(|n| n.has_tag_name("YieldStockpile")) {

        // Iterate over all child elements (YIELD_CIVICS, YIELD_TRAINING, etc.)
        for yield_node in yields_node.children().filter(|n| n.is_element()) {
            let yield_type = yield_node.tag_name().name(); // "YIELD_CIVICS"
            let amount = yield_node.text()
                .ok_or(ParseError::MissingElement("YieldStockpile child text"))?
                .parse::<i32>()?;

            tx.execute(
                "INSERT INTO player_resources
                 (player_id, match_id, yield_type, amount)
                 VALUES (?, ?, ?, ?)",
                params![player_id, match_id, yield_type, amount]
            )?;
        }
    }
    Ok(())
}
```

### Pattern 3: Sparse Time-Series Data

**XML Structure:**
```xml
<YieldPriceHistory>
  <YIELD_GROWTH>
    <T2>0</T2>
    <T5>0</T5>
    <T18>50</T18>
    <T45>75</T45>
  </YIELD_GROWTH>
</YieldPriceHistory>
```

**Parsing Code (using roxmltree):**
```rust
pub fn parse_yield_price_history(doc: &roxmltree::Document, tx: &Transaction,
                                  match_id: i64) -> Result<()> {
    // Find YieldPriceHistory element
    if let Some(history_node) = doc.descendants()
        .find(|n| n.has_tag_name("YieldPriceHistory")) {

        // Iterate over yield types (YIELD_GROWTH, etc.)
        for yield_node in history_node.children().filter(|n| n.is_element()) {
            let yield_type = yield_node.tag_name().name(); // "YIELD_GROWTH"

            // Iterate over turn elements (T2, T45, etc.)
            for turn_node in yield_node.children().filter(|n| n.is_element()) {
                // Parse "T45" → turn number 45
                let turn_tag = turn_node.tag_name().name();
                if !turn_tag.starts_with('T') {
                    continue; // Skip non-turn elements
                }
                let turn = turn_tag[1..].parse::<i32>()
                    .map_err(|_| ParseError::InvalidFormat(
                        format!("Invalid turn tag: {}", turn_tag)
                    ))?;

                let price = turn_node.text()
                    .ok_or(ParseError::MissingElement("Turn value"))?
                    .parse::<i32>()?;

                tx.execute(
                    "INSERT INTO yield_prices
                     (match_id, turn, yield_type, price)
                     VALUES (?, ?, ?, ?)",
                    params![match_id, turn, yield_type, price]
                )?;
            }
        }
    }
    Ok(())
}
```

### Pattern 4: Self-Referential Entities (Characters)

**XML Structure:**
```xml
<Character ID="10" Father="5" Mother="8">
  <FirstName>Hantili</FirstName>
  <BirthTurn>15</BirthTurn>
</Character>
<Character ID="5"> <!-- Father appears LATER -->
  <FirstName>Labarna</FirstName>
</Character>
```

**Two-Pass Solution:**

**Pass 1 - Core Data (using roxmltree):**
```rust
pub fn parse_characters_core(doc: &roxmltree::Document, tx: &Transaction,
                             id_mapper: &mut IdMapper) -> Result<()> {
    for char_node in doc.root_element().children()
        .filter(|n| n.has_tag_name("Character")) {

        let xml_id = char_node.attribute("ID")
            .ok_or(ParseError::MissingAttribute("Character.ID"))?
            .parse::<i32>()?;
        let db_id = id_mapper.map_character(xml_id);

        // Optional first name
        let first_name = char_node.children()
            .find(|n| n.has_tag_name("FirstName"))
            .and_then(|n| n.text())
            .map(|s| s.to_string());

        let birth_turn = char_node.children()
            .find(|n| n.has_tag_name("BirthTurn"))
            .and_then(|n| n.text())
            .ok_or(ParseError::MissingElement("Character.BirthTurn"))?
            .parse::<i32>()?;

        // Insert WITHOUT parent links (set to NULL)
        tx.execute(
            "INSERT INTO characters
             (character_id, match_id, first_name, birth_turn,
              birth_father_id, birth_mother_id, xml_id)
             VALUES (?, ?, ?, ?, NULL, NULL, ?)",
            params![db_id, id_mapper.match_id, first_name,
                   birth_turn, xml_id]
        )?;
    }
    Ok(())
}
```

**Pass 2 - Relationships (using roxmltree):**
```rust
pub fn update_character_parents(doc: &roxmltree::Document, tx: &Transaction,
                                id_mapper: &IdMapper) -> Result<()> {
    for char_node in doc.root_element().children()
        .filter(|n| n.has_tag_name("Character")) {

        let xml_id = char_node.attribute("ID")
            .ok_or(ParseError::MissingAttribute("Character.ID"))?
            .parse::<i32>()?;
        let db_id = id_mapper.get_character(xml_id)?;

        // Update father relationship if present
        if let Some(father_xml_id_str) = char_node.attribute("Father") {
            let father_xml_id = father_xml_id_str.parse::<i32>()?;
            let father_db_id = id_mapper.get_character(father_xml_id)?;

            tx.execute(
                "UPDATE characters SET birth_father_id = ?
                 WHERE character_id = ? AND match_id = ?",
                params![father_db_id, db_id, id_mapper.match_id]
            )?;
        }

        // Update mother relationship if present
        if let Some(mother_xml_id_str) = char_node.attribute("Mother") {
            let mother_xml_id = mother_xml_id_str.parse::<i32>()?;
            let mother_db_id = id_mapper.get_character(mother_xml_id)?;

            tx.execute(
                "UPDATE characters SET birth_mother_id = ?
                 WHERE character_id = ? AND match_id = ?",
                params![mother_db_id, db_id, id_mapper.match_id]
            )?;
        }
    }
    Ok(())
}
```

---

## Error Handling Strategy

### Error Types

```rust
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("Invalid ZIP file: {0}")]
    InvalidZipFile(String),

    #[error("Invalid archive structure: {0}")]
    InvalidArchiveStructure(String),

    #[error("File too large: {0} bytes (max: {1} bytes)")]
    FileTooLarge(u64, u64),

    #[error("Security violation: {0}")]
    SecurityViolation(String),

    #[error("Malformed XML at {location}: {message}\nContext: {context}")]
    MalformedXML {
        location: String,  // "line 45, col 12" or "/Root/Player[ID=0]/Character[ID=5]"
        message: String,
        context: String,   // Excerpt of problematic XML (capped at 300 chars)
    },

    #[error("Missing required attribute: {0}")]
    MissingAttribute(String),

    #[error("Missing required element: {0}")]
    MissingElement(String),

    #[error("Invalid data format: {0}")]
    InvalidFormat(String),

    #[error("Schema not initialized: {0}")]
    SchemaNotInitialized(String),

    #[error("Concurrency lock error: {0}")]
    ConcurrencyLock(String),

    #[error("Database error: {0}")]
    DatabaseError(#[from] duckdb::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Unknown player ID: {0} at {1}")]
    UnknownPlayerId(i32, String), // (xml_id, element_path)

    #[error("Unknown character ID: {0} at {1}")]
    UnknownCharacterId(i32, String),

    #[error("Unknown city ID: {0} at {1}")]
    UnknownCityId(i32, String),

    #[error("Unknown unit ID: {0} at {1}")]
    UnknownUnitId(i32, String),

    #[error("Unknown tile ID: {0} at {1}")]
    UnknownTileId(i32, String),

    #[error("Unknown family ID: {0} at {1}")]
    UnknownFamilyId(i32, String),

    #[error("Unknown religion ID: {0} at {1}")]
    UnknownReligionId(i32, String),

    #[error("Unknown tribe ID: {0} at {1}")]
    UnknownTribeId(i32, String),
}

/// Helper to create XML context excerpt (capped at 300 chars)
pub fn create_xml_context(xml: &str, position: usize) -> String {
    const CONTEXT_SIZE: usize = 150;
    let start = position.saturating_sub(CONTEXT_SIZE);
    let end = (position + CONTEXT_SIZE).min(xml.len());
    let excerpt = &xml[start..end];

    if start > 0 && end < xml.len() {
        format!("...{}...", excerpt)
    } else if start > 0 {
        format!("...{}", excerpt)
    } else if end < xml.len() {
        format!("{}...", excerpt)
    } else {
        excerpt.to_string()
    }
}
```

### Transaction Management

**All-or-Nothing Strategy:**

```rust
pub fn import_save_file(file_path: &str, db_path: &str) -> Result<ImportResult> {
    let conn = Connection::open(db_path)?;

    // Begin outer transaction
    let tx = conn.transaction()?;

    match parse_save_file_internal(file_path, &tx) {
        Ok(stats) => {
            tx.commit()?;
            Ok(ImportResult {
                success: true,
                stats,
                error: None,
            })
        }
        Err(e) => {
            // Automatic rollback when tx drops
            log::error!("Parse failed: {}. Rolling back transaction.", e);
            Ok(ImportResult {
                success: false,
                stats: ImportStats::default(),
                error: Some(e.to_string()),
            })
        }
    }
}
```

**Nested Transactions for Phases with Atomic ID Mapping:**

DuckDB supports savepoints for finer-grained rollback. **Critical:** Save id_mappings within the same transaction to prevent desynchronization on crash.

```rust
pub fn parse_save_file_internal(file_path: &str, tx: &Transaction,
                                 mut id_mapper: IdMapper) -> Result<ImportStats> {

    // Phase 1: Foundation entities
    tx.execute("SAVEPOINT phase1")?;
    match parse_foundation_entities(xml, tx, &mut id_mapper) {
        Ok(_) => {
            // Persist ID mappings IMMEDIATELY after entities inserted
            // This ensures atomicity: if transaction fails, mappings roll back too
            id_mapper.save_mappings_partial(tx, &["player", "character", "city",
                                                   "unit", "tile", "family",
                                                   "religion", "tribe"])?;
            tx.execute("RELEASE SAVEPOINT phase1")?;
        }
        Err(e) => {
            tx.execute("ROLLBACK TO SAVEPOINT phase1")?;
            return Err(e);
        }
    }

    // Phase 2: Relationships (updates only, no new entities)
    tx.execute("SAVEPOINT phase2")?;
    match parse_relationships(xml, tx, &id_mapper) {
        Ok(_) => tx.execute("RELEASE SAVEPOINT phase2")?,
        Err(e) => {
            tx.execute("ROLLBACK TO SAVEPOINT phase2")?;
            return Err(e);
        }
    }

    // Phase 3: Time-series (inserts only, no ID mapping needed)
    tx.execute("SAVEPOINT phase3")?;
    match parse_timeseries(xml, tx, &id_mapper) {
        Ok(_) => tx.execute("RELEASE SAVEPOINT phase3")?,
        Err(e) => {
            tx.execute("ROLLBACK TO SAVEPOINT phase3")?;
            return Err(e);
        }
    }

    Ok(stats)
}
```

**Why This Matters:**
- ID mappings saved in Phase 1 transaction, not deferred to end
- Crash after entity INSERT but before mapping save → no desync
- Mappings roll back with entities on error
- Phase 2/3 don't create new entities, so no additional mapping needed

---

## Special Cases & Edge Handling

### 1. Missing/Optional Data

**Strategy:** Use `NULL` in database, let DuckDB handle defaults

```rust
// Optional attribute
let cognomen = char_elem.attr("Cognomen")
    .and_then(|s| if s.is_empty() { None } else { Some(s) });

// Optional child element
let death_turn = char_elem.child_text("DeathTurn")
    .ok()
    .and_then(|s| s.parse::<i32>().ok());

// Insert with NULL
tx.execute(
    "INSERT INTO characters (..., cognomen, death_turn)
     VALUES (..., ?, ?)",
    params![cognomen, death_turn] // Option<T> → NULL if None
)?;
```

### 2. Special Sentinel Values

Some XML uses `-1` to indicate "none":

```rust
let chosen_heir = char_elem.child_text("ChosenHeirID")?
    .parse::<i32>()?;

let db_chosen_heir = if chosen_heir == -1 {
    None
} else {
    Some(id_mapper.get_character(chosen_heir)?)
};
```

### 3. Enum/Constant Validation

Game constants like `NATION_HITTITE` should be stored as-is:

```rust
let nation = player_elem.attr("Nation")?;
// Store string directly - no validation needed
// Database will contain "NATION_HITTITE", "NATION_BABYLONIA", etc.
```

**Rationale:** Game patches may add new values; storing strings keeps parser forward-compatible.

### 3.5. Schema Validation on Startup

Validate schema integrity before parsing to catch configuration errors early:

```rust
/// Validate schema integrity and return warnings (non-fatal issues)
pub fn validate_schema(conn: &Connection) -> Result<Vec<String>> {
    let mut warnings = Vec::new();

    // Check critical tables exist
    let required_tables = vec![
        "matches", "match_locks", "id_mappings", "players", "characters",
        "families", "religions", "tribes", "cities",
        "tiles", "units"
    ];

    for table in required_tables {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = ?)",
            params![table],
            |row| row.get(0)
        )?;

        if !exists {
            return Err(ParseError::SchemaNotInitialized(
                format!("Required table '{}' does not exist", table)
            ));
        }
    }

    // Validate all DELETE_ORDER tables exist (critical for updates)
    for table in DELETE_ORDER {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = ?)",
            params![table],
            |row| row.get(0)
        )?;

        if !exists {
            return Err(ParseError::SchemaNotInitialized(
                format!("Table '{}' referenced in DELETE_ORDER does not exist", table)
            ));
        }
    }

    // Check unique constraints for UPSERT support (critical)
    let upsert_tables = vec![
        "players", "characters", "cities", "tiles",
        "units", "families", "religions", "tribes"
    ];

    for table in upsert_tables {
        let has_xml_id_constraint: bool = conn.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM information_schema.indexes
                WHERE table_name = ?
                AND index_name LIKE '%xml_id%'
                AND is_unique = true
            )",
            params![table],
            |row| row.get(0)
        ).unwrap_or(false);

        if !has_xml_id_constraint {
            return Err(ParseError::SchemaNotInitialized(
                format!("Missing unique constraint on (match_id, xml_id) for table '{}'", table)
            ));
        }
    }

    // Check match_locks table has unique game_id constraint
    let has_game_lock_constraint: bool = conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM information_schema.indexes
            WHERE table_name = 'match_locks'
            AND column_name = 'game_id'
            AND is_unique = true
        )",
        params![],
        |row| row.get(0)
    ).unwrap_or(false);

    if !has_game_lock_constraint {
        warnings.push(
            "match_locks table missing unique constraint on game_id - concurrency control may fail".to_string()
        );
    }

    // Check matches table has unique game_id constraint
    let has_game_id_constraint: bool = conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM information_schema.indexes
            WHERE table_name = 'matches'
            AND column_name = 'game_id'
            AND is_unique = true
        )",
        params![],
        |row| row.get(0)
    ).unwrap_or(false);

    if !has_game_id_constraint {
        warnings.push(
            "matches table missing unique constraint on game_id - duplicate GameIds may occur".to_string()
        );
    }

    Ok(warnings)
}

/// Initialize and validate schema on first run
pub fn ensure_schema_ready(db_path: &Path) -> Result<()> {
    let conn = Connection::open(db_path)?;

    // Create app data dir if needed (race-safe)
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Initialize schema from schema.sql
    if !db_path.exists() {
        let schema_sql = include_str!("../../../docs/schema.sql");
        conn.execute_batch(schema_sql)?;
    }

    // Validate schema integrity
    let warnings = validate_schema(&conn)?;
    for warning in warnings {
        log::warn!("Schema validation: {}", warning);
    }

    Ok(())
}
```

**Benefits:**
- Catches missing tables before import starts
- Validates DELETE_ORDER against actual schema
- Detects missing UPSERT indexes
- Prevents cryptic SQL errors during import

### 4. Large Batch Inserts

Time-series data can be thousands of rows. Use prepared statements with batching:

```rust
pub fn insert_yield_history_batch(data: &[YieldHistoryRow],
                                   tx: &Transaction) -> Result<()> {
    let mut stmt = tx.prepare(
        "INSERT INTO yield_history
         (player_id, match_id, turn, yield_type, amount)
         VALUES (?, ?, ?, ?, ?)"
    )?;

    // Batch in chunks to balance memory and performance
    for chunk in data.chunks(1000) {
        for row in chunk {
            stmt.execute(params![
                row.player_id,
                row.match_id,
                row.turn,
                row.yield_type,
                row.amount
            ])?;
        }
    }

    Ok(())
}
```

**Advanced Optimization (for > 10k rows):**
```rust
// Option A: Build column vectors and use DuckDB appender
pub fn insert_yield_history_columnar(data: &[YieldHistoryRow],
                                      tx: &Transaction) -> Result<()> {
    // Build per-column vectors
    let player_ids: Vec<i64> = data.iter().map(|r| r.player_id).collect();
    let match_ids: Vec<i64> = data.iter().map(|r| r.match_id).collect();
    let turns: Vec<i32> = data.iter().map(|r| r.turn).collect();
    let yield_types: Vec<&str> = data.iter().map(|r| r.yield_type.as_str()).collect();
    let amounts: Vec<i32> = data.iter().map(|r| r.amount).collect();

    // Use DuckDB's column-oriented insert (if supported by crate)
    // Otherwise fall back to prepared statement batching
}

// Option B: Write to temporary Parquet and COPY
pub fn insert_yield_history_parquet(data: &[YieldHistoryRow],
                                     tx: &Transaction) -> Result<()> {
    let temp_path = write_temp_parquet(data)?;
    tx.execute(
        &format!("COPY yield_history FROM '{}'", temp_path),
        []
    )?;
    std::fs::remove_file(temp_path)?;
    Ok(())
}
```

**Benchmark Targets:**
- < 1,000 rows: Prepared statements (~100ms)
- 1,000-10,000 rows: Batched prepared statements (~500ms)
- > 10,000 rows: Consider Parquet COPY (~1-2 seconds)

---

## XML Parsing Helpers

To ensure consistent parsing and better error messages, use these helper traits:

```rust
// src-tauri/src/parser/xml_helpers.rs

use roxmltree::Node;

/// Extension trait for roxmltree nodes with better error handling
pub trait XmlNodeExt {
    /// Get required attribute with error context
    fn req_attr<T: FromStr>(&self, name: &str) -> Result<T>;

    /// Get optional attribute
    fn opt_attr<T: FromStr>(&self, name: &str) -> Option<T>;

    /// Get optional attribute, treating sentinel value as None
    fn opt_attr_sentinel<T: FromStr + PartialEq>(
        &self, name: &str, sentinel: T
    ) -> Option<T>;

    /// Get required child element text
    fn req_child_text<T: FromStr>(&self, name: &str) -> Result<T>;

    /// Get optional child element text
    fn opt_child_text<T: FromStr>(&self, name: &str) -> Option<T>;

    /// Get element path for error messages (e.g., "/Root/Player[ID=0]/Character[ID=5]")
    fn element_path(&self) -> String;
}

impl<'a, 'input: 'a> XmlNodeExt for Node<'a, 'input> {
    fn req_attr<T: FromStr>(&self, name: &str) -> Result<T> {
        let path = self.element_path();
        self.attribute(name)
            .ok_or_else(|| ParseError::MissingAttribute(format!("{}.{}", path, name)))?
            .parse()
            .map_err(|_| ParseError::InvalidFormat(format!("{}.{}", path, name)))
    }

    fn opt_attr<T: FromStr>(&self, name: &str) -> Option<T> {
        self.attribute(name)
            .and_then(|s| s.parse().ok())
    }

    fn opt_attr_sentinel<T: FromStr + PartialEq>(
        &self, name: &str, sentinel: T
    ) -> Option<T> {
        self.attribute(name)
            .and_then(|s| s.parse().ok())
            .and_then(|v| if v == sentinel { None } else { Some(v) })
    }

    fn req_child_text<T: FromStr>(&self, name: &str) -> Result<T> {
        let path = self.element_path();
        self.children()
            .find(|n| n.has_tag_name(name))
            .and_then(|n| n.text())
            .ok_or_else(|| ParseError::MissingElement(format!("{}/{}", path, name)))?
            .parse()
            .map_err(|_| ParseError::InvalidFormat(format!("{}/{}", path, name)))
    }

    fn opt_child_text<T: FromStr>(&self, name: &str) -> Option<T> {
        self.children()
            .find(|n| n.has_tag_name(name))
            .and_then(|n| n.text())
            .and_then(|s| s.parse().ok())
    }

    fn element_path(&self) -> String {
        let mut path = String::new();
        let mut current = Some(*self);

        while let Some(node) = current {
            if let Some(tag_name) = node.tag_name().name().into() {
                // Add ID attribute if present for disambiguation
                let id_suffix = node.attribute("ID")
                    .map(|id| format!("[ID={}]", id))
                    .unwrap_or_default();

                path = format!("/{}{}{}", tag_name, id_suffix, path);
            }
            current = node.parent_element();
        }

        if path.is_empty() { "/".to_string() } else { path }
    }
}

/// Centralized sentinel value constants and normalization
pub mod sentinels {
    pub const ID_NONE: i32 = -1;
    pub const TURN_INVALID: i32 = -1;
    pub const COUNT_NONE: i32 = -1;

    /// Normalize sentinel ID to None
    pub fn normalize_id(id: i32) -> Option<i32> {
        if id == ID_NONE {
            None
        } else {
            Some(id)
        }
    }

    /// Normalize sentinel turn to None
    pub fn normalize_turn(turn: i32) -> Option<i32> {
        if turn == TURN_INVALID || turn < 0 {
            None
        } else {
            Some(turn)
        }
    }

    /// Normalize empty string to None
    pub fn normalize_string(s: &str) -> Option<String> {
        if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        }
    }

    /// Validate turn is in reasonable range (strict mode)
    pub fn validate_turn(turn: i32, max_expected: i32) -> bool {
        turn >= 0 && turn <= max_expected
    }

    /// Validate count is non-negative (strict mode)
    pub fn validate_count(count: i32) -> bool {
        count >= 0
    }
}

/// Example usage in parser
pub fn parse_character_with_helpers(node: &Node, tx: &Transaction,
                                     id_mapper: &mut IdMapper) -> Result<()> {
    use xml_helpers::{XmlNodeExt, sentinels};

    // Required attributes - includes element path in errors
    let xml_id: i32 = node.req_attr("ID")?;
    let db_id = id_mapper.map_character(xml_id);

    // Optional attribute with sentinel normalization
    let chosen_heir_id: Option<i64> = node
        .opt_attr_sentinel("ChosenHeirID", sentinels::ID_NONE)
        .and_then(|xml_heir_id| id_mapper.get_character(xml_heir_id).ok());

    // Required child elements
    let birth_turn: i32 = node.req_child_text("BirthTurn")?;

    // Optional child elements
    let first_name: Option<String> = node.opt_child_text("FirstName");

    // If error occurs, element_path() provides context:
    // Error: Missing attribute: /Root/Character[ID=5].ID
    // Error: Invalid format: /Root/Character[ID=5]/BirthTurn

    Ok(())
}
```

**Benefits:**
- **Consistent**: All parsers use same patterns
- **Error Context**: Automatic element paths in errors
- **Sentinel Handling**: Centralized `-1` → `None` conversion
- **Type Safety**: Generic over `FromStr` types
- **Debugging**: Clear path shows exact XML location of error

---

## Testing Strategy

### Unit Tests

Each parser module should have tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_character_basic() {
        let xml = r#"
            <Character ID="5">
                <FirstName>Hantili</FirstName>
                <BirthTurn>10</BirthTurn>
                <Gender>GENDER_MALE</Gender>
            </Character>
        "#;

        let elem = parse_xml_fragment(xml).unwrap();
        let character = parse_character_core(&elem).unwrap();

        assert_eq!(character.first_name, Some("Hantili".to_string()));
        assert_eq!(character.birth_turn, 10);
    }

    #[test]
    fn test_parse_sparse_timeseries() {
        let xml = r#"
            <YieldPriceHistory>
                <YIELD_GROWTH>
                    <T2>0</T2>
                    <T45>75</T45>
                </YIELD_GROWTH>
            </YieldPriceHistory>
        "#;

        let history = parse_yield_price_history_xml(xml).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].turn, 2);
        assert_eq!(history[1].turn, 45);
    }
}
```

### Integration Tests

Full save file parsing:

```rust
#[test]
fn test_full_save_import() {
    let temp_db = create_temp_database();
    initialize_schema(&temp_db).unwrap();

    let result = import_save_file(
        "test-data/saves/OW-Hatti-Year99-2025-10-31-21-39-20.zip",
        temp_db.path()
    ).unwrap();

    assert!(result.success);
    assert_eq!(result.stats.players_imported, 6);
    assert!(result.stats.characters_imported > 0);

    // Verify data integrity
    let conn = Connection::open(temp_db.path()).unwrap();
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM characters WHERE match_id = ?",
        params![result.match_id],
        |row| row.get(0)
    ).unwrap();
    assert!(count > 0);
}

#[test]
fn test_update_and_replace() {
    let temp_db = create_temp_database();
    initialize_schema(&temp_db).unwrap();

    // Import first time
    let result1 = import_save_file("game-turn50.zip", temp_db.path()).unwrap();
    let match_id1 = result1.match_id;

    // Import again (same GameId, different turn)
    let result2 = import_save_file("game-turn75.zip", temp_db.path()).unwrap();
    let match_id2 = result2.match_id;

    // Should reuse same match_id
    assert_eq!(match_id1, match_id2);

    // Data should be replaced, not duplicated
    let conn = Connection::open(temp_db.path()).unwrap();
    let turn: i32 = conn.query_row(
        "SELECT total_turns FROM matches WHERE match_id = ?",
        params![match_id2],
        |row| row.get(0)
    ).unwrap();
    assert_eq!(turn, 75);
}
```

### Property-Based Tests

Use `proptest` for fuzzing:

```rust
#[cfg(test)]
mod proptests {
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn test_id_mapper_never_duplicates(xml_ids in prop::collection::vec(0i32..1000, 10..100)) {
            let mut mapper = IdMapper::new(1);
            let mut db_ids = Vec::new();

            for xml_id in xml_ids {
                let db_id = mapper.map_character(xml_id);
                db_ids.push(db_id);
            }

            // All DB IDs must be unique
            let unique_count = db_ids.iter().collect::<HashSet<_>>().len();
            assert_eq!(unique_count, db_ids.len());
        }
    }
}
```

---

## Implementation Milestones

### Milestone 1: Foundation (Week 1)
**Goal:** Basic parsing infrastructure and schema initialization with production-grade robustness

**Deliverables:**

**Schema & Database:**
- [ ] Database module with schema initialization from `schema.sql`
- [ ] Add `match_locks` table to schema for multi-process concurrency control
- [ ] Schema validation on startup (check tables, unique constraints, DELETE_ORDER integrity)
- [ ] Verify all UPSERT-ready unique constraints exist on core entity tables

**File Ingestion & Security:**
- [ ] ZIP extraction with comprehensive security validation:
  - [ ] Size limits (compressed & uncompressed)
  - [ ] Path traversal checks with path normalization
  - [ ] Zip bomb detection with configurable threshold
  - [ ] Control character rejection in filenames
  - [ ] Absolute path rejection
- [ ] UTF-8 encoding validation with helpful error messages
- [ ] XML loading using `roxmltree` with proper error context

**ID Mapping & Stability:**
- [ ] Complete `IdMapper` implementation with all entity types
- [ ] ID stability mechanism (load/save mappings within same transaction)
- [ ] UPSERT support for core entities using `ON CONFLICT (match_id, xml_id)`
- [ ] Atomic ID mapping persistence (saved in Phase 1 transaction)

**Concurrency Control:**
- [ ] In-process locking (Mutex-based for same-app concurrency)
- [ ] Database-level locking (lock table for cross-process safety)
- [ ] Stale lock cleanup mechanism
- [ ] GameId-based serialization

**Parsing:**
- [ ] Match metadata parser with UPSERT support
- [ ] Player parser with UPSERT (basic fields only)
- [ ] Transaction coordinator with DELETE-only for derived tables

**Progress & Error Handling:**
- [ ] Enhanced progress reporting with entity counts
- [ ] `ProgressCallback` trait with `ProgressInfo` struct
- [ ] Streaming progress updates during entity parsing
- [ ] Comprehensive error types with element path context
- [ ] XML context excerpts (capped at 300 chars)
- [ ] Centralized sentinel value normalization

**Infrastructure:**
- [ ] Tauri command with `spawn_blocking` for async handling
- [ ] Logging with appropriate levels (debug/info/warn/error)
- [ ] XML parsing helpers (`XmlNodeExt` trait) with better error messages
- [ ] Unit tests for core infrastructure

**Dependencies to Add:**
- `roxmltree = "0.19"`
- `thiserror = "1.0"`
- `log = "0.4"`
- `env_logger = "0.11"`
- `lazy_static = "1.4"` (for lock manager)

**Success Criteria:**
- ✅ Can import a save file and create match + players records
- ✅ Transactions roll back properly on error
- ✅ ZIP security validation rejects malicious files (traversal, zip bombs, control chars)
- ✅ UTF-8 encoding errors produce helpful messages
- ✅ Progress updates emit with detailed counts (e.g., "Parsing players (6/6)")
- ✅ Database IDs remain stable across re-imports (via id_mappings)
- ✅ UPSERT correctly updates existing records without DELETE
- ✅ Concurrent imports of same GameId serialize correctly (same app)
- ✅ Multi-process imports of same GameId serialize correctly (different apps)
- ✅ Schema validation catches missing tables/constraints on startup
- ✅ Sentinel values (-1, empty strings) normalized consistently
- ✅ Error messages include element paths for debugging

---

### Milestone 2: Core Entities (Week 2)
**Goal:** Parse main game entities

**Deliverables:**
- [ ] Character parser (two-pass implementation)
- [ ] City parser
- [ ] Tile parser
- [ ] Unit parser
- [ ] Family parser
- [ ] Religion parser
- [ ] Tribe parser
- [ ] Integration tests for entity parsing

**Success Criteria:**
- Can import full save file with all core entities
- Foreign keys validate correctly
- Character parent relationships work

---

### Milestone 3: Gameplay Data (Week 3)
**Goal:** Parse technology, laws, diplomacy, goals

**Deliverables:**
- [ ] Technology parser (completed + progress)
- [ ] Law parser
- [ ] Diplomacy parser
- [ ] Goal/Ambition parser
- [ ] Player resources parser
- [ ] Council positions parser

**Success Criteria:**
- All gameplay systems represented in database
- Can query "what techs did player complete?"
- Can query diplomatic relations

---

### Milestone 4: Time-Series Data (Week 4)
**Goal:** Parse historical turn-by-turn data

**Deliverables:**
- [ ] Yield history parser (sparse format handling)
- [ ] Points history parser
- [ ] Military history parser
- [ ] Legitimacy history parser
- [ ] Family opinion history parser
- [ ] Religion opinion history parser
- [ ] Yield prices parser
- [ ] Performance optimization for bulk inserts

**Success Criteria:**
- Can reconstruct game progression from turn 1 to current
- Sparse data handled correctly (missing turns)
- Performance acceptable (<10 seconds for full import)

---

### Milestone 5: Events & Narrative (Week 5)
**Goal:** Parse story events, choices, outcomes

**Deliverables:**
- [ ] Event log parser
- [ ] Story event parser
- [ ] Event choices parser
- [ ] Event outcomes parser
- [ ] Character missions parser
- [ ] Character stats parser

**Success Criteria:**
- Can reconstruct narrative timeline
- Event choices linked to outcomes
- Mission tracking complete

---

### Milestone 6: Edge Cases & Polish (Week 6)
**Goal:** Handle all edge cases, optimize, document

**Deliverables:**
- [ ] Comprehensive error messages
- [ ] Logging system (debug/info/warn/error levels)
- [ ] Performance profiling and optimization
- [ ] Update-and-replace logic verified
- [ ] Documentation for each parser module
- [ ] Example queries demonstrating data usage

**Success Criteria:**
- All test save files import successfully
- Parse failures produce actionable error messages
- Import performance: <15 seconds per save file
- Zero data loss (100% of covered schema populated)

---

## Performance Considerations

### Expected Performance Targets

**File Processing:**
- ZIP extraction: <1 second
- XML parsing to DOM: 2-3 seconds (11 MB file)
- Database inserts: 5-10 seconds
- **Total import time: <15 seconds per save file**

### Optimization Strategies

1. **Batch Inserts:**
   ```rust
   // Instead of individual inserts in loop
   for row in rows {
       tx.execute("INSERT ...")?; // Slow
   }

   // Use prepared statement + batch
   let mut stmt = tx.prepare("INSERT ...")?;
   for row in rows {
       stmt.execute(params![...])?; // Faster
   }
   ```

2. **Index Strategy:**
   - Create indexes AFTER bulk insert (faster than indexing during insert)
   - Use schema.sql indexes (already optimized for queries)

3. **Memory Management:**
   - XML document ~11 MB in memory (acceptable)
   - IdMapper ~1 KB (hundreds of entities × few bytes each)
   - Total memory footprint: <50 MB

4. **Parallelization (Future):**
   - Parse multiple save files in parallel (separate transactions)
   - Do NOT parallelize within single file (transaction integrity)

---

## Tauri Integration

### Command Interface

```rust
// src-tauri/src/commands.rs

#[tauri::command]
pub async fn import_save_file(
    file_path: String,
    app_handle: tauri::AppHandle,
    window: tauri::Window,
) -> Result<ImportResult, String> {
    // Get database path from Tauri app data dir
    let app_data_dir = app_handle
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?;

    // Ensure app data directory exists
    if !app_data_dir.exists() {
        std::fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    }

    let db_path = app_data_dir.join("game_data.db");
    let db_path_str = db_path.to_str()
        .ok_or("Invalid database path")?
        .to_string();

    // Ensure database exists and schema is initialized
    if !db_path.exists() {
        crate::db::schema::initialize(&db_path)
            .map_err(|e| e.to_string())?;
    }

    // Run import on blocking thread pool to avoid blocking UI
    // This is critical for long-running operations (10-15 seconds)
    tauri::async_runtime::spawn_blocking(move || {
        // Create progress callback that emits Tauri events
        let progress_callback = TauriProgressCallback::new(window);

        // Import save file with progress updates
        crate::parser::save_file::import_save_file(
            &file_path,
            &db_path_str,
            progress_callback
        ).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Progress callback that emits Tauri events to frontend
struct TauriProgressCallback {
    window: tauri::Window,
}

impl TauriProgressCallback {
    fn new(window: tauri::Window) -> Self {
        Self { window }
    }
}

impl ProgressCallback for TauriProgressCallback {
    fn on_progress(&self, phase: &str, percent: u8) {
        let _ = self.window.emit("import_progress", serde_json::json!({
            "phase": phase,
            "percent": percent
        }));
    }
}

#[derive(serde::Serialize)]
pub struct ImportResult {
    pub success: bool,
    pub match_id: Option<i64>,
    pub stats: ImportStats,
    pub error: Option<String>,
}

#[derive(Default, serde::Serialize)]
pub struct ImportStats {
    pub players_imported: usize,
    pub characters_imported: usize,
    pub cities_imported: usize,
    pub units_imported: usize,
    pub tiles_imported: usize,
    pub timeseries_rows: usize,
}
```

### Frontend Usage (Svelte)

```typescript
// src/lib/api/saveImporter.ts
import { invoke } from '@tauri-apps/api/tauri';

export interface ImportResult {
  success: boolean;
  match_id?: number;
  stats: {
    players_imported: number;
    characters_imported: number;
    cities_imported: number;
    units_imported: number;
    tiles_imported: number;
    timeseries_rows: number;
  };
  error?: string;
}

export async function importSaveFile(filePath: string): Promise<ImportResult> {
  return await invoke<ImportResult>('import_save_file', { filePath });
}
```

---

## Logging & Observability

### Log Levels

```rust
use log::{debug, info, warn, error};

pub fn import_save_file(file_path: &str, db_path: &str) -> Result<ImportResult> {
    info!("Starting import: {}", file_path);

    debug!("Extracting ZIP archive...");
    let xml = extract_xml(file_path)?;

    debug!("Parsing match metadata...");
    let game_id = extract_game_id(&xml)?;
    info!("Game ID: {}", game_id);

    match check_existing_match(db_path, &game_id)? {
        Some(match_id) => {
            warn!("Match {} already exists. Will update and replace data.", match_id);
        }
        None => {
            info!("New match detected. Creating match record.");
        }
    }

    // ... parsing logic ...

    info!("Import completed: {} players, {} characters, {} cities",
          stats.players_imported,
          stats.characters_imported,
          stats.cities_imported);

    Ok(result)
}
```

### Progress Reporting Strategy

**Why Important:** Import takes 10-15 seconds; progress feedback is essential UX.

**Implementation:**

```rust
/// Progress information with counts for better user feedback
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProgressInfo {
    pub phase: String,
    pub percent: u8,
    pub count_current: Option<usize>,
    pub count_total: Option<usize>,
    pub message: Option<String>,
}

/// Trait for progress callbacks with count support
pub trait ProgressCallback: Send + Sync {
    fn on_progress(&self, info: ProgressInfo);
}

/// Helper to create progress with counts
impl ProgressInfo {
    pub fn new(phase: &str, percent: u8) -> Self {
        Self {
            phase: phase.to_string(),
            percent,
            count_current: None,
            count_total: None,
            message: None,
        }
    }

    pub fn with_counts(phase: &str, percent: u8, current: usize, total: usize) -> Self {
        Self {
            phase: phase.to_string(),
            percent,
            count_current: Some(current),
            count_total: Some(total),
            message: Some(format!("{}/{}", current, total)),
        }
    }

    pub fn with_message(phase: &str, percent: u8, message: &str) -> Self {
        Self {
            phase: phase.to_string(),
            percent,
            count_current: None,
            count_total: None,
            message: Some(message.to_string()),
        }
    }
}

/// Update import_save_file signature to accept progress callback
pub fn import_save_file<P: ProgressCallback>(
    file_path: &str,
    db_path: &str,
    progress: P
) -> Result<ImportResult> {
    progress.on_progress(ProgressInfo::new("Extracting ZIP", 5));
    let xml = extract_xml(file_path)?;

    progress.on_progress(ProgressInfo::with_message(
        "Parsing XML",
        10,
        &format!("{:.1} MB", xml.len() as f64 / 1024.0 / 1024.0)
    ));
    let doc = roxmltree::Document::parse(&xml)?;

    progress.on_progress(ProgressInfo::new("Match identification", 15));
    let (match_id, is_new) = identify_match(&doc, db_path)?;

    progress.on_progress(ProgressInfo::new("Initializing ID mapper", 20));
    let mut id_mapper = IdMapper::new(match_id, &conn, is_new)?;

    // Count entities for progress reporting
    let player_count = count_elements(&doc, "Player");
    let character_count = count_elements(&doc, "Character");
    let city_count = count_elements(&doc, "City");
    let tile_count = count_elements(&doc, "Tile");
    let unit_count = count_elements(&doc, "Unit");

    progress.on_progress(ProgressInfo::with_counts("Parsing players", 25, 0, player_count));
    parse_players(&doc, &tx, &mut id_mapper, &progress)?;

    progress.on_progress(ProgressInfo::with_counts("Parsing characters", 35, 0, character_count));
    parse_characters_core(&doc, &tx, &mut id_mapper, &progress)?;

    progress.on_progress(ProgressInfo::with_counts("Parsing cities", 45, 0, city_count));
    parse_cities(&doc, &tx, &mut id_mapper, &progress)?;

    progress.on_progress(ProgressInfo::with_counts("Parsing tiles", 50, 0, tile_count));
    parse_tiles(&doc, &tx, &mut id_mapper, &progress)?;

    progress.on_progress(ProgressInfo::with_counts("Parsing units", 55, 0, unit_count));
    parse_units(&doc, &tx, &mut id_mapper, &progress)?;

    progress.on_progress(ProgressInfo::new("Updating relationships", 65));
    update_character_parents(&doc, &tx, &id_mapper)?;

    progress.on_progress(ProgressInfo::new("Parsing time-series data", 75));
    parse_timeseries(&doc, &tx, &id_mapper, &progress)?;

    progress.on_progress(ProgressInfo::new("Saving ID mappings", 95));
    id_mapper.save_mappings(&conn)?;

    progress.on_progress(ProgressInfo::with_message(
        "Complete",
        100,
        &format!("{} entities imported", stats.total_entities)
    ));
    Ok(result)
}

/// No-op progress callback for tests
pub struct NoOpProgress;
impl ProgressCallback for NoOpProgress {
    fn on_progress(&self, _info: ProgressInfo) {}
}
```

**Progress Milestones with Counts:**
- 5% - ZIP extracted
- 10% - XML parsed (11.2 MB)
- 15% - Match identified (new/updating)
- 17% - Schema validated
- 20% - ID mapper initialized
- 25% - Parsing players (6/6)
- 30% - Parsing tribes (4/4)
- 35% - Parsing characters (450/450)
- 40% - Parsing families (8/8)
- 42% - Parsing religions (3/3)
- 45% - Parsing tiles (12000/12000)
- 50% - Parsing cities (15/15)
- 55% - Parsing units (120/120)
- 60% - Updating character relationships
- 65% - Parsing city data (yields, religions, queues)
- 70% - Parsing technology data
- 75% - Parsing time-series data (50000 rows)
- 85% - Parsing events and goals
- 90% - Saving ID mappings
- 95% - Committing transaction
- 100% - Complete (12,600 entities imported)

**Frontend Display Example:**
```
[████████░░] 75% - Parsing time-series data (50,000 rows)
[█████████░] 85% - Parsing events and goals
[██████████] 100% - Complete (12,600 entities imported)
```

**Enhanced Progress Callback with Streaming Updates:**
```rust
/// Enhanced progress callback for individual entity updates
impl ProgressCallback for TauriProgressCallback {
    fn on_progress(&self, info: ProgressInfo) {
        let _ = self.window.emit("import_progress", info);
    }
}

/// Stream progress updates during entity parsing
pub fn parse_cities_with_progress<P: ProgressCallback>(
    doc: &roxmltree::Document,
    tx: &Transaction,
    id_mapper: &mut IdMapper,
    progress: &P
) -> Result<()> {
    let city_nodes: Vec<_> = doc.root_element()
        .children()
        .filter(|n| n.has_tag_name("City"))
        .collect();

    let total = city_nodes.len();

    for (index, city_node) in city_nodes.iter().enumerate() {
        // Parse and insert city
        parse_single_city(city_node, tx, id_mapper)?;

        // Report progress every 10 cities or on final city
        if index % 10 == 0 || index == total - 1 {
            let percent = 45 + ((index + 1) * 5 / total) as u8; // 45-50% range
            progress.on_progress(ProgressInfo::with_counts(
                "Parsing cities",
                percent,
                index + 1,
                total
            ));
        }
    }

    Ok(())
}
```

**Note:** This is part of Milestone 1 deliverables, not a future enhancement

---

## Future Enhancements

### Phase 2 Features (Post-MVP)

1. **Incremental Updates:**
   - Instead of full replace, detect what changed and UPDATE only modified entities
   - Requires change detection logic

2. **Validation Layer:**
   - Validate XML data against expected ranges/formats before insert
   - Catch data anomalies (e.g., negative population, turn numbers out of range)

3. **Conflict Resolution:**
   - If user manually edited database, detect conflicts before replace
   - Offer merge strategies

4. **Export Functionality:**
   - Export match data back to XML (reverse operation)
   - Useful for debugging or data portability

5. **Schema Versioning:**
   - Handle Old World game updates that change XML structure
   - Migrate old save files to new schema format

6. **Parallel Import:**
   - Import multiple save files simultaneously
   - Utilize multi-core CPUs for faster batch processing

---

## Conclusion

This implementation plan provides a comprehensive roadmap for building a robust, maintainable parser that transforms Old World save files into structured database records. The modular design, clear error handling, and phased milestones ensure steady progress toward a fully functional data ingestion pipeline.

**Next Steps:**
1. Review and approve this plan
2. Set up basic Rust project structure
3. Begin Milestone 1 implementation
4. Iterate based on actual XML complexity discovered during development

---

**Document Version:** 2.2
**Last Updated:** 2025-11-05
**Status:** Production-Ready Implementation Plan

**Revision Summary (v2.2 - Reviewer Feedback Integration):**

**Tier 1 Changes (Critical for Correctness):**
- **UPSERT Strategy**: Core entities now use `INSERT ... ON CONFLICT (match_id, xml_id) DO UPDATE` instead of DELETE-then-INSERT
  - Eliminates churn and temporary FK constraint violations
  - Only derived/child tables use DELETE-then-INSERT
  - Schema already has required unique constraints
- **Multi-Process Locking**: Added database-level locking via `match_locks` table
  - In-process Mutex for same-app concurrency
  - Database lock table for cross-process safety
  - Stale lock cleanup mechanism (10-minute timeout)
  - Prevents corruption from concurrent imports across app instances
- **Enhanced ZIP Security**: Improved path validation
  - Path separator normalization (Windows/Unix)
  - Control character rejection in filenames
  - Absolute path detection after normalization
  - Empty path component validation
- **UTF-8 Encoding Validation**: Explicit encoding checks
  - Validates UTF-8 before parsing
  - Detects and warns about non-UTF-8 XML declarations
  - Clear error messages for encoding issues
- **Enhanced Progress Reporting**: Counts for all phases
  - Entity counts (e.g., "Parsing characters (450/450)")
  - File size display
  - Total entities imported
  - Streaming updates during large entity parsing
- **Schema Validation**: Comprehensive startup checks
  - Validates all DELETE_ORDER tables exist
  - Checks unique constraints for UPSERT support
  - Verifies match_locks and game_id constraints
  - Returns detailed error messages for missing schema elements

**Tier 2 Changes (Important for Robustness):**
- **Centralized Sentinel Handling**: New `sentinels` module
  - `normalize_id()`, `normalize_turn()`, `normalize_string()` helpers
  - Strict mode validators for range checking
  - Consistent -1 → None conversion
- **Enhanced Error Context**: Better debugging information
  - Element paths in all Unknown*Id errors
  - XML context excerpts capped at 300 chars
  - `create_xml_context()` helper function
  - Concurrency lock error type
- **Configurable Thresholds**: Security tuning
  - `MAX_COMPRESSION_RATIO` constant (100.0x default)
  - Compression ratio logging for monitoring
  - Debug logs for high compression (>10x)

**Updated Milestone 1:**
- Expanded from 12 to 30+ deliverables
- Organized into 6 categories (Schema, Security, ID Mapping, Concurrency, Parsing, Progress)
- Added 17 success criteria (vs 6 previously)
- All Tier 1 and Tier 2 changes incorporated

**Revision Summary (v2.1 - Production Hardening):**
- **Atomicity**: ID mappings saved within same transaction as entities
- **UPSERT Strategy** (initial): Core entities use INSERT...ON CONFLICT for stability
- **Unique Constraints**: Added (match_id, xml_id) indexes for idempotent updates
- **Hybrid Streaming**: Support files > 20 MB with streaming + targeted DOM
- **Bulk Insert**: Added Parquet COPY strategy for > 10k row time-series
- **Parsing Helpers**: XmlNodeExt trait with element paths and sentinel normalization
- **Progress Fidelity**: Enhanced with entity counts and detailed messages
- **Schema Validation**: Startup checks for tables, indexes, and DELETE_ORDER

**Revision Summary (v2.0):**
- Switched from `quick-xml` to `roxmltree` for DOM-based parsing
- Added complete `IdMapper` API with all entity types
- Implemented ID stability strategy with `id_mappings` table
- Added comprehensive ZIP security validation
- Added concurrency control for parallel imports
- Moved progress reporting from future enhancement to Milestone 1
- Added `spawn_blocking` for Tauri async handling
- Documented complete DELETE cascade order
- Enhanced error types with better provenance
- Updated all code examples to use `roxmltree`
- Addressed all critical issues from architectural reviews
