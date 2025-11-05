-- Old World Game Data Schema v2.0
-- DuckDB Schema for Multi-Match Game Save Analysis
--
-- Design Principles:
-- - Clean greenfield design (no legacy compatibility)
-- - Stores data from multiple XML save files
-- - ~85% coverage of XML data structures
-- - XML-first terminology (Tile not Territory, Character not Ruler)
-- - Proper normalization and foreign key constraints
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

CREATE INDEX idx_id_mappings_match ON id_mappings(match_id);
CREATE INDEX idx_id_mappings_lookup ON id_mappings(match_id, entity_type, xml_id);

CREATE TABLE matches (
    match_id BIGINT NOT NULL PRIMARY KEY,
    file_name VARCHAR NOT NULL,
    file_hash VARCHAR NOT NULL UNIQUE,
    game_name VARCHAR,
    game_id VARCHAR, -- XML GameId (UUID)
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
    total_turns INTEGER,
    winner_player_id BIGINT,
    -- Seeds for analysis
    first_seed BIGINT,
    map_seed BIGINT
);

CREATE TABLE match_settings (
    setting_id BIGINT NOT NULL PRIMARY KEY,
    match_id BIGINT NOT NULL,
    setting_type VARCHAR NOT NULL, -- 'game_option', 'dlc_content', 'map_option', 'occurrence_level'
    setting_key VARCHAR NOT NULL,
    setting_value VARCHAR,
    FOREIGN KEY (match_id) REFERENCES matches(match_id)
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
    match_id BIGINT NOT NULL,
    xml_id INTEGER,  -- Original XML Player ID for debugging and reference
    player_name VARCHAR NOT NULL,
    player_name_normalized VARCHAR NOT NULL,
    -- Identity
    nation VARCHAR, -- NATION_AKSUM, NATION_CARTHAGE, etc.
    dynasty VARCHAR,
    team_id INTEGER,
    is_human BOOLEAN DEFAULT true,
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
    PRIMARY KEY (player_id, match_id),
    FOREIGN KEY (match_id) REFERENCES matches(match_id)
);

CREATE TABLE player_resources (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    yield_type VARCHAR NOT NULL, -- YIELD_CIVICS, YIELD_TRAINING, YIELD_SCIENCE, etc.
    amount INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, yield_type),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);

CREATE TABLE player_council (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    position VARCHAR NOT NULL, -- COUNCIL_AMBASSADOR, COUNCIL_CHANCELLOR, etc.
    character_id INTEGER NOT NULL,
    appointed_turn INTEGER,
    PRIMARY KEY (player_id, match_id, position),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);


-- ============================================================================
-- SECTION 3: CHARACTERS (Full System)
-- ============================================================================
-- Characters are the heart of Old World - dynastic, political, personal

CREATE TABLE characters (
    character_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    xml_id INTEGER,  -- Original XML Character ID for debugging and reference
    -- Identity
    first_name VARCHAR,
    gender VARCHAR, -- GENDER_MALE, GENDER_FEMALE
    player_id INTEGER, -- NULL for tribal/neutral characters
    tribe VARCHAR, -- Non-null for tribal characters
    -- Birth and death
    birth_turn INTEGER NOT NULL,
    birth_city_id INTEGER,
    death_turn INTEGER,
    death_reason VARCHAR, -- DEATH_OLD_AGE, DEATH_BATTLE, DEATH_ILLNESS, etc.
    -- Parentage and lineage
    birth_father_id INTEGER,
    birth_mother_id INTEGER,
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
    -- Core attributes (1-10)
    wisdom INTEGER,
    charisma INTEGER,
    courage INTEGER,
    discipline INTEGER,
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
    PRIMARY KEY (character_id, match_id),
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id),
    FOREIGN KEY (birth_father_id, match_id) REFERENCES characters(character_id, match_id),
    FOREIGN KEY (birth_mother_id, match_id) REFERENCES characters(character_id, match_id)
);

