// Integration tests for parser

#[cfg(test)]
mod tests {
    use crate::db;
    use crate::parser;
    use duckdb::Connection;
    use tempfile::tempdir;

    #[test]
    fn test_schema_tables_exist() {
        // Initialize logger for test
        let _ = env_logger::builder().is_test(true).try_init();

        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        // Open connection and initialize schema
        let conn = Connection::open(&db_path).unwrap();
        db::ensure_schema_ready(&conn).unwrap();

        // Try to query the players table directly
        let result = conn.query_row(
            "SELECT COUNT(*) FROM players",
            [],
            |row| row.get::<_, i64>(0),
        );

        match result {
            Ok(count) => {
                println!("Players table exists with {} rows", count);
                assert_eq!(count, 0);
            }
            Err(e) => {
                panic!("Players table doesn't exist or query failed: {}", e);
            }
        }
    }

    #[test]
    fn test_import_real_save_file() {
        // Use a small test save file
        let test_file = "../test-data/saves/OW-Carthage-Year39-2025-11-04-21-38-46.zip";

        // Check if file exists
        if !std::path::Path::new(test_file).exists() {
            eprintln!("Test file not found: {}", test_file);
            eprintln!("Skipping integration test");
            return;
        }

        // Create temporary database
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        // Open connection and initialize schema (unified connection management)
        let conn = db::connection::get_connection(&db_path).unwrap();
        db::ensure_schema_ready(&conn).unwrap();

        // Import save file (no progress tracking for tests)
        let result = parser::import_save_file(test_file, &conn, None, None, None, None, None);

        match &result {
            Ok(import_result) => {
                if !import_result.success {
                    panic!("Import failed: {:?}", import_result.error);
                }
                assert!(import_result.success, "Import should succeed");
                assert!(import_result.match_id.is_some(), "Should have match_id");
                assert!(import_result.is_new, "Should be a new match");
                assert!(!import_result.game_id.is_empty(), "Should have game_id");

                println!("Successfully imported match:");
                println!("  Match ID: {:?}", import_result.match_id);
                println!("  Game ID: {}", import_result.game_id);
                println!("  Is New: {}", import_result.is_new);

                // Verify match was inserted into database
                let count: i64 = conn
                    .query_row("SELECT COUNT(*) FROM matches", [], |row| row.get(0))
                    .unwrap();
                assert_eq!(count, 1, "Should have exactly one match in database");

                // Verify game_id is stored correctly
                let stored_game_id: String = conn
                    .query_row(
                        "SELECT game_id FROM matches WHERE match_id = ?",
                        [import_result.match_id.unwrap()],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(
                    stored_game_id, import_result.game_id,
                    "Stored game_id should match"
                );

                // Verify parent relationships are populated (Phase 2 validation)
                let parents_set: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM characters
                         WHERE match_id = ? AND (birth_father_id IS NOT NULL OR birth_mother_id IS NOT NULL)",
                        [import_result.match_id.unwrap()],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert!(
                    parents_set > 0,
                    "Some characters should have parent relationships set"
                );
            }
            Err(e) => {
                panic!("Import failed: {}", e);
            }
        }
    }

}
