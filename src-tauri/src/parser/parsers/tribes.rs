// Tribe entity parser - pure parsing (no DB dependency)

use crate::parser::game_data::TribeData;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;

/// Parse tribes to structs (no DB dependency)
pub fn parse_tribes_struct(doc: &XmlDocument) -> Result<Vec<TribeData>> {
    let root = doc.root_element();
    let mut tribes = Vec::new();

    // Find all Tribe elements as direct children of Root
    for tribe_node in root.children().filter(|n| n.has_tag_name("Tribe")) {
        // Tribes use string IDs like "TRIBE_REBELS", not numeric IDs
        let tribe_id = tribe_node.req_attr("ID")?.to_string();

        // Optional fields - tribal leaders might not exist in character list yet
        let leader_character_xml_id = tribe_node
            .opt_child_text("LeaderID")
            .and_then(|s| s.parse::<i32>().ok());

        let allied_player_xml_id = tribe_node
            .opt_child_text("AlliedPlayer")
            .and_then(|s| s.parse::<i32>().ok())
            .filter(|&id| id >= 0); // Filter out -1 for non-allied tribes

        let religion = tribe_node.opt_child_text("Religion").map(|s| s.to_string());

        tribes.push(TribeData {
            tribe_id,
            leader_character_xml_id,
            allied_player_xml_id,
            religion,
        });
    }

    Ok(tribes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_tribes_struct() {
        let xml = r#"<Root GameId="test-123">
            <Tribe ID="TRIBE_REBELS">
                <LeaderID>50</LeaderID>
                <AlliedPlayer>0</AlliedPlayer>
                <Religion>RELIGION_PAGANISM</Religion>
            </Tribe>
            <Tribe ID="TRIBE_BARBARIAN">
                <AlliedPlayer>-1</AlliedPlayer>
            </Tribe>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let tribes = parse_tribes_struct(&doc).unwrap();

        assert_eq!(tribes.len(), 2);

        let rebels = tribes.iter().find(|t| t.tribe_id == "TRIBE_REBELS").unwrap();
        assert_eq!(rebels.leader_character_xml_id, Some(50));
        assert_eq!(rebels.allied_player_xml_id, Some(0));
        assert_eq!(rebels.religion, Some("RELIGION_PAGANISM".to_string()));

        let barbarian = tribes
            .iter()
            .find(|t| t.tribe_id == "TRIBE_BARBARIAN")
            .unwrap();
        assert_eq!(barbarian.allied_player_xml_id, None); // -1 filtered out
    }
}
