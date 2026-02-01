-- Old World Game Data Schema v2.11
-- DuckDB Schema for Multi-Match Game Save Analysis
--
-- Design Principles:
-- - Clean greenfield design (no legacy compatibility)
-- - Stores data from multiple XML save files
-- - ~85% coverage of XML data structures
-- - XML-first terminology (Tile not Territory, Character not Ruler)
-- - Relationships documented in comments (FK constraints removed for ETL performance)
-- - Optimized for analytical queries across matches
--
-- Coverage: Characters, Units, Families, Religions, Laws, Diplomacy,
--           Production, Events, Time-series, Politics, Narrative

-- ============================================================================
-- SECTION 1: MATCH IDENTITY & ID MAPPING
-- ============================================================================
-- Core match/game identification and configuration

-- ID Mapping Table for Stable Database IDs
-- Preserves XML→DB ID mappings across re-imports to maintain referential integrity
CREATE TABLE id_mappings (
    match_id BIGINT NOT NULL,
    entity_type VARCHAR NOT NULL,  -- 'player', 'character', 'city', 'unit', 'tile', 'family', 'religion', 'tribe'
    xml_id INTEGER NOT NULL,
    db_id BIGINT NOT NULL,
    PRIMARY KEY (match_id, entity_type, xml_id)
);

-- INDEXES DISABLED: Testing if index corruption is the issue (GitHub #13)
-- CREATE INDEX idx_id_mappings_match ON id_mappings(match_id);
-- CREATE INDEX idx_id_mappings_lookup ON id_mappings(match_id, entity_type, xml_id);

-- Lock table for cross-process synchronization during imports
-- Prevents multiple app instances from corrupting data when importing same GameId
CREATE TABLE match_locks (
    game_id VARCHAR NOT NULL PRIMARY KEY,
    locked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_by INTEGER, -- Process ID for debugging
    CONSTRAINT unique_game_lock UNIQUE (game_id)
);

-- CREATE INDEX idx_match_locks_stale ON match_locks(locked_at);

-- Collections for organizing matches (e.g., "Personal", "Challenge Games")
-- Allows filtering stats and preventing player name pollution in Primary User detection
-- Sequence starts at 2 because ID 1 is reserved for the default collection
CREATE SEQUENCE collections_id_seq START 2;

CREATE TABLE collections (
    collection_id INTEGER PRIMARY KEY DEFAULT nextval('collections_id_seq'),
    name VARCHAR NOT NULL UNIQUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE
);

-- Seed default collection with explicit ID 1
INSERT INTO collections (collection_id, name, is_default) VALUES (1, 'Personal', TRUE);

CREATE TABLE matches (
    match_id BIGINT NOT NULL PRIMARY KEY,
    file_name VARCHAR NOT NULL,
    file_hash VARCHAR NOT NULL UNIQUE,
    game_name VARCHAR,
    game_id VARCHAR NOT NULL, -- XML GameId (UUID) - each campaign has unique ID
    save_date TIMESTAMP,
    processed_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Map configuration
    map_width INTEGER,
    map_height INTEGER,
    map_size VARCHAR, -- MAPSIZE_TINY, MAPSIZE_SMALL, etc.
    map_class VARCHAR, -- MAPCLASS_MapScriptContinent, etc.
    map_aspect_ratio VARCHAR,
    min_latitude INTEGER,
    max_latitude INTEGER,
    -- Game settings
    game_mode VARCHAR, -- NETWORK, SINGLEPLAYER, etc.
    turn_style VARCHAR,
    turn_timer VARCHAR,
    turn_scale VARCHAR,
    simultaneous_turns INTEGER,
    -- Difficulty and balance
    opponent_level VARCHAR,
    tribe_level VARCHAR,
    development VARCHAR,
    advantage VARCHAR,
    -- Rules
    succession_gender VARCHAR,
    succession_order VARCHAR,
    mortality VARCHAR,
    event_level VARCHAR,
    victory_point_modifier VARCHAR,
    force_march VARCHAR,
    team_nation VARCHAR,
    -- Victory
    victory_conditions VARCHAR, -- Serialized list
    total_turns INTEGER NOT NULL, -- Turn number from save - identifies snapshot
    winner_player_id BIGINT,
    winner_victory_type VARCHAR, -- Victory type used to win (e.g., VICTORY_CONQUEST)
    -- Seeds for analysis
    first_seed BIGINT,
    map_seed BIGINT,
    -- Version information
    game_version VARCHAR, -- Game version number (e.g., "1.0.70671")
    enabled_mods TEXT, -- Mod list from Version string (e.g., "name-every-child1+different-leaders1")
    enabled_dlc TEXT, -- DLC list from GameContent (e.g., "DLC_HEROES_OF_AEGEAN+DLC_THE_SACRED_AND_THE_PROFANE")
    -- Collection for organizing matches
    collection_id INTEGER NOT NULL DEFAULT 1,  -- References: collections(collection_id)
    -- Uniqueness: Each (game_id, turn) pair is a unique snapshot
    UNIQUE (game_id, total_turns)
);

-- CREATE INDEX idx_matches_collection ON matches(collection_id);

-- User settings for save owner identification
CREATE TABLE user_settings (
    key VARCHAR NOT NULL PRIMARY KEY,
    value VARCHAR
);

CREATE TABLE match_settings (
    setting_id BIGINT NOT NULL PRIMARY KEY,
    match_id BIGINT NOT NULL,  -- References: matches(match_id)
    setting_type VARCHAR NOT NULL, -- 'game_option', 'dlc_content', 'map_option', 'occurrence_level'
    setting_key VARCHAR NOT NULL,
    setting_value VARCHAR
);

-- Useful view for match overview
CREATE VIEW match_summary AS
SELECT
    m.match_id,
    m.game_name,
    m.save_date,
    m.total_turns,
    m.map_size,
    m.victory_conditions,
    COUNT(DISTINCT p.player_id) as player_count,
    wp.player_name as winner_name,
    wp.nation as winner_civilization
FROM matches m
LEFT JOIN players p ON m.match_id = p.match_id
LEFT JOIN players wp ON m.match_id = wp.match_id AND m.winner_player_id = wp.player_id
GROUP BY m.match_id, m.game_name, m.save_date, m.total_turns,
         m.map_size, m.victory_conditions, wp.player_name, wp.nation;


-- ============================================================================
-- SECTION 2: PLAYERS
-- ============================================================================

CREATE TABLE players (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,  -- References: matches(match_id)
    xml_id INTEGER,  -- Original XML Player ID for debugging and reference
    player_name VARCHAR NOT NULL,
    player_name_normalized VARCHAR NOT NULL,
    -- Identity
    nation VARCHAR, -- NATION_AKSUM, NATION_CARTHAGE, etc.
    dynasty VARCHAR,
    team_id INTEGER,
    is_human BOOLEAN DEFAULT true,
    is_save_owner BOOLEAN DEFAULT false,  -- TRUE if this player is the save file owner
    -- External identity
    online_id VARCHAR,
    email VARCHAR,
    -- Game state
    difficulty VARCHAR,
    last_turn_completed INTEGER,
    turn_ended BOOLEAN DEFAULT false,
    -- Resources
    legitimacy INTEGER,
    time_stockpile INTEGER,
    -- Political
    state_religion VARCHAR,
    succession_gender VARCHAR,
    founder_character_id INTEGER,
    chosen_heir_id INTEGER,
    original_capital_city_id INTEGER,
    -- Research
    tech_researching VARCHAR,
    -- Counters
    ambition_delay INTEGER DEFAULT 0,
    tiles_purchased INTEGER DEFAULT 0,
    state_religion_changes INTEGER DEFAULT 0,
    tribe_mercenaries_hired INTEGER DEFAULT 0,
    PRIMARY KEY (player_id, match_id)
);

CREATE TABLE player_resources (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    yield_type VARCHAR NOT NULL, -- YIELD_CIVICS, YIELD_TRAINING, YIELD_SCIENCE, etc.
    amount INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, yield_type)
);

