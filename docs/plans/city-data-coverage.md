# City Data Coverage Implementation Plan

## Phase 1: Bug Fixes in City Parsers

Fix incorrect XML element name lookups. **Note:** There are two city parsers that both require identical fixes.

### Code Changes

**`src-tauri/src/parser/parsers/cities.rs`** (struct-based parser)

| Line  | Current Code                           | Fix                                         | Reason                                    |
| ----- | -------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| 47-50 | `opt_child_text("GrowthProgress")`     | Remove entirely                             | Doesn't exist in XML                      |
| 57-59 | `opt_child_text("GeneralID")`          | Remove entirely                             | Doesn't exist in city XML                 |
| 61-63 | `opt_child_text("Agent")`              | Remove entirely                             | Complex spy structure, handled in Phase 3 |
| 76-79 | `opt_child_text("SpecialistCount")`    | `opt_child_text("SpecialistProducedCount")` | XML uses `<SpecialistProducedCount>`      |
| 82-84 | `opt_child_text("FirstOwnerPlayerID")` | `opt_child_text("FirstPlayer")`             | XML uses `<FirstPlayer>`                  |

**`src-tauri/src/parser/entities/cities.rs`** (direct DB insert parser)

Apply identical fixes at:
| Line | Current Code | Fix |
|------|--------------|-----|
| 59-62 | `opt_child_text("GrowthProgress")` | Remove entirely |
| 73-79 | `opt_child_text("GeneralID")` | Remove entirely |
| 81-87 | `opt_child_text("Agent")` | Remove entirely |
| 98-101 | `opt_child_text("SpecialistCount")` | `opt_child_text("SpecialistProducedCount")` |
| 104-106 | `opt_child_text("FirstOwnerPlayerID")` | `opt_child_text("FirstPlayer")` |

Also update the tuple construction (lines 113-132) and appender call (lines 146-154) to remove deleted fields.

**`src-tauri/src/parser/game_data.rs`** - `CityData` struct (lines 114-142)

Remove fields:

- `growth_progress: i32` (line 131)
- `general_xml_id: Option<i32>` (line 135)
- `agent_xml_id: Option<i32>` (line 136)

**`src-tauri/src/db/schema.sql`** - `cities` table (lines 402-429)

Remove columns:

- `growth_progress INTEGER DEFAULT 0` (line 417)
- `general_id INTEGER` (line 420)
- `agent_id INTEGER` (line 421)

### Unit Tests

Update `src-tauri/src/parser/parsers/cities.rs` tests:

```rust
#[test]
fn test_parse_cities_first_player() {
    let xml = r#"<Root GameId="test">
        <City ID="0" Player="0" TileID="100" Founded="1">
            <Name>Test</Name>
            <FirstPlayer>2</FirstPlayer>
        </City>
    </Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();
    let cities = parse_cities_struct(&doc).unwrap();
    assert_eq!(cities[0].first_owner_player_xml_id, Some(2));
}

#[test]
fn test_parse_cities_specialist_produced_count() {
    let xml = r#"<Root GameId="test">
        <City ID="0" Player="0" TileID="100" Founded="1">
            <Name>Test</Name>
            <SpecialistProducedCount>24</SpecialistProducedCount>
        </City>
    </Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();
    let cities = parse_cities_struct(&doc).unwrap();
    assert_eq!(cities[0].specialist_count, 24);
}
```

---

## Phase 2: New City Fields

Add missing city columns and all 4 hurry metrics. **Both parsers must be updated.**

### Code Changes

**`src-tauri/src/parser/game_data.rs`** - `CityData` struct

Add fields after existing `specialist_count`:

```rust
pub struct CityData {
    // ... existing fields ...

    // New fields
    pub governor_turn: Option<i32>,
    pub growth_count: i32,
    pub unit_production_count: i32,
    pub last_owner_player_xml_id: Option<i32>,
    pub buy_tile_count: i32,

    // Hurry metrics (hurry_civics_count and hurry_money_count already exist)
    pub hurry_training_count: i32,
    pub hurry_population_count: i32,
}
```

