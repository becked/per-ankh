// Player entity parser

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};

/// Parse all players from the XML document
pub fn parse_players(doc: &XmlDocument, conn: &Connection, id_mapper: &mut IdMapper) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

    // Create appender ONCE before loop
    let mut app = conn.appender("players")?;

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

        // Determine if player is human by checking AIControlledToTurn value
        // Human: AIControlledToTurn="0", AI: AIControlledToTurn="2147483647"
        let is_human = player_node
            .opt_attr("AIControlledToTurn")
            .and_then(|s| s.parse::<i32>().ok())
            .map(|turn| turn == 0)
            .unwrap_or(true); // Default to human if attribute missing (backward compatibility)

        // External identity
        let online_id = player_node.opt_attr("OnlineID");
        let email = player_node.opt_attr("Email");

        // Game state
        let last_turn_completed = player_node.opt_child_text("LastTurnCompleted")
            .and_then(|s| s.parse::<i32>().ok());
        let turn_ended = player_node.opt_child_text("TurnEnded")
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);

        // Resources
        let time_stockpile = player_node.opt_child_text("TimeStockpile")
            .and_then(|s| s.parse::<i32>().ok());

        // Political
        let succession_gender = player_node.opt_child_text("SuccessionGender");
        let founder_character_xml_id = player_node.opt_child_text("FounderCharacterID")
            .and_then(|s| s.parse::<i32>().ok());
        let founder_character_db_id = match founder_character_xml_id {
            Some(id) => id_mapper.get_character(id).ok(),
            None => None,
        };
        let chosen_heir_xml_id = player_node.opt_child_text("ChosenHeirID")
            .and_then(|s| s.parse::<i32>().ok());
        let chosen_heir_db_id = match chosen_heir_xml_id {
            Some(id) => id_mapper.get_character(id).ok(),
            None => None,
        };
        let original_capital_city_xml_id = player_node.opt_child_text("OriginalCapitalCityID")
            .and_then(|s| s.parse::<i32>().ok());
        let original_capital_city_db_id = match original_capital_city_xml_id {
            Some(id) => id_mapper.get_city(id).ok(),
            None => None,
        };

        // Research
        let tech_researching = player_node.opt_child_text("TechResearching");

        // Counters
        let ambition_delay = player_node.opt_child_text("AmbitionDelay")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);
        let tiles_purchased = player_node.opt_child_text("TilesPurchased")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);
        let state_religion_changes = player_node.opt_child_text("StateReligionChanges")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);
        let tribe_mercenaries_hired = player_node.opt_child_text("TribeMercenariesHired")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        // Bulk append - must match schema column order exactly
        app.append_row(params![
            db_id,                              // player_id
            id_mapper.match_id,                 // match_id
            xml_id,                             // xml_id
            player_name,                        // player_name
            player_name.to_lowercase(),         // player_name_normalized
            nation,                             // nation
            dynasty,                            // dynasty
            team_id,                            // team_id
            is_human,                           // is_human
            online_id,                          // online_id
            email,                              // email
            difficulty,                         // difficulty
            last_turn_completed,                // last_turn_completed
            turn_ended,                         // turn_ended
            legitimacy,                         // legitimacy
            time_stockpile,                     // time_stockpile
            state_religion,                     // state_religion
            succession_gender,                  // succession_gender
            founder_character_db_id,            // founder_character_id
            chosen_heir_db_id,                  // chosen_heir_id
            original_capital_city_db_id,        // original_capital_city_id
            tech_researching,                   // tech_researching
            ambition_delay,                     // ambition_delay
            tiles_purchased,                    // tiles_purchased
            state_religion_changes,             // state_religion_changes
            tribe_mercenaries_hired,            // tribe_mercenaries_hired
        ])?;

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