CREATE TABLE character_traits (
    character_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    trait VARCHAR NOT NULL, -- TRAIT_WISE, TRAIT_AMBITIOUS, TRAIT_ILL, etc.
    acquired_turn INTEGER NOT NULL,
    removed_turn INTEGER, -- NULL if still active
    PRIMARY KEY (character_id, match_id, trait, acquired_turn),
    FOREIGN KEY (character_id, match_id) REFERENCES characters(character_id, match_id)
);

CREATE TABLE character_relationships (
    character_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    related_character_id INTEGER NOT NULL,
    relationship_type VARCHAR NOT NULL, -- RELATIONSHIP_LOVES, RELATIONSHIP_PLOTTING_AGAINST, etc.
    relationship_value INTEGER, -- Strength/intensity where applicable
    started_turn INTEGER,
    ended_turn INTEGER,
    PRIMARY KEY (character_id, match_id, related_character_id, relationship_type),
    FOREIGN KEY (character_id, match_id) REFERENCES characters(character_id, match_id),
    FOREIGN KEY (related_character_id, match_id) REFERENCES characters(character_id, match_id)
);

CREATE TABLE character_marriages (
    character_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    spouse_id INTEGER NOT NULL,
    marriage_turn INTEGER NOT NULL,
    ended_turn INTEGER, -- Death or divorce
    PRIMARY KEY (character_id, match_id, spouse_id, marriage_turn),
    FOREIGN KEY (character_id, match_id) REFERENCES characters(character_id, match_id),
    FOREIGN KEY (spouse_id, match_id) REFERENCES characters(character_id, match_id)
);

CREATE TABLE character_stats (
    character_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    stat_name VARCHAR NOT NULL, -- STAT_CITY_FOUNDED, STAT_TECH_DISCOVERED, etc.
    stat_value INTEGER NOT NULL,
    PRIMARY KEY (character_id, match_id, stat_name),
    FOREIGN KEY (character_id, match_id) REFERENCES characters(character_id, match_id)
);

CREATE TABLE character_missions (
    mission_id BIGINT NOT NULL PRIMARY KEY,
    character_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    mission_type VARCHAR NOT NULL, -- MISSION_AMBASSADOR, MISSION_HOLD_COURT, etc.
    started_turn INTEGER NOT NULL,
    completed_turn INTEGER,
    target_type VARCHAR, -- 'player', 'family', 'city', 'character', etc.
    target_id INTEGER,
    mission_state VARCHAR, -- JSON for complex state
    FOREIGN KEY (character_id, match_id) REFERENCES characters(character_id, match_id)
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
    family_id BIGINT NOT NULL PRIMARY KEY,
    match_id BIGINT NOT NULL,
    xml_id INTEGER,  -- Original XML Family ID for debugging and reference
    player_id INTEGER NOT NULL,
    family_name VARCHAR NOT NULL, -- FAMILY_SARGONID, FAMILY_HANNONID, etc.
    family_class VARCHAR NOT NULL, -- FAMILYCLASS_CHAMPIONS, FAMILYCLASS_TRADERS, etc.
    head_character_id INTEGER,
    seat_city_id INTEGER,
    turns_without_leader INTEGER DEFAULT 0,
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id),
    FOREIGN KEY (head_character_id, match_id) REFERENCES characters(character_id, match_id)
);

CREATE TABLE family_opinion_history (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    family_name VARCHAR NOT NULL,
    turn INTEGER NOT NULL,
    opinion INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, family_name, turn),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);

CREATE TABLE family_law_opinions (
    family_id BIGINT NOT NULL,
    match_id BIGINT NOT NULL,
    law_category VARCHAR NOT NULL, -- LAWCLASS_SLAVERY_FREEDOM, etc.
    opinion_value INTEGER NOT NULL,
    PRIMARY KEY (family_id, match_id, law_category),
    FOREIGN KEY (family_id) REFERENCES families(family_id)
);


