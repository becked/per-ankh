// Database schema initialization and validation
//
// Ensures the database schema is properly initialized before use

use crate::parser::Result;
use duckdb::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Current schema version - increment when schema changes
pub const CURRENT_SCHEMA_VERSION: &str = "2.13.0";

// ============================================================================
// MIGRATION REGISTRY
// ============================================================================

/// A schema migration with version, description, and breaking status.
///
/// Breaking migrations require a database reset because they need data from XML
/// that wasn't previously extracted. Non-breaking migrations can update the schema
/// incrementally without losing existing data.
#[derive(Debug, Clone, Copy)]
pub struct Migration {
    pub version: &'static str,
    pub description: &'static str,
    /// If true, this migration requires re-parsing save files (database reset).
    /// If false, the migration can be applied incrementally to existing data.
    pub is_breaking: bool,
}

/// All schema migrations in version order.
///
/// Each migration represents a schema change. When upgrading from an older version,
/// all migrations newer than the stored version are checked:
/// - If any are breaking → return SchemaUpgrade error (user must reset)
/// - If all are non-breaking → run them in order
///
/// Guidelines for new migrations:
/// - Breaking: New XML fields, changed parsing logic, structural changes needing re-parse
/// - Non-breaking: Add columns with defaults, add tables, add indexes/views, remove columns
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: "2.5.0",
        description: "Add collections table for organizing matches",
        is_breaking: false,
    },
    Migration {
        version: "2.6.0",
        description: "Remove FK constraints for ETL performance",
        is_breaking: true,
    },
    Migration {
        version: "2.7.0",
        description: "Remove invalid city columns",
        is_breaking: true,
    },
    Migration {
        version: "2.8.0",
        description: "Add new city columns from XML",
        is_breaking: true,
    },
    Migration {
        version: "2.9.0",
        description: "Add city_project_counts, city_enemy_agents, city_luxuries tables",
        is_breaking: true,
    },
    Migration {
        version: "2.10.0",
        description: "Add unit tracking tables",
        is_breaking: true,
    },
    Migration {
        version: "2.11.0",
        description: "Fix unit table schema",
        is_breaking: true,
    },
    Migration {
        version: "2.12.0",
        description: "Migration system refactor (no schema changes)",
        is_breaking: false,
    },
    Migration {
        version: "2.13.0",
        description: "Change event_logs data1/data2/data3 from INTEGER to VARCHAR",
        is_breaking: true,
    },
];

/// Parse a semver string like "2.12.0" into (major, minor, patch)
fn parse_version(v: &str) -> Option<(u32, u32, u32)> {
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    Some((
        parts[0].parse().ok()?,
        parts[1].parse().ok()?,
        parts[2].parse().ok()?,
    ))
}

/// Compare two version strings using semver ordering
fn version_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let a = parse_version(a).unwrap_or((0, 0, 0));
    let b = parse_version(b).unwrap_or((0, 0, 0));
    a.cmp(&b)
}

/// Get all migrations that need to be applied to upgrade from `from_version`.
///
/// Returns migrations where migration.version > from_version, in version order.
fn get_pending_migrations(from_version: &str) -> Vec<&'static Migration> {
    MIGRATIONS
        .iter()
        .filter(|m| version_cmp(m.version, from_version) == std::cmp::Ordering::Greater)
        .collect()
}

/// Check if upgrading from `from_version` requires a database reset.
///
/// Returns true if any pending migration is marked as breaking.
fn has_breaking_migration(from_version: &str) -> bool {
    get_pending_migrations(from_version)
        .iter()
        .any(|m| m.is_breaking)
}

/// Check if the database schema has all structural elements of the current version.
///
/// This handles the case where schema.sql was updated with new tables/columns,
/// but the user's database was created before migration records were added.
/// If the structure matches, we just need to update migration records, not reset.
fn is_schema_structurally_current(conn: &Connection) -> bool {
    // Check for key tables/columns introduced in recent versions
    // v2.10.0: units table
    let has_units_table = conn
        .query_row("SELECT 1 FROM units LIMIT 0", [], |_| Ok(()))
        .is_ok();

    // v2.8.0: city columns (governor_turn)
    let has_city_columns = conn
        .query_row(
            "SELECT governor_turn FROM cities LIMIT 0",
            [],
            |_| Ok(()),
        )
        .is_ok();

    // v2.9.0: city_project_counts table
    let has_city_projects = conn
        .query_row("SELECT 1 FROM city_project_counts LIMIT 0", [], |_| Ok(()))
        .is_ok();

    let is_current = has_units_table && has_city_columns && has_city_projects;

    log::debug!(
        "Schema structure check: units={}, city_columns={}, city_projects={} -> {}",
        has_units_table,
        has_city_columns,
        has_city_projects,
        if is_current { "CURRENT" } else { "OUTDATED" }
    );

    is_current
}

