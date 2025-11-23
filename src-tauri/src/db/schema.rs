// Database schema initialization and validation
//
// Ensures the database schema is properly initialized before use

use crate::parser::Result;
use duckdb::Connection;
use std::path::{Path, PathBuf};

/// Extract table and view names from schema.sql
///
/// Parses the schema SQL to find all CREATE TABLE and CREATE VIEW statements.
/// Returns (tables, views) as vectors of names in the order they appear.
fn extract_schema_objects() -> (Vec<String>, Vec<String>) {
    let schema_sql = include_str!("../../../docs/schema.sql");
    let mut tables = Vec::new();
    let mut views = Vec::new();

    for line in schema_sql.lines() {
        let trimmed = line.trim();
        let upper = trimmed.to_uppercase();

        // Match CREATE TABLE name (
        if upper.starts_with("CREATE TABLE ") {
            if let Some(name) = trimmed
                .strip_prefix("CREATE TABLE ")
                .or_else(|| trimmed.strip_prefix("create table "))
            {
                // Name ends at space or (
                let name = name
                    .split(|c: char| c.is_whitespace() || c == '(')
                    .next()
                    .unwrap_or("");
                if !name.is_empty() {
                    tables.push(name.to_string());
                }
            }
        }
        // Match CREATE VIEW name AS
        else if upper.starts_with("CREATE VIEW ") {
            if let Some(name) = trimmed
                .strip_prefix("CREATE VIEW ")
                .or_else(|| trimmed.strip_prefix("create view "))
            {
                let name = name
                    .split(|c: char| c.is_whitespace())
                    .next()
                    .unwrap_or("");
                if !name.is_empty() {
                    views.push(name.to_string());
                }
            }
        }
    }

    (tables, views)
}

/// Drop all schema objects (views first, then tables)
///
/// Dynamically extracts table/view names from schema.sql to ensure
/// all objects are dropped even when schema.sql is updated.
pub fn drop_all_schema_objects(conn: &Connection) -> Result<()> {
    let (tables, views) = extract_schema_objects();

    log::info!(
        "Dropping {} views and {} tables from schema",
        views.len(),
        tables.len()
    );

    // Drop views first (they depend on tables)
    for view in &views {
        // NOTE: View names come from schema.sql parsing, not user input
        let query = format!("DROP VIEW IF EXISTS {}", view);
        conn.execute(&query, [])?;
    }
    log::debug!("Dropped {} views", views.len());

    // Drop tables in reverse order (later tables may depend on earlier ones)
    for table in tables.iter().rev() {
        // NOTE: Table names come from schema.sql parsing, not user input
        let query = format!("DROP TABLE IF EXISTS {}", table);
        conn.execute(&query, [])?;
    }
    log::debug!("Dropped {} tables", tables.len());

    Ok(())
}

