# Unit Data Ingestion Plan

## Phase 1: Schema + Types + ID Mapping

### Files Changed

| File | Changes |
|------|---------|
| `docs/schema.sql` | Add `units`, `unit_promotions`, `unit_effects`, `unit_families` tables |
| `src-tauri/src/parser/game_data.rs` | Add `UnitData`, `UnitPromotion`, `UnitEffect`, `UnitFamily` structs |
| `src-tauri/src/parser/id_mapper.rs` | Add unit ID mapping methods |

### Schema (`docs/schema.sql`)

Add after the `tile_ownership_history` table (end of Section 8):

```sql
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
```

### Rust Types (`src-tauri/src/parser/game_data.rs`)

Add after `TileChange` struct:

```rust
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
```

Add to `ParsedGameData` struct:

```rust
pub units: Vec<UnitData>,
pub unit_promotions: Vec<UnitPromotion>,
pub unit_effects: Vec<UnitEffect>,
pub unit_families: Vec<UnitFamily>,
```

### ID Mapper (`src-tauri/src/parser/id_mapper.rs`)

Add unit mapping alongside existing tile/player/city mappings:

```rust
// In IdMapper struct fields:
unit_map: HashMap<i32, i64>,
next_unit_id: i64,

// In impl IdMapper:
pub fn map_unit(&mut self, xml_id: i32) -> i64 {
    *self.unit_map.entry(xml_id).or_insert_with(|| {
        let id = self.next_unit_id;
        self.next_unit_id += 1;
        id
    })
}

pub fn get_unit(&self, xml_id: i32) -> Result<i64> {
    self.unit_map
        .get(&xml_id)
        .copied()
        .ok_or_else(|| ParseError::UnmappedId("unit", xml_id))
}
```

Initialize in `new()`:
```rust
unit_map: HashMap::new(),
next_unit_id: 1,
```

### Unit Tests

**File**: `src-tauri/src/parser/id_mapper.rs` (add to existing tests module)

```rust
#[test]
fn test_unit_id_mapping() {
    let mut mapper = IdMapper::new(1);

    let id1 = mapper.map_unit(100);
    let id2 = mapper.map_unit(200);
    let id1_again = mapper.map_unit(100);

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(id1_again, 1);

    assert_eq!(mapper.get_unit(100).unwrap(), 1);
    assert_eq!(mapper.get_unit(200).unwrap(), 2);
    assert!(mapper.get_unit(999).is_err());
}
```

---

## Phase 2: Parser + Inserter + Integration

### Files Changed

| File | Changes |
|------|---------|
| `src-tauri/src/parser/parsers/units.rs` | New file: parse units, promotions, effects, families from Tile elements |
| `src-tauri/src/parser/parsers/mod.rs` | Export units module |
| `src-tauri/src/parser/inserters/units.rs` | New file: insert units, promotions, effects, families |
| `src-tauri/src/parser/inserters/mod.rs` | Export units module |
| `src-tauri/src/parser/import.rs` | Wire up unit parsing after tiles |

### Parser (`src-tauri/src/parser/parsers/units.rs`)