CREATE TABLE player_council (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    position VARCHAR NOT NULL, -- COUNCIL_AMBASSADOR, COUNCIL_CHANCELLOR, etc.
    character_id INTEGER NOT NULL,
    appointed_turn INTEGER,
    PRIMARY KEY (player_id, match_id, position)
);


-- ============================================================================
-- SECTION 3: CHARACTERS (Full System)
-- ============================================================================
-- Characters are the heart of Old World - dynastic, political, personal

CREATE TABLE characters (
    character_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,  -- References: matches(match_id)
    xml_id INTEGER,  -- Original XML Character ID for debugging and reference
    -- Identity
    first_name VARCHAR,
    gender VARCHAR, -- GENDER_MALE, GENDER_FEMALE
    player_id INTEGER,  -- References: players(player_id, match_id); NULL for tribal/neutral characters
    tribe VARCHAR, -- Non-null for tribal characters
    -- Birth and death
    birth_turn INTEGER NOT NULL,
    birth_city_id INTEGER,  -- References: cities(city_id, match_id)
    death_turn INTEGER,
    death_reason VARCHAR, -- DEATH_OLD_AGE, DEATH_BATTLE, DEATH_ILLNESS, etc.
    -- Parentage and lineage
    birth_father_id INTEGER,  -- References: characters(character_id, match_id)
    birth_mother_id INTEGER,  -- References: characters(character_id, match_id)
    -- Affiliations
    family VARCHAR, -- FAMILY_SARGONID, etc.
    nation VARCHAR,
    religion VARCHAR,
    -- Titles and roles
    cognomen VARCHAR, -- Earned title (e.g., "the Great")
    archetype VARCHAR, -- TRAIT_HERO_ARCHETYPE, TRAIT_SCHOLAR_ARCHETYPE, etc.
    -- Visual
    portrait VARCHAR,
    -- Progression
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    -- Note: Core attributes (wisdom, charisma, courage, discipline) are stored in
    -- character_stats table as RATING_WISDOM, RATING_CHARISMA, RATING_COURAGE, RATING_DISCIPLINE
    -- Status flags
    is_royal BOOLEAN DEFAULT false,
    is_infertile BOOLEAN DEFAULT false,
    -- Leadership
    became_leader_turn INTEGER, -- When became ruler
    abdicated_turn INTEGER,
    was_religion_head BOOLEAN DEFAULT false,
    was_family_head BOOLEAN DEFAULT false,
    -- Other
    nation_joined_turn INTEGER,
    seed BIGINT, -- Random seed for character generation
    PRIMARY KEY (character_id, match_id)
);

CREATE TABLE character_traits (
    character_id INTEGER NOT NULL,  -- References: characters(character_id, match_id)
    match_id BIGINT NOT NULL,
    trait VARCHAR NOT NULL, -- TRAIT_WISE, TRAIT_AMBITIOUS, TRAIT_ILL, etc.
    acquired_turn INTEGER NOT NULL,
    removed_turn INTEGER, -- NULL if still active
    PRIMARY KEY (character_id, match_id, trait, acquired_turn)
);

