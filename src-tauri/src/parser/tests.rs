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

                // Validate new city columns from city-data-coverage plan
                let match_id = import_result.match_id.unwrap();

                // Check cities table has the new columns populated
                let city_count: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM cities WHERE match_id = ?",
                        [match_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                println!("  Cities: {}", city_count);
                assert!(city_count > 0, "Should have cities");

                // Verify new Phase 2 city columns exist and can be queried
                let city_with_hurry: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM cities
                         WHERE match_id = ? AND (
                             hurry_training_count > 0 OR
                             hurry_population_count > 0 OR
                             growth_count > 0 OR
                             unit_production_count > 0 OR
                             buy_tile_count > 0
                         )",
                        [match_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                println!("  Cities with hurry/growth metrics: {}", city_with_hurry);

                // Validate Phase 3 tables exist and can be queried
                let project_counts: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM city_project_counts WHERE match_id = ?",
                        [match_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                println!("  City project counts: {}", project_counts);

                let enemy_agents: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM city_enemy_agents WHERE match_id = ?",
                        [match_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                println!("  City enemy agents: {}", enemy_agents);

                let luxuries: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM city_luxuries WHERE match_id = ?",
                        [match_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                println!("  City luxuries: {}", luxuries);

                // Sample query to verify data integrity
                let sample_city: (String, i32, i32, i32, i32) = conn
                    .query_row(
                        "SELECT city_name, hurry_civics_count, hurry_money_count,
                                hurry_training_count, hurry_population_count
                         FROM cities WHERE match_id = ? LIMIT 1",
                        [match_id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
                    )
                    .unwrap();
                println!(
                    "  Sample city '{}': civics={}, money={}, training={}, pop={}",
                    sample_city.0, sample_city.1, sample_city.2, sample_city.3, sample_city.4
                );
            }
            Err(e) => {
                panic!("Import failed: {}", e);
            }
        }
    }

    #[test]
    fn test_city_data_coverage_late_game() {
        // Use a late-game save with more city data
        let test_file = "../test-data/saves/OW-Carthage-Year158-2025-07-28-16-15-39.zip";

        if !std::path::Path::new(test_file).exists() {
            eprintln!("Late-game test file not found, skipping");
            return;
        }

        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = db::connection::get_connection(&db_path).unwrap();
        db::ensure_schema_ready(&conn).unwrap();

        let result = parser::import_save_file(test_file, &conn, None, None, None, None, None);
        let import_result = result.unwrap();
        assert!(import_result.success);

        let match_id = import_result.match_id.unwrap();

        // Query all new city columns
        println!("\n=== City Data Coverage Validation (Late Game) ===");

        // Show cities with production metrics
        let mut stmt = conn.prepare(
            "SELECT city_name, growth_count, unit_production_count, buy_tile_count,
                    hurry_civics_count, hurry_money_count, hurry_training_count, hurry_population_count
             FROM cities
             WHERE match_id = ? AND (growth_count > 0 OR unit_production_count > 0)
             ORDER BY growth_count DESC
             LIMIT 5"
        ).unwrap();

        println!("\nTop 5 cities by growth_count:");
        let rows = stmt.query_map([match_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i32>(1)?,
                row.get::<_, i32>(2)?,
                row.get::<_, i32>(3)?,
                row.get::<_, i32>(4)?,
                row.get::<_, i32>(5)?,
                row.get::<_, i32>(6)?,
                row.get::<_, i32>(7)?,
            ))
        }).unwrap();

        for row in rows {
            let (name, growth, units, tiles, civics, money, training, pop) = row.unwrap();
            println!("  {} - growth:{}, units:{}, tiles:{}, hurry(c:{},m:{},t:{},p:{})",
                     name, growth, units, tiles, civics, money, training, pop);
        }

        // Show project counts
        let mut stmt = conn.prepare(
            "SELECT project_type, SUM(count) as total
             FROM city_project_counts
             WHERE match_id = ?
             GROUP BY project_type
             ORDER BY total DESC
             LIMIT 10"
        ).unwrap();

        println!("\nProject counts (top 10):");
        let rows = stmt.query_map([match_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        }).unwrap();

        for row in rows {
            let (project, count) = row.unwrap();
            println!("  {}: {}", project, count);
        }

        // Show luxuries
        let mut stmt = conn.prepare(
            "SELECT c.city_name, l.resource, l.imported_turn
             FROM city_luxuries l
             JOIN cities c ON l.city_id = c.city_id AND l.match_id = c.match_id
             WHERE l.match_id = ?
             ORDER BY l.imported_turn
             LIMIT 10"
        ).unwrap();

        println!("\nCity luxuries (first 10):");
        let rows = stmt.query_map([match_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i32>(2)?,
            ))
        }).unwrap();

        for row in rows {
            let (city, resource, turn) = row.unwrap();
            println!("  {} imported {} on turn {}", city, resource, turn);
        }

        // Summary stats
        let total_cities: i64 = conn.query_row(
            "SELECT COUNT(*) FROM cities WHERE match_id = ?",
            [match_id], |row| row.get(0)
        ).unwrap();

        let cities_with_growth: i64 = conn.query_row(
            "SELECT COUNT(*) FROM cities WHERE match_id = ? AND growth_count > 0",
            [match_id], |row| row.get(0)
        ).unwrap();

        let project_count_records: i64 = conn.query_row(
            "SELECT COUNT(*) FROM city_project_counts WHERE match_id = ?",
            [match_id], |row| row.get(0)
        ).unwrap();

        let luxury_records: i64 = conn.query_row(
            "SELECT COUNT(*) FROM city_luxuries WHERE match_id = ?",
            [match_id], |row| row.get(0)
        ).unwrap();

        println!("\nSummary:");
        println!("  Total cities: {}", total_cities);
        println!("  Cities with growth: {} ({:.0}%)", cities_with_growth,
                 (cities_with_growth as f64 / total_cities as f64) * 100.0);
        println!("  Project count records: {}", project_count_records);
        println!("  Luxury records: {}", luxury_records);
    }

    #[test]
    fn test_unit_data_verification() {
        // Use a late-game save with more unit data
        let test_file = "../test-data/saves/OW-Carthage-Year158-2025-07-28-16-15-39.zip";

        if !std::path::Path::new(test_file).exists() {
            eprintln!("Test file not found, skipping");
            return;
        }

        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = db::connection::get_connection(&db_path).unwrap();
        db::ensure_schema_ready(&conn).unwrap();

        let result = parser::import_save_file(test_file, &conn, None, None, None, None, None);
        let import_result = result.unwrap();
        assert!(import_result.success);

        let match_id = import_result.match_id.unwrap();

        println!("\n=== UNIT DATA VERIFICATION ===");

        // Count units and related data
        let unit_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM units WHERE match_id = ?",
            [match_id], |row| row.get(0)
        ).unwrap();

        let promo_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM unit_promotions WHERE match_id = ?",
            [match_id], |row| row.get(0)
        ).unwrap();

        let effect_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM unit_effects WHERE match_id = ?",
            [match_id], |row| row.get(0)
        ).unwrap();

        let family_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM unit_families WHERE match_id = ?",
            [match_id], |row| row.get(0)
        ).unwrap();

        println!("Total units: {}", unit_count);
        println!("Unit promotions: {}", promo_count);
        println!("Unit effects: {}", effect_count);
        println!("Unit family associations: {}", family_count);

        assert!(unit_count > 0, "Should have units");

        // Unit type breakdown
        println!("\n--- Unit Types ---");
        let mut stmt = conn.prepare(
            "SELECT unit_type, COUNT(*) as cnt FROM units WHERE match_id = ? GROUP BY unit_type ORDER BY cnt DESC LIMIT 10"
        ).unwrap();
        let rows = stmt.query_map([match_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        }).unwrap();

        for row in rows {
            let (unit_type, count) = row.unwrap();
            println!("  {}: {}", unit_type, count);
        }

        // Sample military units with XP
        println!("\n--- Sample Military Units (with XP) ---");
        let mut stmt = conn.prepare(
            "SELECT u.unit_id, u.unit_type, u.xp, u.level, p.player_name
             FROM units u
             LEFT JOIN players p ON u.player_id = p.player_id AND u.match_id = p.match_id
             WHERE u.match_id = ? AND u.xp IS NOT NULL
             ORDER BY u.xp DESC LIMIT 5"
        ).unwrap();
        let rows = stmt.query_map([match_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i32>>(2)?,
                row.get::<_, Option<i32>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        }).unwrap();

        for row in rows {
            let (id, unit_type, xp, level, player) = row.unwrap();
            println!("  Unit {}: {} (XP: {:?}, Level: {:?}, Owner: {:?})", id, unit_type, xp, level, player);
        }

        // Sample promotions
        println!("\n--- Sample Promotions ---");
        let mut stmt = conn.prepare(
            "SELECT up.promotion, up.is_acquired, COUNT(*) as cnt
             FROM unit_promotions up
             WHERE up.match_id = ?
             GROUP BY up.promotion, up.is_acquired
             ORDER BY cnt DESC LIMIT 10"
        ).unwrap();
        let rows = stmt.query_map([match_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?, row.get::<_, i64>(2)?))
        }).unwrap();

        for row in rows {
            let (promo, acquired, count) = row.unwrap();
            let status = if acquired { "acquired" } else { "available" };
            println!("  {} ({}): {}", promo, status, count);
        }

        // Sample effects
        if effect_count > 0 {
            println!("\n--- Sample Effects ---");
            let mut stmt = conn.prepare(
                "SELECT effect, SUM(stacks) as total_stacks, COUNT(*) as unit_count
                 FROM unit_effects WHERE match_id = ?
                 GROUP BY effect ORDER BY unit_count DESC LIMIT 5"
            ).unwrap();
            let rows = stmt.query_map([match_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
            }).unwrap();

            for row in rows {
                let (effect, stacks, count) = row.unwrap();
                println!("  {} - {} units, {} total stacks", effect, count, stacks);
            }
        }

        // Barbarian units
        let barbarian_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM units WHERE match_id = ? AND player_id IS NULL",
            [match_id], |row| row.get(0)
        ).unwrap();
        println!("\nBarbarian/tribal units (no player): {}", barbarian_count);

        // Sleeping units
        let sleeping_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM units WHERE match_id = ? AND is_sleeping = true",
            [match_id], |row| row.get(0)
        ).unwrap();
        println!("Sleeping units: {}", sleeping_count);
    }
}
