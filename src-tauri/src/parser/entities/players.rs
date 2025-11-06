// Player entity parser

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};

/// Parse all players from the XML document
pub fn parse_players(doc: &XmlDocument, conn: &Connection, id_mapper: &mut IdMapper) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

    // Find all Player elements as direct children of Root
    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let xml_id = player_node.req_attr("ID")?.parse::<i32>()?;
        let db_id = id_mapper.map_player(xml_id);

        // Player data is stored as ATTRIBUTES on the Player element
        let player_name = player_node.req_attr("Name")?;
        let nation = player_node.opt_attr("Nation");
        let dynasty = player_node.opt_attr("Dynasty");

        // Optional attributes and child elements
        let difficulty = player_node.opt_attr("Difficulty");
        let team_id = player_node.opt_attr("Team");
        let state_religion = player_node.opt_child_text("StateReligion");
        let legitimacy = player_node.opt_child_text("Legitimacy")
            .and_then(|s| s.parse::<i32>().ok());

        // Determine if player is human (AI players have AIControlledToTurn attribute)
        let is_human = player_node.opt_attr("AIControlledToTurn").is_none();

        // Insert player using UPSERT
        // Note: player_id is NOT updated on conflict - it must remain stable
        conn.execute(
            "INSERT INTO players (
                player_id, match_id, xml_id, player_name, player_name_normalized,
                nation, dynasty, team_id, is_human, difficulty, legitimacy,
                state_religion
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (match_id, xml_id) DO UPDATE SET
                player_name = excluded.player_name,
                player_name_normalized = excluded.player_name_normalized,
                nation = excluded.nation,
                dynasty = excluded.dynasty,
                team_id = excluded.team_id,
                is_human = excluded.is_human,
                difficulty = excluded.difficulty,
                legitimacy = excluded.legitimacy,
                state_religion = excluded.state_religion",
            params![
                db_id,
                id_mapper.match_id,
                xml_id,
                player_name,
                player_name.to_lowercase(), // normalized
                nation,
                dynasty,
                team_id,
                is_human,
                difficulty,
                legitimacy,
                state_religion
            ],
        )?;

        count += 1;
    }

    log::info!("Parsed {} players", count);
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_players_basic() {
        let xml = r#"<Root GameId="test-123">
            <Player ID="0" Name="Test Player" Nation="NATION_ASSYRIA" Dynasty="DYNASTY_DEFAULT">
                <Legitimacy>100</Legitimacy>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();

        // We can't easily test database operations without a full setup
        // This test just verifies parsing doesn't crash
        let root = doc.root_element();
        let player_node = root.children().find(|n| n.has_tag_name("Player")).unwrap();

        assert_eq!(player_node.req_attr("ID").unwrap(), "0");
        assert_eq!(player_node.req_attr("Name").unwrap(), "Test Player");
    }
}