CREATE TABLE character_relationships (
    character_id INTEGER NOT NULL,  -- References: characters(character_id, match_id)
    match_id BIGINT NOT NULL,
    related_character_id INTEGER NOT NULL,  -- References: characters(character_id, match_id)
    relationship_type VARCHAR NOT NULL, -- RELATIONSHIP_LOVES, RELATIONSHIP_PLOTTING_AGAINST, etc.
    relationship_value INTEGER, -- Strength/intensity where applicable
    started_turn INTEGER,
    ended_turn INTEGER,
    PRIMARY KEY (character_id, match_id, related_character_id, relationship_type)
);

CREATE TABLE character_marriages (
    character_id INTEGER NOT NULL,  -- References: characters(character_id, match_id)
    match_id BIGINT NOT NULL,
    spouse_id INTEGER NOT NULL,  -- References: characters(character_id, match_id)
    marriage_turn INTEGER NOT NULL,
    ended_turn INTEGER, -- Death or divorce
    PRIMARY KEY (character_id, match_id, spouse_id, marriage_turn)
);

CREATE TABLE character_stats (
    character_id INTEGER NOT NULL,  -- References: characters(character_id, match_id)
    match_id BIGINT NOT NULL,
    stat_name VARCHAR NOT NULL, -- STAT_CITY_FOUNDED, STAT_TECH_DISCOVERED, etc.
    stat_value INTEGER NOT NULL,
    PRIMARY KEY (character_id, match_id, stat_name)
);

CREATE TABLE character_missions (
    mission_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,  -- References: characters(character_id, match_id)
    match_id BIGINT NOT NULL,
    mission_type VARCHAR NOT NULL, -- MISSION_AMBASSADOR, MISSION_HOLD_COURT, etc.
    started_turn INTEGER NOT NULL,
    completed_turn INTEGER,
    target_type VARCHAR, -- 'player', 'family', 'city', 'character', etc.
    target_id INTEGER,
    mission_state VARCHAR, -- JSON for complex state
    PRIMARY KEY (mission_id, match_id)
);

-- View: Living rulers (replaces old "rulers" table)
CREATE VIEW rulers AS
SELECT
    c.character_id,
    c.match_id,
    c.player_id,
    c.first_name as ruler_name,
    c.archetype,
    c.became_leader_turn as succession_turn,
    RANK() OVER (PARTITION BY c.match_id, c.player_id ORDER BY c.became_leader_turn) as succession_order
FROM characters c
WHERE c.became_leader_turn IS NOT NULL
ORDER BY c.match_id, c.player_id, c.became_leader_turn;


-- ============================================================================
-- SECTION 4: FAMILIES (Political Entity)
-- ============================================================================

CREATE TABLE families (
    family_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,  -- References: matches(match_id)
    xml_id INTEGER,  -- Original XML Family ID for debugging and reference
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    family_name VARCHAR NOT NULL, -- FAMILY_SARGONID, FAMILY_HANNONID, etc.
    family_class VARCHAR NOT NULL, -- FAMILYCLASS_CHAMPIONS, FAMILYCLASS_TRADERS, etc.
    head_character_id INTEGER,  -- References: characters(character_id, match_id)
    seat_city_id INTEGER,
    turns_without_leader INTEGER DEFAULT 0,
    PRIMARY KEY (family_id, match_id)
);

CREATE TABLE family_opinion_history (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    family_name VARCHAR NOT NULL,
    turn INTEGER NOT NULL,
    opinion INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, family_name, turn)
);

CREATE TABLE family_law_opinions (
    family_id INTEGER NOT NULL,  -- References: families(family_id, match_id)
    match_id BIGINT NOT NULL,
    law_category VARCHAR NOT NULL, -- LAWCLASS_SLAVERY_FREEDOM, etc.
    opinion_value INTEGER NOT NULL,
    PRIMARY KEY (family_id, match_id, law_category)
);


-- ============================================================================
-- SECTION 5: RELIGIONS (Cultural/Political Entity)
-- ============================================================================

CREATE TABLE religions (
    religion_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,  -- References: matches(match_id)
    xml_id INTEGER,  -- Original XML Religion ID for debugging and reference
    religion_name VARCHAR NOT NULL, -- RELIGION_ZOROASTRIANISM, RELIGION_JUDAISM, etc.
    founded_turn INTEGER,
    founder_player_id INTEGER,  -- References: players(player_id, match_id)
    head_character_id INTEGER,  -- References: characters(character_id, match_id)
    holy_city_id INTEGER,
    PRIMARY KEY (religion_id, match_id)
);

CREATE TABLE religion_opinion_history (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    religion_name VARCHAR NOT NULL,
    turn INTEGER NOT NULL,
    opinion INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, religion_name, turn)
);


-- ============================================================================
-- SECTION 6: TRIBES (Barbarian/Neutral Factions)
-- ============================================================================

CREATE TABLE tribes (
    tribe_id VARCHAR NOT NULL, -- TRIBE_SCYTHIANS, TRIBE_DANES, etc.
    match_id BIGINT NOT NULL,  -- References: matches(match_id)
    xml_id INTEGER,  -- Original XML Tribe ID for debugging and reference
    leader_character_id INTEGER,  -- References: characters(character_id, match_id)
    allied_player_id INTEGER,  -- References: players(player_id, match_id)
    religion VARCHAR,
    PRIMARY KEY (tribe_id, match_id)
);


-- ============================================================================
-- SECTION 7: CITIES (Full System)
-- ============================================================================

