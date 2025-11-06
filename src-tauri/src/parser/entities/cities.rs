// City entity parser

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};

/// Parse all cities from the XML document
pub fn parse_cities(doc: &XmlDocument, conn: &Connection, id_mapper: &mut IdMapper) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

    // Create appender ONCE before loop
    let mut app = conn.appender("cities")?;

    // Find all City elements as direct children of Root
    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let xml_id = city_node.req_attr("ID")?.parse::<i32>()?;
        let db_id = id_mapper.map_city(xml_id);

        // Player ID - filter out -1 for cities in anarchy/being captured
        let player_xml_id = city_node
            .req_attr("Player")?
            .parse::<i32>()?;
        let player_xml_id = if player_xml_id >= 0 {
            Some(player_xml_id)
        } else {
            None
        };
        let player_db_id = match player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        let tile_xml_id = city_node.req_attr("TileID")?.parse::<i32>()?;
        let tile_db_id = id_mapper.get_tile(tile_xml_id)?;

        // City name: older saves use "NameType", newer saves use "Name"
        let city_name = city_node
            .opt_child_text("NameType")
            .or_else(|| city_node.opt_child_text("Name"))
            .unwrap_or("Unknown City");
        let founded_turn = city_node.req_attr("Founded")?.parse::<i32>()?;

        // Optional fields
        let family = city_node.opt_attr("Family");

        // Capital status is indicated by presence of <Capital /> element
        let is_capital = city_node
            .children()
            .any(|n| n.has_tag_name("Capital"));

        // Population
        let citizens = city_node
            .opt_child_text("Citizens")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(1);
        let growth_progress = city_node
            .opt_child_text("GrowthProgress")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        // Leadership
        let governor_xml_id = city_node
            .opt_child_text("GovernorID")
            .and_then(|s| s.parse::<i32>().ok());
        let governor_db_id = match governor_xml_id {
            Some(id) => Some(id_mapper.get_character(id)?),
            None => None,
        };

        let general_xml_id = city_node
            .opt_child_text("GeneralID")
            .and_then(|s| s.parse::<i32>().ok());
        let general_db_id = match general_xml_id {
            Some(id) => Some(id_mapper.get_character(id)?),
            None => None,
        };

        let agent_xml_id = city_node
            .opt_child_text("Agent")
            .and_then(|s| s.parse::<i32>().ok());
        let agent_db_id = match agent_xml_id {
            Some(id) => Some(id_mapper.get_character(id)?),
            None => None,
        };

        // Production
        let hurry_civics_count = city_node
            .opt_child_text("HurryCivicsCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);
        let hurry_money_count = city_node
            .opt_child_text("HurryMoneyCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);
        let specialist_count = city_node
            .opt_child_text("SpecialistCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        // First owner tracking
        let first_owner_player_xml_id = city_node
            .opt_child_text("FirstOwnerPlayerID")
            .and_then(|s| s.parse::<i32>().ok());
        let first_owner_player_db_id = match first_owner_player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        // Bulk append - must match schema column order exactly
        app.append_row(params![
            db_id,                          // city_id
            id_mapper.match_id,             // match_id
            xml_id,                         // xml_id
            player_db_id,                   // player_id
            tile_db_id,                     // tile_id
            city_name,                      // city_name
            family,                         // family
            founded_turn,                   // founded_turn
            is_capital,                     // is_capital
            citizens,                       // citizens
            growth_progress,                // growth_progress
            governor_db_id,                 // governor_id
            general_db_id,                  // general_id
            agent_db_id,                    // agent_id
            hurry_civics_count,             // hurry_civics_count
            hurry_money_count,              // hurry_money_count
            specialist_count,               // specialist_count
            first_owner_player_db_id,       // first_owner_player_id
        ])?;

        count += 1;
    }

    log::info!("Parsed {} cities", count);
    Ok(count)
}