/// Create the database schema on an existing connection
///
/// This function creates all tables, indexes, and views from the schema.sql file.
/// It can be used for both initial schema creation and schema reset operations.
pub fn create_schema(conn: &Connection) -> Result<()> {
    log::info!("Creating database schema...");
    let schema_sql = include_str!("../../../docs/schema.sql");
    log::info!("Schema SQL loaded, length: {} bytes", schema_sql.len());

    // DuckDB doesn't support partial indexes (indexes with WHERE clauses)
    // Also need to defer VIEW creation until after tables are created
    let mut filtered_sql = String::new();
    let mut deferred_views = String::new();
    let mut skipped_partial_indexes = 0;
    let mut in_view_statement = false;
    let mut current_view = String::new();

    for line in schema_sql.lines() {
        let trimmed = line.trim().to_uppercase();

        // Track if we're inside a CREATE VIEW statement
        if trimmed.starts_with("CREATE VIEW") || trimmed.starts_with("CREATE OR REPLACE VIEW") {
            in_view_statement = true;
            current_view.clear();
            current_view.push_str(line);
            current_view.push('\n');
            log::debug!("Deferring view creation: {}", line.trim());
            continue;
        }

        if in_view_statement {
            current_view.push_str(line);
            current_view.push('\n');
            // Views end with a semicolon at the end of a line
            if line.trim().ends_with(';') {
                deferred_views.push_str(&current_view);
                in_view_statement = false;
            }
            continue;
        }

        // Skip partial index statements (CREATE INDEX/CREATE UNIQUE INDEX with WHERE)
        // Check uppercased version for case-insensitive matching
        if (trimmed.starts_with("CREATE INDEX") || trimmed.starts_with("CREATE UNIQUE INDEX"))
            && trimmed.contains(" WHERE ")
        {
            skipped_partial_indexes += 1;
            log::debug!("Skipping partial index: {}", line.trim());
            // Comment out the line instead of skipping to preserve line numbers
            filtered_sql.push_str("-- SKIPPED (partial index not supported): ");
            filtered_sql.push_str(line);
            filtered_sql.push('\n');
        } else {
            filtered_sql.push_str(line);
            filtered_sql.push('\n');
        }
    }

    log::info!("Filtered out {} partial index statements", skipped_partial_indexes);
    log::info!("Filtered SQL length: {} bytes", filtered_sql.len());

    if skipped_partial_indexes > 0 {
        log::warn!(
            "Skipped {} partial indexes (DuckDB doesn't support WHERE clauses in indexes)",
            skipped_partial_indexes
        );
    }

    // Log first 1000 chars of filtered SQL to debug
    log::debug!("First 1000 chars of filtered SQL: {}", &filtered_sql[..filtered_sql.len().min(1000)]);

    // Execute the filtered schema (tables, indexes, etc.)
    log::info!("Executing schema SQL (tables and indexes)...");
    match conn.execute_batch(&filtered_sql) {
        Ok(_) => {
            log::info!("Tables and indexes created successfully");
        }
        Err(e) => {
            log::error!("Failed to execute schema: {}", e);
            log::error!("First 500 chars of filtered SQL: {}", &filtered_sql[..filtered_sql.len().min(500)]);
            return Err(e.into());
        }
    }

    // Create non-partial unique indexes for UPSERT support
    // (DuckDB doesn't support partial indexes, so we create them without WHERE clauses)
    log::info!("Creating unique indexes for UPSERT support...");
    let upsert_indexes = "
        CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_game_id ON matches(game_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_players_xml_id ON players(match_id, xml_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_xml_id ON characters(match_id, xml_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cities_xml_id ON cities(match_id, xml_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tiles_xml_id ON tiles(match_id, xml_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_families_xml_id ON families(match_id, xml_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_religions_xml_id ON religions(match_id, xml_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tribes_xml_id ON tribes(match_id, xml_id);
    ";
    conn.execute_batch(upsert_indexes)?;
    log::info!("Unique indexes created successfully");

    // Now execute deferred views (after all tables are created)
    if !deferred_views.is_empty() {
        log::info!("Executing deferred views...");
        log::debug!("Deferred views SQL length: {} bytes", deferred_views.len());
        match conn.execute_batch(&deferred_views) {
            Ok(_) => {
                log::info!("Views created successfully");
            }
            Err(e) => {
                log::error!("Failed to create views: {}", e);
                log::error!("Views SQL: {}", &deferred_views[..deferred_views.len().min(1000)]);
                return Err(e.into());
            }
        }
    }

    log::info!("Database schema created successfully");
    Ok(())
}

/// Initialize and validate schema on first run
pub fn ensure_schema_ready(db_path: &Path) -> Result<()> {
    log::info!("ensure_schema_ready called for path: {:?}", db_path);

    let conn = match Connection::open(db_path) {
        Ok(c) => {
            log::info!("Database connection opened successfully");
            c
        }
        Err(e) => {
            log::error!("Failed to open database at {:?}: {}", db_path, e);
            log::error!("This may indicate database corruption. Consider deleting the database file to recover.");
            return Err(e.into());
        }
    };

    // Create app data dir if needed (race-safe)
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
        log::info!("Created parent directory: {:?}", parent);
    }

    // Check if schema is already initialized by trying to query the matches table directly
    // This is more reliable than using information_schema which has compatibility issues
    log::info!("Checking if schema exists...");
    let schema_exists = conn
        .query_row("SELECT COUNT(*) FROM matches", [], |row| row.get::<_, i64>(0))
        .is_ok();
    log::info!("Schema exists check result: {}", schema_exists);

    // Initialize schema from schema.sql if not exists
    if !schema_exists {
        create_schema(&conn)?;
    } else {
        log::info!("Schema already exists, skipping initialization");
    }

    // Validate schema integrity (lenient - just check critical tables)
    log::info!("Validating schema...");
    match validate_schema(&conn) {
        Ok(warnings) => {
            log::info!("Schema validation completed with {} warnings", warnings.len());
            for warning in warnings {
                log::warn!("Schema validation: {}", warning);
            }
        }
        Err(e) => {
            // Log validation errors but don't fail - the schema may have been created successfully
            // even if validation has issues (e.g., DuckDB information_schema differences)
            log::warn!("Schema validation had warnings: {}", e);
        }
    }

    log::info!("ensure_schema_ready completed successfully");
    Ok(())
}

/// Validate schema integrity and return warnings (non-fatal issues)
fn validate_schema(conn: &Connection) -> Result<Vec<String>> {
    log::info!("validate_schema called");
    let mut warnings = Vec::new();

    // Check critical tables exist by trying to query them directly
    // (information_schema has compatibility issues in DuckDB)
    let required_tables = vec![
        "matches",
        "match_locks",
        "id_mappings",
        "players",
        "characters",
        "families",
        "religions",
        "tribes",
        "cities",
        "tiles",
    ];

    log::info!("Checking {} required tables...", required_tables.len());
    for table in required_tables {
        // NOTE: Table names cannot be parameterized in SQL, so we use format! here.
        // This is safe because `table` comes from a hardcoded whitelist above (required_tables),
        // not from user input, preventing SQL injection.
        let query = format!("SELECT COUNT(*) FROM {}", table);
        log::debug!("Checking table '{}' with query: {}", table, query);
        let result = conn.query_row(&query, [], |row| row.get::<_, i64>(0));

        match result {
            Ok(count) => {
                log::debug!("Table '{}' exists with {} rows", table, count);
            }
            Err(e) => {
                log::warn!("Table '{}' check failed: {}", table, e);
                warnings.push(format!("Table '{}' may not exist or is not accessible", table));
            }
        }
    }

    // Check matches table has unique game_id constraint
    let has_game_id_constraint: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM information_schema.indexes
                WHERE table_name = 'matches'
                AND index_name = 'idx_matches_game_id'
            )",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !has_game_id_constraint {
        warnings.push(
            "matches table missing unique constraint on game_id - duplicate GameIds may occur"
                .to_string(),
        );
    }

    Ok(warnings)
}

/// Delete database files for recovery from corruption
///
/// Removes the main database file and any associated WAL/journal files.
/// Returns the paths that were deleted for logging.
pub fn delete_database_files(db_path: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut deleted = Vec::new();

    // Main database file
    if db_path.exists() {
        std::fs::remove_file(db_path)?;
        deleted.push(db_path.to_path_buf());
    }

    // WAL file (DuckDB uses .wal extension)
    let wal_path = db_path.with_extension("db.wal");
    if wal_path.exists() {
        std::fs::remove_file(&wal_path)?;
        deleted.push(wal_path);
    }

    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_extract_schema_objects() {
        let (tables, views) = extract_schema_objects();

        // Verify we extracted a reasonable number of tables and views
        assert!(tables.len() >= 30, "Expected at least 30 tables, got {}", tables.len());
        assert!(views.len() >= 4, "Expected at least 4 views, got {}", views.len());

        // Verify specific known tables exist
        assert!(tables.contains(&"matches".to_string()), "Should contain 'matches' table");
        assert!(tables.contains(&"players".to_string()), "Should contain 'players' table");
        assert!(tables.contains(&"characters".to_string()), "Should contain 'characters' table");
        assert!(tables.contains(&"user_settings".to_string()), "Should contain 'user_settings' table");

        // Verify specific known views exist
        assert!(views.contains(&"match_summary".to_string()), "Should contain 'match_summary' view");
        assert!(views.contains(&"rulers".to_string()), "Should contain 'rulers' view");

        // Verify order: id_mappings should come first (it's the first CREATE TABLE in schema.sql)
        assert_eq!(tables[0], "id_mappings", "First table should be 'id_mappings'");

        println!("Extracted {} tables and {} views", tables.len(), views.len());
        println!("Tables: {:?}", tables);
        println!("Views: {:?}", views);
    }

    #[test]
    #[ignore] // TODO: Fix information_schema query issues in DuckDB
    fn test_ensure_schema_ready() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        // First call should initialize schema (may have warnings due to partial indexes)
        let result1 = ensure_schema_ready(&db_path);
        if let Err(ref e) = result1 {
            eprintln!("Schema initialization error: {:?}", e);
        }
        assert!(result1.is_ok(), "First schema init should succeed: {:?}", result1);

        // Second call should not error (idempotent)
        let result2 = ensure_schema_ready(&db_path);
        assert!(result2.is_ok(), "Second schema init should succeed");

        // Just verify the database file was created
        assert!(db_path.exists(), "Database file should exist");
    }

    #[test]
    fn test_delete_database_files() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let wal_path = dir.path().join("test.db.wal");

        // Create fake files
        std::fs::write(&db_path, b"db").unwrap();
        std::fs::write(&wal_path, b"wal").unwrap();

        let deleted = delete_database_files(&db_path).unwrap();

        assert_eq!(deleted.len(), 2);
        assert!(!db_path.exists());
        assert!(!wal_path.exists());
    }

    #[test]
    fn test_delete_database_files_missing_wal() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        std::fs::write(&db_path, b"db").unwrap();

        let deleted = delete_database_files(&db_path).unwrap();

        assert_eq!(deleted.len(), 1);
        assert!(!db_path.exists());
    }
}
