// DuckDB connection management
//
// Handles database file location and connection pooling
//
// ## Database Query Standards
//
// All database queries MUST use parameterized queries to prevent SQL injection.
// Follow these patterns consistently:
//
// ### INSERT/UPDATE/DELETE queries
// Use `execute()` with parameterized values via `params![]` macro:
// ```rust
// conn.execute(
//     "INSERT INTO table (col1, col2) VALUES (?, ?)",
//     params![value1, value2]
// )?;
// ```
//
// ### SELECT queries returning single row
// Use `query_row()` with parameterized values:
// ```rust
// let result = conn.query_row(
//     "SELECT * FROM table WHERE id = ?",
//     [id],
//     |row| Ok((row.get(0)?, row.get(1)?))
// )?;
// ```
//
// ### SELECT queries returning multiple rows
// Use `prepare()` followed by `query_map()`:
// ```rust
// let mut stmt = conn.prepare("SELECT * FROM table WHERE status = ?")?;
// let items = stmt.query_map([status], |row| {
//     Ok(Item {
//         id: row.get(0)?,
//         name: row.get(1)?,
//     })
// })?
// .collect::<std::result::Result<Vec<_>, _>>()?;
// ```
//
// ### Table/column names (CANNOT be parameterized)
// SQL does not allow parameterizing identifiers (table/column names).
// When necessary, use `format!()` with a hardcoded whitelist:
// ```rust
// let allowed_tables = vec!["users", "posts", "comments"];
// if allowed_tables.contains(&table_name) {
//     let query = format!("SELECT COUNT(*) FROM {}", table_name);
//     // Add comment explaining why this is safe
// }
// ```
//
// ### DO NOT use string interpolation for values
// ❌ NEVER: `format!("SELECT * FROM users WHERE id = {}", user_id)`
// ✅ ALWAYS: `conn.query_row("SELECT * FROM users WHERE id = ?", [user_id], ...)`

use crate::parser::{ParseError, Result};
use duckdb::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

/// Thread-safe connection pool for DuckDB
/// DuckDB doesn't have a traditional connection pool, so we use a single
/// connection wrapped in a Mutex for thread-safe access
///
/// Implements Drop to ensure WAL is checkpointed before connection closes.
/// This prevents WAL corruption that can occur when the app closes without
/// flushing pending writes (especially on Windows).
pub struct DbPool {
    connection: Mutex<Connection>,
}

impl Drop for DbPool {
    fn drop(&mut self) {
        // Checkpoint WAL before closing to prevent corruption on restart
        // Without this, an abrupt app close can leave the WAL in an inconsistent
        // state, causing "Failure while replaying WAL file" errors on Windows
        if let Ok(conn) = self.connection.lock() {
            if let Err(e) = conn.execute_batch("CHECKPOINT") {
                log::error!("Failed to checkpoint on close: {}", e);
            } else {
                log::info!("Database checkpointed on close");
            }
        }
    }
}

impl DbPool {
    /// Create a new connection pool with a single connection
    pub fn new(db_path: &PathBuf) -> Result<Self> {
        let connection = get_connection(db_path)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    /// Execute a function with access to the database connection
    pub fn with_connection<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Connection) -> Result<T>,
    {
        let conn = self.connection.lock().map_err(|e| {
            ParseError::IoError(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Failed to acquire connection lock: {}", e),
            ))
        })?;
        f(&conn)
    }
}

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
/// Creates the database file if it doesn't exist.
/// Uses DuckDB default checkpoint settings (16MB threshold) for reliability.
/// Previous optimization with 1GB threshold caused index corruption (issue #13).
pub fn get_connection(db_path: &PathBuf) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    // Use DuckDB defaults for checkpoint settings - high thresholds caused index corruption
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
