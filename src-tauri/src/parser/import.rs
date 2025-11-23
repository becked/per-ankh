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
use std::time::Instant;
use tauri::Emitter;

/// Total number of phases for intra-file progress tracking
const TOTAL_PHASES: usize = 8;

/// Emit phase progress event
///
/// Emits progress events during file import to show which phase is currently executing
/// and how far through the file we are. Only emits if app handle is provided.
fn emit_phase_progress(
    app: Option<&tauri::AppHandle>,
    file_index: usize,
    total_files: usize,
    file_name: &str,
    phase_name: &str,
    phase_number: usize,
    batch_start_time: Instant,
) {
    // Only emit if we have an app handle (batch imports only)
    let app = match app {
        Some(a) => a,
        None => return,
    };

    let file_progress = (phase_number as f64) / (TOTAL_PHASES as f64);

    let elapsed = batch_start_time.elapsed();
    let elapsed_ms = elapsed.as_millis() as u64;

    // Calculate speed based on files completed + current file progress
    let files_progress = (file_index - 1) as f64 + file_progress;
    let speed = if elapsed_ms > 0 {
        files_progress / (elapsed_ms as f64 / 1000.0)
    } else {
        0.0
    };

    // Estimate remaining time
    let remaining_files = (total_files - file_index) as f64 + (1.0 - file_progress);
    let estimated_remaining_ms = if speed > 0.0 {
        (remaining_files / speed * 1000.0) as u64
    } else {
        0
    };

    let progress = crate::ImportProgress {
        current: file_index,
        total: total_files,
        current_file: file_name.to_string(),
        elapsed_ms,
        estimated_remaining_ms,
        speed,
        result: None,
        current_phase: Some(phase_name.to_string()),
        file_progress: Some(file_progress),
    };

    // Log but don't fail if emit fails
    log::info!("📊 Emitting phase {} of {}: {}", phase_number, TOTAL_PHASES, phase_name);
    if let Err(e) = app.emit("import-progress", &progress) {
        log::error!("Failed to emit phase progress: {}", e);
    } else {
        log::info!("✅ Phase progress emitted successfully");
    }
}

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

