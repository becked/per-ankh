// Unit production aggregate data parsers - pure parsing (no DB dependency)

use crate::parser::game_data::{CityUnitProduction, PlayerUnitProduction};
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};

/// Parse player-level unit production counts from <Player>/<UnitsProduced>
///
/// Tracks total count of each unit type produced by each player throughout the game.
pub fn parse_player_units_produced(doc: &XmlDocument) -> Result<Vec<PlayerUnitProduction>> {
    let root = doc.root_element();
    let mut records = Vec::new();

    // Find all Player elements
    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let player_xml_id = player_node.req_attr("ID")?.parse::<i32>()?;

        // Find <UnitsProduced> child element
        if let Some(units_produced_node) = player_node
            .children()
            .find(|n| n.has_tag_name("UnitsProduced"))
        {
            // Iterate over all child elements (UNIT_SETTLER, UNIT_WORKER, etc.)
            for unit_node in units_produced_node.children().filter(|n| n.is_element()) {
                let unit_type = unit_node.tag_name().name().to_string();
                let count = unit_node
                    .text()
                    .ok_or_else(|| {
                        ParseError::MissingElement(format!("UnitsProduced/{} text", unit_type))
                    })?
                    .parse::<i32>()?;

                records.push(PlayerUnitProduction {
                    player_xml_id,
                    unit_type,
                    count,
                });
            }
        }
    }

    Ok(records)
}

/// Parse city-level unit production counts from <City>/<UnitProductionCounts>
///
/// Tracks which cities produced which units.
pub fn parse_city_units_produced(doc: &XmlDocument) -> Result<Vec<CityUnitProduction>> {
    let root = doc.root_element();
    let mut records = Vec::new();

    // Find all City elements
    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id = city_node.req_attr("ID")?.parse::<i32>()?;

        // Find <UnitProductionCounts> child element
        if let Some(unit_prod_node) = city_node
            .children()
            .find(|n| n.has_tag_name("UnitProductionCounts"))
        {
            // Iterate over all child elements (UNIT_SETTLER, UNIT_WORKER, etc.)
            for unit_node in unit_prod_node.children().filter(|n| n.is_element()) {
                let unit_type = unit_node.tag_name().name().to_string();
                let count = unit_node
                    .text()
                    .ok_or_else(|| {
                        ParseError::MissingElement(format!(
                            "UnitProductionCounts/{} text",
                            unit_type
                        ))
                    })?
                    .parse::<i32>()?;

                records.push(CityUnitProduction {
                    city_xml_id,
                    unit_type,
                    count,
                });
            }
        }
    }

    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_player_units_produced() {
        let xml = r#"<Root GameId="test-123">
            <Player ID="0" Name="Test">
                <UnitsProduced>
                    <UNIT_SETTLER>6</UNIT_SETTLER>
                    <UNIT_WORKER>7</UNIT_WORKER>
                    <UNIT_MILITIA>3</UNIT_MILITIA>
                </UnitsProduced>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let records = parse_player_units_produced(&doc).unwrap();

        assert_eq!(records.len(), 3);

        let settler = records.iter().find(|r| r.unit_type == "UNIT_SETTLER").unwrap();
        assert_eq!(settler.player_xml_id, 0);
        assert_eq!(settler.count, 6);
    }

    #[test]
    fn test_parse_city_units_produced() {
        let xml = r#"<Root GameId="test-123">
            <City ID="5" Player="0" TileID="100" Founded="1">
                <NameType>Akkad</NameType>
                <UnitProductionCounts>
                    <UNIT_SETTLER>4</UNIT_SETTLER>
                    <UNIT_WORKER>1</UNIT_WORKER>
                </UnitProductionCounts>
            </City>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let records = parse_city_units_produced(&doc).unwrap();

        assert_eq!(records.len(), 2);

        let settler = records.iter().find(|r| r.unit_type == "UNIT_SETTLER").unwrap();
        assert_eq!(settler.city_xml_id, 5);
        assert_eq!(settler.count, 4);
    }
}