-- ============================================================================
-- SECTION 5: RELIGIONS (Cultural/Political Entity)
-- ============================================================================

CREATE TABLE religions (
    religion_id BIGINT NOT NULL PRIMARY KEY,
    match_id BIGINT NOT NULL,
    xml_id INTEGER,  -- Original XML Religion ID for debugging and reference
    religion_name VARCHAR NOT NULL, -- RELIGION_ZOROASTRIANISM, RELIGION_JUDAISM, etc.
    founded_turn INTEGER,
    founder_player_id INTEGER,
    head_character_id INTEGER,
    holy_city_id INTEGER,
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (founder_player_id, match_id) REFERENCES players(player_id, match_id),
    FOREIGN KEY (head_character_id, match_id) REFERENCES characters(character_id, match_id)
);

CREATE TABLE religion_opinion_history (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    religion_name VARCHAR NOT NULL,
    turn INTEGER NOT NULL,
    opinion INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, religion_name, turn),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);


-- ============================================================================
-- SECTION 6: TRIBES (Barbarian/Neutral Factions)
-- ============================================================================

CREATE TABLE tribes (
    tribe_id VARCHAR NOT NULL, -- TRIBE_SCYTHIANS, TRIBE_DANES, etc.
    match_id BIGINT NOT NULL,
    xml_id INTEGER,  -- Original XML Tribe ID for debugging and reference
    leader_character_id INTEGER,
    allied_player_id INTEGER,
    religion VARCHAR,
    PRIMARY KEY (tribe_id, match_id),
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (leader_character_id, match_id) REFERENCES characters(character_id, match_id),
    FOREIGN KEY (allied_player_id, match_id) REFERENCES players(player_id, match_id)
);


-- ============================================================================
-- SECTION 7: CITIES (Full System)
-- ============================================================================

CREATE TABLE cities (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    xml_id INTEGER,  -- Original XML City ID for debugging and reference
    player_id INTEGER NOT NULL,
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
    growth_progress INTEGER DEFAULT 0,
    -- Leadership
    governor_id INTEGER,
    general_id INTEGER,
    agent_id INTEGER, -- Spy/agent assigned
    -- Production
    hurry_civics_count INTEGER DEFAULT 0,
    hurry_money_count INTEGER DEFAULT 0,
    specialist_count INTEGER DEFAULT 0,
    -- Ownership tracking
    first_owner_player_id INTEGER,
    PRIMARY KEY (city_id, match_id),
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id),
    FOREIGN KEY (governor_id, match_id) REFERENCES characters(character_id, match_id),
    FOREIGN KEY (general_id, match_id) REFERENCES characters(character_id, match_id),
    FOREIGN KEY (agent_id, match_id) REFERENCES characters(character_id, match_id)
);

CREATE TABLE city_yields (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    yield_type VARCHAR NOT NULL, -- YIELD_GROWTH, YIELD_CULTURE, YIELD_HAPPINESS
    progress INTEGER DEFAULT 0,
    overflow INTEGER DEFAULT 0,
    level INTEGER DEFAULT 0,
    PRIMARY KEY (city_id, match_id, yield_type),
    FOREIGN KEY (city_id, match_id) REFERENCES cities(city_id, match_id)
);

CREATE TABLE city_culture (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    team_id INTEGER NOT NULL,
    culture_level INTEGER DEFAULT 0,
    culture_progress INTEGER DEFAULT 0,
    happiness_level INTEGER DEFAULT 0,
    PRIMARY KEY (city_id, match_id, team_id),
    FOREIGN KEY (city_id, match_id) REFERENCES cities(city_id, match_id)
);

CREATE TABLE city_religions (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    religion VARCHAR NOT NULL,
    acquired_turn INTEGER,
    PRIMARY KEY (city_id, match_id, religion),
    FOREIGN KEY (city_id, match_id) REFERENCES cities(city_id, match_id)
);

