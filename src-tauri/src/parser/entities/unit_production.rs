// Unit production aggregate data parsers
//
// Note: Individual units do NOT exist in Old World save files.
// Only aggregate production counts are stored.

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;
use duckdb::{params, Connection};

/// Parse player-level unit production counts from <Player>/<UnitsProduced>
///
/// Tracks total count of each unit type produced by each player throughout the game.
pub fn parse_player_units_produced(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &IdMapper,
) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

    // Find all Player elements
    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let player_xml_id = player_node.req_attr("ID")?.parse::<i32>()?;
        let player_db_id = id_mapper.get_player(player_xml_id)?;

        // Find <UnitsProduced> child element
        if let Some(units_produced_node) = player_node
            .children()
            .find(|n| n.has_tag_name("UnitsProduced"))
        {
            // Iterate over all child elements (UNIT_SETTLER, UNIT_WORKER, etc.)
            for unit_node in units_produced_node.children().filter(|n| n.is_element()) {
                let unit_type = unit_node.tag_name().name(); // e.g., "UNIT_SETTLER"
                let unit_count = unit_node
                    .text()
                    .ok_or_else(|| {
                        crate::parser::ParseError::MissingElement(format!(
                            "UnitsProduced/{} text",
                            unit_type
                        ))
                    })?
                    .parse::<i32>()?;

                // Insert into player_units_produced
                conn.execute(
                    "INSERT INTO player_units_produced (player_id, match_id, unit_type, count)
                     VALUES (?, ?, ?, ?)",
                    params![player_db_id, id_mapper.match_id, unit_type, unit_count],
                )?;

                count += 1;
            }
        }
    }

    log::debug!("Parsed {} player unit production records", count);
    Ok(count)
}

/// Parse city-level unit production counts from <City>/<UnitProductionCounts>
///
/// Tracks which cities produced which units. Useful for analyzing military factories
/// vs. expansion cities.
pub fn parse_city_units_produced(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &IdMapper,
) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

    // Find all City elements
    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_xml_id = city_node.req_attr("ID")?.parse::<i32>()?;
        let city_db_id = id_mapper.get_city(city_xml_id)?;

        // Find <UnitProductionCounts> child element
        if let Some(unit_prod_node) = city_node
            .children()
            .find(|n| n.has_tag_name("UnitProductionCounts"))
        {
            // Iterate over all child elements (UNIT_SETTLER, UNIT_WORKER, etc.)
            for unit_node in unit_prod_node.children().filter(|n| n.is_element()) {
                let unit_type = unit_node.tag_name().name(); // e.g., "UNIT_SETTLER"
                let unit_count = unit_node
                    .text()
                    .ok_or_else(|| {
                        crate::parser::ParseError::MissingElement(format!(
                            "UnitProductionCounts/{} text",
                            unit_type
                        ))
                    })?
                    .parse::<i32>()?;

                // Insert into city_units_produced
                conn.execute(
                    "INSERT INTO city_units_produced (city_id, match_id, unit_type, count)
                     VALUES (?, ?, ?, ?)",
                    params![city_db_id, id_mapper.match_id, unit_type, unit_count],
                )?;

                count += 1;
            }
        }
    }

    log::debug!("Parsed {} city unit production records", count);
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_units_produced_structure() {
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
        let root = doc.root_element();
        let player_node = root.children().find(|n| n.has_tag_name("Player")).unwrap();
        let units_produced = player_node
            .children()
            .find(|n| n.has_tag_name("UnitsProduced"))
            .unwrap();

        let unit_types: Vec<String> = units_produced
            .children()
            .filter(|n| n.is_element())
            .map(|n| n.tag_name().name().to_string())
            .collect();

        assert_eq!(unit_types.len(), 3);
        assert!(unit_types.contains(&"UNIT_SETTLER".to_string()));
        assert!(unit_types.contains(&"UNIT_WORKER".to_string()));
    }

    #[test]
    fn test_parse_city_units_structure() {
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
        let root = doc.root_element();
        let city_node = root.children().find(|n| n.has_tag_name("City")).unwrap();
        let unit_prod = city_node
            .children()
            .find(|n| n.has_tag_name("UnitProductionCounts"))
            .unwrap();

        let unit_count: usize = unit_prod.children().filter(|n| n.is_element()).count();
        assert_eq!(unit_count, 2);
    }
}