CREATE TABLE cities (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,  -- References: matches(match_id)
    xml_id INTEGER,  -- Original XML City ID for debugging and reference
    player_id INTEGER,  -- References: players(player_id, match_id); NULL for cities in anarchy/being captured
    tile_id INTEGER NOT NULL,
    -- Identity
    city_name VARCHAR NOT NULL,
    family VARCHAR, -- Controlling family
    -- Timing
    founded_turn INTEGER NOT NULL,
    -- Status
    is_capital BOOLEAN DEFAULT false,
    -- Population
    citizens INTEGER DEFAULT 1,
    -- Leadership
    governor_id INTEGER,  -- References: characters(character_id, match_id)
    governor_turn INTEGER,  -- Turn when governor was assigned
    -- Production and economy
    hurry_civics_count INTEGER DEFAULT 0,
    hurry_money_count INTEGER DEFAULT 0,
    hurry_training_count INTEGER DEFAULT 0,
    hurry_population_count INTEGER DEFAULT 0,
    specialist_count INTEGER DEFAULT 0,
    growth_count INTEGER DEFAULT 0,
    unit_production_count INTEGER DEFAULT 0,
    buy_tile_count INTEGER DEFAULT 0,
    -- Ownership tracking
    first_owner_player_id INTEGER,
    last_owner_player_id INTEGER,
    PRIMARY KEY (city_id, match_id)
);

CREATE TABLE city_yields (
    city_id INTEGER NOT NULL,  -- References: cities(city_id, match_id)
    match_id BIGINT NOT NULL,
    yield_type VARCHAR NOT NULL, -- YIELD_GROWTH, YIELD_CULTURE, YIELD_HAPPINESS
    progress INTEGER DEFAULT 0,
    overflow INTEGER DEFAULT 0,
    level INTEGER DEFAULT 0,
    PRIMARY KEY (city_id, match_id, yield_type)
);

CREATE TABLE city_culture (
    city_id INTEGER NOT NULL,  -- References: cities(city_id, match_id)
    match_id BIGINT NOT NULL,
    team_id INTEGER NOT NULL,
    culture_level VARCHAR,  -- String enum: CULTURE_WEAK, CULTURE_DEVELOPING, CULTURE_STRONG, CULTURE_ESTABLISHED, CULTURE_LEGENDARY
    culture_progress INTEGER DEFAULT 0,
    happiness_level INTEGER DEFAULT 0,
    PRIMARY KEY (city_id, match_id, team_id)
);

CREATE TABLE city_religions (
    city_id INTEGER NOT NULL,  -- References: cities(city_id, match_id)
    match_id BIGINT NOT NULL,
    religion VARCHAR NOT NULL,
    acquired_turn INTEGER,
    PRIMARY KEY (city_id, match_id, religion)
);

CREATE TABLE city_production_queue (
    queue_id INTEGER NOT NULL,
    city_id INTEGER NOT NULL,  -- References: cities(city_id, match_id)
    match_id BIGINT NOT NULL,
    queue_position INTEGER NOT NULL,
    build_type VARCHAR NOT NULL, -- BUILD_UNIT, BUILD_IMPROVEMENT, BUILD_PROJECT
    item_type VARCHAR NOT NULL, -- Specific unit/improvement/project
    progress INTEGER DEFAULT 0,
    is_repeat BOOLEAN DEFAULT false,
    yield_costs VARCHAR, -- JSON: {"YIELD_TRAINING": 100, "YIELD_IRON": 20}
    PRIMARY KEY (queue_id, match_id)
);

-- Aggregate tables for statistics
CREATE TABLE city_units_produced (
    city_id INTEGER NOT NULL,  -- References: cities(city_id, match_id)
    match_id BIGINT NOT NULL,
    unit_type VARCHAR NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (city_id, match_id, unit_type)
);

CREATE TABLE city_projects_completed (
    city_id INTEGER NOT NULL,  -- References: cities(city_id, match_id)
    match_id BIGINT NOT NULL,
    project_type VARCHAR NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (city_id, match_id, project_type)
);

-- City project counts from <ProjectCount> element
-- Note: Distinct from city_projects_completed which logs <CompletedBuild>
CREATE TABLE city_project_counts (
    city_id INTEGER NOT NULL,  -- References: cities(city_id, match_id)
    match_id BIGINT NOT NULL,
    project_type VARCHAR NOT NULL,  -- PROJECT_WALLS, PROJECT_FORUM_4, etc.
    count INTEGER NOT NULL,
    PRIMARY KEY (city_id, match_id, project_type)
);

-- Enemy spies operating in cities
CREATE TABLE city_enemy_agents (
    city_id INTEGER NOT NULL,  -- References: cities(city_id, match_id)
    match_id BIGINT NOT NULL,
    enemy_player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    agent_character_id INTEGER,  -- References: characters(character_id, match_id)
    placed_turn INTEGER,
    agent_tile_id INTEGER,  -- References: tiles(tile_id, match_id)
    PRIMARY KEY (city_id, match_id, enemy_player_id)
);

-- Luxury resource import history per city
CREATE TABLE city_luxuries (
    city_id INTEGER NOT NULL,  -- References: cities(city_id, match_id)
    match_id BIGINT NOT NULL,
    resource VARCHAR NOT NULL,  -- RESOURCE_FUR, RESOURCE_SILK, etc.
    imported_turn INTEGER NOT NULL,
    PRIMARY KEY (city_id, match_id, resource)
);


-- ============================================================================
-- SECTION 8: TILES (Map)
-- ============================================================================

