# City Data Reference

This document covers the city data model, how cities relate to tiles/improvements/specialists, and planned future parsing additions.

## Data Model Overview

Cities in Old World have a central tile where the city sits, plus a territory of tiles they control. Improvements and specialists are stored on individual tiles, not on the city itself.

```
City ──┬── tile_id → Tile (city center location)
       │
       ├── tiles.owner_city_id → Tiles (all territory)
       │   ├── improvement (e.g., IMPROVEMENT_FARM)
       │   └── specialist (e.g., SPECIALIST_POET_1)
       │
       ├── governor_id → Character
       │
       ├── city_enemy_agents → Enemy spies in the city
       │
       ├── city_project_counts → Completed project counts
       │
       └── city_luxuries → Imported luxury history
```

## Key Relationships

### City Location vs Territory

There are two distinct relationships between cities and tiles:

| Relationship | Field | Description |
|--------------|-------|-------------|
| **City Location** | `cities.tile_id` | The tile where the city center sits |
| **City Territory** | `tiles.owner_city_id` | All tiles controlled by this city |

### Getting Improvements for a City

Improvements are stored on tiles, not cities. To find all improvements for a city:

```sql
SELECT
    t.x, t.y,
    t.improvement,
    t.improvement_pillaged,
    t.improvement_disabled,
    t.improvement_turns_left,
    t.improvement_develop_turns
FROM tiles t
WHERE t.owner_city_id = :city_id
  AND t.match_id = :match_id
  AND t.improvement IS NOT NULL
ORDER BY t.improvement
```

### Getting Specialists for a City

Similarly, specialists are on tiles:

```sql
SELECT
    t.specialist,
    t.x, t.y,
    COUNT(*) as count
FROM tiles t
WHERE t.owner_city_id = :city_id
  AND t.match_id = :match_id
  AND t.specialist IS NOT NULL
GROUP BY t.specialist
ORDER BY t.specialist
```

### Complete City Territory Query

To get all tile data for a city's territory:

```sql
SELECT
    t.x, t.y,
    t.terrain,
    t.height,
    t.resource,
    t.improvement,
    t.specialist,
    t.improvement_pillaged,
    t.improvement_turns_left
FROM tiles t
WHERE t.owner_city_id = :city_id
  AND t.match_id = :match_id
ORDER BY t.x, t.y
```

## Currently Parsed City Data

### Core Fields (CityData struct)

| Field | Type | XML Element | Description |
|-------|------|-------------|-------------|
| `xml_id` | i32 | `ID` attr | Original XML City ID |
| `city_name` | String | `NameType` or `Name` | City name |
| `founded_turn` | i32 | `Founded` attr | Turn when city was founded |
| `player_xml_id` | Option<i32> | `Player` attr | Owner player (None if in anarchy) |
| `tile_xml_id` | i32 | `TileID` attr | Tile where city center sits |
| `family` | Option<String> | `Family` attr | Controlling family (e.g., FAMILY_SAITE) |
| `first_owner_player_xml_id` | Option<i32> | `FirstPlayer` | Original founder player |
| `last_owner_player_xml_id` | Option<i32> | `LastPlayer` | Most recent owner |
| `is_capital` | bool | `Capital` | Whether this is a capital city |
| `citizens` | i32 | `Citizens` | Current population |
| `governor_xml_id` | Option<i32> | `GovernorID` | Character ID of governor |
| `governor_turn` | Option<i32> | `GovernorTurn` | Turn when governor was assigned |
| `hurry_civics_count` | i32 | `HurryCivicsCount` | Times production was hurried with civics |
| `hurry_money_count` | i32 | `HurryMoneyCount` | Times production was hurried with money |
| `hurry_training_count` | i32 | `HurryTrainingCount` | Times production was hurried with training |
| `hurry_population_count` | i32 | `HurryPopulationCount` | Times production was hurried with population |
| `specialist_count` | i32 | `SpecialistProducedCount` | Lifetime specialists produced |
| `growth_count` | i32 | `GrowthCount` | Total historical citizen growth |
| `unit_production_count` | i32 | `UnitProductionCount` | Total units produced (aggregate) |
| `buy_tile_count` | i32 | `BuyTileCount` | Tiles purchased |

**Source:** `src-tauri/src/parser/game_data.rs`
**Parser:** `src-tauri/src/parser/parsers/cities.rs`

### Extended City Data (Separate Tables)

#### CityProductionItem (Production Queue)

| Field | Type | Description |
|-------|------|-------------|
| `city_xml_id` | i32 | City this queue belongs to |
| `queue_position` | i32 | Position in queue (0 = currently building) |
| `build_type` | String | BUILD_UNIT, BUILD_IMPROVEMENT, BUILD_PROJECT |
| `item_type` | String | Specific item (e.g., UNIT_WORKER) |
| `progress` | i32 | Production invested so far |
| `is_repeat` | bool | Whether this repeats when complete |

#### CityProjectCompleted

