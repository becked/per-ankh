// Old World Save Game Parser
//
// Modules:
// - db: Database connection and schema management
// - parser: ZIP extraction, XML parsing, ID mapping

pub mod db;
pub mod parser;

use anyhow::Context;
use db::collections::Collection;
use parser::ImportResult;
use serde::Serialize;
use std::path::PathBuf;
use std::time::Instant;
use tauri::{Emitter, Manager};
use ts_rs::TS;

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct NationStats {
    pub nation: String,
    #[ts(type = "number")]
    pub games_played: i64,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct GameStatistics {
    #[ts(type = "number")]
    pub total_games: i64,
    pub nations: Vec<NationStats>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct GameInfo {
    #[ts(type = "number")]
    pub match_id: i64,
    pub game_name: Option<String>,
    pub save_date: Option<String>,
    pub turn_year: Option<i32>,
    pub save_owner_nation: Option<String>,
    pub total_turns: Option<i32>,
    pub save_owner_won: Option<bool>,
    pub collection_id: i32,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerInfo {
    pub player_name: String,
    pub nation: Option<String>,
    pub is_human: bool,
    pub legitimacy: Option<i32>,
    pub state_religion: Option<String>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct GameDetails {
    #[ts(type = "number")]
    pub match_id: i64,
    pub game_name: Option<String>,
    pub save_date: Option<String>,
    pub total_turns: i32,
    pub map_size: Option<String>,
    pub map_width: Option<i32>,
    pub map_height: Option<i32>,
    pub map_class: Option<String>,
    pub game_mode: Option<String>,
    pub opponent_level: Option<String>,
    pub difficulty: Option<String>,
    pub victory_conditions: Option<String>,
    pub enabled_mods: Option<String>,
    pub enabled_dlc: Option<String>,
    #[ts(type = "number | null")]
    pub winner_player_id: Option<i64>,
    pub winner_name: Option<String>,
    pub winner_civilization: Option<String>,
    pub winner_victory_type: Option<String>,
    pub players: Vec<PlayerInfo>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerHistoryPoint {
    pub turn: i32,
    pub points: Option<i32>,
    pub military_power: Option<i32>,
    pub legitimacy: Option<i32>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerHistory {
    pub player_id: i32,
    pub player_name: String,
    pub nation: Option<String>,
    pub history: Vec<PlayerHistoryPoint>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct YieldDataPoint {
    pub turn: i32,
    /// Display value (already converted from fixed-point by dividing by 10)
    pub amount: Option<f64>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct YieldHistory {
    pub player_id: i32,
    pub player_name: String,
    pub nation: Option<String>,
    pub yield_type: String,
    pub data: Vec<YieldDataPoint>,
}

/// A single save date entry for the calendar chart
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct SaveDateEntry {
    /// Date in YYYY-MM-DD format
    pub date: String,
    /// Nation the save owner played as (e.g., "NATION_ROME")
    pub nation: Option<String>,
}

#[derive(Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct ImportProgress {
    /// Number of files processed so far
    #[ts(type = "number")]
    pub current: usize,
    /// Total number of files to import
    #[ts(type = "number")]
    pub total: usize,
    /// Name of the file currently being processed
    pub current_file: String,
    /// Milliseconds elapsed since import started
    #[ts(type = "number")]
    pub elapsed_ms: u64,
    /// Estimated milliseconds remaining
    #[ts(type = "number")]
    pub estimated_remaining_ms: u64,
    /// Import speed in files per second
    pub speed: f64,
    /// Result of the current file import (if completed)
    pub result: Option<ImportResult>,
    /// Current parsing phase within the file (e.g., "Parsing characters")
    pub current_phase: Option<String>,
    /// Progress within current file (0.0 to 1.0, where 1.0 = file complete)
    pub file_progress: Option<f64>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct FileImportError {
    pub file_name: String,
    pub error: String,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct BatchImportResult {
    #[ts(type = "number")]
    pub total_files: usize,
    #[ts(type = "number")]
    pub successful: usize,
    #[ts(type = "number")]
    pub failed: usize,
    #[ts(type = "number")]
    pub skipped: usize,
    pub errors: Vec<FileImportError>,
    #[ts(type = "number")]
    pub duration_ms: u64,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct NationDynastyRow {
    pub nation: Option<String>,
    pub dynasty: Option<String>,
    #[ts(type = "number")]
    pub count: i64,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct KnownOnlineId {
    pub online_id: String,
    pub player_names: Vec<String>,
    #[ts(type = "number")]
    pub save_count: i64,
}

/// Tile data for map visualization
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct MapTile {
    pub x: i32,
    pub y: i32,
    pub terrain: Option<String>,
    pub height: Option<String>,
    pub vegetation: Option<String>,
    pub resource: Option<String>,
    pub improvement: Option<String>,
    pub improvement_pillaged: bool,
    pub has_road: bool,
    pub specialist: Option<String>,
    pub tribe_site: Option<String>,
    pub religion: Option<String>,
    /// Resolved from religion -> religions.founder_player_id -> players.nation
    pub religion_founder_nation: Option<String>,
    pub river_w: bool,
    pub river_sw: bool,
    pub river_se: bool,
    /// Resolved from owner_player_id -> players.nation
    pub owner_nation: Option<String>,
    /// Resolved from owner_city_id -> cities.city_name
    pub owner_city: Option<String>,
}

// Initialize logging
fn init_logging() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .init();
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

/// Tauri command to get game statistics
///
/// Returns total number of games and nation play counts
/// Optionally filters by collection_id (None = all games)
#[tauri::command]
async fn get_game_statistics(
    collection_id: Option<i32>,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<GameStatistics, String> {
    pool.with_connection(|conn| {
        // Get total games count
        let total_games: i64 = match collection_id {
            Some(cid) => conn.query_row(
                "SELECT COUNT(*) FROM matches WHERE collection_id = ?",
                [cid],
                |row| row.get(0),
            )?,
            None => conn.query_row(
                "SELECT COUNT(*) FROM matches",
                [],
                |row| row.get(0),
            )?,
        };

        // Get nation statistics - count games per save owner's nation
        // Uses same logic as get_games_list: prefer is_save_owner, fall back to first human player
        let base_query = "SELECT COALESCE(so.nation, fh.nation) as nation, COUNT(*) as games_played
                 FROM matches m
                 LEFT JOIN (
                     SELECT match_id, nation FROM players WHERE is_save_owner = TRUE
                 ) so ON m.match_id = so.match_id
                 LEFT JOIN (
                     SELECT match_id, nation,
                            ROW_NUMBER() OVER (PARTITION BY match_id ORDER BY player_id) as rn
                     FROM players WHERE is_human = TRUE
                 ) fh ON m.match_id = fh.match_id AND fh.rn = 1
                 WHERE COALESCE(so.nation, fh.nation) IS NOT NULL";

        let query = match collection_id {
            Some(_) => format!("{} AND m.collection_id = ? GROUP BY COALESCE(so.nation, fh.nation) ORDER BY games_played DESC", base_query),
            None => format!("{} GROUP BY COALESCE(so.nation, fh.nation) ORDER BY games_played DESC", base_query),
        };

        let mut stmt = conn.prepare(&query)?;

        let nations = match collection_id {
            Some(cid) => stmt
                .query_map([cid], |row| {
                    Ok(NationStats {
                        nation: row.get(0)?,
                        games_played: row.get(1)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?,
            None => stmt
                .query_map([], |row| {
                    Ok(NationStats {
                        nation: row.get(0)?,
                        games_played: row.get(1)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?,
        };

        Ok(GameStatistics {
            total_games,
            nations,
        })
    })
    .context("Failed to get game statistics")
    .map_err(|e| e.to_string())
}

/// Get save dates with nation info for calendar chart
///
/// Returns one entry per save file with date and the save owner's nation
/// Optionally filters by collection_id (None = all games)
#[tauri::command]
async fn get_save_dates(
    collection_id: Option<i32>,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<SaveDateEntry>, String> {
    pool.with_connection(|conn| {
        // Get save dates with nation from save owner
        // Use STRFTIME to normalize to YYYY-MM-DD format
        let base_query = "SELECT STRFTIME(m.save_date, '%Y-%m-%d') as date, p.nation
             FROM matches m
             LEFT JOIN players p ON m.match_id = p.match_id AND p.is_save_owner = TRUE
             WHERE m.save_date IS NOT NULL";

        let query = match collection_id {
            Some(_) => format!("{} AND m.collection_id = ? ORDER BY m.save_date", base_query),
            None => format!("{} ORDER BY m.save_date", base_query),
        };

        let mut stmt = conn.prepare(&query)?;

        let entries = match collection_id {
            Some(cid) => stmt
                .query_map([cid], |row| {
                    Ok(SaveDateEntry {
                        date: row.get(0)?,
                        nation: row.get(1)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?,
            None => stmt
                .query_map([], |row| {
                    Ok(SaveDateEntry {
                        date: row.get(0)?,
                        nation: row.get(1)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?,
        };

        Ok(entries)
    })
    .context("Failed to get save dates")
    .map_err(|e| e.to_string())
}

/// Tauri command to get list of all games
///
/// Returns list of games with basic info sorted by save date (newest first)
/// Optionally filters by collection_id (None = all games)
#[tauri::command]
async fn get_games_list(
    collection_id: Option<i32>,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<GameInfo>, String> {
    pool.with_connection(|conn| {
        // Get all games ordered by save_date (newest first)
        // Join with save owner player (is_save_owner = TRUE) to get their nation and player_id
        // Falls back to first human player's nation when save owner is unknown (e.g., multiplayer
        // saves from opponent's machine where our OnlineID isn't present)
        // Compare winner_player_id with save owner player_id to determine if save owner won
        let base_query = "SELECT m.match_id, m.game_name, CAST(m.save_date AS VARCHAR) as save_date,
                        m.total_turns,
                        COALESCE(so.nation, fh.nation) as nation,
                        CASE
                            WHEN m.winner_player_id IS NULL THEN NULL
                            WHEN so.player_id IS NOT NULL AND m.winner_player_id = so.player_id THEN TRUE
                            WHEN so.player_id IS NOT NULL THEN FALSE
                            ELSE NULL
                        END as save_owner_won,
                        m.collection_id
                 FROM matches m
                 LEFT JOIN (
                     SELECT match_id, nation, player_id
                     FROM players WHERE is_save_owner = TRUE
                 ) so ON m.match_id = so.match_id
                 LEFT JOIN (
                     SELECT match_id, nation, player_id,
                            ROW_NUMBER() OVER (PARTITION BY match_id ORDER BY player_id) as rn
                     FROM players WHERE is_human = TRUE
                 ) fh ON m.match_id = fh.match_id AND fh.rn = 1";

        let query = match collection_id {
            Some(_) => format!("{} WHERE m.collection_id = ? ORDER BY m.save_date DESC", base_query),
            None => format!("{} ORDER BY m.save_date DESC", base_query),
        };

        let mut stmt = conn.prepare(&query)?;

        let games = match collection_id {
            Some(cid) => stmt
                .query_map([cid], |row| {
                    Ok(GameInfo {
                        match_id: row.get(0)?,
                        game_name: row.get(1)?,
                        save_date: row.get(2)?,
                        turn_year: None,
                        total_turns: row.get(3)?,
                        save_owner_nation: row.get(4)?,
                        save_owner_won: row.get(5)?,
                        collection_id: row.get(6)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?,
            None => stmt
                .query_map([], |row| {
                    Ok(GameInfo {
                        match_id: row.get(0)?,
                        game_name: row.get(1)?,
                        save_date: row.get(2)?,
                        turn_year: None,
                        total_turns: row.get(3)?,
                        save_owner_nation: row.get(4)?,
                        save_owner_won: row.get(5)?,
                        collection_id: row.get(6)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?,
        };

        Ok(games)
    })
    .context("Failed to get games list")
    .map_err(|e| e.to_string())
}

/// Tauri command to get detailed information about a specific game
///
/// Returns game details including match info, map info, and player list
#[tauri::command]
async fn get_game_details(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<GameDetails, String> {
    pool.with_connection(|conn| {
        // Get match details with winner and save owner information via LEFT JOINs
        let mut stmt = conn
            .prepare(
                "SELECT m.match_id, m.game_name, CAST(m.save_date AS VARCHAR) as save_date,
                        m.total_turns, m.map_size, m.map_width, m.map_height, m.map_class,
                        m.game_mode, m.opponent_level, m.victory_conditions, m.enabled_mods, m.enabled_dlc,
                        m.winner_player_id,
                        wp.player_name as winner_name,
                        wp.nation as winner_civilization,
                        m.winner_victory_type,
                        so.difficulty as save_owner_difficulty
                 FROM matches m
                 LEFT JOIN players wp ON m.match_id = wp.match_id AND m.winner_player_id = wp.player_id
                 LEFT JOIN players so ON m.match_id = so.match_id AND so.is_save_owner = TRUE
                 WHERE m.match_id = ?"
            )?;

        let game_details = stmt
            .query_row([match_id], |row| {
                Ok(GameDetails {
                    match_id: row.get(0)?,
                    game_name: row.get(1)?,
                    save_date: row.get(2)?,
                    total_turns: row.get(3)?,
                    map_size: row.get(4)?,
                    map_width: row.get(5)?,
                    map_height: row.get(6)?,
                    map_class: row.get(7)?,
                    game_mode: row.get(8)?,
                    opponent_level: row.get(9)?,
                    difficulty: row.get(17)?,
                    victory_conditions: row.get(10)?,
                    enabled_mods: row.get(11)?,
                    enabled_dlc: row.get(12)?,
                    winner_player_id: row.get(13)?,
                    winner_name: row.get(14)?,
                    winner_civilization: row.get(15)?,
                    winner_victory_type: row.get(16)?,
                    players: Vec::new(), // Will be filled below
                })
            })?;

        // Get players for this match
        let mut players_stmt = conn
            .prepare(
                "SELECT player_name, nation, is_human, legitimacy, state_religion
                 FROM players
                 WHERE match_id = ?
                 ORDER BY player_name"
            )?;

        let players = players_stmt
            .query_map([match_id], |row| {
                Ok(PlayerInfo {
                    player_name: row.get(0)?,
                    nation: row.get(1)?,
                    is_human: row.get(2)?,
                    legitimacy: row.get(3)?,
                    state_religion: row.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(GameDetails {
            players,
            ..game_details
        })
    })
    .context("Failed to get game details")
    .map_err(|e| e.to_string())
}

/// Tauri command to get player history data for charts
///
/// Returns time-series data for victory points, military power, and legitimacy
#[tauri::command]
async fn get_player_history(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<PlayerHistory>, String> {
    pool.with_connection(|conn| {
        // Get all players for this match
        let mut players_stmt = conn
            .prepare(
                "SELECT player_id, player_name, nation
                 FROM players
                 WHERE match_id = ?
                 ORDER BY player_name"
            )?;

        let players: Vec<(i32, String, Option<String>)> = players_stmt
            .query_map([match_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut result = Vec::new();

        for (player_id, player_name, nation) in players {
            // Query combined history data using LEFT JOINs to handle sparse data
            let mut history_stmt = conn
                .prepare(
                    "SELECT DISTINCT
                        COALESCE(ph.turn, mh.turn, lh.turn) as turn,
                        ph.points,
                        mh.military_power,
                        lh.legitimacy
                     FROM (SELECT DISTINCT turn FROM points_history WHERE match_id = ? AND player_id = ?
                           UNION SELECT DISTINCT turn FROM military_history WHERE match_id = ? AND player_id = ?
                           UNION SELECT DISTINCT turn FROM legitimacy_history WHERE match_id = ? AND player_id = ?) turns
                     LEFT JOIN points_history ph ON ph.match_id = ? AND ph.player_id = ? AND ph.turn = turns.turn
                     LEFT JOIN military_history mh ON mh.match_id = ? AND mh.player_id = ? AND mh.turn = turns.turn
                     LEFT JOIN legitimacy_history lh ON lh.match_id = ? AND lh.player_id = ? AND lh.turn = turns.turn
                     ORDER BY turn"
                )?;

            let history: Vec<PlayerHistoryPoint> = history_stmt
                .query_map(
                    [match_id, player_id as i64, match_id, player_id as i64, match_id, player_id as i64,
                     match_id, player_id as i64, match_id, player_id as i64, match_id, player_id as i64],
                    |row| {
                        Ok(PlayerHistoryPoint {
                            turn: row.get(0)?,
                            points: row.get(1)?,
                            military_power: row.get(2)?,
                            legitimacy: row.get(3)?,
                        })
                    },
                )?
                .collect::<std::result::Result<Vec<_>, _>>()?;

            // Include nation for player color lookup
            result.push(PlayerHistory {
                player_id,
                player_name,
                nation,
                history,
            });
        }

        Ok(result)
    })
    .context("Failed to get player history")
    .map_err(|e| e.to_string())
}

/// Tauri command to get yield history data for specific yield types
///
/// Returns time-series data for requested yield types (e.g., YIELD_SCIENCE, YIELD_CIVICS)
#[tauri::command]
async fn get_yield_history(
    match_id: i64,
    yield_types: Vec<String>,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<YieldHistory>, String> {
    pool.with_connection(|conn| {
        // Get all players for this match
        let mut players_stmt = conn
            .prepare(
                "SELECT player_id, player_name, nation
                 FROM players
                 WHERE match_id = ?
                 ORDER BY player_name"
            )?;

        let players: Vec<(i32, String, Option<String>)> = players_stmt
            .query_map([match_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut result = Vec::new();

        // For each player and each yield type, get the history
        for (player_id, player_name, nation) in players {
            for yield_type in &yield_types {
                // Query yield history for this player and yield type
                // Convert from fixed-point (divide by 10) to display values
                let mut yield_stmt = conn
                    .prepare(
                        "SELECT turn, amount / 10.0 AS display_amount
                         FROM yield_history
                         WHERE match_id = ? AND player_id = ? AND yield_type = ?
                         ORDER BY turn"
                    )?;

                let params: [&dyn duckdb::ToSql; 3] = [&match_id, &(player_id as i64), &yield_type.as_str()];
                let data: Vec<YieldDataPoint> = yield_stmt
                    .query_map(&params[..], |row| {
                        Ok(YieldDataPoint {
                            turn: row.get(0)?,
                            amount: row.get(1)?,
                        })
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;

                result.push(YieldHistory {
                    player_id,
                    player_name: player_name.clone(),
                    nation: nation.clone(),
                    yield_type: yield_type.clone(),
                    data,
                });
            }
        }

        Ok(result)
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

/// Tauri command to get nation and dynasty data for debugging
///
/// Returns all unique combinations of nation and dynasty values from the database
#[tauri::command]
async fn get_nation_dynasty_data(
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<NationDynastyRow>, String> {
    pool.with_connection(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT nation, dynasty, COUNT(*) as count
                 FROM players
                 GROUP BY nation, dynasty
                 ORDER BY nation, dynasty"
            )?;

        let rows = stmt
            .query_map([], |row| {
                Ok(NationDynastyRow {
                    nation: row.get(0)?,
                    dynasty: row.get(1)?,
                    count: row.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(rows)
    })
    .context("Failed to get nation/dynasty data")
    .map_err(|e| e.to_string())
}

/// Tauri command to get detailed player data per match for debugging
///
/// Returns match_id, nation, and dynasty for all players
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerDebugRow {
    #[ts(type = "number")]
    pub match_id: i64,
    pub player_name: String,
    pub nation: Option<String>,
    pub dynasty: Option<String>,
    pub is_human: bool,
}

#[tauri::command]
async fn get_player_debug_data(
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<PlayerDebugRow>, String> {
    pool.with_connection(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT match_id, player_name, nation, dynasty, is_human
                 FROM players
                 ORDER BY match_id, player_name"
            )?;

        let rows = stmt
            .query_map([], |row| {
                Ok(PlayerDebugRow {
                    match_id: row.get(0)?,
                    player_name: row.get(1)?,
                    nation: row.get(2)?,
                    dynasty: row.get(3)?,
                    is_human: row.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(rows)
    })
    .context("Failed to get player debug data")
    .map_err(|e| e.to_string())
}

/// Tauri command to get match data for debugging
///
/// Returns basic info about all matches in the database
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct MatchDebugRow {
    #[ts(type = "number")]
    pub match_id: i64,
    pub game_id: String,
    pub game_name: Option<String>,
    pub file_name: String,
}

#[tauri::command]
async fn get_match_debug_data(
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<MatchDebugRow>, String> {
    pool.with_connection(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT match_id, game_id, game_name, file_name
                 FROM matches
                 ORDER BY match_id"
            )?;

        let rows = stmt
            .query_map([], |row| {
                Ok(MatchDebugRow {
                    match_id: row.get(0)?,
                    game_id: row.get(1)?,
                    game_name: row.get(2)?,
                    file_name: row.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(rows)
    })
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

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct StoryEvent {
    #[ts(type = "number")]
    pub event_id: i64,
    pub event_type: String,
    pub player_name: String,
    pub occurred_turn: i32,
    pub primary_character_name: Option<String>,
    pub city_name: Option<String>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct EventLog {
    #[ts(type = "number")]
    pub log_id: i64,
    pub log_type: String,
    pub turn: i32,
    pub player_name: Option<String>,
    pub description: Option<String>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct LawAdoptionDataPoint {
    pub turn: i32,
    pub law_count: i32,
    /// The name of the law adopted at this point (None for synthetic start/end points)
    pub law_name: Option<String>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct LawAdoptionHistory {
    pub player_id: i32,
    pub player_name: String,
    pub nation: Option<String>,
    pub data: Vec<LawAdoptionDataPoint>,
}

/// City information for the Cities tab
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct CityInfo {
    #[ts(type = "number")]
    pub city_id: i64,
    pub city_name: String,
    pub owner_nation: Option<String>,
    pub family: Option<String>,
    pub founded_turn: i32,
    pub is_capital: bool,
    pub citizens: i32,
    pub governor_name: Option<String>,
    /// Culture level as string enum (CULTURE_WEAK, CULTURE_DEVELOPING, CULTURE_STRONG, CULTURE_ESTABLISHED, CULTURE_LEGENDARY)
    pub culture_level: Option<String>,
    pub growth_count: i32,
    pub unit_production_count: i32,
    pub specialist_count: i32,
    pub buy_tile_count: i32,
    pub hurry_civics_count: i32,
    pub hurry_money_count: i32,
    pub hurry_training_count: i32,
    pub hurry_population_count: i32,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct CityStatistics {
    pub cities: Vec<CityInfo>,
}

#[tauri::command]
async fn get_story_events(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<StoryEvent>, String> {
    pool.with_connection(|conn| {
        let mut stmt = conn.prepare(
            "SELECT
                se.event_id,
                se.event_type,
                p.player_name,
                se.occurred_turn,
                c.first_name as character_name,
                ci.city_name
             FROM story_events se
             JOIN players p ON se.player_id = p.player_id AND se.match_id = p.match_id
             LEFT JOIN characters c ON se.primary_character_id = c.character_id AND se.match_id = c.match_id
             LEFT JOIN cities ci ON se.city_id = ci.city_id AND se.match_id = ci.match_id
             WHERE se.match_id = ?
             ORDER BY se.occurred_turn DESC, se.event_id DESC
             LIMIT 100"
        )?;

        let events = stmt
            .query_map([match_id], |row| {
                Ok(StoryEvent {
                    event_id: row.get(0)?,
                    event_type: row.get(1)?,
                    player_name: row.get(2)?,
                    occurred_turn: row.get(3)?,
                    primary_character_name: row.get(4)?,
                    city_name: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(events)
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_event_logs(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<EventLog>, String> {
    pool.with_connection(|conn| {
        // Strip markup tags from description for grouping to properly deduplicate
        // events that differ only in player-specific markup (e.g., link IDs)
        let mut stmt = conn.prepare(
            "SELECT
                MIN(el.log_id) as log_id,
                el.log_type,
                el.turn,
                CASE
                    WHEN COUNT(*) > 1 THEN NULL
                    ELSE COALESCE(MAX(p.player_name), 'Player')
                END as player_name,
                MIN(el.description) as description
             FROM event_logs el
             LEFT JOIN players p ON el.player_id = p.player_id AND el.match_id = p.match_id
             WHERE el.match_id = ?
             GROUP BY el.turn, el.log_type, regexp_replace(el.description, '<[^>]*>', '', 'g')
             ORDER BY el.turn DESC, MIN(el.log_id) DESC"
        )?;

        let logs = stmt
            .query_map([match_id], |row| {
                Ok(EventLog {
                    log_id: row.get(0)?,
                    log_type: row.get(1)?,
                    turn: row.get(2)?,
                    player_name: row.get(3)?,
                    description: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(logs)
    })
    .map_err(|e| e.to_string())
}

/// Debug command to investigate player_id mismatch in event_logs
#[tauri::command]
async fn debug_event_log_player_ids(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<String, String> {
    pool.with_connection(|conn| {
        // Get distinct player_ids from event_logs
        let mut stmt = conn.prepare(
            "SELECT DISTINCT player_id FROM event_logs WHERE match_id = ? ORDER BY player_id"
        )?;
        let event_log_ids: Vec<Option<i64>> = stmt
            .query_map([match_id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        // Get player_ids from players table
        let mut stmt = conn.prepare(
            "SELECT player_id, player_name FROM players WHERE match_id = ? ORDER BY player_id"
        )?;
        let players: Vec<(i64, String)> = stmt
            .query_map([match_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        // Get a sample of event_logs with their player_ids
        let mut stmt = conn.prepare(
            "SELECT log_id, turn, log_type, player_id, description
             FROM event_logs
             WHERE match_id = ?
             ORDER BY turn DESC
             LIMIT 10"
        )?;
        let sample_logs: Vec<(i64, i32, String, Option<i64>, Option<String>)> = stmt
            .query_map([match_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut result = format!("=== Debug for match_id {} ===\n\n", match_id);

        result.push_str("Player IDs in event_logs:\n");
        for id in &event_log_ids {
            result.push_str(&format!("  {:?}\n", id));
        }

        result.push_str("\nPlayers in players table:\n");
        for (id, name) in &players {
            result.push_str(&format!("  {} - {}\n", id, name));
        }

        result.push_str("\nSample event logs (last 10):\n");
        for (log_id, turn, log_type, player_id, desc) in &sample_logs {
            result.push_str(&format!(
                "  log_id={}, turn={}, type={}, player_id={:?}, desc={}\n",
                log_id, turn, log_type, player_id,
                desc.as_ref().map(|s| &s[..s.len().min(50)]).unwrap_or("None")
            ));
        }

        Ok(result)
    })
    .map_err(|e| e.to_string())
}

/// Tauri command to get law adoption history for human players
///
/// Returns cumulative law adoption data over time for each human player in the match
#[tauri::command]
async fn get_law_adoption_history(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<LawAdoptionHistory>, String> {
    pool.with_connection(|conn| {
        // Get the final turn number for this match
        let final_turn: i32 = conn.query_row(
            "SELECT total_turns FROM matches WHERE match_id = ?",
            [match_id],
            |row| row.get(0)
        )?;

        // Get all players for this match
        let mut players_stmt = conn
            .prepare(
                "SELECT player_id, player_name, nation
                 FROM players
                 WHERE match_id = ?
                 ORDER BY player_name"
            )?;

        let players: Vec<(i32, String, Option<String>)> = players_stmt
            .query_map([match_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut result = Vec::new();

        for (player_id, player_name, nation) in players {
            // Get ALL law adoption events with their names and running cumulative law class count.
            // This includes switches within the same class (which don't change the count).
            //
            // Note: data1 is NULL because law names (strings) can't be parsed as integers.
            // Instead, we extract the law name from the description field using regex.
            // Description format: "Adopted <link=HELP_LINK,HELP_LAW,LAW_XXX>Name</link>"
            let mut law_stmt = conn
                .prepare(
                    "WITH law_mapping AS (
                        -- Build a mapping of law -> law_category from all imported games
                        SELECT DISTINCT law, law_category FROM laws
                     ),
                     all_law_events AS (
                        -- Extract all law adoption events with law names
                        SELECT
                            e.turn,
                            regexp_extract(e.description, 'HELP_LAW,([A-Z_]+)', 1) as law_name,
                            e.log_id
                        FROM event_logs e
                        WHERE e.match_id = ?
                          AND e.player_id = ?
                          AND e.log_type = 'LAW_ADOPTED'
                          AND e.description IS NOT NULL
                     ),
                     events_with_class AS (
                        -- Join with law mapping to get law classes
                        SELECT
                            ale.turn,
                            ale.law_name,
                            m.law_category,
                            ale.log_id
                        FROM all_law_events ale
                        JOIN law_mapping m ON ale.law_name = m.law
                        WHERE ale.law_name IS NOT NULL
                     ),
                     first_class_adoption AS (
                        -- For each law class, find the first turn it was adopted
                        SELECT law_category, MIN(turn) as first_turn
                        FROM events_with_class
                        GROUP BY law_category
                     ),
                     events_with_cumulative AS (
                        -- For each event, calculate cumulative law classes up to and including that turn
                        SELECT
                            e.turn,
                            e.law_name,
                            e.log_id,
                            (SELECT COUNT(*) FROM first_class_adoption f WHERE f.first_turn <= e.turn) as cumulative_law_classes
                        FROM events_with_class e
                     )
                     SELECT turn, cumulative_law_classes, law_name
                     FROM events_with_cumulative
                     ORDER BY turn, log_id"
                )?;

            let mut data: Vec<LawAdoptionDataPoint> = law_stmt
                .query_map([match_id, player_id as i64], |row| {
                    Ok(LawAdoptionDataPoint {
                        turn: row.get(0)?,
                        law_count: row.get(1)?,
                        law_name: row.get(2)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;

            // Prepend a starting point at turn 0 with 0 laws so the line starts from the origin
            data.insert(0, LawAdoptionDataPoint {
                turn: 0,
                law_count: 0,
                law_name: None,
            });

            // Append an ending point at the final turn to extend the line to the end of the chart
            if let Some(last_point) = data.last() {
                if last_point.turn < final_turn {
                    data.push(LawAdoptionDataPoint {
                        turn: final_turn,
                        law_count: last_point.law_count,
                        law_name: None,
                    });
                }
            }

            result.push(LawAdoptionHistory {
                player_id,
                player_name,
                nation,
                data,
            });
        }

        Ok(result)
    })
    .context("Failed to get law adoption history")
    .map_err(|e| e.to_string())
}

/// Tauri command to get city statistics for a match
///
/// Returns all cities with their metrics for comparison charts
#[tauri::command]
async fn get_city_statistics(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<CityStatistics, String> {
    pool.with_connection(|conn| {
        let mut stmt = conn.prepare(
            "SELECT
                c.city_id,
                c.city_name,
                p.nation as owner_nation,
                c.family,
                c.founded_turn,
                c.is_capital,
                c.citizens,
                gov.first_name as governor_name,
                cc.culture_level,
                c.growth_count,
                c.unit_production_count,
                c.specialist_count,
                c.buy_tile_count,
                c.hurry_civics_count,
                c.hurry_money_count,
                c.hurry_training_count,
                c.hurry_population_count
             FROM cities c
             LEFT JOIN players p ON c.player_id = p.player_id AND c.match_id = p.match_id
             LEFT JOIN characters gov ON c.governor_id = gov.character_id AND c.match_id = gov.match_id
             LEFT JOIN city_culture cc ON c.city_id = cc.city_id AND c.match_id = cc.match_id
                 AND cc.team_id = COALESCE(p.team_id, p.xml_id)
             WHERE c.match_id = ?
             ORDER BY c.city_name"
        )?;

        let cities = stmt
            .query_map([match_id], |row| {
                Ok(CityInfo {
                    city_id: row.get(0)?,
                    city_name: row.get(1)?,
                    owner_nation: row.get(2)?,
                    family: row.get(3)?,
                    founded_turn: row.get(4)?,
                    is_capital: row.get(5)?,
                    citizens: row.get(6)?,
                    governor_name: row.get(7)?,
                    culture_level: row.get(8)?,
                    growth_count: row.get(9)?,
                    unit_production_count: row.get(10)?,
                    specialist_count: row.get(11)?,
                    buy_tile_count: row.get(12)?,
                    hurry_civics_count: row.get(13)?,
                    hurry_money_count: row.get(14)?,
                    hurry_training_count: row.get(15)?,
                    hurry_population_count: row.get(16)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(CityStatistics { cities })
    })
    .context("Failed to get city statistics")
    .map_err(|e| e.to_string())
}

/// Tauri command to get all map tiles for visualization
///
/// Returns tile data with terrain, resources, improvements, and ownership
#[tauri::command]
async fn get_map_tiles(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<MapTile>, String> {
    pool.with_connection(|conn| {
        // Get religion from city_religions table (religion is per-city, not per-tile)
        // If a city has multiple religions, pick the first alphabetically for consistency
        let mut stmt = conn.prepare(
            "SELECT t.x, t.y, t.terrain, t.height, t.vegetation,
                    t.resource, t.improvement, t.improvement_pillaged, t.has_road,
                    t.specialist, t.tribe_site, cr.religion,
                    rp.nation as religion_founder_nation,
                    t.river_w, t.river_sw, t.river_se,
                    p.nation, c.city_name
             FROM tiles t
             LEFT JOIN players p ON t.owner_player_id = p.player_id AND t.match_id = p.match_id
             LEFT JOIN cities c ON t.owner_city_id = c.city_id AND t.match_id = c.match_id
             LEFT JOIN (
                 SELECT city_id, match_id, MIN(religion) as religion
                 FROM city_religions
                 GROUP BY city_id, match_id
             ) cr ON t.owner_city_id = cr.city_id AND t.match_id = cr.match_id
             LEFT JOIN religions r ON cr.religion = r.religion_name AND cr.match_id = r.match_id
             LEFT JOIN players rp ON r.founder_player_id = rp.player_id AND r.match_id = rp.match_id
             WHERE t.match_id = ?
             ORDER BY t.y, t.x"
        )?;

        let tiles = stmt
            .query_map([match_id], |row| {
                Ok(MapTile {
                    x: row.get(0)?,
                    y: row.get(1)?,
                    terrain: row.get(2)?,
                    height: row.get(3)?,
                    vegetation: row.get(4)?,
                    resource: row.get(5)?,
                    improvement: row.get(6)?,
                    improvement_pillaged: row.get::<_, Option<bool>>(7)?.unwrap_or(false),
                    has_road: row.get::<_, Option<bool>>(8)?.unwrap_or(false),
                    specialist: row.get(9)?,
                    tribe_site: row.get(10)?,
                    religion: row.get(11)?,
                    religion_founder_nation: row.get(12)?,
                    river_w: row.get::<_, Option<bool>>(13)?.unwrap_or(false),
                    river_sw: row.get::<_, Option<bool>>(14)?.unwrap_or(false),
                    river_se: row.get::<_, Option<bool>>(15)?.unwrap_or(false),
                    owner_nation: row.get(16)?,
                    owner_city: row.get(17)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(tiles)
    })
    .context("Failed to get map tiles")
    .map_err(|e| e.to_string())
}

/// Tauri command to get map tiles at a specific turn for historical visualization
///
/// Returns tile data with ownership state reconstructed from tile_ownership_history.
/// Improvements and roads are only shown if the tile was owned at the specified turn.
#[tauri::command]
async fn get_map_tiles_at_turn(
    match_id: i64,
    turn: i32,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<MapTile>, String> {
    pool.with_connection(|conn| {
        // Query that reconstructs tile state at a specific turn:
        // - Ownership comes from tile_ownership_history (latest record at or before turn)
        // - Improvements/roads only shown if tile was owned at that turn
        // - Resources, terrain, rivers are always shown (exist from game start)
        // Get religion from city_religions table (religion is per-city, not per-tile)
        // If a city has multiple religions, pick the first alphabetically for consistency
        let mut stmt = conn.prepare(
            "WITH ownership_at_turn AS (
                SELECT tile_id, owner_player_id
                FROM (
                    SELECT tile_id, owner_player_id,
                           ROW_NUMBER() OVER (PARTITION BY tile_id ORDER BY turn DESC) as rn
                    FROM tile_ownership_history
                    WHERE match_id = ? AND turn <= ?
                )
                WHERE rn = 1
            ),
            city_religion AS (
                SELECT city_id, match_id, MIN(religion) as religion
                FROM city_religions
                GROUP BY city_id, match_id
            )
            SELECT t.x, t.y, t.terrain, t.height, t.vegetation,
                   t.resource,
                   -- Only show improvement if tile was owned at this turn
                   CASE WHEN oh.owner_player_id IS NOT NULL THEN t.improvement ELSE NULL END,
                   CASE WHEN oh.owner_player_id IS NOT NULL THEN t.improvement_pillaged ELSE false END,
                   CASE WHEN oh.owner_player_id IS NOT NULL THEN t.has_road ELSE false END,
                   CASE WHEN oh.owner_player_id IS NOT NULL THEN t.specialist ELSE NULL END,
                   t.tribe_site,
                   -- Only show religion if tile was owned at this turn
                   CASE WHEN oh.owner_player_id IS NOT NULL THEN cr.religion ELSE NULL END,
                   CASE WHEN oh.owner_player_id IS NOT NULL THEN rp.nation ELSE NULL END as religion_founder_nation,
                   t.river_w, t.river_sw, t.river_se,
                   p.nation, c.city_name
            FROM tiles t
            LEFT JOIN ownership_at_turn oh ON t.tile_id = oh.tile_id
            LEFT JOIN players p ON oh.owner_player_id = p.player_id AND p.match_id = ?
            LEFT JOIN cities c ON t.owner_city_id = c.city_id AND c.match_id = ? AND c.founded_turn <= ?
            LEFT JOIN city_religion cr ON t.owner_city_id = cr.city_id AND cr.match_id = ?
            LEFT JOIN religions r ON cr.religion = r.religion_name AND r.match_id = ?
            LEFT JOIN players rp ON r.founder_player_id = rp.player_id AND rp.match_id = ?
            WHERE t.match_id = ?
            ORDER BY t.y, t.x"
        )?;

        let tiles = stmt
            .query_map([match_id, turn as i64, match_id, match_id, turn as i64, match_id, match_id, match_id, match_id], |row| {
                Ok(MapTile {
                    x: row.get(0)?,
                    y: row.get(1)?,
                    terrain: row.get(2)?,
                    height: row.get(3)?,
                    vegetation: row.get(4)?,
                    resource: row.get(5)?,
                    improvement: row.get(6)?,
                    improvement_pillaged: row.get::<_, Option<bool>>(7)?.unwrap_or(false),
                    has_road: row.get::<_, Option<bool>>(8)?.unwrap_or(false),
                    specialist: row.get(9)?,
                    tribe_site: row.get(10)?,
                    religion: row.get(11)?,
                    religion_founder_nation: row.get(12)?,
                    river_w: row.get::<_, Option<bool>>(13)?.unwrap_or(false),
                    river_sw: row.get::<_, Option<bool>>(14)?.unwrap_or(false),
                    river_se: row.get::<_, Option<bool>>(15)?.unwrap_or(false),
                    owner_nation: row.get(16)?,
                    owner_city: row.get(17)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(tiles)
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

/// Tauri command to get all known OnlineIDs with player names and save counts
///
/// Returns list of distinct OnlineIDs with aggregated player names, sorted by save count.
/// Only counts saves in the default collection to prevent challenge games from polluting
/// Primary User detection.
#[tauri::command]
async fn get_known_online_ids(
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<KnownOnlineId>, String> {
    pool.with_connection(|conn| {
        // Use string_agg to get comma-separated player names, then split in Rust
        // DuckDB's list() returns a native list type that's harder to deserialize
        // Only count saves in the default collection for Primary User detection
        let mut stmt = conn.prepare(
            "SELECT p.online_id,
                    string_agg(DISTINCT p.player_name, '|||' ORDER BY p.player_name) as player_names,
                    COUNT(*) as save_count
             FROM players p
             JOIN matches m ON p.match_id = m.match_id
             JOIN collections c ON m.collection_id = c.collection_id
             WHERE p.online_id IS NOT NULL
               AND p.online_id != ''
               AND c.is_default = TRUE
             GROUP BY p.online_id
             ORDER BY save_count DESC"
        )?;

        let results = stmt
            .query_map([], |row| {
                let names_str: String = row.get(1)?;
                let player_names: Vec<String> = names_str
                    .split("|||")
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .collect();
                Ok(KnownOnlineId {
                    online_id: row.get(0)?,
                    player_names,
                    save_count: row.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(results)
    })
    .context("Failed to get known OnlineIDs")
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            get_city_statistics,
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