**`src-tauri/src/parser/parsers/cities.rs`**

Add parsing for new fields after existing hurry_money_count parsing:

```rust
let governor_turn = city_node
    .opt_child_text("GovernorTurn")
    .and_then(|s| s.parse::<i32>().ok());

let growth_count = city_node
    .opt_child_text("GrowthCount")
    .and_then(|s| s.parse::<i32>().ok())
    .unwrap_or(0);

let unit_production_count = city_node
    .opt_child_text("UnitProductionCount")
    .and_then(|s| s.parse::<i32>().ok())
    .unwrap_or(0);

let last_owner_player_xml_id = city_node
    .opt_child_text("LastPlayer")
    .and_then(|s| s.parse::<i32>().ok());

let buy_tile_count = city_node
    .opt_child_text("BuyTileCount")
    .and_then(|s| s.parse::<i32>().ok())
    .unwrap_or(0);

let hurry_training_count = city_node
    .opt_child_text("HurryTrainingCount")
    .and_then(|s| s.parse::<i32>().ok())
    .unwrap_or(0);

let hurry_population_count = city_node
    .opt_child_text("HurryPopulationCount")
    .and_then(|s| s.parse::<i32>().ok())
    .unwrap_or(0);
```

Update `CityData` struct construction to include new fields.

**`src-tauri/src/parser/entities/cities.rs`**

Add identical parsing logic. Update tuple construction and appender to include new fields. Also map `last_owner_player_xml_id` through `id_mapper.get_player()` for DB ID.

**`src-tauri/src/db/schema.sql`** - `cities` table

Add columns after `specialist_count`:

```sql
governor_turn INTEGER,
growth_count INTEGER DEFAULT 0,
unit_production_count INTEGER DEFAULT 0,
last_owner_player_id INTEGER,
buy_tile_count INTEGER DEFAULT 0,
hurry_training_count INTEGER DEFAULT 0,
hurry_population_count INTEGER DEFAULT 0,
```

### Unit Tests

Add to `src-tauri/src/parser/parsers/cities.rs`:

```rust
#[test]
fn test_parse_cities_all_hurry_metrics() {
    let xml = r#"<Root GameId="test">
        <City ID="0" Player="0" TileID="100" Founded="1">
            <Name>Test</Name>
            <HurryCivicsCount>3</HurryCivicsCount>
            <HurryTrainingCount>2</HurryTrainingCount>
            <HurryMoneyCount>5</HurryMoneyCount>
            <HurryPopulationCount>4</HurryPopulationCount>
        </City>
    </Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();
    let cities = parse_cities_struct(&doc).unwrap();
    assert_eq!(cities[0].hurry_civics_count, 3);
    assert_eq!(cities[0].hurry_training_count, 2);
    assert_eq!(cities[0].hurry_money_count, 5);
    assert_eq!(cities[0].hurry_population_count, 4);
}

#[test]
fn test_parse_cities_new_fields() {
    let xml = r#"<Root GameId="test">
        <City ID="0" Player="0" TileID="100" Founded="1">
            <Name>Test</Name>
            <GovernorTurn>45</GovernorTurn>
            <GrowthCount>12</GrowthCount>
            <UnitProductionCount>8</UnitProductionCount>
            <LastPlayer>0</LastPlayer>
            <BuyTileCount>3</BuyTileCount>
        </City>
    </Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();
    let cities = parse_cities_struct(&doc).unwrap();
    assert_eq!(cities[0].governor_turn, Some(45));
    assert_eq!(cities[0].growth_count, 12);
    assert_eq!(cities[0].unit_production_count, 8);
    assert_eq!(cities[0].last_owner_player_xml_id, Some(0));
    assert_eq!(cities[0].buy_tile_count, 3);
}
```

---

## Phase 3: New City-Related Tables and Legacy Format Support

Add parsers and tables for project counts, enemy agents, and luxuries. Fix legacy save format support for happiness data.

