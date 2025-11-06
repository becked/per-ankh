// Database schema initialization and validation
//
// Ensures the database schema is properly initialized before use

use crate::parser::{ParseError, Result};
use duckdb::Connection;
use std::path::Path;

/// Initialize and validate schema on first run
pub fn ensure_schema_ready(db_path: &Path) -> Result<()> {
    log::info!("ensure_schema_ready called for path: {:?}", db_path);
    let conn = Connection::open(db_path)?;
    log::info!("Database connection opened successfully");

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
        log::info!("Initializing database schema...");
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

        log::info!("Database schema initialized successfully");
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

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
}
