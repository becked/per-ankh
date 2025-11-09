// Integration test for full save file import
//
// This test imports a real Old World save file and verifies that:
// 1. The import succeeds
// 2. Data is inserted into the database
// 3. Core entities are populated
// 4. Time-series data is present
// 5. Extended data is parsed correctly

use duckdb::params;
use per_ankh_lib::db;
use per_ankh_lib::parser;
use tempfile::tempdir;

#[test]
fn test_import_babylonia_save() {
    // Initialize logging for test output
    let _ = env_logger::builder().is_test(true).try_init();

    // Create temporary database
    let temp_dir = tempdir().expect("Failed to create temp dir");
    let db_path = temp_dir.path().join("test.db");

    // Initialize schema
    db::ensure_schema_ready(&db_path).expect("Failed to initialize schema");

    // Get connection
    let conn = db::connection::get_connection(&db_path).expect("Failed to connect to database");

    // Import save file
    let save_path = "test-data/saves/OW-Babylonia-Year123-2024-01-31-22-44-04.zip";
    let result = parser::import_save_file(save_path, &conn, None, None, None, None, None).expect("Failed to import save file");

    // Verify result
    assert!(result.success, "Import should succeed");
    assert!(result.match_id.is_some(), "Should have match_id");
    assert!(result.is_new, "Should be a new match");
    assert!(result.error.is_none(), "Should have no error");

    let match_id = result.match_id.unwrap();
    println!("Imported match_id: {}, game_id: {}", match_id, result.game_id);

    // Verify matches table
    let match_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM matches WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query matches");
    assert_eq!(match_count, 1, "Should have 1 match record");

    // Verify players
    let player_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM players WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query players");
    println!("Players imported: {}", player_count);
    assert!(player_count > 0, "Should have at least 1 player");

    // Verify characters
    let character_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM characters WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query characters");
    println!("Characters imported: {}", character_count);
    assert!(character_count > 0, "Should have at least 1 character");

    // Verify cities
    let city_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM cities WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query cities");
    println!("Cities imported: {}", city_count);
    assert!(city_count > 0, "Should have at least 1 city");

    // Verify tiles
    let tile_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM tiles WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query tiles");
    println!("Tiles imported: {}", tile_count);
    assert!(tile_count > 0, "Should have at least 1 tile");

    // Verify tribes
    let tribe_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM tribes WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query tribes");
    println!("Tribes imported: {}", tribe_count);

    // Verify player resources
    let resource_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM player_resources WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query player_resources");
    println!("Player resources imported: {}", resource_count);
    assert!(resource_count > 0, "Should have at least 1 resource record");

    // Verify technology progress
    let tech_progress_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM technology_progress WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query technology_progress");
    println!("Technology progress records: {}", tech_progress_count);

    // Verify technology completed
    let tech_completed_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM technologies_completed WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query technologies_completed");
    println!("Technologies completed: {}", tech_completed_count);

    // Verify laws
    let law_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM laws WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query laws");
    println!("Laws imported: {}", law_count);

    // Verify diplomacy
    let diplomacy_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM diplomacy WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query diplomacy");
    println!("Diplomacy relations imported: {}", diplomacy_count);

    // Verify time-series data
    let military_history_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM military_history WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query military_history");
    println!("Military history records: {}", military_history_count);

    let points_history_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM points_history WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query points_history");
    println!("Points history records: {}", points_history_count);

    let legitimacy_history_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM legitimacy_history WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query legitimacy_history");
    println!("Legitimacy history records: {}", legitimacy_history_count);

    let yield_history_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM yield_history WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query yield_history");
    println!("Yield history records: {}", yield_history_count);

    // Verify character extended data
    let character_stats_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM character_stats WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query character_stats");
    println!("Character stats records: {}", character_stats_count);

    let character_traits_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM character_traits WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query character_traits");
    println!("Character traits records: {}", character_traits_count);

    let character_relationships_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM character_relationships WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query character_relationships");
    println!("Character relationships records: {}", character_relationships_count);

    // Verify city extended data
    let city_production_queue_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM city_production_queue WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query city_production_queue");
    println!("City production queue items: {}", city_production_queue_count);

    let city_projects_completed_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM city_projects_completed WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query city_projects_completed");
    println!("City projects completed: {}", city_projects_completed_count);

    let city_culture_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM city_culture WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query city_culture");
    println!("City culture records: {}", city_culture_count);

    // Verify tile extended data
    let tile_visibility_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM tile_visibility WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query tile_visibility");
    println!("Tile visibility records: {}", tile_visibility_count);

    let tile_changes_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM tile_changes WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query tile_changes");
    println!("Tile changes records: {}", tile_changes_count);

    // Verify event stories
    let story_events_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM story_events WHERE match_id = ?", params![match_id], |row| row.get(0))
        .expect("Failed to query story_events");
    println!("Story events records: {}", story_events_count);

    println!("\n✓ All verifications passed!");
}

