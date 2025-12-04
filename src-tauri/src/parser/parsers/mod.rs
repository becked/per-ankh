// Pure parsing functions (no database dependency)
//
// This module contains functions that parse XML into typed structs
// without touching the database. Benefits:
// - Can be tested without DB setup
// - Can be parallelized safely (no shared mutable state)
// - Can inspect/cache parsed data before insertion

// Batch 1 - Foundation entities
pub mod characters;
pub mod cities;
pub mod players;
pub mod tiles;

// Batch 2 - Affiliation and aggregate entities
pub mod families;
pub mod religions;
pub mod tribes;
pub mod unit_production;

// Batch 3 - Extended and nested data
pub mod character_data;
pub mod city_data;
pub mod diplomacy;
pub mod events;
pub mod player_data;
pub mod tile_data;
pub mod timeseries;
pub mod units;

// Batch 1 exports
pub use characters::parse_characters_struct;
pub use cities::parse_cities_struct;
pub use players::parse_players_struct;
pub use tiles::parse_tiles_struct;

// Batch 2 exports
pub use families::parse_families_struct;
pub use religions::parse_religions_struct;
pub use tribes::parse_tribes_struct;
pub use unit_production::{parse_city_units_produced, parse_player_units_produced};

// Batch 3 exports
pub use character_data::parse_all_character_data_struct;
pub use city_data::{
    parse_city_culture_struct, parse_city_enemy_agents_struct, parse_city_luxuries_struct,
    parse_city_production_queue_struct, parse_city_project_counts_struct,
    parse_city_projects_completed_struct, parse_city_religions_struct, parse_city_yields_struct,
};
pub use diplomacy::parse_diplomacy_relations;
pub use events::parse_events_struct;
pub use player_data::parse_all_player_data;
pub use tile_data::{parse_tile_changes_struct, parse_tile_visibility_struct};
pub use timeseries::{parse_all_player_timeseries, parse_yield_price_history_struct};
pub use units::parse_units_struct;

// Parallel parsing orchestration
use crate::parser::game_data::{CharacterData, CityData, FamilyData, PlayerData, ReligionData, TileData, TribeData};
use crate::parser::xml_loader::XmlDocument;
use crate::parser::Result;
use std::time::Instant;

/// Parse foundation entities in parallel using rayon
///
/// Returns a tuple of (players, characters, cities, tiles) parsed concurrently.
/// This is the main performance optimization - parsing these 4 large entities
/// in parallel provides ~2x speedup on the parsing phase.
pub fn parse_foundation_entities_parallel(
    doc: &XmlDocument,
) -> Result<(Vec<PlayerData>, Vec<CharacterData>, Vec<CityData>, Vec<TileData>)> {
    log::info!("Parsing foundation entities (parallel)...");
    let t_start = Instant::now();

    // Parse 4 entities in parallel using flattened rayon::join (reduces stack depth)
    let ((players_res, characters_res), (cities_res, tiles_res)) = rayon::join(
        || {
            rayon::join(
                || {
                    let t = Instant::now();
                    let result = parse_players_struct(doc);
                    log::debug!("  parse_players_struct: {:?}", t.elapsed());
                    result
                },
                || {
                    let t = Instant::now();
                    let result = parse_characters_struct(doc);
                    log::debug!("  parse_characters_struct: {:?}", t.elapsed());
                    result
                },
            )
        },
        || {
            rayon::join(
                || {
                    let t = Instant::now();
                    let result = parse_cities_struct(doc);
                    log::debug!("  parse_cities_struct: {:?}", t.elapsed());
                    result
                },
                || {
                    let t = Instant::now();
                    let result = parse_tiles_struct(doc);
                    log::debug!("  parse_tiles_struct: {:?}", t.elapsed());
                    result
                },
            )
        },
    );

    let players = players_res?;
    let characters = characters_res?;
    let cities = cities_res?;
    let tiles = tiles_res?;

    let total = t_start.elapsed();
    log::info!("⏱️  Parallel foundation parsing: {:?}", total);

    Ok((players, characters, cities, tiles))
}

/// Parse affiliation entities in parallel using rayon
///
/// Returns a tuple of (families, religions, tribes) parsed concurrently.
pub fn parse_affiliation_entities_parallel(
    doc: &XmlDocument,
) -> Result<(Vec<FamilyData>, Vec<ReligionData>, Vec<TribeData>)> {
    log::info!("Parsing affiliation entities (parallel)...");
    let t_start = Instant::now();

    // Parse 3 entities in parallel using nested rayon::join
    let (families_res, (religions_res, tribes_res)) = rayon::join(
        || {
            let t = Instant::now();
            let result = parse_families_struct(doc);
            log::debug!("  parse_families_struct: {:?}", t.elapsed());
            result
        },
        || rayon::join(
            || {
                let t = Instant::now();
                let result = parse_religions_struct(doc);
                log::debug!("  parse_religions_struct: {:?}", t.elapsed());
                result
            },
            || {
                let t = Instant::now();
                let result = parse_tribes_struct(doc);
                log::debug!("  parse_tribes_struct: {:?}", t.elapsed());
                result
            },
        ),
    );

    let families = families_res?;
    let religions = religions_res?;
    let tribes = tribes_res?;

    let total = t_start.elapsed();
    log::info!("⏱️  Parallel affiliation parsing: {:?}", total);

    Ok((families, religions, tribes))
}