```rust
//! Unit parser - extracts unit data from Tile elements

use crate::parser::game_data::{UnitData, UnitEffect, UnitFamily, UnitPromotion};
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;

/// Parsed unit data with all related entities
pub struct ParsedUnits {
    pub units: Vec<UnitData>,
    pub promotions: Vec<UnitPromotion>,
    pub effects: Vec<UnitEffect>,
    pub families: Vec<UnitFamily>,
}

/// Parse all units and related data from Tile elements
pub fn parse_units_struct(doc: &XmlDocument) -> Result<ParsedUnits> {
    let root = doc.root_element();
    let mut units = Vec::new();
    let mut promotions = Vec::new();
    let mut effects = Vec::new();
    let mut families = Vec::new();

    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        let tile_xml_id = tile_node.req_attr("ID")?.parse::<i32>()?;

        for unit_node in tile_node.children().filter(|n| n.has_tag_name("Unit")) {
            let xml_id = unit_node.req_attr("ID")?.parse::<i32>()?;
            let unit_type = unit_node.req_attr("Type")?.to_string();

            let player_xml_id = unit_node
                .attribute("Player")
                .and_then(|s| s.parse::<i32>().ok());
            let tribe = unit_node.attribute("Tribe").map(|s| s.to_string());
            let seed = unit_node
                .attribute("Seed")
                .and_then(|s| s.parse::<i64>().ok());

            let xp = unit_node
                .opt_child_text("XP")
                .and_then(|s| s.parse::<i32>().ok());
            let level = unit_node
                .opt_child_text("Level")
                .and_then(|s| s.parse::<i32>().ok());
            let create_turn = unit_node
                .opt_child_text("CreateTurn")
                .and_then(|s| s.parse::<i32>().ok());
            let facing = unit_node.opt_child_text("Facing").map(|s| s.to_string());
            let original_player_xml_id = unit_node
                .opt_child_text("OriginalPlayer")
                .and_then(|s| s.parse::<i32>().ok());
            let turns_since_last_move = unit_node
                .opt_child_text("TurnsSinceLastMove")
                .and_then(|s| s.parse::<i32>().ok());
            let gender = unit_node.opt_child_text("Gender").map(|s| s.to_string());
            let is_sleeping = unit_node.children().any(|n| n.has_tag_name("Sleep"));
            let current_formation = unit_node
                .opt_child_text("CurrentFormation")
                .map(|s| s.to_string());

            units.push(UnitData {
                xml_id,
                tile_xml_id,
                unit_type,
                player_xml_id,
                tribe,
                xp,
                level,
                create_turn,
                facing,
                original_player_xml_id,
                turns_since_last_move,
                gender,
                is_sleeping,
                current_formation,
                seed,
            });

            // Parse acquired promotions
            if let Some(promo_node) = unit_node.children().find(|n| n.has_tag_name("Promotions")) {
                for child in promo_node.children().filter(|n| n.is_element()) {
                    promotions.push(UnitPromotion {
                        unit_xml_id: xml_id,
                        promotion: child.tag_name().name().to_string(),
                        is_acquired: true,
                    });
                }
            }

            // Parse available promotions
            if let Some(avail_node) = unit_node
                .children()
                .find(|n| n.has_tag_name("PromotionsAvailable"))
            {
                for child in avail_node.children().filter(|n| n.is_element()) {
                    promotions.push(UnitPromotion {
                        unit_xml_id: xml_id,
                        promotion: child.tag_name().name().to_string(),
                        is_acquired: false,
                    });
                }
            }

            // Parse bonus effects
            if let Some(effects_node) = unit_node
                .children()
                .find(|n| n.has_tag_name("BonusEffectUnits"))
            {
                for child in effects_node.children().filter(|n| n.is_element()) {
                    let stacks = child
                        .text()
                        .and_then(|s| s.parse::<i32>().ok())
                        .unwrap_or(1);
                    effects.push(UnitEffect {
                        unit_xml_id: xml_id,
                        effect: child.tag_name().name().to_string(),
                        stacks,
                    });
                }
            }

            // Parse family associations (format: <P.0>FAMILY_FABIUS</P.0>)
            if let Some(family_node) = unit_node
                .children()
                .find(|n| n.has_tag_name("PlayerFamily"))
            {
                for child in family_node.children().filter(|n| n.is_element()) {
                    let tag = child.tag_name().name();
                    // Parse player index from "P.0", "P.1", etc.
                    if let Some(idx_str) = tag.strip_prefix("P.") {
                        if let Ok(player_xml_id) = idx_str.parse::<i32>() {
                            if let Some(family_name) = child.text() {
                                families.push(UnitFamily {
                                    unit_xml_id: xml_id,
                                    player_xml_id,
                                    family_name: family_name.to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(ParsedUnits {
        units,
        promotions,
        effects,
        families,
    })
}
```

### Inserter (`src-tauri/src/parser/inserters/units.rs`)