**Note:** `city_units_produced` is already implemented in `src-tauri/src/parser/entities/unit_production.rs`. The existing `city_projects_completed` table parses `<CompletedBuild>` (a log). The new `city_project_counts` table parses `<ProjectCount>` (aggregated counts per project type) - these are different data structures.

### Code Changes

**`src-tauri/src/parser/game_data.rs`**

Add new structs near existing `CityProductionItem`:

```rust
/// City project completion counts from <ProjectCount> element
/// Note: This is distinct from CityProjectCompleted which parses <CompletedBuild>
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityProjectCount {
    pub city_xml_id: i32,
    pub project_type: String,  // e.g., "PROJECT_WALLS"
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
    pub resource: String,  // e.g., "RESOURCE_FUR"
    pub imported_turn: i32,
}
```

**`src-tauri/src/parser/parsers/city_data.rs`** - Fix `parse_city_culture_struct`

Update lines 211-227 to handle both `TeamHappinessLevel` (newer saves, 2023+) and `TeamDiscontentLevel` (older saves, 2022):

```rust
// Check for TeamHappinessLevel first (newer format), fall back to TeamDiscontentLevel (older format)
let team_happiness = city_node
    .children()
    .find(|n| n.has_tag_name("TeamHappinessLevel"))
    .or_else(|| city_node.children().find(|n| n.has_tag_name("TeamDiscontentLevel")))
    .map(|node| {
        node.children()
            .filter(|n| n.is_element())
            .filter_map(|team_node| {
                let team_tag = team_node.tag_name().name();
                let team_id: i32 = team_tag.strip_prefix("T.")?.parse().ok()?;
                let happiness: i32 = team_node.text()?.parse().ok()?;
                Some((team_id, happiness))
            })
            .collect::<HashMap<i32, i32>>()
    })
    .unwrap_or_default();
```

**`src-tauri/src/parser/parsers/city_data.rs`** - Add new parser functions

```rust
/// Parse ProjectCount for all cities
/// Note: Distinct from parse_city_projects_completed_struct which parses <CompletedBuild>
pub fn parse_city_project_counts_struct(doc: &XmlDocument) -> Result<Vec<CityProjectCount>> {
    let root = doc.root_element();
    let mut results = Vec::new();

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id: i32 = city_node
            .attribute("ID")
            .ok_or_else(|| ParseError::MissingAttribute("City.ID".to_string()))?
            .parse()?;

        if let Some(project_count_node) = city_node.children().find(|n| n.has_tag_name("ProjectCount")) {
            for project_elem in project_count_node.children().filter(|n| n.is_element()) {
                let project_type = project_elem.tag_name().name().to_string();
                let count: i32 = project_elem.text().and_then(|s| s.parse().ok()).unwrap_or(0);

                if count > 0 {
                    results.push(CityProjectCount {
                        city_xml_id,
                        project_type,
                        count,
                    });
                }
            }
        }
    }

    Ok(results)
}

/// Parse enemy agent data for all cities
pub fn parse_city_enemy_agents_struct(doc: &XmlDocument) -> Result<Vec<CityEnemyAgent>> {
    let root = doc.root_element();
    let mut results = Vec::new();

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id: i32 = city_node
            .attribute("ID")
            .ok_or_else(|| ParseError::MissingAttribute("City.ID".to_string()))?
            .parse()?;

        // Parse AgentTurn, AgentCharacterID, AgentTileID - each has <P.X> children
        let agent_turns = parse_player_keyed_element(&city_node, "AgentTurn");
        let agent_chars = parse_player_keyed_element(&city_node, "AgentCharacterID");
        let agent_tiles = parse_player_keyed_element(&city_node, "AgentTileID");

        // Collect all enemy player IDs
        let mut enemy_players: HashSet<i32> = HashSet::new();
        enemy_players.extend(agent_turns.keys());
        enemy_players.extend(agent_chars.keys());
        enemy_players.extend(agent_tiles.keys());

        for enemy_player_id in enemy_players {
            results.push(CityEnemyAgent {
                city_xml_id,
                enemy_player_xml_id: enemy_player_id,
                placed_turn: agent_turns.get(&enemy_player_id).copied(),
                agent_character_xml_id: agent_chars.get(&enemy_player_id).copied(),
                agent_tile_xml_id: agent_tiles.get(&enemy_player_id).copied(),
            });
        }
    }

    Ok(results)
}

/// Helper to parse <P.X>value</P.X> elements into HashMap<player_id, value>
fn parse_player_keyed_element(city_node: &impl XmlNodeExt, element_name: &str) -> HashMap<i32, i32> {
    city_node
        .children()
        .find(|n| n.has_tag_name(element_name))
        .map(|node| {
            node.children()
                .filter(|n| n.is_element())
                .filter_map(|elem| {
                    let tag = elem.tag_name().name();
                    let player_id: i32 = tag.strip_prefix("P.")?.parse().ok()?;
                    let value: i32 = elem.text()?.parse().ok()?;
                    Some((player_id, value))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Parse luxury import history for all cities
pub fn parse_city_luxuries_struct(doc: &XmlDocument) -> Result<Vec<CityLuxury>> {
    let root = doc.root_element();
    let mut results = Vec::new();

    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id: i32 = city_node
            .attribute("ID")
            .ok_or_else(|| ParseError::MissingAttribute("City.ID".to_string()))?
            .parse()?;

        if let Some(luxury_node) = city_node.children().find(|n| n.has_tag_name("LuxuryTurn")) {
            for luxury_elem in luxury_node.children().filter(|n| n.is_element()) {
                let resource = luxury_elem.tag_name().name().to_string();
                let imported_turn: i32 = luxury_elem.text().and_then(|s| s.parse().ok()).unwrap_or(0);

                results.push(CityLuxury {
                    city_xml_id,
                    resource,
                    imported_turn,
                });
            }
        }
    }

    Ok(results)
}
```

