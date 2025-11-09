// Database insertion functions for parsed game data
//
// This module contains functions that take parsed structs and insert them
// into the database. Separated from parsing to enable:
// - Pure parsing functions (testable without DB)
// - Validation before insertion
// - Future: multi-pass insertion for FK dependencies

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
pub use characters::insert_characters_core;
pub use cities::insert_cities;
pub use players::insert_players;
pub use tiles::insert_tiles_core;

// Batch 2 exports
pub use families::insert_families;
pub use religions::insert_religions;
pub use tribes::insert_tribes;
pub use unit_production::{insert_city_units_produced, insert_player_units_produced};

// Batch 3 exports
pub use character_data::{
    insert_character_marriages, insert_character_relationships, insert_character_stats,
    insert_character_traits,
};
