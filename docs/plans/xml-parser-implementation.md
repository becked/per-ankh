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
6. Parse XML using `roxmltree` into DOM tree structure
7. Validate root element is `<Root>`

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

        // Security: Check for path traversal
        let file_name = file.name();
        if file_name.contains("..") || file_name.starts_with('/') {
            return Err(ParseError::SecurityViolation(
                format!("Path traversal attempt: {}", file_name)
            ));
        }

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
        if compression_ratio > 100.0 {
            return Err(ParseError::SecurityViolation(
                format!("Suspicious compression ratio: {:.1}x", compression_ratio)
            ));
        }

        // Find XML file
        if file_name.ends_with(".xml") {
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
    file.read_to_string(&mut xml_content)?;

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

**Update-and-Replace Strategy:**
When updating existing match, delete all data in **strict reverse foreign key order**:

```rust
/// Complete deletion order respecting all foreign key constraints
const DELETE_ORDER: &[&str] = &[
    // Leaf tables (no children) - delete first
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
    "yield_history",
    "points_history",
    "military_history",
    "legitimacy_history",
    "yield_prices",

    // Parent entities (referenced by children above)
    "units",
    "tiles",
    "cities",
    "characters",
    "families",
    "religions",
    "tribes",
    "players",

    // Match data last (but don't delete from matches table itself)
    "match_settings",
    // NOTE: id_mappings is preserved - not deleted
    // NOTE: matches row is updated, not deleted
];

/// Execute deletion for update
fn delete_existing_match_data(tx: &Transaction, match_id: i64) -> Result<()> {
    for table in DELETE_ORDER {
        tx.execute(
            &format!("DELETE FROM {} WHERE match_id = ?", table),
            params![match_id]
        )?;
    }
    Ok(())
}
```

**Important Notes:**
- `id_mappings` table is **preserved** to maintain ID stability
- `matches` table row is **updated**, not deleted (preserves match_id)
- Order tested against schema.sql foreign key constraints
- Then re-insert all data with stable database IDs

**Concurrency Control:**
To prevent race conditions when two imports of the same GameId run concurrently:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Global lock manager for concurrent imports
lazy_static! {
    static ref IMPORT_LOCKS: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

/// Acquire exclusive lock for a GameId
pub fn acquire_game_lock(game_id: &str) -> Arc<Mutex<()>> {
    let mut locks = IMPORT_LOCKS.lock().unwrap();
    locks.entry(game_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

/// Import with concurrency protection
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

    // Acquire lock for this GameId (blocks if another import is running)
    let _lock = acquire_game_lock(game_id).lock().unwrap();

    // Now safe to proceed - we have exclusive access for this GameId
    import_save_file_internal(&doc, db_path, progress)
}
```

**Alternative: Database-Level Locking**
```sql
-- Add unique constraint to prevent duplicate game_id
ALTER TABLE matches ADD CONSTRAINT unique_game_id UNIQUE (game_id);

-- Or use advisory locks in DuckDB (if supported)
SELECT pg_advisory_lock(hashtext('game_id_value'));
-- ... perform import ...
SELECT pg_advisory_unlock(hashtext('game_id_value'));
```

**Why This Matters:**
- Without locking, two parallel imports of same GameId could interleave DELETE/INSERT operations
- Results in corrupted or incomplete data
- Lock ensures serialization: second import waits for first to complete
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

    /// Save all mappings to database for future updates
    pub fn save_mappings(&self, conn: &Connection) -> Result<()> {
        let mut stmt = conn.prepare(
            "INSERT INTO id_mappings (match_id, entity_type, xml_id, db_id)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (match_id, entity_type, xml_id)
             DO UPDATE SET db_id = excluded.db_id"
        )?;

        // Save all entity type mappings
        for (&xml_id, &db_id) in &self.players {
            stmt.execute(params![self.match_id, "player", xml_id, db_id])?;
        }
        for (&xml_id, &db_id) in &self.characters {
            stmt.execute(params![self.match_id, "character", xml_id, db_id])?;
        }
        for (&xml_id, &db_id) in &self.cities {
            stmt.execute(params![self.match_id, "city", xml_id, db_id])?;
        }
        for (&xml_id, &db_id) in &self.units {
            stmt.execute(params![self.match_id, "unit", xml_id, db_id])?;
        }
        for (&xml_id, &db_id) in &self.tiles {
            stmt.execute(params![self.match_id, "tile", xml_id, db_id])?;
        }
        for (&xml_id, &db_id) in &self.families {
            stmt.execute(params![self.match_id, "family", xml_id, db_id])?;
        }
        for (&xml_id, &db_id) in &self.religions {
            stmt.execute(params![self.match_id, "religion", xml_id, db_id])?;
        }
        for (&xml_id, &db_id) in &self.tribes {
            stmt.execute(params![self.match_id, "tribe", xml_id, db_id])?;
        }

        Ok(())
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
        location: String,  // "line 45, col 12" or "element path"
        message: String,
        context: String,   // Excerpt of problematic XML
    },

    #[error("Missing required attribute: {0}")]
    MissingAttribute(String),

    #[error("Missing required element: {0}")]
    MissingElement(String),

    #[error("Invalid data format: {0}")]
    InvalidFormat(String),

    #[error("Schema not initialized: missing table {0}")]
    SchemaNotInitialized(String),

    #[error("Database error: {0}")]
    DatabaseError(#[from] duckdb::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Unknown player ID: {0}")]
    UnknownPlayerId(i32),

    #[error("Unknown character ID: {0}")]
    UnknownCharacterId(i32),

    #[error("Unknown city ID: {0}")]
    UnknownCityId(i32),

    #[error("Unknown unit ID: {0}")]
    UnknownUnitId(i32),

    #[error("Unknown tile ID: {0}")]
    UnknownTileId(i32),

    #[error("Unknown family ID: {0}")]
    UnknownFamilyId(i32),

    #[error("Unknown religion ID: {0}")]
    UnknownReligionId(i32),

    #[error("Unknown tribe ID: {0}")]
    UnknownTribeId(i32),
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

**Nested Transactions for Phases:**

DuckDB supports savepoints for finer-grained rollback:

```rust
pub fn parse_save_file_internal(file_path: &str, tx: &Transaction)
    -> Result<ImportStats> {

    // Phase 1: Foundation
    tx.execute("SAVEPOINT phase1")?;
    match parse_foundation_entities(xml, tx, &mut id_mapper) {
        Ok(_) => tx.execute("RELEASE SAVEPOINT phase1")?,
        Err(e) => {
            tx.execute("ROLLBACK TO SAVEPOINT phase1")?;
            return Err(e);
        }
    }

    // Phase 2: Relationships
    tx.execute("SAVEPOINT phase2")?;
    match parse_relationships(xml, tx, &id_mapper) {
        Ok(_) => tx.execute("RELEASE SAVEPOINT phase2")?,
        Err(e) => {
            tx.execute("ROLLBACK TO SAVEPOINT phase2")?;
            return Err(e);
        }
    }

    // Phase 3: Time-series
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

### 4. Large Batch Inserts

Time-series data can be thousands of rows. Use prepared statements:

```rust
pub fn insert_yield_history_batch(data: &[YieldHistoryRow],
                                   tx: &Transaction) -> Result<()> {
    let mut stmt = tx.prepare(
        "INSERT INTO yield_history
         (player_id, match_id, turn, yield_type, amount)
         VALUES (?, ?, ?, ?, ?)"
    )?;

    for row in data {
        stmt.execute(params![
            row.player_id,
            row.match_id,
            row.turn,
            row.yield_type,
            row.amount
        ])?;
    }

    Ok(())
}
```

**Optimization:** Consider using DuckDB's `COPY` or `APPEND` for bulk inserts if performance becomes an issue.

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
**Goal:** Basic parsing infrastructure and schema initialization

**Deliverables:**
- [ ] Database module with schema initialization from `schema.sql`
- [ ] Add `id_mappings` table to schema for ID stability
- [ ] ZIP extraction with security validation (size limits, path traversal checks, zip bomb detection)
- [ ] XML loading using `roxmltree`
- [ ] Complete `IdMapper` implementation with all entity types
- [ ] ID stability mechanism (load/save mappings)
- [ ] Concurrency control (GameId-based locking)
- [ ] Match metadata parser
- [ ] Player parser (basic fields only)
- [ ] Transaction coordinator with complete DELETE cascade order
- [ ] Progress reporting infrastructure (`ProgressCallback` trait)
- [ ] Tauri command with `spawn_blocking` for async handling
- [ ] Unit tests for core infrastructure

**Dependencies to Add:**
- `roxmltree = "0.19"` (replace quick-xml)
- `thiserror = "1.0"`
- `log = "0.4"`
- `env_logger = "0.11"`
- `lazy_static = "1.4"` (for lock manager)

**Success Criteria:**
- Can import a save file and create match + players records
- Transactions roll back properly on error
- ZIP security validation rejects malicious files
- Progress updates emit during import
- Database IDs remain stable across re-imports
- Concurrent imports of same GameId serialize correctly

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
/// Trait for progress callbacks
pub trait ProgressCallback: Send + Sync {
    fn on_progress(&self, phase: &str, percent: u8);
}

/// Update import_save_file signature to accept progress callback
pub fn import_save_file<P: ProgressCallback>(
    file_path: &str,
    db_path: &str,
    progress: P
) -> Result<ImportResult> {
    progress.on_progress("Extracting ZIP", 5);
    let xml = extract_xml(file_path)?;

    progress.on_progress("Parsing XML", 10);
    let doc = roxmltree::Document::parse(&xml)?;

    progress.on_progress("Match metadata", 15);
    let (match_id, is_new) = identify_match(&doc, db_path)?;

    progress.on_progress("Initializing ID mapper", 20);
    let mut id_mapper = IdMapper::new(match_id, &conn, is_new)?;

    progress.on_progress("Parsing players", 25);
    parse_players(&doc, &tx, &mut id_mapper)?;

    progress.on_progress("Parsing characters", 35);
    parse_characters_core(&doc, &tx, &mut id_mapper)?;

    progress.on_progress("Parsing cities", 45);
    parse_cities(&doc, &tx, &mut id_mapper)?;

    progress.on_progress("Parsing tiles", 50);
    parse_tiles(&doc, &tx, &mut id_mapper)?;

    progress.on_progress("Parsing units", 55);
    parse_units(&doc, &tx, &mut id_mapper)?;

    progress.on_progress("Updating relationships", 65);
    update_character_parents(&doc, &tx, &id_mapper)?;

    progress.on_progress("Parsing time-series data", 75);
    parse_timeseries(&doc, &tx, &id_mapper)?;

    progress.on_progress("Saving ID mappings", 95);
    id_mapper.save_mappings(&conn)?;

    progress.on_progress("Complete", 100);
    Ok(result)
}

/// No-op progress callback for tests
pub struct NoOpProgress;
impl ProgressCallback for NoOpProgress {
    fn on_progress(&self, _phase: &str, _percent: u8) {}
}
```

**Progress Milestones:**
- 5% - ZIP extracted
- 10% - XML parsed
- 15% - Match identified
- 20% - ID mapper initialized
- 25% - Players parsed
- 35% - Characters parsed
- 45% - Cities parsed
- 50% - Tiles parsed
- 55% - Units parsed
- 65% - Relationships updated
- 75% - Time-series parsing started
- 95% - ID mappings saved
- 100% - Complete

**Note:** This is part of Milestone 1, not a future enhancement

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

**Document Version:** 2.0
**Last Updated:** 2025-11-05
**Status:** Revised - Ready for Implementation

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
