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

/// City entity data parsed from XML
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityData {
    // Core identity
    pub xml_id: i32,
    pub city_name: String,
    pub founded_turn: i32,

    // Ownership
    pub player_xml_id: Option<i32>,
    pub tile_xml_id: i32,
    pub family: Option<String>,
    pub first_owner_player_xml_id: Option<i32>,

    // Status
    pub is_capital: bool,

    // Population
    pub citizens: i32,
    pub growth_progress: i32,

    // Leadership (character XML IDs)
    pub governor_xml_id: Option<i32>,
    pub general_xml_id: Option<i32>,
    pub agent_xml_id: Option<i32>,

    // Production
    pub hurry_civics_count: i32,
    pub hurry_money_count: i32,
    pub specialist_count: i32,
}

/// Tile entity data parsed from XML
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileData {
    // Core identity
    pub xml_id: i32,
    pub x: i32,
    pub y: i32,

    // Terrain
    pub terrain: Option<String>,
    pub height: Option<String>,
    pub vegetation: Option<String>,

    // Rivers (hex directions)
    pub river_w: bool,
    pub river_sw: bool,
    pub river_se: bool,

    // Resources and improvements
    pub resource: Option<String>,
    pub improvement: Option<String>,
    pub improvement_pillaged: bool,
    pub improvement_disabled: bool,
    pub improvement_turns_left: Option<i32>,
    pub improvement_develop_turns: i32,

    // Specialists
    pub specialist: Option<String>,

    // Infrastructure
    pub has_road: bool,

    // Ownership (XML IDs)
    pub owner_player_xml_id: Option<i32>,
    // Note: owner_city_id is NOT set during parsing - it will be populated in Pass 2b

    // Sites
    pub is_city_site: bool,
    pub tribe_site: Option<String>,

    // Religion
    pub religion: Option<String>,

    // Seeds
    pub init_seed: Option<i64>,
    pub turn_seed: Option<i64>,
}

/// Family entity data parsed from XML
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyData {
    // Families don't have XML IDs - we generate stable IDs from names
    pub family_name: String,
    pub family_class: String,
    pub player_xml_id: i32,

    // Leadership and status (XML IDs)
    pub head_character_xml_id: Option<i32>,
    pub seat_city_xml_id: Option<i32>,
    pub turns_without_leader: i32,
}

/// Religion entity data parsed from XML
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReligionData {
    // Religions don't have XML IDs - identified by name
    pub religion_name: String,
    pub founded_turn: Option<i32>,

    // Leadership and status (XML IDs)
    pub founder_player_xml_id: Option<i32>,
    pub head_character_xml_id: Option<i32>,
    pub holy_city_xml_id: Option<i32>,
}

/// Tribe entity data parsed from XML
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TribeData {
    // Tribes use string IDs like "TRIBE_REBELS"
    pub tribe_id: String,

    // Leadership and alliances (XML IDs)
    pub leader_character_xml_id: Option<i32>,
    pub allied_player_xml_id: Option<i32>,
    pub religion: Option<String>,
}

/// Player unit production data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerUnitProduction {
    pub player_xml_id: i32,
    pub unit_type: String,
    pub count: i32,
}

/// City unit production data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityUnitProduction {
    pub city_xml_id: i32,
    pub unit_type: String,
    pub count: i32,
}

/// Character stat data (Rating and Stat elements combined)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterStat {
    pub character_xml_id: i32,
    pub stat_name: String,
    pub stat_value: i32,
}

/// Character trait data (TraitTurn element)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterTrait {
    pub character_xml_id: i32,
    pub trait_name: String,
    pub acquired_turn: i32,
    pub removed_turn: Option<i32>,
}

/// Character relationship data (RelationshipList element)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterRelationship {
    pub character_xml_id: i32,
    pub related_character_xml_id: i32,
    pub relationship_type: String,
    pub relationship_value: Option<i32>,
    pub started_turn: Option<i32>,
    pub ended_turn: Option<i32>,
}

/// Character marriage data (Spouses element)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterMarriage {
    pub character_xml_id: i32,
    pub spouse_xml_id: i32,
    pub married_turn: i32,
    pub divorced_turn: Option<i32>,
}

/// City production queue item (BuildQueue element)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityProductionItem {
    pub city_xml_id: i32,
    pub queue_position: i32,
    pub build_type: String,
    pub item_type: String,
    pub progress: i32,
    pub is_repeat: bool,
}

/// City completed project (CompletedBuild element, aggregated)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityProjectCompleted {
    pub city_xml_id: i32,
    pub project_type: String,
    pub count: i32,
}

/// City yield progress (YieldProgress element)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityYield {
    pub city_xml_id: i32,
    pub yield_type: String,
    pub progress: i32,
}

/// City religion (Religion element)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityReligion {
    pub city_xml_id: i32,
    pub religion: String,
}

/// City culture and happiness per team (TeamCulture and TeamHappinessLevel elements)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityCulture {
    pub city_xml_id: i32,
    pub team_id: i32,
    pub culture_level: i32,
    pub happiness_level: i32,
}

/// Tile visibility data (RevealedTurn and RevealedOwner elements)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileVisibility {
    pub tile_xml_id: i32,
    pub team_id: i32,
    pub revealed_turn: i32,
    pub visible_owner_player_xml_id: Option<i32>,
}

/// Tile change history (TerrainHistory and VegetationHistory elements)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileChange {
    pub tile_xml_id: i32,
    pub turn: i32,
    pub change_type: String, // "terrain" or "vegetation"
    pub new_value: String,
}

/// Complete game save data (for future expansion)
///
/// Currently contains players, characters, cities, and Batch 2 entities.
/// Will expand to include all entity types as migration progresses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameData {
    // Batch 1 - Foundation entities
    pub players: Vec<PlayerData>,
    pub characters: Vec<CharacterData>,
    pub cities: Vec<CityData>,

    // Batch 2 - Affiliation and aggregate entities
    pub families: Vec<FamilyData>,
    pub religions: Vec<ReligionData>,
    pub tribes: Vec<TribeData>,
    pub player_units_produced: Vec<PlayerUnitProduction>,
    pub city_units_produced: Vec<CityUnitProduction>,

    // Batch 3 - Extended and nested data
    pub character_stats: Vec<CharacterStat>,
    pub character_traits: Vec<CharacterTrait>,
    pub character_relationships: Vec<CharacterRelationship>,
    pub character_marriages: Vec<CharacterMarriage>,
    pub city_production_queue: Vec<CityProductionItem>,
    pub city_projects_completed: Vec<CityProjectCompleted>,
    pub city_yields: Vec<CityYield>,
    pub city_religions: Vec<CityReligion>,
    pub city_culture: Vec<CityCulture>,
    pub tile_visibility: Vec<TileVisibility>,
    pub tile_changes: Vec<TileChange>,

    // Future: tiles, player_data, diplomacy, timeseries, events
}
