// Import orchestration and match identification
//
// This module coordinates the full import process:
// 1. Extract ZIP and parse XML
// 2. Identify match (new vs update)
// 3. Acquire locks for concurrency control
// 4. Import match metadata
// 5. Save ID mappings

use super::id_mapper::IdMapper;
use super::save_file::{compute_file_hash, validate_and_extract_xml};
use super::xml_loader::{parse_xml, XmlDocument, XmlNodeExt};
use super::{ParseError, Result};
use duckdb::{params, Connection};
use lazy_static::lazy_static;
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
    locks
        .entry(game_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

/// Acquire database-level lock for multi-process safety
/// Must be called within a transaction
fn acquire_db_lock(conn: &Connection, game_id: &str) -> Result<()> {
    // Try to insert lock row; if already exists and stale, update it
    // The unique constraint on game_id ensures only one process can hold the lock
    let result = conn.execute(
        "INSERT INTO match_locks (game_id, locked_at, locked_by)
         VALUES (?, CAST(now() AS TIMESTAMP), ?)
         ON CONFLICT (game_id) DO UPDATE
         SET locked_at = CAST(now() AS TIMESTAMP),
             locked_by = excluded.locked_by
         WHERE locked_at < CAST(now() AS TIMESTAMP) - INTERVAL '10 MINUTES'",
        params![game_id, std::process::id()],
    );

    match result {
        Ok(rows) if rows > 0 => Ok(()),
        Ok(_) => Err(ParseError::ConcurrencyLock(format!(
            "Another process is importing game_id: {}",
            game_id
        ))),
        Err(e) => Err(ParseError::DatabaseError(e)),
    }
}

/// Release database lock
fn release_db_lock(conn: &Connection, game_id: &str) -> Result<()> {
    conn.execute("DELETE FROM match_locks WHERE game_id = ?", params![game_id])?;
    Ok(())
}

/// Import result
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ImportResult {
    pub success: bool,
    pub match_id: Option<i64>,
    pub game_id: String,
    pub is_new: bool,
    pub error: Option<String>,
}

/// Import save file
///
/// # Arguments
/// * `file_path` - Path to the ZIP save file
/// * `conn` - Database connection
///
/// # Returns
/// ImportResult with success status and match_id
pub fn import_save_file(file_path: &str, conn: &Connection) -> Result<ImportResult> {
    // Phase 1: Extract and parse XML
    log::info!("Importing save file: {}", file_path);
    let xml_content = validate_and_extract_xml(file_path)?;
    let doc = parse_xml(xml_content)?;

    // Phase 2: Extract GameId to determine lock
    let game_id = doc
        .root_element()
        .req_attr("GameId")?
        .to_string();

    log::info!("Detected GameId: {}", game_id);

    // Acquire in-process lock (prevents same-app concurrency)
    let process_lock_arc = acquire_process_lock(&game_id);
    let _process_lock = process_lock_arc.lock().unwrap();

    // Begin transaction and acquire DB-level lock (prevents cross-process concurrency)
    let tx = conn.unchecked_transaction()?;
    acquire_db_lock(&tx, &game_id)?;

    // Now safe to proceed - we have exclusive access for this GameId
    match import_save_file_internal(file_path, &doc, &tx, &game_id) {
        Ok(result) => {
            // Release DB lock and commit
            release_db_lock(&tx, &game_id)?;
            tx.commit()?;
            log::info!(
                "Successfully imported match {} (GameId: {})",
                result.match_id.unwrap(),
                game_id
            );
            Ok(result)
        }
        Err(e) => {
            // Rollback releases the lock automatically
            tx.rollback()?;
            log::error!("Import failed for GameId {}: {}", game_id, e);
            Ok(ImportResult {
                success: false,
                match_id: None,
                game_id: game_id.clone(),
                is_new: false,
                error: Some(e.to_string()),
            })
        }
    }
}

/// Internal import implementation (assumes locks are held)
fn import_save_file_internal(
    file_path: &str,
    doc: &XmlDocument,
    tx: &Connection,
    game_id: &str,
) -> Result<ImportResult> {
    // Compute file hash
    let file_hash = compute_file_hash(file_path)?;

    // Check if match exists
    let existing_match: Option<i64> = tx
        .query_row(
            "SELECT match_id FROM matches WHERE game_id = ?",
            params![game_id],
            |row| row.get(0),
        )
        .ok();

    let (match_id, is_new) = if let Some(id) = existing_match {
        log::info!("Updating existing match {} (GameId: {})", id, game_id);
        (id, false)
    } else {
        // Generate new match_id
        let new_id = tx
            .query_row("SELECT COALESCE(MAX(match_id), 0) + 1 FROM matches", [], |row| {
                row.get(0)
            })
            .unwrap_or(1);
        log::info!("Creating new match {} (GameId: {})", new_id, game_id);
        (new_id, true)
    };

    // Create or update IdMapper
    let mut id_mapper = IdMapper::new(match_id, tx, is_new)?;

    // Insert/update match record
    upsert_match_metadata(tx, match_id, game_id, file_path, &file_hash, doc)?;

    // If updating, delete derived data (core entities handled by UPSERT)
    if !is_new {
        delete_derived_match_data(tx, match_id)?;
    }

    // Parse foundation entities (Pass 1: Core data only)
    log::info!("Parsing foundation entities...");

    // Order matters due to foreign keys:
    // 1. Players (no dependencies)
    let players_count = super::entities::parse_players(doc, tx, &mut id_mapper)?;

    // 2. Tribes (no dependencies)
    let tribes_count = super::entities::parse_tribes(doc, tx, &mut id_mapper)?;

    // 3. Characters - Pass 1: Core data only (no relationships yet)
    let characters_count = super::entities::parse_characters_core(doc, tx, &mut id_mapper)?;

    // 4. Tiles (depends on players for ownership)
    let tiles_count = super::entities::parse_tiles(doc, tx, &mut id_mapper)?;

    // 5. Cities (depends on players, tiles)
    let cities_count = super::entities::parse_cities(doc, tx, &mut id_mapper)?;

    // NOTE: Families and Religions are not exported as separate top-level entities in the XML
    // They are referenced by name (e.g., FAMILY_BARCID, RELIGION_JUDAISM) but not defined
    // separately. They may need to be parsed from player/city context later.
    // let families_count = super::entities::parse_families(doc, tx, &mut id_mapper)?;
    // let religions_count = super::entities::parse_religions(doc, tx, &mut id_mapper)?;

    log::info!(
        "Parsed entities: {} players, {} tribes, {} characters, {} tiles, {} cities",
        players_count, tribes_count, characters_count, tiles_count, cities_count
    );

    // Parse aggregate unit production data (derived from entities)
    log::info!("Parsing aggregate unit production data...");
    let player_units_count = super::entities::parse_player_units_produced(doc, tx, &id_mapper)?;
    let city_units_count = super::entities::parse_city_units_produced(doc, tx, &id_mapper)?;
    log::info!(
        "Parsed unit production: {} player records, {} city records",
        player_units_count, city_units_count
    );

    // Parse player-nested gameplay data (Milestone 3)
    log::info!("Parsing player-nested gameplay data...");
    parse_player_gameplay_data(doc, tx, &id_mapper)?;

    // Parse game-level diplomacy
    log::info!("Parsing diplomacy...");
    let diplomacy_count = super::entities::parse_diplomacy(doc, tx, &id_mapper, match_id)?;
    log::info!("Parsed {} diplomacy relations", diplomacy_count);

    // Parse time-series data (Milestone 4)
    log::info!("Parsing time-series data...");
    parse_timeseries_data(doc, tx, &id_mapper)?;

    // Parse character extended data (Milestone 5)
    log::info!("Parsing character extended data (stats, traits, relationships)...");
    parse_character_extended_data_all(doc, tx, &id_mapper)?;

    // Parse city extended data (Milestone 5 + 6)
    log::info!("Parsing city extended data (production, culture, happiness)...");
    parse_city_extended_data_all(doc, tx, &id_mapper)?;

    // Parse tile extended data (Milestone 6)
    log::info!("Parsing tile extended data (visibility, history)...");
    parse_tile_extended_data_all(doc, tx, &id_mapper)?;

    // Parse event stories (Milestone 5)
    log::info!("Parsing event stories...");
    parse_event_stories(doc, tx, &id_mapper)?;

    // Save ID mappings
    id_mapper.save_mappings(tx)?;

    Ok(ImportResult {
        success: true,
        match_id: Some(match_id),
        game_id: game_id.to_string(),
        is_new,
        error: None,
    })
}

/// Parse player-nested gameplay data (Milestone 3)
///
/// This function iterates through all Player elements and parses:
/// - YieldStockpile → player_resources
/// - TechProgress → technology_progress
/// - TechCount → technologies_completed
/// - TechAvailable/Passed/etc → technology_states
/// - CouncilCharacter → player_council
/// - ActiveLaw → laws
/// - GoalList → player_goals
fn parse_player_gameplay_data(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    let root = doc.root_element();
    let mut totals = (0, 0, 0, 0, 0, 0, 0); // resources, tech_progress, tech_completed, tech_states, council, laws, goals

    // Iterate through all Player elements
    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let player_xml_id_str: &str = player_node.req_attr("ID")?;
        let player_xml_id: i32 = player_xml_id_str.parse()
            .map_err(|_| ParseError::InvalidFormat(format!("Player ID must be an integer: {}", player_xml_id_str)))?;
        let player_id = id_mapper.get_player(player_xml_id)?;
        let match_id = id_mapper.match_id;

        // Parse each type of player data
        totals.0 += super::entities::parse_player_resources(&player_node, tx, player_id, match_id)?;
        totals.1 += super::entities::parse_technology_progress(&player_node, tx, player_id, match_id)?;
        totals.2 += super::entities::parse_technologies_completed(&player_node, tx, player_id, match_id)?;
        totals.3 += super::entities::parse_technology_states(&player_node, tx, player_id, match_id)?;
        totals.4 += super::entities::parse_player_council(&player_node, tx, id_mapper, player_id, match_id)?;
        totals.5 += super::entities::parse_laws(&player_node, tx, player_id, match_id)?;
        totals.6 += super::entities::parse_player_goals(&player_node, tx, id_mapper, player_id, match_id)?;
    }

    log::info!(
        "Parsed player gameplay data: {} resources, {} tech_progress, {} tech_completed, {} tech_states, {} council, {} laws, {} goals",
        totals.0, totals.1, totals.2, totals.3, totals.4, totals.5, totals.6
    );

    Ok(())
}

