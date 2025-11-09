// Character extended data parser (hybrid architecture)
//
// Parses character-specific nested data to structs (no DB dependency):
// - Stats (Rating, Stat) -> CharacterStat
// - Traits (TraitTurn) -> CharacterTrait
// - Relationships (RelationshipList) -> CharacterRelationship
// - Marriages (Spouses) -> CharacterMarriage

use crate::parser::game_data::{
    CharacterMarriage, CharacterRelationship, CharacterStat, CharacterTrait,
};
use crate::parser::xml_loader::XmlNodeExt;
use crate::parser::{ParseError, Result};
use roxmltree::Node;

/// Parse character stats from Rating and Stat elements
///
/// Combines both Rating (character attributes like wisdom, courage) and
/// Stat (achievements like kills, cities founded) into CharacterStat structs.
pub fn parse_character_stats_struct(character_node: &Node) -> Result<Vec<CharacterStat>> {
    let character_xml_id: i32 = character_node.req_attr("ID")?.parse()?;
    let mut stats = Vec::new();

    // Parse Rating elements (RATING_WISDOM, RATING_CHARISMA, etc.)
    if let Some(rating_node) = character_node
        .children()
        .find(|n| n.has_tag_name("Rating"))
    {
        for stat_node in rating_node.children().filter(|n| n.is_element()) {
            let stat_name = stat_node.tag_name().name();
            let stat_value: i32 = stat_node
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!("Rating.{} value", stat_name))
                })?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat(format!("Invalid stat value in {}", stat_name))
                })?;

            stats.push(CharacterStat {
                character_xml_id,
                stat_name: stat_name.to_string(),
                stat_value,
            });
        }
    }

    // Parse Stat elements (STAT_KILLS, STAT_CITY_FOUNDED, etc.)
    if let Some(stat_node) = character_node.children().find(|n| n.has_tag_name("Stat")) {
        for stat_elem in stat_node.children().filter(|n| n.is_element()) {
            let stat_name = stat_elem.tag_name().name();
            let stat_value: i32 = stat_elem
                .text()
                .ok_or_else(|| ParseError::MissingElement(format!("Stat.{} value", stat_name)))?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat(format!("Invalid stat value in {}", stat_name))
                })?;

            stats.push(CharacterStat {
                character_xml_id,
                stat_name: stat_name.to_string(),
                stat_value,
            });
        }
    }

    Ok(stats)
}

/// Parse character traits from TraitTurn element
///
/// Traits are acquired (and sometimes removed) at specific turns.
/// Currently only stores acquired_turn; removed_turn would require historical tracking.
pub fn parse_character_traits_struct(character_node: &Node) -> Result<Vec<CharacterTrait>> {
    let character_xml_id: i32 = character_node.req_attr("ID")?.parse()?;

    if let Some(trait_node) = character_node
        .children()
        .find(|n| n.has_tag_name("TraitTurn"))
    {
        let mut traits = Vec::new();

        for trait_elem in trait_node.children().filter(|n| n.is_element()) {
            let trait_name = trait_elem.tag_name().name();
            let acquired_turn: i32 = trait_elem
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!("TraitTurn.{} value", trait_name))
                })?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat(format!("Invalid turn in {}", trait_name))
                })?;

            traits.push(CharacterTrait {
                character_xml_id,
                trait_name: trait_name.to_string(),
                acquired_turn,
                removed_turn: None,
            });
        }

        Ok(traits)
    } else {
        Ok(Vec::new())
    }
}

