// Benchmark for parallel parsing performance
//
// Usage: cargo run --release --bin benchmark_parsing -- <path-to-save-file.xml>

use per_ankh_lib::parser::xml_loader::XmlDocument;
use per_ankh_lib::parser::parsers;
use std::env;
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <path-to-save-file.xml>", args[0]);
        std::process::exit(1);
    }

    let save_path = &args[1];
    println!("\n🔍 Loading save file: {}", save_path);

    // Load XML document
    let load_start = Instant::now();
    let xml_content = std::fs::read_to_string(save_path)?;
    let doc = per_ankh_lib::parser::xml_loader::parse_xml(xml_content)?;
    let load_time = load_start.elapsed();
    println!("✅ XML loaded and parsed in {:?}", load_time);

    println!("\n📊 Running parallel parsing benchmark...\n");

    // Benchmark 1: Foundation entities (4-way parallel)
    let foundation_start = Instant::now();
    let (players, characters, cities, tiles) =
        parsers::parse_foundation_entities_parallel(&doc)?;
    let foundation_time = foundation_start.elapsed();

    println!("Foundation entities parsed:");
    println!("  - Players: {}", players.len());
    println!("  - Characters: {}", characters.len());
    println!("  - Cities: {}", cities.len());
    println!("  - Tiles: {}", tiles.len());
    println!("  ⏱️  Time: {:?}", foundation_time);

    // Benchmark 2: Affiliation entities (3-way parallel)
    let affiliation_start = Instant::now();
    let (families, religions, tribes) =
        parsers::parse_affiliation_entities_parallel(&doc)?;
    let affiliation_time = affiliation_start.elapsed();

    println!("\nAffiliation entities parsed:");
    println!("  - Families: {}", families.len());
    println!("  - Religions: {}", religions.len());
    println!("  - Tribes: {}", tribes.len());
    println!("  ⏱️  Time: {:?}", affiliation_time);

    // Summary
    let total_parse_time = foundation_time + affiliation_time;
    println!("\n📈 Summary:");
    println!("  XML Load: {:?}", load_time);
    println!("  Parallel Parsing: {:?}", total_parse_time);
    println!("    - Foundation: {:?}", foundation_time);
    println!("    - Affiliation: {:?}", affiliation_time);
    println!("  Total: {:?}", load_time + total_parse_time);

    println!("\n✅ Benchmark complete!");
    println!("\nNote: Expected speedup is 2-2.5x compared to sequential parsing.");
    println!("      Run with sequential parser to compare (not yet implemented).");

    Ok(())
}