/// Parse time-series data (Milestone 4)
///
/// This function parses both game-level and player-level time-series data:
/// - Game-level: YieldPriceHistory
/// - Player-level: MilitaryPowerHistory, PointsHistory, LegitimacyHistory,
///                 YieldRateHistory, FamilyOpinionHistory, ReligionOpinionHistory
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
    let mut player_totals = (0, 0, 0, 0, 0, 0); // military, points, legitimacy, yields, family_opinions, religion_opinions
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
        "Parsed time-series data: {} yield prices, {} players with {} military, {} points, {} legitimacy, {} yields, {} family opinions, {} religion opinions",
        yield_prices_count,
        player_count,
        player_totals.0,
        player_totals.1,
        player_totals.2,
        player_totals.3,
        player_totals.4,
        player_totals.5
    );

    Ok(())
}

/// Parse character extended data (Milestone 5)
///
/// This function parses character-specific nested data:
/// - Stats (Rating, Stat) -> character_stats table
/// - Traits (TraitTurn) -> character_traits table
/// - Relationships (RelationshipList) -> character_relationships table
fn parse_character_extended_data_all(
    doc: &XmlDocument,
    tx: &Connection,
    id_mapper: &IdMapper,
) -> Result<()> {
    let root = doc.root_element();
    let match_id = id_mapper.match_id;

    let mut totals = (0, 0, 0); // stats, traits, relationships
    let mut character_count = 0;

    for character_node in root.children().filter(|n| n.has_tag_name("Character")) {
        let character_xml_id_str: &str = character_node.req_attr("ID")?;
        let character_xml_id: i32 = character_xml_id_str.parse().map_err(|_| {
            ParseError::InvalidFormat(format!(
                "Character ID must be an integer: {}",
                character_xml_id_str
            ))
        })?;
        let character_id = id_mapper.get_character(character_xml_id)?;

        let (stats, traits, relationships) =
            super::entities::parse_character_extended_data(&character_node, tx, id_mapper, character_id, match_id)?;

        totals.0 += stats;
        totals.1 += traits;
        totals.2 += relationships;
        character_count += 1;
    }

    log::info!(
        "Parsed character extended data for {} characters: {} stats, {} traits, {} relationships",
        character_count,
        totals.0,
        totals.1,
        totals.2
    );

    Ok(())
}