**`src-tauri/src/db/schema.sql`**

Add new tables after `city_projects_completed`:

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

-- Luxury resource import history per city
CREATE TABLE city_luxuries (
    city_id INTEGER NOT NULL,
    match_id BIGINT NOT NULL,
    resource VARCHAR NOT NULL,  -- RESOURCE_FUR, RESOURCE_SILK, etc.
    imported_turn INTEGER NOT NULL,
    PRIMARY KEY (city_id, match_id, resource)
);
```

**`src-tauri/src/parser/inserters/city_data.rs`** (extend existing file)

Add insertion functions following existing patterns in the file:

```rust
pub fn insert_city_project_counts(
    conn: &Connection,
    records: &[CityProjectCount],
    id_mapper: &IdMapper,
) -> Result<usize>

pub fn insert_city_enemy_agents(
    conn: &Connection,
    records: &[CityEnemyAgent],
    id_mapper: &IdMapper,
) -> Result<usize>

pub fn insert_city_luxuries(
    conn: &Connection,
    records: &[CityLuxury],
    id_mapper: &IdMapper,
) -> Result<usize>
```

**`src-tauri/src/parser/import.rs`**

Call new parsers and insertion functions in the city data parsing section (after existing city_yields, city_religions, city_culture calls).

**`src-tauri/src/db/schema.rs`**

Update `CURRENT_SCHEMA_VERSION` and add migration entry.

### Unit Tests

Add to `src-tauri/src/parser/parsers/city_data.rs`:

```rust
#[test]
fn test_parse_city_culture_with_happiness_level() {
    let xml = r#"<Root>
        <City ID="0">
            <TeamCulture>
                <T.0>5</T.0>
            </TeamCulture>
            <TeamHappinessLevel>
                <T.0>3</T.0>
            </TeamHappinessLevel>
        </City>
    </Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();
    let culture = parse_city_culture_struct(&doc).unwrap();
    assert_eq!(culture.len(), 1);
    assert_eq!(culture[0].happiness_level, 3);
}