CREATE TABLE tiles (
    tile_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,  -- References: matches(match_id)
    xml_id INTEGER,  -- Original XML Tile ID for debugging and reference
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    -- Terrain
    terrain VARCHAR, -- TERRAIN_WATER, TERRAIN_TEMPERATE, TERRAIN_ARID, etc.
    height VARCHAR, -- HEIGHT_OCEAN, HEIGHT_FLAT, HEIGHT_HILL, HEIGHT_MOUNTAIN
    vegetation VARCHAR, -- VEGETATION_TREES, VEGETATION_SCRUB
    -- Rivers (critical terrain features)
    river_w BOOLEAN DEFAULT false,
    river_sw BOOLEAN DEFAULT false,
    river_se BOOLEAN DEFAULT false,
    -- Resources
    resource VARCHAR, -- RESOURCE_IRON, RESOURCE_WHEAT, etc.
    -- Improvements
    improvement VARCHAR, -- IMPROVEMENT_FARM, IMPROVEMENT_MINE, etc.
    improvement_pillaged BOOLEAN DEFAULT false,
    improvement_disabled BOOLEAN DEFAULT false,
    improvement_turns_left INTEGER, -- Construction remaining
    -- Specialists
    specialist VARCHAR, -- SPECIALIST_POET_1, SPECIALIST_OFFICER_1, etc.
    -- Infrastructure
    has_road BOOLEAN DEFAULT false,
    -- Ownership
    owner_player_id INTEGER,  -- References: players(player_id, match_id)
    owner_city_id INTEGER,  -- References: cities(city_id, match_id)
    -- Sites
    tribe_site VARCHAR, -- Tribal site marker
    -- Religion
    religion VARCHAR,
    -- Seeds
    init_seed BIGINT,
    turn_seed BIGINT,
    PRIMARY KEY (tile_id, match_id)
);

-- Historical tile changes (sparse - only record changes)
CREATE TABLE tile_changes (
    change_id INTEGER NOT NULL,
    tile_id INTEGER NOT NULL,  -- References: tiles(tile_id, match_id)
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    change_type VARCHAR NOT NULL, -- 'owner', 'terrain', 'vegetation', 'improvement'
    old_value VARCHAR,
    new_value VARCHAR,
    PRIMARY KEY (change_id, match_id)
);

-- Fog of war visibility (optional - for competitive analysis)
CREATE TABLE tile_visibility (
    tile_id INTEGER NOT NULL,  -- References: tiles(tile_id, match_id)
    match_id BIGINT NOT NULL,
    team_id INTEGER NOT NULL,
    revealed_turn INTEGER,
    last_seen_turn INTEGER,
    visible_terrain VARCHAR,
    visible_height VARCHAR,
    visible_vegetation VARCHAR,
    visible_improvement VARCHAR,
    visible_owner_player_id INTEGER,
    PRIMARY KEY (tile_id, match_id, team_id)
);

-- Tile ownership history (for territorial expansion and conquest analysis)
CREATE TABLE tile_ownership_history (
    tile_id INTEGER NOT NULL,  -- References: tiles(tile_id, match_id)
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    owner_player_id INTEGER,  -- References: players(player_id, match_id); NULL if unowned
    PRIMARY KEY (tile_id, match_id, turn)
);


-- ============================================================================
-- SECTION 9: UNITS (Military and Civilian)
-- ============================================================================

CREATE TABLE units (
    unit_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    xml_id INTEGER,
    tile_id INTEGER,  -- References: tiles(tile_id, match_id)
    unit_type VARCHAR NOT NULL,  -- UNIT_HASTATUS, UNIT_WORKER, etc.
    player_id INTEGER,  -- References: players(player_id, match_id); NULL for barbarians
    tribe VARCHAR,  -- NONE or TRIBE_ANARCHY, etc.
    xp INTEGER,  -- NULL for civilian units
    level INTEGER,  -- NULL for civilian units
    create_turn INTEGER,
    facing VARCHAR,  -- NW, NE, E, SE, SW, W
    original_player_id INTEGER,  -- For captured/gifted units
    turns_since_last_move INTEGER,
    gender VARCHAR,  -- GENDER_MALE, GENDER_FEMALE (workers only)
    is_sleeping BOOLEAN DEFAULT false,
    current_formation VARCHAR,  -- EFFECTUNIT_SHIP_FORMATION, etc.
    seed BIGINT,
    PRIMARY KEY (unit_id, match_id)
);

CREATE INDEX idx_units_match ON units(match_id);
CREATE INDEX idx_units_tile ON units(tile_id, match_id);
CREATE INDEX idx_units_player ON units(player_id, match_id);
CREATE INDEX idx_units_type ON units(unit_type, match_id);

-- Unit promotions (acquired and available)
CREATE TABLE unit_promotions (
    unit_id INTEGER NOT NULL,  -- References: units(unit_id, match_id)
    match_id BIGINT NOT NULL,
    promotion VARCHAR NOT NULL,  -- PROMOTION_STRIKE1, PROMOTION_GUARD1, etc.
    is_acquired BOOLEAN NOT NULL,  -- true = has promotion, false = available to choose
    PRIMARY KEY (unit_id, match_id, promotion)
);

CREATE INDEX idx_unit_promotions_match ON unit_promotions(match_id);

-- Unit effects (bonuses like EFFECTUNIT_STEADFAST)
CREATE TABLE unit_effects (
    unit_id INTEGER NOT NULL,  -- References: units(unit_id, match_id)
    match_id BIGINT NOT NULL,
    effect VARCHAR NOT NULL,  -- EFFECTUNIT_STEADFAST, etc.
    stacks INTEGER DEFAULT 1,  -- Number of stacks of this effect
    PRIMARY KEY (unit_id, match_id, effect)
);

