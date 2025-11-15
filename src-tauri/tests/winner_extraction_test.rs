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

    // Query winner_player_id and victory type
    let (winner, victory_type): (Option<i64>, Option<String>) = conn.query_row(
        "SELECT winner_player_id, winner_victory_type FROM matches WHERE match_id = ?",
        [result.match_id.unwrap()],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap();

    // Verify winner was extracted
    assert!(winner.is_some(), "Winner should be set for completed game");
    assert!(victory_type.is_some(), "Victory type should be extracted for completed game");

    // Verify winner is a valid player
    let player_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM players WHERE match_id = ? AND player_id = ?",
        [result.match_id.unwrap(), winner.unwrap()],
        |row| row.get(0),
    ).unwrap();

    assert_eq!(player_count, 1, "Winner should reference an existing player");

    println!("✓ Winner extracted: player_id = {}, victory_type = {:?}",
             winner.unwrap(), victory_type);
}

#[test]
fn test_victory_conditions_extraction() {
    // Initialize logging
    let _ = env_logger::builder().is_test(true).try_init();

    // Create temporary database
    let temp_dir = tempdir().unwrap();
    let db_path = temp_dir.path().join("test.db");
    let conn = Connection::open(&db_path).unwrap();

    // Initialize schema
    create_schema(&conn).unwrap();

    // Import a completed game save (use Carthage save which we know has victory conditions)
    let save_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("test-data/saves/OW-Carthage-Year39.zip");

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

    // Query victory_conditions
    let victory_conditions: Option<String> = conn.query_row(
        "SELECT victory_conditions FROM matches WHERE match_id = ?",
        [result.match_id.unwrap()],
        |row| row.get(0),
    ).unwrap();

    // Verify victory conditions were extracted
    assert!(victory_conditions.is_some(), "Victory conditions should be extracted");

    let conditions = victory_conditions.unwrap();
    println!("✓ Victory conditions extracted: {}", conditions);

    // Verify format: should be + separated victory types
    assert!(conditions.contains("VICTORY_"), "Victory conditions should contain VICTORY_ prefix");
    assert!(conditions.contains("+") || !conditions.is_empty(), "Victory conditions should be non-empty");

    // Verify expected victory types are present (from our XML investigation)
    assert!(conditions.contains("VICTORY_POINTS") ||
            conditions.contains("VICTORY_TIME") ||
            conditions.contains("VICTORY_CONQUEST"),
            "Should contain at least one standard victory type");
}
