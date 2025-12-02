// Parse characters from XML to typed structs (no database dependency)

use crate::parser::game_data::CharacterData;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;

/// Parse all characters from XML document into typed structs
///
/// This function is pure - it only reads XML and returns data structures.
/// No database interaction, no ID mapping. This enables:
/// - Testing without DB setup
/// - Parallel execution (no shared mutable state)
/// - Caching intermediate results
///
/// Note: Parent relationships (birth_father_xml_id, birth_mother_id) will be
/// populated separately after all characters are parsed (Pass 2 logic).
pub fn parse_characters_struct(doc: &XmlDocument) -> Result<Vec<CharacterData>> {
    let root = doc.root_element();
    let mut characters = Vec::new();

    // Find all Character elements as direct children of Root
    for char_node in root.children().filter(|n| n.has_tag_name("Character")) {
        let xml_id = char_node.req_attr("ID")?.parse::<i32>()?;

        // Identity - stored as ATTRIBUTES on Character element
        let first_name = char_node.opt_attr("FirstName").map(|s| s.to_string());
        let gender = char_node.opt_attr("Gender").map(|s| s.to_string());

        // Player affiliation (optional - tribal characters have Player="-1")
        let player_xml_id = char_node
            .opt_attr("Player")
            .and_then(|s| s.parse::<i32>().ok())
            .filter(|&id| id >= 0); // Filter out -1 (tribal characters)

        let tribe = char_node.opt_child_text("Tribe").map(|s| s.to_string());

        // Birth and death - BirthTurn is an attribute, DeathTurn is a child element
        let birth_turn = char_node.req_attr("BirthTurn")?.parse::<i32>()?;
        let death_turn = char_node
            .opt_child_text("DeathTurn")
            .and_then(|s| s.parse::<i32>().ok());
        let death_reason = char_node.opt_child_text("DeathReason").map(|s| s.to_string());

        // Parent relationships - parsed inline, used during insertion
        let birth_father_xml_id: Option<i32> = char_node
            .children()
            .find(|n| n.has_tag_name("BirthFatherID"))
            .and_then(|n| n.text())
            .and_then(|s| s.parse().ok());

        let birth_mother_xml_id: Option<i32> = char_node
            .children()
            .find(|n| n.has_tag_name("BirthMotherID"))
            .and_then(|n| n.text())
            .and_then(|s| s.parse().ok());

        // Birth city - parsed inline, updated after cities are inserted
        let birth_city_xml_id: Option<i32> = char_node
            .children()
            .find(|n| n.has_tag_name("BirthCityID"))
            .and_then(|n| n.text())
            .and_then(|s| s.parse().ok());

        // Affiliations
        let family = char_node.opt_child_text("Family").map(|s| s.to_string());
        let nation = char_node.opt_child_text("Nation").map(|s| s.to_string());
        let religion = char_node.opt_child_text("Religion").map(|s| s.to_string());

        // Titles and roles
        let cognomen = char_node.opt_child_text("Cognomen").map(|s| s.to_string());
        let archetype = char_node.opt_child_text("Archetype").map(|s| s.to_string());
        let portrait = char_node.opt_child_text("Portrait").map(|s| s.to_string());

        // Progression
        let xp = char_node
            .opt_child_text("XP")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);
        let level = char_node
            .opt_child_text("Level")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(1);

        // Status flags
        let is_royal = char_node
            .opt_child_text("IsRoyal")
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);
        let is_infertile = char_node
            .opt_child_text("IsInfertile")
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);

        // Leadership
        let became_leader_turn = char_node
            .opt_child_text("BecameLeaderTurn")
            .and_then(|s| s.parse::<i32>().ok());

        // Optional fields not currently parsed
        let abdicated_turn = None;
        let was_religion_head = false;
        let was_family_head = false;
        let nation_joined_turn = None;
        let seed = None;

        characters.push(CharacterData {
            xml_id,
            first_name,
            gender,
            player_xml_id,
            tribe,
            family,
            nation,
            religion,
            birth_turn,
            death_turn,
            death_reason,
            birth_father_xml_id,
            birth_mother_xml_id,
            birth_city_xml_id,
            cognomen,
            archetype,
            portrait,
            xp,
            level,
            is_royal,
            is_infertile,
            became_leader_turn,
            abdicated_turn,
            was_religion_head,
            was_family_head,
            nation_joined_turn,
            seed,
        });
    }

    log::debug!("Parsed {} character structs", characters.len());
    Ok(characters)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_characters_struct_basic() {
        let xml = r#"<Root GameId="test-123">
            <Character ID="5" FirstName="Hantili" Gender="GENDER_MALE" BirthTurn="10">
                <XP>150</XP>
                <Level>3</Level>
            </Character>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let characters = parse_characters_struct(&doc).unwrap();

        // No DB needed! Direct verification
        assert_eq!(characters.len(), 1);
        assert_eq!(characters[0].xml_id, 5);
        assert_eq!(characters[0].first_name, Some("Hantili".to_string()));
        assert_eq!(characters[0].gender, Some("GENDER_MALE".to_string()));
        assert_eq!(characters[0].birth_turn, 10);
        assert_eq!(characters[0].xp, 150);
        assert_eq!(characters[0].level, 3);
    }

    #[test]
    fn test_parse_characters_struct_with_affiliations() {
        let xml = r#"<Root GameId="test-123">
            <Character ID="1" FirstName="Caesar" Gender="GENDER_MALE" BirthTurn="1" Player="0">
                <Family>FAMILY_JULIAN</Family>
                <Nation>NATION_ROME</Nation>
                <Religion>RELIGION_JUPITER</Religion>
            </Character>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let characters = parse_characters_struct(&doc).unwrap();

        assert_eq!(characters.len(), 1);
        assert_eq!(characters[0].player_xml_id, Some(0));
        assert_eq!(characters[0].family, Some("FAMILY_JULIAN".to_string()));
        assert_eq!(characters[0].nation, Some("NATION_ROME".to_string()));
        assert_eq!(characters[0].religion, Some("RELIGION_JUPITER".to_string()));
    }

    #[test]
    fn test_parse_characters_struct_tribal() {
        let xml = r#"<Root GameId="test-123">
            <Character ID="100" FirstName="Barbarian" Gender="GENDER_MALE" BirthTurn="5" Player="-1">
                <Tribe>TRIBE_GOTHS</Tribe>
            </Character>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let characters = parse_characters_struct(&doc).unwrap();

        assert_eq!(characters.len(), 1);
        assert_eq!(characters[0].player_xml_id, None); // -1 filtered out
        assert_eq!(characters[0].tribe, Some("TRIBE_GOTHS".to_string()));
    }
}
