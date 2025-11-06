// Standalone CLI tool to import Old World save files
//
// Usage:
//   cargo run --example import_save -- path/to/savefile.zip
//   cargo run --example import_save -- path/to/savefile.zip --db path/to/database.db

use per_ankh_lib::db;
use per_ankh_lib::parser;
use std::env;
use std::path::PathBuf;

fn main() {
    // Initialize logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // Parse command-line arguments
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <save_file.zip> [--db database.db]", args[0]);
        eprintln!("\nExample:");
        eprintln!("  {} test-data/saves/OW-Babylonia-Year123-2024-01-31-22-44-04.zip", args[0]);
        eprintln!("  {} test-data/saves/OW-Greece-Year74-2022-01-02-20-28-07.zip --db custom.db", args[0]);
        std::process::exit(1);
    }

    let save_path = &args[1];

    // Determine database path
    let db_path = if args.len() > 3 && args[2] == "--db" {
        PathBuf::from(&args[3])
    } else {
        // Use default path in current directory
        PathBuf::from("per-ankh.db")
    };

    println!("=== Old World Save File Importer ===");
    println!("Save file: {}", save_path);
    println!("Database: {}", db_path.display());
    println!();

    // Initialize schema
    println!("Initializing database schema...");
    match db::ensure_schema_ready(&db_path) {
        Ok(_) => println!("✓ Schema ready"),
        Err(e) => {
            eprintln!("✗ Failed to initialize schema: {}", e);
            std::process::exit(1);
        }
    }

    // Open connection
    println!("Connecting to database...");
    let conn = match db::connection::get_connection(&db_path) {
        Ok(c) => {
            println!("✓ Connected");
            c
        }
        Err(e) => {
            eprintln!("✗ Failed to connect: {}", e);
            std::process::exit(1);
        }
    };

    // Clean up stale locks
    match db::connection::cleanup_stale_locks(&conn) {
        Ok(count) if count > 0 => println!("✓ Cleaned up {} stale locks", count),
        Ok(_) => {}
        Err(e) => {
            eprintln!("⚠ Failed to cleanup stale locks: {}", e);
        }
    }

    // Import save file
    println!("\nImporting save file...");
    println!("This may take a minute for large save files...\n");

    let start = std::time::Instant::now();
    match parser::import_save_file(save_path, &conn) {
        Ok(result) => {
            let elapsed = start.elapsed();

            if result.success {
                println!("\n✓ Import successful!");
                println!("  Match ID: {}", result.match_id.unwrap());
                println!("  Game ID: {}", result.game_id);
                println!("  Type: {}", if result.is_new { "New" } else { "Update" });
                println!("  Duration: {:.2}s", elapsed.as_secs_f64());

                // Query database to show what was imported
                println!("\n=== Import Summary ===");
                let match_id = result.match_id.unwrap();

                if let Ok(count) = conn.query_row::<i64, _, _>(
                    "SELECT COUNT(*) FROM players WHERE match_id = ?",
                    [match_id],
                    |row| row.get(0),
                ) {
                    println!("Players: {}", count);
                }

                if let Ok(count) = conn.query_row::<i64, _, _>(
                    "SELECT COUNT(*) FROM characters WHERE match_id = ?",
                    [match_id],
                    |row| row.get(0),
                ) {
                    println!("Characters: {}", count);
                }

                if let Ok(count) = conn.query_row::<i64, _, _>(
                    "SELECT COUNT(*) FROM cities WHERE match_id = ?",
                    [match_id],
                    |row| row.get(0),
                ) {
                    println!("Cities: {}", count);
                }

                if let Ok(count) = conn.query_row::<i64, _, _>(
                    "SELECT COUNT(*) FROM tiles WHERE match_id = ?",
                    [match_id],
                    |row| row.get(0),
                ) {
                    println!("Tiles: {}", count);
                }

                if let Ok(count) = conn.query_row::<i64, _, _>(
                    "SELECT COUNT(*) FROM tribes WHERE match_id = ?",
                    [match_id],
                    |row| row.get(0),
                ) {
                    println!("Tribes: {}", count);
                }

                if let Ok(count) = conn.query_row::<i64, _, _>(
                    "SELECT COUNT(*) FROM diplomacy WHERE match_id = ?",
                    [match_id],
                    |row| row.get(0),
                ) {
                    println!("Diplomacy relations: {}", count);
                }

                if let Ok(count) = conn.query_row::<i64, _, _>(
                    "SELECT COUNT(*) FROM military_history WHERE match_id = ?",
                    [match_id],
                    |row| row.get(0),
                ) {
                    println!("Military history records: {}", count);
                }

                if let Ok(count) = conn.query_row::<i64, _, _>(
                    "SELECT COUNT(*) FROM character_traits WHERE match_id = ?",
                    [match_id],
                    |row| row.get(0),
                ) {
                    println!("Character traits: {}", count);
                }

                println!("\nDatabase location: {}", db_path.display());
            } else {
                println!("\n✗ Import failed!");
                if let Some(error) = result.error {
                    println!("Error: {}", error);
                }
                std::process::exit(1);
            }
        }
        Err(e) => {
            println!("\n✗ Import failed!");
            println!("Error: {}", e);
            std::process::exit(1);
        }
    }
}
