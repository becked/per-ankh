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
       ├── general_id → Character
       └── agent_id → Character
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

| Field | Type | Description |
|-------|------|-------------|
| `xml_id` | i32 | Original XML City ID |
| `city_name` | String | City name (from NameType or Name element) |
| `founded_turn` | i32 | Turn when city was founded |
| `player_xml_id` | Option<i32> | Owner player (None if in anarchy) |
| `tile_xml_id` | i32 | Tile where city center sits |
| `family` | Option<String> | Controlling family (e.g., FAMILY_SAITE) |
| `first_owner_player_xml_id` | Option<i32> | Original founder player |
| `is_capital` | bool | Whether this is a capital city |
| `citizens` | i32 | Current population |
| `growth_progress` | i32 | Progress toward next citizen |
| `governor_xml_id` | Option<i32> | Character ID of governor |
| `general_xml_id` | Option<i32> | Character ID of general |
| `agent_xml_id` | Option<i32> | Character ID of agent/spy |
| `hurry_civics_count` | i32 | Times production was hurried with civics |
| `hurry_money_count` | i32 | Times production was hurried with money |
| `specialist_count` | i32 | Count of specialists (aggregate) |

**Source:** `src-tauri/src/parser/game_data.rs` (lines 112-142)
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

| Field | Type | Description |
|-------|------|-------------|
| `city_xml_id` | i32 | City this culture data belongs to |
| `team_id` | i32 | Team/player this culture level is for |
| `culture_level` | i32 | Culture level (0-5 for normal to legendary) |
| `happiness_level` | i32 | Happiness modifier for this team |

**Source:** `src-tauri/src/parser/game_data.rs` (lines 284-325)
**Parser:** `src-tauri/src/parser/parsers/city_data.rs`

## Unparsed City Data (Future Work)

The following data exists in save file XML but is not yet parsed:

### High Priority

| Field | XML Element | Description |
|-------|-------------|-------------|
| `UnitProductionCounts` | `<UnitProductionCounts>` | **Breakdown of units produced by type** (e.g., 5 settlers, 1 worker) |
| `SpecialistProducedCount` | `<SpecialistProducedCount>` | Lifetime total specialists produced |
| `ProjectCount` | `<ProjectCount>` | Count of each project type completed (more detailed than CompletedBuild) |

### Medium Priority

| Field | XML Element | Description |
|-------|-------------|-------------|
| `GovernorTurn` | `<GovernorTurn>` | Turn when current governor was appointed |
| `GrowthCount` | `<GrowthCount>` | Total historical citizen growth |
| `YieldOverflow` | `<YieldOverflow>` | Overflow production per yield type |
| `FirstPlayer` | `<FirstPlayer>` | First owner (for conquest tracking) |
| `LastPlayer` | `<LastPlayer>` | Most recent owner |

### Espionage Data

| Field | XML Element | Description |
|-------|-------------|-------------|
| `AgentTurn` | `<AgentTurn><P.X>` | Turn when enemy player X placed agent |
| `AgentCharacterID` | `<AgentCharacterID><P.X>` | Character ID of enemy agent from player X |
| `AgentTileID` | `<AgentTileID><P.X>` | Tile where enemy agent is located |

This data tracks **enemy spies** in the city, keyed by player ID.

### Event History

| Field | XML Element | Description |
|-------|-------------|-------------|
| `EventStoryOption` | `<EventStoryOption>` | List of event choices made in this city |
| `EventStoryTurn` | `<EventStoryTurn>` | When each event type occurred |

### Other

| Field | XML Element | Description |
|-------|-------------|-------------|
| `LuxuryTurn` | `<LuxuryTurn>` | When luxuries were imported |
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
    growth_progress INTEGER DEFAULT 0,
    governor_id INTEGER,
    general_id INTEGER,
    agent_id INTEGER,
    hurry_civics_count INTEGER DEFAULT 0,
    hurry_money_count INTEGER DEFAULT 0,
    specialist_count INTEGER DEFAULT 0,
    first_owner_player_id INTEGER,
    PRIMARY KEY (city_id, match_id)
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
    owner_city_id INTEGER,  -- Links tile to controlling city
    PRIMARY KEY (tile_id, match_id),
    FOREIGN KEY (owner_city_id, match_id) REFERENCES cities(city_id, match_id)
);
```

## Multi-Pass Parsing

Cities and tiles have a circular dependency that requires multi-pass parsing:

1. **Pass 1:** Parse cities and tiles from XML (no DB)
2. **Pass 1.5:** Insert tiles with `owner_city_id = NULL`
3. **Pass 1.5:** Insert cities (now FK to tiles works)
4. **Pass 2b:** Update `tiles.owner_city_id` from `<CityTerritory>` XML

This is handled in `src-tauri/src/parser/import.rs` and `src-tauri/src/parser/entities/tiles.rs`.

## Note on specialist_count

The `cities.specialist_count` field is a **denormalized aggregate** - it matches the count of tiles with specialists in that city's territory. For detailed specialist information, always query through tiles.
