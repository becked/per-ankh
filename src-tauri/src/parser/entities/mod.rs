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
