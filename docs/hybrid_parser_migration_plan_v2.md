# Hybrid Parser Architecture - Migration Plan v2

**Status:** Ready for Implementation
**Date:** 2025-11-09
**Original Plan:** `hybrid_parser_architecture.md`
**Incorporates Feedback:** `hybrid_parser_architecture-feedback.md`, `hybrid_parser_architecture-feedback-2.md`

---

## Executive Summary

This document provides a complete migration plan to refactor Per-Ankh's parser from **direct-write** to **hybrid architecture** with parallel parsing support.

**Key Benefits:**
- ~2x parsing speedup via parallelization (conservative estimate)
- Vastly improved testability (parse without database)
- Enables caching, comparison, and export features
- Cleaner separation of concerns

**Timeline:** 7-8 weeks
**Risk Level:** Low (incremental migration with proof-of-concept)
**Memory Trade-off:** +60-100 MB RAM during import (acceptable for desktop)

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Target Architecture](#target-architecture)
3. [Migration Strategy](#migration-strategy)
4. [Phase-by-Phase Plan](#phase-by-phase-plan)
5. [Implementation Details](#implementation-details)
6. [Testing Strategy](#testing-strategy)
7. [Risk Mitigation](#risk-mitigation)
8. [Performance Benchmarking](#performance-benchmarking)
9. [Code Examples](#code-examples)

---

## Current State Analysis

### Architecture: Direct-Write Pattern

**Data flow:**
```
XML → Parse node → Extract data → Appender → DB
     ↑                                        ↑
     └──── Single pass ──────────────────────┘
```

**Example from `entities/players.rs:10`:**
```rust
pub fn parse_players(
    doc: &XmlDocument,
    conn: &Connection,          // ← DB dependency
    id_mapper: &mut IdMapper    // ← Mutable state
) -> Result<usize>
```

### Current Strengths (Preserve These)

1. **Multi-Pass Insertion Logic** (import.rs:362-408)
   - Pass 1: Core entities
   - Pass 2a: Character parents (before FK references)
   - Pass 2b: Tile-city ownership
   - Pass 2c: Tile ownership history
   - Pass 2d: Character birth cities
   - **Critical:** This complexity must be preserved in hybrid approach

2. **Comprehensive Timing Instrumentation**
   ```rust
   let t_players = Instant::now();
   let players_count = super::entities::parse_players(...)?;
   log::info!("⏱️ Players: {:?} ({} players)", t_players.elapsed(), players_count);
   ```
   - Per-entity timing already exists
   - Must be maintained in hybrid approach

3. **Deduplication Built-In**
   - `deduplicate_rows_last_wins()` utility in all parsers
   - Solves duplicate entity issues gracefully

4. **Progress Events for Batch Imports**
   - 8-phase progress tracking with ETA
   - Emits `import-progress` events to UI
   - Already excellent UX

### Current Limitations (Motivations for Migration)

1. **Tight Database Coupling**
   - Can't test parsing logic without full DB setup
   - Can't inspect parsed data before insertion
   - Can't cache or serialize intermediate results

2. **No Parallelization**
   ```rust
   // Can't do this - mutable borrow conflicts:
   rayon::scope(|s| {
       s.spawn(|_| parse_players(&doc, &conn, &mut id_mapper));  // ❌
       s.spawn(|_| parse_characters(&doc, &conn, &mut id_mapper)); // ❌
   });
   ```

3. **Testing Complexity**
   - Need database for simple parsing tests
   - Hard to verify exact parsed values
   - Can't use property-based testing easily

### Entity Inventory

**Current parser files:** 16 entities
- `players.rs`, `characters.rs`, `cities.rs`, `tiles.rs`
- `families.rs`, `religions.rs`, `tribes.rs`
- `character_data.rs`, `city_data.rs`, `tile_data.rs`
- `player_data.rs`, `unit_production.rs`
- `diplomacy.rs`, `timeseries.rs`, `events.rs`
- `mod.rs`

**Migration scope:** ~32 new files (16 parsers + 16 inserters)

---

## Target Architecture

### Overview

Separate parsing from persistence with an intermediate typed representation:

```
┌─────────────┐
│  ZIP File   │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│   parse_xml()       │
└──────┬──────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│  parse_save_to_structs()             │  ← NEW: Pure parsing
│  (no DB dependency)                  │     (Parallel with rayon)
└──────┬───────────────────────────────┘
       │
       ▼
┌─────────────────────┐
│   GameData          │  ← Intermediate representation
│   (typed structs)   │     (Serializable, cacheable)
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  validate_game_data │  ← NEW: Pre-insertion validation
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ insert_game_data()  │  ← Bulk insertion
│  (multi-pass)       │     (Preserves existing Pass 2a-2d logic)
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│   DuckDB Database   │
└─────────────────────┘
```

### Core Types

```rust
// src-tauri/src/parser/game_data.rs

use serde::{Serialize, Deserialize};

/// Complete parsed game save data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameData {
    // Foundation entities (parsed in parallel)
    pub players: Vec<PlayerData>,
    pub characters: Vec<CharacterData>,
    pub cities: Vec<CityData>,
    pub tiles: Vec<TileData>,

    // Affiliation entities
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

    // Extended data
    pub character_stats: Vec<CharacterStat>,
    pub character_traits: Vec<CharacterTrait>,
    pub city_production_queue: Vec<CityProductionItem>,
    pub event_stories: Vec<EventStory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerData {
    pub xml_id: i32,                    // Keep XML ID for ID mapper
    pub player_name: String,            // TODO: Consider Cow<'a, str> for memory
    pub nation: Option<String>,
    pub dynasty: Option<String>,
    pub team_id: Option<String>,
    pub is_human: bool,
    // ... all fields from current schema
}

// Similar structs for all 16 entity types...
```

### Directory Structure

```
src-tauri/src/parser/
├── mod.rs                    # Module exports, error types (existing)
├── save_file.rs              # ZIP validation (unchanged)
├── xml_loader.rs             # XML parsing (unchanged)
├── id_mapper.rs              # ID mapping (unchanged)
├── import.rs                 # Orchestration (UPDATED)
├── utils.rs                  # Utilities like deduplicate_rows_last_wins (unchanged)
│
├── game_data.rs              # NEW: Intermediate types
│
├── parsers/                  # NEW: Pure parsing (no DB)
│   ├── mod.rs
│   ├── players.rs
│   ├── characters.rs
│   ├── cities.rs
│   └── ... (16 total)
│
├── inserters/                # NEW: DB insertion
│   ├── mod.rs
│   ├── players.rs
│   ├── characters.rs
│   ├── cities.rs
│   └── ... (16 total)
│
├── validation.rs             # NEW: Pre-insertion validation
│
└── entities/                 # OLD: Delete after migration complete
    └── ... (deprecated)
```

---

## Migration Strategy

### Incremental Approach (Low Risk)

1. **No breaking changes** during migration
2. **Proof-of-concept** with one entity (players)
3. **Feature flag** for rollback capability
4. **Comparison testing** (old vs new parsers)
5. **Delete old code** only after full validation

### Parallel Parsing Strategy

```rust
use rayon::prelude::*;

pub fn parse_save_to_structs(doc: &XmlDocument) -> Result<GameData> {
    // Batch 1: Foundation entities (parallel)
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

    // Batch 2: Affiliation entities (parallel)
    let (families_res, religions_res, tribes_res) = rayon::join3(
        || parse_families_struct(doc),
        || parse_religions_struct(doc),
        || parse_tribes_struct(doc),
    );

    // Batch 3: Dependent data (can reference earlier batches)
    let player_data_res = parse_all_player_data(doc, &players);
    let timeseries_res = parse_all_timeseries(doc, &players);

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

**Expected speedup:** 2-2.5x on parsing phase (not total import time)

### Multi-Pass Insertion Preservation

**Critical:** Existing Pass 2a-2d logic must be maintained.

```rust
// src-tauri/src/parser/inserters/mod.rs

pub fn insert_game_data(
    conn: &Connection,
    game_data: &GameData,
    match_id: i64,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let mut id_mapper = IdMapper::new(match_id, &tx, true)?;

    // Pass 1: Core entities WITHOUT relationships
    insert_players(&tx, &game_data.players, &mut id_mapper)?;
    insert_characters_core(&tx, &game_data.characters, &mut id_mapper)?;
    insert_tiles_core(&tx, &game_data.tiles, &mut id_mapper)?;
    insert_cities(&tx, &game_data.cities, &mut id_mapper)?;

    // Pass 2a: Character parents (BEFORE any FK references to characters)
    update_character_parents(&tx, &game_data.characters, &id_mapper)?;

    // Pass 2b: Tile-city ownership
    update_tile_city_ownership(&tx, &game_data.tiles, &id_mapper)?;

    // Pass 2c: Tile ownership history
    insert_tile_ownership_history(&tx, &game_data.tiles, &id_mapper)?;

    // Pass 2d: Character birth cities
    update_character_birth_cities(&tx, &game_data.characters, &id_mapper)?;

    // Pass 3: Entities that reference characters/cities via FK
    insert_tribes(&tx, &game_data.tribes, &mut id_mapper)?;
    insert_families(&tx, &game_data.families, &mut id_mapper)?;
    insert_religions(&tx, &game_data.religions, &mut id_mapper)?;

    // Pass 4: Extended and nested data
    // ... (all remaining entities)

    id_mapper.save_mappings(&tx)?;
    tx.commit()?;

    Ok(())
}
```

---

## Phase-by-Phase Plan

### Phase 1: Foundation (Weeks 1-2)

**Goal:** Set up infrastructure without changing behavior

**Tasks:**

1. **Add dependencies** (Cargo.toml)
   ```toml
   [dependencies]
   rayon = "1.10"           # Parallel iteration
   # serde already present
   ```

2. **Create `game_data.rs`**
   - Define all 16 data structs (PlayerData, CharacterData, etc.)
   - Add `#[derive(Debug, Clone, Serialize, Deserialize)]`
   - Keep XML IDs (not DB IDs) in structs
   - Use `String` initially (optimize to `Cow<'a, str>` in Phase 5)

3. **Create `parsers/` module structure**
   ```
   parsers/
   ├── mod.rs          # Re-exports all parse_*_struct functions
   ├── players.rs      # pub fn parse_players_struct(doc: &XmlDocument) -> Result<Vec<PlayerData>>
   ├── characters.rs   # Similar pattern
   └── ... (16 files)
   ```

4. **Create `inserters/` module structure**
   ```
   inserters/
   ├── mod.rs          # Re-exports all insert_* functions
   ├── players.rs      # pub fn insert_players(conn: &Connection, players: &[PlayerData], id_mapper: &mut IdMapper) -> Result<()>
   ├── characters.rs   # Similar pattern
   └── ... (16 files)
   ```

5. **Create `validation.rs`**
   ```rust
   // src-tauri/src/parser/validation.rs

   pub fn validate_game_data(game_data: &GameData) -> Result<()> {
       validate_foreign_keys(game_data)?;
       validate_data_consistency(game_data)?;
       Ok(())
   }

   fn validate_foreign_keys(game_data: &GameData) -> Result<()> {
       // Build ID sets
       let player_ids: HashSet<i32> = game_data.players.iter().map(|p| p.xml_id).collect();
       let character_ids: HashSet<i32> = game_data.characters.iter().map(|c| c.xml_id).collect();
       let city_ids: HashSet<i32> = game_data.cities.iter().map(|c| c.xml_id).collect();

       // Validate character.player_xml_id references
       for character in &game_data.characters {
           if let Some(player_id) = character.player_xml_id {
               if !player_ids.contains(&player_id) {
                   return Err(ParseError::InvalidFormat(
                       format!("Character {} references non-existent player {}",
                           character.xml_id, player_id)
                   ));
               }
           }
       }

       // Validate character parent references
       for character in &game_data.characters {
           if let Some(father_id) = character.birth_father_xml_id {
               if !character_ids.contains(&father_id) {
                   return Err(ParseError::InvalidFormat(
                       format!("Character {} has invalid father reference {}",
                           character.xml_id, father_id)
                   ));
               }
           }
       }

       // Similar validations for all FK relationships...

       Ok(())
   }
   ```

6. **Add memory profiling utilities**
   ```rust
   // src-tauri/src/parser/utils.rs

   /// Get estimated memory size of GameData
   pub fn estimate_memory_usage(game_data: &GameData) -> usize {
       use std::mem::size_of_val;

       let mut total = 0;
       total += game_data.players.capacity() * size_of::<PlayerData>();
       total += game_data.characters.capacity() * size_of::<CharacterData>();
       // ... sum all Vec capacities

       // Add heap allocations (Strings)
       for player in &game_data.players {
           total += player.player_name.capacity();
           if let Some(ref nation) = player.nation {
               total += nation.capacity();
           }
           // ... all String fields
       }

       total
   }
   ```

**Deliverable:** Compiles, no behavior change (new code not called yet)

---

### Phase 2: Proof-of-Concept (Week 3)

**Goal:** Prove the pattern works with one entity (players)

**Tasks:**

1. **Implement `parsers/players.rs`**
   ```rust
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
           // ... extract all fields (copy from entities/players.rs)

           players.push(PlayerData {
               xml_id,
               player_name,
               nation,
               // ... all fields
           });
       }

       Ok(players)
   }
   ```

2. **Implement `inserters/players.rs`**
   ```rust
   use crate::parser::game_data::PlayerData;
   use crate::parser::id_mapper::IdMapper;
   use crate::parser::utils::deduplicate_rows_last_wins;
   use crate::parser::Result;
   use duckdb::{params, Connection};

   /// Insert players using Appender (preserves existing deduplication)
   pub fn insert_players(
       conn: &Connection,
       players: &[PlayerData],
       id_mapper: &mut IdMapper,
   ) -> Result<()> {
       // Collect rows (same logic as entities/players.rs)
       let mut rows = Vec::new();
       for player in players {
           let db_id = id_mapper.map_player(player.xml_id);
           rows.push((
               db_id,
               id_mapper.match_id,
               player.xml_id,
               player.player_name.clone(),
               player.player_name.to_lowercase(),
               player.nation.clone(),
               // ... all fields
           ));
       }

       // Deduplicate (preserve existing behavior)
       let unique_rows = deduplicate_rows_last_wins(
           rows,
           |(player_id, match_id, ..)| (*player_id, *match_id)
       );

       // Bulk insert
       let mut app = conn.appender("players")?;
       for (db_id, match_id, xml_id, name, name_norm, nation, /* ... */) in unique_rows {
           app.append_row(params![db_id, match_id, xml_id, name, name_norm, nation, /* ... */])?;
       }

       drop(app);
       Ok(())
   }
   ```

3. **Add unit tests**
   ```rust
   // src-tauri/src/parser/parsers/players.rs

   #[cfg(test)]
   mod tests {
       use super::*;
       use crate::parser::xml_loader::parse_xml;

       #[test]
       fn test_parse_players_struct_basic() {
           let xml = r#"<Root GameId="test-123">
               <Player ID="0" Name="Test Player" Nation="NATION_ROME"/>
           </Root>"#;

           let doc = parse_xml(xml.to_string()).unwrap();
           let players = parse_players_struct(&doc).unwrap();

           // No DB needed! Direct verification
           assert_eq!(players.len(), 1);
           assert_eq!(players[0].xml_id, 0);
           assert_eq!(players[0].player_name, "Test Player");
           assert_eq!(players[0].nation, Some("NATION_ROME".to_string()));
       }

       #[test]
       fn test_parse_players_struct_multiple() {
           let xml = r#"<Root GameId="test-123">
               <Player ID="0" Name="Player 1" Nation="NATION_ROME"/>
               <Player ID="1" Name="Player 2" Nation="NATION_EGYPT"/>
           </Root>"#;

           let doc = parse_xml(xml.to_string()).unwrap();
           let players = parse_players_struct(&doc).unwrap();

           assert_eq!(players.len(), 2);
           assert_eq!(players[1].player_name, "Player 2");
       }
   }
   ```

4. **Add comparison integration test**
   ```rust
   // src-tauri/src/parser/tests.rs

   #[test]
   fn test_hybrid_matches_direct_players() {
       use tempfile::TempDir;

       let xml = include_str!("../../test_data/minimal_save.xml");
       let doc = parse_xml(xml.to_string()).unwrap();

       // Parse with old approach
       let temp_dir_old = TempDir::new().unwrap();
       let conn_old = Connection::open_in_memory().unwrap();
       setup_schema(&conn_old).unwrap();
       let mut id_mapper_old = IdMapper::new(1, &conn_old, true).unwrap();
       entities::parse_players(&doc, &conn_old, &mut id_mapper_old).unwrap();

       // Parse with new approach
       let temp_dir_new = TempDir::new().unwrap();
       let conn_new = Connection::open_in_memory().unwrap();
       setup_schema(&conn_new).unwrap();
       let mut id_mapper_new = IdMapper::new(1, &conn_new, true).unwrap();
       let players_struct = parsers::parse_players_struct(&doc).unwrap();
       inserters::insert_players(&conn_new, &players_struct, &mut id_mapper_new).unwrap();

       // Compare DB state
       let old_players: Vec<(i64, String)> = conn_old.prepare("SELECT player_id, player_name FROM players ORDER BY player_id")
           .unwrap()
           .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
           .unwrap()
           .collect::<Result<Vec<_>, _>>()
           .unwrap();

       let new_players: Vec<(i64, String)> = conn_new.prepare("SELECT player_id, player_name FROM players ORDER BY player_id")
           .unwrap()
           .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
           .unwrap()
           .collect::<Result<Vec<_>, _>>()
           .unwrap();

       assert_eq!(old_players, new_players, "Players should match exactly between old and new parsers");
   }
   ```

5. **Memory profiling**
   ```rust
   #[test]
   fn test_memory_profile_players() {
       let xml = include_str!("../../test_data/large_save.xml");
       let doc = parse_xml(xml.to_string()).unwrap();

       let players = parsers::parse_players_struct(&doc).unwrap();
       let mem_usage = estimate_memory_usage_players(&players);

       println!("Players memory: {} bytes ({} MB)", mem_usage, mem_usage / 1_048_576);
       println!("Per-player average: {} bytes", mem_usage / players.len());

       // Assert reasonable bounds (adjust based on profiling results)
       assert!(mem_usage < 10_000_000, "Players should use less than 10MB");
   }
   ```

**Deliverable:** Players entity fully migrated, tests passing, memory profiled

---

### Phase 3: Migrate Remaining Entities (Weeks 4-6)

**Goal:** Migrate all 16 entities to hybrid pattern

**Batch 1 (Week 4): Foundation entities**
- Characters (complex due to Pass 2a parent relationships)
- Cities (references players, tiles)
- Tiles (references players)

**Batch 2 (Week 5): Affiliation and aggregate entities**
- Families, Religions, Tribes
- Unit production (player, city)

**Batch 3 (Week 6): Extended and nested data**
- Character data (stats, traits, relationships)
- City data (production, culture, yields)
- Tile data (visibility, history)
- Player data (resources, tech, laws, council, goals)
- Diplomacy, Timeseries, Events

**For each entity:**
1. Implement `parsers/{entity}.rs`
2. Implement `inserters/{entity}.rs`
3. Add unit tests (parse without DB)
4. Add comparison integration test (old vs new)
5. Profile memory usage

**Maintain backwards compatibility:**
- Keep old `entities/` parsers until all tests pass
- Run both in parallel during validation phase
- Use feature flag if needed

---

### Phase 4: Add Parallelization (Week 7)

**Goal:** Enable parallel parsing and measure speedup

**Tasks:**

1. **Implement `parsers/mod.rs` with parallel orchestration**
   ```rust
   use rayon::prelude::*;
   use crate::parser::game_data::GameData;
   use crate::parser::xml_loader::XmlDocument;
   use crate::parser::Result;
   use std::time::Instant;

   pub fn parse_save_to_structs(doc: &XmlDocument) -> Result<GameData> {
       let t_start = Instant::now();

       // Batch 1: Foundation entities (parallel)
       log::info!("Parsing foundation entities (parallel)...");
       let t_foundation = Instant::now();
       let (players_res, characters_res, cities_res, tiles_res) = rayon::join4(
           || {
               let t = Instant::now();
               let result = parse_players_struct(doc);
               log::debug!("  parse_players_struct: {:?}", t.elapsed());
               result
           },
           || {
               let t = Instant::now();
               let result = parse_characters_struct(doc);
               log::debug!("  parse_characters_struct: {:?}", t.elapsed());
               result
           },
           || {
               let t = Instant::now();
               let result = parse_cities_struct(doc);
               log::debug!("  parse_cities_struct: {:?}", t.elapsed());
               result
           },
           || {
               let t = Instant::now();
               let result = parse_tiles_struct(doc);
               log::debug!("  parse_tiles_struct: {:?}", t.elapsed());
               result
           },
       );

       let players = players_res?;
       let characters = characters_res?;
       let cities = cities_res?;
       let tiles = tiles_res?;
       log::info!("⏱️  Foundation parsing: {:?}", t_foundation.elapsed());

       // Batch 2: Affiliation entities (parallel)
       let (families_res, religions_res, tribes_res) = rayon::join3(
           || parse_families_struct(doc),
           || parse_religions_struct(doc),
           || parse_tribes_struct(doc),
       );

       // Batch 3: Extended data (can be parallelized further)
       // ...

       let total_time = t_start.elapsed();
       log::info!("⏱️  TOTAL PARSE TIME: {:?}", total_time);

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

2. **Update `import.rs` to use hybrid approach**
   ```rust
   // src-tauri/src/parser/import.rs

   fn import_save_file_internal(
       file_path: &str,
       doc: &XmlDocument,
       tx: &Connection,
       game_id: &str,
       // ... progress params
   ) -> Result<ImportResult> {
       // ... existing setup code (match_id, concurrency locks, etc.)

       // PHASE 1-2: Parse to structs (parallel!)
       log::info!("Parsing save file to structures...");
       let t_parse = Instant::now();
       let game_data = parsers::parse_save_to_structs(doc)?;
       let parse_time = t_parse.elapsed();
       log::info!("⏱️  Parse to structs: {:?}", parse_time);
       eprintln!("⏱️  Parse to structs: {:?}", parse_time);

       if let Some((app_h, idx, total, name, start)) = progress_params {
           emit_phase_progress(Some(app_h), idx, total, name, "Parsing entities", 2, start);
       }

       // PHASE 3: Validate
       log::info!("Validating parsed data...");
       let t_validate = Instant::now();
       validation::validate_game_data(&game_data)?;
       log::info!("⏱️  Validation: {:?}", t_validate.elapsed());

       // PHASE 4-7: Insert to database (preserves multi-pass logic)
       log::info!("Inserting to database...");
       let t_insert = Instant::now();
       inserters::insert_game_data(tx, &game_data, match_id)?;
       let insert_time = t_insert.elapsed();
       log::info!("⏱️  Insert to DB: {:?}", insert_time);
       eprintln!("⏱️  Insert to DB: {:?}", insert_time);

       // ... rest of import logic
   }
   ```

3. **Benchmark comparison**
   ```bash
   # Establish baseline with current parser
   cargo bench --bench import_benchmarks > baseline.txt

   # Run with hybrid parser
   cargo bench --bench import_benchmarks > hybrid.txt

   # Compare
   diff baseline.txt hybrid.txt
   ```

4. **Add benchmark suite**
   ```rust
   // benches/import_benchmarks.rs

   use criterion::{black_box, criterion_group, criterion_main, Criterion};

   fn bench_parse_sequential(c: &mut Criterion) {
       let xml = include_str!("../test_data/medium_save.xml");
       let doc = parse_xml(xml.to_string()).unwrap();

       c.bench_function("parse_sequential", |b| {
           b.iter(|| {
               // Parse with old sequential approach
               // (would need to keep old code for comparison)
           })
       });
   }

   fn bench_parse_parallel(c: &mut Criterion) {
       let xml = include_str!("../test_data/medium_save.xml");
       let doc = parse_xml(xml.to_string()).unwrap();

       c.bench_function("parse_parallel", |b| {
           b.iter(|| parsers::parse_save_to_structs(black_box(&doc)))
       });
   }

   criterion_group!(benches, bench_parse_sequential, bench_parse_parallel);
   criterion_main!(benches);
   ```

**Deliverable:** Parallel parsing working, benchmarks show 2x+ speedup on parsing phase

---

### Phase 5: Cleanup & Polish (Week 8)

**Goal:** Remove old code, optimize, document

**Tasks:**

1. **Delete old `entities/` directory**
   - Only after all tests pass
   - Only after comparison tests confirm identical behavior

2. **Memory optimization** (if profiling shows issues)
   - Replace `String` with `Cow<'a, str>` in hot paths
   - Add string interning for repeated values (nations, tribes)
   ```rust
   use std::borrow::Cow;

   pub struct PlayerData<'a> {
       pub xml_id: i32,
       pub player_name: Cow<'a, str>,  // Borrow from XML DOM when possible
       pub nation: Option<Cow<'a, str>>,
       // ...
   }
   ```

3. **Add caching support** (optional feature)
   ```rust
   // src-tauri/src/parser/cache.rs

   use serde::{Deserialize, Serialize};

   #[derive(Serialize, Deserialize)]
   struct CacheHeader {
       magic: [u8; 4],            // b"OWSV"
       version: u16,              // Cache format version
       game_version: String,      // Old World version
       schema_hash: u64,          // Hash of GameData struct layout
   }

   pub fn cache_game_data(game_data: &GameData, cache_path: &Path) -> Result<()> {
       let file = File::create(cache_path)?;
       let mut encoder = zstd::Encoder::new(file, 3)?;  // Compression level 3

       let header = CacheHeader {
           magic: *b"OWSV",
           version: 1,
           game_version: game_data.metadata.game_version.clone().unwrap_or_default(),
           schema_hash: calculate_schema_hash(),
       };

       bincode::serialize_into(&mut encoder, &header)?;
       bincode::serialize_into(&mut encoder, game_data)?;
       encoder.finish()?;

       Ok(())
   }

   pub fn load_cached_game_data(cache_path: &Path) -> Result<GameData> {
       let file = File::open(cache_path)?;
       let decoder = zstd::Decoder::new(file)?;

       let header: CacheHeader = bincode::deserialize_from(&decoder)?;
       if header.magic != *b"OWSV" {
           return Err(ParseError::InvalidFormat("Invalid cache file magic".to_string()));
       }
       if header.schema_hash != calculate_schema_hash() {
           return Err(ParseError::InvalidFormat("Cache schema mismatch".to_string()));
       }

       let game_data: GameData = bincode::deserialize_from(decoder)?;
       Ok(game_data)
   }
   ```

4. **Documentation**
   - Update architecture docs
   - Document multi-pass insertion order
   - Add examples of using GameData
   - Document performance characteristics

5. **Final validation**
   - Run full test suite
   - Import 20+ real saves and compare DB state
   - Verify no regressions in import time
   - Confirm memory usage is acceptable

**Deliverable:** Production-ready hybrid parser, old code removed

---

## Implementation Details

### Key Architectural Decisions

#### 1. Keep XML IDs in Structs

```rust
pub struct CharacterData {
    pub xml_id: i32,                      // Keep this
    pub birth_father_xml_id: Option<i32>, // FK as XML ID
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
- Simpler, more efficient for iteration
- Better for serialization
- Order preserved (useful for debugging)
- Can build HashMap later if needed

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
- Minimal overhead

#### 4. Preserve Existing Deduplication

```rust
// In inserters/players.rs
let unique_rows = deduplicate_rows_last_wins(
    rows,
    |(player_id, match_id, ..)| (*player_id, *match_id)
);
```

**Rationale:**
- Current approach works well
- Last-wins strategy is correct for updates
- Don't fix what isn't broken

#### 5. Preserve Existing Timing

```rust
// Wrap existing Instant tracking
let t_parse = Instant::now();
let players = parse_players_struct(doc)?;
log::info!("⏱️ Players: {:?}", t_parse.elapsed());
```

**Rationale:**
- Already comprehensive
- Critical for performance monitoring
- Users rely on this output

---

## Testing Strategy

### Important: Use `parse_xml()` Helper in Tests

**CRITICAL:** Always use `parse_xml()` from `xml_loader.rs` in tests, NOT `roxmltree::Document::parse()` directly.

```rust
// ❌ WRONG: Type mismatch error
use roxmltree::Document;
let doc = Document::parse(xml).unwrap();  // Returns Document<'_>
parse_players_struct(&doc).unwrap();      // Expects &XmlDocument (enum wrapper)

// ✅ CORRECT: Use parse_xml() helper
use crate::parser::xml_loader::parse_xml;
let doc = parse_xml(xml.to_string()).unwrap();  // Returns XmlDocument enum
parse_players_struct(&doc).unwrap();            // Works correctly
```

**Why:** `XmlDocument` is an enum wrapper (not a type alias) that holds both the string content and the parsed `Document`. This enables future optimizations like hybrid streaming for large files.

### Unit Tests (Parser Logic)

**Before (Hard):**
```rust
#[test]
fn test_parse_players() {
    let conn = Connection::open_in_memory().unwrap();  // ❌ DB overhead
    setup_schema(&conn).unwrap();
    // ...
}
```

**After (Easy):**
```rust
#[test]
fn test_parse_players_struct() {
    let xml = r#"<Root><Player ID="0" Name="Test"/></Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();

    let players = parse_players_struct(&doc).unwrap();  // ✅ No DB needed

    assert_eq!(players.len(), 1);
    assert_eq!(players[0].player_name, "Test");
}
```

### Property-Based Testing

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn test_player_name_never_empty(name in "[A-Za-z]{1,20}") {
        let xml = format!(r#"<Root><Player ID="0" Name="{}"/></Root>"#, name);
        let doc = parse_xml(xml).unwrap();
        let players = parse_players_struct(&doc).unwrap();

        assert!(!players[0].player_name.is_empty());
    }
}
```

### Integration Tests (Dual-Parser Comparison)

```rust
#[test]
fn test_hybrid_matches_direct_full_import() {
    for save_file in glob("test_data/*.zip").unwrap() {
        let save_path = save_file.unwrap();

        // Import with old parser
        let conn_old = Connection::open_in_memory().unwrap();
        setup_schema(&conn_old).unwrap();
        let result_old = import_save_file_direct(&save_path, &conn_old).unwrap();

        // Import with new parser
        let conn_new = Connection::open_in_memory().unwrap();
        setup_schema(&conn_new).unwrap();
        let result_new = import_save_file(&save_path, &conn_new, None, None, None, None, None).unwrap();

        // Compare all tables
        for table in ["players", "characters", "cities", "tiles", /* ... */] {
            let old_data = dump_table(&conn_old, table);
            let new_data = dump_table(&conn_new, table);
            assert_eq!(old_data, new_data, "Table {} mismatch for {}", table, save_path.display());
        }
    }
}
```

### Benchmark Tests

```bash
# Establish baseline
cargo bench --bench import_benchmarks -- --save-baseline before

# After hybrid migration
cargo bench --bench import_benchmarks -- --baseline before
```

---

## Risk Mitigation

### Critical Risks & Mitigations

#### 1. Memory Growth (+60-100 MB)

**Risk:** GameData structs consume too much RAM

**Mitigations:**
- ✅ Memory profiling in Phase 2 (before full migration)
- ✅ Use `Cow<'a, str>` for strings borrowed from XML DOM
- ✅ String interning for repeated values (nations, religions)
- ✅ Compress cache files with zstd
- ✅ Accept trade-off (desktop apps have plenty of RAM)

**Go/No-Go Decision Point:** Phase 2 memory profiling
- If <100 MB increase: Proceed
- If 100-150 MB: Proceed with optimization plan
- If >150 MB: Reassess or optimize before Phase 3

#### 2. Foreign Key Validation Failures

**Risk:** Invalid FKs pass parsing but fail at insertion

**Mitigations:**
- ✅ Validation layer catches issues before DB writes
- ✅ Rich error messages with context (entity type, XML ID, field)
- ✅ Preserve existing multi-pass insertion order
- ✅ Integration tests verify FK integrity

#### 3. Regression in Import Performance

**Risk:** Parallel parsing overhead negates benefits

**Mitigations:**
- ✅ Benchmark before/after in Phase 4
- ✅ Profile with large saves (400+ turns)
- ✅ Measure not just parsing but total import time
- ✅ Rollback capability via feature flag

**Expected:** Total import time improves 15-25% (parsing is ~50% of total, 2x speedup on that = ~25% overall)

#### 4. Parallel Error Handling

**Risk:** One parse failure doesn't stop other threads

**Reality:** This is acceptable
- rayon::join4 runs all 4 tasks even if one fails
- Error is returned after all complete
- Minimal waste (parsing is cheap compared to I/O)

**Alternative (if needed):**
```rust
// Use shared flag for early termination
let error_flag = AtomicBool::new(false);
rayon::scope(|s| {
    s.spawn(|_| {
        if error_flag.load(Ordering::Relaxed) { return; }
        // parse...
    });
});
```

#### 5. Cache Corruption/Staleness

**Risk:** Cached data is stale or corrupt

**Mitigations:**
- ✅ Version header with magic bytes
- ✅ Schema hash validation
- ✅ Checksum verification (optional)
- ✅ Fall back to XML parsing on cache error
- ✅ Document cache invalidation strategy

---

## Performance Benchmarking

### Expected Performance Profile

**Current sequential (from plan):**
```
ZIP extraction:       50-200 ms
XML parsing:          30-80 ms
Sequential parsing:   106 ms      ← Target for optimization
Database insertion:   50-100 ms
─────────────────────────────────
Total:                236-486 ms
Measured average:     ~213 ms
```

**Hybrid with parallel:**
```
ZIP extraction:       50-200 ms   (unchanged)
XML parsing:          30-80 ms    (unchanged)
Parallel parsing:     50 ms       ← 2.1x faster (was 106ms)
Validation:           5-10 ms     (new overhead)
Database insertion:   50-100 ms   (unchanged - still uses Appender)
─────────────────────────────────
Total:                185-440 ms
Expected average:     ~160 ms
```

**Expected speedup:** ~25% faster overall (213ms → 160ms)

### Profiling Plan

1. **Baseline measurement** (before migration)
   ```bash
   cargo build --release
   # Import 10 representative saves, measure times
   ```

2. **Per-phase measurement** (after each migration batch)
   ```bash
   # After Phase 2 (players only)
   # After Phase 3 Batch 1 (foundation entities)
   # After Phase 3 Batch 2 (affiliations)
   # After Phase 3 Batch 3 (extended data)
   # After Phase 4 (parallel enabled)
   ```

3. **Memory profiling**
   ```bash
   valgrind --tool=massif target/release/per-ankh
   # Or use instrument sampling on macOS
   ```

4. **CPU profiling**
   ```bash
   cargo flamegraph -- import-save test.zip
   ```

### Success Criteria

**Must achieve:**
- ✅ No regression in total import time (must be ≤ current)
- ✅ Memory increase < 150 MB
- ✅ All integration tests pass (old vs new identical)

**Should achieve:**
- ✅ 15-25% improvement in total import time
- ✅ 2x speedup on parsing phase
- ✅ Memory increase < 100 MB

**Stretch goals:**
- ⭐ 30%+ improvement in total import time
- ⭐ 3x speedup on parsing phase (with optimizations)
- ⭐ Caching reduces re-import to <50ms

---

## Code Examples

### Example 1: Complete Entity Migration (Players)

**Before: entities/players.rs**
```rust
pub fn parse_players(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &mut IdMapper
) -> Result<usize> {
    let mut app = conn.appender("players")?;
    // Parse and insert in one pass...
}
```

**After: parsers/players.rs**
```rust
pub fn parse_players_struct(doc: &XmlDocument) -> Result<Vec<PlayerData>> {
    let root = doc.root_element();
    let mut players = Vec::new();

    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let xml_id = player_node.req_attr("ID")?.parse()?;
        // Extract all fields...
        players.push(PlayerData { xml_id, /* ... */ });
    }

    Ok(players)
}
```

**After: inserters/players.rs**
```rust
pub fn insert_players(
    conn: &Connection,
    players: &[PlayerData],
    id_mapper: &mut IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();
    for player in players {
        let db_id = id_mapper.map_player(player.xml_id);
        rows.push((db_id, id_mapper.match_id, player.xml_id, /* ... */));
    }

    let unique_rows = deduplicate_rows_last_wins(rows, |(pid, mid, ..)| (*pid, *mid));

    let mut app = conn.appender("players")?;
    for row in unique_rows {
        app.append_row(params![/* ... */])?;
    }

    Ok(())
}
```

### Example 2: Multi-Pass Insertion with Validation

```rust
// src-tauri/src/parser/inserters/mod.rs

pub fn insert_game_data(
    conn: &Connection,
    game_data: &GameData,
    match_id: i64,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let mut id_mapper = IdMapper::new(match_id, &tx, true)?;

    // Pass 1: Core entities WITHOUT relationships
    log::info!("Pass 1: Inserting core entities...");
    insert_players(&tx, &game_data.players, &mut id_mapper)?;
    insert_characters_core(&tx, &game_data.characters, &mut id_mapper)?;
    insert_tiles_core(&tx, &game_data.tiles, &mut id_mapper)?;
    insert_cities(&tx, &game_data.cities, &mut id_mapper)?;

    // CRITICAL: Pass 2a MUST happen before any entities reference characters via FK
    log::info!("Pass 2a: Updating character parent relationships...");
    update_character_parents(&tx, &game_data.characters, &id_mapper)?;

    log::info!("Pass 2b: Updating tile-city ownership...");
    update_tile_city_ownership(&tx, &game_data.tiles, &id_mapper)?;

    log::info!("Pass 2c: Inserting tile ownership history...");
    insert_tile_ownership_history(&tx, &game_data.tiles, &id_mapper)?;

    log::info!("Pass 2d: Updating character birth cities...");
    update_character_birth_cities(&tx, &game_data.characters, &id_mapper)?;

    // Pass 3: Entities that reference characters/cities
    log::info!("Pass 3: Inserting affiliation entities...");
    insert_tribes(&tx, &game_data.tribes, &mut id_mapper)?;
    insert_families(&tx, &game_data.families, &mut id_mapper)?;
    insert_religions(&tx, &game_data.religions, &mut id_mapper)?;

    // Pass 4+: All remaining entities
    log::info!("Pass 4+: Inserting extended data...");
    // ... (rest of entities)

    id_mapper.save_mappings(&tx)?;
    tx.commit()?;

    Ok(())
}
```

### Example 3: Validation Layer

```rust
// src-tauri/src/parser/validation.rs

use crate::parser::game_data::GameData;
use crate::parser::{ParseError, Result};
use std::collections::HashSet;

pub fn validate_game_data(game_data: &GameData) -> Result<()> {
    log::info!("Validating parsed game data...");

    validate_entity_counts(game_data)?;
    validate_foreign_keys(game_data)?;
    validate_data_consistency(game_data)?;

    log::info!("Validation passed");
    Ok(())
}

fn validate_entity_counts(game_data: &GameData) -> Result<()> {
    if game_data.players.is_empty() {
        return Err(ParseError::InvalidFormat("No players found".to_string()));
    }

    log::debug!("Entity counts: {} players, {} characters, {} cities, {} tiles",
        game_data.players.len(),
        game_data.characters.len(),
        game_data.cities.len(),
        game_data.tiles.len()
    );

    Ok(())
}

fn validate_foreign_keys(game_data: &GameData) -> Result<()> {
    // Build ID sets for validation
    let player_ids: HashSet<i32> = game_data.players.iter().map(|p| p.xml_id).collect();
    let character_ids: HashSet<i32> = game_data.characters.iter().map(|c| c.xml_id).collect();
    let city_ids: HashSet<i32> = game_data.cities.iter().map(|c| c.xml_id).collect();
    let tile_ids: HashSet<i32> = game_data.tiles.iter().map(|t| t.xml_id).collect();

    // Validate character.player_xml_id
    for character in &game_data.characters {
        if let Some(player_id) = character.player_xml_id {
            if !player_ids.contains(&player_id) {
                return Err(ParseError::InvalidFormat(
                    format!("Character {} references non-existent player {}",
                        character.xml_id, player_id)
                ));
            }
        }
    }

    // Validate character parent references
    for character in &game_data.characters {
        if let Some(father_id) = character.birth_father_xml_id {
            if !character_ids.contains(&father_id) {
                return Err(ParseError::InvalidFormat(
                    format!("Character {} has invalid father reference {}",
                        character.xml_id, father_id)
                ));
            }
        }
        if let Some(mother_id) = character.birth_mother_xml_id {
            if !character_ids.contains(&mother_id) {
                return Err(ParseError::InvalidFormat(
                    format!("Character {} has invalid mother reference {}",
                        character.xml_id, mother_id)
                ));
            }
        }
    }

    // Validate city.player_id and city.tile_id
    for city in &game_data.cities {
        if let Some(player_id) = city.player_xml_id {
            if !player_ids.contains(&player_id) {
                return Err(ParseError::InvalidFormat(
                    format!("City {} references non-existent player {}",
                        city.xml_id, player_id)
                ));
            }
        }
        if let Some(tile_id) = city.tile_xml_id {
            if !tile_ids.contains(&tile_id) {
                return Err(ParseError::InvalidFormat(
                    format!("City {} references non-existent tile {}",
                        city.xml_id, tile_id)
                ));
            }
        }
    }

    // Add more FK validations for all entity types...

    Ok(())
}

fn validate_data_consistency(game_data: &GameData) -> Result<()> {
    // Example: Check that human player exists
    let has_human = game_data.players.iter().any(|p| p.is_human);
    if !has_human {
        log::warn!("No human player found in save file");
    }

    // Example: Check turn numbers are consistent
    for character in &game_data.characters {
        if let Some(death_turn) = character.death_turn {
            if death_turn < character.birth_turn {
                return Err(ParseError::InvalidFormat(
                    format!("Character {} died before birth (birth: {}, death: {})",
                        character.xml_id, character.birth_turn, death_turn)
                ));
            }
        }
    }

    Ok(())
}
```

---

## Appendix: Rollback Plan

If migration reveals unforeseen issues:

### Feature Flag Approach

```rust
// Cargo.toml
[features]
hybrid-parser = []

// src-tauri/src/parser/import.rs
fn import_save_file_internal(...) -> Result<ImportResult> {
    #[cfg(feature = "hybrid-parser")]
    {
        // Use hybrid approach
        let game_data = parsers::parse_save_to_structs(doc)?;
        validation::validate_game_data(&game_data)?;
        inserters::insert_game_data(tx, &game_data, match_id)?;
    }

    #[cfg(not(feature = "hybrid-parser"))]
    {
        // Use original direct-write approach
        super::entities::parse_players(doc, tx, &mut id_mapper)?;
        super::entities::parse_characters_core(doc, tx, &mut id_mapper)?;
        // ...
    }

    // ... rest of function
}
```

**Usage:**
```bash
# Build with hybrid parser (default)
cargo build --release

# Build with original parser (rollback)
cargo build --release --no-default-features
```

---

## Summary

This migration plan provides:

✅ **Complete context** for developer to execute
✅ **Incorporates all feedback** (memory, validation, testing, FK handling)
✅ **Realistic timeline** (7-8 weeks with proof-of-concept)
✅ **Preserves existing strengths** (multi-pass, timing, deduplication, progress)
✅ **Low-risk approach** (incremental, feature-flagged, comparison-tested)
✅ **Clear success criteria** (performance, memory, correctness)

**Expected Outcomes:**
- ~25% faster imports (conservative)
- Much easier testing and debugging
- Enables future features (caching, comparison, export)
- Cleaner architecture for long-term maintenance

**Risks:**
- +60-100 MB memory (acceptable for desktop)
- 7-8 weeks engineering time (well-scoped)
- Complexity in preserving multi-pass logic (manageable)

**Go/No-Go Decision:** After Phase 2 (players POC with memory profiling)

---

**Next Steps:**
1. Review and approve this plan
2. Create feature branch: `feature/hybrid-parser-migration`
3. Begin Phase 1: Foundation (game_data.rs, module structure)
4. Execute Phase 2: Proof-of-concept (players)
5. Evaluate at decision point (memory profiling)
6. Proceed with remaining phases or adjust based on findings