/// Parse city extended data (Milestone 5 + 6)
///
/// This function parses city-specific nested data:
/// - Production queue (BuildQueue) -> city_production_queue table
/// - Completed builds (CompletedBuild) -> city_projects_completed table
/// - Culture and happiness (TeamCulture, TeamHappinessLevel) -> city_culture table
fn parse_city_extended_data_all(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    let root = doc.root_element();
    let match_id = id_mapper.match_id;

    let mut totals = (0, 0, 0); // queue items, completed builds, culture records
    let mut city_count = 0;

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id_str: &str = city_node.req_attr("ID")?;
        let city_xml_id: i32 = city_xml_id_str.parse().map_err(|_| {
            ParseError::InvalidFormat(format!("City ID must be an integer: {}", city_xml_id_str))
        })?;
        let city_id = id_mapper.get_city(city_xml_id)?;

        let (queue, completed, culture) =
            super::entities::parse_city_extended_data(&city_node, tx, city_id, match_id)?;

        totals.0 += queue;
        totals.1 += completed;
        totals.2 += culture;
        city_count += 1;
    }

    log::info!(
        "Parsed city extended data for {} cities: {} queue items, {} completed build types, {} culture records",
        city_count,
        totals.0,
        totals.1,
        totals.2
    );

    Ok(())
}

