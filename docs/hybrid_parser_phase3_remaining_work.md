# Phase 3 Remaining Work - Hybrid Parser Migration

**Status:** 85% Complete - Wiring Required
**Estimated Time:** 2-3 hours
**Date:** 2025-11-09

---

## Executive Summary

Phase 3 has successfully created **parsers and inserters** for all 16 entities (~6,400 lines of code). However, many are **not yet wired up** in `import.rs` - they still call the old `entities::` code instead of the new hybrid parsers.

**What's Done:**
- ✅ All 16 entities have `parsers/*.rs` and `inserters/*.rs` files
- ✅ Module exports configured correctly
- ✅ All tests passing (120 passed, 0 failed)
- ✅ Batch 2 entities fully wired (families, religions, tribes, unit_production)

**What's Missing:**
- ⚠️ Batch 1: Cities and tiles need parser/inserter implementation
- ⚠️ Batch 3: 7 entities have parsers/inserters but aren't wired in import.rs

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Task 1: Wire Up Batch 3 Entities](#task-1-wire-up-batch-3-entities)
3. [Task 2: Migrate Cities Entity](#task-2-migrate-cities-entity)
4. [Task 3: Migrate Tiles Entity](#task-3-migrate-tiles-entity)
5. [Testing Strategy](#testing-strategy)
6. [Troubleshooting](#troubleshooting)

---

## Current State Analysis

### Entities Status Table

| Entity | Parser | Inserter | Wired | Notes |
|--------|--------|----------|-------|-------|
| **Batch 1** |
| players | ✅ | ✅ | ✅ | Done in Phase 2 |
| characters | ✅ | ✅ | ✅ | Done in Batch 1 |
| cities | ❌ | ❌ | ❌ | **Need to create** |
| tiles | ❌ | ❌ | ❌ | **Need to create** |
| **Batch 2** |
| families | ✅ | ✅ | ✅ | Fully complete |
| religions | ✅ | ✅ | ✅ | Fully complete |
| tribes | ✅ | ✅ | ✅ | Fully complete |
| unit_production | ✅ | ✅ | ✅ | Fully complete |
| **Batch 3** |
| character_data | ✅ | ✅ | ❌ | **Need to wire** |
| city_data | ✅ | ✅ | ❌ | **Need to wire** |
| tile_data | ✅ | ✅ | ❌ | **Need to wire** |
| player_data | ✅ | ✅ | ❌ | **Need to wire** |
| diplomacy | ✅ | ✅ | ❌ | **Need to wire** |
| timeseries | ✅ | ✅ | ❌ | **Need to wire** |
| events | ✅ | ✅ | ❌ | **Need to wire** |

---

## Task 1: Wire Up Batch 3 Entities

**Goal:** Replace `super::entities::*` calls with hybrid parser/inserter calls in `import.rs`

### 1.1 Character Data

**Location:** `src-tauri/src/parser/import.rs:803`

**Current Code:**
```rust
fn parse_character_extended_data_all(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    let root = doc.root_element();
    let mut total_stats = 0;
    let mut total_traits = 0;
    let mut total_marriages = 0;
    let mut total_relationships = 0;

    for character_node in root.children().filter(|n| n.has_tag_name("Character")) {
        let character_xml_id_str: &str = character_node.req_attr("ID")?;
        let character_xml_id: i32 = character_xml_id_str.parse()
            .map_err(|_| ParseError::InvalidFormat(format!("Character ID must be an integer: {}", character_xml_id_str)))?;
        let character_id = id_mapper.get_character(character_xml_id)?;
        let match_id = id_mapper.match_id;

        let (stats, traits, marriages, relationships) =
            super::entities::parse_character_extended_data(&character_node, tx, id_mapper, character_id, match_id)?;

        total_stats += stats;
        total_traits += traits;
        total_marriages += marriages;
        total_relationships += relationships;
    }

    log::info!(
        "Parsed character extended data: {} stats, {} traits, {} marriages, {} relationships",
        total_stats, total_traits, total_marriages, total_relationships
    );

    Ok(())
}
```

**New Code (Hybrid Pattern):**
```rust
fn parse_character_extended_data_all(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    // Parse to structs (pure, no DB)
    let character_data = super::parsers::parse_all_character_data_struct(doc)?;

    // Insert to database
    let stats_count = super::inserters::insert_character_stats(tx, &character_data.stats, id_mapper)?;
    let traits_count = super::inserters::insert_character_traits(tx, &character_data.traits, id_mapper)?;
    let marriages_count = super::inserters::insert_character_marriages(tx, &character_data.marriages, id_mapper)?;
    let relationships_count = super::inserters::insert_character_relationships(tx, &character_data.relationships, id_mapper)?;

    log::info!(
        "Parsed character extended data: {} stats, {} traits, {} marriages, {} relationships",
        stats_count, traits_count, marriages_count, relationships_count
    );

    Ok(())
}
```

**What Changed:**
1. Single parse call at the top: `parse_all_character_data_struct(doc)`
2. Replace node-by-node iteration with bulk insert calls
3. Parse returns struct, not row counts
4. Insert functions return counts

---

### 1.2 City Data

**Location:** `src-tauri/src/parser/import.rs:847`

**Current Code:**
```rust
fn parse_city_extended_data_all(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    let root = doc.root_element();
    let mut total_yields = 0;
    let mut total_production = 0;
    let mut total_culture = 0;
    let mut total_religions = 0;
    let mut total_projects = 0;

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id_str: &str = city_node.req_attr("ID")?;
        let city_xml_id: i32 = city_xml_id_str.parse()
            .map_err(|_| ParseError::InvalidFormat(format!("City ID must be an integer: {}", city_xml_id_str)))?;
        let city_id = id_mapper.get_city(city_xml_id)?;
        let match_id = id_mapper.match_id;

        let (yields, production, culture, religions, projects) =
            super::entities::parse_city_extended_data(&city_node, tx, city_id, match_id)?;

        total_yields += yields;
        total_production += production;
        total_culture += culture;
        total_religions += religions;
        total_projects += projects;
    }

    log::info!(
        "Parsed city extended data: {} yields, {} production queue, {} culture, {} religions, {} projects",
        total_yields, total_production, total_culture, total_religions, total_projects
    );

    Ok(())
}
```

**New Code (Hybrid Pattern):**
```rust
fn parse_city_extended_data_all(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    // Parse to structs (pure, no DB)
    let city_yields = super::parsers::parse_city_yields_struct(doc)?;
    let city_production = super::parsers::parse_city_production_queue_struct(doc)?;
    let city_culture = super::parsers::parse_city_culture_struct(doc)?;
    let city_religions = super::parsers::parse_city_religions_struct(doc)?;
    let city_projects = super::parsers::parse_city_projects_completed_struct(doc)?;

    // Insert to database
    let yields_count = super::inserters::insert_city_yields(tx, &city_yields, id_mapper)?;
    let production_count = super::inserters::insert_city_production_queue(tx, &city_production, id_mapper)?;
    let culture_count = super::inserters::insert_city_culture(tx, &city_culture, id_mapper)?;
    let religions_count = super::inserters::insert_city_religions(tx, &city_religions, id_mapper)?;
    let projects_count = super::inserters::insert_city_projects_completed(tx, &city_projects, id_mapper)?;

    log::info!(
        "Parsed city extended data: {} yields, {} production queue, {} culture, {} religions, {} projects",
        yields_count, production_count, culture_count, religions_count, projects_count
    );

    Ok(())
}
```

---

### 1.3 Tile Data

**Location:** `src-tauri/src/parser/import.rs:893`

**Current Code:**
```rust
fn parse_tile_extended_data_all(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    let root = doc.root_element();
    let mut total_visibility = 0;
    let mut total_history = 0;

    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        let tile_xml_id_str: &str = tile_node.req_attr("ID")?;
        let tile_xml_id: i32 = tile_xml_id_str.parse()
            .map_err(|_| ParseError::InvalidFormat(format!("Tile ID must be an integer: {}", tile_xml_id_str)))?;
        let tile_id = id_mapper.get_tile(tile_xml_id)?;
        let match_id = id_mapper.match_id;

        let (visibility, history) = super::entities::parse_tile_extended_data(
            &tile_node, tx, tile_id, match_id
        )?;

        total_visibility += visibility;
        total_history += history;
    }

    log::info!(
        "Parsed tile extended data: {} visibility, {} history",
        total_visibility, total_history
    );

    Ok(())
}
```

**New Code (Hybrid Pattern):**
```rust
fn parse_tile_extended_data_all(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    // Parse to structs (pure, no DB)
    let tile_visibility = super::parsers::parse_tile_visibility_struct(doc)?;
    let tile_changes = super::parsers::parse_tile_changes_struct(doc)?;

    // Insert to database
    let visibility_count = super::inserters::insert_tile_visibility(tx, &tile_visibility, id_mapper)?;
    let changes_count = super::inserters::insert_tile_changes(tx, &tile_changes, id_mapper)?;

    log::info!(
        "Parsed tile extended data: {} visibility, {} changes",
        visibility_count, changes_count
    );

    Ok(())
}
```

---

### 1.4 Player Data

**Location:** `src-tauri/src/parser/import.rs:615-647`

**Current Code:**
```rust
fn parse_player_gameplay_data(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    let root = doc.root_element();
    let mut totals = (0, 0, 0, 0, 0, 0, 0, 0, 0);
    let mut next_log_id: i64 = 1;
    let mut next_memory_id: i64 = 1;

    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let player_xml_id_str: &str = player_node.req_attr("ID")?;
        let player_xml_id: i32 = player_xml_id_str.parse()
            .map_err(|_| ParseError::InvalidFormat(format!("Player ID must be an integer: {}", player_xml_id_str)))?;
        let player_id = id_mapper.get_player(player_xml_id)?;
        let match_id = id_mapper.match_id;

        totals.0 += super::entities::parse_player_resources(&player_node, tx, player_id, match_id)?;
        totals.1 += super::entities::parse_technology_progress(&player_node, tx, player_id, match_id)?;
        totals.2 += super::entities::parse_technologies_completed(&player_node, tx, player_id, match_id)?;
        totals.3 += super::entities::parse_technology_states(&player_node, tx, player_id, match_id)?;
        totals.4 += super::entities::parse_player_council(&player_node, tx, id_mapper, player_id, match_id)?;
        totals.5 += super::entities::parse_laws(&player_node, tx, player_id, match_id)?;
        totals.6 += super::entities::parse_player_goals(&player_node, tx, id_mapper, player_id, match_id)?;
        totals.7 += super::entities::parse_player_log_events(&player_node, tx, player_id, match_id, &mut next_log_id)?;
        totals.8 += super::entities::parse_player_memories(&player_node, tx, player_id, match_id, &mut next_memory_id)?;
    }

    log::info!(
        "Parsed player gameplay data: {} resources, {} tech_progress, {} tech_completed, {} tech_states, {} council, {} laws, {} goals, {} log_events, {} memories",
        totals.0, totals.1, totals.2, totals.3, totals.4, totals.5, totals.6, totals.7, totals.8
    );

    Ok(())
}
```

**New Code (Hybrid Pattern):**
```rust
fn parse_player_gameplay_data(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    // Parse to structs (pure, no DB)
    let player_data = super::parsers::parse_all_player_data(doc)?;

    // Insert to database
    let resources_count = super::inserters::insert_player_resources(tx, &player_data.resources, id_mapper)?;
    let tech_progress_count = super::inserters::insert_technology_progress(tx, &player_data.technology_progress, id_mapper)?;
    let tech_completed_count = super::inserters::insert_technologies_completed(tx, &player_data.technologies_completed, id_mapper)?;
    let tech_states_count = super::inserters::insert_technology_states(tx, &player_data.technology_states, id_mapper)?;
    let council_count = super::inserters::insert_player_council(tx, &player_data.council, id_mapper)?;
    let laws_count = super::inserters::insert_laws(tx, &player_data.laws, id_mapper)?;
    let goals_count = super::inserters::insert_player_goals(tx, &player_data.goals, id_mapper)?;

    log::info!(
        "Parsed player gameplay data: {} resources, {} tech_progress, {} tech_completed, {} tech_states, {} council, {} laws, {} goals",
        resources_count, tech_progress_count, tech_completed_count, tech_states_count, council_count, laws_count, goals_count
    );

    Ok(())
}
```

**Note:** Log events and memories are handled separately in `parse_event_stories()`.

---

### 1.5 Diplomacy

**Location:** `src-tauri/src/parser/import.rs:518-530`

**Current Code:**
```rust
// Parse game-level diplomacy
log::info!("Parsing diplomacy...");
let t_diplomacy = Instant::now();
let diplomacy_count = super::entities::parse_diplomacy(doc, tx, &id_mapper, match_id)?;
log::info!("Parsed {} diplomacy relations", diplomacy_count);
let diplomacy_time = t_diplomacy.elapsed();
log::info!("⏱️  Diplomacy: {:?}", diplomacy_time);
eprintln!("⏱️  Diplomacy: {:?}", diplomacy_time);

// PHASE 5: Diplomacy complete
if let Some((app_h, idx, total, name, start)) = progress_params {
    emit_phase_progress(Some(app_h), idx, total, name, "Parsing diplomacy", 5, start);
}
```

**New Code (Hybrid Pattern):**
```rust
// Parse game-level diplomacy - HYBRID PARSER
log::info!("Parsing diplomacy...");
let t_diplomacy = Instant::now();

// Parse to structs (pure, no DB)
let diplomacy_data = super::parsers::parse_diplomacy_relations(doc)?;

// Insert to database
let diplomacy_count = super::inserters::insert_diplomacy_relations(tx, &diplomacy_data, &id_mapper)?;

log::info!("Parsed {} diplomacy relations", diplomacy_count);
let diplomacy_time = t_diplomacy.elapsed();
log::info!("⏱️  Diplomacy: {:?}", diplomacy_time);
eprintln!("⏱️  Diplomacy: {:?}", diplomacy_time);

// PHASE 5: Diplomacy complete
if let Some((app_h, idx, total, name, start)) = progress_params {
    emit_phase_progress(Some(app_h), idx, total, name, "Parsing diplomacy", 5, start);
}
```

---

### 1.6 Timeseries

**Location:** `src-tauri/src/parser/import.rs:649-697`

**Current Code:**
```rust
fn parse_timeseries_data(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    let root = doc.root_element();
    let match_id = id_mapper.match_id;

    // Parse game-level yield prices
    let yield_prices_count = if let Some(game_node) = root.children().find(|n| n.has_tag_name("Game")) {
        super::entities::parse_game_yield_prices(&game_node, tx, match_id)?
    } else {
        log::warn!("No <Game> element found, skipping yield price history");
        0
    };

    // Parse player-level time-series data
    let mut player_totals = (0, 0, 0, 0, 0, 0);
    let mut player_count = 0;

    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let player_xml_id_str: &str = player_node.req_attr("ID")?;
        let player_xml_id: i32 = player_xml_id_str.parse()
            .map_err(|_| ParseError::InvalidFormat(format!("Player ID must be an integer: {}", player_xml_id_str)))?;
        let player_id = id_mapper.get_player(player_xml_id)?;

        let (military, points, legitimacy, yields, family_opinions, religion_opinions) =
            super::entities::parse_player_timeseries(&player_node, tx, player_id, match_id)?;

        player_totals.0 += military;
        player_totals.1 += points;
        player_totals.2 += legitimacy;
        player_totals.3 += yields;
        player_totals.4 += family_opinions;
        player_totals.5 += religion_opinions;
        player_count += 1;
    }

    log::info!(
        "Parsed time-series data: {} yield prices, {} players ({} military, {} points, {} legitimacy, {} yield rates, {} family opinions, {} religion opinions)",
        yield_prices_count, player_count,
        player_totals.0, player_totals.1, player_totals.2, player_totals.3, player_totals.4, player_totals.5
    );

    Ok(())
}
```

**New Code (Hybrid Pattern):**
```rust
fn parse_timeseries_data(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    // Parse to structs (pure, no DB)
    let yield_prices = super::parsers::parse_yield_price_history_struct(doc)?;
    let player_timeseries = super::parsers::parse_all_player_timeseries(doc)?;

    // Insert to database
    let yield_prices_count = super::inserters::insert_yield_price_history(tx, &yield_prices, id_mapper)?;
    let military_count = super::inserters::insert_military_power_history(tx, &player_timeseries.military_power, id_mapper)?;
    let points_count = super::inserters::insert_points_history(tx, &player_timeseries.points, id_mapper)?;
    let legitimacy_count = super::inserters::insert_legitimacy_history(tx, &player_timeseries.legitimacy, id_mapper)?;
    let yield_rates_count = super::inserters::insert_yield_rate_history(tx, &player_timeseries.yield_rates, id_mapper)?;
    let family_opinions_count = super::inserters::insert_family_opinion_history(tx, &player_timeseries.family_opinions, id_mapper)?;
    let religion_opinions_count = super::inserters::insert_religion_opinion_history(tx, &player_timeseries.religion_opinions, id_mapper)?;

    log::info!(
        "Parsed time-series data: {} yield prices, {} military, {} points, {} legitimacy, {} yield rates, {} family opinions, {} religion opinions",
        yield_prices_count, military_count, points_count, legitimacy_count, yield_rates_count, family_opinions_count, religion_opinions_count
    );

    Ok(())
}
```

---

### 1.7 Events

**Location:** `src-tauri/src/parser/import.rs:924-1006`

**Current Code:**
```rust
fn parse_event_stories(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    let root = doc.root_element();
    let match_id = id_mapper.match_id;
    let mut next_event_id: i64 = 1;

    // Parse player-level event stories
    let mut player_events = 0;
    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let player_xml_id_str: &str = player_node.req_attr("ID")?;
        let player_xml_id: i32 = player_xml_id_str.parse()
            .map_err(|_| ParseError::InvalidFormat(format!("Player ID must be an integer: {}", player_xml_id_str)))?;
        let player_id = id_mapper.get_player(player_xml_id)?;

        player_events += super::entities::parse_player_events(&player_node, tx, player_id, match_id, &mut next_event_id)?;
    }

    // Parse character-level event stories
    let mut character_events = 0;
    for character_node in root.children().filter(|n| n.has_tag_name("Character")) {
        let character_xml_id_str: &str = character_node.req_attr("ID")?;
        let character_xml_id: i32 = character_xml_id_str.parse()
            .map_err(|_| ParseError::InvalidFormat(format!("Character ID must be an integer: {}", character_xml_id_str)))?;
        let character_id = id_mapper.get_character(character_xml_id)?;

        character_events += super::entities::parse_character_events(
            &character_node, tx, character_id, match_id, &mut next_event_id
        )?;
    }

    // Parse city-level event stories
    let mut city_events = 0;
    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id_str: &str = city_node.req_attr("ID")?;
        let city_xml_id: i32 = city_xml_id_str.parse()
            .map_err(|_| ParseError::InvalidFormat(format!("City ID must be an integer: {}", city_xml_id_str)))?;
        let city_id = id_mapper.get_city(city_xml_id)?;

        city_events += super::entities::parse_city_events(
            &city_node, tx, city_id, match_id, &mut next_event_id
        )?;
    }

    let total_events = player_events + character_events + city_events;
    log::info!(
        "Parsed event stories: {} player events, {} character events, {} city events (total: {})",
        player_events, character_events, city_events, total_events
    );

    Ok(())
}
```

**New Code (Hybrid Pattern):**
```rust
fn parse_event_stories(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    // Parse to structs (pure, no DB)
    let events_data = super::parsers::parse_events_struct(doc)?;

    // Insert to database
    let event_stories_count = super::inserters::insert_event_stories(tx, &events_data.stories, id_mapper)?;
    let event_logs_count = super::inserters::insert_event_logs(tx, &events_data.logs, id_mapper)?;
    let memory_data_count = super::inserters::insert_memory_data(tx, &events_data.memories, id_mapper)?;

    log::info!(
        "Parsed event stories: {} stories, {} logs, {} memories",
        event_stories_count, event_logs_count, memory_data_count
    );

    Ok(())
}
```

---

## Task 2: Migrate Cities Entity

**Goal:** Create `parsers/cities.rs` and `inserters/cities.rs` following the hybrid pattern

### 2.1 Create `parsers/cities.rs`

**Reference:** Look at `src-tauri/src/parser/entities/cities.rs` for the current implementation.

**Pattern to follow:**
```rust
// src-tauri/src/parser/parsers/cities.rs

use crate::parser::game_data::CityData;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;

/// Parse cities to structs (no DB dependency)
pub fn parse_cities_struct(doc: &XmlDocument) -> Result<Vec<CityData>> {
    let root = doc.root_element();
    let mut cities = Vec::new();

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let xml_id = city_node.req_attr("ID")?.parse()?;
        let city_name = city_node.req_attr("Name")?.to_string();

        // Extract all fields from XML
        // ... (copy logic from entities/cities.rs)

        cities.push(CityData {
            xml_id,
            city_name,
            // ... all other fields
        });
    }

    Ok(cities)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_cities_struct() {
        let xml = r#"<Root GameId="test-123">
            <City ID="0" Name="Test City" FoundTurn="5" />
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let cities = parse_cities_struct(&doc).unwrap();

        assert_eq!(cities.len(), 1);
        assert_eq!(cities[0].xml_id, 0);
        assert_eq!(cities[0].city_name, "Test City");
        assert_eq!(cities[0].founded_turn, 5);
    }
}
```

### 2.2 Create `inserters/cities.rs`

**Pattern to follow:**
```rust
// src-tauri/src/parser/inserters/cities.rs

use crate::parser::game_data::CityData;
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert cities using Appender (preserves existing deduplication)
pub fn insert_cities(
    conn: &Connection,
    cities: &[CityData],
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    // Collect rows
    let mut rows = Vec::new();
    for city in cities {
        let db_id = id_mapper.map_city(city.xml_id);

        // Map foreign keys
        let player_id = city.player_xml_id
            .and_then(|xml_id| id_mapper.get_player(xml_id).ok());
        let tile_id = id_mapper.get_tile(city.tile_xml_id).ok();

        rows.push((
            db_id,
            id_mapper.match_id,
            city.xml_id,
            city.city_name.clone(),
            city.city_name.to_lowercase(),
            city.founded_turn,
            player_id,
            tile_id,
            city.family.clone(),
            city.first_owner_player_xml_id
                .and_then(|xml_id| id_mapper.get_player(xml_id).ok()),
            city.is_capital,
            city.citizens,
            city.growth_progress,
            city.governor_xml_id
                .and_then(|xml_id| id_mapper.get_character(xml_id).ok()),
            city.general_xml_id
                .and_then(|xml_id| id_mapper.get_character(xml_id).ok()),
            city.agent_xml_id
                .and_then(|xml_id| id_mapper.get_character(xml_id).ok()),
            city.hurry_civics_count,
            city.hurry_money_count,
            city.specialist_count,
        ));
    }

    // Deduplicate
    let unique_rows = deduplicate_rows_last_wins(
        rows,
        |(city_id, match_id, ..)| (*city_id, *match_id)
    );

    // Bulk insert
    let mut app = conn.appender("cities")?;
    for row in &unique_rows {
        app.append_row(params![
            row.0, row.1, row.2, row.3, row.4, row.5, row.6, row.7,
            row.8, row.9, row.10, row.11, row.12, row.13, row.14,
            row.15, row.16, row.17, row.18
        ])?;
    }

    drop(app);
    Ok(unique_rows.len())
}
```

### 2.3 Wire Up in `import.rs`

**Location:** `src-tauri/src/parser/import.rs:391-396`

**Change from:**
```rust
// 4. Cities (depends on players, tiles)
let t_cities = Instant::now();
let cities_count = super::entities::parse_cities(doc, tx, &mut id_mapper)?;
let cities_time = t_cities.elapsed();
log::info!("⏱️    Cities: {:?} ({} cities)", cities_time, cities_count);
eprintln!("⏱️    Cities: {:?} ({} cities)", cities_time, cities_count);
```

**Change to:**
```rust
// 4. Cities - HYBRID PARSER (depends on players, tiles)
let t_cities = Instant::now();

// Parse to structs (pure, no DB)
let cities_data = super::parsers::parse_cities_struct(doc)?;

// Insert to database
let cities_count = super::inserters::insert_cities(tx, &cities_data, &mut id_mapper)?;

let cities_time = t_cities.elapsed();
log::info!("⏱️    Cities: {:?} ({} cities)", cities_time, cities_count);
eprintln!("⏱️    Cities: {:?} ({} cities)", cities_time, cities_count);
```

---

## Task 3: Migrate Tiles Entity

**Goal:** Create `parsers/tiles.rs` and `inserters/tiles.rs` following the hybrid pattern

### 3.1 Create `parsers/tiles.rs`

Follow the same pattern as cities. Reference `src-tauri/src/parser/entities/tiles.rs`.

**Key considerations:**
- Tiles have a complex `TileData` struct with ownership history vectors
- The parser should extract ALL tile data in one pass
- Ownership history is nested: `<Tile><OwnerHistory><Player ID="..."/></OwnerHistory></Tile>`

### 3.2 Create `inserters/tiles.rs`

**Important:** Tiles have a **two-part insertion** pattern:

1. **Pass 1:** Insert core tile data (in `insert_tiles_core`)
2. **Pass 2b:** Update city ownership after cities are created
3. **Pass 2c:** Insert ownership history after Pass 2b

**Example structure:**
```rust
/// Insert core tile data (Pass 1)
pub fn insert_tiles_core(
    conn: &Connection,
    tiles: &[TileData],
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    // Insert WITHOUT city_id and ownership_history
    // Those are set in Pass 2b and 2c
}

/// Update tile city ownership (Pass 2b - called after cities inserted)
pub fn update_tile_city_ownership(
    conn: &Connection,
    tiles: &[TileData],
    id_mapper: &IdMapper,
) -> Result<usize> {
    // UPDATE tiles SET city_id = ? WHERE tile_id = ?
}

/// Insert tile ownership history (Pass 2c)
pub fn insert_tile_ownership_history(
    conn: &Connection,
    tiles: &[TileData],
    id_mapper: &IdMapper,
) -> Result<usize> {
    // INSERT INTO tile_ownership_history
}
```

### 3.3 Wire Up in `import.rs`

**Change multiple locations:**

**Location 1:** `src-tauri/src/parser/import.rs:384-389` (Tiles core)
```rust
// 3. Tiles - HYBRID PARSER (depends on players for ownership)
let t_tiles = Instant::now();

// Parse to structs (pure, no DB)
let tiles_data = super::parsers::parse_tiles_struct(doc)?;

// Insert to database (Pass 1: Core data only, no city ownership yet)
let tiles_count = super::inserters::insert_tiles_core(tx, &tiles_data, &mut id_mapper)?;

let tiles_time = t_tiles.elapsed();
log::info!("⏱️    Tiles: {:?} ({} tiles)", tiles_time, tiles_count);
eprintln!("⏱️    Tiles: {:?} ({} tiles)", tiles_time, tiles_count);
```

**Location 2:** `src-tauri/src/parser/import.rs:398-412` (Pass 2b and 2c)
```rust
// Pass 2b - Update tile city ownership after cities are created
log::info!("Updating tile city ownership (Pass 2b)...");
let t_tile_city = Instant::now();
super::inserters::update_tile_city_ownership(tx, &tiles_data, &id_mapper)?;
let tile_city_time = t_tile_city.elapsed();
log::info!("⏱️    Tile city ownership: {:?}", tile_city_time);
eprintln!("⏱️    Tile city ownership: {:?}", tile_city_time);

// Pass 2c - Parse tile ownership history after city ownership is set
log::info!("Parsing tile ownership history (Pass 2c)...");
let t_tile_history = Instant::now();
super::inserters::insert_tile_ownership_history(tx, &tiles_data, &id_mapper)?;
let tile_history_time = t_tile_history.elapsed();
log::info!("⏱️    Tile ownership history: {:?}", tile_history_time);
eprintln!("⏱️    Tile ownership history: {:?}", tile_history_time);
```

**Important:** You'll need to store `tiles_data` at a higher scope so it's available for Pass 2b and 2c.

---

## Testing Strategy

### After Each Entity Migration

1. **Compile check:**
   ```bash
   cd src-tauri
   cargo check
   ```

2. **Run tests:**
   ```bash
   cargo test --lib
   ```

   All 120+ tests should still pass.

3. **Test import with real save file:**
   ```bash
   cargo test test_import_real_save_file -- --nocapture
   ```

   Check logs for timing and counts. Verify no errors.

4. **Manual smoke test:**
   ```bash
   cd ..
   npm run tauri dev
   ```

   Import a save file and verify data shows up correctly in the UI.

### Final Validation

After all entities wired up:

1. **Compare import results:**
   - Import the same save file before and after changes
   - Use a SQL tool to compare table row counts:
     ```sql
     SELECT 'players', COUNT(*) FROM players
     UNION ALL
     SELECT 'characters', COUNT(*) FROM characters
     UNION ALL
     SELECT 'cities', COUNT(*) FROM cities
     -- ... etc for all tables
     ```
   - All counts should match exactly

2. **Performance check:**
   - Note import times before migration
   - Compare with after migration
   - Should be similar or slightly faster (parallelization comes in Phase 4)

---

## Troubleshooting

### Issue: Type Mismatch Errors

**Problem:**
```
error[E0308]: mismatched types
  expected `Option<i64>`, found `Option<i32>`
```

**Solution:**
Check that XML IDs vs DB IDs are being used correctly:
- Parsers use `i32` (XML IDs)
- Inserters convert to `i64` (DB IDs) via `id_mapper`

### Issue: Missing Foreign Key

**Problem:**
```
ParseError: Failed to find character mapping for XML ID 42
```

**Solution:**
Check insertion order. The entity being referenced must be inserted first:
- Players before characters
- Characters before families/religions/tribes
- Cities before city_data

### Issue: Duplicate Key Violation

**Problem:**
```
Constraint Error: Duplicate key "PRIMARY" in table "cities"
```

**Solution:**
Ensure `deduplicate_rows_last_wins()` is being called before insertion.

### Issue: Tests Failing

**Problem:**
```
test parser::tests::tests::test_import_real_save_file ... FAILED
```

**Solution:**
1. Run with `--nocapture` to see logs:
   ```bash
   cargo test test_import_real_save_file -- --nocapture
   ```
2. Check which entity is failing
3. Compare parsed struct fields with database schema
4. Verify foreign key mappings are correct

---

## Completion Checklist

### Batch 3 Wiring (Estimated: 1 hour)

- [ ] Character data wired in `import.rs:803`
- [ ] City data wired in `import.rs:847`
- [ ] Tile data wired in `import.rs:893`
- [ ] Player data wired in `import.rs:615`
- [ ] Diplomacy wired in `import.rs:521`
- [ ] Timeseries wired in `import.rs:655`
- [ ] Events wired in `import.rs:924`
- [ ] All tests passing
- [ ] Import test validates successfully

### Batch 1 Completion (Estimated: 1-2 hours)

- [ ] Create `parsers/cities.rs` with unit test
- [ ] Create `inserters/cities.rs`
- [ ] Wire cities in `import.rs:391`
- [ ] Create `parsers/tiles.rs` with unit test
- [ ] Create `inserters/tiles.rs` (3 functions: core, city_ownership, ownership_history)
- [ ] Wire tiles in `import.rs:384` (Pass 1)
- [ ] Wire tiles Pass 2b/2c in `import.rs:398-412`
- [ ] All tests passing
- [ ] Import test validates successfully
- [ ] Manual smoke test in UI

### Final Cleanup

- [ ] Remove unused imports warnings in `entities/` files
- [ ] Verify all `super::entities::` calls are replaced with hybrid parsers
- [ ] Update module documentation in `parsers/mod.rs` and `inserters/mod.rs`
- [ ] Commit work with message: `feat: complete Phase 3 hybrid parser migration`

---

## Next Steps (Phase 4)

Once Phase 3 is complete:

1. **Add parallelization** - Use `rayon::join4()` to parse foundation entities in parallel
2. **Benchmark performance** - Measure parsing speedup
3. **Cleanup old code** - Delete `entities/` directory
4. **Update documentation** - Reflect new architecture

See `docs/hybrid_parser_migration_plan_v2.md` Phase 4 for details.

---

## Questions?

If you encounter issues:
1. Check the migration plan: `docs/hybrid_parser_migration_plan_v2.md`
2. Review existing hybrid parsers: `parsers/players.rs`, `parsers/characters.rs`, etc.
3. Review existing hybrid inserters: `inserters/players.rs`, `inserters/characters.rs`, etc.
4. Compare with old code in `entities/` to understand the pattern

Good luck! The hardest part is done - you're just wiring up existing code.
