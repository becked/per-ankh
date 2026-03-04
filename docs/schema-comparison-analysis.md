# Schema Comparison: Per-Ankh vs Prospector

A detailed analysis of how two applications model Old World save file data, based on inspection of both codebases and the prospector production database (49 tournament matches).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture at a Glance](#2-architecture-at-a-glance)
3. [Domain-by-Domain Comparison](#3-domain-by-domain-comparison)
   - [3.1 Matches](#31-matches)
   - [3.2 Players](#32-players)
   - [3.3 Characters / Rulers](#33-characters--rulers)
   - [3.4 Cities](#34-cities)
   - [3.5 Tiles / Territories](#35-tiles--territories)
   - [3.6 Units](#36-units)
   - [3.7 Technology](#37-technology)
   - [3.8 Families](#38-families)
   - [3.9 Religions](#39-religions)
   - [3.10 Tribes](#310-tribes)
   - [3.11 Diplomacy](#311-diplomacy)
   - [3.12 Laws & Governance](#312-laws--governance)
   - [3.13 Goals & Ambitions](#313-goals--ambitions)
   - [3.14 Time-Series Data](#314-time-series-data)
   - [3.15 Events & Narrative](#315-events--narrative)
   - [3.16 Player Statistics](#316-player-statistics)
   - [3.17 Market Data](#317-market-data)
4. [Design Pattern Comparison](#4-design-pattern-comparison)
   - [4.1 Normalization Depth](#41-normalization-depth)
   - [4.2 EAV vs Typed Columns](#42-eav-vs-typed-columns)
   - [4.3 Views vs Materialized Tables](#43-views-vs-materialized-tables)
   - [4.4 ID Strategy](#44-id-strategy)
   - [4.5 Settings & Configuration Storage](#45-settings--configuration-storage)
   - [4.6 Schema Migration Systems](#46-schema-migration-systems)
5. [Data Volume Analysis](#5-data-volume-analysis)
6. [Coverage Gap Analysis](#6-coverage-gap-analysis)

---

## 1. Overview

Both applications parse the same source: Old World save files (ZIP archives containing a single XML file with complete game state). They extract this XML into DuckDB for analytics and visualization.

**Per-Ankh** is a Tauri desktop app (Rust backend, Svelte frontend) designed for a single user to analyze their own save files across multiple games. Its schema is deeply normalized with ~45 tables, covers ~85% of the XML data, and uses XML-faithful terminology (e.g., "Tile" not "Territory", "Character" not "Ruler").

**Prospector** is a Python/Dash web app built for a specific 1v1 tournament. Its schema is flatter with 26 tables, focused on player-level aggregates and tournament structure. It adds tournament-specific features (Challonge integration, pick/ban tracking, AI-generated match narratives) not present in the save file data.

Both databases use DuckDB. Both store data from multiple matches.

---

## 2. Architecture at a Glance

| Aspect | Per-Ankh | Prospector |
|---|---|---|
| Language | Rust | Python |
| XML Parser | roxmltree (DOM) | xml.etree.ElementTree |
| Database | DuckDB (Rust bindings) | DuckDB (Python bindings) |
| Tables | ~45 + views | 26 (incl. 3 tournament-specific) |
| Insertion | DuckDB Appender API (bulk) | Individual INSERT statements |
| ID Strategy | `id_mappings` table (XML ID → stable DB ID) | Auto-increment sequences |
| Deduplication | Last-wins on primary key | UNIQUE constraints |
| Transaction Model | Full import in single transaction | Per-table inserts |
| Migration System | Semver with breaking/non-breaking flag | Version string + description |
| Schema Version | 2.13.0 (9 migrations) | 1.0.0 + 3 incremental |

---

## 3. Domain-by-Domain Comparison

### 3.1 Matches

The core table linking all data to a specific game save file.

**Per-Ankh** — Single wide table (`matches`, 30+ columns):
- Inlines all game settings as typed columns: `map_width`, `map_height`, `map_size`, `map_class`, `map_aspect_ratio`, `min_latitude`, `max_latitude`, `game_mode`, `turn_style`, `turn_timer`, `turn_scale`, `simultaneous_turns`, `opponent_level`, `tribe_level`, `development`, `advantage`, `succession_gender`, `succession_order`, `mortality`, `event_level`, `victory_point_modifier`, `force_march`, `team_nation`
- Stores `game_id` (UUID from XML) with unique constraint on `(game_id, total_turns)` to identify unique snapshots of the same campaign
- Tracks game version, enabled mods, and enabled DLC as text fields
- Stores map seeds (`first_seed`, `map_seed`) for analysis
- Has `collection_id` FK for user-defined groupings
- Separate `match_settings` EAV table for granular game options, DLC flags, and map options
- `match_summary` is a VIEW joining matches/players

**Prospector** — Split across three tables + view:
- `matches` (25 columns): Core metadata plus tournament-specific fields (`challonge_match_id`, `tournament_round`, `player1_participant_id`, `player2_participant_id`, `winner_participant_id`, `first_picker_participant_id`, `second_picker_participant_id`, `narrative_summary`, `p1_narrative`, `p2_narrative`)
- `match_metadata` (16 columns): Game settings stored as display-friendly strings (e.g., "Moderate" not "EVENTLEVEL_MODERATE"), plus JSON blobs for `game_options`, `dlc_content`, and `map_settings`
- `match_winners`: Separate table with `winner_determination_method` audit trail ("parser_determined" vs manual override)
- `match_summary` is a TABLE (materialized), not a view

**Key differences:**
- Per-ankh stores raw enum values (`EVENTLEVEL_MODERATE`); prospector stores display values (`Moderate`)
- Per-ankh has `game_id` (campaign UUID) for de-duplicating snapshots of the same game; prospector does not
- Per-ankh stores map dimensions and seeds; prospector does not
- Prospector stores winner determination method and narrative text; per-ankh stores winner inline
- Prospector splits settings into a separate table with JSON; per-ankh uses both inline columns and an EAV table

### 3.2 Players

**Per-Ankh** — Rich player table (25+ columns):
- Composite PK: `(player_id, match_id)` — player_id is mapped through `id_mappings`
- Stores `xml_id` for debugging reference
- Identity: `nation`, `dynasty`, `online_id`, `email`, `is_human`, `is_save_owner`
- Game state: `difficulty`, `last_turn_completed`, `turn_ended`
- Resources: `legitimacy`, `time_stockpile`
- Political: `state_religion`, `succession_gender`, `founder_character_id`, `chosen_heir_id`, `original_capital_city_id`
- Research: `tech_researching`
- Counters: `ambition_delay`, `tiles_purchased`, `state_religion_changes`, `tribe_mercenaries_hired`
- Companion tables: `player_resources` (yield stockpiles), `player_council` (appointed officials)

**Prospector** — Leaner player table (11 columns):
- Auto-increment PK: `player_id` (BIGINT)
- Core fields: `player_name`, `player_name_normalized`, `civilization`, `team_id`, `difficulty_level`, `final_score`, `is_human`, `final_turn_active`
- `participant_id` FK to tournament participants table
- No companion tables for resources or council

**Key differences:**
- Per-ankh stores dynasty, online_id, email, political state, resource stockpiles, and counter stats on the player record
- Prospector stores `final_score` directly; per-ankh computes it from `points_history`
- Per-ankh separates resources into `player_resources` table; prospector uses EAV `player_statistics` with `yield_stockpile` category
- Prospector's `player_name_normalized` is useful for matching across sources; per-ankh also has this
- Per-ankh tracks `is_save_owner` (the human who ran the game); prospector doesn't need this (tournament context)

### 3.3 Characters / Rulers

This is the largest divergence between the two schemas. Old World's character system is the heart of the game — dynasty management, traits, relationships, marriages, succession.

**Per-Ankh** — Full character system (6 tables + 1 view):
- `characters` (30+ columns): Complete character records — identity, birth/death, parentage, family/tribe/religion affiliation, titles, XP/level, portrait, leadership status, royal/infertile flags
- `character_traits`: Trait acquisition and removal with turn tracking
- `character_relationships`: Inter-character relationships with type, value, and turn range
- `character_marriages`: Marriage records with start/end turns
- `character_stats`: EAV for character-level statistics (e.g., STAT_CITY_FOUNDED, RATING_WISDOM)
- `character_missions`: Mission assignments with type, target, and state
- `rulers` VIEW: Derived from `characters WHERE became_leader_turn IS NOT NULL`, with succession ordering via window function

**Prospector** — Rulers only (1 table):
- `rulers` (12 columns): Materialized table storing ruler succession — `character_id`, `ruler_name`, `archetype`, `starting_trait`, `cognomen`, `birth_turn`, `death_turn`, `succession_order`, `succession_turn`
- No character relationships, marriages, traits, or missions
- No non-ruler characters captured at all

**Key differences:**
- Per-ankh models the full character graph (hundreds of characters per match including non-royal, tribal, neutral); prospector only stores rulers
- Per-ankh tracks trait acquisition/removal over time; prospector stores a single `starting_trait`
- Per-ankh captures character genealogy (father/mother IDs) for family tree construction; prospector does not
- Per-ankh's `rulers` is a view computed from the character data; prospector's is a standalone table populated during parsing

### 3.4 Cities

**Per-Ankh** — Highly normalized (8 tables):
- `cities` (30+ columns): Core city data including tile, owner, family, founded turn, capital status, citizens, governor, hurry counts, specialist count, growth count, unit production count, buy tile count, first/last owner tracking
- `city_yields`: Per-yield-type progress, overflow, and level
- `city_culture`: Per-team culture data (level, progress, happiness)
- `city_religions`: Religions present in city with acquisition turn
- `city_production_queue`: Current build queue with position, type, progress, costs
- `city_units_produced`: Aggregate unit production by type
- `city_projects_completed`: Aggregate project completion by type
- `city_project_counts`: Project build counts from `<ProjectCount>` XML element
- `city_enemy_agents`: Enemy spy tracking
- `city_luxuries`: Luxury resource import history

**Prospector** — Flat (1 table + 2 companion):
- `cities` (13 columns): `city_id`, `match_id`, `player_id`, `city_name`, `tile_id`, `founded_turn`, `family_name`, `is_capital`, `population`, `first_player_id`, `governor_id`, `culture_level`, `religion_count`
- `city_unit_production`: Unit type + count per city
- `city_projects`: Project type + count per city

**Key differences:**
- Per-ankh stores 8 separate tables to capture yields, culture, religions, production queues, agents, and luxuries; prospector flattens this to a few aggregate columns
- Per-ankh tracks `culture_level` as a per-team record in `city_culture`; prospector stores a single `culture_level` integer
- Per-ankh stores the current production queue (in-progress builds); prospector only stores completed production
- Both track first owner; per-ankh also tracks last owner
- Per-ankh's hurry counts (civics, money, training, population) capture rushing behavior; prospector doesn't store these

### 3.5 Tiles / Territories

Both apps store per-turn map state. This is the largest table in both databases.

**Per-Ankh** — Detailed tiles with history (4 tables):
- `tiles` (23+ columns): Core tile state — coordinates, terrain, height, vegetation, rivers (3 edge booleans), resource, improvement (with pillaged/disabled/turns_left), specialist, road, owner player/city, tribe site, religion, seeds
- `tile_changes`: Sparse history of tile modifications (owner, terrain, vegetation, improvement changes)
- `tile_visibility`: Fog-of-war state per team — revealed/last seen turn, visible terrain/improvement/owner
- `tile_ownership_history`: Per-turn ownership records for territorial expansion analysis

**Prospector** — Flat territory snapshots (1 table):
- `territories` (12 columns): `territory_id`, `match_id`, `x_coordinate`, `y_coordinate`, `turn_number`, `terrain_type`, `improvement_type`, `specialist_type`, `resource_type`, `has_road`, `owner_player_id`, `city_id`
- Stores one row per tile per turn that has data

**Key differences:**
- Per-ankh stores tile state as a single snapshot per tile (current state at save time), with separate sparse change history tables. Prospector stores full per-tile-per-turn snapshots.
- Per-ankh captures height, rivers, vegetation, improvement damage state, and seeds; prospector captures only terrain, improvement, specialist, resource, road, and owner.
- Per-ankh has fog-of-war visibility; prospector does not.
- Prospector's approach produces vastly more rows: **180,754 rows per match average** (8.8M for 49 matches). This is the dominant storage cost. Per-ankh's sparse change tracking approach produces far fewer rows but requires reconstruction logic for point-in-time queries.
- Per-ankh computes coordinates from tile_id and map_width; prospector stores coordinates explicitly.

### 3.6 Units

**Per-Ankh** — Full unit modeling (5 tables):
- `units` (18 columns): Individual unit records — type, player, tribe, XP/level, create turn, facing, original player (for captured units), sleeping status, formation, seed
- `unit_promotions`: Acquired and available promotions per unit
- `unit_effects`: Active effects with stack counts
- `unit_families`: Family association per unit
- `player_units_produced`: Aggregate counts by player + unit type

**Prospector** — Aggregate only (2 tables):
- `units_produced`: Player-level aggregate counts by unit type
- `unit_classifications`: Static reference table categorizing unit types into category (civilian, military, religious, special) and role (worker, settler, infantry, cavalry, ranged, siege, etc.)

**Key differences:**
- Per-ankh models individual unit instances with position, stats, and history; prospector only stores production counts
- Prospector's `unit_classifications` is a useful static reference table (47 entries) that per-ankh doesn't have — it provides analytical categories for unit types
- Neither app tracks unit movement history or combat outcomes at the individual unit level

### 3.7 Technology

**Per-Ankh** — Three tables:
- `technologies_completed`: Completed techs with completion turn
- `technology_progress`: Current research progress (partial completion)
- `technology_states`: Tech availability states (available, passed, trashed, locked, targeted)

**Prospector** — One table:
- `technology_progress`: Tech name + count per player per match (count=1 means completed)

**Key differences:**
- Per-ankh distinguishes between completed, in-progress, and various availability states; prospector stores only a completion flag
- Per-ankh tracks completion turn for timeline analysis; prospector does not directly (but derives it from LogData events in the `events` table)

### 3.8 Families

**Per-Ankh** — First-class entity (3 tables):
- `families`: Family identity — name, class (Champions/Traders/etc.), head character, seat city, turns without leader
- `family_opinion_history`: Per-turn opinion values (time-series)
- `family_law_opinions`: Per-family opinions on law categories

**Prospector** — Time-series only (1 table):
- `family_opinion_history`: Same per-turn opinion tracking

**Key differences:**
- Per-ankh models families as entities with their own attributes; prospector only tracks the opinion time-series
- Per-ankh captures family class, head, and seat — important for understanding family dynamics
- Per-ankh tracks family law opinions (which laws each family prefers); prospector does not

### 3.9 Religions

**Per-Ankh** — First-class entity (2 tables):
- `religions`: Religion identity — name, founded turn, founder player, head character, holy city
- `religion_opinion_history`: Per-turn opinion values

**Prospector** — Time-series only (1 table):
- `religion_opinion_history`: Same per-turn opinion tracking

**Key differences:**
- Per-ankh models religions as entities with founding data; prospector only stores the opinion series
- Per-ankh tracks who founded each religion and when — useful for understanding religious dynamics

### 3.10 Tribes

**Per-Ankh** — First-class entity (1 table):
- `tribes`: Tribe identity — leader character, allied player, religion

**Prospector** — No dedicated table. Tribe interactions appear in events (TRIBE_DIPLOMACY, TRIBE_CONTACT, MEMORYTRIBE_* event types).

### 3.11 Diplomacy

**Per-Ankh** — Dedicated table:
- `diplomacy`: Bidirectional relations between players and/or tribes — relation type (war, peace, truce, team), war score, last conflict turn, last diplomacy turn, blocked-until turn

**Prospector** — No dedicated table. Diplomatic events appear in the `events` table as TRIBE_DIPLOMACY type entries.

### 3.12 Laws & Governance

**Per-Ankh** — Dedicated table:
- `laws`: Current law per category with adoption turn and change count

**Prospector** — Events + statistics:
- Law adoptions appear in `events` table as LAW_ADOPTED type
- Law change counts stored in `player_statistics` with `stat_category='law_changes'`

### 3.13 Goals & Ambitions

**Per-Ankh** — Dedicated table:
- `player_goals`: Goal tracking with type, leader, start/complete/fail turns, progress, max turns, state

**Prospector** — Events only:
- Goals appear in `events` table as GOAL_STARTED, GOAL_FINISHED, GOAL_FAILED types

### 3.14 Time-Series Data

Both apps extract the same sparse time-series data from the XML. The XML encodes these as `<T{turn}>{value}</T{turn}>` elements — only turns with changes are recorded.

**Per-Ankh** — 5 dedicated tables:
- `yield_history`: Per-turn yield production rates (14 yield types)
- `yield_total_history`: Cumulative yield totals (game version 1.0.81366+)
- `points_history`: Victory points per turn
- `military_history`: Military power per turn
- `legitimacy_history`: Legitimacy per turn

**Prospector** — 5 equivalent tables:
- `player_yield_history`: Same 14 yield types
- `player_yield_total_history`: Same cumulative totals
- `player_points_history`: Same VP per turn
- `player_military_history`: Same military power
- `player_legitimacy_history`: Same legitimacy

**Key differences:**
- Schema is effectively identical for time-series. The only difference is naming conventions (e.g., `yield_history` vs `player_yield_history`).
- Both store the same yield types: YIELD_CIVICS, YIELD_CULTURE, YIELD_DISCONTENT, YIELD_FOOD, YIELD_GROWTH, YIELD_HAPPINESS, YIELD_IRON, YIELD_MAINTENANCE, YIELD_MONEY, YIELD_ORDERS, YIELD_SCIENCE, YIELD_STONE, YIELD_TRAINING, YIELD_WOOD.
- Data volumes per match (from 49-match tournament, avg 75 turns): points ~137/match, military ~141/match, legitimacy ~140/match, yields ~2,016/match, yield totals ~144/match.

### 3.15 Events & Narrative

This is one of the starkest design divergences.

**Per-Ankh** — 5 strongly-typed tables:
- `event_logs`: Turn log entries (LOG_TECH_DISCOVERED, LOG_CITY_FOUNDED, etc.) with typed data fields (data1/data2/data3 as VARCHAR)
- `story_events`: In-game story events (EVENTSTORY_MARRIAGE_OFFER, etc.) with character/city references
- `story_choices`: Player decisions on story events
- `event_outcomes`: Bonuses/effects applied from events
- `memory_data`: Character/family/tribe memory entries — the political AI's memory system

**Prospector** — 1 flexible table:
- `events` (9 columns): All event types in one table with `event_type` discriminator, optional `player_id`, `description`, coordinates, and a JSON `event_data` column for type-specific payload
- Event types include both MemoryData events (MEMORYPLAYER_*, MEMORYTRIBE_*, MEMORYCHARACTER_*) and LogData events (TECH_DISCOVERED, CITY_FOUNDED, LAW_ADOPTED, etc.)
- 16,371 events across 49 matches (~334/match avg)

**Key differences:**
- Per-ankh separates events by semantic type into distinct tables with proper foreign keys to characters/cities. Prospector puts everything in one table with JSON for flexibility.
- Per-ankh tracks story choices and event outcomes (what bonuses resulted from events); prospector does not.
- Per-ankh stores memory data (political relationship tracking); prospector stores similar data as MEMORY* event types in the events table.
- Prospector adds x/y coordinates to events; per-ankh does not.
- Prospector's approach is more flexible for adding new event types without schema changes. Per-ankh's approach is more queryable without JSON parsing.

**Narrative generation** (prospector only):
- Prospector generates AI narratives stored on `matches`: `narrative_summary`, `p1_narrative`, `p2_narrative`
- Generated via Claude API using structured analysis of match data
- These are derived data, not from the XML

### 3.16 Player Statistics

**Per-Ankh** — Inline + specific tables:
- Player counters on `players` table: `ambition_delay`, `tiles_purchased`, `state_religion_changes`, `tribe_mercenaries_hired`
- Character stats in `character_stats` EAV table
- Player resources in `player_resources` table (yield_type → amount)

**Prospector** — Pure EAV (1 table):
- `player_statistics` (18,357 rows): Category/name/value triples
  - `bonus_count.*` — Hundreds of distinct bonus types (BONUS_ABANDONED_AMBITION through BONUS_ADD_GREAT_MERCHANT, etc.)
  - `law_changes.*` — Law class change counts
  - `yield_stockpile.*` — Resource stockpiles by yield type

**Key differences:**
- Prospector's EAV approach captures far more granular data (18,357 rows across 49 matches = ~375 stats per match) with hundreds of distinct bonus types
- Per-ankh captures a curated subset as typed columns — more queryable but less complete
- The `bonus_count` category in prospector captures game-internal bonus tracking that per-ankh does not extract at all. These represent events like achievements, bonuses applied, character actions taken.
- Per-ankh's `player_resources` is conceptually equivalent to prospector's `yield_stockpile` category

### 3.17 Market Data

**Per-Ankh** — Dedicated table:
- `yield_prices`: Turn-by-turn commodity prices per yield type

**Prospector** — Not stored. Market price data is available in the XML but prospector does not extract it.

---

## 4. Design Pattern Comparison

### 4.1 Normalization Depth

Per-ankh heavily normalizes — cities alone span 8 tables. This provides:
- Strong typing and referential integrity (even without FK constraints, which were removed for ETL performance)
- Efficient storage (no null-heavy wide rows)
- Direct queryability without JSON parsing

Prospector favors fewer, wider tables with JSON for flexibility:
- Simpler schema to understand and extend
- Fewer JOINs for common queries
- JSON columns (`event_data`, `game_options`) trade queryability for schema stability

**Concrete example — City data:**
Per-ankh's 8 city tables total ~500 columns of schema surface area across yields, culture, religions, queue, projects, agents, and luxuries. Prospector's 3 tables cover the same domain in ~20 columns, deferring detail to aggregate counts.

### 4.2 EAV vs Typed Columns

Both apps use EAV (Entity-Attribute-Value) patterns, but differently:

**Per-ankh uses EAV for:**
- `match_settings` (setting_type, setting_key, setting_value)
- `character_stats` (stat_name, stat_value)
- `player_resources` (yield_type, amount)

**Prospector uses EAV for:**
- `player_statistics` (stat_category, stat_name, value) — much broader scope

Per-ankh generally prefers typed columns where the set of possible values is known. Prospector uses EAV for open-ended data where the set of keys is large and game-version-dependent (hundreds of bonus types).

### 4.3 Views vs Materialized Tables

| Entity | Per-Ankh | Prospector |
|---|---|---|
| `rulers` | VIEW over `characters` | Materialized TABLE |
| `match_summary` | VIEW over matches/players | Materialized TABLE |
| `player_performance` | VIEW over players/matches/points_history | Materialized TABLE |
| `character_lineage` | VIEW over characters | N/A |

Per-ankh derives these from base data using views. Prospector materializes them during ETL. The view approach ensures consistency but may be slower for repeated queries. The materialized approach is faster to query but can become stale.

### 4.4 ID Strategy

**Per-Ankh** — `id_mappings` table:
- Maps `(match_id, entity_type, xml_id)` → `db_id`
- Entity types: player, character, city, unit, tile, family, religion, tribe
- Purpose: Stable database IDs across re-imports of the same save file
- Enables upsert semantics — re-importing a save updates rather than duplicates
- Cost: Additional table, lookup overhead during insertion

**Prospector** — Auto-increment sequences:
- Each table has its own sequence-generated ID
- `match_id` assigned from a global sequence on first import
- Player/city/etc. IDs are scoped to match via UNIQUE constraints
- Simpler but no re-import stability — a re-import would create duplicate data unless the old match is deleted first

**Per-ankh also stores `xml_id`** on entity tables for debugging — the original 0-based ID from the XML. This is useful for cross-referencing with the raw save file.

### 4.5 Settings & Configuration Storage

**Per-Ankh:**
- Most settings inline on `matches` as typed columns (30+ columns)
- Overflow into `match_settings` EAV table for granular options
- `user_settings` KV table for app preferences
- `collections` table for organizing matches

**Prospector:**
- Core settings on `matches` table
- Detailed settings in `match_metadata` with JSON columns:
  ```json
  game_options: {"GAMEOPTION_CUSTOM_LEADER": true, "GAMEOPTION_NO_UNDO": true, ...}
  dlc_content: {"DLC_HEROES_OF_AEGEAN": true, ...}
  map_settings: {"MapAspectRatio": "MAPASPECTRATIO_ULTRAWIDE"}
  ```
- Display-friendly values (e.g., "Moderate" not "EVENTLEVEL_MODERATE")

### 4.6 Schema Migration Systems

**Per-Ankh:**
- Semver versioning (currently 2.13.0)
- Each migration flagged as `is_breaking` (requires DB reset + re-parse) or non-breaking (incremental)
- `schema_migrations` table tracks applied versions
- Structural check: verifies actual table structure matches expected schema before requiring reset
- 9 migrations across development history

**Prospector:**
- Simple version strings (1.0.0, then integers 4, 5, 6)
- No breaking/non-breaking distinction — all migrations are additive
- `schema_migrations` table with version + description + timestamp
- 4 migrations total

---

## 5. Data Volume Analysis

Based on the prospector production database (49 matches, avg 75 turns, all 2-player games on Tiny/Duel maps):

| Table | Total Rows | Avg Rows/Match | Notes |
|---|---|---|---|
| territories | 8,856,922 | 180,754 | **Dominant storage cost** |
| religion_opinion_history | 99,148 | 2,024 | ~6-8 religions × ~250 turns worth |
| player_yield_history | 98,803 | 2,016 | 14 yield types × ~144 turns |
| family_opinion_history | 262,484 | 5,357 | ~36 families × ~150 turns |
| player_statistics | 18,357 | 375 | Hundreds of stat types |
| events | 16,371 | 334 | All event types combined |
| player_yield_total_history | 7,074 | 144 | 14 types × ~10 turns |
| player_legitimacy_history | 6,877 | 140 | |
| player_military_history | 6,899 | 141 | |
| player_points_history | 6,729 | 137 | |
| technology_progress | 2,259 | 46 | Completed techs |
| city_unit_production | 1,105 | 23 | |
| city_projects | 1,100 | 22 | |
| units_produced | 927 | 19 | Per player |
| cities | 778 | 16 | |
| rulers | 299 | 6 | |
| players | 98 | 2 | 2 per match (human only) |

**Territory/tile data is the elephant in the room.** At 180K rows per 2-player Duel/Tiny match with avg 75 turns, larger maps and longer games will be significantly bigger. A 4-player Medium map at 200 turns could easily produce 1M+ territory rows per match.

Per-ankh's approach (snapshot + sparse change history) produces far fewer rows but requires more complex query logic for point-in-time reconstruction.

**For the opinion histories** (family + religion), the high row counts reflect the sparse time-series encoding: many families/religions × many turns. Per-ankh stores these identically.

---

## 6. Coverage Gap Analysis

### What Prospector Captures That Per-Ankh Does Not

| Data | Prospector Location | Notes |
|---|---|---|
| Bonus counts (hundreds of types) | `player_statistics` (bonus_count.*) | Game-internal bonus tracking — achievements, character actions, resource bonuses |
| Law change counts by category | `player_statistics` (law_changes.*) | Per-ankh has `laws.change_count` but only for the current law |
| Yield stockpiles | `player_statistics` (yield_stockpile.*) | Per-ankh has `player_resources` — likely equivalent |
| Unit classifications | `unit_classifications` | Static reference table: 47 unit types → category + role |
| Winner determination audit | `match_winners` | Records `winner_determination_method` — whether the winner was identified by the parser's three-tier logic (TeamVictoriesCompleted → Victory element → highest score) or manually overridden by a tournament admin via `match_winner_overrides.json`. Per-ankh stores `winner_player_id` on `matches` with no provenance. |
| Event coordinates | `events.x_coordinate`, `events.y_coordinate` | Spatial location of events |
| Match narratives | `matches.narrative_summary`, etc. | AI-generated, not from XML |

### What Per-Ankh Captures That Prospector Does Not

| Data | Per-Ankh Location | Notes |
|---|---|---|
| Full character system | `characters` + 5 sub-tables | Hundreds of characters per match, not just rulers |
| Character traits over time | `character_traits` | Acquisition and removal with turns |
| Character relationships | `character_relationships` | Inter-character dynamics |
| Character marriages | `character_marriages` | Marriage records with turn ranges |
| Character missions | `character_missions` | Active mission assignments |
| Families as entities | `families` | Class, head, seat city |
| Family law opinions | `family_law_opinions` | Which laws families prefer |
| Religions as entities | `religions` | Founder, holy city, head character |
| Tribes | `tribes` | Leader, allied player, religion |
| Diplomacy | `diplomacy` | Player/tribe relations with war scores |
| Laws | `laws` | Current law per category with turn |
| Goals/Ambitions | `player_goals` | Progress tracking with state |
| Story events | `story_events` | Typed with character/city FKs |
| Story choices | `story_choices` | Player decisions on events |
| Event outcomes | `event_outcomes` | Bonuses resulting from events |
| Memory data | `memory_data` | AI political memory system |
| Market prices | `yield_prices` | Turn-by-turn commodity prices |
| Tile detail | `tiles` | Rivers, height, vegetation, fog of war |
| Tile visibility | `tile_visibility` | Per-team fog of war state |
| Tile ownership history | `tile_ownership_history` | Territorial expansion over time |
| City yields | `city_yields` | Per-yield progress and overflow |
| City culture | `city_culture` | Per-team culture levels |
| City religions | `city_religions` | Religions present per city |
| City production queue | `city_production_queue` | In-progress builds |
| City enemy agents | `city_enemy_agents` | Spy tracking |
| City luxuries | `city_luxuries` | Luxury import history |
| Individual units | `units` | Position, stats, formation |
| Unit promotions | `unit_promotions` | Acquired and available |
| Unit effects | `unit_effects` | Active bonuses |
| Unit families | `unit_families` | Family recruitment association |
| Player council | `player_council` | Appointed officials |
| Player dynasty | `players.dynasty` | Dynasty name |
| Map seeds | `matches.first_seed`, `matches.map_seed` | For analysis/reproduction |
| Game version | `matches.game_version` | For compatibility tracking |
| Campaign UUID | `matches.game_id` | Unique campaign identifier |
| ID mapping | `id_mappings` | Re-import stability |
| Collections | `collections` | User-defined match groupings |

### What Neither App Captures

Based on XML structure knowledge, potential gaps include:
- Individual unit combat logs / battle outcomes
- Detailed trade route information
- Per-turn diplomatic state changes (both apps store only final state or events)
- Character opinion values toward other characters (only relationships, not numeric opinion)
- Detailed improvement yield contributions
- City tile assignment changes over time (which tiles belong to which city)
- Wonders in progress / completed (partially captured via city projects but not as first-class entities)
- Per-character court position history over time

---

*Generated from analysis of per-ankh schema v2.13.0 (docs/schema.sql) and prospector production database (49 matches, schema migrations 1.0.0–6). February 2026.*