/// Update schema_migrations to reflect current version when structure is already current.
///
/// This inserts missing migration records for versions that are structurally present
/// but weren't recorded (because schema.sql was updated before migration tracking).
fn update_migration_records_to_current(conn: &Connection) -> Result<()> {
    for migration in MIGRATIONS {
        let exists = conn
            .query_row(
                "SELECT 1 FROM schema_migrations WHERE version = ?",
                [migration.version],
                |_| Ok(()),
            )
            .is_ok();

        if !exists {
            conn.execute(
                "INSERT INTO schema_migrations (version, description) VALUES (?, ?)",
                [migration.version, migration.description],
            )?;
            log::info!(
                "Recorded migration v{} (structure already present)",
                migration.version
            );
        }
    }
    Ok(())
}

/// Get the highest schema version from the database using proper semver comparison.
///
/// SQL's ORDER BY uses string comparison which incorrectly orders "2.9.0" > "2.10.0".
/// This function fetches all versions and finds the max using semver comparison.
fn get_max_schema_version(conn: &Connection) -> String {
    let mut stmt = match conn.prepare("SELECT version FROM schema_migrations") {
        Ok(s) => s,
        Err(e) => {
            log::warn!("Failed to query schema_migrations: {}", e);
            return "2.0.0".to_string();
        }
    };

    let versions: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    if versions.is_empty() {
        return "2.0.0".to_string();
    }

    versions
        .into_iter()
        .max_by(|a, b| version_cmp(a, b))
        .unwrap_or_else(|| "2.0.0".to_string())
}

/// Get a human-readable description of why a reset is required.
fn get_breaking_migration_reason(from_version: &str) -> String {
    let pending = get_pending_migrations(from_version);
    let breaking: Vec<_> = pending.iter().filter(|m| m.is_breaking).collect();

    if breaking.is_empty() {
        return "Unknown schema change".to_string();
    }

    let first = breaking[0];
    if breaking.len() == 1 {
        format!("v{}: {}", first.version, first.description)
    } else {
        format!(
            "v{} - v{}: {} breaking changes",
            first.version,
            breaking.last().unwrap().version,
            breaking.len()
        )
    }
}

// ============================================================================
// SCHEMA VERSION FILE
// ============================================================================

/// Schema version file metadata
///
/// Stored as JSON in a separate file (e.g., `per-ankh.db.version`) that we can
/// read BEFORE opening DuckDB. This avoids crashes when DuckDB tries to open
/// an incompatible database file.
#[derive(Debug, Serialize, Deserialize)]
pub struct SchemaVersionInfo {
    pub version: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upgraded_from: Option<String>,
}

/// Check if database needs reset based on version file.
///
/// Returns true if:
/// - Database exists but has no version file (legacy database)
/// - Version file is corrupted or unreadable
/// - Upgrading requires breaking migrations
///
/// Returns false if:
/// - No database exists yet (fresh install)
/// - Database is at current version
/// - All pending migrations are non-breaking (can be applied incrementally)
pub fn needs_schema_reset(db_path: &Path) -> bool {
    let version_path = db_path.with_extension("db.version");

    // No version file = needs reset (legacy database or first run)
    if !version_path.exists() {
        // But only if the database file itself exists
        // (first run with no db = no reset needed, just create fresh)
        return db_path.exists();
    }

    // Try to read and parse version file
    match std::fs::read_to_string(&version_path) {
        Ok(contents) => match serde_json::from_str::<SchemaVersionInfo>(&contents) {
            Ok(info) => {
                // Already at current version = no reset needed
                if info.version == CURRENT_SCHEMA_VERSION {
                    return false;
                }

                // Check if any pending migrations are breaking
                if has_breaking_migration(&info.version) {
                    log::info!(
                        "Breaking migration detected: {}",
                        get_breaking_migration_reason(&info.version)
                    );
                    return true;
                }

                // All pending migrations are non-breaking = no reset needed
                // (migrations will be applied in ensure_schema_ready)
                log::info!(
                    "Non-breaking migrations available from v{} to v{}",
                    info.version,
                    CURRENT_SCHEMA_VERSION
                );
                false
            }
            Err(e) => {
                log::warn!("Failed to parse version file: {}", e);
                true // Corrupted version file = reset
            }
        },
        Err(e) => {
            log::warn!("Failed to read version file: {}", e);
            true // Can't read = reset
        }
    }
}

