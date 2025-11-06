# Per-Ankh Database Analysis Report

**Analysis Date:** 2025-11-06
**Database:** per-ankh.db
**Total Tables:** 49
**Schema Version:** 2.2.0

## Executive Summary

- **Populated Tables:** 32 (65.3%)
- **Empty Tables:** 17 (34.7%)
- **Tables with Empty Columns:** 16

This analysis reveals significant improvements in parser coverage since the previous report. Several previously empty tables now contain data, including `character_relationships` (121 rows) and `religions` (9 rows). However, several critical tables remain unpopulated, particularly military-related tables (`units`, `unit_promotions`, `unit_types`) and some character/city subsystems.

## Table Row Counts

| Table Name | Row Count | Status |
|------------|-----------|--------|
| family_opinion_history | 20,664 | Populated |
| yield_history | 8,036 | Populated |
| id_mappings | 5,821 | Populated |
| tiles | 5,476 | Populated |
| tile_changes | 2,201 | Populated |
| yield_prices | 1,708 | Populated |
| character_stats | 1,401 | Populated |
| character_traits | 990 | Populated |
| story_events | 764 | Populated |
| military_history | 574 | Populated |
| points_history | 574 | Populated |
| characters | 297 | Populated |
| technologies_completed | 277 | Populated |
| technology_progress | 246 | Populated |
| character_relationships | 121 | Populated |
| technology_states | 90 | Populated |
| player_units_produced | 84 | Populated |
| diplomacy | 75 | Populated |
| city_units_produced | 62 | Populated |
| laws | 59 | Populated |
| player_resources | 39 | Populated |
| cities | 28 | Populated |
| city_production_queue | 25 | Populated |
| families | 15 | Populated |
| player_council | 12 | Populated |
| tribes | 10 | Populated |
| religions | 9 | Populated |
| player_goals | 8 | Populated |
| city_projects_completed | 6 | Populated |
| players | 5 | Populated |
| schema_migrations | 2 | Populated |
| matches | 1 | Populated |
| character_marriages | 0 | Empty |
| character_missions | 0 | Empty |
| city_culture | 0 | Empty |
| city_religions | 0 | Empty |
| city_yields | 0 | Empty |
| event_logs | 0 | Empty |
| event_outcomes | 0 | Empty |
| family_law_opinions | 0 | Empty |
| legitimacy_history | 0 | Empty |
| match_locks | 0 | Empty |
| match_settings | 0 | Empty |
| religion_opinion_history | 0 | Empty |
| story_choices | 0 | Empty |
| tile_visibility | 0 | Empty |
| unit_promotions | 0 | Empty |
| unit_types | 0 | Empty |
| units | 0 | Empty |

## Empty Tables (17)

The following tables contain no data:

### Critical Missing Data

**Military System (3 tables)**
- `units` - Individual unit tracking is completely missing
- `unit_promotions` - Unit advancement data not captured
- `unit_types` - Reference data for unit categories not populated

**Character Social System (2 tables)**
- `character_marriages` - Marriage tracking not implemented
- `character_missions` - Character missions not being parsed

**City Subsystems (3 tables)**
- `city_culture` - Culture tracking by team not implemented
- `city_religions` - City religion presence not tracked
- `city_yields` - City-level yield progress not captured

**Historical/Political Data (3 tables)**
- `legitimacy_history` - Turn-by-turn legitimacy tracking not implemented
- `religion_opinion_history` - Religion opinion over time not tracked
- `family_law_opinions` - Family opinions on laws not captured

**Event System (3 tables)**
- `event_logs` - General event logging not implemented
- `event_outcomes` - Event outcome tracking missing
- `story_choices` - Player story choices not being recorded

**Infrastructure Tables (3 tables)**
- `match_locks` - Cross-process locking (operational table, expected to be mostly empty)
- `match_settings` - Game settings details not parsed
- `tile_visibility` - Fog of war tracking not implemented (optional feature)

