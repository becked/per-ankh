// Parse players from XML to typed structs (no database dependency)

use crate::parser::game_data::PlayerData;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;

/// Parse all players from XML document into typed structs
///
/// This function is pure - it only reads XML and returns data structures.
/// No database interaction, no ID mapping. This enables:
/// - Testing without DB setup
/// - Parallel execution (no shared mutable state)
/// - Caching intermediate results
pub fn parse_players_struct(doc: &XmlDocument) -> Result<Vec<PlayerData>> {
    let root = doc.root_element();
    let mut players = Vec::new();

    // Find all Player elements as direct children of Root
    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let xml_id = player_node.req_attr("ID")?.parse::<i32>()?;

        // Player data is stored as ATTRIBUTES on the Player element
        let player_name = player_node.req_attr("Name")?.to_string();
        let nation = player_node.opt_attr("Nation").map(|s| s.to_string());
        let dynasty = player_node.opt_attr("Dynasty").map(|s| s.to_string());

        // Optional attributes and child elements
        let difficulty = player_node.opt_attr("Difficulty").map(|s| s.to_string());
        let team_id = player_node.opt_attr("Team").map(|s| s.to_string());
        let state_religion = player_node
            .opt_child_text("StateReligion")
            .map(|s| s.to_string());
        let legitimacy = player_node
            .opt_child_text("Legitimacy")
            .and_then(|s| s.parse::<i32>().ok());

        // External identity - parse first since it affects is_human detection
        let online_id = player_node.opt_attr("OnlineID").map(|s| s.to_string());

        // Determine if player is human:
        // 1. Has an OnlineID (Steam/GOG/Epic account) = definitely human
        // 2. AIControlledToTurn="0" = actively taking turn (human in single-player,
        //    or the current player in multiplayer)
        // In multiplayer saves, only the active player has AIControlledToTurn=0,
        // but ALL human players have OnlineIDs. So OnlineID is the reliable indicator.
        let has_online_id = online_id
            .as_ref()
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        let ai_controlled_to_turn_zero = player_node
            .opt_attr("AIControlledToTurn")
            .and_then(|s| s.parse::<i32>().ok())
            .map(|turn| turn == 0)
            .unwrap_or(false);
        let is_human = has_online_id || ai_controlled_to_turn_zero;
        let email = player_node.opt_attr("Email").map(|s| s.to_string());

        // Game state
        let last_turn_completed = player_node
            .opt_child_text("LastTurnCompleted")
            .and_then(|s| s.parse::<i32>().ok());
        let turn_ended = player_node
            .opt_child_text("TurnEnded")
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);

        // Resources
        let time_stockpile = player_node
            .opt_child_text("TimeStockpile")
            .and_then(|s| s.parse::<i32>().ok());

        // Political
        let succession_gender = player_node
            .opt_child_text("SuccessionGender")
            .map(|s| s.to_string());
        let founder_character_xml_id = player_node
            .opt_child_text("FounderCharacterID")
            .and_then(|s| s.parse::<i32>().ok());
        let chosen_heir_xml_id = player_node
            .opt_child_text("ChosenHeirID")
            .and_then(|s| s.parse::<i32>().ok());
        let original_capital_city_xml_id = player_node
            .opt_child_text("OriginalCapitalCityID")
            .and_then(|s| s.parse::<i32>().ok());

        // Research
        let tech_researching = player_node
            .opt_child_text("TechResearching")
            .map(|s| s.to_string());

        // Counters
        let ambition_delay = player_node
            .opt_child_text("AmbitionDelay")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);
        let tiles_purchased = player_node
            .opt_child_text("TilesPurchased")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);
        let state_religion_changes = player_node
            .opt_child_text("StateReligionChanges")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);
        let tribe_mercenaries_hired = player_node
            .opt_child_text("TribeMercenariesHired")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        players.push(PlayerData {
            xml_id,
            player_name,
            nation,
            dynasty,
            team_id,
            is_human,
            is_save_owner: false, // Determined later by save owner detection logic
            online_id,
            email,
            difficulty,
            last_turn_completed,
            turn_ended,
            legitimacy,
            succession_gender,
            state_religion,
            founder_character_xml_id,
            chosen_heir_xml_id,
            original_capital_city_xml_id,
            time_stockpile,
            tech_researching,
            ambition_delay,
            tiles_purchased,
            state_religion_changes,
            tribe_mercenaries_hired,
        });
    }

    log::debug!("Parsed {} player structs", players.len());
    Ok(players)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_players_struct_basic() {
        let xml = r#"<Root GameId="test-123">
            <Player ID="0" Name="Test Player" Nation="NATION_ROME" AIControlledToTurn="0"/>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let players = parse_players_struct(&doc).unwrap();

        // No DB needed! Direct verification
        assert_eq!(players.len(), 1);
        assert_eq!(players[0].xml_id, 0);
        assert_eq!(players[0].player_name, "Test Player");
        assert_eq!(players[0].nation, Some("NATION_ROME".to_string()));
        assert!(players[0].is_human); // Human because AIControlledToTurn=0
    }

    #[test]
    fn test_parse_players_struct_no_attributes_is_ai() {
        // A player with no AIControlledToTurn and no OnlineID is considered AI
        let xml = r#"<Root GameId="test-123">
            <Player ID="0" Name="AI Player" Nation="NATION_ROME"/>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let players = parse_players_struct(&doc).unwrap();

        assert_eq!(players.len(), 1);
        assert!(!players[0].is_human); // AI because no OnlineID and no AIControlledToTurn=0
    }

    #[test]
    fn test_parse_players_struct_multiple() {
        let xml = r#"<Root GameId="test-123">
            <Player ID="0" Name="Player 1" Nation="NATION_ROME" AIControlledToTurn="0"/>
            <Player ID="1" Name="Player 2" Nation="NATION_EGYPT" AIControlledToTurn="2147483647"/>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let players = parse_players_struct(&doc).unwrap();

        assert_eq!(players.len(), 2);
        assert_eq!(players[0].player_name, "Player 1");
        assert!(players[0].is_human);
        assert_eq!(players[1].player_name, "Player 2");
        assert!(!players[1].is_human);
    }

    #[test]
    fn test_parse_players_struct_with_optional_fields() {
        let xml = r#"<Root GameId="test-123">
            <Player ID="0" Name="Test Player" Nation="NATION_ASSYRIA" Dynasty="DYNASTY_DEFAULT">
                <Legitimacy>100</Legitimacy>
                <TechResearching>TECH_MINING</TechResearching>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let players = parse_players_struct(&doc).unwrap();

        assert_eq!(players.len(), 1);
        assert_eq!(players[0].legitimacy, Some(100));
        assert_eq!(
            players[0].tech_researching,
            Some("TECH_MINING".to_string())
        );
    }

    #[test]
    fn test_parse_players_struct_multiplayer_online_id() {
        // In multiplayer, both players have OnlineID but only active player has AIControlledToTurn=0
        // Both should be detected as human because OnlineID indicates human player
        let xml = r#"<Root GameId="test-123">
            <Player ID="0" Name="ninja" Nation="NATION_CARTHAGE" AIControlledToTurn="0" OnlineID="76561198115360497"/>
            <Player ID="1" Name="becked" Nation="NATION_ROME" AIControlledToTurn="100" OnlineID="76561199101298499"/>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let players = parse_players_struct(&doc).unwrap();

        assert_eq!(players.len(), 2);
        // ninja is human (has OnlineID AND AIControlledToTurn=0)
        assert_eq!(players[0].player_name, "ninja");
        assert!(players[0].is_human);
        assert_eq!(
            players[0].online_id,
            Some("76561198115360497".to_string())
        );
        // becked is ALSO human because they have an OnlineID (even though AIControlledToTurn != 0)
        assert_eq!(players[1].player_name, "becked");
        assert!(players[1].is_human); // This was the bug: previously false!
        assert_eq!(
            players[1].online_id,
            Some("76561199101298499".to_string())
        );
    }

    #[test]
    fn test_parse_players_struct_human_with_online_id_only() {
        // A player with OnlineID but no AIControlledToTurn is still human
        let xml = r#"<Root GameId="test-123">
            <Player ID="0" Name="Steam User" Nation="NATION_GREECE" OnlineID="12345678901234567"/>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let players = parse_players_struct(&doc).unwrap();

        assert_eq!(players.len(), 1);
        assert!(players[0].is_human); // Human because has OnlineID
    }
}