| Field | Type | Description |
|-------|------|-------------|
| `city_xml_id` | i32 | City that completed the project |
| `project_type` | String | Format: "BUILD_TYPE.ITEM_TYPE" |
| `count` | i32 | Number of times completed |

#### CityYield

| Field | Type | Description |
|-------|------|-------------|
| `city_xml_id` | i32 | City this yield belongs to |
| `yield_type` | String | YIELD_GROWTH, YIELD_CULTURE, etc. |
| `progress` | i32 | Accumulated progress |

#### CityReligion

| Field | Type | Description |
|-------|------|-------------|
| `city_xml_id` | i32 | City with this religion |
| `religion` | String | RELIGION_JUDAISM, RELIGION_CHRISTIANITY, etc. |

#### CityCulture

| Field | Type | XML Element | Description |
|-------|------|-------------|-------------|
| `city_xml_id` | i32 | `ID` attr | City this culture data belongs to |
| `team_id` | i32 | `T.X` tag | Team/player this culture level is for |
| `culture_level` | i32 | `TeamCulture.T.X` | Culture level (0-5 for normal to legendary) |
| `happiness_level` | i32 | `TeamHappinessLevel.T.X` or `TeamDiscontentLevel.T.X` | Happiness modifier for this team |

**Note:** Older saves (2022) use `TeamDiscontentLevel` instead of `TeamHappinessLevel`. The parser automatically handles both formats.

#### CityProjectCount

| Field | Type | XML Element | Description |
|-------|------|-------------|-------------|
| `city_xml_id` | i32 | `ID` attr | City that completed the projects |
| `project_type` | String | tag name | Project type (e.g., PROJECT_WALLS) |
| `count` | i32 | text | Number of times completed |

**Note:** This is distinct from `CityProjectCompleted` which parses `<CompletedBuild>` (a log). This table parses `<ProjectCount>` (aggregated counts per project type).

#### CityEnemyAgent

| Field | Type | XML Element | Description |
|-------|------|-------------|-------------|
| `city_xml_id` | i32 | `ID` attr | City with enemy spy |
| `enemy_player_xml_id` | i32 | `P.X` tag | Enemy player ID |
| `agent_character_xml_id` | Option<i32> | `AgentCharacterID.P.X` | Character ID of enemy agent |
| `placed_turn` | Option<i32> | `AgentTurn.P.X` | Turn when agent was placed |
| `agent_tile_xml_id` | Option<i32> | `AgentTileID.P.X` | Tile where agent is located |

**Note:** This tracks **enemy spies** in the city, keyed by player ID.

#### CityLuxury

| Field | Type | XML Element | Description |
|-------|------|-------------|-------------|
| `city_xml_id` | i32 | `ID` attr | City with luxury import |
| `resource` | String | `LuxuryTurn.RESOURCE_X` tag | Resource type (e.g., RESOURCE_FUR) |
| `imported_turn` | i32 | text | Turn when luxury was imported |

**Source:** `src-tauri/src/parser/game_data.rs`
**Parser:** `src-tauri/src/parser/parsers/city_data.rs`

## Unparsed City Data (Future Work)

The following data exists in save file XML but is not yet parsed:

### Medium Priority

| Field | XML Element | Description |
|-------|-------------|-------------|
| `YieldOverflow` | `<YieldOverflow>` | Overflow production per yield type |

### Event History

| Field | XML Element | Description |
|-------|-------------|-------------|
| `EventStoryOption` | `<EventStoryOption>` | List of event choices made in this city |
| `EventStoryTurn` | `<EventStoryTurn>` | When each event type occurred |

### Other

| Field | XML Element | Description |
|-------|-------------|-------------|
| `TeamCultureStep` | `<TeamCultureStep>` | Culture level progression |
| `PlayerFamily` | `<PlayerFamily>` | Historical family ownership by player |

## Raw XML Example

From a typical save file:

```xml
<City
    ID="0"
    TileID="1745"
    Player="0"
    Family="FAMILY_SAITE"
    Founded="1">
    <NameType>CITYNAME_WASET</NameType>
    <GovernorID>568</GovernorID>
    <GovernorTurn>172</GovernorTurn>
    <Citizens>2</Citizens>
    <GrowthCount>13</GrowthCount>
    <SpecialistProducedCount>24</SpecialistProducedCount>
    <Capital />
    <FirstPlayer>0</FirstPlayer>
    <LastPlayer>0</LastPlayer>
    <YieldProgress>
      <YIELD_GROWTH>1171</YIELD_GROWTH>
      <YIELD_CULTURE>53327</YIELD_CULTURE>
      <YIELD_HAPPINESS>1008</YIELD_HAPPINESS>
    </YieldProgress>
    <YieldOverflow>
      <YIELD_GROWTH>40</YIELD_GROWTH>
      <YIELD_CIVICS>221</YIELD_CIVICS>
    </YieldOverflow>
    <UnitProductionCounts>
      <UNIT_SETTLER>5</UNIT_SETTLER>
      <UNIT_WORKER>1</UNIT_WORKER>
    </UnitProductionCounts>
    <ProjectCount>
      <PROJECT_TREASURY_1>1</PROJECT_TREASURY_1>
      <PROJECT_LUXURIOUS_DELIGHTS>1</PROJECT_LUXURIOUS_DELIGHTS>
    </ProjectCount>
    <Religion>
      <RELIGION_JUDAISM />
      <RELIGION_CHRISTIANITY />
      <RELIGION_PAGAN_EGYPT />
    </Religion>
    <TeamCulture>
      <T.0>CULTURE_LEGENDARY</T.0>
    </TeamCulture>
    <TeamHappinessLevel>
      <T.0>-8</T.0>
    </TeamHappinessLevel>
    <!-- ... more elements ... -->
</City>
```