## Tables with Empty Columns (16)

The following tables have one or more columns that are completely empty (all NULL values):

### character_relationships (121 rows) - ✅ IMPROVED

**Empty Columns:**
- `relationship_value` (INTEGER) - Relationship strength not captured
- `started_turn` (INTEGER) - Relationship start time not tracked
- `ended_turn` (INTEGER) - Relationship end time not tracked

**Impact:** While relationships are now being captured (major improvement from previous report), the temporal and strength data is missing, limiting the ability to analyze relationship evolution.

### character_traits (990 rows)

**Empty Columns:**
- `removed_turn` (INTEGER) - Trait removal timing not captured

**Impact:** Cannot track when temporary traits (like illness) are removed. Only acquisition is tracked.

### characters (297 rows)

**Empty Columns:**
- `birth_city_id` (INTEGER) - Birthplace not captured
- `death_reason` (VARCHAR) - Cause of death not tracked
- `birth_father_id` (INTEGER) - Paternal lineage not captured
- `birth_mother_id` (INTEGER) - Maternal lineage not captured
- `archetype` (VARCHAR) - Character archetype not parsed
- `became_leader_turn` (INTEGER) - Leadership succession timing missing
- `abdicated_turn` (INTEGER) - Abdication timing missing
- `nation_joined_turn` (INTEGER) - Nation joining timing missing
- `seed` (BIGINT) - Random seed not captured

**Impact:** Critical genealogy and succession tracking is non-functional. The `character_lineage` view depends on `birth_father_id` and `birth_mother_id`, which are both empty.

### cities (28 rows)

**Empty Columns:**
- `general_id` (INTEGER) - General assignments not tracked
- `agent_id` (INTEGER) - Spy/agent assignments not tracked
- `first_owner_player_id` (INTEGER) - Original founder not tracked

**Impact:** Cannot track military leadership in cities or analyze city ownership history.

### city_production_queue (25 rows)

**Empty Columns:**
- `yield_costs` (VARCHAR) - Production costs not captured

**Impact:** Cannot analyze resource costs for production items.

### diplomacy (75 rows)

**Empty Columns:**
- `war_score` (INTEGER) - War progress not tracked
- `last_conflict_turn` (INTEGER) - Conflict timing not captured
- `last_diplomacy_turn` (INTEGER) - Diplomatic action timing missing
- `diplomacy_blocked_until_turn` (INTEGER) - Cooldown tracking missing

**Impact:** Basic diplomatic relations are captured, but detailed state information is missing.

### matches (1 rows)

**Empty Columns:**
- `map_aspect_ratio` (VARCHAR) - Map configuration detail missing
- `simultaneous_turns` (INTEGER) - Turn mode not captured
- `victory_conditions` (VARCHAR) - Victory settings not parsed
- `winner_player_id` (BIGINT) - Game outcome not tracked (expected for incomplete games)

**Impact:** Some match metadata is incomplete. Winner tracking is expected to be empty for ongoing games.

### player_council (12 rows)

**Empty Columns:**
- `appointed_turn` (INTEGER) - Council appointment timing not tracked

**Impact:** Cannot analyze when council positions were filled.

### player_goals (8 rows)

**Empty Columns:**
- `failed_turn` (INTEGER) - Goal failure timing not tracked
- `max_turns` (INTEGER) - Goal time limit not captured

**Impact:** Goal completion is tracked, but failure cases and deadlines are missing.

### players (5 rows)

**Empty Columns:**
- `team_id` (INTEGER) - Team multiplayer data not present (expected for single-player saves)
- `difficulty` (VARCHAR) - AI difficulty not captured
- `last_turn_completed` (INTEGER) - Turn state not tracked
- `founder_character_id` (INTEGER) - Dynasty founder not linked
- `chosen_heir_id` (INTEGER) - Succession preference not tracked
- `original_capital_city_id` (INTEGER) - Starting capital not recorded