/// Parse tile extended data (Milestone 6)
///
/// This function parses tile-specific nested data:
/// - Tile visibility (RevealedTurn, RevealedOwner) -> tile_visibility table
/// - Tile history (OwnerHistory, TerrainHistory, VegetationHistory) -> tile_changes table
fn parse_tile_extended_data_all(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    let root = doc.root_element();
    let match_id = id_mapper.match_id;

    // Track next change_id across all tiles
    // Start from match_id * 1_000_000 to ensure uniqueness across matches
    let mut next_change_id = match_id * 1_000_000;

    let mut totals = (0, 0); // visibility records, history changes
    let mut tile_count = 0;

    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        let tile_xml_id_str: &str = tile_node.req_attr("ID")?;
        let tile_xml_id: i32 = tile_xml_id_str.parse().map_err(|_| {
            ParseError::InvalidFormat(format!("Tile ID must be an integer: {}", tile_xml_id_str))
        })?;
        let tile_id = id_mapper.get_tile(tile_xml_id)?;

        let (visibility, history) = super::entities::parse_tile_extended_data(
            &tile_node,
            tx,
            tile_id,
            match_id,
            &mut next_change_id,
        )?;

        totals.0 += visibility;
        totals.1 += history;
        tile_count += 1;
    }

    log::info!(
        "Parsed tile extended data for {} tiles: {} visibility records, {} history changes",
        tile_count,
        totals.0,
        totals.1
    );

    Ok(())
}