/// Auto-detect and set primary user OnlineID on first import
///
/// Finds the most frequently occurring OnlineID across all players and sets it
/// as the primary user. Only runs if primary_user_online_id is not already set.
fn auto_detect_primary_user(conn: &Connection) -> Result<()> {
    // Skip if already configured
    if crate::db::settings::get_primary_user_online_id(conn)
        .map_err(|e| ParseError::InvalidFormat(e.to_string()))?
        .is_some()
    {
        return Ok(());
    }

    // Find most common OnlineID (excluding empty strings)
    let result: Option<String> = conn
        .query_row(
            "SELECT online_id FROM players
             WHERE online_id IS NOT NULL AND online_id != ''
             GROUP BY online_id
             ORDER BY COUNT(*) DESC
             LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    if let Some(online_id) = result {
        crate::db::settings::set_primary_user_online_id(conn, &online_id)
            .map_err(|e| ParseError::InvalidFormat(e.to_string()))?;
        log::info!("Auto-detected primary user OnlineID: {}", online_id);
    }

    Ok(())
}

/// Import result
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct ImportResult {
    pub success: bool,
    #[ts(type = "number")]
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
/// * `app` - Optional Tauri AppHandle for emitting progress events
/// * `file_index` - Optional file index (1-based) for batch imports
/// * `total_files` - Optional total number of files for batch imports
/// * `file_name` - Optional file name for progress tracking
/// * `batch_start_time` - Optional batch start time for ETA calculations
///
/// # Returns
/// ImportResult with success status and match_id
pub fn import_save_file(
    file_path: &str,
    conn: &Connection,
    app: Option<&tauri::AppHandle>,
    file_index: Option<usize>,
    total_files: Option<usize>,
    file_name: Option<&str>,
    batch_start_time: Option<Instant>,
) -> Result<ImportResult> {
    // Phase 1: Extract and parse XML
    log::info!("Importing save file: {}", file_path);

    let t_start = Instant::now();
    let t_zip = Instant::now();
    let xml_content = validate_and_extract_xml(file_path)?;
    let zip_time = t_zip.elapsed();
    log::info!("⏱️  ZIP extraction: {:?}", zip_time);
    eprintln!("⏱️  ZIP extraction: {:?}", zip_time);

    let t_parse = Instant::now();
    let doc = parse_xml(xml_content)?;
    let parse_time = t_parse.elapsed();
    log::info!("⏱️  XML parsing: {:?}", parse_time);
    eprintln!("⏱️  XML parsing: {:?}", parse_time);

    // Phase 2: Extract GameId to determine lock
    let game_id = doc
        .root_element()
        .req_attr("GameId")?
        .to_string();

    log::info!("Detected GameId: {}", game_id);

    // Acquire in-process lock (prevents same-app concurrency)
    let t_lock = Instant::now();
    let process_lock_arc = acquire_process_lock(&game_id);
    let _process_lock = process_lock_arc.lock().unwrap();

    // Begin transaction and acquire DB-level lock (prevents cross-process concurrency)
    let tx = conn.unchecked_transaction()?;
    acquire_db_lock(&tx, &game_id)?;
    let lock_time = t_lock.elapsed();
    log::info!("⏱️  Lock acquisition: {:?}", lock_time);
    eprintln!("⏱️  Lock acquisition: {:?}", lock_time);

    // Now safe to proceed - we have exclusive access for this GameId
    // Auto-detect primary user from existing data (only runs once, on first import with data)
    auto_detect_primary_user(&tx)?;

    let t_internal = Instant::now();
    match import_save_file_internal(
        file_path,
        &doc,
        &tx,
        &game_id,
        app,
        file_index,
        total_files,
        file_name,
        batch_start_time,
    ) {
        Ok(result) => {
            let internal_time = t_internal.elapsed();
            log::info!("⏱️  Internal import: {:?}", internal_time);
            eprintln!("⏱️  Internal import: {:?}", internal_time);
            // Release DB lock and commit
            let t_commit = Instant::now();
            release_db_lock(&tx, &game_id)?;
            tx.commit()?;
            let commit_time = t_commit.elapsed();
            log::info!("⏱️  Commit: {:?}", commit_time);
            eprintln!("⏱️  Commit: {:?}", commit_time);
            let total_time = t_start.elapsed();
            log::info!("⏱️  TOTAL IMPORT TIME: {:?}", total_time);
            eprintln!("⏱️  TOTAL IMPORT TIME: {:?}", total_time);
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
    app: Option<&tauri::AppHandle>,
    file_index: Option<usize>,
    total_files: Option<usize>,
    file_name: Option<&str>,
    batch_start_time: Option<Instant>,
) -> Result<ImportResult> {
    let t_setup = Instant::now();

    // Unpack progress tracking parameters (all must be Some to emit progress)
    let progress_params = if let (Some(app_h), Some(idx), Some(total), Some(name), Some(start)) =
        (app, file_index, total_files, file_name, batch_start_time)
    {
        Some((app_h, idx, total, name, start))
    } else {
        None
    };

    // Extract turn number from XML (Turn is inside Game element)
    let root = doc.root_element();
    let game_node = root
        .children()
        .find(|n| n.has_tag_name("Game"))
        .ok_or_else(|| ParseError::MissingElement("Game".to_string()))?;

    let turn_number: i32 = game_node
        .opt_child_text("Turn")
        .and_then(|t| t.parse().ok())
        .ok_or_else(|| ParseError::MissingElement("Game.Turn".to_string()))?;

    log::info!("Save is from turn {}", turn_number);

    // Check if this exact save (game_id, turn) already exists
    let existing_match: Option<(i64, String)> = tx
        .query_row(
            "SELECT match_id, file_name FROM matches WHERE game_id = ? AND total_turns = ?",
            params![game_id, turn_number],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    if let Some((existing_id, existing_file)) = existing_match {
        log::info!(
            "Save already imported as match {} (file: {}). Skipping re-import.",
            existing_id,
            existing_file
        );
        return Ok(ImportResult {
            success: true,
            match_id: Some(existing_id),
            game_id: game_id.to_string(),
            is_new: false,
            error: None,
        });
    }

    // Generate new match_id
    let match_id: i64 = tx
        .query_row("SELECT COALESCE(MAX(match_id), 0) + 1 FROM matches", [], |row| {
            row.get(0)
        })
        .unwrap_or(1);

    log::info!(
        "Creating new match {} (GameId: {}, Turn: {})",
        match_id,
        game_id,
        turn_number
    );

    // Compute file hash
    let file_hash = compute_file_hash(file_path)?;

    // Create IdMapper for fresh import (is_new = true)
    let mut id_mapper = IdMapper::new(match_id, tx, true)?;

    // Insert match record (no UPSERT - always fresh import)
    // Returns winner info if game has been won
    let winner_info = insert_match_metadata(tx, match_id, game_id, file_path, &file_hash, doc)?;

    let setup_time = t_setup.elapsed();
    log::info!("⏱️  Match setup: {:?}", setup_time);
    eprintln!("⏱️  Match setup: {:?}", setup_time);

    // PHASE 1: Extraction & Setup complete
    if let Some((app_h, idx, total, name, start)) = progress_params {
        emit_phase_progress(Some(app_h), idx, total, name, "Extracting and setting up", 1, start);
    }

    // PHASE 1: PARALLEL PARSING of foundation entities
    // Parse all 4 foundation entities concurrently for ~2x speedup
    log::info!("Parsing foundation entities (PARALLEL)...");
    let t_parse_foundation = Instant::now();

    let (players_data, characters_data, cities_data, tiles_data) =
        super::parsers::parse_foundation_entities_parallel(doc)?;

    let parse_foundation_time = t_parse_foundation.elapsed();
    log::info!("⏱️  Parallel foundation parsing: {:?}", parse_foundation_time);
    eprintln!("⏱️  Parallel foundation parsing: {:?}", parse_foundation_time);

    // PHASE 2: SEQUENTIAL INSERTION (order matters for foreign keys)
    log::info!("Inserting foundation entities (sequential)...");
    let t_insert_foundation = Instant::now();

    // 1. Players (no dependencies)
    let t_players = Instant::now();
    let players_count = super::inserters::insert_players(tx, &players_data, &mut id_mapper)?;
    let players_time = t_players.elapsed();
    log::info!("⏱️    Players: {:?} ({} players)", players_time, players_count);
    eprintln!("⏱️    Players: {:?} ({} players)", players_time, players_count);

    // Update winner_player_id if game has been won
    if let Some(ref winner) = winner_info {
        update_winner(tx, match_id, winner, &players_data, &id_mapper)?;
    }

    // Determine save owner (the person whose machine created this save)
    determine_save_owner(tx, match_id, &players_data, &id_mapper)?;

    // 2. Characters core (no relationships yet)
    let t_characters = Instant::now();
    let characters_count = super::inserters::insert_characters_core(tx, &characters_data, &mut id_mapper)?;
    let characters_time = t_characters.elapsed();
    log::info!("⏱️    Characters core: {:?} ({} characters)", characters_time, characters_count);
    eprintln!("⏱️    Characters core: {:?} ({} characters)", characters_time, characters_count);

    // CRITICAL FIX: Pass 2a - Parse parent relationships immediately after characters
    // This MUST happen BEFORE any tables reference characters via FK (tribes, cities, etc.)
    // DuckDB prevents updating a row that's already referenced by another table's FK.
    log::info!("Parsing character parent relationships (Pass 2a)...");
    let t_parents = Instant::now();
    parse_character_parent_relationships_pass2a(doc, tx, &id_mapper)?;
    let parents_time = t_parents.elapsed();
    log::info!("⏱️    Character parents: {:?}", parents_time);
    eprintln!("⏱️    Character parents: {:?}", parents_time);

    // 3. Tiles (depends on players for ownership)
    let t_tiles = Instant::now();
    super::inserters::insert_tiles_core(tx, &tiles_data, &mut id_mapper)?;
    let tiles_count = tiles_data.len();
    let tiles_time = t_tiles.elapsed();
    log::info!("⏱️    Tiles: {:?} ({} tiles)", tiles_time, tiles_count);
    eprintln!("⏱️    Tiles: {:?} ({} tiles)", tiles_time, tiles_count);

    // 4. Cities (depends on players, tiles)
    let t_cities = Instant::now();
    super::inserters::insert_cities(tx, &cities_data, &mut id_mapper)?;
    let cities_count = cities_data.len();
    let cities_time = t_cities.elapsed();
    log::info!("⏱️    Cities: {:?} ({} cities)", cities_time, cities_count);
    eprintln!("⏱️    Cities: {:?} ({} cities)", cities_time, cities_count);

    // Pass 2b - Update tile city ownership after cities are created
    log::info!("Updating tile city ownership (Pass 2b)...");
    let t_tile_city = Instant::now();
    super::entities::update_tile_city_ownership(doc, tx, &id_mapper)?;
    let tile_city_time = t_tile_city.elapsed();
    log::info!("⏱️    Tile city ownership: {:?}", tile_city_time);
    eprintln!("⏱️    Tile city ownership: {:?}", tile_city_time);

    // Pass 2c - Parse tile ownership history after city ownership is set
    log::info!("Parsing tile ownership history (Pass 2c)...");
    let t_tile_history = Instant::now();
    super::entities::parse_tile_ownership_history(doc, tx, &id_mapper)?;
    let tile_history_time = t_tile_history.elapsed();
    log::info!("⏱️    Tile ownership history: {:?}", tile_history_time);
    eprintln!("⏱️    Tile ownership history: {:?}", tile_history_time);

    // Pass 2d - Parse birth cities after cities are created
    log::info!("Parsing character birth cities (Pass 2d)...");
    let t_birth_cities = Instant::now();
    parse_character_birth_cities_pass2b(doc, tx, &id_mapper)?;
    let birth_cities_time = t_birth_cities.elapsed();
    log::info!("⏱️    Character birth cities: {:?}", birth_cities_time);
    eprintln!("⏱️    Character birth cities: {:?}", birth_cities_time);

    let insert_foundation_time = t_insert_foundation.elapsed();
    log::info!("⏱️  Sequential foundation insertion: {:?}", insert_foundation_time);
    eprintln!("⏱️  Sequential foundation insertion: {:?}", insert_foundation_time);

    // Free foundation entity data immediately after insertion
    drop(players_data);
    drop(characters_data);
    drop(cities_data);
    drop(tiles_data);
    log::debug!("Freed foundation entity data");

    // PHASE 3: PARALLEL PARSING of affiliation entities
    log::info!("Parsing affiliation entities (PARALLEL)...");
    let t_parse_affiliation = Instant::now();

    let (families_data, religions_data, tribes_data) =
        super::parsers::parse_affiliation_entities_parallel(doc)?;

    let parse_affiliation_time = t_parse_affiliation.elapsed();
    log::info!("⏱️  Parallel affiliation parsing: {:?}", parse_affiliation_time);
    eprintln!("⏱️  Parallel affiliation parsing: {:?}", parse_affiliation_time);

    // PHASE 4: SEQUENTIAL INSERTION of affiliation entities
    log::info!("Inserting affiliation entities (sequential)...");
    let t_insert_affiliation = Instant::now();

    // 5. Tribes (references characters via leader_character_id)
    let t_tribes = Instant::now();
    super::inserters::insert_tribes(tx, &tribes_data, &id_mapper)?;
    let tribes_count = tribes_data.len();
    let tribes_time = t_tribes.elapsed();
    log::info!("⏱️    Tribes: {:?} ({} tribes)", tribes_time, tribes_count);
    eprintln!("⏱️    Tribes: {:?} ({} tribes)", tribes_time, tribes_count);

    // 6. Families (parsed from global FamilyClass and per-player family data)
    let t_families = Instant::now();
    super::inserters::insert_families(tx, &families_data, &mut id_mapper)?;
    let families_count = families_data.len();
    let families_time = t_families.elapsed();
    log::info!("⏱️    Families: {:?} ({} families)", families_time, families_count);
    eprintln!("⏱️    Families: {:?} ({} families)", families_time, families_count);

    // 7. Religions (parsed from aggregate containers: ReligionFounded, ReligionHeadID, etc.)
    let t_religions = Instant::now();
    super::inserters::insert_religions(tx, &religions_data, &mut id_mapper)?;
    let religions_count = religions_data.len();
    let religions_time = t_religions.elapsed();
    log::info!("⏱️    Religions: {:?} ({} religions)", religions_time, religions_count);
    eprintln!("⏱️    Religions: {:?} ({} religions)", religions_time, religions_count);

    let insert_affiliation_time = t_insert_affiliation.elapsed();
    log::info!("⏱️  Sequential affiliation insertion: {:?}", insert_affiliation_time);
    eprintln!("⏱️  Sequential affiliation insertion: {:?}", insert_affiliation_time);

    // Free affiliation entity data immediately after insertion
    drop(families_data);
    drop(religions_data);
    drop(tribes_data);
    log::debug!("Freed affiliation entity data");

    log::info!(
        "Parsed entities: {} players, {} characters, {} tiles, {} cities, {} tribes, {} families, {} religions",
        players_count, characters_count, tiles_count, cities_count, tribes_count, families_count, religions_count
    );

    // PHASE 2: Foundation entities complete
    if let Some((app_h, idx, total, name, start)) = progress_params {
        emit_phase_progress(Some(app_h), idx, total, name, "Parsing foundation entities", 2, start);
    }

    // Parse aggregate unit production data - HYBRID PARSER (derived from entities)
    log::info!("Parsing aggregate unit production data...");
    let t_units = Instant::now();

    // Parse to structs (pure, no DB)
    let player_units_data = super::parsers::parse_player_units_produced(doc)?;
    let city_units_data = super::parsers::parse_city_units_produced(doc)?;

    // Insert to database
    super::inserters::insert_player_units_produced(tx, &player_units_data, &id_mapper)?;
    super::inserters::insert_city_units_produced(tx, &city_units_data, &id_mapper)?;

    let player_units_count = player_units_data.len();
    let city_units_count = city_units_data.len();

    log::info!(
        "Parsed unit production: {} player records, {} city records",
        player_units_count, city_units_count
    );
    let units_time = t_units.elapsed();
    log::info!("⏱️  Unit production: {:?}", units_time);
    eprintln!("⏱️  Unit production: {:?}", units_time);

    // PHASE 3: Unit production complete
    if let Some((app_h, idx, total, name, start)) = progress_params {
        emit_phase_progress(Some(app_h), idx, total, name, "Parsing unit production", 3, start);
    }

    // Parse player-nested gameplay data (Milestone 3)
    log::info!("Parsing player-nested gameplay data...");
    let t_gameplay = Instant::now();
    parse_player_gameplay_data(doc, tx, &id_mapper)?;
    let gameplay_time = t_gameplay.elapsed();
    log::info!("⏱️  Player gameplay data: {:?}", gameplay_time);
    eprintln!("⏱️  Player gameplay data: {:?}", gameplay_time);

    // PHASE 4: Gameplay data complete
    if let Some((app_h, idx, total, name, start)) = progress_params {
        emit_phase_progress(Some(app_h), idx, total, name, "Parsing gameplay data", 4, start);
    }

    // Parse game-level diplomacy
    log::info!("Parsing diplomacy...");
    let t_diplomacy = Instant::now();

    // Parse to structs (pure, no DB)
    let diplomacy_relations = super::parsers::parse_diplomacy_relations(doc)?;

    // Insert to database
    super::inserters::insert_diplomacy_relations(tx, &diplomacy_relations, match_id)?;

    let diplomacy_count = diplomacy_relations.len();
    log::info!("Parsed {} diplomacy relations", diplomacy_count);
    let diplomacy_time = t_diplomacy.elapsed();
    log::info!("⏱️  Diplomacy: {:?}", diplomacy_time);
    eprintln!("⏱️  Diplomacy: {:?}", diplomacy_time);

    // PHASE 5: Diplomacy complete
    if let Some((app_h, idx, total, name, start)) = progress_params {
        emit_phase_progress(Some(app_h), idx, total, name, "Parsing diplomacy", 5, start);
    }

    // Parse time-series data (Milestone 4)
    log::info!("Parsing time-series data...");
    let t_timeseries = Instant::now();
    parse_timeseries_data(doc, tx, &id_mapper)?;
    let timeseries_time = t_timeseries.elapsed();
    log::info!("⏱️  Time-series data: {:?}", timeseries_time);
    eprintln!("⏱️  Time-series data: {:?}", timeseries_time);

    // PHASE 6: Time-series data complete
    if let Some((app_h, idx, total, name, start)) = progress_params {
        emit_phase_progress(Some(app_h), idx, total, name, "Parsing time-series data", 6, start);
    }

    // Parse character extended data (Milestone 5)
    log::info!("Parsing character extended data (stats, traits, relationships)...");
    let t_char_ext = Instant::now();
    parse_character_extended_data_all(doc, tx, &id_mapper)?;
    let char_ext_time = t_char_ext.elapsed();
    log::info!("⏱️  Character extended data: {:?}", char_ext_time);
    eprintln!("⏱️  Character extended data: {:?}", char_ext_time);

    // Parse city extended data (Milestone 5 + 6)
    log::info!("Parsing city extended data (production, culture, happiness)...");
    let t_city_ext = Instant::now();
    parse_city_extended_data_all(doc, tx, &id_mapper)?;
    let city_ext_time = t_city_ext.elapsed();
    log::info!("⏱️  City extended data: {:?}", city_ext_time);
    eprintln!("⏱️  City extended data: {:?}", city_ext_time);

    // PHASE 7: Character & city extended data complete
    if let Some((app_h, idx, total, name, start)) = progress_params {
        emit_phase_progress(Some(app_h), idx, total, name, "Parsing character and city data", 7, start);
    }

    // Parse tile extended data (Milestone 6)
    log::info!("Parsing tile extended data (visibility, history)...");
    let t_tile_ext = Instant::now();
    parse_tile_extended_data_all(doc, tx, &id_mapper)?;
    let tile_ext_time = t_tile_ext.elapsed();
    log::info!("⏱️  Tile extended data: {:?}", tile_ext_time);
    eprintln!("⏱️  Tile extended data: {:?}", tile_ext_time);

    // Parse event stories (Milestone 5)
    log::info!("Parsing event stories...");
    let t_events = Instant::now();
    parse_event_stories(doc, tx, &id_mapper)?;
    let events_time = t_events.elapsed();
    log::info!("⏱️  Event stories: {:?}", events_time);
    eprintln!("⏱️  Event stories: {:?}", events_time);

    // Save ID mappings
    let t_id_save = Instant::now();
    id_mapper.save_mappings(tx)?;
    let id_save_time = t_id_save.elapsed();
    log::info!("⏱️  Save ID mappings: {:?}", id_save_time);
    eprintln!("⏱️  Save ID mappings: {:?}", id_save_time);

    // PHASE 8: Finalization complete
    if let Some((app_h, idx, total, name, start)) = progress_params {
        emit_phase_progress(Some(app_h), idx, total, name, "Finalizing", 8, start);
    }

    Ok(ImportResult {
        success: true,
        match_id: Some(match_id),
        game_id: game_id.to_string(),
        is_new: true, // Always true - we skip re-imports upfront
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
/// - PermanentLogList/LogData → event_logs
/// - MemoryList/MemoryData → memory_data
fn parse_player_gameplay_data(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    // Parse to structs (pure, no DB)
    let player_data = super::parsers::parse_all_player_data(doc)?;

    // Parse event logs and memories (these are also player-nested)
    let (_, event_logs, memory_data) = super::parsers::parse_events_struct(doc)?;

    // Insert to database
    super::inserters::insert_player_resources(tx, &player_data.resources, id_mapper)?;
    super::inserters::insert_technology_progress(tx, &player_data.tech_progress, id_mapper)?;
    super::inserters::insert_technologies_completed(tx, &player_data.tech_completed, id_mapper)?;
    super::inserters::insert_technology_states(tx, &player_data.tech_states, id_mapper)?;
    super::inserters::insert_player_council(tx, &player_data.council, id_mapper)?;
    super::inserters::insert_laws(tx, &player_data.laws, id_mapper)?;
    super::inserters::insert_player_goals(tx, &player_data.goals, id_mapper)?;
    super::inserters::insert_event_logs(tx, &event_logs, id_mapper)?;
    super::inserters::insert_memory_data(tx, &memory_data, id_mapper)?;

    log::info!(
        "Parsed player gameplay data: {} resources, {} tech_progress, {} tech_completed, {} tech_states, {} council, {} laws, {} goals, {} log_events, {} memories",
        player_data.resources.len(),
        player_data.tech_progress.len(),
        player_data.tech_completed.len(),
        player_data.tech_states.len(),
        player_data.council.len(),
        player_data.laws.len(),
        player_data.goals.len(),
        event_logs.len(),
        memory_data.len()
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
    // Parse to structs (pure, no DB)
    let yield_prices = super::parsers::parse_yield_price_history_struct(doc)?;
    let (military_power, points, legitimacy, yield_rates, family_opinions, religion_opinions) =
        super::parsers::parse_all_player_timeseries(doc)?;

    // Insert to database
    super::inserters::insert_yield_price_history(tx, &yield_prices, id_mapper)?;
    super::inserters::insert_military_power_history(tx, &military_power, id_mapper)?;
    super::inserters::insert_points_history(tx, &points, id_mapper)?;
    super::inserters::insert_legitimacy_history(tx, &legitimacy, id_mapper)?;
    super::inserters::insert_yield_rate_history(tx, &yield_rates, id_mapper)?;
    super::inserters::insert_family_opinion_history(tx, &family_opinions, id_mapper)?;
    super::inserters::insert_religion_opinion_history(tx, &religion_opinions, id_mapper)?;

    log::info!(
        "Parsed time-series data: {} yield prices, {} military, {} points, {} legitimacy, {} yields, {} family opinions, {} religion opinions",
        yield_prices.len(),
        military_power.len(),
        points.len(),
        legitimacy.len(),
        yield_rates.len(),
        family_opinions.len(),
        religion_opinions.len()
    );

    Ok(())
}

/// Parse character parent relationships (Pass 2a)
///
/// This function updates the characters table with parent relationships ONLY.
/// CRITICAL: This must be called BEFORE any tables reference characters via FK
/// (tribes, cities, player_goals, etc.) to avoid DuckDB FK constraint violations.
fn parse_character_parent_relationships_pass2a(
    doc: &XmlDocument,
    tx: &Connection,
    id_mapper: &IdMapper,
) -> Result<()> {
    let root = doc.root_element();
    let mut parent_count = 0;

    for character_node in root.children().filter(|n| n.has_tag_name("Character")) {
        let character_xml_id_str: &str = character_node.req_attr("ID")?;
        let character_xml_id: i32 = character_xml_id_str.parse().map_err(|_| {
            ParseError::InvalidFormat(format!(
                "Character ID must be an integer: {}",
                character_xml_id_str
            ))
        })?;
        let character_id = id_mapper.get_character(character_xml_id)?;

        // Parse parent relationships (now that all characters exist)
        let has_parents = super::entities::parse_character_parent_relationships(&character_node, tx, id_mapper, character_id)?;
        if has_parents {
            parent_count += 1;
        }
    }

    log::info!("Updated {} characters with parent relationships", parent_count);
    Ok(())
}

/// Parse character birth cities (Pass 2b)
///
/// This function updates the characters table with birth city references.
/// This must be called AFTER cities have been inserted.
fn parse_character_birth_cities_pass2b(
    doc: &XmlDocument,
    tx: &Connection,
    id_mapper: &IdMapper,
) -> Result<()> {
    let root = doc.root_element();
    let mut city_count = 0;

    for character_node in root.children().filter(|n| n.has_tag_name("Character")) {
        let character_xml_id_str: &str = character_node.req_attr("ID")?;
        let character_xml_id: i32 = character_xml_id_str.parse().map_err(|_| {
            ParseError::InvalidFormat(format!(
                "Character ID must be an integer: {}",
                character_xml_id_str
            ))
        })?;
        let character_id = id_mapper.get_character(character_xml_id)?;

        // Parse birth city (now that all cities exist)
        let has_birth_city = super::entities::parse_character_birth_city(&character_node, tx, id_mapper, character_id)?;
        if has_birth_city {
            city_count += 1;
        }
    }

    log::info!("Updated {} characters with birth city", city_count);
    Ok(())
}

/// Parse character extended data (Milestone 5)
///
/// This function parses character-specific nested data:
/// - Stats (Rating, Stat) -> character_stats table
/// - Traits (TraitTurn) -> character_traits table
/// - Relationships (RelationshipList) -> character_relationships table
/// - Marriages (Spouses) -> character_marriages table
///
/// Note: Genealogy (parent relationships) is now parsed earlier in Pass 2
fn parse_character_extended_data_all(
    doc: &XmlDocument,
    tx: &Connection,
    id_mapper: &IdMapper,
) -> Result<()> {
    // Parse to structs (pure, no DB)
    let (stats, traits, relationships, marriages) =
        super::parsers::parse_all_character_data_struct(doc.document())?;

    // Insert to database
    super::inserters::insert_character_stats(tx, &stats, id_mapper)?;
    super::inserters::insert_character_traits(tx, &traits, id_mapper)?;
    super::inserters::insert_character_relationships(tx, &relationships, id_mapper)?;
    super::inserters::insert_character_marriages(tx, &marriages, id_mapper)?;

    log::info!(
        "Parsed character extended data: {} stats, {} traits, {} relationships, {} marriages",
        stats.len(),
        traits.len(),
        relationships.len(),
        marriages.len()
    );

    Ok(())
}

/// Parse city extended data (Milestone 5 + 6)
///
/// This function parses city-specific nested data:
/// - Production queue (BuildQueue) -> city_production_queue table
/// - Completed builds (CompletedBuild) -> city_projects_completed table
/// - Culture and happiness (TeamCulture, TeamHappinessLevel) -> city_culture table
/// - Yields (YieldProgress) -> city_yields table
/// - Religions (Religion) -> city_religions table
fn parse_city_extended_data_all(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    // Parse to structs (pure, no DB)
    let city_production = super::parsers::parse_city_production_queue_struct(doc)?;
    let city_projects = super::parsers::parse_city_projects_completed_struct(doc)?;
    let city_yields = super::parsers::parse_city_yields_struct(doc)?;
    let city_religions = super::parsers::parse_city_religions_struct(doc)?;
    let city_culture = super::parsers::parse_city_culture_struct(doc)?;

    // Insert to database
    super::inserters::insert_city_production_queue(tx, &city_production, id_mapper)?;
    super::inserters::insert_city_projects_completed(tx, &city_projects, id_mapper)?;
    super::inserters::insert_city_yields(tx, &city_yields, id_mapper)?;
    super::inserters::insert_city_religions(tx, &city_religions, id_mapper)?;
    super::inserters::insert_city_culture(tx, &city_culture, id_mapper)?;

    log::info!(
        "Parsed city extended data: {} production queue, {} projects completed, {} yields, {} religions, {} culture",
        city_production.len(),
        city_projects.len(),
        city_yields.len(),
        city_religions.len(),
        city_culture.len()
    );

    Ok(())
}

/// Parse tile extended data (Milestone 6)
///
/// This function parses tile-specific nested data:
/// - Tile visibility (RevealedTurn, RevealedOwner) -> tile_visibility table
/// - Tile history (OwnerHistory, TerrainHistory, VegetationHistory) -> tile_changes table
fn parse_tile_extended_data_all(doc: &XmlDocument, tx: &Connection, id_mapper: &IdMapper) -> Result<()> {
    // Parse to structs (pure, no DB)
    let visibility = super::parsers::parse_tile_visibility_struct(doc)?;
    let changes = super::parsers::parse_tile_changes_struct(doc)?;

    // Insert to database
    super::inserters::insert_tile_visibility(tx, &visibility, id_mapper)?;
    super::inserters::insert_tile_changes(tx, &changes, id_mapper)?;

    let visibility_count = visibility.len();
    let changes_count = changes.len();

    log::info!(
        "Parsed tile extended data: {} visibility records, {} history changes",
        visibility_count,
        changes_count
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
    // Parse to structs (pure, no DB)
    // Note: We already parsed event_logs and memory_data in parse_player_gameplay_data,
    // so we only need the event_stories here
    let (event_stories, _, _) = super::parsers::parse_events_struct(doc)?;

    // Insert to database
    super::inserters::insert_event_stories(tx, &event_stories, id_mapper)?;

    log::info!("Parsed {} event stories", event_stories.len());

    Ok(())
}

/// Parse version string from Root element
/// Format: "Version: 1.0.70671+mod1+mod2+...=-123456"
/// Returns (version_number, mods_list_string)
fn parse_version_string(version: &str) -> (Option<String>, Option<String>) {
    // Split by '+' to separate version and mods
    let parts: Vec<&str> = version.split('+').collect();
    if parts.is_empty() {
        return (None, None);
    }

    // First part is "Version: 1.0.70671"
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

/// Parse GameContent element to extract enabled DLCs
/// Format: <GameContent><DLC_HEROES_OF_AEGEAN /><DLC_THE_SACRED_AND_THE_PROFANE />...</GameContent>
/// Returns DLC names joined with "+" (e.g., "DLC_HEROES_OF_AEGEAN+DLC_THE_SACRED_AND_THE_PROFANE")
fn parse_game_content(root: &roxmltree::Node) -> Option<String> {
    let game_content = root.children().find(|n| n.has_tag_name("GameContent"))?;

    let dlcs: Vec<&str> = game_content
        .children()
        .filter(|child| child.is_element())
        .map(|el| el.tag_name().name())
        .filter(|name| name.starts_with("DLC_"))
        .collect();

    if dlcs.is_empty() {
        None
    } else {
        Some(dlcs.join("+"))
    }
}

/// Parse SaveDate string to timestamp
/// Format: "31 January 2024" or similar
fn parse_save_date(date_str: &str) -> Option<String> {
    use chrono::NaiveDate;

    // Try parsing "31 January 2024" format
    NaiveDate::parse_from_str(date_str, "%d %B %Y")
        .ok()
        .map(|d| d.format("%Y-%m-%d").to_string())
}

/// Winner information extracted from XML
#[derive(Debug, Clone)]
enum WinnerInfo {
    /// Winner identified by team ID (from TeamVictoriesCompleted)
    TeamId(i32, Option<String>), // (team_id, victory_type)
    /// Winner identified by player XML ID (from Victory element)
    PlayerXmlId(i32, Option<String>), // (player_xml_id, victory_type)
}

/// Update match with winner player ID after players are inserted
fn update_winner(
    tx: &Connection,
    match_id: i64,
    winner_info: &WinnerInfo,
    players_data: &[super::game_data::PlayerData],
    id_mapper: &IdMapper,
) -> Result<()> {
    // Resolve winner info to player XML ID and extract victory type
    let (winner_player_xml_id, victory_type) = match winner_info {
        WinnerInfo::TeamId(team_id, victory_type) => {
            // For single-player games (team 0), the winner is the human player
            // For multiplayer, try to match by team_id attribute
            let team_id_str = team_id.to_string();

            // Try finding by team_id attribute first
            let xml_id = if let Some(player) = players_data.iter().find(|p| p.team_id.as_ref() == Some(&team_id_str)) {
                player.xml_id
            } else {
                // Fallback: in single-player games, find the human player
                players_data
                    .iter()
                    .find(|p| p.is_human)
                    .map(|p| p.xml_id)
                    .ok_or_else(|| {
                        ParseError::InvalidFormat(format!(
                            "No human player found for winning team ID: {}",
                            team_id
                        ))
                    })?
            };
            (xml_id, victory_type.clone())
        }
        WinnerInfo::PlayerXmlId(xml_id, victory_type) => (*xml_id, victory_type.clone()),
    };

    // Map player XML ID to DB ID
    let winner_player_db_id = id_mapper.get_player(winner_player_xml_id)?;

    // Update matches table with winner and victory type
    tx.execute(
        "UPDATE matches SET winner_player_id = ?, winner_victory_type = ? WHERE match_id = ?",
        params![winner_player_db_id, victory_type, match_id],
    )?;

    log::info!(
        "Set winner: player XML ID {} → DB ID {}, victory type: {:?}",
        winner_player_xml_id,
        winner_player_db_id,
        victory_type
    );

    Ok(())
}

/// Determine which player is the save owner (the person whose machine created this save)
///
/// Detection priority:
/// 1. If only one human player exists → they are the save owner
/// 2. If primary_user_online_id is set → match player by OnlineID
/// 3. Otherwise → leave is_save_owner = false for all players (unknown)
fn determine_save_owner(
    tx: &Connection,
    match_id: i64,
    players_data: &[super::game_data::PlayerData],
    id_mapper: &IdMapper,
) -> Result<()> {
    let human_players: Vec<_> = players_data.iter().filter(|p| p.is_human).collect();

    let save_owner_xml_id: Option<i32> = if human_players.len() == 1 {
        // Single human = save owner (covers all single-player games)
        Some(human_players[0].xml_id)
    } else if human_players.len() > 1 {
        // Multiple humans: try to match by primary user OnlineID
        let primary_online_id = crate::db::settings::get_primary_user_online_id(tx)
            .map_err(|e| ParseError::InvalidFormat(e.to_string()))?;

        if let Some(ref online_id) = primary_online_id {
            players_data
                .iter()
                .find(|p| p.online_id.as_ref() == Some(online_id))
                .map(|p| p.xml_id)
        } else {
            None // No primary user configured, can't determine save owner
        }
    } else {
        None // No human players
    };

    if let Some(xml_id) = save_owner_xml_id {
        let db_id = id_mapper.get_player(xml_id)?;
        tx.execute(
            "UPDATE players SET is_save_owner = TRUE WHERE player_id = ? AND match_id = ?",
            params![db_id, match_id],
        )?;
        log::debug!("Set save owner: player XML ID {} → DB ID {}", xml_id, db_id);
    }

    Ok(())
}

/// Insert match metadata (fresh import only - no UPSERT)
/// Returns winner information if a victory is detected in the save file
fn insert_match_metadata(
    tx: &Connection,
    match_id: i64,
    game_id: &str,
    file_path: &str,
    file_hash: &str,
    doc: &XmlDocument,
) -> Result<Option<WinnerInfo>> {
    let root = doc.root_element();

    // Extract file name from path
    let file_name = std::path::Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown.zip");

    // Get Turn from Game element
    let game_node = root
        .children()
        .find(|n| n.has_tag_name("Game"))
        .ok_or_else(|| ParseError::MissingElement("Game".to_string()))?;
    let total_turns: i32 = game_node
        .opt_child_text("Turn")
        .and_then(|t| t.parse().ok())
        .ok_or_else(|| ParseError::MissingElement("Game.Turn".to_string()))?;

    // Extract all Root attributes
    // Version and mods information
    let (game_version, enabled_mods) = root
        .opt_attr("Version")
        .map(parse_version_string)
        .unwrap_or((None, None));

    // DLC information from GameContent element
    let enabled_dlc = parse_game_content(&root);

    // Save date
    let save_date = root
        .opt_attr("SaveDate")
        .and_then(parse_save_date);

    // Map configuration
    let map_width: Option<i32> = root.opt_attr("MapWidth").and_then(|s| s.parse().ok());
    let map_height = map_width; // MapHeight not in XML, using MapWidth as square map assumption
    let min_latitude: Option<i32> = root.opt_attr("MinLatitude").and_then(|s| s.parse().ok());
    let max_latitude: Option<i32> = root.opt_attr("MaxLatitude").and_then(|s| s.parse().ok());
    let map_size = root.opt_attr("MapSize");
    let map_class = root.opt_attr("MapClass");
    let map_aspect_ratio = root.opt_attr("MapAspectRatio"); // Available in newer game versions

    // Game settings
    let game_name = root.opt_attr("GameName").or_else(|| root.opt_child_text("GameName"));
    let game_mode = root.opt_attr("GameMode");
    let turn_style = root.opt_attr("TurnStyle");
    let turn_timer = root.opt_attr("TurnTimer");
    let turn_scale = root.opt_attr("TurnScale");
    let simultaneous_turns: Option<i32> = None; // Not in current XML format

    // Difficulty and balance
    let opponent_level = root.opt_attr("OpponentLevel");
    let tribe_level = root.opt_attr("TribeLevel");
    let development = root.opt_attr("Development");
    let advantage = root.opt_attr("Advantage");

    // Rules
    let succession_gender = root.opt_attr("SuccessionGender");
    let succession_order = root.opt_attr("SuccessionOrder");
    let mortality = root.opt_attr("Mortality");
    let event_level = root.opt_attr("EventLevel");
    let victory_point_modifier = root.opt_attr("VictoryPointModifier");
    let force_march = root.opt_attr("ForceMarch");
    let team_nation = root.opt_attr("TeamNation");

    // Seeds
    let first_seed: Option<i64> = root.opt_attr("FirstSeed").and_then(|s| s.parse().ok());
    let map_seed: Option<i64> = root.opt_attr("MapSeed").and_then(|s| s.parse().ok());

    // Victory conditions - extract from VictoryEnabled element
    let victory_conditions = root
        .children()
        .find(|n| n.has_tag_name("VictoryEnabled"))
        .map(|ve| {
            ve.children()
                .filter(|child| child.is_element())
                .filter_map(|child| Some(child.tag_name().name().to_string()))
                .collect::<Vec<String>>()
                .join("+")
        })
        .filter(|s| !s.is_empty()); // Return None if no victory conditions found

    // Extract winner information (if game has been won)
    // TeamVictories is inside the Game element
    let winner_info = game_node
        .children()
        .find(|n| n.has_tag_name("TeamVictories"))
        .and_then(|tv| {
            tv.children()
                .find(|n| n.has_tag_name("Team"))
                .and_then(|team| {
                    let team_id = team.text()?.parse::<i32>().ok()?;
                    let victory_type = team.opt_attr("Victory").map(|s| s.to_string());
                    Some(WinnerInfo::TeamId(team_id, victory_type))
                })
        })
        .or_else(|| {
            // Fallback: Check Victory element with winner attribute (in root)
            root.children()
                .find(|n| n.has_tag_name("Victory"))
                .and_then(|v| {
                    let winner_id = v.opt_attr("winner")?.parse::<i32>().ok()?;
                    let victory_type = v.opt_attr("type").map(|s| s.to_string());
                    Some(WinnerInfo::PlayerXmlId(winner_id, victory_type))
                })
        });

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

    Ok(winner_info)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::create_schema;
    use tempfile::tempdir;

    fn setup_test_db() -> Connection {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();
        // Leak the tempdir so it doesn't get cleaned up while conn is in use
        std::mem::forget(dir);
        conn
    }

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

    #[test]
    fn test_auto_detect_primary_user_selects_most_common() {
        let conn = setup_test_db();

        // Insert test match
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns) VALUES (1, 'test', 'test.zip', 'abc123', 100)",
            [],
        ).unwrap();

        // Insert players: OnlineID "A" appears twice, "B" appears once
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, online_id, is_human) VALUES (1, 1, 'Player1', 'player1', 'NATION_ROME', 'A', TRUE)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, online_id, is_human) VALUES (2, 1, 'Player2', 'player2', 'NATION_GREECE', 'A', TRUE)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, online_id, is_human) VALUES (3, 1, 'Player3', 'player3', 'NATION_PERSIA', 'B', TRUE)",
            [],
        ).unwrap();

        // Run auto-detect
        auto_detect_primary_user(&conn).unwrap();

        // Should select "A" as it appears most frequently
        let result = crate::db::settings::get_primary_user_online_id(&conn).unwrap();
        assert_eq!(result, Some("A".to_string()));
    }

    #[test]
    fn test_auto_detect_primary_user_skips_if_already_set() {
        let conn = setup_test_db();

        // Pre-set the primary user
        crate::db::settings::set_primary_user_online_id(&conn, "X").unwrap();

        // Insert test match
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns) VALUES (1, 'test', 'test.zip', 'abc123', 100)",
            [],
        ).unwrap();

        // Insert players where "A" appears most
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, online_id, is_human) VALUES (1, 1, 'Player1', 'player1', 'NATION_ROME', 'A', TRUE)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, online_id, is_human) VALUES (2, 1, 'Player2', 'player2', 'NATION_GREECE', 'A', TRUE)",
            [],
        ).unwrap();

        // Run auto-detect
        auto_detect_primary_user(&conn).unwrap();

        // Should still be "X" since it was already set
        let result = crate::db::settings::get_primary_user_online_id(&conn).unwrap();
        assert_eq!(result, Some("X".to_string()));
    }

    #[test]
    fn test_auto_detect_primary_user_ignores_empty_online_ids() {
        let conn = setup_test_db();

        // Insert test match
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns) VALUES (1, 'test', 'test.zip', 'abc123', 100)",
            [],
        ).unwrap();

        // Insert players: empty OnlineID appears most, but valid "A" appears once
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, online_id, is_human) VALUES (1, 1, 'Player1', 'player1', 'NATION_ROME', '', FALSE)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, online_id, is_human) VALUES (2, 1, 'Player2', 'player2', 'NATION_GREECE', '', FALSE)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, online_id, is_human) VALUES (3, 1, 'Player3', 'player3', 'NATION_PERSIA', 'A', TRUE)",
            [],
        ).unwrap();

        // Run auto-detect
        auto_detect_primary_user(&conn).unwrap();

        // Should select "A", ignoring empty strings
        let result = crate::db::settings::get_primary_user_online_id(&conn).unwrap();
        assert_eq!(result, Some("A".to_string()));
    }

    #[test]
    fn test_auto_detect_primary_user_no_players() {
        let conn = setup_test_db();

        // No players in database

        // Run auto-detect
        auto_detect_primary_user(&conn).unwrap();

        // Should remain None since no players exist
        let result = crate::db::settings::get_primary_user_online_id(&conn).unwrap();
        assert_eq!(result, None);
    }

    /// Helper to create a minimal PlayerData for testing
    fn make_test_player(xml_id: i32, is_human: bool, online_id: Option<&str>) -> super::super::game_data::PlayerData {
        super::super::game_data::PlayerData {
            xml_id,
            player_name: format!("Player{}", xml_id),
            nation: Some("NATION_ROME".to_string()),
            dynasty: None,
            team_id: None,
            is_human,
            is_save_owner: false,
            online_id: online_id.map(|s| s.to_string()),
            email: None,
            difficulty: None,
            last_turn_completed: None,
            turn_ended: false,
            legitimacy: None,
            succession_gender: None,
            state_religion: None,
            founder_character_xml_id: None,
            chosen_heir_xml_id: None,
            original_capital_city_xml_id: None,
            time_stockpile: None,
            tech_researching: None,
            ambition_delay: 0,
            tiles_purchased: 0,
            state_religion_changes: 0,
            tribe_mercenaries_hired: 0,
        }
    }

    #[test]
    fn test_determine_save_owner_single_human() {
        let conn = setup_test_db();

        // Insert test match
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns) VALUES (1, 'test', 'test.zip', 'abc123', 100)",
            [],
        ).unwrap();

        // Insert players: one human, two AI
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, is_human) VALUES (1, 1, 'Human', 'human', 'NATION_ROME', TRUE)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, is_human) VALUES (2, 1, 'AI1', 'ai1', 'NATION_GREECE', FALSE)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, is_human) VALUES (3, 1, 'AI2', 'ai2', 'NATION_PERSIA', FALSE)",
            [],
        ).unwrap();

        // Create IdMapper with proper mappings (xml_id 0 -> db_id 1, etc.)
        let mut id_mapper = IdMapper::new(1, &conn, true).unwrap();
        id_mapper.map_player(0); // xml_id 0 -> db_id 1
        id_mapper.map_player(1); // xml_id 1 -> db_id 2
        id_mapper.map_player(2); // xml_id 2 -> db_id 3

        // Create PlayerData structs matching the inserted players
        let players_data = vec![
            make_test_player(0, true, None),  // Human player, xml_id 0 -> db_id 1
            make_test_player(1, false, None), // AI player
            make_test_player(2, false, None), // AI player
        ];

        // Run determine_save_owner
        determine_save_owner(&conn, 1, &players_data, &id_mapper).unwrap();

        // Verify human player has is_save_owner = true
        let is_owner: bool = conn.query_row(
            "SELECT is_save_owner FROM players WHERE player_id = 1 AND match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(is_owner, "Single human player should be marked as save owner");

        // Verify AI players have is_save_owner = false
        let ai1_owner: bool = conn.query_row(
            "SELECT is_save_owner FROM players WHERE player_id = 2 AND match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(!ai1_owner, "AI player should not be save owner");
    }

    #[test]
    fn test_determine_save_owner_multiple_humans_with_primary_user() {
        let conn = setup_test_db();

        // Insert test match
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns) VALUES (1, 'test', 'test.zip', 'abc123', 100)",
            [],
        ).unwrap();

        // Pre-set the primary user OnlineID
        crate::db::settings::set_primary_user_online_id(&conn, "PLAYER_B_ID").unwrap();

        // Insert two human players with different OnlineIDs
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, online_id, is_human) VALUES (1, 1, 'PlayerA', 'playera', 'NATION_ROME', 'PLAYER_A_ID', TRUE)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, online_id, is_human) VALUES (2, 1, 'PlayerB', 'playerb', 'NATION_GREECE', 'PLAYER_B_ID', TRUE)",
            [],
        ).unwrap();

        // Create IdMapper
        let mut id_mapper = IdMapper::new(1, &conn, true).unwrap();
        id_mapper.map_player(0); // xml_id 0 -> db_id 1
        id_mapper.map_player(1); // xml_id 1 -> db_id 2

        // Create PlayerData structs
        let players_data = vec![
            make_test_player(0, true, Some("PLAYER_A_ID")),
            make_test_player(1, true, Some("PLAYER_B_ID")), // This one matches primary user
        ];

        // Run determine_save_owner
        determine_save_owner(&conn, 1, &players_data, &id_mapper).unwrap();

        // Verify PlayerB (matching primary user) is save owner
        let player_a_owner: bool = conn.query_row(
            "SELECT is_save_owner FROM players WHERE player_id = 1 AND match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(!player_a_owner, "PlayerA should NOT be save owner (wrong OnlineID)");

        let player_b_owner: bool = conn.query_row(
            "SELECT is_save_owner FROM players WHERE player_id = 2 AND match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(player_b_owner, "PlayerB should be save owner (matches primary user OnlineID)");
    }

    #[test]
    fn test_determine_save_owner_multiple_humans_no_primary_user() {
        let conn = setup_test_db();

        // Insert test match
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns) VALUES (1, 'test', 'test.zip', 'abc123', 100)",
            [],
        ).unwrap();

        // DO NOT set primary user - leave it as None

        // Insert two human players
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, online_id, is_human) VALUES (1, 1, 'PlayerA', 'playera', 'NATION_ROME', 'PLAYER_A_ID', TRUE)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, online_id, is_human) VALUES (2, 1, 'PlayerB', 'playerb', 'NATION_GREECE', 'PLAYER_B_ID', TRUE)",
            [],
        ).unwrap();

        // Create IdMapper
        let mut id_mapper = IdMapper::new(1, &conn, true).unwrap();
        id_mapper.map_player(0);
        id_mapper.map_player(1);

        // Create PlayerData structs
        let players_data = vec![
            make_test_player(0, true, Some("PLAYER_A_ID")),
            make_test_player(1, true, Some("PLAYER_B_ID")),
        ];

        // Run determine_save_owner
        determine_save_owner(&conn, 1, &players_data, &id_mapper).unwrap();

        // Verify neither player is marked as save owner
        let player_a_owner: bool = conn.query_row(
            "SELECT is_save_owner FROM players WHERE player_id = 1 AND match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(!player_a_owner, "PlayerA should NOT be save owner (no primary user set)");

        let player_b_owner: bool = conn.query_row(
            "SELECT is_save_owner FROM players WHERE player_id = 2 AND match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(!player_b_owner, "PlayerB should NOT be save owner (no primary user set)");
    }

    #[test]
    fn test_parse_game_content() {
        // Test with DLCs present
        let xml = r#"<Root><GameContent><DLC_HEROES_OF_AEGEAN /><DLC_THE_SACRED_AND_THE_PROFANE /></GameContent></Root>"#;
        let doc = roxmltree::Document::parse(xml).unwrap();
        let root = doc.root_element();
        let result = parse_game_content(&root);
        assert_eq!(result, Some("DLC_HEROES_OF_AEGEAN+DLC_THE_SACRED_AND_THE_PROFANE".to_string()));

        // Test with no DLCs (empty GameContent)
        let xml_empty = r#"<Root><GameContent></GameContent></Root>"#;
        let doc_empty = roxmltree::Document::parse(xml_empty).unwrap();
        let root_empty = doc_empty.root_element();
        let result_empty = parse_game_content(&root_empty);
        assert_eq!(result_empty, None);

        // Test with no GameContent element
        let xml_missing = r#"<Root></Root>"#;
        let doc_missing = roxmltree::Document::parse(xml_missing).unwrap();
        let root_missing = doc_missing.root_element();
        let result_missing = parse_game_content(&root_missing);
        assert_eq!(result_missing, None);

        // Test filtering non-DLC children
        let xml_mixed = r#"<Root><GameContent><DLC_CALAMITIES /><SOME_OTHER_THING /></GameContent></Root>"#;
        let doc_mixed = roxmltree::Document::parse(xml_mixed).unwrap();
        let root_mixed = doc_mixed.root_element();
        let result_mixed = parse_game_content(&root_mixed);
        assert_eq!(result_mixed, Some("DLC_CALAMITIES".to_string()));
    }
}
