// Database insertion functions for parsed game data
//
// This module contains functions that take parsed structs and insert them
// into the database. Separated from parsing to enable:
// - Pure parsing functions (testable without DB)
// - Validation before insertion
// - Future: multi-pass insertion for FK dependencies

pub mod players;

pub use players::insert_players;