/// Parse event stories (Milestone 5)
///
/// This function parses event stories from all entity types:
/// - Player-level: AllEventStoryTurn, FamilyEventStoryTurn, etc.
/// - Character-level: EventStoryTurn
/// - City-level: EventStoryTurn
fn parse_event_stories(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    let root = doc.root_element();
    let match_id = id_mapper.match_id;

    // Track next event_id across all entity types
    // Start from match_id * 1_000_000 to ensure uniqueness across matches
    let mut next_event_id = match_id * 1_000_000;

    let mut total_events = 0;

    // Parse player-level events
    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let player_xml_id_str: &str = player_node.req_attr("ID")?;
        let player_xml_id: i32 = player_xml_id_str.parse().map_err(|_| {
            ParseError::InvalidFormat(format!("Player ID must be an integer: {}", player_xml_id_str))
        })?;
        let player_id = id_mapper.get_player(player_xml_id)?;

        total_events +=
            super::entities::parse_player_events(&player_node, tx, player_id, match_id, &mut next_event_id)?;
    }

    // Parse character-level events
    for character_node in root.children().filter(|n| n.has_tag_name("Character")) {
        let character_xml_id_str: &str = character_node.req_attr("ID")?;
        let character_xml_id: i32 = character_xml_id_str.parse().map_err(|_| {
            ParseError::InvalidFormat(format!(
                "Character ID must be an integer: {}",
                character_xml_id_str
            ))
        })?;
        let character_id = id_mapper.get_character(character_xml_id)?;

        // Need to find player_id for this character
        // Characters have a Player attribute
        let player_xml_id: i32 = character_node
            .opt_attr("Player")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let player_id = id_mapper.get_player(player_xml_id)?;

        total_events += super::entities::parse_character_events(
            &character_node,
            tx,
            character_id,
            player_id,
            match_id,
            &mut next_event_id,
        )?;
    }

    // Parse city-level events
    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id_str: &str = city_node.req_attr("ID")?;
        let city_xml_id: i32 = city_xml_id_str.parse().map_err(|_| {
            ParseError::InvalidFormat(format!("City ID must be an integer: {}", city_xml_id_str))
        })?;
        let city_id = id_mapper.get_city(city_xml_id)?;

        // Cities have a Player attribute
        let player_xml_id: i32 = city_node
            .opt_attr("Player")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let player_id = id_mapper.get_player(player_xml_id)?;

        total_events += super::entities::parse_city_events(
            &city_node,
            tx,
            city_id,
            player_id,
            match_id,
            &mut next_event_id,
        )?;
    }

    log::info!("Parsed {} event stories", total_events);

    Ok(())
}

/// Insert or update match metadata
fn upsert_match_metadata(
    tx: &Connection,
    match_id: i64,
    game_id: &str,
    file_path: &str,
    file_hash: &str,
    doc: &XmlDocument,
) -> Result<()> {
    let root = doc.root_element();

    // Extract file name from path
    let file_name = std::path::Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown.zip");

    // Extract basic metadata from XML (more fields can be added later)
    let game_name = root.opt_child_text("GameName");
    let total_turns: Option<i32> = root.opt_child_text("Turn").and_then(|t| t.parse().ok());

    tx.execute(
        "INSERT INTO matches (match_id, file_name, file_hash, game_id, game_name, total_turns)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (match_id) DO UPDATE SET
             file_name = excluded.file_name,
             file_hash = excluded.file_hash,
             game_name = excluded.game_name,
             total_turns = excluded.total_turns,
             processed_date = CAST(now() AS TIMESTAMP)",
        params![match_id, file_name, file_hash, game_id, game_name, total_turns],
    )?;

    Ok(())
}

/// Delete derived data for match update (preserves core entities for UPSERT)
fn delete_derived_match_data(tx: &Connection, match_id: i64) -> Result<()> {
    // Order matters: delete children before parents to respect FK constraints
    let delete_order = &[
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
        "player_units_produced",
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

    for table in delete_order {
        let result = tx.execute(
            &format!("DELETE FROM {} WHERE match_id = ?", table),
            params![match_id],
        );

        // Ignore errors for tables that might not exist yet (graceful degradation)
        if let Err(e) = result {
            log::warn!("Failed to delete from {}: {}", table, e);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_acquire_process_lock() {
        let lock1 = acquire_process_lock("test-game-1");
        let lock2 = acquire_process_lock("test-game-1");

        // Same game_id should return same lock (Arc points to same mutex)
        assert!(Arc::ptr_eq(&lock1, &lock2));
    }

    #[test]
    fn test_acquire_different_locks() {
        let lock1 = acquire_process_lock("test-game-1");
        let lock2 = acquire_process_lock("test-game-2");

        // Different game_ids should return different locks
        assert!(!Arc::ptr_eq(&lock1, &lock2));
    }
}
