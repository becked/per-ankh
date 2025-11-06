// Old World Save Game Parser
//
// Modules:
// - db: Database connection and schema management
// - parser: ZIP extraction, XML parsing, ID mapping

pub mod db;
pub mod parser;

use parser::ImportResult;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, import_save_file_cmd])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
