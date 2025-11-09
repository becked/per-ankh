// Intermediate typed representation for parsed game data
//
// This module defines pure data structures that hold parsed XML data
// before database insertion. This separation enables:
// - Parallel parsing (no database dependency during parse)
// - Testability (verify parsed data without DB setup)
// - Caching/serialization (future: save parsed data to disk)
//
// Key design decisions:
// - Store XML IDs (not DB IDs) - IdMapper converts during insertion
// - Use Vec (not HashMap) - simpler, better for iteration/serialization
// - Derive Serialize/Deserialize - enables caching and testing
// - Use String (not Cow) initially - optimize later if memory profiling shows need

use serde::{Deserialize, Serialize};

/// Player entity data parsed from XML
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerData {
    // Core identity
    pub xml_id: i32,
    pub player_name: String,
    pub nation: Option<String>,
    pub dynasty: Option<String>,
    pub team_id: Option<String>,
    pub is_human: bool,

    // External identity
    pub online_id: Option<String>,
    pub email: Option<String>,

    // Game settings
    pub difficulty: Option<String>,

    // Game state
    pub last_turn_completed: Option<i32>,
    pub turn_ended: bool,

    // Political
    pub legitimacy: Option<i32>,
    pub succession_gender: Option<String>,
    pub state_religion: Option<String>,

    // Foreign keys (as XML IDs - converted to DB IDs during insertion)
    pub founder_character_xml_id: Option<i32>,
    pub chosen_heir_xml_id: Option<i32>,
    pub original_capital_city_xml_id: Option<i32>,

    // Resources
    pub time_stockpile: Option<i32>,

    // Research
    pub tech_researching: Option<String>,

    // Counters
    pub ambition_delay: i32,
    pub tiles_purchased: i32,
    pub state_religion_changes: i32,
    pub tribe_mercenaries_hired: i32,
}

/// Character entity data parsed from XML
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterData {
    // Core identity
    pub xml_id: i32,
    pub first_name: Option<String>,
    pub gender: Option<String>,

    // Affiliations
    pub player_xml_id: Option<i32>,
    pub tribe: Option<String>,
    pub family: Option<String>,
    pub nation: Option<String>,
    pub religion: Option<String>,

    // Life cycle
    pub birth_turn: i32,
    pub death_turn: Option<i32>,
    pub death_reason: Option<String>,

    // Parent relationships (XML IDs - NOT set here, updated in Pass 2)
    pub birth_father_xml_id: Option<i32>,
    pub birth_mother_xml_id: Option<i32>,
    pub birth_city_xml_id: Option<i32>,

    // Titles and roles
    pub cognomen: Option<String>,
    pub archetype: Option<String>,
    pub portrait: Option<String>,

    // Progression
    pub xp: i32,
    pub level: i32,

    // Status flags
    pub is_royal: bool,
    pub is_infertile: bool,

    // Leadership
    pub became_leader_turn: Option<i32>,
    pub abdicated_turn: Option<i32>,
    pub was_religion_head: bool,
    pub was_family_head: bool,
    pub nation_joined_turn: Option<i32>,

    // Other
    pub seed: Option<i64>,
}

/// Complete game save data (for future expansion)
///
/// Currently contains players and characters.
/// Will expand to include all entity types as migration progresses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameData {
    pub players: Vec<PlayerData>,
    pub characters: Vec<CharacterData>,
    // Future: cities, tiles, families, etc.
}