CREATE TABLE city_production_queue (
    queue_id BIGINT NOT NULL PRIMARY KEY,
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    queue_position INTEGER NOT NULL,
    build_type VARCHAR NOT NULL, -- BUILD_UNIT, BUILD_IMPROVEMENT, BUILD_PROJECT
    item_type VARCHAR NOT NULL, -- Specific unit/improvement/project
    progress INTEGER DEFAULT 0,
    is_repeat BOOLEAN DEFAULT false,
    yield_costs VARCHAR, -- JSON: {"YIELD_TRAINING": 100, "YIELD_IRON": 20}
    FOREIGN KEY (city_id, match_id) REFERENCES cities(city_id, match_id)
);

-- Aggregate tables for statistics
CREATE TABLE city_units_produced (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    unit_type VARCHAR NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (city_id, match_id, unit_type),
    FOREIGN KEY (city_id, match_id) REFERENCES cities(city_id, match_id)
);

CREATE TABLE city_projects_completed (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    project_type VARCHAR NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (city_id, match_id, project_type),
    FOREIGN KEY (city_id, match_id) REFERENCES cities(city_id, match_id)
);


-- ============================================================================
-- SECTION 8: TILES (Map)
-- ============================================================================

CREATE TABLE tiles (
    tile_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
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
    improvement_develop_turns INTEGER DEFAULT 0,
    -- Specialists
    specialist VARCHAR, -- SPECIALIST_POET_1, SPECIALIST_OFFICER_1, etc.
    -- Infrastructure
    has_road BOOLEAN DEFAULT false,
    -- Ownership
    owner_player_id INTEGER,
    owner_city_id INTEGER, -- Which city's territory
    -- Sites
    is_city_site BOOLEAN DEFAULT false,
    tribe_site VARCHAR, -- Tribal site marker
    -- Religion
    religion VARCHAR,
    -- Seeds
    init_seed BIGINT,
    turn_seed BIGINT,
    PRIMARY KEY (tile_id, match_id),
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (owner_player_id, match_id) REFERENCES players(player_id, match_id),
    FOREIGN KEY (owner_city_id, match_id) REFERENCES cities(city_id, match_id)
);

-- Historical tile changes (sparse - only record changes)
CREATE TABLE tile_changes (
    change_id BIGINT NOT NULL PRIMARY KEY,
    tile_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    change_type VARCHAR NOT NULL, -- 'owner', 'terrain', 'vegetation', 'improvement'
    old_value VARCHAR,
    new_value VARCHAR,
    FOREIGN KEY (tile_id, match_id) REFERENCES tiles(tile_id, match_id)
);

-- Fog of war visibility (optional - for competitive analysis)
CREATE TABLE tile_visibility (
    tile_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    team_id INTEGER NOT NULL,
    revealed_turn INTEGER,
    last_seen_turn INTEGER,
    visible_terrain VARCHAR,
    visible_height VARCHAR,
    visible_vegetation VARCHAR,
    visible_improvement VARCHAR,
    visible_owner_player_id INTEGER,
    PRIMARY KEY (tile_id, match_id, team_id),
    FOREIGN KEY (tile_id, match_id) REFERENCES tiles(tile_id, match_id)
);


-- ============================================================================
-- SECTION 9: UNITS (Military)
-- ============================================================================