CREATE INDEX idx_unit_effects_match ON unit_effects(match_id);

-- Unit family associations (which family recruited/owns unit)
CREATE TABLE unit_families (
    unit_id INTEGER NOT NULL,  -- References: units(unit_id, match_id)
    match_id BIGINT NOT NULL,
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    family_name VARCHAR NOT NULL,  -- FAMILY_FABIUS, FAMILY_VALERIUS, etc.
    PRIMARY KEY (unit_id, match_id, player_id)
);

CREATE INDEX idx_unit_families_match ON unit_families(match_id);
CREATE INDEX idx_unit_families_family ON unit_families(family_name, match_id);

-- Aggregate production statistics
CREATE TABLE player_units_produced (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    unit_type VARCHAR NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, unit_type)
);


-- ============================================================================
-- SECTION 10: TECHNOLOGY
-- ============================================================================

CREATE TABLE technologies_completed (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    tech VARCHAR NOT NULL, -- TECH_IRONWORKING, TECH_ASTRONOMY, etc.
    completed_turn INTEGER,
    PRIMARY KEY (player_id, match_id, tech)
);

CREATE TABLE technology_progress (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    tech VARCHAR NOT NULL,
    progress INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, tech)
);

CREATE TABLE technology_states (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    tech VARCHAR NOT NULL,
    state VARCHAR NOT NULL, -- 'available', 'passed', 'trashed', 'locked', 'targeted'
    PRIMARY KEY (player_id, match_id, tech, state)
);


-- ============================================================================
-- SECTION 11: LAWS & GOVERNANCE
-- ============================================================================

CREATE TABLE laws (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    law_category VARCHAR NOT NULL, -- LAWCLASS_SLAVERY_FREEDOM, etc.
    law VARCHAR NOT NULL, -- Specific law within category
    adopted_turn INTEGER NOT NULL,
    change_count INTEGER DEFAULT 1, -- Times this category changed
    PRIMARY KEY (player_id, match_id, law_category)
);


-- ============================================================================
-- SECTION 12: DIPLOMACY
-- ============================================================================

CREATE TABLE diplomacy (
    match_id BIGINT NOT NULL,  -- References: matches(match_id)
    entity1_type VARCHAR NOT NULL, -- 'player' or 'tribe'
    entity1_id VARCHAR NOT NULL,
    entity2_type VARCHAR NOT NULL, -- 'player' or 'tribe'
    entity2_id VARCHAR NOT NULL,
    relation VARCHAR NOT NULL, -- DIPLOMACY_WAR, DIPLOMACY_PEACE, DIPLOMACY_TRUCE, DIPLOMACY_TEAM
    war_score INTEGER DEFAULT 0,
    last_conflict_turn INTEGER,
    last_diplomacy_turn INTEGER,
    diplomacy_blocked_until_turn INTEGER,
    PRIMARY KEY (match_id, entity1_type, entity1_id, entity2_type, entity2_id)
);


-- ============================================================================
-- SECTION 13: GOALS & AMBITIONS
-- ============================================================================

CREATE TABLE player_goals (
    goal_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    goal_type VARCHAR NOT NULL, -- GOAL_SIX_CONNECTED_CITIES, GOAL_MUSAEUM, etc.
    leader_character_id INTEGER,  -- References: characters(character_id, match_id)
    started_turn INTEGER NOT NULL,
    completed_turn INTEGER,
    failed_turn INTEGER,
    max_turns INTEGER,
    progress INTEGER DEFAULT 0,
    goal_state VARCHAR, -- JSON for complex tracking
    PRIMARY KEY (goal_id, match_id)
);


-- ============================================================================
-- SECTION 14: EVENTS & NARRATIVE
-- ============================================================================

CREATE TABLE event_logs (
    log_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,  -- References: matches(match_id)
    turn INTEGER NOT NULL,
    log_type VARCHAR NOT NULL, -- LOG_TECH_DISCOVERED, LOG_CITY_FOUNDED, etc.
    player_id INTEGER,  -- References: players(player_id, match_id)
    description VARCHAR,
    data1 INTEGER,
    data2 INTEGER,
    data3 INTEGER,
    is_permanent BOOLEAN DEFAULT false,
    PRIMARY KEY (log_id, match_id)
);

CREATE TABLE story_events (
    event_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,  -- References: matches(match_id)
    event_type VARCHAR NOT NULL, -- EVENTSTORY_MARRIAGE_OFFER, etc.
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    occurred_turn INTEGER NOT NULL,
    primary_character_id INTEGER,  -- References: characters(character_id, match_id)
    secondary_character_id INTEGER,  -- References: characters(character_id, match_id)
    city_id INTEGER,  -- References: cities(city_id, match_id)
    event_text VARCHAR,
    PRIMARY KEY (event_id, match_id)
);

CREATE TABLE story_choices (
    event_id INTEGER NOT NULL,  -- References: story_events(event_id, match_id)
    match_id BIGINT NOT NULL,
    option_selected VARCHAR NOT NULL,
    choice_turn INTEGER NOT NULL,
    PRIMARY KEY (event_id, match_id)
);

CREATE TABLE event_outcomes (
    outcome_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,  -- References: matches(match_id)
    event_id INTEGER,  -- References: story_events(event_id, match_id); NULL for non-story outcomes
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    outcome_type VARCHAR NOT NULL, -- BONUS_XP_CHARACTER_SMALL, etc.
    count INTEGER DEFAULT 1,
    applied_turn INTEGER NOT NULL,
    PRIMARY KEY (outcome_id, match_id)
);

