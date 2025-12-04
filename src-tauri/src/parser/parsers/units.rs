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

            // Filter out negative player IDs (sentinel value for "no player")
            let player_xml_id = unit_node
                .attribute("Player")
                .and_then(|s| s.parse::<i32>().ok())
                .filter(|&id| id >= 0);
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
            // Filter out negative original player IDs (sentinel value for "no original player")
            let original_player_xml_id = unit_node
                .opt_child_text("OriginalPlayer")
                .and_then(|s| s.parse::<i32>().ok())
                .filter(|&id| id >= 0);
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
        assert!(parsed
            .effects
            .iter()
            .any(|e| e.effect == "EFFECTUNIT_STEADFAST" && e.stacks == 1));
        assert!(parsed
            .effects
            .iter()
            .any(|e| e.effect == "EFFECTUNIT_INSPIRED" && e.stacks == 2));
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
        assert!(parsed
            .families
            .iter()
            .any(|f| f.player_xml_id == 0 && f.family_name == "FAMILY_FABIUS"));
        assert!(parsed
            .families
            .iter()
            .any(|f| f.player_xml_id == 1 && f.family_name == "FAMILY_VALERIUS"));
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
