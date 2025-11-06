// Entity parsers for Old World save game data
//
// This module contains parsers for all game entities following the plan's
// two-pass strategy:
// - Pass 1: Core entity data (this module)
// - Pass 2: Relationships and derived data (separate module)

pub mod players;
pub mod characters;
pub mod cities;
pub mod tiles;
pub mod families;
pub mod religions;
pub mod tribes;
pub mod unit_production;
pub mod player_data;
pub mod diplomacy;
pub mod timeseries;
pub mod character_data;
pub mod city_data;
pub mod tile_data;
pub mod events;

pub use players::parse_players;
pub use characters::parse_characters_core;
pub use cities::parse_cities;
pub use tiles::parse_tiles;
pub use families::parse_families;
pub use religions::parse_religions;
pub use tribes::parse_tribes;
pub use unit_production::{parse_player_units_produced, parse_city_units_produced};
pub use player_data::{
    parse_player_resources, parse_technology_progress, parse_technologies_completed,
    parse_technology_states, parse_player_council, parse_laws, parse_player_goals,
};
pub use diplomacy::parse_diplomacy;
pub use timeseries::{parse_game_yield_prices, parse_player_timeseries};
pub use character_data::{
    parse_character_extended_data, parse_character_parent_relationships,
    parse_character_birth_city,
};
pub use city_data::parse_city_extended_data;
pub use tile_data::parse_tile_extended_data;
pub use events::{parse_player_events, parse_character_events, parse_city_events, parse_player_log_events, parse_player_memories};
