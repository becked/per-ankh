// City entity parser

use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;
use duckdb::{params, Connection};

/// Parse all cities from the XML document
pub fn parse_cities(doc: &XmlDocument, conn: &Connection, id_mapper: &mut IdMapper) -> Result<usize> {
    let root = doc.root_element();

    // Collect all city rows first
    let mut cities = Vec::new();

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
            .unwrap_or("Unknown City")
            .to_string();
        let founded_turn = city_node.req_attr("Founded")?.parse::<i32>()?;

        // Optional fields
        let family = city_node.opt_attr("Family").map(|s| s.to_string());

        // Capital status is indicated by presence of <Capital /> element
        let is_capital = city_node
            .children()
            .any(|n| n.has_tag_name("Capital"));

        // Population
        let citizens = city_node
            .opt_child_text("Citizens")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(1);
        // Leadership
        let governor_xml_id = city_node
            .opt_child_text("GovernorID")
            .and_then(|s| s.parse::<i32>().ok());
        let governor_db_id = match governor_xml_id {
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
            .opt_child_text("SpecialistProducedCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        // First owner tracking
        let first_owner_player_xml_id = city_node
            .opt_child_text("FirstPlayer")
            .and_then(|s| s.parse::<i32>().ok());
        let first_owner_player_db_id = match first_owner_player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        // Last owner tracking
        let last_owner_player_xml_id = city_node
            .opt_child_text("LastPlayer")
            .and_then(|s| s.parse::<i32>().ok());
        let last_owner_player_db_id = match last_owner_player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        // Governor turn
        let governor_turn = city_node
            .opt_child_text("GovernorTurn")
            .and_then(|s| s.parse::<i32>().ok());

        // Additional hurry metrics
        let hurry_training_count = city_node
            .opt_child_text("HurryTrainingCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        let hurry_population_count = city_node
            .opt_child_text("HurryPopulationCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        // Growth and production counts
        let growth_count = city_node
            .opt_child_text("GrowthCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        let unit_production_count = city_node
            .opt_child_text("UnitProductionCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        let buy_tile_count = city_node
            .opt_child_text("BuyTileCount")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        // Collect row data - must match schema column order exactly
        cities.push((
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
            governor_db_id,                 // governor_id
            governor_turn,                  // governor_turn
            hurry_civics_count,             // hurry_civics_count
            hurry_money_count,              // hurry_money_count
            hurry_training_count,           // hurry_training_count
            hurry_population_count,         // hurry_population_count
            specialist_count,               // specialist_count
            growth_count,                   // growth_count
            unit_production_count,          // unit_production_count
            buy_tile_count,                 // buy_tile_count
            first_owner_player_db_id,       // first_owner_player_id
            last_owner_player_db_id,        // last_owner_player_id
        ));
    }

    // Deduplicate (last-wins strategy)
    // Primary key: (city_id, match_id)
    let unique_cities = deduplicate_rows_last_wins(
        cities,
        |(city_id, match_id, ..)| (*city_id, *match_id)
    );

    let count = unique_cities.len();

    // Bulk insert deduplicated rows
    let mut app = conn.appender("cities")?;
    for (db_id, match_id, xml_id, player_db_id, tile_db_id, city_name, family, founded_turn,
         is_capital, citizens, governor_db_id, governor_turn,
         hurry_civics_count, hurry_money_count, hurry_training_count, hurry_population_count,
         specialist_count, growth_count, unit_production_count, buy_tile_count,
         first_owner_player_db_id, last_owner_player_db_id) in unique_cities
    {
        app.append_row(params![
            db_id, match_id, xml_id, player_db_id, tile_db_id, city_name, family, founded_turn,
            is_capital, citizens, governor_db_id, governor_turn,
            hurry_civics_count, hurry_money_count, hurry_training_count, hurry_population_count,
            specialist_count, growth_count, unit_production_count, buy_tile_count,
            first_owner_player_db_id, last_owner_player_db_id
        ])?;
    }

    // Flush appender to commit all rows
    app.flush()?;

    log::info!("Parsed {} cities", count);
    Ok(count)
}
