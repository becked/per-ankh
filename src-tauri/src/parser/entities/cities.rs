// City entity parser

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};

/// Parse all cities from the XML document
pub fn parse_cities(doc: &XmlDocument, conn: &Connection, id_mapper: &mut IdMapper) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

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

        let city_name = city_node.req_child_text("NameType")?; // City name is in NameType element
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

        // Insert city using UPSERT
        // Note: city_id is NOT updated on conflict - it must remain stable
        conn.execute(
            "INSERT INTO cities (
                city_id, match_id, xml_id, player_id, tile_id,
                city_name, family, founded_turn, is_capital,
                citizens, growth_progress,
                governor_id, general_id, agent_id,
                hurry_civics_count, hurry_money_count, specialist_count
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (match_id, xml_id) DO UPDATE SET
                player_id = excluded.player_id,
                tile_id = excluded.tile_id,
                city_name = excluded.city_name,
                family = excluded.family,
                founded_turn = excluded.founded_turn,
                is_capital = excluded.is_capital,
                citizens = excluded.citizens,
                growth_progress = excluded.growth_progress,
                governor_id = excluded.governor_id,
                general_id = excluded.general_id,
                agent_id = excluded.agent_id,
                hurry_civics_count = excluded.hurry_civics_count,
                hurry_money_count = excluded.hurry_money_count,
                specialist_count = excluded.specialist_count",
            params![
                db_id,
                id_mapper.match_id,
                xml_id,
                player_db_id,
                tile_db_id,
                city_name,
                family,
                founded_turn,
                is_capital,
                citizens,
                growth_progress,
                governor_db_id,
                general_db_id,
                agent_db_id,
                hurry_civics_count,
                hurry_money_count,
                specialist_count
            ],
        )?;

        count += 1;
    }

    log::info!("Parsed {} cities", count);
    Ok(count)
}