```rust
//! Unit inserter - bulk insertion to database

use crate::parser::game_data::{UnitData, UnitEffect, UnitFamily, UnitPromotion};
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

pub fn insert_units(
    conn: &Connection,
    units: &[UnitData],
    id_mapper: &mut IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for unit in units {
        let db_id = id_mapper.map_unit(unit.xml_id);
        let tile_db_id = id_mapper.get_tile(unit.tile_xml_id)?;

        let player_db_id = match unit.player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        let original_player_db_id = match unit.original_player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        rows.push((
            db_id,
            id_mapper.match_id,
            unit.xml_id,
            tile_db_id,
            unit.unit_type.clone(),
            player_db_id,
            unit.tribe.clone(),
            unit.xp,
            unit.level,
            unit.create_turn,
            unit.facing.clone(),
            original_player_db_id,
            unit.turns_since_last_move,
            unit.gender.clone(),
            unit.is_sleeping,
            unit.current_formation.clone(),
            unit.seed,
        ));
    }

    let unique_units =
        deduplicate_rows_last_wins(rows, |(unit_id, match_id, ..)| (*unit_id, *match_id));

    let mut app = conn.appender("units")?;
    for (
        db_id,
        match_id,
        xml_id,
        tile_db_id,
        unit_type,
        player_db_id,
        tribe,
        xp,
        level,
        create_turn,
        facing,
        original_player_db_id,
        turns_since_last_move,
        gender,
        is_sleeping,
        current_formation,
        seed,
    ) in unique_units
    {
        app.append_row(params![
            db_id,
            match_id,
            xml_id,
            tile_db_id,
            unit_type,
            player_db_id,
            tribe,
            xp,
            level,
            create_turn,
            facing,
            original_player_db_id,
            turns_since_last_move,
            gender,
            is_sleeping,
            current_formation,
            seed
        ])?;
    }
    drop(app);

    log::info!("Inserted {} units", units.len());
    Ok(())
}

pub fn insert_unit_promotions(
    conn: &Connection,
    promotions: &[UnitPromotion],
    id_mapper: &IdMapper,
) -> Result<()> {
    if promotions.is_empty() {
        return Ok(());
    }

    let mut rows: Vec<(i64, i64, String, bool)> = Vec::new();
    for promo in promotions {
        let unit_db_id = id_mapper.get_unit(promo.unit_xml_id)?;
        rows.push((
            unit_db_id,
            id_mapper.match_id,
            promo.promotion.clone(),
            promo.is_acquired,
        ));
    }

    let unique = deduplicate_rows_last_wins(rows, |(unit_id, match_id, promo, _)| {
        (*unit_id, *match_id, promo.clone())
    });

    let mut app = conn.appender("unit_promotions")?;
    for (unit_id, match_id, promotion, is_acquired) in unique {
        app.append_row(params![unit_id, match_id, promotion, is_acquired])?;
    }
    drop(app);

    log::info!("Inserted {} unit promotions", promotions.len());
    Ok(())
}

pub fn insert_unit_effects(
    conn: &Connection,
    effects: &[UnitEffect],
    id_mapper: &IdMapper,
) -> Result<()> {
    if effects.is_empty() {
        return Ok(());
    }

    let mut rows: Vec<(i64, i64, String, i32)> = Vec::new();
    for effect in effects {
        let unit_db_id = id_mapper.get_unit(effect.unit_xml_id)?;
        rows.push((
            unit_db_id,
            id_mapper.match_id,
            effect.effect.clone(),
            effect.stacks,
        ));
    }

    let unique = deduplicate_rows_last_wins(rows, |(unit_id, match_id, effect, _)| {
        (*unit_id, *match_id, effect.clone())
    });

    let mut app = conn.appender("unit_effects")?;
    for (unit_id, match_id, effect, stacks) in unique {
        app.append_row(params![unit_id, match_id, effect, stacks])?;
    }
    drop(app);

    log::info!("Inserted {} unit effects", effects.len());
    Ok(())
}

pub fn insert_unit_families(
    conn: &Connection,
    families: &[UnitFamily],
    id_mapper: &IdMapper,
) -> Result<()> {
    if families.is_empty() {
        return Ok(());
    }

    let mut rows: Vec<(i64, i64, i64, String)> = Vec::new();
    for fam in families {
        let unit_db_id = id_mapper.get_unit(fam.unit_xml_id)?;
        let player_db_id = id_mapper.get_player(fam.player_xml_id)?;
        rows.push((
            unit_db_id,
            id_mapper.match_id,
            player_db_id,
            fam.family_name.clone(),
        ));
    }

    let unique = deduplicate_rows_last_wins(rows, |(unit_id, match_id, player_id, _)| {
        (*unit_id, *match_id, *player_id)
    });

    let mut app = conn.appender("unit_families")?;
    for (unit_id, match_id, player_id, family_name) in unique {
        app.append_row(params![unit_id, match_id, player_id, family_name])?;
    }
    drop(app);

    log::info!("Inserted {} unit family associations", families.len());
    Ok(())
}
```

