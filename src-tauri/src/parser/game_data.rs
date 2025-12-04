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
    pub is_save_owner: bool,

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
    pub last_owner_player_xml_id: Option<i32>,

    // Status
    pub is_capital: bool,

    // Population
    pub citizens: i32,

    // Leadership (character XML IDs)
    pub governor_xml_id: Option<i32>,
    pub governor_turn: Option<i32>,

    // Production and economy
    pub hurry_civics_count: i32,
    pub hurry_money_count: i32,
    pub hurry_training_count: i32,
    pub hurry_population_count: i32,
    pub specialist_count: i32,
    pub growth_count: i32,
    pub unit_production_count: i32,
    pub buy_tile_count: i32,
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

    // Specialists
    pub specialist: Option<String>,

    // Infrastructure
    pub has_road: bool,

    // Ownership (XML IDs)
    pub owner_player_xml_id: Option<i32>,
    // Note: owner_city_id is NOT set during parsing - it will be populated in Pass 2b

    // Sites
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

/// City project completion counts from <ProjectCount> element
/// Note: Distinct from CityProjectCompleted which parses <CompletedBuild>
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityProjectCount {
    pub city_xml_id: i32,
    pub project_type: String, // e.g., "PROJECT_WALLS"
    pub count: i32,
}

/// Enemy agent/spy in a city (AgentTurn/AgentCharacterID/AgentTileID elements)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityEnemyAgent {
    pub city_xml_id: i32,
    pub enemy_player_xml_id: i32,
    pub agent_character_xml_id: Option<i32>,
    pub placed_turn: Option<i32>,
    pub agent_tile_xml_id: Option<i32>,
}

/// City luxury import history (LuxuryTurn element)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityLuxury {
    pub city_xml_id: i32,
    pub resource: String, // e.g., "RESOURCE_FUR"
    pub imported_turn: i32,
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
    /// Culture level as string enum (CULTURE_WEAK, CULTURE_DEVELOPING, CULTURE_STRONG, CULTURE_ESTABLISHED, CULTURE_LEGENDARY)
    pub culture_level: Option<String>,
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

/// Unit entity data parsed from XML (nested within Tile elements)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitData {
    pub xml_id: i32,
    pub tile_xml_id: i32,
    pub unit_type: String,
    pub player_xml_id: Option<i32>,
    pub tribe: Option<String>,
    pub xp: Option<i32>,
    pub level: Option<i32>,
    pub create_turn: Option<i32>,
    pub facing: Option<String>,
    pub original_player_xml_id: Option<i32>,
    pub turns_since_last_move: Option<i32>,
    pub gender: Option<String>,
    pub is_sleeping: bool,
    pub current_formation: Option<String>,
    pub seed: Option<i64>,
}

/// Unit promotion (acquired or available)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitPromotion {
    pub unit_xml_id: i32,
    pub promotion: String,
    pub is_acquired: bool,
}

/// Unit effect bonus
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitEffect {
    pub unit_xml_id: i32,
    pub effect: String,
    pub stacks: i32,
}

/// Unit family association
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitFamily {
    pub unit_xml_id: i32,
    pub player_xml_id: i32,
    pub family_name: String,
}

/// Player resource stockpile (YieldStockpile element)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerResource {
    pub player_xml_id: i32,
    pub yield_type: String,
    pub amount: i32,
}

/// Technology research progress (TechProgress element)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TechnologyProgress {
    pub player_xml_id: i32,
    pub tech: String,
    pub progress: i32,
}

/// Completed technologies (TechCount element)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TechnologyCompleted {
    pub player_xml_id: i32,
    pub tech: String,
    pub completed_turn: Option<i32>,
}

/// Technology state (TechAvailable, TechPassed, TechTrashed, TechLocked, TechTarget elements)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TechnologyState {
    pub player_xml_id: i32,
    pub tech: String,
    pub state: String, // "available", "passed", "trashed", "locked", "targeted"
}

/// Player council positions (CouncilCharacter element)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerCouncil {
    pub player_xml_id: i32,
    pub position: String,
    pub character_xml_id: i32,
    pub appointed_turn: Option<i32>,
}

/// Active laws (ActiveLaw element)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Law {
    pub player_xml_id: i32,
    pub law_category: String,
    pub law: String,
    pub adopted_turn: i32,
    pub change_count: i32,
}

/// Player goals (GoalList element)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerGoal {
    pub player_xml_id: i32,
    pub goal_xml_id: i32,
    pub goal_type: String,
    pub leader_character_xml_id: Option<i32>,
    pub started_turn: i32,
    pub completed_turn: Option<i32>,
    pub failed_turn: Option<i32>,
    pub max_turns: Option<i32>,
    pub progress: i32,
    pub goal_state: Option<String>, // JSON-serialized stats
}

