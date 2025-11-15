// Integration test for winner extraction
use duckdb::Connection;
use per_ankh_lib::parser::import::import_save_file;
use per_ankh_lib::db::schema::create_schema;
use std::path::PathBuf;
use tempfile::tempdir;

#[test]
fn test_winner_extraction_from_completed_game() {
    // Initialize logging
    let _ = env_logger::builder().is_test(true).try_init();

    // Create temporary database
    let temp_dir = tempdir().unwrap();
    let db_path = temp_dir.path().join("test.db");
    let conn = Connection::open(&db_path).unwrap();

    // Initialize schema
    create_schema(&conn).unwrap();

    // Import a completed game save
    let save_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("test-data/saves/OW-Assyria-Year138-2025-06-14-13-31-03.zip");

    let result = import_save_file(
        save_path.to_str().unwrap(),
        &conn,
        None, // no app handle
        None, // no file index
        None, // no total files
        None, // no file name
        None, // no batch start time
    ).unwrap();

    if !result.success {
        eprintln!("Import failed with error: {:?}", result.error);
    }
    assert!(result.success, "Import should succeed");
    assert!(result.match_id.is_some(), "Should have match_id");

    // Query winner_player_id
    let winner: Option<i64> = conn.query_row(
        "SELECT winner_player_id FROM matches WHERE match_id = ?",
        [result.match_id.unwrap()],
        |row| row.get(0),
    ).unwrap();

    // Verify winner was extracted
    assert!(winner.is_some(), "Winner should be set for completed game");

    // Verify winner is a valid player
    let player_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM players WHERE match_id = ? AND player_id = ?",
        [result.match_id.unwrap(), winner.unwrap()],
        |row| row.get(0),
    ).unwrap();

    assert_eq!(player_count, 1, "Winner should reference an existing player");

    println!("✓ Winner extracted: player_id = {}", winner.unwrap());
}
