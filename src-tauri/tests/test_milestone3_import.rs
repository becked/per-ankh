// Integration test for Milestone 3: Gameplay Data parsing
//
// This test validates that the parsers can successfully import gameplay data
// from a real Old World save file including:
// - Player resources (YieldStockpile)
// - Technology progress and completion
// - Council positions
// - Laws
// - Player goals
// - Diplomacy

use per_ankh_lib::db;
use per_ankh_lib::parser;
use std::path::PathBuf;

#[test]
fn test_milestone3_import() {
    // Setup: Create temp database and initialize schema
    let db_path = PathBuf::from("test_milestone3.db");

    // Clean up if exists from previous run
    if db_path.exists() {
        std::fs::remove_file(&db_path).ok();
    }

    // Open connection and initialize schema (unified connection management)
    let conn = db::connection::get_connection(&db_path).expect("Failed to open connection");
    db::ensure_schema_ready(&conn).expect("Failed to initialize schema");

    // Import test save file (path relative to project root)
    let test_file = "../test-data/saves/OW-Carthage-Year39-2025-11-04-21-38-46.zip";

    if !PathBuf::from(test_file).exists() {
        eprintln!("Test file not found: {}", test_file);
        eprintln!("Skipping test...");
        return;
    }

    let result = parser::import_save_file(test_file, &conn, None, None, None, None, None).expect("Failed to import save file");

    if !result.success {
        eprintln!("Import failed with error: {:?}", result.error);
    }

    assert!(result.success, "Import should succeed: {:?}", result.error);
    assert!(result.match_id.is_some(), "Should have match_id");

    let match_id = result.match_id.unwrap();

    // Verify player_resources were imported
    let resource_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM player_resources WHERE match_id = ?",
            [match_id],
            |row| row.get(0),
        )
        .expect("Failed to query player_resources");

    println!("player_resources count: {}", resource_count);
    assert!(resource_count > 0, "Should have imported player resources");

    // Verify technology_progress was imported
    let tech_progress_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM technology_progress WHERE match_id = ?",
            [match_id],
            |row| row.get(0),
        )
        .expect("Failed to query technology_progress");

    println!("technology_progress count: {}", tech_progress_count);
    assert!(
        tech_progress_count > 0,
        "Should have imported technology progress"
    );

    // Verify technologies_completed was imported
    let tech_completed_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM technologies_completed WHERE match_id = ?",
            [match_id],
            |row| row.get(0),
        )
        .expect("Failed to query technologies_completed");

    println!("technologies_completed count: {}", tech_completed_count);
    assert!(
        tech_completed_count > 0,
        "Should have imported completed technologies"
    );

    // Verify technology_states was imported
    let tech_states_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM technology_states WHERE match_id = ?",
            [match_id],
            |row| row.get(0),
        )
        .expect("Failed to query technology_states");

    println!("technology_states count: {}", tech_states_count);
    assert!(
        tech_states_count > 0,
        "Should have imported technology states"
    );

    // Verify player_council was imported
    let council_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM player_council WHERE match_id = ?",
            [match_id],
            |row| row.get(0),
        )
        .expect("Failed to query player_council");

    println!("player_council count: {}", council_count);
    // Council might be 0 if no positions are filled
    println!("(Council positions may be 0 if none appointed)");

    // Verify laws were imported
    let laws_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM laws WHERE match_id = ?",
            [match_id],
            |row| row.get(0),
        )
        .expect("Failed to query laws");

    println!("laws count: {}", laws_count);
    assert!(laws_count > 0, "Should have imported laws");

    // Verify player_goals were imported
    let goals_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM player_goals WHERE match_id = ?",
            [match_id],
            |row| row.get(0),
        )
        .expect("Failed to query player_goals");

    println!("player_goals count: {}", goals_count);
    // Goals might be 0 if no active goals
    println!("(Goals may be 0 if no active ambitions)");

    // Verify diplomacy was imported
    let diplomacy_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM diplomacy WHERE match_id = ?",
            [match_id],
            |row| row.get(0),
        )
        .expect("Failed to query diplomacy");

    println!("diplomacy count: {}", diplomacy_count);
    assert!(diplomacy_count > 0, "Should have imported diplomacy");

    println!("\n✓ All Milestone 3 data imported successfully!");

    // Cleanup
    drop(conn);
    std::fs::remove_file(&db_path).ok();
}