/// Diplomacy relation between entities (player-player or player-tribe)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiplomacyRelation {
    pub entity1_type: String,         // "player" or "tribe"
    pub entity1_id: String,           // XML ID as string (e.g., "0", "TRIBE_REBELS")
    pub entity2_type: String,         // "player" or "tribe"
    pub entity2_id: String,           // XML ID as string
    pub relation: String,             // e.g., "DIPLOMACY_WAR", "DIPLOMACY_PEACE"
    pub war_score: Option<i32>,
    pub last_conflict_turn: Option<i32>,
    pub last_diplomacy_turn: Option<i32>,
    pub diplomacy_blocked_until_turn: Option<i32>,
}

/// Game-level yield price history (sparse timeseries)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YieldPriceHistory {
    pub turn: i32,
    pub yield_type: String,  // e.g., "YIELD_GROWTH", "YIELD_CIVICS"
    pub price: i32,
}

/// Player military power history (sparse timeseries)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MilitaryPowerHistory {
    pub player_xml_id: i32,
    pub turn: i32,
    pub military_power: i32,
}

/// Player points history (sparse timeseries)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointsHistory {
    pub player_xml_id: i32,
    pub turn: i32,
    pub points: i32,
}

/// Player legitimacy history (sparse timeseries)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegitimacyHistory {
    pub player_xml_id: i32,
    pub turn: i32,
    pub legitimacy: i32,
}

/// Player yield rate history per yield type (sparse timeseries)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YieldRateHistory {
    pub player_xml_id: i32,
    pub turn: i32,
    pub yield_type: String,  // e.g., "YIELD_GROWTH", "YIELD_CIVICS"
    pub amount: i32,
}

/// Player family opinion history per family (sparse timeseries)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyOpinionHistory {
    pub player_xml_id: i32,
    pub family_name: String,  // e.g., "FAMILY_BARCID"
    pub turn: i32,
    pub opinion: i32,
}

/// Player religion opinion history per religion (sparse timeseries)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReligionOpinionHistory {
    pub player_xml_id: i32,
    pub religion_name: String,  // e.g., "RELIGION_JUDAISM"
    pub turn: i32,
    pub opinion: i32,
}

/// Story event data parsed from EventStoryTurn elements
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventStory {
    pub event_type: String,          // e.g., "EVENTSTORY_CULTURE_PAID_FUNCTION"
    pub player_xml_id: i32,           // Player who experienced the event
    pub occurred_turn: i32,           // Turn when event occurred
    pub primary_character_xml_id: Option<i32>, // Character involved (if any)
    pub city_xml_id: Option<i32>,     // City involved (if any)
}

/// Event log entry from PermanentLogList/LogData
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventLog {
    pub player_xml_id: i32,
    pub log_type: String,             // e.g., "TECH_DISCOVERED"
    pub turn: i32,
    pub description: Option<String>,  // Text description with HTML tags
    pub data1: Option<i32>,
    pub data2: Option<i32>,
    pub data3: Option<i32>,
}

/// Player memory data from MemoryList/MemoryData
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryData {
    pub player_xml_id: i32,
    pub memory_type: String,          // e.g., "MEMORYPLAYER_ATTACKED_CITY"
    pub turn: i32,
    pub target_player_xml_id: Option<i32>,
    pub target_character_xml_id: Option<i32>,
    pub target_family: Option<String>,
    pub target_tribe: Option<String>,
    pub target_religion: Option<String>,
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
    pub city_project_counts: Vec<CityProjectCount>,
    pub city_enemy_agents: Vec<CityEnemyAgent>,
    pub city_luxuries: Vec<CityLuxury>,
    pub city_yields: Vec<CityYield>,
    pub city_religions: Vec<CityReligion>,
    pub city_culture: Vec<CityCulture>,
    pub tile_visibility: Vec<TileVisibility>,
    pub tile_changes: Vec<TileChange>,
    pub units: Vec<UnitData>,
    pub unit_promotions: Vec<UnitPromotion>,
    pub unit_effects: Vec<UnitEffect>,
    pub unit_families: Vec<UnitFamily>,
    pub player_resources: Vec<PlayerResource>,
    pub technology_progress: Vec<TechnologyProgress>,
    pub technologies_completed: Vec<TechnologyCompleted>,
    pub technology_states: Vec<TechnologyState>,
    pub player_council: Vec<PlayerCouncil>,
    pub laws: Vec<Law>,
    pub player_goals: Vec<PlayerGoal>,
    pub diplomacy_relations: Vec<DiplomacyRelation>,

    // Timeseries data
    pub yield_price_history: Vec<YieldPriceHistory>,
    pub military_power_history: Vec<MilitaryPowerHistory>,
    pub points_history: Vec<PointsHistory>,
    pub legitimacy_history: Vec<LegitimacyHistory>,
    pub yield_rate_history: Vec<YieldRateHistory>,
    pub family_opinion_history: Vec<FamilyOpinionHistory>,
    pub religion_opinion_history: Vec<ReligionOpinionHistory>,

    // Events data
    pub event_stories: Vec<EventStory>,
    pub event_logs: Vec<EventLog>,
    pub memory_data: Vec<MemoryData>,
}
