# Hybrid Parser Architecture & Parallel Parsing

**Status:** Planning Document
**Date:** 2025-11-06
**Goal:** Migrate from direct-write parser to hybrid architecture with parallel parsing support

---

## Table of Contents

1. [Current Architecture](#current-architecture)
2. [Problems with Current Approach](#problems-with-current-approach)
3. [Proposed Hybrid Architecture](#proposed-hybrid-architecture)
4. [Parallel Parsing Strategy](#parallel-parsing-strategy)
5. [Performance Impact](#performance-impact)
6. [Migration Plan](#migration-plan)
7. [Implementation Details](#implementation-details)
8. [Testing Strategy](#testing-strategy)
9. [Code Examples](#code-examples)

---

## Current Architecture

### Overview

The current parser follows a **direct-write** pattern:

```
┌─────────────┐
│  ZIP File   │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│ validate_and_extract│  ← Security validation
│     _xml()          │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│   parse_xml()       │  ← roxmltree DOM parsing
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ import_save_file    │  ← Orchestration
│  _internal()        │
└──────┬──────────────┘
       │
       ├─► parse_players(doc, conn, id_mapper)
       │   └─► Inserts directly to DB via Appender
       │
       ├─► parse_characters_core(doc, conn, id_mapper)
       │   └─► Inserts directly to DB via Appender
       │
       ├─► parse_cities(doc, conn, id_mapper)
       │   └─► Inserts directly to DB via Appender
       │
       └─► ... 20+ more entity parsers
           └─► All insert directly to DB

┌─────────────────────┐
│   DuckDB Database   │  ← All data written during parsing
└─────────────────────┘
```

### Key Characteristics

**Data Flow:**
```rust
XML → Parse node → Extract data → Appender → DB
     ↑                                        ↑
     └──── Single pass ──────────────────────┘
```

**Example from `entities/players.rs`:**

```rust
pub fn parse_players(
    doc: &XmlDocument,
    conn: &Connection,          // ← Requires DB connection
    id_mapper: &mut IdMapper
) -> Result<usize> {
    let mut app = conn.appender("players")?;  // ← DB dependency

    for player_node in root.children() {
        let xml_id = player_node.req_attr("ID")?.parse()?;
        let db_id = id_mapper.map_player(xml_id);
        let player_name = player_node.req_attr("Name")?;

        // Immediate insertion - no intermediate storage
        app.append_row(params![db_id, player_name, ...])?;
    }

    Ok(count)
}
```

### Pros of Current Approach

1. ✅ **Memory efficient**: Data flows XML → DB without intermediate allocations
2. ✅ **Simple flow**: Parse and insert in one operation
3. ✅ **Bulk insert performance**: Uses DuckDB Appender for fast inserts
4. ✅ **Transactional safety**: All wrapped in single transaction

### Cons of Current Approach

1. ❌ **Tight DB coupling**: Every parser requires database connection
2. ❌ **Hard to test**: Can't test parsing logic without database
3. ❌ **Sequential only**: Can't parallelize parsing (shared mutable id_mapper + conn)
4. ❌ **No intermediate representation**: Can't inspect/cache parsed data
5. ❌ **Mixed concerns**: Parsing logic mixed with persistence logic
6. ❌ **Debugging difficulty**: Can't examine parsed data before DB insertion

---

## Problems with Current Approach

### 1. Testing Complexity

**Current:**
```rust
#[test]
fn test_parse_players() {
    // Need full database setup for simple parsing test
    let conn = Connection::open_in_memory().unwrap();
    setup_schema(&conn).unwrap();
    let mut id_mapper = IdMapper::new(1, &conn, true).unwrap();

    let xml = r#"<Root><Player ID="0" Name="Test"/></Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();

    parse_players(&doc, &conn, &mut id_mapper).unwrap();

    // Verify by querying database
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM players", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1);
}
```

**Problems:**
- Can't test parser logic without database
- Slow tests (DB setup overhead)
- Hard to verify exact parsed values (need SQL queries)
- Can't use standard property-based testing tools

### 2. Lack of Parallelism

**Current execution:**
```
Time →
├─ parse_players()         [████████] 15ms
├─ parse_characters()      [████████████████] 25ms
├─ parse_cities()          [██████████] 20ms
├─ parse_tiles()           [████████████████████] 30ms
├─ parse_families()        [████] 8ms
└─ parse_religions()       [████] 8ms
                           Total: 106ms
```

**Why we can't parallelize currently:**

```rust
// Can't do this - mutable borrow conflicts:
rayon::scope(|s| {
    s.spawn(|_| parse_players(&doc, &conn, &mut id_mapper));      // ❌ Borrows id_mapper
    s.spawn(|_| parse_characters(&doc, &conn, &mut id_mapper));   // ❌ Also borrows id_mapper
    s.spawn(|_| parse_cities(&doc, &conn, &mut id_mapper));       // ❌ Also borrows id_mapper
});

// Compiler error: cannot borrow `id_mapper` as mutable more than once at a time
```

Additionally:
- Single `&Connection` can't be safely shared across threads for writes
- `Appender` is not `Sync` (can't be used from multiple threads)
- IdMapper has mutable state that would require locking

### 3. Debugging Difficulty

When an import fails, we get errors like:

```
ParseError::DatabaseError(Foreign key constraint violation in cities table)
```

But we can't see:
- What data was successfully parsed before the error?
- What was the problematic city record that caused the violation?
- Can we inspect the parsed data structure?

### 4. No Data Inspection

Can't do useful things like:

```rust
// ❌ Can't do this with current architecture:
let game_data = parse_save_file("save.zip")?;

// Inspect before committing
println!("Found {} players", game_data.players.len());
println!("Players: {:?}", game_data.players);

// Cache to disk for quick re-import
bincode::serialize_into(file, &game_data)?;

// Compare two saves
let diff = compare_saves(&save1, &save2);
```

---

## Proposed Hybrid Architecture

### Overview

Separate parsing from persistence with an intermediate typed representation:

```
┌─────────────┐
│  ZIP File   │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│ validate_and_extract│
│     _xml()          │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│   parse_xml()       │
└──────┬──────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│  parse_save_to_structs()             │  ← NEW: Pure parsing
│  (no DB dependency)                  │
├──────────────────────────────────────┤
│  ├─ parse_players_struct()           │  ← Parallel
│  ├─ parse_characters_struct()        │  ← Parallel
│  ├─ parse_cities_struct()            │  ← Parallel
│  └─ ... (all entities)               │  ← Parallel
└──────┬───────────────────────────────┘
       │
       ▼
┌─────────────────────┐
│   GameData          │  ← Intermediate representation
│   (typed structs)   │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ insert_game_data()  │  ← NEW: Bulk insertion
│  (transactional)    │
├─────────────────────┤
│  Uses Appenders     │
│  for performance    │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│   DuckDB Database   │
└─────────────────────┘
```

### Core Types

**New intermediate representation:**

```rust
// src-tauri/src/parser/game_data.rs

use serde::{Serialize, Deserialize};

/// Complete parsed game save data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameData {
    pub metadata: MatchMetadata,
    pub players: Vec<PlayerData>,
    pub characters: Vec<CharacterData>,
    pub cities: Vec<CityData>,
    pub tiles: Vec<TileData>,
    pub families: Vec<FamilyData>,
    pub religions: Vec<ReligionData>,
    pub tribes: Vec<TribeData>,

    // Aggregate data
    pub player_units_produced: Vec<PlayerUnitProduction>,
    pub city_units_produced: Vec<CityUnitProduction>,

    // Gameplay data
    pub player_resources: Vec<PlayerResource>,
    pub technology_progress: Vec<TechnologyProgress>,
    pub laws: Vec<Law>,
    pub diplomacy: Vec<DiplomacyRelation>,

    // Time-series
    pub points_history: Vec<PointsHistory>,
    pub yield_history: Vec<YieldHistory>,
    pub military_history: Vec<MilitaryHistory>,

    // Extended data
    pub character_stats: Vec<CharacterStat>,
    pub character_traits: Vec<CharacterTrait>,
    pub character_relationships: Vec<CharacterRelationship>,
    pub city_production_queue: Vec<CityProductionItem>,
    pub event_stories: Vec<EventStory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerData {
    pub xml_id: i32,                    // Keep XML ID for ID mapper
    pub player_name: String,
    pub nation: Option<String>,
    pub dynasty: Option<String>,
    pub team_id: Option<String>,
    pub is_human: bool,
    pub online_id: Option<String>,
    pub email: Option<String>,
    pub difficulty: Option<String>,
    pub legitimacy: Option<i32>,
    // ... all fields from current schema
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterData {
    pub xml_id: i32,
    pub first_name: Option<String>,
    pub gender: Option<String>,
    pub player_xml_id: Option<i32>,     // Foreign key (still XML ID)
    pub tribe: Option<String>,
    pub birth_turn: i32,
    pub death_turn: Option<i32>,
    pub birth_father_xml_id: Option<i32>,  // Foreign key (XML ID)
    pub birth_mother_xml_id: Option<i32>,  // Foreign key (XML ID)
    // ... all fields
}

// Similar structs for all entity types...
```

**Serde support enables:**
- Serialization to disk for caching
- JSON export for debugging
- Comparison between saves
- Property-based testing

### Two-Phase Design

#### Phase 1: Parsing (Pure, No DB)

```rust
// src-tauri/src/parser/parsers/mod.rs

/// Parse complete save file to in-memory structures
pub fn parse_save_to_structs(doc: &XmlDocument) -> Result<GameData> {
    // Can run in parallel - no shared mutable state!
    let (players, characters, cities, tiles) = rayon::join4(
        || parse_players_struct(doc),
        || parse_characters_struct(doc),
        || parse_cities_struct(doc),
        || parse_tiles_struct(doc),
    );

    // More entities...
    let families = parse_families_struct(doc)?;
    let religions = parse_religions_struct(doc)?;

    Ok(GameData {
        players: players?,
        characters: characters?,
        cities: cities?,
        tiles: tiles?,
        families,
        religions,
        // ...
    })
}

/// Parse players to structs (no DB dependency)
pub fn parse_players_struct(doc: &XmlDocument) -> Result<Vec<PlayerData>> {
    let root = doc.root_element();
    let mut players = Vec::new();

    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let xml_id = player_node.req_attr("ID")?.parse()?;
        let player_name = player_node.req_attr("Name")?.to_string();
        let nation = player_node.opt_attr("Nation").map(String::from);
        // ... extract all fields

        players.push(PlayerData {
            xml_id,
            player_name,
            nation,
            // ...
        });
    }

    Ok(players)
}
```

#### Phase 2: Insertion (Transactional, Uses Appenders)

```rust
// src-tauri/src/parser/inserters/mod.rs

/// Insert parsed game data to database
pub fn insert_game_data(
    conn: &Connection,
    game_data: &GameData,
    match_id: i64,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let mut id_mapper = IdMapper::new(match_id, &tx, true)?;

    // Sequential insertion (respects FK constraints)
    // But parsing already happened in parallel!
    insert_players(&tx, &game_data.players, &mut id_mapper)?;
    insert_characters(&tx, &game_data.characters, &mut id_mapper)?;
    insert_cities(&tx, &game_data.cities, &mut id_mapper)?;
    insert_tiles(&tx, &game_data.tiles, &mut id_mapper)?;
    // ...

    id_mapper.save_mappings(&tx)?;
    tx.commit()?;

    Ok(())
}

/// Insert players using Appender (fast bulk insert)
fn insert_players(
    conn: &Connection,
    players: &[PlayerData],
    id_mapper: &mut IdMapper,
) -> Result<()> {
    let mut app = conn.appender("players")?;

    for player in players {
        let db_id = id_mapper.map_player(player.xml_id);

        app.append_row(params![
            db_id,
            id_mapper.match_id,
            player.xml_id,
            &player.player_name,
            player.player_name.to_lowercase(),
            &player.nation,
            // ... all fields
        ])?;
    }

    Ok(())
}
```

---

## Parallel Parsing Strategy

### Why Parallel Parsing is Possible

**Current (Can't Parallelize):**
```rust
// Shared mutable state prevents parallelization
fn parse_players(doc: &XmlDocument, conn: &Connection, id_mapper: &mut IdMapper)
//                                      ^^^^^^^^^^^^^  ^^^^^^^^^^^^^
//                                      Can't share    Mutable borrow
```

**Hybrid (Can Parallelize):**
```rust
// No shared state - pure function
fn parse_players_struct(doc: &XmlDocument) -> Result<Vec<PlayerData>>
//                      ^^^^^^^^^^^^^^^^^^^^
//                      Immutable borrow - safe to share across threads!
```

### Parallel Parsing with Rayon

```rust
use rayon::prelude::*;

pub fn parse_save_to_structs(doc: &XmlDocument) -> Result<GameData> {
    // Parse foundation entities in parallel
    let (players_res, characters_res, cities_res, tiles_res) = rayon::join4(
        || parse_players_struct(doc),
        || parse_characters_struct(doc),
        || parse_cities_struct(doc),
        || parse_tiles_struct(doc),
    );

    let players = players_res?;
    let characters = characters_res?;
    let cities = cities_res?;
    let tiles = tiles_res?;

    // Parse dependent entities (these can also be parallel among themselves)
    let (families_res, religions_res, tribes_res) = rayon::join3(
        || parse_families_struct(doc),
        || parse_religions_struct(doc),
        || parse_tribes_struct(doc),
    );

    // Parse nested data in parallel
    let (player_data_res, timeseries_res, events_res) = rayon::join3(
        || parse_all_player_data(doc, &players),
        || parse_all_timeseries(doc, &players),
        || parse_all_events(doc, &players, &characters, &cities),
    );

    Ok(GameData {
        players,
        characters,
        cities,
        tiles,
        families: families_res?,
        religions: religions_res?,
        tribes: tribes_res?,
        // ...
    })
}
```

### Rayon Work-Stealing

Rayon uses a work-stealing scheduler:

```
Thread Pool (4 cores):
┌──────────────┬──────────────┬──────────────┬──────────────┐
│   Thread 0   │   Thread 1   │   Thread 2   │   Thread 3   │
├──────────────┼──────────────┼──────────────┼──────────────┤
│ parse_       │ parse_       │ parse_       │ parse_       │
│ players()    │ characters() │ cities()     │ tiles()      │
│   [█████]    │   [████████] │   [██████]   │   [█████████]│
│              │              │              │              │
│ parse_       │ parse_       │              │              │
│ families()   │ religions()  │  (idle)      │  (idle)      │
│   [██]       │   [███]      │     ↓        │     ↓        │
│              │              │  steal work  │  steal work  │
└──────────────┴──────────────┴──────────────┴──────────────┘

Automatic load balancing - no manual tuning needed!
```

### Expected Parallelism Speedup

**Current sequential timing (estimated):**

| Entity Type | Time (ms) | % of Total |
|-------------|-----------|------------|
| Players | 5 | 5% |
| Characters | 25 | 24% |
| Cities | 12 | 11% |
| Tiles | 30 | 28% |
| Families | 4 | 4% |
| Religions | 4 | 4% |
| Tribes | 3 | 3% |
| Player data | 8 | 8% |
| Timeseries | 10 | 9% |
| Events | 5 | 5% |
| **Total** | **106** | **100%** |

**Parallel timing (4 cores, ideal):**

```
Batch 1 (parallel):
  - parse_players()      5ms  ┐
  - parse_characters()  25ms  ├─ All run in parallel
  - parse_cities()      12ms  │  Max time: 30ms
  - parse_tiles()       30ms  ┘

Batch 2 (parallel):
  - parse_families()     4ms  ┐
  - parse_religions()    4ms  ├─ All run in parallel
  - parse_tribes()       3ms  │  Max time: 10ms
  - parse_player_data()  8ms  │
  - parse_timeseries()  10ms  │
  - parse_events()       5ms  ┘

Total: 30 + 10 = 40ms (vs 106ms sequential)
Speedup: 2.65x
```

**Realistic timing (accounting for overhead):**

- Thread spawning: ~2ms
- Work stealing overhead: ~5ms
- Memory allocation (more simultaneous): ~3ms
- **Estimated total: 50ms** (vs 106ms)
- **Realistic speedup: 2.1x**

---

## Performance Impact

### Memory Usage

**Current approach:**
```
Peak memory during import:
- XML DOM:           60-70 MB
- Minimal structs:    5-10 MB  (temporary during parsing)
- DuckDB buffers:    20-30 MB  (transaction buffer)
Total:              ~85-110 MB
```

**Hybrid approach:**
```
Peak memory during import:
- XML DOM:           60-70 MB
- GameData structs:  40-60 MB  (NEW: intermediate representation)
- DuckDB buffers:    20-30 MB  (transaction buffer)
Total:             ~120-160 MB
```

**Memory increase: +35-50 MB (30-45% increase)**

For desktop app with typical 8GB+ RAM, this is acceptable.

### Speed Comparison

#### Current Sequential

```
ZIP extraction:       50-200 ms
XML parsing:          30-80 ms
Sequential parsing:  106 ms      ← Can optimize
Database insertion:   50-100 ms
─────────────────────────────
Total:               236-486 ms
Benchmark:           ~213 ms
```

#### Hybrid with Parallel

```
ZIP extraction:       50-200 ms
XML parsing:          30-80 ms
Parallel parsing:     50 ms       ← 2.1x faster (was 106ms)
Database insertion:   50-100 ms   ← Same (still uses Appender)
─────────────────────────────
Total:               180-430 ms
Estimated:           ~157 ms
```

**Expected speedup: ~26% faster (213ms → 157ms)**

### Trade-offs Summary

| Aspect | Current | Hybrid | Change |
|--------|---------|--------|--------|
| **Import speed** | 213ms | ~157ms | 26% faster ✅ |
| **Memory usage** | ~110MB | ~160MB | +45% ❌ |
| **Code complexity** | Medium | Higher | More types/files ❌ |
| **Testability** | Hard | Easy | Much better ✅ |
| **Debuggability** | Hard | Easy | Can inspect structs ✅ |
| **Flexibility** | Low | High | Can cache/serialize ✅ |
| **DB coupling** | Tight | Loose | Better architecture ✅ |

---

## Migration Plan

### Phase 1: Foundation (Week 1)

**Goal:** Set up types and infrastructure

1. **Create `game_data.rs` module**
   - Define all data structs (PlayerData, CharacterData, etc.)
   - Add serde derives
   - Add builder methods if needed

2. **Create `parsers/` module**
   - Mirror structure of `entities/`
   - Create pure parsing functions (no DB)
   - One file per entity type

3. **Create `inserters/` module**
   - Extract insertion logic from current entity parsers
   - Keep using Appenders for performance

**Deliverable:** Compile-able skeleton, no behavior change yet

### Phase 2: Migrate One Entity (Week 2)

**Goal:** Prove the pattern works

1. **Migrate players as proof-of-concept**
   ```rust
   // Old: entities/players.rs
   pub fn parse_players(doc, conn, id_mapper) -> Result<usize>

   // New: parsers/players.rs
   pub fn parse_players_struct(doc) -> Result<Vec<PlayerData>>

   // New: inserters/players.rs
   pub fn insert_players(conn, players, id_mapper) -> Result<()>
   ```

2. **Update `import.rs` to use new pattern**
   ```rust
   // Parse
   let players = parse_players_struct(&doc)?;

   // Insert
   insert_players(&tx, &players, &mut id_mapper)?;
   ```

3. **Add tests**
   ```rust
   #[test]
   fn test_parse_players_struct() {
       let xml = r#"<Root><Player ID="0" Name="Test"/></Root>"#;
       let doc = parse_xml(xml.to_string()).unwrap();
       let players = parse_players_struct(&doc).unwrap();

       assert_eq!(players.len(), 1);
       assert_eq!(players[0].player_name, "Test");
       // No DB needed! ✅
   }
   ```

**Deliverable:** Players entity migrated, tests passing

### Phase 3: Migrate Remaining Entities (Weeks 3-4)

**Goal:** Migrate all entities to hybrid pattern

1. **Batch migration** (priority order):
   - Foundation: Characters, Cities, Tiles (Week 3)
   - Affiliations: Families, Religions, Tribes (Week 3)
   - Aggregate: Unit production, Player resources (Week 4)
   - Extended: Character/City/Tile extended data (Week 4)
   - Events: Event stories, logs, memories (Week 4)

2. **Maintain backwards compatibility**
   - Keep old parsers until migration complete
   - Run both in parallel, compare results
   - Gate with feature flag if needed

**Deliverable:** All entities migrated, tests passing

### Phase 4: Add Parallelization (Week 5)

**Goal:** Enable parallel parsing

1. **Add rayon dependency**
   ```toml
   # Cargo.toml
   [dependencies]
   rayon = "1.10"
   ```

2. **Refactor `parse_save_to_structs()`**
   ```rust
   pub fn parse_save_to_structs(doc: &XmlDocument) -> Result<GameData> {
       // Parallel foundation entities
       let (players, characters, cities, tiles) = rayon::join4(
           || parse_players_struct(doc),
           || parse_characters_struct(doc),
           || parse_cities_struct(doc),
           || parse_tiles_struct(doc),
       );

       // ... more parallel batches
   }
   ```

3. **Benchmark and tune**
   - Measure speedup
   - Adjust batching strategy
   - Profile for bottlenecks

**Deliverable:** Parallel parsing working, benchmarks show speedup

### Phase 5: Cleanup & Optimization (Week 6)

**Goal:** Polish and optimize

1. **Remove old parsers**
   - Delete old `entities/` implementations
   - Remove DB dependencies from parser functions

2. **Add advanced features**
   - Caching: Serialize GameData to disk
   - Comparison: Diff two GameData structs
   - Export: JSON export for debugging

3. **Documentation**
   - Update architecture docs
   - Add examples
   - Document performance characteristics

**Deliverable:** Production-ready hybrid parser

---

## Implementation Details

### Directory Structure

```
src-tauri/src/parser/
├── mod.rs                    # Module exports, error types
├── save_file.rs              # ZIP validation (unchanged)
├── xml_loader.rs             # XML parsing (unchanged)
├── id_mapper.rs              # ID mapping (unchanged)
├── import.rs                 # Orchestration (UPDATED)
│
├── game_data.rs              # NEW: Intermediate types
│   ├── pub struct GameData
│   ├── pub struct PlayerData
│   ├── pub struct CharacterData
│   └── ... all entity structs
│
├── parsers/                  # NEW: Pure parsing (no DB)
│   ├── mod.rs
│   ├── players.rs
│   ├── characters.rs
│   ├── cities.rs
│   └── ... (20+ parsers)
│
├── inserters/                # NEW: DB insertion
│   ├── mod.rs
│   ├── players.rs
│   ├── characters.rs
│   ├── cities.rs
│   └── ... (20+ inserters)
│
└── entities/                 # OLD: Delete after migration
    └── ... (deprecated)
```

### Key Architectural Decisions

#### 1. Keep XML IDs in Structs

```rust
pub struct CharacterData {
    pub xml_id: i32,                   // Keep this
    pub birth_father_xml_id: Option<i32>,  // FK as XML ID
    // NOT: pub birth_father_db_id: Option<i64>
}
```

**Rationale:**
- IdMapper converts XML → DB IDs during insertion
- Keeps parsing pure (no ID mapping concerns)
- Easier to debug (XML IDs match save file)

#### 2. Use Vec, Not HashMap

```rust
pub struct GameData {
    pub players: Vec<PlayerData>,      // ✅ Use Vec
    // NOT: HashMap<i32, PlayerData>   // ❌ Avoid HashMap
}
```

**Rationale:**
- Simpler
- Better for serialization
- Order preserved
- Can build HashMap later if needed: `players.iter().map(|p| (p.xml_id, p)).collect()`

#### 3. Serde for All Structs

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerData {
    // ...
}
```

**Rationale:**
- Enables caching to disk
- JSON export for debugging
- Comparison tools
- Minimal overhead

#### 4. Two-Pass for Relationships

Even with hybrid approach, still need two-pass for circular references:

```rust
pub fn insert_game_data(conn: &Connection, game_data: &GameData, match_id: i64) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let mut id_mapper = IdMapper::new(match_id, &tx, true)?;

    // Pass 1: Insert entities without FKs
    insert_players(&tx, &game_data.players, &mut id_mapper)?;
    insert_characters_core(&tx, &game_data.characters, &mut id_mapper)?;  // NULL parents
    insert_cities(&tx, &game_data.cities, &mut id_mapper)?;

    // Pass 2: Update relationships
    update_character_parents(&tx, &game_data.characters, &id_mapper)?;
    update_character_birth_cities(&tx, &game_data.characters, &id_mapper)?;

    // Continue with dependent entities...
}
```

---

## Testing Strategy

### Unit Tests (Parser Logic)

**Before (Hard):**
```rust
#[test]
fn test_parse_players() {
    let conn = Connection::open_in_memory().unwrap();
    setup_schema(&conn).unwrap();  // ← Expensive setup
    let mut id_mapper = IdMapper::new(1, &conn, true).unwrap();

    let xml = r#"<Root><Player ID="0" Name="Test"/></Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();

    parse_players(&doc, &conn, &mut id_mapper).unwrap();

    // Verify via SQL query ← Indirect
    let name: String = conn.query_row(
        "SELECT player_name FROM players WHERE xml_id = 0",
        [],
        |r| r.get(0)
    ).unwrap();
    assert_eq!(name, "Test");
}
```

**After (Easy):**
```rust
#[test]
fn test_parse_players_struct() {
    let xml = r#"<Root><Player ID="0" Name="Test" Nation="NATION_ROME"/></Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();

    let players = parse_players_struct(&doc).unwrap();

    // Direct verification ← Easy!
    assert_eq!(players.len(), 1);
    assert_eq!(players[0].xml_id, 0);
    assert_eq!(players[0].player_name, "Test");
    assert_eq!(players[0].nation, Some("NATION_ROME".to_string()));
}
```

### Property-Based Testing

With proptest:

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn test_player_name_never_empty(player_name in "[A-Za-z]{1,20}") {
        let xml = format!(
            r#"<Root><Player ID="0" Name="{}"/></Root>"#,
            player_name
        );
        let doc = parse_xml(xml).unwrap();
        let players = parse_players_struct(&doc).unwrap();

        assert!(!players[0].player_name.is_empty());
    }

    #[test]
    fn test_player_id_sequential(num_players in 1..100usize) {
        let players_xml: String = (0..num_players)
            .map(|i| format!(r#"<Player ID="{}" Name="Player{}"/>"#, i, i))
            .collect::<Vec<_>>()
            .join("");

        let xml = format!(r#"<Root>{}</Root>"#, players_xml);
        let doc = parse_xml(xml).unwrap();
        let players = parse_players_struct(&doc).unwrap();

        assert_eq!(players.len(), num_players);
        for (i, player) in players.iter().enumerate() {
            assert_eq!(player.xml_id, i as i32);
        }
    }
}
```

### Integration Tests (Full Pipeline)

```rust
#[test]
fn test_full_import_pipeline() {
    let xml = include_str!("../../test_data/minimal_save.xml");
    let doc = parse_xml(xml.to_string()).unwrap();

    // Parse to structs
    let game_data = parse_save_to_structs(&doc).unwrap();

    // Verify parsed data
    assert_eq!(game_data.players.len(), 2);
    assert_eq!(game_data.characters.len(), 50);

    // Insert to DB
    let conn = Connection::open_in_memory().unwrap();
    setup_schema(&conn).unwrap();
    insert_game_data(&conn, &game_data, 1).unwrap();

    // Verify DB state
    let player_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM players", [], |r| r.get(0))
        .unwrap();
    assert_eq!(player_count, 2);
}
```

### Benchmark Tests

```rust
// benches/parser_benchmarks.rs
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn benchmark_parse_players(c: &mut Criterion) {
    let xml = generate_large_save_xml(100_players, 500_characters);
    let doc = parse_xml(xml).unwrap();

    c.bench_function("parse_players_struct", |b| {
        b.iter(|| {
            parse_players_struct(black_box(&doc))
        })
    });
}

fn benchmark_parallel_vs_sequential(c: &mut Criterion) {
    let xml = include_str!("../test_data/large_save.xml");
    let doc = parse_xml(xml.to_string()).unwrap();

    c.bench_function("sequential_parsing", |b| {
        b.iter(|| parse_save_to_structs_sequential(black_box(&doc)))
    });

    c.bench_function("parallel_parsing", |b| {
        b.iter(|| parse_save_to_structs(black_box(&doc)))
    });
}

criterion_group!(benches, benchmark_parse_players, benchmark_parallel_vs_sequential);
criterion_main!(benches);
```

---

## Code Examples

### Complete Example: Players Migration

#### Before (Current)

```rust
// src-tauri/src/parser/entities/players.rs
use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;
use duckdb::{params, Connection};

pub fn parse_players(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &mut IdMapper
) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;
    let mut app = conn.appender("players")?;

    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let xml_id = player_node.req_attr("ID")?.parse::<i32>()?;
        let db_id = id_mapper.map_player(xml_id);

        let player_name = player_node.req_attr("Name")?;
        let nation = player_node.opt_attr("Nation");

        app.append_row(params![
            db_id,
            id_mapper.match_id,
            xml_id,
            player_name,
            player_name.to_lowercase(),
            nation,
            // ... 20+ more fields
        ])?;

        count += 1;
    }

    Ok(count)
}
```

#### After (Hybrid)

**Parsing:**
```rust
// src-tauri/src/parser/parsers/players.rs
use crate::parser::game_data::PlayerData;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;

/// Parse players to structs (no DB dependency)
pub fn parse_players_struct(doc: &XmlDocument) -> Result<Vec<PlayerData>> {
    let root = doc.root_element();
    let mut players = Vec::new();

    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let xml_id = player_node.req_attr("ID")?.parse::<i32>()?;
        let player_name = player_node.req_attr("Name")?.to_string();
        let nation = player_node.opt_attr("Nation").map(String::from);
        let dynasty = player_node.opt_attr("Dynasty").map(String::from);
        let team_id = player_node.opt_attr("Team").map(String::from);

        let is_human = player_node
            .opt_attr("AIControlledToTurn")
            .and_then(|s| s.parse::<i32>().ok())
            .map(|turn| turn == 0)
            .unwrap_or(true);

        let online_id = player_node.opt_attr("OnlineID").map(String::from);
        let email = player_node.opt_attr("Email").map(String::from);
        let difficulty = player_node.opt_attr("Difficulty").map(String::from);

        let legitimacy = player_node
            .opt_child_text("Legitimacy")
            .and_then(|s| s.parse::<i32>().ok());

        // ... extract all fields

        players.push(PlayerData {
            xml_id,
            player_name,
            nation,
            dynasty,
            team_id,
            is_human,
            online_id,
            email,
            difficulty,
            legitimacy,
            // ... all fields
        });
    }

    Ok(players)
}
```

**Insertion:**
```rust
// src-tauri/src/parser/inserters/players.rs
use crate::parser::game_data::PlayerData;
use crate::parser::id_mapper::IdMapper;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert players to database using Appender
pub fn insert_players(
    conn: &Connection,
    players: &[PlayerData],
    id_mapper: &mut IdMapper,
) -> Result<()> {
    let mut app = conn.appender("players")?;

    for player in players {
        let db_id = id_mapper.map_player(player.xml_id);

        app.append_row(params![
            db_id,
            id_mapper.match_id,
            player.xml_id,
            &player.player_name,
            player.player_name.to_lowercase(),
            &player.nation,
            &player.dynasty,
            &player.team_id,
            player.is_human,
            &player.online_id,
            &player.email,
            &player.difficulty,
            // ... all fields
        ])?;
    }

    Ok(())
}
```

**Orchestration:**
```rust
// src-tauri/src/parser/import.rs
fn import_save_file_internal(
    file_path: &str,
    doc: &XmlDocument,
    tx: &Connection,
    game_id: &str,
) -> Result<ImportResult> {
    // ... existing setup code ...

    // NEW: Parse to structs (can be parallel!)
    log::info!("Parsing save file to structures...");
    let game_data = parse_save_to_structs(doc)?;

    log::info!("Inserting {} players, {} characters, {} cities to database",
        game_data.players.len(),
        game_data.characters.len(),
        game_data.cities.len()
    );

    // NEW: Insert to database
    insert_game_data(tx, &game_data, match_id)?;

    Ok(ImportResult { /* ... */ })
}
```

### Parallel Parsing Example

```rust
// src-tauri/src/parser/parsers/mod.rs
use rayon::prelude::*;
use crate::parser::game_data::GameData;
use crate::parser::xml_loader::XmlDocument;
use crate::parser::Result;

pub fn parse_save_to_structs(doc: &XmlDocument) -> Result<GameData> {
    log::info!("Parsing save file (parallel)...");

    // Foundation entities (parallel batch 1)
    let (players_res, characters_res, cities_res, tiles_res) = rayon::join4(
        || {
            log::debug!("Parsing players...");
            parse_players_struct(doc)
        },
        || {
            log::debug!("Parsing characters...");
            parse_characters_struct(doc)
        },
        || {
            log::debug!("Parsing cities...");
            parse_cities_struct(doc)
        },
        || {
            log::debug!("Parsing tiles...");
            parse_tiles_struct(doc)
        },
    );

    let players = players_res?;
    let characters = characters_res?;
    let cities = cities_res?;
    let tiles = tiles_res?;

    log::info!("Parsed foundation: {} players, {} characters, {} cities, {} tiles",
        players.len(), characters.len(), cities.len(), tiles.len());

    // Affiliation entities (parallel batch 2)
    let (families_res, religions_res, tribes_res) = rayon::join3(
        || parse_families_struct(doc),
        || parse_religions_struct(doc),
        || parse_tribes_struct(doc),
    );

    let families = families_res?;
    let religions = religions_res?;
    let tribes = tribes_res?;

    // Player-nested data (can reference players)
    let (resources_res, tech_res, laws_res) = rayon::join3(
        || parse_all_player_resources(doc, &players),
        || parse_all_technology_progress(doc, &players),
        || parse_all_laws(doc, &players),
    );

    Ok(GameData {
        players,
        characters,
        cities,
        tiles,
        families,
        religions,
        tribes,
        player_resources: resources_res?,
        technology_progress: tech_res?,
        laws: laws_res?,
        // ... more fields
    })
}
```

### Caching Example

```rust
// src-tauri/src/parser/cache.rs
use crate::parser::game_data::GameData;
use crate::parser::Result;
use std::path::Path;

/// Cache parsed game data to disk for fast re-import
pub fn cache_game_data(game_data: &GameData, cache_path: &Path) -> Result<()> {
    let file = std::fs::File::create(cache_path)?;
    bincode::serialize_into(file, game_data)
        .map_err(|e| ParseError::InvalidFormat(format!("Cache write error: {}", e)))?;
    Ok(())
}

/// Load cached game data from disk
pub fn load_cached_game_data(cache_path: &Path) -> Result<GameData> {
    let file = std::fs::File::open(cache_path)?;
    bincode::deserialize_from(file)
        .map_err(|e| ParseError::InvalidFormat(format!("Cache read error: {}", e)))
}

/// Import with caching support
pub fn import_save_file_with_cache(
    file_path: &str,
    conn: &Connection,
) -> Result<ImportResult> {
    let cache_path = compute_cache_path(file_path);

    let game_data = if cache_path.exists() {
        log::info!("Loading from cache: {:?}", cache_path);
        load_cached_game_data(&cache_path)?
    } else {
        log::info!("Parsing save file...");
        let xml_content = validate_and_extract_xml(file_path)?;
        let doc = parse_xml(xml_content)?;
        let game_data = parse_save_to_structs(&doc)?;

        // Cache for next time
        cache_game_data(&game_data, &cache_path)?;
        game_data
    };

    // Insert to database
    let tx = conn.unchecked_transaction()?;
    insert_game_data(&tx, &game_data, match_id)?;
    tx.commit()?;

    Ok(ImportResult { /* ... */ })
}
```

---

## Appendix: Benchmarking Plan

### Metrics to Track

1. **Parse time breakdown:**
   - ZIP extraction
   - XML parsing
   - Entity parsing (total)
   - Entity parsing (per entity type)
   - Database insertion (total)
   - Database insertion (per entity type)

2. **Memory usage:**
   - Peak heap allocation
   - GameData struct size
   - Per-entity struct size

3. **Parallel efficiency:**
   - Speedup factor (sequential time / parallel time)
   - CPU utilization
   - Thread contention metrics

### Benchmark Implementation

```rust
// benches/import_benchmarks.rs
use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use per_ankh::parser::*;

fn bench_parse_sequential(c: &mut Criterion) {
    let test_saves = vec![
        ("small", include_str!("../test_data/small_save.xml")),
        ("medium", include_str!("../test_data/medium_save.xml")),
        ("large", include_str!("../test_data/large_save.xml")),
    ];

    let mut group = c.benchmark_group("parse_sequential");

    for (name, xml) in test_saves {
        group.bench_with_input(BenchmarkId::from_parameter(name), &xml, |b, xml| {
            let doc = parse_xml(xml.to_string()).unwrap();
            b.iter(|| {
                parse_save_to_structs_sequential(black_box(&doc))
            });
        });
    }

    group.finish();
}

fn bench_parse_parallel(c: &mut Criterion) {
    let test_saves = vec![
        ("small", include_str!("../test_data/small_save.xml")),
        ("medium", include_str!("../test_data/medium_save.xml")),
        ("large", include_str!("../test_data/large_save.xml")),
    ];

    let mut group = c.benchmark_group("parse_parallel");

    for (name, xml) in test_saves {
        group.bench_with_input(BenchmarkId::from_parameter(name), &xml, |b, xml| {
            let doc = parse_xml(xml.to_string()).unwrap();
            b.iter(|| {
                parse_save_to_structs(black_box(&doc))
            });
        });
    }

    group.finish();
}

criterion_group!(benches, bench_parse_sequential, bench_parse_parallel);
criterion_main!(benches);
```

Run with:
```bash
cargo bench --bench import_benchmarks
```

---

## Summary

This document provides complete context for migrating Per-Ankh to a hybrid parser architecture with parallel parsing support. The migration will:

✅ **Improve testability** - Parse logic testable without database
✅ **Enable parallelization** - ~2x speedup with multi-core parsing
✅ **Reduce coupling** - Cleaner separation of parsing and persistence
✅ **Add flexibility** - Caching, serialization, comparison tools

**Trade-offs:**
- ⚠️ +45% memory usage (acceptable for desktop app)
- ⚠️ More code complexity (more types, files)
- ⚠️ 6-week migration effort

**Recommended approach:** Incremental migration over 6 weeks, maintaining backwards compatibility until complete.

---

**Next Steps:**
1. Review and approve this plan
2. Create feature branch: `feature/hybrid-parser-architecture`
3. Begin Phase 1: Foundation (game_data.rs module)
4. Migrate players entity as proof-of-concept
5. Measure and iterate