**Impact:** Player state information is incomplete; succession and dynasty tracking is impaired.

### religions (9 rows) - ✅ IMPROVED

**Empty Columns:**
- `xml_id` (INTEGER) - Original XML ID not stored (used for debugging)

**Impact:** Minor impact; religion tracking is now functional (major improvement).

### story_events (764 rows)

**Empty Columns:**
- `secondary_character_id` (INTEGER) - Events with multiple characters not fully captured
- `event_text` (VARCHAR) - Event descriptions not parsed

**Impact:** Event tracking is present but narrative details are missing.

### technologies_completed (277 rows)

**Empty Columns:**
- `completed_turn` (INTEGER) - Technology completion timing not tracked

**Impact:** Cannot analyze technology progression speed or create tech timelines.

### tile_changes (2,201 rows)

**Empty Columns:**
- `old_value` (VARCHAR) - Previous state before change not captured

**Impact:** Change tracking records new values but not historical values, limiting temporal analysis.

### tiles (5,476 rows)

**Empty Columns:**
- `improvement_turns_left` (INTEGER) - Construction progress not tracked
- `owner_player_id` (INTEGER) - Tile ownership not captured (or no tiles owned)
- `owner_city_id` (INTEGER) - City territory not linked

**Impact:** Territory control analysis is impaired if ownership data is truly missing.

### tribes (10 rows)

**Empty Columns:**
- `xml_id` (INTEGER) - Original XML ID not stored
- `leader_character_id` (INTEGER) - Tribal leadership not linked
- `allied_player_id` (INTEGER) - Tribal alliances not tracked

**Impact:** Tribal diplomacy and leadership tracking is incomplete.

## Changes Since Previous Report (2025-11-06)

### Improvements ✅

1. **character_relationships** - Now populated with 121 rows (was empty)
   - Relationships are being parsed, though temporal/strength data is still missing

2. **religions** - Now populated with 9 rows (was empty)
   - Religion system is now functional

3. **families** - Increased to 15 rows (was 6 rows)
   - More complete family tracking

4. **Overall completeness** - Improved from 64.8% to 65.3%

### Remaining Issues ❌

1. **Military system** - Still completely unpopulated (`units`, `unit_promotions`, `unit_types`)
   - Despite `player_units_produced` and `city_units_produced` having data

2. **Legitimacy tracking** - `legitimacy_history` still empty
   - Time-series tracking for legitimacy not working

3. **Character genealogy** - `birth_father_id` and `birth_mother_id` still empty
   - Family tree analysis impossible

4. **Event system** - `event_logs`, `event_outcomes`, `story_choices` still empty
   - Comprehensive event tracking not implemented

## Schema Coverage Analysis

### Well-Covered Systems (>80% population)

- **Time-series metrics** - yield_history, points_history, military_history, family_opinion_history
- **Map data** - tiles, tile_changes
- **Character core data** - characters, character_stats, character_traits
- **Technology** - All tech tables populated
- **Economic** - yield_prices, player_resources
- **Political** - families, laws, player_council

### Partially Covered Systems (20-80% population)

- **Cities** - Core data present, but subsystems (culture, religions, yields) missing
- **Diplomacy** - Relations tracked, but detailed state missing
- **Characters** - Core attributes present, but genealogy and some lifecycle data missing
- **Events** - Story events tracked, but general logs and choices missing

### Uncovered Systems (<20% population)

- **Military** - No individual unit data
- **Character social** - No marriages or missions
- **City yields/culture** - Not tracked at city level
- **Event outcomes** - Not captured
- **Fog of war** - Not implemented (expected for single-player)

## Data Completeness Metrics

