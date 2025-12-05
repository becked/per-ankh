// Diplomacy parser - converts TribeDiplomacy and TeamDiplomacy to DiplomacyRelation structs

use crate::parser::game_data::DiplomacyRelation;
use crate::parser::xml_loader::XmlDocument;
use crate::parser::{ParseError, Result};

/// Parse all diplomacy relations from TribeDiplomacy and TeamDiplomacy elements
///
/// Diplomacy is nested within the Game element and contains two types:
/// - TribeDiplomacy: relations between tribes and players
/// - TeamDiplomacy: relations between player teams
pub fn parse_diplomacy_relations(doc: &XmlDocument) -> Result<Vec<DiplomacyRelation>> {
    let root = doc.root_element();
    let mut relations = Vec::new();

    // Find Game element (diplomacy is nested within it)
    if let Some(game_node) = root.children().find(|n| n.has_tag_name("Game")) {
        // Parse TribeDiplomacy
        if let Some(tribe_diplomacy_node) = game_node
            .children()
            .find(|n| n.has_tag_name("TribeDiplomacy"))
        {
            relations.extend(parse_tribe_diplomacy(&tribe_diplomacy_node)?);
        }

        // Parse TeamDiplomacy
        if let Some(team_diplomacy_node) = game_node
            .children()
            .find(|n| n.has_tag_name("TeamDiplomacy"))
        {
            relations.extend(parse_team_diplomacy(&team_diplomacy_node)?);
        }
    }

    Ok(relations)
}

/// Parse TribeDiplomacy entries
///
/// Format: TRIBE_NAME.PLAYER_ID → DIPLOMACY_STATE
/// Example: <TRIBE_REBELS.0>DIPLOMACY_WAR</TRIBE_REBELS.0>
fn parse_tribe_diplomacy(tribe_diplomacy_node: &roxmltree::Node) -> Result<Vec<DiplomacyRelation>> {
    let mut relations = Vec::new();

    for entry_node in tribe_diplomacy_node.children().filter(|n| n.is_element()) {
        let key = entry_node.tag_name().name(); // e.g., "TRIBE_REBELS.0"
        let relation = entry_node
            .text()
            .ok_or_else(|| {
                ParseError::MissingElement(format!("TribeDiplomacy.{} text content", key))
            })?
            .to_string();

        // Parse key: "TRIBE_REBELS.0" → tribe="TRIBE_REBELS", player_id="0"
        let parts: Vec<&str> = key.rsplitn(2, '.').collect();
        if parts.len() != 2 {
            log::warn!("Invalid TribeDiplomacy key format: {}", key);
            continue;
        }

        let player_id = parts[0].to_string(); // "0"
        let tribe_name = parts[1].to_string(); // "TRIBE_REBELS"

        relations.push(DiplomacyRelation {
            entity1_type: "tribe".to_string(),
            entity1_id: tribe_name,
            entity2_type: "player".to_string(),
            entity2_id: player_id,
            relation,
            war_score: None,
            last_conflict_turn: None,
            last_diplomacy_turn: None,
            diplomacy_blocked_until_turn: None,
        });
    }

    Ok(relations)
}