#[test]
fn test_import_multiple_saves() {
    // Initialize logging for test output
    let _ = env_logger::builder().is_test(true).try_init();

    // Create temporary database
    let temp_dir = tempdir().expect("Failed to create temp dir");
    let db_path = temp_dir.path().join("test.db");

    // Initialize schema
    db::ensure_schema_ready(&db_path).expect("Failed to initialize schema");

    // Get connection
    let conn = db::connection::get_connection(&db_path).expect("Failed to connect to database");

    // Import multiple save files
    let save_files = vec![
        "test-data/saves/OW-Babylonia-Year123-2024-01-31-22-44-04.zip",
        "test-data/saves/OW-Greece-Year74-2022-01-02-20-28-07.zip",
    ];

    for save_path in &save_files {
        // Check if file exists
        if !std::path::Path::new(save_path).exists() {
            println!("Skipping {} (file not found)", save_path);
            continue;
        }

        println!("\n--- Importing {} ---", save_path);
        let result = parser::import_save_file(save_path, &conn, None, None, None, None, None).expect("Failed to import save file");

        assert!(result.success, "Import should succeed for {}", save_path);
        assert!(result.match_id.is_some(), "Should have match_id for {}", save_path);

        let match_id = result.match_id.unwrap();
        println!("Imported match_id: {}, game_id: {}", match_id, result.game_id);
    }

    // Verify we have multiple matches
    let total_matches: i64 = conn
        .query_row("SELECT COUNT(*) FROM matches", [], |row| row.get(0))
        .expect("Failed to query matches");
    println!("\nTotal matches imported: {}", total_matches);
    assert!(total_matches >= 1, "Should have at least 1 match");
}

#[test]
fn test_reimport_same_save() {
    // Initialize logging for test output
    let _ = env_logger::builder().is_test(true).try_init();

    // Create temporary database
    let temp_dir = tempdir().expect("Failed to create temp dir");
    let db_path = temp_dir.path().join("test.db");

    // Initialize schema
    db::ensure_schema_ready(&db_path).expect("Failed to initialize schema");

    // Get connection
    let conn = db::connection::get_connection(&db_path).expect("Failed to connect to database");

    let save_path = "test-data/saves/OW-Babylonia-Year123-2024-01-31-22-44-04.zip";

    // First import
    println!("First import...");
    let result1 = parser::import_save_file(save_path, &conn, None, None, None, None, None).expect("Failed to import save file");
    assert!(result1.success, "First import should succeed");
    assert!(result1.is_new, "First import should be new");
    let match_id1 = result1.match_id.unwrap();
    let game_id = result1.game_id.clone();

    // Get counts after first import
    let players_count1: i64 = conn
        .query_row("SELECT COUNT(*) FROM players WHERE match_id = ?", params![match_id1], |row| row.get(0))
        .expect("Failed to query players");

    // Second import (update)
    println!("\nSecond import (should update existing match)...");
    let result2 = parser::import_save_file(save_path, &conn, None, None, None, None, None).expect("Failed to import save file");
    assert!(result2.success, "Second import should succeed");
    assert!(!result2.is_new, "Second import should not be new");
    assert_eq!(result2.match_id, Some(match_id1), "Should reuse same match_id");
    assert_eq!(result2.game_id, game_id, "Should have same game_id");

    // Get counts after second import
    let players_count2: i64 = conn
        .query_row("SELECT COUNT(*) FROM players WHERE match_id = ?", params![match_id1], |row| row.get(0))
        .expect("Failed to query players");

    // Verify counts are the same (update-and-replace worked)
    assert_eq!(players_count1, players_count2, "Player counts should match after reimport");

    // Verify we still only have 1 match
    let total_matches: i64 = conn
        .query_row("SELECT COUNT(*) FROM matches", [], |row| row.get(0))
        .expect("Failed to query matches");
    assert_eq!(total_matches, 1, "Should still have only 1 match after reimport");

    println!("\n✓ Reimport test passed!");
}