/// Read the stored schema version from the version file, if it exists.
pub fn read_schema_version(db_path: &Path) -> Option<String> {
    let version_path = db_path.with_extension("db.version");
    std::fs::read_to_string(&version_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<SchemaVersionInfo>(&contents).ok())
        .map(|info| info.version)
}

/// Write schema version file after successful initialization
pub fn write_schema_version(db_path: &Path, upgraded_from: Option<&str>) -> std::io::Result<()> {
    let version_path = db_path.with_extension("db.version");

    let info = SchemaVersionInfo {
        version: CURRENT_SCHEMA_VERSION.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        upgraded_from: upgraded_from.map(|s| s.to_string()),
    };

    let json = serde_json::to_string_pretty(&info)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

    std::fs::write(&version_path, json)?;
    log::info!("Wrote schema version file: {:?}", version_path);

    Ok(())
}

/// Delete schema version file (called when deleting database)
pub fn delete_schema_version(db_path: &Path) -> std::io::Result<()> {
    let version_path = db_path.with_extension("db.version");
    if version_path.exists() {
        std::fs::remove_file(&version_path)?;
        log::info!("Deleted schema version file: {:?}", version_path);
    }
    Ok(())
}

/// Extract table, view, and sequence names from schema.sql
///
/// Parses the schema SQL to find all CREATE TABLE, CREATE VIEW, and CREATE SEQUENCE statements.
/// Returns (tables, views, sequences) as vectors of names in the order they appear.
fn extract_schema_objects() -> (Vec<String>, Vec<String>, Vec<String>) {
    let schema_sql = include_str!("../../../docs/schema.sql");
    let mut tables = Vec::new();
    let mut views = Vec::new();
    let mut sequences = Vec::new();

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
        // Match CREATE SEQUENCE name
        else if upper.starts_with("CREATE SEQUENCE ") {
            if let Some(name) = trimmed
                .strip_prefix("CREATE SEQUENCE ")
                .or_else(|| trimmed.strip_prefix("create sequence "))
            {
                // Name ends at space or semicolon
                let name = name
                    .split(|c: char| c.is_whitespace() || c == ';')
                    .next()
                    .unwrap_or("");
                if !name.is_empty() {
                    sequences.push(name.to_string());
                }
            }
        }
    }

    (tables, views, sequences)
}