CREATE TABLE units (
    unit_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    xml_id INTEGER,  -- Original XML Unit ID for debugging and reference
    unit_type VARCHAR NOT NULL, -- UNIT_SPEARMAN, UNIT_ARCHER, etc.
    player_id INTEGER,
    tribe VARCHAR, -- For tribal units
    tile_id INTEGER NOT NULL,
    -- Leadership
    general_id INTEGER, -- Commanding character
    player_family VARCHAR, -- Family affiliation
    -- Combat state
    damage INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    promotion_level INTEGER DEFAULT 0,
    -- Timing
    created_turn INTEGER NOT NULL,
    turns_inactive INTEGER DEFAULT 0,
    -- Status
    facing VARCHAR,
    is_anchored BOOLEAN DEFAULT false,
    is_unlimbered BOOLEAN DEFAULT false, -- Siege weapons
    -- Cooldowns
    cooldown_type VARCHAR,
    cooldown_turns INTEGER DEFAULT 0,
    -- Orders
    march_destination VARCHAR,
    move_target_tile_id INTEGER,
    -- Ownership history
    original_player_id INTEGER,
    original_tribe VARCHAR,
    -- Generation
    seed BIGINT,
    PRIMARY KEY (unit_id, match_id),
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id),
    FOREIGN KEY (tile_id, match_id) REFERENCES tiles(tile_id, match_id),
    FOREIGN KEY (general_id, match_id) REFERENCES characters(character_id, match_id)
);

CREATE TABLE unit_promotions (
    unit_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    promotion VARCHAR NOT NULL, -- PROMOTION_COMBAT1, PROMOTION_STRIKE1, PROMOTION_BRAVE, etc.
    acquired_turn INTEGER,
    PRIMARY KEY (unit_id, match_id, promotion),
    FOREIGN KEY (unit_id, match_id) REFERENCES units(unit_id, match_id)
);

-- Reference data for unit types
CREATE TABLE unit_types (
    unit_type VARCHAR NOT NULL PRIMARY KEY,
    category VARCHAR NOT NULL, -- 'infantry', 'cavalry', 'ranged', 'siege', 'naval'
    role VARCHAR NOT NULL, -- 'melee', 'ranged', 'support'
    description VARCHAR
);

-- Aggregate production statistics
CREATE TABLE player_units_produced (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    unit_type VARCHAR NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, unit_type),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);


-- ============================================================================
-- SECTION 10: TECHNOLOGY
-- ============================================================================

CREATE TABLE technologies_completed (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    tech VARCHAR NOT NULL, -- TECH_IRONWORKING, TECH_ASTRONOMY, etc.
    completed_turn INTEGER,
    PRIMARY KEY (player_id, match_id, tech),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);

CREATE TABLE technology_progress (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    tech VARCHAR NOT NULL,
    progress INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, tech),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);

CREATE TABLE technology_states (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    tech VARCHAR NOT NULL,
    state VARCHAR NOT NULL, -- 'available', 'passed', 'trashed', 'locked', 'targeted'
    PRIMARY KEY (player_id, match_id, tech),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);


-- ============================================================================
-- SECTION 11: LAWS & GOVERNANCE
-- ============================================================================

CREATE TABLE laws (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    law_category VARCHAR NOT NULL, -- LAWCLASS_SLAVERY_FREEDOM, etc.
    law VARCHAR NOT NULL, -- Specific law within category
    adopted_turn INTEGER NOT NULL,
    change_count INTEGER DEFAULT 1, -- Times this category changed
    PRIMARY KEY (player_id, match_id, law_category),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);


-- ============================================================================
-- SECTION 12: DIPLOMACY
-- ============================================================================

CREATE TABLE diplomacy (
    match_id BIGINT NOT NULL,
    entity1_type VARCHAR NOT NULL, -- 'player' or 'tribe'
    entity1_id VARCHAR NOT NULL,
    entity2_type VARCHAR NOT NULL, -- 'player' or 'tribe'
    entity2_id VARCHAR NOT NULL,
    relation VARCHAR NOT NULL, -- DIPLOMACY_WAR, DIPLOMACY_PEACE, DIPLOMACY_TRUCE, DIPLOMACY_TEAM
    war_score INTEGER DEFAULT 0,
    last_conflict_turn INTEGER,
    last_diplomacy_turn INTEGER,
    diplomacy_blocked_until_turn INTEGER,
    PRIMARY KEY (match_id, entity1_type, entity1_id, entity2_type, entity2_id),
    FOREIGN KEY (match_id) REFERENCES matches(match_id)
);