CREATE TABLE memory_data (
    memory_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    memory_type VARCHAR NOT NULL, -- MEMORYPLAYER_ATTACKED_CITY, MEMORYFAMILY_FOUNDED_CITY, etc.
    turn INTEGER NOT NULL,
    target_player_id INTEGER,
    target_character_id INTEGER,
    target_family VARCHAR,
    target_tribe VARCHAR,
    target_religion VARCHAR,
    PRIMARY KEY (memory_id, match_id)
);


-- ============================================================================
-- SECTION 15: TIME-SERIES DATA (Historical Metrics)
-- ============================================================================
-- These tables capture turn-by-turn progression of key metrics

CREATE TABLE yield_history (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    yield_type VARCHAR NOT NULL, -- YIELD_GROWTH, YIELD_CIVICS, YIELD_TRAINING, etc.
    amount INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, turn, yield_type)
);

-- Cumulative yield totals (more accurate than yield_history)
-- Available in game version 1.0.81366+ (January 2026)
-- Includes ALL yield sources: base production, events, bonuses, specialists, trade
CREATE TABLE yield_total_history (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    yield_type VARCHAR NOT NULL, -- YIELD_GROWTH, YIELD_CIVICS, YIELD_TRAINING, etc.
    amount INTEGER NOT NULL,     -- Cumulative total up to this turn
    PRIMARY KEY (player_id, match_id, turn, yield_type)
);

CREATE TABLE points_history (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    points INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, turn)
);

CREATE TABLE military_history (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    military_power INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, turn)
);

CREATE TABLE legitimacy_history (
    player_id INTEGER NOT NULL,  -- References: players(player_id, match_id)
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    legitimacy INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, turn)
);


-- ============================================================================
-- SECTION 16: MARKET DATA
-- ============================================================================

CREATE TABLE yield_prices (
    match_id BIGINT NOT NULL,  -- References: matches(match_id)
    turn INTEGER NOT NULL,
    yield_type VARCHAR NOT NULL,
    price INTEGER NOT NULL,
    PRIMARY KEY (match_id, turn, yield_type)
);


-- ============================================================================
-- SECTION 17: VIEWS FOR ANALYSIS
-- ============================================================================

-- Player performance across matches
CREATE VIEW player_performance AS
SELECT
    p.player_name,
    p.nation,
    COUNT(DISTINCT p.match_id) as matches_played,
    SUM(CASE WHEN m.winner_player_id = p.player_id THEN 1 ELSE 0 END) as wins,
    CAST(SUM(CASE WHEN m.winner_player_id = p.player_id THEN 1 ELSE 0 END) AS DOUBLE) /
        COUNT(DISTINCT p.match_id) as win_rate,
    AVG(ph.points) as avg_final_score
FROM players p
JOIN matches m ON p.match_id = m.match_id
LEFT JOIN (
    SELECT player_id, match_id, points
    FROM points_history ph1
    WHERE turn = (SELECT MAX(turn) FROM points_history ph2
                  WHERE ph1.player_id = ph2.player_id AND ph1.match_id = ph2.match_id)
) ph ON p.player_id = ph.player_id AND p.match_id = ph.match_id
GROUP BY p.player_name, p.nation;

-- Character lineage (family trees)
CREATE VIEW character_lineage AS
SELECT
    c.character_id,
    c.match_id,
    c.first_name,
    c.family,
    f.first_name as father_name,
    m.first_name as mother_name,
    c.birth_turn,
    c.death_turn
FROM characters c
LEFT JOIN characters f ON c.birth_father_id = f.character_id AND c.match_id = f.match_id
LEFT JOIN characters m ON c.birth_mother_id = m.character_id AND c.match_id = m.match_id;



