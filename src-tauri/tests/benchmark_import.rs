// Benchmark test for save file import
// Run with: cargo test --test benchmark_import --release -- --nocapture

use per_ankh_lib::db::schema::ensure_schema_ready;
use per_ankh_lib::db::connection::get_connection;
use per_ankh_lib::parser::import::import_save_file;
use std::time::Instant;
use std::path::PathBuf;

#[test]
fn benchmark_real_save_import() {
    // Use a temporary database in /tmp
    let tmp_db_path = "/tmp/per-ankh-benchmark.db";

    // Clean up any existing benchmark DB
    let _ = std::fs::remove_file(tmp_db_path);

    println!("\n=== Per-Ankh Save File Import Benchmark ===\n");

    // Setup: Create temporary database (unified connection management)
    let setup_start = Instant::now();
    let tmp_db_pathbuf = PathBuf::from(tmp_db_path);
    let conn = get_connection(&tmp_db_pathbuf)
        .expect("Failed to open database connection");
    ensure_schema_ready(&conn)
        .expect("Failed to initialize schema");
    let setup_time = setup_start.elapsed();

    println!("Database setup: {:?}", setup_time);

    // Benchmark: Import a real save file
    let save_path = "../test-data/saves/OW-Assyria-Year119-2025-11-02-10-50-56.zip";

    println!("Save file: {}", save_path);
    println!("File size: 742KB");
    println!("\nStarting import...\n");

    let import_start = Instant::now();

    let result = import_save_file(save_path, &conn, None, None, None, None, None)
        .expect("Import failed");

    let import_time = import_start.elapsed();

    println!("\n=== Results ===\n");
    println!("Total import time: {:?}", import_time);
    println!("Success: {}", result.success);
    println!("Match ID: {:?}", result.match_id);
    println!("Game ID: {}", result.game_id);

    let match_id = result.match_id.expect("Import should have returned a match_id");

    // Query database to verify import
    let verify_start = Instant::now();

    let player_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM players WHERE match_id = ?",
        [match_id],
        |row| row.get(0)
    ).expect("Failed to count players");

    let character_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM characters WHERE match_id = ?",
        [match_id],
        |row| row.get(0)
    ).expect("Failed to count characters");

    let city_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cities WHERE match_id = ?",
        [match_id],
        |row| row.get(0)
    ).expect("Failed to count cities");

    let tile_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tiles WHERE match_id = ?",
        [match_id],
        |row| row.get(0)
    ).expect("Failed to count tiles");

    let verify_time = verify_start.elapsed();

    println!("\nImported entities:");
    println!("  - {} players", player_count);
    println!("  - {} characters", character_count);
    println!("  - {} cities", city_count);
    println!("  - {} tiles", tile_count);

    println!("\nVerification queries: {:?}", verify_time);

    // Performance analysis
    println!("\n=== Performance Analysis ===\n");

    let import_ms = import_time.as_millis();
    println!("Import time: {}ms", import_ms);

    if import_ms > 0 {
        let entities_per_sec = ((player_count + character_count + city_count + tile_count) as f64
            / import_time.as_secs_f64()) as i64;
        println!("Throughput: {} entities/second", entities_per_sec);
    }

    // Cleanup
    drop(conn);
    std::fs::remove_file(tmp_db_path)
        .expect("Failed to clean up temporary database");

    println!("\nTemporary database cleaned up.");
    println!("\n=== Benchmark Complete ===\n");

    // Assert reasonable performance (should be under 10s for this save)
    assert!(import_time.as_millis() < 10000,
        "Import took {}ms, expected < 10s", import_time.as_millis());
}

#[test]
fn benchmark_multiple_imports() {
    // Benchmark importing 5 saves sequentially to measure average time
    let tmp_db_path = "/tmp/per-ankh-benchmark-multi.db";
    let _ = std::fs::remove_file(tmp_db_path);

    println!("\n=== Multiple Import Benchmark ===\n");

    let tmp_db_pathbuf = PathBuf::from(tmp_db_path);
    let conn = get_connection(&tmp_db_pathbuf)
        .expect("Failed to open database connection");
    ensure_schema_ready(&conn)
        .expect("Failed to initialize schema");

    // Pick several different save files from 2025
    let save_files = vec![
        "../test-data/saves/OW-Assyria-Year119-2025-11-02-10-50-56.zip",
        "../test-data/saves/OW-Rome-Year132-2025-11-01-16-13-00.zip",
        "../test-data/saves/OW-Rome-Year97-2025-10-09-00-13-02.zip",
        "../test-data/saves/OW-Assyria-Year134-2025-10-25-21-55-54.zip",
        "../test-data/saves/OW-Aksum-Year142-2025-08-03-21-01-35.zip",
    ];

    let mut import_times = Vec::new();

    for (idx, save_path) in save_files.iter().enumerate() {
        println!("Import {}/{}...", idx + 1, save_files.len());

        let start = Instant::now();
        let result = import_save_file(save_path, &conn, None, None, None, None, None)
            .expect(&format!("Failed to import {}", save_path));
        let elapsed = start.elapsed();

        import_times.push(elapsed);
        println!("  {} - {:?} (match_id: {:?})",
            save_path.split('/').last().unwrap(),
            elapsed,
            result.match_id
        );
    }

    // Calculate statistics
    let total_time: std::time::Duration = import_times.iter().sum();
    let avg_time = total_time / save_files.len() as u32;
    let min_time = import_times.iter().min().unwrap();
    let max_time = import_times.iter().max().unwrap();

    println!("\n=== Statistics ===\n");
    println!("Total time: {:?}", total_time);
    println!("Average time: {:?}", avg_time);
    println!("Min time: {:?}", min_time);
    println!("Max time: {:?}", max_time);

    // Extrapolate to larger batches
    let avg_ms = avg_time.as_millis();
    println!("\nExtrapolation:");
    println!("  10 saves: ~{}ms (~{:.1}s)", avg_ms * 10, avg_ms as f64 * 10.0 / 1000.0);
    println!("  76 saves: ~{}ms (~{:.1}s)", avg_ms * 76, avg_ms as f64 * 76.0 / 1000.0);
    println!("  266 saves: ~{}ms (~{:.1}s)", avg_ms * 266, avg_ms as f64 * 266.0 / 1000.0);

    // Cleanup
    drop(conn);
    std::fs::remove_file(tmp_db_path)
        .expect("Failed to clean up temporary database");

    println!("\n=== Benchmark Complete ===\n");
}
