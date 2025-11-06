// Diplomacy parser
//
// Parses diplomatic relations between players and tribes
// from TribeDiplomacy and TeamDiplomacy elements

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};

/// Parse TribeDiplomacy and TeamDiplomacy to diplomacy table
///
/// Example XML:
/// ```xml
/// <TribeDiplomacy>
///   <TRIBE_REBELS.0>DIPLOMACY_WAR</TRIBE_REBELS.0>
///   <TRIBE_GAULS.1>DIPLOMACY_TRUCE</TRIBE_GAULS.1>
/// </TribeDiplomacy>
/// <TeamDiplomacy>
///   <T.0.0>DIPLOMACY_TEAM</T.0.0>
///   <T.0.1>DIPLOMACY_WAR</T.0.1>
/// </TeamDiplomacy>
/// ```
pub fn parse_diplomacy(
    doc: &XmlDocument,
    conn: &Connection,
    _id_mapper: &IdMapper,
    match_id: i64,
) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

    // Find Game element (diplomacy is nested within it)
    if let Some(game_node) = root.children().find(|n| n.has_tag_name("Game")) {
        // Parse TribeDiplomacy
        if let Some(tribe_diplomacy_node) = game_node
            .children()
            .find(|n| n.has_tag_name("TribeDiplomacy"))
        {
            count += parse_tribe_diplomacy(&tribe_diplomacy_node, conn, match_id)?;
        }

        // Parse TeamDiplomacy
        if let Some(team_diplomacy_node) = game_node
            .children()
            .find(|n| n.has_tag_name("TeamDiplomacy"))
        {
            count += parse_team_diplomacy(&team_diplomacy_node, conn, match_id)?;
        }
    }

    Ok(count)
}

/// Parse TribeDiplomacy entries
///
/// Format: TRIBE_NAME.PLAYER_ID → DIPLOMACY_STATE
fn parse_tribe_diplomacy(
    tribe_diplomacy_node: &roxmltree::Node,
    conn: &Connection,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    for entry_node in tribe_diplomacy_node.children().filter(|n| n.is_element()) {
        let key = entry_node.tag_name().name(); // e.g., "TRIBE_REBELS.0"
        let relation = entry_node
            .text()
            .ok_or_else(|| {
                ParseError::MissingElement(format!("TribeDiplomacy.{} text content", key))
            })?;

        // Parse key: "TRIBE_REBELS.0" → tribe="TRIBE_REBELS", player_id="0"
        let parts: Vec<&str> = key.rsplitn(2, '.').collect();
        if parts.len() != 2 {
            log::warn!("Invalid TribeDiplomacy key format: {}", key);
            continue;
        }

        let player_id = parts[0]; // "0"
        let tribe_name = parts[1]; // "TRIBE_REBELS"

        // Insert into diplomacy table
        // entity1 = tribe, entity2 = player
        conn.execute(
            "INSERT INTO diplomacy (
                match_id, entity1_type, entity1_id, entity2_type, entity2_id,
                relation, war_score, last_conflict_turn, last_diplomacy_turn,
                diplomacy_blocked_until_turn
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                match_id,
                "tribe",
                tribe_name,
                "player",
                player_id,
                relation,
                None::<i32>,    // war_score
                None::<i32>,    // last_conflict_turn
                None::<i32>,    // last_diplomacy_turn
                None::<i32>,    // diplomacy_blocked_until_turn
            ],
        )?;

        count += 1;
    }

    Ok(count)
}

/// Parse TeamDiplomacy entries
///
/// Format: T.TEAM1.TEAM2 → DIPLOMACY_STATE
fn parse_team_diplomacy(
    team_diplomacy_node: &roxmltree::Node,
    conn: &Connection,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

    for entry_node in team_diplomacy_node.children().filter(|n| n.is_element()) {
        let key = entry_node.tag_name().name(); // e.g., "T.0.1"
        let relation = entry_node
            .text()
            .ok_or_else(|| {
                ParseError::MissingElement(format!("TeamDiplomacy.{} text content", key))
            })?;

        // Parse key: "T.0.1" → team1="0", team2="1"
        let parts: Vec<&str> = key.split('.').collect();
        if parts.len() != 3 || parts[0] != "T" {
            log::warn!("Invalid TeamDiplomacy key format: {}", key);
            continue;
        }

        let team1 = parts[1];
        let team2 = parts[2];

        // Insert into diplomacy table
        // entity1 = player (team1), entity2 = player (team2)
        conn.execute(
            "INSERT INTO diplomacy (
                match_id, entity1_type, entity1_id, entity2_type, entity2_id,
                relation, war_score, last_conflict_turn, last_diplomacy_turn,
                diplomacy_blocked_until_turn
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                match_id,
                "player",
                team1,
                "player",
                team2,
                relation,
                None::<i32>,    // war_score
                None::<i32>,    // last_conflict_turn
                None::<i32>,    // last_diplomacy_turn
                None::<i32>,    // diplomacy_blocked_until_turn
            ],
        )?;

        count += 1;
    }

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_tribe_diplomacy_key() {
        let key = "TRIBE_REBELS.0";
        let parts: Vec<&str> = key.rsplitn(2, '.').collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], "0");
        assert_eq!(parts[1], "TRIBE_REBELS");
    }

    #[test]
    fn test_parse_team_diplomacy_key() {
        let key = "T.0.1";
        let parts: Vec<&str> = key.split('.').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "T");
        assert_eq!(parts[1], "0");
        assert_eq!(parts[2], "1");
    }

    #[test]
    fn test_parse_diplomacy_xml() {
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
        let game_node = doc
            .root_element()
            .children()
            .find(|n| n.has_tag_name("Game"))
            .unwrap();

        // Verify TribeDiplomacy can be found
        let tribe_diplomacy_node = game_node
            .children()
            .find(|n| n.has_tag_name("TribeDiplomacy"))
            .unwrap();

        assert_eq!(
            tribe_diplomacy_node
                .children()
                .filter(|n| n.is_element())
                .count(),
            2
        );

        // Verify TeamDiplomacy can be found
        let team_diplomacy_node = game_node
            .children()
            .find(|n| n.has_tag_name("TeamDiplomacy"))
            .unwrap();

        assert_eq!(
            team_diplomacy_node
                .children()
                .filter(|n| n.is_element())
                .count(),
            2
        );
    }
}
