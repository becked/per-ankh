# Per-Ankh Database Analysis Report

**Analysis Date:** 2025-11-06
**Database:** per-ankh.db
**Total Tables:** 54

## Summary

- **Empty Tables:** 19
- **Tables with Empty Columns:** 16
- **Populated Tables:** 35

## Table Row Counts

| Table Name               | Row Count | Status    |
| ------------------------ | --------- | --------- |
| family_opinion_history   | 7,920     | Populated |
| religion_opinion_history | 2,970     | Populated |
| yield_history            | 2,772     | Populated |
| id_mappings              | 2,181     | Populated |
| tiles                    | 2,024     | Populated |
| yield_prices             | 1,386     | Populated |
| tile_changes             | 954       | Populated |
| character_stats          | 721       | Populated |
| story_events             | 668       | Populated |
| character_traits         | 425       | Populated |
| legitimacy_history       | 198       | Populated |
| military_history         | 198       | Populated |
| points_history           | 198       | Populated |
| character_lineage        | 136       | Populated |
| characters               | 136       | Populated |
| technologies_completed   | 54        | Populated |
| technology_progress      | 49        | Populated |
| technology_states        | 46        | Populated |
| diplomacy                | 24        | Populated |
| player_units_produced    | 19        | Populated |
| city_units_produced      | 16        | Populated |
| player_resources         | 16        | Populated |
| cities                   | 13        | Populated |
| laws                     | 13        | Populated |
| city_production_queue    | 10        | Populated |
| tribes                   | 10        | Populated |
| families                 | 6         | Populated |
| player_council           | 5         | Populated |
| player_goals             | 5         | Populated |
| city_projects_completed  | 4         | Populated |
| player_performance       | 2         | Populated |
| players                  | 2         | Populated |
| schema_migrations        | 2         | Populated |
| match_summary            | 1         | Populated |
| matches                  | 1         | Populated |
| character_marriages      | 0         | Empty     |
| character_missions       | 0         | Empty     |
| character_relationships  | 0         | Empty     |
| city_culture             | 0         | Empty     |
| city_religions           | 0         | Empty     |
| city_yields              | 0         | Empty     |
| event_logs               | 0         | Empty     |
| event_outcomes           | 0         | Empty     |
| family_law_opinions      | 0         | Empty     |
| match_locks              | 0         | Empty     |
| match_settings           | 0         | Empty     |
| military_composition     | 0         | Empty     |
| religions                | 0         | Empty     |
| rulers                   | 0         | Empty     |
| story_choices            | 0         | Empty     |
| tile_visibility          | 0         | Empty     |
| unit_promotions          | 0         | Empty     |
| unit_types               | 0         | Empty     |
| units                    | 0         | Empty     |

## Empty Tables

The following tables contain no data:

- `character_marriages`
- `character_missions`
- `character_relationships`
- `city_culture`
- `city_religions`
- `city_yields`
- `event_logs`
- `event_outcomes`
- `family_law_opinions`
- `match_locks`
- `match_settings`
- `military_composition`
- `religions`
- `rulers`
- `story_choices`
- `tile_visibility`
- `unit_promotions`
- `unit_types`
- `units`

## Tables with Empty Columns

The following tables have columns that are completely empty (all NULL):

### `character_lineage` (136 rows)

| Column Name | Data Type |
| ----------- | --------- |
| father_name | VARCHAR   |
| mother_name | VARCHAR   |

### `character_traits` (425 rows)

| Column Name  | Data Type |
| ------------ | --------- |
| removed_turn | INTEGER   |

### `characters` (136 rows)

| Column Name        | Data Type |
| ------------------ | --------- |
| birth_city_id      | INTEGER   |
| birth_father_id    | INTEGER   |
| birth_mother_id    | INTEGER   |
| archetype          | VARCHAR   |
| wisdom             | INTEGER   |
| charisma           | INTEGER   |
| courage            | INTEGER   |
| discipline         | INTEGER   |
| became_leader_turn | INTEGER   |
| abdicated_turn     | INTEGER   |
| nation_joined_turn | INTEGER   |
| seed               | BIGINT    |

### `cities` (13 rows)

| Column Name           | Data Type |
| --------------------- | --------- |
| general_id            | INTEGER   |
| agent_id              | INTEGER   |
| first_owner_player_id | INTEGER   |

### `city_production_queue` (10 rows)