/// Drop all schema objects (views first, then tables, then sequences)
///
/// Dynamically extracts table/view/sequence names from schema.sql to ensure
/// all objects are dropped even when schema.sql is updated.
pub fn drop_all_schema_objects(conn: &Connection) -> Result<()> {
    let (tables, views, sequences) = extract_schema_objects();

    log::info!(
        "Dropping {} views, {} tables, and {} sequences from schema",
        views.len(),
        tables.len(),
        sequences.len()
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

    // Drop sequences last (tables may reference them via DEFAULT nextval())
    for sequence in &sequences {
        // NOTE: Sequence names come from schema.sql parsing, not user input
        let query = format!("DROP SEQUENCE IF EXISTS {}", sequence);
        conn.execute(&query, [])?;
    }
    log::debug!("Dropped {} sequences", sequences.len());

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

/// Run schema migrations for existing databases.
///
/// This function runs all non-breaking migrations in order. Each migration
/// is idempotent and records its version in schema_migrations.
///
/// IMPORTANT: This should only be called after checking that no breaking
/// migrations are pending (use has_breaking_migration first).
fn migrate_schema(conn: &Connection, from_version: &str) -> Result<()> {
    let pending = get_pending_migrations(from_version);

    if pending.is_empty() {
        log::info!("No migrations needed, already at v{}", CURRENT_SCHEMA_VERSION);
        return Ok(());
    }

    log::info!(
        "Running {} migrations from v{} to v{}",
        pending.len(),
        from_version,
        CURRENT_SCHEMA_VERSION
    );

    for migration in pending {
        log::info!("Running migration v{}: {}", migration.version, migration.description);

        // Run the actual migration logic
        run_migration(conn, migration)?;

        // Record migration in schema_migrations (idempotent)
        let already_recorded = conn
            .query_row(
                "SELECT 1 FROM schema_migrations WHERE version = ?",
                [migration.version],
                |_| Ok(()),
            )
            .is_ok();

        if !already_recorded {
            conn.execute(
                "INSERT INTO schema_migrations (version, description) VALUES (?, ?)",
                [migration.version, migration.description],
            )?;
            log::info!("Recorded migration v{} in schema_migrations", migration.version);
        }
    }

    log::info!("Schema migrations completed successfully");
    Ok(())
}

/// Run the migration logic for a specific version.
///
/// Each non-breaking migration has its logic here. Breaking migrations
/// don't need logic since they require a full schema reset.
fn run_migration(conn: &Connection, migration: &Migration) -> Result<()> {
    match migration.version {
        "2.5.0" => migrate_add_collections(conn),
        // 2.12.0: No schema changes, just records the new migration system
        "2.12.0" => {
            log::info!("Migration v2.12.0: Recording migration system update");
            Ok(())
        }
        // Breaking migrations don't have incremental logic - they require reset
        // These are kept for documentation and the is_breaking flag
        _ if migration.is_breaking => {
            log::debug!(
                "Migration v{} is breaking, skipping incremental logic",
                migration.version
            );
            Ok(())
        }
        // Future non-breaking migrations go here
        _ => {
            log::warn!(
                "Unknown migration v{}, no logic implemented",
                migration.version
            );
            Ok(())
        }
    }
}

/// Migration: Add collections table and matches.collection_id column
///
/// Introduced in schema v2.5.0 for organizing matches into collections.
fn migrate_add_collections(conn: &Connection) -> Result<()> {
    // Check if collections table exists
    let collections_exists = conn
        .query_row("SELECT 1 FROM collections LIMIT 1", [], |_| Ok(()))
        .is_ok();

    if !collections_exists {
        log::info!("Migrating: Adding collections table...");

        // Create sequence (ignore error if already exists)
        let _ = conn.execute("CREATE SEQUENCE IF NOT EXISTS collections_id_seq START 2", []);

        // Create collections table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS collections (
                collection_id INTEGER PRIMARY KEY DEFAULT nextval('collections_id_seq'),
                name VARCHAR NOT NULL UNIQUE,
                is_default BOOLEAN NOT NULL DEFAULT FALSE
            )",
            [],
        )?;

        // Seed default collection
        conn.execute(
            "INSERT INTO collections (collection_id, name, is_default) VALUES (1, 'Personal', TRUE)",
            [],
        )?;

        log::info!("Created collections table with default 'Personal' collection");
    }

    // Check if matches.collection_id column exists using DuckDB's pragma
    let column_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('matches') WHERE name = 'collection_id'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !column_exists {
        log::info!("Migrating: Adding collection_id column to matches...");

        // DuckDB doesn't support ADD COLUMN with constraints, so we:
        // 1. Add column without constraints
        // 2. Set default value for all existing rows
        conn.execute("ALTER TABLE matches ADD COLUMN collection_id INTEGER", [])?;
        conn.execute("UPDATE matches SET collection_id = 1 WHERE collection_id IS NULL", [])?;

        // Create index
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_matches_collection ON matches(collection_id)",
            [],
        )?;

        log::info!("Added collection_id column to matches table (all existing matches assigned to 'Personal' collection)");
    }

    // Update schema_migrations if this migration was applied
    // Check if v2.5.0 is already recorded
    let v250_exists = conn
        .query_row(
            "SELECT 1 FROM schema_migrations WHERE version = '2.5.0'",
            [],
            |_| Ok(()),
        )
        .is_ok();

    if !v250_exists {
        conn.execute(
            "INSERT INTO schema_migrations (version, description) VALUES ('2.5.0', 'Added collections table for organizing matches and filtering stats')",
            [],
        )?;
        log::info!("Recorded migration v2.5.0 in schema_migrations");
    }

    Ok(())
}