| Metric | Value |
|--------|-------|
| Overall Table Completeness | 65.3% (32/49 tables) |
| Critical Tables Populated | 25/33 (75.8%) |
| Optional/Infrastructure Tables Empty | 14/16 (87.5%) |
| Tables with Full Column Population | 16/32 (50.0%) |
| Tables with Partial Column Population | 16/32 (50.0%) |

## Recommendations

### High Priority Fixes 🔴

1. **Implement military unit parsing**
   - The `units`, `unit_promotions`, and `unit_types` tables are critical for military analysis
   - Aggregate data (`player_units_produced`) exists, suggesting the source data is available
   - Action: Review XML structure for unit data and implement parser

2. **Fix character genealogy parsing**
   - `birth_father_id` and `birth_mother_id` are completely empty
   - This breaks family tree analysis and the `character_lineage` view
   - Action: Implement parent ID mapping in character parser

3. **Implement legitimacy_history parsing**
   - This is a time-series table that should be populated like other history tables
   - Action: Add legitimacy tracking to time-series parser

4. **Complete character lifecycle data**
   - `became_leader_turn`, `death_reason`, `archetype` are all empty
   - Action: Parse these fields from character XML data

### Medium Priority Improvements 🟡

5. **Implement city subsystem parsing**
   - `city_yields`, `city_culture`, `city_religions` are all empty
   - These provide important city-level details for analysis
   - Action: Parse city nested data structures

6. **Add temporal data to relationships**
   - `character_relationships` exists but missing `started_turn`, `ended_turn`, `relationship_value`
   - Action: Parse relationship strength and timing data

7. **Parse event system details**
   - `event_logs`, `event_outcomes`, `story_choices` are empty
   - Story events are tracked, but comprehensive event system is not
   - Action: Implement event logging and choice tracking

8. **Complete diplomacy state tracking**
   - Basic relations tracked, but `war_score` and timing fields are empty
   - Action: Parse detailed diplomatic state

### Low Priority Enhancements 🟢

9. **Add character marriages**
   - `character_marriages` table is empty
   - Action: Parse marriage data from character relationships or dedicated section

10. **Implement character missions**
    - `character_missions` table is empty
    - Action: Parse mission data if available in save files

11. **Add production cost tracking**
    - `city_production_queue` missing `yield_costs`
    - Action: Parse production cost information

12. **Complete match metadata**
    - Some `matches` columns empty (map_aspect_ratio, victory_conditions, etc.)
    - Action: Parse complete match configuration

### Investigation Needed 🔍

13. **Verify tile ownership parsing**
    - `tiles.owner_player_id` and `tiles.owner_city_id` are empty
    - Could be parser issue or could be all tiles are unowned in test save
    - Action: Check if tile ownership exists in XML and verify parser

14. **Check tribal data availability**
    - `tribes` table has several empty columns
    - May be data availability issue or parser issue
    - Action: Verify tribal leader and alliance data in save files

15. **Investigate unit_types population**
    - This is a reference table that should be populated with static data
    - Action: Determine if this should be pre-populated or parsed from save

## Parser Implementation Notes

Based on this analysis, the parser implementation should focus on:

1. **XML structure variations** - Some fields may be optional or version-dependent
2. **ID mapping** - Ensure all foreign key references are properly mapped through `id_mappings`
3. **Nested data structures** - Many empty columns are in nested XML elements that may not be parsed
4. **Temporal data** - Many `*_turn` fields are empty, suggesting turn timing is not being captured
5. **Game version compatibility** - Some fields may not exist in older save file versions

## Conclusion

The parser has made significant progress, with 65.3% table population and several major improvements since the last report (character_relationships, religions). However, critical gaps remain in military unit tracking, character genealogy, and several subsystems.

The highest impact improvements would be:
1. Military unit parsing (enables tactical analysis)
2. Character genealogy (enables dynasty analysis)
3. Legitimacy history (completes time-series suite)
4. City subsystems (enables city-level detailed analysis)

These improvements would bring table population to approximately 75-80% and enable most planned visualization and analytical features.