| Column Name | Data Type |
| ----------- | --------- |
| yield_costs | VARCHAR   |

### `diplomacy` (24 rows)

| Column Name                  | Data Type |
| ---------------------------- | --------- |
| war_score                    | INTEGER   |
| last_conflict_turn           | INTEGER   |
| last_diplomacy_turn          | INTEGER   |
| diplomacy_blocked_until_turn | INTEGER   |

### `match_summary` (1 rows)

| Column Name         | Data Type |
| ------------------- | --------- |
| game_name           | VARCHAR   |
| save_date           | TIMESTAMP |
| map_size            | VARCHAR   |
| victory_conditions  | VARCHAR   |
| winner_name         | VARCHAR   |
| winner_civilization | VARCHAR   |

### `matches` (1 rows)

| Column Name            | Data Type |
| ---------------------- | --------- |
| game_name              | VARCHAR   |
| save_date              | TIMESTAMP |
| map_width              | INTEGER   |
| map_height             | INTEGER   |
| map_size               | VARCHAR   |
| map_class              | VARCHAR   |
| map_aspect_ratio       | VARCHAR   |
| min_latitude           | INTEGER   |
| max_latitude           | INTEGER   |
| game_mode              | VARCHAR   |
| turn_style             | VARCHAR   |
| turn_timer             | VARCHAR   |
| turn_scale             | VARCHAR   |
| simultaneous_turns     | INTEGER   |
| opponent_level         | VARCHAR   |
| tribe_level            | VARCHAR   |
| development            | VARCHAR   |
| advantage              | VARCHAR   |
| succession_gender      | VARCHAR   |
| succession_order       | VARCHAR   |
| mortality              | VARCHAR   |
| event_level            | VARCHAR   |
| victory_point_modifier | VARCHAR   |
| force_march            | VARCHAR   |
| team_nation            | VARCHAR   |
| victory_conditions     | VARCHAR   |
| winner_player_id       | BIGINT    |
| first_seed             | BIGINT    |
| map_seed               | BIGINT    |

### `player_council` (5 rows)

| Column Name    | Data Type |
| -------------- | --------- |
| appointed_turn | INTEGER   |

### `player_goals` (5 rows)

| Column Name | Data Type |
| ----------- | --------- |
| failed_turn | INTEGER   |

### `players` (2 rows)

| Column Name              | Data Type |
| ------------------------ | --------- |
| team_id                  | INTEGER   |
| difficulty               | VARCHAR   |
| last_turn_completed      | INTEGER   |
| founder_character_id     | INTEGER   |
| chosen_heir_id           | INTEGER   |
| original_capital_city_id | INTEGER   |

### `story_events` (668 rows)

| Column Name            | Data Type |
| ---------------------- | --------- |
| secondary_character_id | INTEGER   |
| event_text             | VARCHAR   |

### `technologies_completed` (54 rows)

| Column Name    | Data Type |
| -------------- | --------- |
| completed_turn | INTEGER   |

### `tile_changes` (954 rows)

| Column Name | Data Type |
| ----------- | --------- |
| old_value   | VARCHAR   |

### `tiles` (2,024 rows)

| Column Name            | Data Type |
| ---------------------- | --------- |
| improvement_turns_left | INTEGER   |
| owner_player_id        | INTEGER   |
| owner_city_id          | INTEGER   |
| religion               | VARCHAR   |

### `tribes` (10 rows)

| Column Name         | Data Type |
| ------------------- | --------- |
| xml_id              | INTEGER   |
| leader_character_id | INTEGER   |
| allied_player_id    | INTEGER   |
| religion            | VARCHAR   |

## Data Completeness Analysis

- **Overall Table Completeness:** 64.8% (35/54 tables)

## Recommendations

### Empty Tables

The following actions should be considered for empty tables:

1. **Verify Parser Implementation:** Check if the corresponding parsers are implemented and functioning correctly
2. **Check Save File Data:** Verify if the source save files actually contain data for these entities
3. **Schema Review:** Determine if these tables are needed for current/future game versions

### Empty Columns in Populated Tables

For columns that are completely empty in otherwise populated tables:

1. **Review Data Model:** Verify if these columns map to optional game features
2. **Parser Updates:** Check if parser logic needs updates to populate these fields
3. **Data Availability:** Confirm if this data exists in source save files
4. **Schema Cleanup:** Consider removing unused columns if they're not needed
