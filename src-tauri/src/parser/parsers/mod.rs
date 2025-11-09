// Pure parsing functions (no database dependency)
//
// This module contains functions that parse XML into typed structs
// without touching the database. Benefits:
// - Can be tested without DB setup
// - Can be parallelized safely (no shared mutable state)
// - Can inspect/cache parsed data before insertion

pub mod players;

pub use players::parse_players_struct;
