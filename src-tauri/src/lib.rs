// Old World Save Game Parser
//
// Modules:
// - db: Database connection and schema management
// - parser: ZIP extraction, XML parsing, ID mapping
// - types: Serializable response types for Tauri commands

pub mod db;
pub mod parser;
pub mod types;

use anyhow::Context;
use db::collections::Collection;
use parser::ImportResult;
use std::path::PathBuf;
use std::time::Instant;
use tauri::{Emitter, Manager};
use types::*;

// Initialize logging to both console and file (dev builds only)
#[cfg(debug_assertions)]
fn init_logging() {
    // Create logs directory if it doesn't exist
    let logs_dir = std::path::Path::new("logs");
    if !logs_dir.exists() {
        let _ = std::fs::create_dir_all(logs_dir);
    }

    // Open log file (append mode)
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("logs/dev.log")
        .expect("Failed to open log file");

    // Configure fern for dual output (console + file)
    fern::Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "[{} {} {}] {}",
                chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ"),
                record.level(),
                record.target(),
                message
            ))
        })
        .level(log::LevelFilter::Info)
        // Output to stderr (console)
        .chain(std::io::stderr())
        // Output to file
        .chain(log_file)
        .apply()
        .expect("Failed to initialize logging");
}

/// Tauri command to import a save file
///
/// # Arguments
/// * `file_path` - Path to the ZIP save file
/// * `pool` - Database connection pool from Tauri state
///
/// # Returns
/// ImportResult with success status and match_id
#[tauri::command]
async fn import_save_file_cmd(
    file_path: String,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<ImportResult, String> {
    // Import save file using pooled connection (single-file import, no intra-file progress)
    pool.with_connection(|conn| {
        parser::import_save_file(&file_path, conn, None, None, None, None, None)
    })
    .context("Import failed")
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_game_statistics(
    collection_id: Option<i32>,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<GameStatistics, String> {
    pool.with_connection(|conn| Ok(db::queries::games::get_game_statistics(conn, collection_id)?))
        .context("Failed to get game statistics")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_save_dates(
    collection_id: Option<i32>,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<SaveDateEntry>, String> {
    pool.with_connection(|conn| Ok(db::queries::games::get_save_dates(conn, collection_id)?))
        .context("Failed to get save dates")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_games_list(
    collection_id: Option<i32>,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<GameInfo>, String> {
    pool.with_connection(|conn| Ok(db::queries::games::get_games_list(conn, collection_id)?))
        .context("Failed to get games list")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_game_details(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<GameDetails, String> {
    pool.with_connection(|conn| Ok(db::queries::match_data::get_game_details(conn, match_id)?))
        .context("Failed to get game details")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_player_history(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<PlayerHistory>, String> {
    pool.with_connection(|conn| Ok(db::queries::history::get_player_history(conn, match_id)?))
        .context("Failed to get player history")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_yield_history(
    match_id: i64,
    yield_types: Vec<String>,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<YieldHistory>, String> {
    pool.with_connection(|conn| {
        Ok(db::queries::history::get_yield_history(conn, match_id, &yield_types)?)
    })
    .context("Failed to get yield history")
    .map_err(|e| e.to_string())
}

/// Tauri command to import multiple save files from a directory
///
/// Opens a directory picker, finds all .zip files, and imports them with progress tracking
#[tauri::command]
async fn import_directory_cmd(
    app: tauri::AppHandle,
    _pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    // Open directory picker
    let dir_path = app
        .dialog()
        .file()
        .set_title("Select Directory with Save Files")
        .blocking_pick_folder();

    let dir_path = match dir_path {
        Some(path) => path,
        None => return Err("No directory selected".to_string()),
    };

    // Convert FilePath to PathBuf
    let dir_path_buf: PathBuf = dir_path
        .as_path()
        .ok_or("Invalid directory path")?
        .to_path_buf();

    // Find all .zip files in the directory
    let mut save_files: Vec<PathBuf> = std::fs::read_dir(&dir_path_buf)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("zip"))
                .unwrap_or(false)
        })
        .collect();

    // Sort files by name for predictable ordering
    save_files.sort();

    if save_files.is_empty() {
        return Err("No .zip files found in directory".to_string());
    }

    // Spawn thread for actual work to avoid blocking event loop
    std::thread::spawn(move || {
        import_files_batch(save_files, app);
    });

    Ok("Import started".to_string())
}

/// Tauri command to import selected save files
///
/// Opens a file picker (multi-select) and imports selected files with progress tracking
#[tauri::command]
async fn import_files_cmd(
    app: tauri::AppHandle,
    _pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    // Open file picker (multi-select)
    let files = app
        .dialog()
        .file()
        .set_title("Select Save Files to Import")
        .add_filter("Old World Save Files", &["zip"])
        .blocking_pick_files();

    let files = match files {
        Some(files) => files,
        None => return Err("No files selected".to_string()),
    };

    if files.is_empty() {
        return Err("No files selected".to_string());
    }

    // Convert Vec<FilePath> to Vec<PathBuf>
    let files_pathbuf: Vec<PathBuf> = files
        .iter()
        .filter_map(|f| f.as_path().map(|p| p.to_path_buf()))
        .collect();

    // Spawn thread for actual work to avoid blocking event loop
    std::thread::spawn(move || {
        import_files_batch(files_pathbuf, app);
    });

    Ok("Import started".to_string())
}

/// Helper function to import a batch of files with progress tracking
fn import_files_batch(
    files: Vec<PathBuf>,
    app: tauri::AppHandle,
) {
    // Get DbPool from app state
    let pool: tauri::State<db::connection::DbPool> = app.state();
    let total = files.len();
    let start_time = Instant::now();

    let mut successful = 0;
    let mut failed = 0;
    let mut skipped = 0;
    let mut errors: Vec<FileImportError> = Vec::new();

    for (index, file_path) in files.iter().enumerate() {
        let current = index + 1;
        let file_name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        // Calculate progress metrics
        let elapsed = start_time.elapsed();
        let elapsed_ms = elapsed.as_millis() as u64;
        let speed = if elapsed_ms > 0 {
            (current as f64) / (elapsed_ms as f64 / 1000.0)
        } else {
            0.0
        };
        let estimated_remaining_ms = if speed > 0.0 {
            ((total - current) as f64 / speed * 1000.0) as u64
        } else {
            0
        };

        // Import the file
        let result = pool
            .with_connection(|conn| {
                parser::import_save_file(
                    file_path.to_str().unwrap_or(""),
                    conn,
                    Some(&app),
                    Some(current),
                    Some(total),
                    Some(&file_name),
                    Some(start_time),
                )
            })
            .context("Import failed");

        // Process result
        let import_result = match result {
            Ok(res) => {
                if res.success {
                    if res.is_new {
                        successful += 1;
                    } else {
                        skipped += 1;
                    }
                } else {
                    failed += 1;
                    errors.push(FileImportError {
                        file_name: file_name.clone(),
                        error: res.error.clone().unwrap_or_else(|| "Unknown error".to_string()),
                    });
                }
                Some(res)
            }
            Err(e) => {
                failed += 1;
                let error_msg = e.to_string();
                errors.push(FileImportError {
                    file_name: file_name.clone(),
                    error: error_msg,
                });
                None
            }
        };

        // Emit progress event
        let progress = ImportProgress {
            current,
            total,
            current_file: file_name,
            elapsed_ms,
            estimated_remaining_ms,
            speed,
            result: import_result,
            current_phase: None,
            file_progress: Some(1.0), // File is 100% complete
        };

        log::info!("Emitting progress event: {}/{} - {}", current, total, progress.current_file);

        // Emit progress event - don't return error, continue importing
        if let Err(e) = app.emit("import-progress", &progress) {
            log::error!("Failed to emit progress event: {}", e);
        }

        log::info!("Progress event emitted successfully");
    }

    let final_result = BatchImportResult {
        total_files: total,
        successful,
        failed,
        skipped,
        errors,
        duration_ms: start_time.elapsed().as_millis() as u64,
    };

    // Emit completion event
    if let Err(e) = app.emit("import-complete", &final_result) {
        log::error!("Failed to emit completion event: {}", e);
    } else {
        log::info!("Import complete event emitted successfully");
    }
}

/// Test command to validate event emission
///
/// Emits a test event every 5 seconds for 60 seconds
#[tauri::command]
async fn run_event_test(app: tauri::AppHandle) -> Result<String, String> {
    use std::thread;
    use std::time::Duration;

    log::info!("Event test started");

    // Spawn a thread to emit events (commands must be async but emit happens in thread)
    thread::spawn(move || {
        for i in 1..=12 {
            thread::sleep(Duration::from_secs(5));

            let payload = serde_json::json!({
                "iteration": i,
                "message": format!("Event {} of 12", i)
            });

            log::info!("Emitting test event {}/12", i);

            if let Err(e) = app.emit("test-event", &payload) {
                log::error!("Failed to emit event: {}", e);
            } else {
                log::info!("Event {}/12 emitted successfully", i);
            }
        }

        log::info!("Event test completed");
    });

    Ok("Event test started - will emit 12 events over 60 seconds".to_string())
}

#[tauri::command]
async fn get_nation_dynasty_data(
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<NationDynastyRow>, String> {
    pool.with_connection(|conn| Ok(db::queries::admin::get_nation_dynasty_data(conn)?))
        .context("Failed to get nation/dynasty data")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_player_debug_data(
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<PlayerDebugRow>, String> {
    pool.with_connection(|conn| Ok(db::queries::admin::get_player_debug_data(conn)?))
        .context("Failed to get player debug data")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_match_debug_data(
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<MatchDebugRow>, String> {
    pool.with_connection(|conn| Ok(db::queries::admin::get_match_debug_data(conn)?))
        .context("Failed to get match debug data")
        .map_err(|e| e.to_string())
}

/// Tauri command to reset the database
///
/// Drops all tables and recreates the schema using the pooled connection.
/// Table/view names are dynamically extracted from schema.sql to stay in sync.
#[tauri::command]
async fn reset_database_cmd(
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<String, String> {
    log::info!("Database reset requested");

    // Drop all tables/views and recreate schema using the same pooled connection
    pool.with_connection(|conn| {
        // Drop all schema objects (views first, then tables in reverse order)
        db::drop_all_schema_objects(conn)?;

        log::info!("All schema objects dropped, reinitializing schema");

        // Recreate schema using the same connection (avoids connection conflicts)
        db::create_schema(conn)?;

        log::info!("Database reset completed successfully");
        Ok(())
    })
    .context("Failed to reset database")
    .map_err(|e| e.to_string())?;

    Ok("Database reset successfully".to_string())
}

/// Tauri command to recover from database corruption
///
/// Writes a recovery marker and instructs user to restart the app.
/// Actual file deletion happens on next startup to avoid Windows file locking
/// issues where the existing DbPool holds locks on database files.
#[tauri::command]
async fn recover_database(app_handle: tauri::AppHandle) -> Result<String, String> {
    let db_path = db::connection::get_db_path(&app_handle)
        .context("Failed to get database path for recovery")
        .map_err(|e| e.to_string())?;

    log::warn!("Database recovery requested, writing marker for: {:?}", db_path);

    // Write recovery marker - actual deletion happens on next app start
    // This avoids Windows file locking issues where the existing DbPool
    // holds locks on the database files even during recovery
    let recovery_marker = db_path.with_extension("db.recovery");
    std::fs::write(&recovery_marker, "recovery requested")
        .map_err(|e| format!("Failed to write recovery marker: {}", e))?;

    log::info!("Recovery marker written, restart required");

    Ok("Recovery marker written. Please restart the application to complete the database reset.".to_string())
}

#[tauri::command]
async fn get_story_events(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<StoryEvent>, String> {
    pool.with_connection(|conn| Ok(db::queries::match_data::get_story_events(conn, match_id)?))
        .context("Failed to get story events")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_event_logs(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<EventLog>, String> {
    pool.with_connection(|conn| Ok(db::queries::match_data::get_event_logs(conn, match_id)?))
        .context("Failed to get event logs")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn debug_event_log_player_ids(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<String, String> {
    pool.with_connection(|conn| {
        Ok(db::queries::admin::debug_event_log_player_ids(conn, match_id)?)
    })
    .context("Failed to get event log debug data")
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_law_adoption_history(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<LawAdoptionHistory>, String> {
    pool.with_connection(|conn| {
        Ok(db::queries::history::get_law_adoption_history(conn, match_id)?)
    })
    .context("Failed to get law adoption history")
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_current_laws(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<PlayerLaw>, String> {
    pool.with_connection(|conn| Ok(db::queries::match_data::get_current_laws(conn, match_id)?))
        .context("Failed to get current laws")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_tech_discovery_history(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<TechDiscoveryHistory>, String> {
    pool.with_connection(|conn| {
        Ok(db::queries::history::get_tech_discovery_history(conn, match_id)?)
    })
    .context("Failed to get tech discovery history")
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_completed_techs(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<PlayerTech>, String> {
    pool.with_connection(|conn| Ok(db::queries::match_data::get_completed_techs(conn, match_id)?))
        .context("Failed to get completed techs")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_units_produced(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<PlayerUnitProduced>, String> {
    pool.with_connection(|conn| Ok(db::queries::map::get_units_produced(conn, match_id)?))
        .context("Failed to get units produced")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_city_statistics(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<CityStatistics, String> {
    pool.with_connection(|conn| Ok(db::queries::map::get_city_statistics(conn, match_id)?))
        .context("Failed to get city statistics")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_improvement_data(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<ImprovementData, String> {
    pool.with_connection(|conn| Ok(db::queries::map::get_improvement_data(conn, match_id)?))
        .context("Failed to get improvement data")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_map_tiles(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<MapTile>, String> {
    pool.with_connection(|conn| Ok(db::queries::map::get_map_tiles(conn, match_id)?))
        .context("Failed to get map tiles")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_map_tiles_at_turn(
    match_id: i64,
    turn: i32,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<MapTile>, String> {
    pool.with_connection(|conn| {
        Ok(db::queries::map::get_map_tiles_at_turn(conn, match_id, turn)?)
    })
    .context("Failed to get map tiles at turn")
    .map_err(|e| e.to_string())
}

/// Tauri command to get the primary user OnlineID
#[tauri::command]
async fn get_primary_user_online_id(
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Option<String>, String> {
    pool.with_connection(|conn| Ok(db::settings::get_primary_user_online_id(conn)?))
        .context("Failed to get primary user OnlineID")
        .map_err(|e| e.to_string())
}

/// Tauri command to set the primary user OnlineID
///
/// Also reprocesses save owners for all existing matches to fix
/// any multiplayer games that were imported before this was set correctly.
#[tauri::command]
async fn set_primary_user_online_id(
    online_id: String,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<(), String> {
    pool.with_connection(|conn| {
        db::settings::set_primary_user_online_id(conn, &online_id)?;
        db::reprocess_save_owners(conn)?;
        Ok(())
    })
    .context("Failed to set primary user OnlineID")
    .map_err(|e| e.to_string())
}

// ============================================================================
// COLLECTION COMMANDS
// ============================================================================

/// Tauri command to get all collections
#[tauri::command]
async fn get_collections(
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<Collection>, String> {
    pool.with_connection(|conn| Ok(db::collections::get_collections(conn)?))
        .context("Failed to get collections")
        .map_err(|e| e.to_string())
}

/// Tauri command to create a new collection
#[tauri::command]
async fn create_collection(
    pool: tauri::State<'_, db::connection::DbPool>,
    name: String,
) -> Result<Collection, String> {
    pool.with_connection(|conn| Ok(db::collections::create_collection(conn, &name)?))
        .context("Failed to create collection")
        .map_err(|e| e.to_string())
}

/// Tauri command to rename a collection
#[tauri::command]
async fn rename_collection(
    pool: tauri::State<'_, db::connection::DbPool>,
    collection_id: i32,
    name: String,
) -> Result<(), String> {
    pool.with_connection(|conn| Ok(db::collections::rename_collection(conn, collection_id, &name)?))
        .context("Failed to rename collection")
        .map_err(|e| e.to_string())
}

/// Tauri command to delete a collection
///
/// Moves all matches in the deleted collection to the default collection.
#[tauri::command]
async fn delete_collection(
    pool: tauri::State<'_, db::connection::DbPool>,
    collection_id: i32,
) -> Result<(), String> {
    pool.with_connection(|conn| Ok(db::collections::delete_collection(conn, collection_id)?))
        .context("Failed to delete collection")
        .map_err(|e| e.to_string())
}

/// Tauri command to set the default collection
#[tauri::command]
async fn set_default_collection(
    pool: tauri::State<'_, db::connection::DbPool>,
    collection_id: i32,
) -> Result<(), String> {
    pool.with_connection(|conn| Ok(db::collections::set_default_collection(conn, collection_id)?))
        .context("Failed to set default collection")
        .map_err(|e| e.to_string())
}

/// Tauri command to move specific matches to a collection
#[tauri::command]
async fn move_matches_to_collection(
    pool: tauri::State<'_, db::connection::DbPool>,
    match_ids: Vec<i64>,
    collection_id: i32,
) -> Result<usize, String> {
    pool.with_connection(|conn| {
        Ok(db::collections::move_matches_to_collection(conn, &match_ids, collection_id)?)
    })
    .context("Failed to move matches")
    .map_err(|e| format!("{:#}", e))
}

/// Tauri command to move matches by game name pattern to a collection
///
/// Uses SQL LIKE pattern matching (% for wildcard).
#[tauri::command]
async fn move_matches_by_game_name(
    pool: tauri::State<'_, db::connection::DbPool>,
    pattern: String,
    collection_id: i32,
) -> Result<usize, String> {
    pool.with_connection(|conn| Ok(db::collections::move_matches_by_game_name(conn, &pattern, collection_id)?))
        .context("Failed to move matches by name")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_known_online_ids(
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<KnownOnlineId>, String> {
    pool.with_connection(|conn| Ok(db::queries::admin::get_known_online_ids(conn)?))
        .context("Failed to get known OnlineIDs")
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    init_logging();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            import_save_file_cmd,
            import_directory_cmd,
            import_files_cmd,
            get_game_statistics,
            get_save_dates,
            get_games_list,
            get_game_details,
            get_player_history,
            get_yield_history,
            get_story_events,
            get_event_logs,
            get_law_adoption_history,
            get_current_laws,
            get_tech_discovery_history,
            get_completed_techs,
            get_units_produced,
            get_city_statistics,
            get_improvement_data,
            get_map_tiles,
            get_map_tiles_at_turn,
            get_nation_dynasty_data,
            get_player_debug_data,
            get_match_debug_data,
            get_primary_user_online_id,
            set_primary_user_online_id,
            get_collections,
            create_collection,
            rename_collection,
            delete_collection,
            set_default_collection,
            move_matches_to_collection,
            move_matches_by_game_name,
            get_known_online_ids,
            run_event_test,
            reset_database_cmd,
            recover_database,
            debug_event_log_player_ids
        ]);

    builder
        .setup(|app| {
            use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

            // Initialize database connection pool
            let db_path = db::connection::get_db_path(app.handle())
                .context("Failed to get database path")
                .map_err(|e| e.to_string())?;

            // Recovery marker file - signals that user requested recovery on previous run
            // We use this to delete database files BEFORE DuckDB opens them, avoiding
            // Windows file locking issues where DuckDB holds locks even after errors
            let recovery_marker = db_path.with_extension("db.recovery");

            // Crash guard marker - written BEFORE opening database, deleted AFTER success
            // If this exists on startup, we crashed during database init (e.g., DuckDB
            // assertion failure from corruption), so we auto-reset the database
            let crash_guard = db_path.with_extension("db.opening");

            // Check for crash guard FIRST - indicates we crashed during last DB open
            if crash_guard.exists() {
                log::warn!("Crash guard found - database likely corrupted, auto-resetting");
                // Remove guard first so we don't loop if deletion fails
                let _ = std::fs::remove_file(&crash_guard);

                match db::delete_database_files(&db_path) {
                    Ok(deleted) => {
                        log::info!(
                            "Auto-recovered from database corruption, deleted {} files",
                            deleted.len()
                        );
                        app.dialog()
                            .message(
                                "Per-Ankh detected database corruption and has automatically reset.\n\n\
                                Your imported games have been cleared.\n\
                                Please re-import your save files to continue.",
                            )
                            .kind(MessageDialogKind::Info)
                            .title("Database Auto-Recovery")
                            .blocking_show();
                    }
                    Err(e) => {
                        log::error!("Failed to auto-recover corrupted database: {}", e);
                        app.dialog()
                            .message(format!(
                                "Database corruption detected but auto-recovery failed: {}\n\n\
                                Please manually delete the database files at:\n{}",
                                e,
                                db_path.display()
                            ))
                            .kind(MessageDialogKind::Error)
                            .title("Auto-Recovery Failed")
                            .blocking_show();
                        return Err("Database auto-recovery failed".into());
                    }
                }
            }

            // Check for recovery marker BEFORE opening database
            if recovery_marker.exists() {
                log::warn!("Recovery marker found, deleting database files");
                // Remove marker first so we don't loop if deletion fails
                let _ = std::fs::remove_file(&recovery_marker);

                match db::delete_database_files(&db_path) {
                    Ok(deleted) => {
                        log::info!("Deleted {} database files for recovery", deleted.len());
                        app.dialog()
                            .message("Database has been reset. Your data has been cleared.")
                            .kind(MessageDialogKind::Info)
                            .title("Database Reset Complete")
                            .blocking_show();
                    }
                    Err(e) => {
                        log::error!("Failed to delete database files: {}", e);
                        app.dialog()
                            .message(format!(
                                "Failed to reset database: {}\n\nPlease manually delete the database files at:\n{}",
                                e,
                                db_path.display()
                            ))
                            .kind(MessageDialogKind::Error)
                            .title("Recovery Failed")
                            .blocking_show();
                        return Err("Database recovery failed".into());
                    }
                }
            }

            // Check schema version BEFORE opening DuckDB
            // This prevents crashes from incompatible database files
            if db::needs_schema_reset(&db_path) {
                log::warn!(
                    "Schema version incompatible or missing, resetting database (current: {})",
                    db::CURRENT_SCHEMA_VERSION
                );

                match db::delete_database_files(&db_path) {
                    Ok(deleted) => {
                        log::info!("Deleted {} database files for schema upgrade", deleted.len());
                        app.dialog()
                            .message(format!(
                                "Per-Ankh has been updated with performance improvements that require a fresh database.\n\n\
                                Your previously imported games have been cleared.\n\
                                Please re-import your save files to continue.\n\n\
                                (Schema version: {})",
                                db::CURRENT_SCHEMA_VERSION
                            ))
                            .kind(MessageDialogKind::Info)
                            .title("Database Upgrade")
                            .blocking_show();
                    }
                    Err(e) => {
                        log::error!("Failed to delete database files for upgrade: {}", e);
                        app.dialog()
                            .message(format!(
                                "Failed to upgrade database: {}\n\nPlease manually delete:\n{}",
                                e,
                                db_path.display()
                            ))
                            .kind(MessageDialogKind::Error)
                            .title("Upgrade Failed")
                            .blocking_show();
                        return Err("Database upgrade failed".into());
                    }
                }
            }

            // Write crash guard BEFORE opening database
            // If we crash during DuckDB init (assertion failure from corruption),
            // this marker will trigger auto-recovery on next startup
            if let Err(e) = std::fs::write(&crash_guard, "opening database") {
                log::warn!("Failed to write crash guard: {}", e);
                // Continue anyway - crash guard is just a safety net
            }

            // Create connection pool FIRST - ensures all DB operations use consistent
            // checkpoint settings (1GB threshold). This prevents index corruption that
            // occurred when schema init used default settings and imports used high threshold.
            let pool = db::connection::DbPool::new(&db_path)
                .context("Failed to create connection pool")
                .map_err(|e| e.to_string())?;

            // Initialize schema using the pool's connection (unified connection management)
            // This ensures schema creation and imports use the same checkpoint settings
            let schema_result = pool.with_connection(|conn| db::ensure_schema_ready(conn));

            // Remove crash guard - we didn't crash, so remove the marker
            // Do this whether we succeeded or got a Rust error (only crashes leave it)
            let _ = std::fs::remove_file(&crash_guard);

            if let Err(e) = schema_result {
                log::error!("Database initialization failed: {}", e);

                // Truncate error message for dialog - full error is in logs
                // DuckDB errors can include huge stack traces that overflow the dialog
                let error_str = e.to_string();
                let truncated_error: String = error_str
                    .lines()
                    .take(3) // First 3 lines contain the useful info
                    .collect::<Vec<_>>()
                    .join("\n");
                let display_error = if truncated_error.len() > 300 {
                    format!("{}...", &truncated_error[..300])
                } else if error_str.lines().count() > 3 {
                    format!("{}...", truncated_error)
                } else {
                    truncated_error
                };

                let confirmed = app.dialog()
                    .message(format!(
                        "Database initialization failed:\n{}\n\nWould you like to reset the database? All existing data will be lost.\n\nClick OK to reset, or Cancel to quit.",
                        display_error
                    ))
                    .kind(MessageDialogKind::Error)
                    .title("Database Error")
                    .buttons(MessageDialogButtons::OkCancel)
                    .blocking_show();

                if confirmed {
                    log::warn!("User requested database recovery, writing marker for next restart");
                    // Write recovery marker - actual deletion happens on next app start
                    // This avoids Windows file locking issues where DuckDB holds locks
                    // even after Connection::open() fails during WAL replay
                    if let Err(e) = std::fs::write(&recovery_marker, "recovery requested") {
                        log::error!("Failed to write recovery marker: {}", e);
                    }

                    app.dialog()
                        .message("Please restart the application to complete the database reset.")
                        .kind(MessageDialogKind::Info)
                        .title("Restart Required")
                        .blocking_show();

                    return Err("Database recovery pending - please restart".into());
                } else {
                    log::info!("User declined recovery, exiting");
                    return Err("Database initialization failed".into());
                }
            }

            // Write version file after successful schema initialization
            // This ensures future startups know the database is compatible
            if let Err(e) = db::write_schema_version(&db_path, None) {
                log::warn!("Failed to write schema version file: {}", e);
                // Non-fatal - database still works, just won't have version tracking
            }

            // Clean up stale locks
            pool.with_connection(|conn| db::connection::cleanup_stale_locks(conn))
                .context("Failed to cleanup stale locks")
                .map_err(|e| e.to_string())?;

            // Store pool in Tauri state
            app.handle().manage(pool);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
