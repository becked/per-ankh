// Test for unit production data parsing

use per_ankh_lib::{db, parser};
use tempfile::tempdir;

#[test]
fn test_unit_production_parsing() {
    // Use a test save file
    let test_file = "../test-data/saves/OW-Carthage-Year39-2025-11-04-21-38-46.zip";

    // Check if file exists
    if !std::path::Path::new(test_file).exists() {
        eprintln!("Test file not found: {}", test_file);
        eprintln!("Skipping test");
        return;
    }

    // Create temporary database
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("test.db");

    // Initialize schema
    db::ensure_schema_ready(&db_path).unwrap();

    // Open connection
    let conn = db::connection::get_connection(&db_path).unwrap();

    // Import save file
    let result = parser::import_save_file(test_file, &conn, None, None, None, None, None).unwrap();
    assert!(result.success, "Import should succeed");

    // Verify player_units_produced has data
    let player_units_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM player_units_produced",
            [],
            |row| row.get(0),
        )
        .unwrap();
    println!("player_units_produced count: {}", player_units_count);
    assert!(
        player_units_count > 0,
        "Should have player unit production data"
    );

    // Verify city_units_produced has data
    let city_units_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM city_units_produced",
            [],
            |row| row.get(0),
        )
        .unwrap();
    println!("city_units_produced count: {}", city_units_count);
    assert!(
        city_units_count > 0,
        "Should have city unit production data"
    );

    // Show some sample data
    println!("\nSample player unit production:");
    let mut stmt = conn
        .prepare("SELECT unit_type, count FROM player_units_produced LIMIT 5")
        .unwrap();
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
        })
        .unwrap();

    for row in rows {
        let (unit_type, count) = row.unwrap();
        println!("  {}: {}", unit_type, count);
    }

    println!("\nSample city unit production:");
    let mut stmt = conn
        .prepare("SELECT unit_type, count FROM city_units_produced LIMIT 5")
        .unwrap();
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
        })
        .unwrap();

    for row in rows {
        let (unit_type, count) = row.unwrap();
        println!("  {}: {}", unit_type, count);
    }
}