-- ============================================================================
-- SECTION 13: GOALS & AMBITIONS
-- ============================================================================

CREATE TABLE player_goals (
    goal_id BIGINT NOT NULL PRIMARY KEY,
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    goal_type VARCHAR NOT NULL, -- GOAL_SIX_CONNECTED_CITIES, GOAL_MUSAEUM, etc.
    leader_character_id INTEGER, -- Character pursuing this
    started_turn INTEGER NOT NULL,
    completed_turn INTEGER,
    failed_turn INTEGER,
    max_turns INTEGER,
    progress INTEGER DEFAULT 0,
    goal_state VARCHAR, -- JSON for complex tracking
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id),
    FOREIGN KEY (leader_character_id, match_id) REFERENCES characters(character_id, match_id)
);


-- ============================================================================
-- SECTION 14: EVENTS & NARRATIVE
-- ============================================================================

CREATE TABLE event_logs (
    log_id BIGINT NOT NULL PRIMARY KEY,
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    log_type VARCHAR NOT NULL, -- LOG_TECH_DISCOVERED, LOG_CITY_FOUNDED, etc.
    player_id INTEGER,
    description VARCHAR,
    data1 INTEGER,
    data2 INTEGER,
    data3 INTEGER,
    is_permanent BOOLEAN DEFAULT false,
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);

CREATE TABLE story_events (
    event_id BIGINT NOT NULL PRIMARY KEY,
    match_id BIGINT NOT NULL,
    event_type VARCHAR NOT NULL, -- EVENTSTORY_MARRIAGE_OFFER, etc.
    player_id INTEGER NOT NULL,
    occurred_turn INTEGER NOT NULL,
    primary_character_id INTEGER,
    secondary_character_id INTEGER,
    city_id INTEGER,
    event_text VARCHAR,
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id),
    FOREIGN KEY (primary_character_id, match_id) REFERENCES characters(character_id, match_id),
    FOREIGN KEY (secondary_character_id, match_id) REFERENCES characters(character_id, match_id),
    FOREIGN KEY (city_id, match_id) REFERENCES cities(city_id, match_id)
);

CREATE TABLE story_choices (
    event_id BIGINT NOT NULL,
    match_id BIGINT NOT NULL,
    option_selected VARCHAR NOT NULL,
    choice_turn INTEGER NOT NULL,
    PRIMARY KEY (event_id, match_id),
    FOREIGN KEY (event_id) REFERENCES story_events(event_id)
);

CREATE TABLE event_outcomes (
    outcome_id BIGINT NOT NULL PRIMARY KEY,
    match_id BIGINT NOT NULL,
    event_id BIGINT, -- NULL for non-story outcomes
    player_id INTEGER NOT NULL,
    outcome_type VARCHAR NOT NULL, -- BONUS_XP_CHARACTER_SMALL, etc.
    count INTEGER DEFAULT 1,
    applied_turn INTEGER NOT NULL,
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (event_id) REFERENCES story_events(event_id),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);


-- ============================================================================
-- SECTION 15: TIME-SERIES DATA (Historical Metrics)
-- ============================================================================
-- These tables capture turn-by-turn progression of key metrics

CREATE TABLE yield_history (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    yield_type VARCHAR NOT NULL, -- YIELD_GROWTH, YIELD_CIVICS, YIELD_TRAINING, etc.
    amount INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, turn, yield_type),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);

CREATE TABLE points_history (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    points INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, turn),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);

CREATE TABLE military_history (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    military_power INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, turn),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);

CREATE TABLE legitimacy_history (
    player_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    legitimacy INTEGER NOT NULL,
    PRIMARY KEY (player_id, match_id, turn),
    FOREIGN KEY (player_id, match_id) REFERENCES players(player_id, match_id)
);