-- ============================================================================
-- SECTION 18: INDEXES FOR PERFORMANCE
-- ============================================================================
-- ALL INDEXES TEMPORARILY DISABLED: Testing if index corruption is the issue (GitHub #13)
-- The Appender API may have a bug causing index corruption during bulk inserts.
-- If disabling indexes fixes the crash, we'll need to either:
-- 1. Create indexes AFTER imports complete
-- 2. Upgrade DuckDB to a version with a fix
-- 3. Use INSERT statements instead of Appender

/*
-- Match lookups
CREATE INDEX idx_matches_hash ON matches(file_hash);
CREATE INDEX idx_matches_game_name ON matches(game_name);
-- Prevent duplicate game_id entries (one match per GameId)
CREATE UNIQUE INDEX idx_matches_game_id ON matches(game_id) WHERE game_id IS NOT NULL;

-- Player lookups
CREATE INDEX idx_players_match ON players(match_id);
CREATE INDEX idx_players_name ON players(player_name_normalized);
CREATE INDEX idx_players_nation ON players(nation);
-- Winner lookup optimization: supports efficient JOIN on (match_id, player_id) for get_game_details()
CREATE INDEX idx_players_match_player ON players(match_id, player_id);
-- UPSERT support: unique constraint on (match_id, xml_id) for idempotent updates
CREATE UNIQUE INDEX idx_players_xml_id ON players(match_id, xml_id) WHERE xml_id IS NOT NULL;

-- Character lookups (critical for genealogy queries)
CREATE INDEX idx_characters_match ON characters(match_id);
CREATE INDEX idx_characters_player ON characters(player_id, match_id);
CREATE INDEX idx_characters_family ON characters(family, match_id);
CREATE INDEX idx_characters_father ON characters(birth_father_id, match_id);
CREATE INDEX idx_characters_mother ON characters(birth_mother_id, match_id);
CREATE INDEX idx_characters_life ON characters(birth_turn, death_turn);
CREATE INDEX idx_characters_leader ON characters(became_leader_turn) WHERE became_leader_turn IS NOT NULL;
-- UPSERT support: unique constraint on (match_id, xml_id) for idempotent updates
CREATE UNIQUE INDEX idx_characters_xml_id ON characters(match_id, xml_id) WHERE xml_id IS NOT NULL;

-- City lookups
CREATE INDEX idx_cities_match ON cities(match_id);
CREATE INDEX idx_cities_player ON cities(player_id, match_id);
CREATE INDEX idx_cities_tile ON cities(tile_id, match_id);
CREATE INDEX idx_cities_family ON cities(family);
-- UPSERT support: unique constraint on (match_id, xml_id) for idempotent updates
CREATE UNIQUE INDEX idx_cities_xml_id ON cities(match_id, xml_id) WHERE xml_id IS NOT NULL;

-- Tile lookups
CREATE INDEX idx_tiles_match ON tiles(match_id);
CREATE INDEX idx_tiles_coords ON tiles(x, y);
CREATE INDEX idx_tiles_owner ON tiles(owner_player_id, match_id);
CREATE INDEX idx_tiles_city ON tiles(owner_city_id, match_id);
-- UPSERT support: unique constraint on (match_id, xml_id) for idempotent updates
CREATE UNIQUE INDEX idx_tiles_xml_id ON tiles(match_id, xml_id) WHERE xml_id IS NOT NULL;

-- Tile ownership history lookups
CREATE INDEX idx_tile_ownership_history_lookup ON tile_ownership_history(match_id, turn);
CREATE INDEX idx_tile_ownership_history_player ON tile_ownership_history(owner_player_id, match_id) WHERE owner_player_id IS NOT NULL;

-- Time-series performance
CREATE INDEX idx_yield_history_lookup ON yield_history(match_id, player_id, turn);
CREATE INDEX idx_points_history_lookup ON points_history(match_id, player_id, turn);
CREATE INDEX idx_military_history_lookup ON military_history(match_id, player_id, turn);
CREATE INDEX idx_legitimacy_history_lookup ON legitimacy_history(match_id, player_id, turn);

-- Event lookups
CREATE INDEX idx_story_events_turn ON story_events(match_id, occurred_turn);
CREATE INDEX idx_story_events_player ON story_events(player_id, match_id);
CREATE INDEX idx_story_events_character ON story_events(primary_character_id, match_id);

-- Family/Religion lookups
CREATE INDEX idx_families_match ON families(match_id);
CREATE INDEX idx_families_player ON families(player_id, match_id);
-- UPSERT support: unique constraint on (match_id, xml_id) for idempotent updates
CREATE UNIQUE INDEX idx_families_xml_id ON families(match_id, xml_id) WHERE xml_id IS NOT NULL;

CREATE INDEX idx_religions_match ON religions(match_id);
-- UPSERT support: unique constraint on (match_id, xml_id) for idempotent updates
CREATE UNIQUE INDEX idx_religions_xml_id ON religions(match_id, xml_id) WHERE xml_id IS NOT NULL;

-- Tribe lookups
-- UPSERT support: unique constraint on (match_id, xml_id) for idempotent updates
CREATE UNIQUE INDEX idx_tribes_xml_id ON tribes(match_id, xml_id) WHERE xml_id IS NOT NULL;
*/


-- ============================================================================
-- SECTION 19: SCHEMA METADATA
-- ============================================================================

CREATE TABLE schema_migrations (
    version VARCHAR NOT NULL PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description VARCHAR
);

INSERT INTO schema_migrations (version, description) VALUES
('2.0.0', 'Clean greenfield schema for multi-match Old World game analysis - 85% XML coverage'),
('2.2.0', 'Added match_locks table for multi-process concurrency control'),
('2.3.0', 'Added is_save_owner column to players table and user_settings table for save owner tracking'),
('2.4.0', 'Separated mods and DLC: renamed enabled_dlc to enabled_mods, added new enabled_dlc from GameContent'),
('2.5.0', 'Added collections table for organizing matches and filtering stats'),
('2.6.0', 'Removed FK constraints for ETL performance - relationships documented in comments'),
('2.7.0', 'Removed invalid city columns (growth_progress, general_id, agent_id) that do not exist in XML'),
('2.8.0', 'Added new city columns: governor_turn, hurry_training/population_count, growth/unit_production/buy_tile_count, last_owner_player_id'),
('2.9.0', 'Added city_project_counts, city_enemy_agents, city_luxuries tables; fixed TeamDiscontentLevel fallback for legacy saves'),
('2.10.0', 'Added units, unit_promotions, unit_effects, unit_families tables for individual unit tracking'),
('2.11.0', 'Schema version bump to trigger database reset for units tables');


-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
--
-- Schema Statistics:
-- - 62 tables (entities + time-series + aggregates + reference + views + locks + settings)
-- - ~90% coverage of XML data structures
-- - Optimized for multi-match analytical queries
-- - Full character/family/religion system for political analysis
-- - Individual unit tracking with promotions, effects, and family associations
-- - Production queues and city mechanics
-- - Story event system with choices and outcomes
-- - Comprehensive time-series metrics
-- - Relationships documented in comments (FK constraints removed for ETL performance)
--
-- Key Query Patterns Supported:
-- - Cross-match player performance analysis
-- - Character lineage and family trees
-- - Military composition and tactics
-- - Economic strategies and production patterns
-- - Diplomatic relationship evolution
-- - Technology progression comparison
-- - Event choices and outcomes analysis
-- - Map control and territory analysis
-- ============================================================================