### Integration (`src-tauri/src/parser/import.rs`)

In `import_save_file()`, after parsing tiles and before Phase 2 city ownership:

```rust
// Parse units (must be after tiles are parsed so tile IDs are mapped)
let parsed_units = parsers::units::parse_units_struct(&doc)?;
log::info!(
    "Parsed {} units, {} promotions, {} effects, {} family associations",
    parsed_units.units.len(),
    parsed_units.promotions.len(),
    parsed_units.effects.len(),
    parsed_units.families.len()
);

// Insert units and related data
inserters::units::insert_units(&conn, &parsed_units.units, &mut id_mapper)?;
inserters::units::insert_unit_promotions(&conn, &parsed_units.promotions, &id_mapper)?;
inserters::units::insert_unit_effects(&conn, &parsed_units.effects, &id_mapper)?;
inserters::units::insert_unit_families(&conn, &parsed_units.families, &id_mapper)?;
```

### Module Exports

**`src-tauri/src/parser/parsers/mod.rs`**:
```rust
pub mod units;
```

**`src-tauri/src/parser/inserters/mod.rs`**:
```rust
pub mod units;
```

### Unit Tests

**File**: `src-tauri/src/parser/parsers/units.rs` (add tests module)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_military_unit() {
        let xml = r#"<Root GameId="test" MapWidth="10">
            <Tile ID="100">
                <Unit ID="1" Type="UNIT_HASTATUS" Player="0" Tribe="NONE" Seed="12345">
                    <XP>120</XP>
                    <Level>2</Level>
                    <CreateTurn>50</CreateTurn>
                    <Facing>SW</Facing>
                    <OriginalPlayer>0</OriginalPlayer>
                    <TurnsSinceLastMove>5</TurnsSinceLastMove>
                </Unit>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let parsed = parse_units_struct(&doc).unwrap();

        assert_eq!(parsed.units.len(), 1);
        assert_eq!(parsed.units[0].xml_id, 1);
        assert_eq!(parsed.units[0].tile_xml_id, 100);
        assert_eq!(parsed.units[0].unit_type, "UNIT_HASTATUS");
        assert_eq!(parsed.units[0].player_xml_id, Some(0));
        assert_eq!(parsed.units[0].xp, Some(120));
        assert_eq!(parsed.units[0].level, Some(2));
    }

    #[test]
    fn test_parse_civilian_unit() {
        let xml = r#"<Root GameId="test" MapWidth="10">
            <Tile ID="200">
                <Unit ID="2" Type="UNIT_WORKER" Player="0" Tribe="NONE" Seed="67890">
                    <CreateTurn>30</CreateTurn>
                    <Gender>GENDER_FEMALE</Gender>
                </Unit>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let parsed = parse_units_struct(&doc).unwrap();

        assert_eq!(parsed.units.len(), 1);
        assert_eq!(parsed.units[0].xp, None);
        assert_eq!(parsed.units[0].level, None);
        assert_eq!(parsed.units[0].gender, Some("GENDER_FEMALE".to_string()));
    }

    #[test]
    fn test_parse_barbarian_unit() {
        let xml = r#"<Root GameId="test" MapWidth="10">
            <Tile ID="300">
                <Unit ID="3" Type="UNIT_WARRIOR" Tribe="TRIBE_ANARCHY" Seed="11111">
                    <XP>50</XP>
                </Unit>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let parsed = parse_units_struct(&doc).unwrap();

        assert_eq!(parsed.units[0].player_xml_id, None);
        assert_eq!(parsed.units[0].tribe, Some("TRIBE_ANARCHY".to_string()));
    }

    #[test]
    fn test_parse_sleeping_unit() {
        let xml = r#"<Root GameId="test" MapWidth="10">
            <Tile ID="400">
                <Unit ID="4" Type="UNIT_ARCHER" Player="0" Tribe="NONE" Seed="22222">
                    <Sleep />
                </Unit>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let parsed = parse_units_struct(&doc).unwrap();

        assert!(parsed.units[0].is_sleeping);
    }

    #[test]
    fn test_parse_promotions() {
        let xml = r#"<Root GameId="test" MapWidth="10">
            <Tile ID="100">
                <Unit ID="1" Type="UNIT_HASTATUS" Player="0" Tribe="NONE" Seed="1">
                    <Promotions>
                        <PROMOTION_GRAPPLER />
                        <PROMOTION_STRIKE1 />
                    </Promotions>
                    <PromotionsAvailable>
                        <PROMOTION_GUARD1 />
                        <PROMOTION_FOCUS1 />
                    </PromotionsAvailable>
                </Unit>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let parsed = parse_units_struct(&doc).unwrap();

        assert_eq!(parsed.promotions.len(), 4);

        let acquired: Vec<_> = parsed.promotions.iter().filter(|p| p.is_acquired).collect();
        let available: Vec<_> = parsed.promotions.iter().filter(|p| !p.is_acquired).collect();

        assert_eq!(acquired.len(), 2);
        assert_eq!(available.len(), 2);
        assert!(acquired.iter().any(|p| p.promotion == "PROMOTION_GRAPPLER"));
        assert!(available.iter().any(|p| p.promotion == "PROMOTION_GUARD1"));
    }

    #[test]
    fn test_parse_effects() {
        let xml = r#"<Root GameId="test" MapWidth="10">
            <Tile ID="100">
                <Unit ID="1" Type="UNIT_HASTATUS" Player="0" Tribe="NONE" Seed="1">
                    <BonusEffectUnits>
                        <EFFECTUNIT_STEADFAST>1</EFFECTUNIT_STEADFAST>
                        <EFFECTUNIT_INSPIRED>2</EFFECTUNIT_INSPIRED>
                    </BonusEffectUnits>
                </Unit>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let parsed = parse_units_struct(&doc).unwrap();

        assert_eq!(parsed.effects.len(), 2);
        assert!(parsed.effects.iter().any(|e| e.effect == "EFFECTUNIT_STEADFAST" && e.stacks == 1));
        assert!(parsed.effects.iter().any(|e| e.effect == "EFFECTUNIT_INSPIRED" && e.stacks == 2));
    }

    #[test]
    fn test_parse_family_associations() {
        let xml = r#"<Root GameId="test" MapWidth="10">
            <Tile ID="100">
                <Unit ID="1" Type="UNIT_HASTATUS" Player="0" Tribe="NONE" Seed="1">
                    <PlayerFamily>
                        <P.0>FAMILY_FABIUS</P.0>
                        <P.1>FAMILY_VALERIUS</P.1>
                    </PlayerFamily>
                </Unit>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let parsed = parse_units_struct(&doc).unwrap();

        assert_eq!(parsed.families.len(), 2);
        assert!(parsed.families.iter().any(|f| f.player_xml_id == 0 && f.family_name == "FAMILY_FABIUS"));
        assert!(parsed.families.iter().any(|f| f.player_xml_id == 1 && f.family_name == "FAMILY_VALERIUS"));
    }

    #[test]
    fn test_parse_multiple_units_across_tiles() {
        let xml = r#"<Root GameId="test" MapWidth="10">
            <Tile ID="100">
                <Unit ID="1" Type="UNIT_WARRIOR" Player="0" Tribe="NONE" Seed="1" />
                <Unit ID="2" Type="UNIT_ARCHER" Player="0" Tribe="NONE" Seed="2" />
            </Tile>
            <Tile ID="200">
                <Unit ID="3" Type="UNIT_WORKER" Player="0" Tribe="NONE" Seed="3" />
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let parsed = parse_units_struct(&doc).unwrap();

        assert_eq!(parsed.units.len(), 3);
        assert_eq!(parsed.units[0].tile_xml_id, 100);
        assert_eq!(parsed.units[1].tile_xml_id, 100);
        assert_eq!(parsed.units[2].tile_xml_id, 200);
    }

    #[test]
    fn test_parse_no_units() {
        let xml = r#"<Root GameId="test" MapWidth="10">
            <Tile ID="100">
                <Terrain>TERRAIN_PLAINS</Terrain>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let parsed = parse_units_struct(&doc).unwrap();

        assert_eq!(parsed.units.len(), 0);
        assert_eq!(parsed.promotions.len(), 0);
        assert_eq!(parsed.effects.len(), 0);
        assert_eq!(parsed.families.len(), 0);
    }
}
```