/// Initialize and validate schema on first run.
///
/// Takes an existing connection to ensure consistent checkpoint settings.
/// The connection should be created via DbPool to have proper WAL settings.
///
/// This function:
/// 1. Creates schema from scratch if no tables exist
/// 2. Gets stored version from schema_migrations
/// 3. Checks if any pending migrations are breaking (requires reset)
/// 4. Runs non-breaking migrations if all pending migrations are safe
pub fn ensure_schema_ready(conn: &Connection) -> Result<()> {
    log::info!("ensure_schema_ready called");

    // Check if schema is already initialized by trying to query the matches table directly
    // This is more reliable than using information_schema which has compatibility issues
    log::info!("Checking if schema exists...");
    let schema_exists = conn
        .query_row("SELECT COUNT(*) FROM matches", [], |row| row.get::<_, i64>(0))
        .is_ok();
    log::info!("Schema exists check result: {}", schema_exists);

    // Initialize schema from schema.sql if not exists
    if !schema_exists {
        create_schema(conn)?;
    } else {
        log::info!("Schema already exists, checking version...");

        // Get the highest version from schema_migrations using semver comparison
        // Note: SQL ORDER BY uses string comparison which breaks for "2.9.0" vs "2.10.0"
        // So we fetch all versions and find the max in Rust
        let stored_version = get_max_schema_version(conn);

        log::info!("Stored schema version: v{}", stored_version);

        // Already at current version?
        if stored_version == CURRENT_SCHEMA_VERSION {
            log::info!("Schema is up to date at v{}", CURRENT_SCHEMA_VERSION);
        } else if is_schema_structurally_current(conn) {
            // Database has correct structure but outdated migration records
            // This happens when schema.sql is updated but the user's DB was created earlier
            log::info!(
                "Schema structure is current but migration records are outdated (v{}). Updating records.",
                stored_version
            );
            update_migration_records_to_current(conn)?;
        } else {
            // Check if any pending migrations are breaking
            if has_breaking_migration(&stored_version) {
                let reason = get_breaking_migration_reason(&stored_version);
                log::warn!(
                    "Breaking migration required: {} -> {}",
                    stored_version,
                    reason
                );
                return Err(crate::parser::ParseError::SchemaUpgrade(format!(
                    "Database schema update required ({}). \
                     Your imported games will need to be re-imported after the reset.",
                    reason
                ))
                .into());
            }

            // All pending migrations are non-breaking, run them
            migrate_schema(conn, &stored_version)?;
        }
    }

    // Validate schema integrity (lenient - just check critical tables)
    log::info!("Validating schema...");
    match validate_schema(conn) {
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

    // Explicit CHECKPOINT to flush WAL after schema operations
    // This ensures schema/index data is persisted before any data imports,
    // preventing index corruption from WAL inconsistencies across connections
    log::info!("Checkpointing after schema operations...");
    conn.execute_batch("CHECKPOINT")?;
    log::info!("Schema checkpoint completed");

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
        "collections",
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

    // Version file
    let version_path = db_path.with_extension("db.version");
    if version_path.exists() {
        std::fs::remove_file(&version_path)?;
        deleted.push(version_path);
    }

    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_extract_schema_objects() {
        let (tables, views, sequences) = extract_schema_objects();

        // Verify we extracted a reasonable number of tables and views
        assert!(tables.len() >= 30, "Expected at least 30 tables, got {}", tables.len());
        assert!(views.len() >= 4, "Expected at least 4 views, got {}", views.len());
        assert!(sequences.len() >= 1, "Expected at least 1 sequence, got {}", sequences.len());

        // Verify specific known tables exist
        assert!(tables.contains(&"matches".to_string()), "Should contain 'matches' table");
        assert!(tables.contains(&"players".to_string()), "Should contain 'players' table");
        assert!(tables.contains(&"characters".to_string()), "Should contain 'characters' table");
        assert!(tables.contains(&"user_settings".to_string()), "Should contain 'user_settings' table");

        // Verify specific known views exist
        assert!(views.contains(&"match_summary".to_string()), "Should contain 'match_summary' view");
        assert!(views.contains(&"rulers".to_string()), "Should contain 'rulers' view");

        // Verify specific known sequences exist
        assert!(sequences.contains(&"collections_id_seq".to_string()), "Should contain 'collections_id_seq' sequence");

        // Verify order: id_mappings should come first (it's the first CREATE TABLE in schema.sql)
        assert_eq!(tables[0], "id_mappings", "First table should be 'id_mappings'");

        println!("Extracted {} tables, {} views, and {} sequences", tables.len(), views.len(), sequences.len());
        println!("Tables: {:?}", tables);
        println!("Views: {:?}", views);
        println!("Sequences: {:?}", sequences);
    }

    #[test]
    #[ignore] // TODO: Fix information_schema query issues in DuckDB
    fn test_ensure_schema_ready() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();

        // First call should initialize schema (may have warnings due to partial indexes)
        let result1 = ensure_schema_ready(&conn);
        if let Err(ref e) = result1 {
            eprintln!("Schema initialization error: {:?}", e);
        }
        assert!(result1.is_ok(), "First schema init should succeed: {:?}", result1);

        // Second call should not error (idempotent)
        let result2 = ensure_schema_ready(&conn);
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

    #[test]
    fn test_parse_version() {
        assert_eq!(parse_version("2.12.0"), Some((2, 12, 0)));
        assert_eq!(parse_version("1.0.0"), Some((1, 0, 0)));
        assert_eq!(parse_version("10.20.30"), Some((10, 20, 30)));
        assert_eq!(parse_version("invalid"), None);
        assert_eq!(parse_version("1.2"), None);
        assert_eq!(parse_version("1.2.3.4"), None);
    }

    #[test]
    fn test_version_cmp() {
        use std::cmp::Ordering;

        assert_eq!(version_cmp("2.5.0", "2.4.0"), Ordering::Greater);
        assert_eq!(version_cmp("2.5.0", "2.5.0"), Ordering::Equal);
        assert_eq!(version_cmp("2.5.0", "2.6.0"), Ordering::Less);
        assert_eq!(version_cmp("2.10.0", "2.9.0"), Ordering::Greater);
        assert_eq!(version_cmp("3.0.0", "2.99.99"), Ordering::Greater);
    }

    #[test]
    fn test_get_pending_migrations() {
        // From 2.4.0, all migrations should be pending
        let pending = get_pending_migrations("2.4.0");
        assert!(!pending.is_empty(), "Should have pending migrations from 2.4.0");
        assert_eq!(pending[0].version, "2.5.0", "First pending should be 2.5.0");

        // From 2.13.0 (current), no migrations should be pending
        let pending = get_pending_migrations("2.13.0");
        assert!(pending.is_empty(), "Should have no pending migrations from current version");

        // From 2.7.0, should have 2.8.0+ pending
        let pending = get_pending_migrations("2.7.0");
        assert!(pending.iter().any(|m| m.version == "2.8.0"));
        assert!(!pending.iter().any(|m| m.version == "2.5.0"));
    }

    #[test]
    fn test_has_breaking_migration() {
        // 2.4.0 -> 2.13.0 has breaking migrations (2.6.0+)
        assert!(has_breaking_migration("2.4.0"));

        // 2.13.0 -> 2.13.0 has no pending migrations
        assert!(!has_breaking_migration("2.13.0"));
    }

    #[test]
    fn test_migrate_adds_collections_to_old_schema() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();

        // Create a minimal old schema without collections
        conn.execute_batch(
            "CREATE TABLE matches (
                match_id BIGINT PRIMARY KEY,
                game_id VARCHAR NOT NULL,
                file_name VARCHAR NOT NULL,
                file_hash VARCHAR NOT NULL,
                total_turns INTEGER NOT NULL
            );
            CREATE TABLE schema_migrations (
                version VARCHAR PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                description VARCHAR
            );
            INSERT INTO schema_migrations (version, description) VALUES ('2.4.0', 'Old schema');
            INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns)
                VALUES (1, 'game1', 'file1.zip', 'hash1', 100);
            INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns)
                VALUES (2, 'game2', 'file2.zip', 'hash2', 200);"
        ).unwrap();

        // Verify collections doesn't exist yet
        let collections_exists = conn
            .query_row("SELECT 1 FROM collections LIMIT 1", [], |_| Ok(()))
            .is_ok();
        assert!(!collections_exists, "collections table should not exist before migration");

        // Run migration from v2.4.0 (only runs v2.5.0 collections migration)
        // Note: In practice, this would fail due to breaking migrations after 2.5.0
        // but we can test the collections migration directly
        migrate_add_collections(&conn).unwrap();

        // Verify collections table was created
        let collections_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM collections", [], |row| row.get(0))
            .unwrap();
        assert_eq!(collections_count, 1, "Should have 1 default collection");

        // Verify default collection exists
        let default_name: String = conn
            .query_row(
                "SELECT name FROM collections WHERE is_default = TRUE",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(default_name, "Personal");

        // Verify collection_id column was added to matches
        let match_collection: i32 = conn
            .query_row(
                "SELECT collection_id FROM matches WHERE match_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(match_collection, 1, "Existing matches should be in collection 1");

        // Verify all matches got collection_id = 1
        let all_in_default: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM matches WHERE collection_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(all_in_default, 2, "All existing matches should be in default collection");

        // Leak tempdir to prevent cleanup while conn is in use
        std::mem::forget(dir);
    }

    #[test]
    fn test_migrate_is_idempotent() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();

        // Create full schema (which includes collections)
        create_schema(&conn).unwrap();

        // Run migration multiple times from current version - should not error
        migrate_schema(&conn, CURRENT_SCHEMA_VERSION).unwrap();
        migrate_schema(&conn, CURRENT_SCHEMA_VERSION).unwrap();

        // Verify still just one default collection
        let collections_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM collections", [], |row| row.get(0))
            .unwrap();
        assert_eq!(collections_count, 1, "Should still have only 1 collection");

        // Leak tempdir to prevent cleanup while conn is in use
        std::mem::forget(dir);
    }

    #[test]
    fn test_schema_has_no_foreign_keys() {
        let schema_sql = include_str!("../../../docs/schema.sql");
        let fk_count = schema_sql
            .lines()
            .filter(|line| {
                let trimmed = line.trim().to_uppercase();
                trimmed.starts_with("FOREIGN KEY")
            })
            .count();
        assert_eq!(fk_count, 0, "Schema should have no FOREIGN KEY constraints");
    }

    #[test]
    fn test_old_schema_triggers_upgrade_error() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();

        // Create old schema (pre-2.8.0) with just enough to pass schema_exists check
        conn.execute_batch(
            "CREATE TABLE matches (match_id BIGINT PRIMARY KEY);
             CREATE TABLE schema_migrations (version VARCHAR PRIMARY KEY);
             INSERT INTO schema_migrations (version) VALUES ('2.7.0');"
        ).unwrap();
        drop(conn);

        // ensure_schema_ready should return error for old schema with breaking migrations
        let conn = Connection::open(&db_path).unwrap();
        let result = ensure_schema_ready(&conn);
        assert!(result.is_err(), "Should error when breaking migrations are pending");
        let err_msg = result.unwrap_err().to_string();
        // Should mention either the version, breaking changes, or reset requirement
        assert!(
            err_msg.contains("2.8.0") || err_msg.contains("breaking") || err_msg.contains("reset") || err_msg.contains("re-imported"),
            "Error should mention breaking migration or reset: {}", err_msg
        );
    }

    #[test]
    fn test_migrations_are_in_order() {
        // Verify MIGRATIONS array is sorted by version
        let versions: Vec<&str> = MIGRATIONS.iter().map(|m| m.version).collect();
        let mut sorted = versions.clone();
        sorted.sort_by(|a, b| version_cmp(a, b));
        assert_eq!(versions, sorted, "MIGRATIONS should be in version order");
    }

    #[test]
    fn test_current_version_in_migrations() {
        // Verify CURRENT_SCHEMA_VERSION is the last migration
        let last = MIGRATIONS.last().expect("Should have at least one migration");
        assert_eq!(
            last.version, CURRENT_SCHEMA_VERSION,
            "Last migration should match CURRENT_SCHEMA_VERSION"
        );
    }
}
