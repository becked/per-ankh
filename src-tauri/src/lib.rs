// Old World Save Game Parser
//
// Modules:
// - db: Database connection and schema management
// - parser: ZIP extraction, XML parsing, ID mapping

pub mod db;
pub mod parser;

use parser::ImportResult;
use serde::Serialize;

#[derive(Serialize)]
pub struct NationStats {
    pub nation: String,
    pub games_played: i64,
}

#[derive(Serialize)]
pub struct GameStatistics {
    pub total_games: i64,
    pub nations: Vec<NationStats>,
}

#[derive(Serialize)]
pub struct GameInfo {
    pub match_id: i64,
    pub game_name: Option<String>,
    pub save_date: Option<String>,
    pub turn_year: Option<i32>,
}

// Initialize logging
fn init_logging() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .init();
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Tauri command to import a save file
///
/// # Arguments
/// * `file_path` - Path to the ZIP save file
/// * `app_handle` - Tauri app handle for accessing app data directory
///
/// # Returns
/// ImportResult with success status and match_id
#[tauri::command]
async fn import_save_file_cmd(
    file_path: String,
    app_handle: tauri::AppHandle,
) -> Result<ImportResult, String> {
    // Get database path
    let db_path = db::connection::get_db_path(&app_handle)
        .map_err(|e| format!("Failed to get database path: {}", e))?;

    // Ensure schema is ready
    db::ensure_schema_ready(&db_path)
        .map_err(|e| format!("Failed to initialize schema: {}", e))?;

    // Open connection
    let conn = db::connection::get_connection(&db_path)
        .map_err(|e| format!("Failed to connect to database: {}", e))?;

    // Clean up stale locks
    db::connection::cleanup_stale_locks(&conn)
        .map_err(|e| format!("Failed to cleanup stale locks: {}", e))?;

    // Import save file
    let result = parser::import_save_file(&file_path, &conn)
        .map_err(|e| format!("Import failed: {}", e))?;

    Ok(result)
}

/// Tauri command to get game statistics
///
/// Returns total number of games and nation play counts
#[tauri::command]
async fn get_game_statistics(app_handle: tauri::AppHandle) -> Result<GameStatistics, String> {
    // Get database path
    let db_path = db::connection::get_db_path(&app_handle)
        .map_err(|e| format!("Failed to get database path: {}", e))?;

    // Open connection
    let conn = db::connection::get_connection(&db_path)
        .map_err(|e| format!("Failed to connect to database: {}", e))?;

    // Get total games count
    let total_games: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT match_id) FROM players",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to get total games: {}", e))?;

    // Get nation statistics
    let mut stmt = conn
        .prepare("SELECT nation, COUNT(DISTINCT match_id) as games_played FROM players WHERE nation IS NOT NULL GROUP BY nation ORDER BY games_played DESC")
        .map_err(|e| format!("Failed to prepare nation query: {}", e))?;

    let nations = stmt
        .query_map([], |row| {
            Ok(NationStats {
                nation: row.get(0)?,
                games_played: row.get(1)?,
            })
        })
        .map_err(|e| format!("Failed to query nations: {}", e))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect nations: {}", e))?;

    Ok(GameStatistics {
        total_games,
        nations,
    })
}

/// Tauri command to get list of all games
///
/// Returns list of games with basic info sorted by save date (newest first)
#[tauri::command]
async fn get_games_list(app_handle: tauri::AppHandle) -> Result<Vec<GameInfo>, String> {
    // Get database path
    let db_path = db::connection::get_db_path(&app_handle)
        .map_err(|e| format!("Failed to get database path: {}", e))?;

    // Open connection
    let conn = db::connection::get_connection(&db_path)
        .map_err(|e| format!("Failed to connect to database: {}", e))?;

    // Get all games ordered by save_date (newest first)
    let mut stmt = conn
        .prepare(
            "SELECT match_id, game_name, CAST(save_date AS VARCHAR) as save_date
             FROM matches
             ORDER BY save_date DESC"
        )
        .map_err(|e| format!("Failed to prepare games query: {}", e))?;

    let games = stmt
        .query_map([], |row| {
            Ok(GameInfo {
                match_id: row.get(0)?,
                game_name: row.get(1)?,
                save_date: row.get(2)?,
                turn_year: None,
            })
        })
        .map_err(|e| format!("Failed to query games: {}", e))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect games: {}", e))?;

    Ok(games)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            import_save_file_cmd,
            get_game_statistics,
            get_games_list
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