/// Parse TeamDiplomacy entries
///
/// Format: T.TEAM1.TEAM2 → DIPLOMACY_STATE
/// Example: <T.0.1>DIPLOMACY_WAR</T.0.1>
fn parse_team_diplomacy(team_diplomacy_node: &roxmltree::Node) -> Result<Vec<DiplomacyRelation>> {
    let mut relations = Vec::new();

    for entry_node in team_diplomacy_node.children().filter(|n| n.is_element()) {
        let key = entry_node.tag_name().name(); // e.g., "T.0.1"
        let relation = entry_node
            .text()
            .ok_or_else(|| {
                ParseError::MissingElement(format!("TeamDiplomacy.{} text content", key))
            })?
            .to_string();

        // Parse key: "T.0.1" → team1="0", team2="1"
        let parts: Vec<&str> = key.split('.').collect();
        if parts.len() != 3 || parts[0] != "T" {
            log::warn!("Invalid TeamDiplomacy key format: {}", key);
            continue;
        }

        let team1 = parts[1].to_string();
        let team2 = parts[2].to_string();

        relations.push(DiplomacyRelation {
            entity1_type: "player".to_string(),
            entity1_id: team1,
            entity2_type: "player".to_string(),
            entity2_id: team2,
            relation,
            war_score: None,
            last_conflict_turn: None,
            last_diplomacy_turn: None,
            diplomacy_blocked_until_turn: None,
        });
    }

    Ok(relations)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_tribe_diplomacy_basic() {
        let xml = r#"<Root GameId="test">
            <Game>
                <TribeDiplomacy>
                    <TRIBE_REBELS.0>DIPLOMACY_WAR</TRIBE_REBELS.0>
                </TribeDiplomacy>
            </Game>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let relations = parse_diplomacy_relations(&doc).unwrap();

        assert_eq!(relations.len(), 1);
        assert_eq!(relations[0].entity1_type, "tribe");
        assert_eq!(relations[0].entity1_id, "TRIBE_REBELS");
        assert_eq!(relations[0].entity2_type, "player");
        assert_eq!(relations[0].entity2_id, "0");
        assert_eq!(relations[0].relation, "DIPLOMACY_WAR");
    }

    #[test]
    fn test_parse_team_diplomacy_basic() {
        let xml = r#"<Root GameId="test">
            <Game>
                <TeamDiplomacy>
                    <T.0.1>DIPLOMACY_WAR</T.0.1>
                </TeamDiplomacy>
            </Game>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let relations = parse_diplomacy_relations(&doc).unwrap();

        assert_eq!(relations.len(), 1);
        assert_eq!(relations[0].entity1_type, "player");
        assert_eq!(relations[0].entity1_id, "0");
        assert_eq!(relations[0].entity2_type, "player");
        assert_eq!(relations[0].entity2_id, "1");
        assert_eq!(relations[0].relation, "DIPLOMACY_WAR");
    }

    #[test]
    fn test_parse_diplomacy_combined() {
        let xml = r#"<Root GameId="test">
            <Game>
                <TribeDiplomacy>
                    <TRIBE_REBELS.0>DIPLOMACY_WAR</TRIBE_REBELS.0>
                    <TRIBE_GAULS.1>DIPLOMACY_TRUCE</TRIBE_GAULS.1>
                </TribeDiplomacy>
                <TeamDiplomacy>
                    <T.0.0>DIPLOMACY_TEAM</T.0.0>
                    <T.0.1>DIPLOMACY_WAR</T.0.1>
                </TeamDiplomacy>
            </Game>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let relations = parse_diplomacy_relations(&doc).unwrap();

        assert_eq!(relations.len(), 4);

        // Verify tribe relations
        assert_eq!(relations[0].entity1_type, "tribe");
        assert_eq!(relations[1].entity1_type, "tribe");

        // Verify team relations
        assert_eq!(relations[2].entity1_type, "player");
        assert_eq!(relations[3].entity1_type, "player");
    }

    #[test]
    fn test_parse_diplomacy_empty() {
        let xml = r#"<Root GameId="test">
            <Game>
            </Game>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let relations = parse_diplomacy_relations(&doc).unwrap();

        assert_eq!(relations.len(), 0);
    }

    #[test]
    fn test_parse_tribe_diplomacy_key_parsing() {
        let key = "TRIBE_REBELS.0";
        let parts: Vec<&str> = key.rsplitn(2, '.').collect();

        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], "0");
        assert_eq!(parts[1], "TRIBE_REBELS");
    }

    #[test]
    fn test_parse_team_diplomacy_key_parsing() {
        let key = "T.0.1";
        let parts: Vec<&str> = key.split('.').collect();

        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "T");
        assert_eq!(parts[1], "0");
        assert_eq!(parts[2], "1");
    }
}