## Database Schema

### cities table

```sql
CREATE TABLE cities (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    xml_id INTEGER,
    player_id INTEGER,
    tile_id INTEGER NOT NULL,
    city_name VARCHAR NOT NULL,
    family VARCHAR,
    founded_turn INTEGER NOT NULL,
    is_capital BOOLEAN DEFAULT false,
    citizens INTEGER DEFAULT 1,
    governor_id INTEGER,
    governor_turn INTEGER,
    hurry_civics_count INTEGER DEFAULT 0,
    hurry_money_count INTEGER DEFAULT 0,
    hurry_training_count INTEGER DEFAULT 0,
    hurry_population_count INTEGER DEFAULT 0,
    specialist_count INTEGER DEFAULT 0,
    growth_count INTEGER DEFAULT 0,
    unit_production_count INTEGER DEFAULT 0,
    buy_tile_count INTEGER DEFAULT 0,
    first_owner_player_id INTEGER,
    last_owner_player_id INTEGER,
    PRIMARY KEY (city_id, match_id)
);
```

### city_project_counts table

```sql
-- City project counts from <ProjectCount> element
-- Note: Distinct from city_projects_completed which logs <CompletedBuild>
CREATE TABLE city_project_counts (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    project_type VARCHAR NOT NULL,  -- PROJECT_WALLS, PROJECT_FORUM_4, etc.
    count INTEGER NOT NULL,
    PRIMARY KEY (city_id, match_id, project_type)
);
```

### city_enemy_agents table

```sql
-- Enemy spies operating in cities
CREATE TABLE city_enemy_agents (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    enemy_player_id INTEGER NOT NULL,
    agent_character_id INTEGER,
    placed_turn INTEGER,
    agent_tile_id INTEGER,
    PRIMARY KEY (city_id, match_id, enemy_player_id)
);
```

### city_luxuries table

```sql
-- Luxury resource import history per city
CREATE TABLE city_luxuries (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    resource VARCHAR NOT NULL,  -- RESOURCE_FUR, RESOURCE_SILK, etc.
    imported_turn INTEGER NOT NULL,
    PRIMARY KEY (city_id, match_id, resource)
);
```

### tiles table (relevant fields)

```sql
CREATE TABLE tiles (
    tile_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    improvement VARCHAR,
    improvement_pillaged BOOLEAN DEFAULT false,
    improvement_disabled BOOLEAN DEFAULT false,
    improvement_turns_left INTEGER,
    improvement_develop_turns INTEGER DEFAULT 0,
    specialist VARCHAR,
    owner_city_id INTEGER,  -- References: cities(city_id, match_id)
    PRIMARY KEY (tile_id, match_id)
);
```

**Note:** Foreign key constraints were removed for ETL performance. Relationships are documented in comments.

## Multi-Pass Parsing

Cities and tiles have a circular dependency that requires multi-pass parsing:

1. **Pass 1:** Parse cities and tiles from XML (no DB)
2. **Pass 1.5:** Insert tiles with `owner_city_id = NULL`
3. **Pass 1.5:** Insert cities (now FK to tiles works)
4. **Pass 2b:** Update `tiles.owner_city_id` from `<CityTerritory>` XML

This is handled in `src-tauri/src/parser/import.rs` and `src-tauri/src/parser/entities/tiles.rs`.

## Notes on Aggregate Fields

### specialist_count

The `cities.specialist_count` field stores the **lifetime total specialists produced** (from `<SpecialistProducedCount>`), not the current count. For the current count of specialists in a city's territory, query through tiles.

### unit_production_count vs city_units_produced

Two separate data sources track unit production:
- `cities.unit_production_count` - Parses `<UnitProductionCount>`, the aggregate total units produced
- `city_units_produced` table - Parses `<UnitProductionCounts>`, the per-unit-type breakdown (e.g., 5 settlers, 1 worker)

### city_projects_completed vs city_project_counts

These tables serve different purposes:
- `city_projects_completed` - Parses `<CompletedBuild>`, a log of all completed build queue items
- `city_project_counts` - Parses `<ProjectCount>`, aggregated counts per project type (more efficient for statistics)