#[test]
fn test_parse_city_culture_with_discontent_level_legacy() {
    // Older saves (2022) use TeamDiscontentLevel instead of TeamHappinessLevel
    let xml = r#"<Root>
        <City ID="0">
            <TeamCulture>
                <T.1>4</T.1>
            </TeamCulture>
            <TeamDiscontentLevel>
                <T.1>6</T.1>
            </TeamDiscontentLevel>
        </City>
    </Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();
    let culture = parse_city_culture_struct(&doc).unwrap();
    assert_eq!(culture.len(), 1);
    assert_eq!(culture[0].happiness_level, 6);
}

#[test]
fn test_parse_city_project_counts() {
    let xml = r#"<Root>
        <City ID="0">
            <ProjectCount>
                <PROJECT_WALLS>1</PROJECT_WALLS>
                <PROJECT_FORUM_4>2</PROJECT_FORUM_4>
            </ProjectCount>
        </City>
    </Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();
    let projects = parse_city_project_counts_struct(&doc).unwrap();
    assert_eq!(projects.len(), 2);
    assert!(projects.iter().any(|p| p.project_type == "PROJECT_WALLS" && p.count == 1));
    assert!(projects.iter().any(|p| p.project_type == "PROJECT_FORUM_4" && p.count == 2));
}

#[test]
fn test_parse_city_project_counts_empty() {
    let xml = r#"<Root><City ID="0"><ProjectCount /></City></Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();
    let projects = parse_city_project_counts_struct(&doc).unwrap();
    assert_eq!(projects.len(), 0);
}

#[test]
fn test_parse_city_enemy_agents() {
    let xml = r#"<Root>
        <City ID="0">
            <AgentTurn>
                <P.2>10</P.2>
                <P.4>15</P.4>
            </AgentTurn>
            <AgentCharacterID>
                <P.2>595</P.2>
                <P.4>530</P.4>
            </AgentCharacterID>
            <AgentTileID>
                <P.2>2070</P.2>
            </AgentTileID>
        </City>
    </Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();
    let agents = parse_city_enemy_agents_struct(&doc).unwrap();
    assert_eq!(agents.len(), 2);

    let p2_agent = agents.iter().find(|a| a.enemy_player_xml_id == 2).unwrap();
    assert_eq!(p2_agent.placed_turn, Some(10));
    assert_eq!(p2_agent.agent_character_xml_id, Some(595));
    assert_eq!(p2_agent.agent_tile_xml_id, Some(2070));

    let p4_agent = agents.iter().find(|a| a.enemy_player_xml_id == 4).unwrap();
    assert_eq!(p4_agent.placed_turn, Some(15));
    assert_eq!(p4_agent.agent_character_xml_id, Some(530));
    assert_eq!(p4_agent.agent_tile_xml_id, None); // P.4 not in AgentTileID
}

#[test]
fn test_parse_city_enemy_agents_empty() {
    let xml = r#"<Root>
        <City ID="0">
            <AgentTurn />
            <AgentCharacterID />
            <AgentTileID />
        </City>
    </Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();
    let agents = parse_city_enemy_agents_struct(&doc).unwrap();
    assert_eq!(agents.len(), 0);
}

#[test]
fn test_parse_city_luxuries() {
    let xml = r#"<Root>
        <City ID="0">
            <LuxuryTurn>
                <RESOURCE_FUR>154</RESOURCE_FUR>
                <RESOURCE_SILK>120</RESOURCE_SILK>
            </LuxuryTurn>
        </City>
    </Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();
    let luxuries = parse_city_luxuries_struct(&doc).unwrap();
    assert_eq!(luxuries.len(), 2);
    assert!(luxuries.iter().any(|l| l.resource == "RESOURCE_FUR" && l.imported_turn == 154));
    assert!(luxuries.iter().any(|l| l.resource == "RESOURCE_SILK" && l.imported_turn == 120));
}

#[test]
fn test_parse_city_luxuries_empty() {
    let xml = r#"<Root>
        <City ID="0">
            <LuxuryTurn />
        </City>
    </Root>"#;
    let doc = parse_xml(xml.to_string()).unwrap();
    let luxuries = parse_city_luxuries_struct(&doc).unwrap();
    assert_eq!(luxuries.len(), 0);
}
```
