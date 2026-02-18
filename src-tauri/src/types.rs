// Serializable response types for Tauri commands
//
// All types derive Serialize + TS for automatic TypeScript generation.
// The ts-rs export_to path resolves relative to the crate root (src-tauri/).

use crate::parser::ImportResult;
use serde::Serialize;
use ts_rs::TS;

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct NationStats {
    pub nation: String,
    #[ts(type = "number")]
    pub games_played: i64,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct GameStatistics {
    #[ts(type = "number")]
    pub total_games: i64,
    pub nations: Vec<NationStats>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct GameInfo {
    #[ts(type = "number")]
    pub match_id: i64,
    pub game_name: Option<String>,
    pub save_date: Option<String>,
    pub turn_year: Option<i32>,
    pub save_owner_nation: Option<String>,
    pub total_turns: Option<i32>,
    pub save_owner_won: Option<bool>,
    pub collection_id: i32,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerInfo {
    pub player_name: String,
    pub nation: Option<String>,
    pub is_human: bool,
    pub legitimacy: Option<i32>,
    pub state_religion: Option<String>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct GameDetails {
    #[ts(type = "number")]
    pub match_id: i64,
    pub game_name: Option<String>,
    pub save_date: Option<String>,
    pub total_turns: i32,
    pub map_size: Option<String>,
    pub map_width: Option<i32>,
    pub map_height: Option<i32>,
    pub map_class: Option<String>,
    pub game_mode: Option<String>,
    pub opponent_level: Option<String>,
    pub difficulty: Option<String>,
    pub victory_conditions: Option<String>,
    pub enabled_mods: Option<String>,
    pub enabled_dlc: Option<String>,
    #[ts(type = "number | null")]
    pub winner_player_id: Option<i64>,
    pub winner_name: Option<String>,
    pub winner_civilization: Option<String>,
    pub winner_victory_type: Option<String>,
    pub players: Vec<PlayerInfo>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerHistoryPoint {
    pub turn: i32,
    pub points: Option<i32>,
    pub military_power: Option<i32>,
    pub legitimacy: Option<i32>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerHistory {
    pub player_id: i32,
    pub player_name: String,
    pub nation: Option<String>,
    pub history: Vec<PlayerHistoryPoint>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct YieldDataPoint {
    pub turn: i32,
    /// Display value (already converted from fixed-point by dividing by 10)
    pub amount: Option<f64>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct YieldHistory {
    pub player_id: i32,
    pub player_name: String,
    pub nation: Option<String>,
    pub yield_type: String,
    pub data: Vec<YieldDataPoint>,
}

/// A single save date entry for the calendar chart
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct SaveDateEntry {
    /// Date in YYYY-MM-DD format
    pub date: String,
    /// Nation the save owner played as (e.g., "NATION_ROME")
    pub nation: Option<String>,
}

#[derive(Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct ImportProgress {
    /// Number of files processed so far
    #[ts(type = "number")]
    pub current: usize,
    /// Total number of files to import
    #[ts(type = "number")]
    pub total: usize,
    /// Name of the file currently being processed
    pub current_file: String,
    /// Milliseconds elapsed since import started
    #[ts(type = "number")]
    pub elapsed_ms: u64,
    /// Estimated milliseconds remaining
    #[ts(type = "number")]
    pub estimated_remaining_ms: u64,
    /// Import speed in files per second
    pub speed: f64,
    /// Result of the current file import (if completed)
    pub result: Option<ImportResult>,
    /// Current parsing phase within the file (e.g., "Parsing characters")
    pub current_phase: Option<String>,
    /// Progress within current file (0.0 to 1.0, where 1.0 = file complete)
    pub file_progress: Option<f64>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct FileImportError {
    pub file_name: String,
    pub error: String,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct BatchImportResult {
    #[ts(type = "number")]
    pub total_files: usize,
    #[ts(type = "number")]
    pub successful: usize,
    #[ts(type = "number")]
    pub failed: usize,
    #[ts(type = "number")]
    pub skipped: usize,
    pub errors: Vec<FileImportError>,
    #[ts(type = "number")]
    pub duration_ms: u64,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct NationDynastyRow {
    pub nation: Option<String>,
    pub dynasty: Option<String>,
    #[ts(type = "number")]
    pub count: i64,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct KnownOnlineId {
    pub online_id: String,
    pub player_names: Vec<String>,
    #[ts(type = "number")]
    pub save_count: i64,
}

/// Religion info with founder nation for map visualization
#[derive(Serialize, Clone, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct ReligionInfo {
    pub religion_name: String,
    pub founder_nation: Option<String>,
}

/// Tile data for map visualization
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct MapTile {
    pub x: i32,
    pub y: i32,
    pub terrain: Option<String>,
    pub height: Option<String>,
    pub vegetation: Option<String>,
    pub resource: Option<String>,
    pub improvement: Option<String>,
    pub improvement_pillaged: bool,
    pub has_road: bool,
    pub specialist: Option<String>,
    pub tribe_site: Option<String>,
    /// All religions present in this tile's city (up to 5)
    pub religions: Vec<ReligionInfo>,
    pub river_w: bool,
    pub river_sw: bool,
    pub river_se: bool,
    /// Resolved from owner_player_id -> players.nation
    pub owner_nation: Option<String>,
    /// Resolved from owner_city_id -> cities.city_name
    pub owner_city: Option<String>,
    /// True if this tile is a city center
    pub is_city_center: bool,
    /// True if this tile is a capital city center
    pub is_capital: bool,
    /// City ID for religion lookup (internal use)
    #[serde(skip)]
    #[ts(skip)]
    pub owner_city_id: Option<i64>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerDebugRow {
    #[ts(type = "number")]
    pub match_id: i64,
    pub player_name: String,
    pub nation: Option<String>,
    pub dynasty: Option<String>,
    pub is_human: bool,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct MatchDebugRow {
    #[ts(type = "number")]
    pub match_id: i64,
    pub game_id: String,
    pub game_name: Option<String>,
    pub file_name: String,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct StoryEvent {
    #[ts(type = "number")]
    pub event_id: i64,
    pub event_type: String,
    pub player_name: String,
    pub occurred_turn: i32,
    pub primary_character_name: Option<String>,
    pub city_name: Option<String>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct EventLog {
    #[ts(type = "number")]
    pub log_id: i64,
    pub log_type: String,
    pub turn: i32,
    pub player_name: Option<String>,
    pub description: Option<String>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct LawAdoptionDataPoint {
    pub turn: i32,
    pub law_count: i32,
    /// The name of the law adopted at this point (None for synthetic start/end points)
    pub law_name: Option<String>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct LawAdoptionHistory {
    pub player_id: i32,
    pub player_name: String,
    pub nation: Option<String>,
    pub data: Vec<LawAdoptionDataPoint>,
}

/// A single law entry for a player
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerLaw {
    pub player_id: i32,
    pub player_name: String,
    pub nation: Option<String>,
    pub law_category: String,
    pub law: String,
    pub adopted_turn: i32,
    pub change_count: i32,
}

/// A single data point in a tech discovery timeline
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct TechDiscoveryDataPoint {
    pub turn: i32,
    pub tech_count: i32,
    /// The name of the tech discovered at this point (None for synthetic start/end points)
    pub tech_name: Option<String>,
}

/// Tech discovery history for a player
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct TechDiscoveryHistory {
    pub player_id: i32,
    pub player_name: String,
    pub nation: Option<String>,
    pub data: Vec<TechDiscoveryDataPoint>,
}

/// A single completed tech entry for a player
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerTech {
    pub player_id: i32,
    pub player_name: String,
    pub nation: Option<String>,
    pub tech: String,
    pub completed_turn: i32,
}

/// Unit production data for the Military tab
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerUnitProduced {
    pub player_id: i32,
    pub player_name: String,
    pub nation: Option<String>,
    pub unit_type: String,
    pub count: i32,
}

/// City information for the Cities tab
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct CityInfo {
    #[ts(type = "number")]
    pub city_id: i64,
    pub city_name: String,
    pub owner_nation: Option<String>,
    pub family: Option<String>,
    pub founded_turn: i32,
    pub is_capital: bool,
    pub citizens: i32,
    pub governor_name: Option<String>,
    /// Culture level as string enum (CULTURE_WEAK, CULTURE_DEVELOPING, CULTURE_STRONG, CULTURE_ESTABLISHED, CULTURE_LEGENDARY)
    pub culture_level: Option<String>,
    pub growth_count: i32,
    pub unit_production_count: i32,
    pub specialist_count: i32,
    pub buy_tile_count: i32,
    pub hurry_civics_count: i32,
    pub hurry_money_count: i32,
    pub hurry_training_count: i32,
    pub hurry_population_count: i32,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct CityStatistics {
    pub cities: Vec<CityInfo>,
}

/// Single improvement with its city and owner information
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct ImprovementInfo {
    pub nation: Option<String>,
    pub city_name: Option<String>,
    pub improvement: String,
    pub specialist: Option<String>,
    pub resource: Option<String>,
}

/// Response for get_improvement_data command
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct ImprovementData {
    pub improvements: Vec<ImprovementInfo>,
}