-- ============================================================================
-- SECTION 16: MARKET DATA
-- ============================================================================

CREATE TABLE yield_prices (
    match_id BIGINT NOT NULL,
    turn INTEGER NOT NULL,
    yield_type VARCHAR NOT NULL,
    price INTEGER NOT NULL,
    PRIMARY KEY (match_id, turn, yield_type),
    FOREIGN KEY (match_id) REFERENCES matches(match_id)
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

-- Active military composition
CREATE VIEW military_composition AS
SELECT
    u.match_id,
    u.player_id,
    u.unit_type,
    COUNT(*) as unit_count,
    AVG(u.level) as avg_level,
    AVG(u.xp) as avg_xp,
    SUM(u.damage) as total_damage,
    COUNT(DISTINCT u.general_id) as generals_commanding
FROM units u
GROUP BY u.match_id, u.player_id, u.unit_type;


-- ============================================================================
-- SECTION 18: INDEXES FOR PERFORMANCE
-- ============================================================================

-- Match lookups
CREATE INDEX idx_matches_hash ON matches(file_hash);
CREATE INDEX idx_matches_game_name ON matches(game_name);

-- Player lookups
CREATE INDEX idx_players_match ON players(match_id);
CREATE INDEX idx_players_name ON players(player_name_normalized);
CREATE INDEX idx_players_nation ON players(nation);

-- Character lookups (critical for genealogy queries)
CREATE INDEX idx_characters_match ON characters(match_id);
CREATE INDEX idx_characters_player ON characters(player_id, match_id);
CREATE INDEX idx_characters_family ON characters(family, match_id);
CREATE INDEX idx_characters_father ON characters(birth_father_id, match_id);
CREATE INDEX idx_characters_mother ON characters(birth_mother_id, match_id);
CREATE INDEX idx_characters_life ON characters(birth_turn, death_turn);
CREATE INDEX idx_characters_leader ON characters(became_leader_turn) WHERE became_leader_turn IS NOT NULL;

-- Unit lookups
CREATE INDEX idx_units_match ON units(match_id);
CREATE INDEX idx_units_player ON units(player_id, match_id);
CREATE INDEX idx_units_tile ON units(tile_id, match_id);
CREATE INDEX idx_units_type ON units(unit_type);
CREATE INDEX idx_units_general ON units(general_id, match_id) WHERE general_id IS NOT NULL;

-- City lookups
CREATE INDEX idx_cities_match ON cities(match_id);
CREATE INDEX idx_cities_player ON cities(player_id, match_id);
CREATE INDEX idx_cities_tile ON cities(tile_id, match_id);
CREATE INDEX idx_cities_family ON cities(family);

-- Tile lookups
CREATE INDEX idx_tiles_match ON tiles(match_id);
CREATE INDEX idx_tiles_coords ON tiles(x, y);
CREATE INDEX idx_tiles_owner ON tiles(owner_player_id, match_id);
CREATE INDEX idx_tiles_city ON tiles(owner_city_id, match_id);

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
CREATE INDEX idx_religions_match ON religions(match_id);


-- ============================================================================
-- SECTION 19: SCHEMA METADATA
-- ============================================================================

CREATE TABLE schema_migrations (
    version VARCHAR NOT NULL PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description VARCHAR
);

INSERT INTO schema_migrations (version, description) VALUES
('2.0.0', 'Clean greenfield schema for multi-match Old World game analysis - 85% XML coverage');


-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
--
-- Schema Statistics:
-- - 53 tables (entities + time-series + aggregates + reference + views)
-- - ~85% coverage of XML data structures
-- - Optimized for multi-match analytical queries
-- - Full character/family/religion system for political analysis
-- - Individual unit tracking for tactical analysis
-- - Production queues and city mechanics
-- - Story event system with choices and outcomes
-- - Comprehensive time-series metrics
-- - Clean normalization with proper foreign keys
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
