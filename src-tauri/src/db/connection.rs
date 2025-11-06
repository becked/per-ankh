// DuckDB connection management
//
// Handles database file location and connection pooling

use crate::parser::{ParseError, Result};
use duckdb::Connection;
use std::path::PathBuf;
use tauri::Manager;

/// Get the database file path in the user's data directory
///
/// Uses Tauri's app_data_dir for cross-platform compatibility
/// In debug builds, uses local per-ankh.db for development
pub fn get_db_path(app_handle: &tauri::AppHandle) -> Result<PathBuf> {
    // In debug mode, use local database for development
    #[cfg(debug_assertions)]
    {
        let local_db = PathBuf::from("per-ankh.db");
        if local_db.exists() {
            log::info!("Using local database: {:?}", local_db);
            return Ok(local_db);
        }
    }

    // Production: use app data directory
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| ParseError::IoError(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("Failed to get app data dir: {}", e),
        )))?;

    // Create directory if it doesn't exist
    std::fs::create_dir_all(&app_data_dir)?;

    Ok(app_data_dir.join("per-ankh.db"))
}

/// Open a connection to the DuckDB database
///
/// Creates the database file if it doesn't exist
pub fn get_connection(db_path: &PathBuf) -> Result<Connection> {
    let conn = Connection::open(db_path)?;

    // DuckDB handles concurrency internally, no need for WAL mode configuration

    Ok(conn)
}

/// Clean up stale locks (locks held > 10 minutes, likely from crashed process)
pub fn cleanup_stale_locks(conn: &Connection) -> Result<usize> {
    let deleted = conn.execute(
        "DELETE FROM match_locks
         WHERE locked_at < CAST(now() AS TIMESTAMP) - INTERVAL 10 MINUTES",
        [],
    )?;

    if deleted > 0 {
        log::warn!("Cleaned up {} stale import locks", deleted);
    }
    Ok(deleted)
}
