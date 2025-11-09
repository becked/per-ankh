// Family entity parser - pure parsing (no DB dependency)

use crate::parser::game_data::FamilyData;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;
use std::collections::{HashMap, HashSet};

/// Parse families to structs (no DB dependency)
///
/// Families are stored differently than other entities in the XML:
/// 1. Global FamilyClass element maps family names to their classes
/// 2. Each Player has FamilyHeadID, FamilySeatCityID, and FamilyTurnsNoLeader elements
///    that map family names to their current state
pub fn parse_families_struct(doc: &XmlDocument) -> Result<Vec<FamilyData>> {
    let root = doc.root_element();
    let mut families = Vec::new();

    // Step 1: Parse global FamilyClass to get all family names and their classes
    let family_classes = parse_family_classes(&root)?;

    // Step 2: Parse per-player family data
    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let player_xml_id: i32 = player_node.req_attr("ID")?.parse()?;

        // Parse FamilyHeadID
        let family_heads = if let Some(head_node) = player_node
            .children()
            .find(|n| n.has_tag_name("FamilyHeadID"))
        {
            parse_family_mapping(&head_node)
        } else {
            HashMap::new()
        };

        // Parse FamilySeatCityID
        let family_seats = if let Some(seat_node) = player_node
            .children()
            .find(|n| n.has_tag_name("FamilySeatCityID"))
        {
            parse_family_mapping(&seat_node)
        } else {
            HashMap::new()
        };

        // Parse FamilyTurnsNoLeader
        let family_turns_no_leader = if let Some(turns_node) = player_node
            .children()
            .find(|n| n.has_tag_name("FamilyTurnsNoLeader"))
        {
            parse_family_mapping(&turns_node)
        } else {
            HashMap::new()
        };

        // Step 3: Collect all families that belong to this player
        let mut player_families = HashSet::new();
        player_families.extend(family_heads.keys().cloned());
        player_families.extend(family_seats.keys().cloned());
        player_families.extend(family_turns_no_leader.keys().cloned());

        // Step 4: Create family records
        for family_name in player_families {
            // Get family class from global lookup (defaults to empty if not found)
            let family_class = family_classes
                .get(&family_name)
                .map(|s| s.as_str())
                .unwrap_or("")
                .to_string();

            // Get head character ID (if any)
            let head_character_xml_id = family_heads.get(&family_name).copied();

            // Get seat city ID (if any)
            let seat_city_xml_id = family_seats.get(&family_name).copied();

            // Get turns without leader
            let turns_without_leader = family_turns_no_leader.get(&family_name).copied().unwrap_or(0);

            families.push(FamilyData {
                family_name: family_name.clone(),
                family_class,
                player_xml_id,
                head_character_xml_id,
                seat_city_xml_id,
                turns_without_leader,
            });
        }
    }

    Ok(families)
}

/// Parse the global FamilyClass element to get all family names and their classes
fn parse_family_classes(root: &roxmltree::Node) -> Result<HashMap<String, String>> {
    let mut family_classes = HashMap::new();

    // Try direct children first (expected location)
    if let Some(class_node) = root.children().find(|n| n.has_tag_name("FamilyClass")) {
        for family_elem in class_node.children().filter(|n| n.is_element()) {
            let family_name = family_elem.tag_name().name().to_string();
            if let Some(class) = family_elem.text() {
                family_classes.insert(family_name, class.to_string());
            }
        }
        return Ok(family_classes);
    }

    // Search all descendants (in case element is nested)
    if let Some(class_node) = root.descendants().find(|n| n.has_tag_name("FamilyClass")) {
        for family_elem in class_node.children().filter(|n| n.is_element()) {
            let family_name = family_elem.tag_name().name().to_string();
            if let Some(class) = family_elem.text() {
                family_classes.insert(family_name, class.to_string());
            }
        }
    }

    Ok(family_classes)
}

/// Parse a family mapping element (FamilyHeadID, FamilySeatCityID, or FamilyTurnsNoLeader)
/// Returns a map of family_name -> ID
fn parse_family_mapping(parent_node: &roxmltree::Node) -> HashMap<String, i32> {
    let mut mapping = HashMap::new();

    for elem in parent_node.children().filter(|n| n.is_element()) {
        let family_name = elem.tag_name().name().to_string();
        if let Some(value_str) = elem.text() {
            if let Ok(value) = value_str.parse::<i32>() {
                mapping.insert(family_name, value);
            }
        }
    }

    mapping
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_families_struct() {
        let xml = r#"<Root GameId="test-123">
            <FamilyClass>
                <FAMILY_FABIUS>FAMILYCLASS_CHAMPIONS</FAMILY_FABIUS>
                <FAMILY_VALERIUS>FAMILYCLASS_LANDOWNERS</FAMILY_VALERIUS>
            </FamilyClass>
            <Player ID="0" Name="Test Player">
                <FamilyHeadID>
                    <FAMILY_FABIUS>68</FAMILY_FABIUS>
                    <FAMILY_VALERIUS>95</FAMILY_VALERIUS>
                </FamilyHeadID>
                <FamilySeatCityID>
                    <FAMILY_FABIUS>2</FAMILY_FABIUS>
                    <FAMILY_VALERIUS>4</FAMILY_VALERIUS>
                </FamilySeatCityID>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let families = parse_families_struct(&doc).unwrap();

        assert_eq!(families.len(), 2);

        let fabius = families.iter().find(|f| f.family_name == "FAMILY_FABIUS").unwrap();
        assert_eq!(fabius.family_class, "FAMILYCLASS_CHAMPIONS");
        assert_eq!(fabius.player_xml_id, 0);
        assert_eq!(fabius.head_character_xml_id, Some(68));
        assert_eq!(fabius.seat_city_xml_id, Some(2));
    }
}
