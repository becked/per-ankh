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