/// Parse character relationships from RelationshipList element
///
/// Tracks relationships like LOVES, PLOTTING_AGAINST, etc.
/// Each relationship has a type, target character (XML ID), and optional metadata.
pub fn parse_character_relationships_struct(
    character_node: &Node,
) -> Result<Vec<CharacterRelationship>> {
    let character_xml_id: i32 = character_node.req_attr("ID")?.parse()?;

    if let Some(rel_list_node) = character_node
        .children()
        .find(|n| n.has_tag_name("RelationshipList"))
    {
        let mut relationships = Vec::new();

        for rel_data_node in rel_list_node
            .children()
            .filter(|n| n.has_tag_name("RelationshipData"))
        {
            // Parse relationship type
            let rel_type = rel_data_node
                .children()
                .find(|n| n.has_tag_name("Type"))
                .and_then(|n| n.text())
                .ok_or_else(|| {
                    ParseError::MissingElement("RelationshipData.Type".to_string())
                })?;

            // Parse related character ID (optional - skip relationships without target)
            let related_character_xml_id = match rel_data_node
                .children()
                .find(|n| n.has_tag_name("CharacterID"))
                .and_then(|n| n.text())
            {
                Some(xml_id_str) => {
                    let xml_id: i32 = xml_id_str.parse().map_err(|_| {
                        ParseError::InvalidFormat(format!(
                            "Invalid character ID in relationship: {}",
                            xml_id_str
                        ))
                    })?;
                    xml_id
                }
                None => {
                    // Skip relationships without target ID (likely self-relationships or special cases)
                    continue;
                }
            };

            // Parse started turn (optional)
            let started_turn: Option<i32> = rel_data_node
                .children()
                .find(|n| n.has_tag_name("Turn"))
                .and_then(|n| n.text())
                .and_then(|s| s.parse().ok());

            // Parse relationship value (optional, for intensity/strength)
            let relationship_value: Option<i32> = rel_data_node
                .children()
                .find(|n| n.has_tag_name("Value"))
                .and_then(|n| n.text())
                .and_then(|s| s.parse().ok());

            relationships.push(CharacterRelationship {
                character_xml_id,
                related_character_xml_id,
                relationship_type: rel_type.to_string(),
                relationship_value,
                started_turn,
                ended_turn: None,
            });
        }

        Ok(relationships)
    } else {
        Ok(Vec::new())
    }
}

/// Parse character marriages from Spouses element
///
/// Each marriage is stored with the spouse's XML ID.
/// Note: In the DB layer, marriages are stored symmetrically (both perspectives).
pub fn parse_character_marriages_struct(character_node: &Node) -> Result<Vec<CharacterMarriage>> {
    let character_xml_id: i32 = character_node.req_attr("ID")?.parse()?;

    // Find Spouses element
    let spouses_node = match character_node.children().find(|n| n.has_tag_name("Spouses")) {
        Some(node) => node,
        None => return Ok(Vec::new()), // No spouses for this character
    };

    let mut marriages = Vec::new();

    // Iterate over ID elements (each is a spouse)
    for id_node in spouses_node.children().filter(|n| n.has_tag_name("ID")) {
        let spouse_xml_id_str = id_node
            .text()
            .ok_or_else(|| ParseError::MissingElement("Spouses.ID text".to_string()))?;

        let spouse_xml_id: i32 = spouse_xml_id_str.parse().map_err(|_| {
            ParseError::InvalidFormat(format!("Invalid spouse ID: {}", spouse_xml_id_str))
        })?;

        // Note: marriage_turn uses -1 as sentinel for unknown, divorced_turn is None
        marriages.push(CharacterMarriage {
            character_xml_id,
            spouse_xml_id,
            married_turn: -1,
            divorced_turn: None,
        });
    }

    Ok(marriages)
}

/// Parse all character extended data for all characters
///
/// This is the main entry point for parsing character data in the hybrid architecture.
pub fn parse_all_character_data_struct(
    doc: &roxmltree::Document,
) -> Result<(
    Vec<CharacterStat>,
    Vec<CharacterTrait>,
    Vec<CharacterRelationship>,
    Vec<CharacterMarriage>,
)> {
    let root = doc.root_element();
    let mut all_stats = Vec::new();
    let mut all_traits = Vec::new();
    let mut all_relationships = Vec::new();
    let mut all_marriages = Vec::new();

    for character_node in root.children().filter(|n| n.has_tag_name("Character")) {
        all_stats.extend(parse_character_stats_struct(&character_node)?);
        all_traits.extend(parse_character_traits_struct(&character_node)?);
        all_relationships.extend(parse_character_relationships_struct(&character_node)?);
        all_marriages.extend(parse_character_marriages_struct(&character_node)?);
    }

    Ok((all_stats, all_traits, all_relationships, all_marriages))
}

#[cfg(test)]
mod tests {
    use super::*;
    use roxmltree::Document;

    #[test]
    fn test_parse_character_stats_struct() {
        let xml = r#"
            <Character ID="5">
                <Rating>
                    <RATING_WISDOM>3</RATING_WISDOM>
                    <RATING_CHARISMA>2</RATING_CHARISMA>
                </Rating>
                <Stat>
                    <STAT_KILLS>5</STAT_KILLS>
                </Stat>
            </Character>
        "#;

        let doc = Document::parse(xml).unwrap();
        let char_node = doc.root_element();

        let stats = parse_character_stats_struct(&char_node).unwrap();

        assert_eq!(stats.len(), 3);
        assert_eq!(stats[0].character_xml_id, 5);
        assert_eq!(stats[0].stat_name, "RATING_WISDOM");
        assert_eq!(stats[0].stat_value, 3);
        assert_eq!(stats[1].stat_name, "RATING_CHARISMA");
        assert_eq!(stats[1].stat_value, 2);
        assert_eq!(stats[2].stat_name, "STAT_KILLS");
        assert_eq!(stats[2].stat_value, 5);
    }

    #[test]
    fn test_parse_character_traits_struct() {
        let xml = r#"
            <Character ID="5">
                <TraitTurn>
                    <TRAIT_BUILDER_ARCHETYPE>1</TRAIT_BUILDER_ARCHETYPE>
                    <TRAIT_AMBITIOUS>5</TRAIT_AMBITIOUS>
                </TraitTurn>
            </Character>
        "#;

        let doc = Document::parse(xml).unwrap();
        let char_node = doc.root_element();

        let traits = parse_character_traits_struct(&char_node).unwrap();

        assert_eq!(traits.len(), 2);
        assert_eq!(traits[0].character_xml_id, 5);
        assert_eq!(traits[0].trait_name, "TRAIT_BUILDER_ARCHETYPE");
        assert_eq!(traits[0].acquired_turn, 1);
        assert_eq!(traits[0].removed_turn, None);
        assert_eq!(traits[1].trait_name, "TRAIT_AMBITIOUS");
        assert_eq!(traits[1].acquired_turn, 5);
    }

    #[test]
    fn test_parse_character_traits_struct_no_traits() {
        let xml = r#"<Character ID="5"></Character>"#;

        let doc = Document::parse(xml).unwrap();
        let char_node = doc.root_element();

        let traits = parse_character_traits_struct(&char_node).unwrap();
        assert_eq!(traits.len(), 0);
    }

    #[test]
    fn test_parse_character_relationships_struct() {
        let xml = r#"
            <Character ID="5">
                <RelationshipList>
                    <RelationshipData>
                        <Type>RELATIONSHIP_PLOTTING_AGAINST</Type>
                        <CharacterID>10</CharacterID>
                        <Turn>15</Turn>
                        <Value>50</Value>
                    </RelationshipData>
                    <RelationshipData>
                        <Type>RELATIONSHIP_LOVES</Type>
                        <CharacterID>12</CharacterID>
                    </RelationshipData>
                </RelationshipList>
            </Character>
        "#;

        let doc = Document::parse(xml).unwrap();
        let char_node = doc.root_element();

        let relationships = parse_character_relationships_struct(&char_node).unwrap();

        assert_eq!(relationships.len(), 2);
        assert_eq!(relationships[0].character_xml_id, 5);
        assert_eq!(relationships[0].related_character_xml_id, 10);
        assert_eq!(
            relationships[0].relationship_type,
            "RELATIONSHIP_PLOTTING_AGAINST"
        );
        assert_eq!(relationships[0].relationship_value, Some(50));
        assert_eq!(relationships[0].started_turn, Some(15));
        assert_eq!(relationships[1].related_character_xml_id, 12);
        assert_eq!(relationships[1].relationship_type, "RELATIONSHIP_LOVES");
    }

    #[test]
    fn test_parse_character_marriages_struct() {
        let xml = r#"
            <Character ID="4">
                <Spouses>
                    <ID>19</ID>
                    <ID>25</ID>
                </Spouses>
            </Character>
        "#;

        let doc = Document::parse(xml).unwrap();
        let char_node = doc.root_element();

        let marriages = parse_character_marriages_struct(&char_node).unwrap();

        assert_eq!(marriages.len(), 2);
        assert_eq!(marriages[0].character_xml_id, 4);
        assert_eq!(marriages[0].spouse_xml_id, 19);
        assert_eq!(marriages[0].married_turn, -1);
        assert_eq!(marriages[0].divorced_turn, None);
        assert_eq!(marriages[1].spouse_xml_id, 25);
    }

    #[test]
    fn test_parse_character_marriages_struct_no_spouses() {
        let xml = r#"<Character ID="4"></Character>"#;

        let doc = Document::parse(xml).unwrap();
        let char_node = doc.root_element();

        let marriages = parse_character_marriages_struct(&char_node).unwrap();
        assert_eq!(marriages.len(), 0);
    }
}
