// Tribe entity parser

use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;
use duckdb::{params, Connection};

/// Parse all tribes from the XML document
pub fn parse_tribes(doc: &XmlDocument, conn: &Connection, id_mapper: &mut IdMapper) -> Result<usize> {
    let root = doc.root_element();

    // Collect all tribe rows first
    let mut tribes = Vec::new();

    // Find all Tribe elements as direct children of Root
    for tribe_node in root.children().filter(|n| n.has_tag_name("Tribe")) {
        // Tribes use string IDs like "TRIBE_REBELS", not numeric IDs
        let tribe_id = tribe_node.req_attr("ID")?;

        // xml_id is NULL for tribes since they don't have numeric IDs
        let xml_id: Option<i32> = None;

        // Optional fields - tribal leaders might not exist in character list yet
        let leader_xml_id = tribe_node
            .opt_child_text("LeaderID")
            .and_then(|s| s.parse::<i32>().ok());
        let leader_db_id = match leader_xml_id {
            Some(id) => id_mapper.get_character(id).ok(), // Ignore if character not found
            None => None,
        };

        let allied_player_xml_id = tribe_node
            .opt_child_text("AlliedPlayer")
            .and_then(|s| s.parse::<i32>().ok())
            .filter(|&id| id >= 0); // Filter out -1 for non-allied tribes
        let allied_player_db_id = match allied_player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        let religion = tribe_node.opt_child_text("Religion").map(|s| s.to_string());

        // Collect row data - must match schema column order exactly
        tribes.push((
            tribe_id.to_string(),       // tribe_id
            id_mapper.match_id,         // match_id
            xml_id,                     // xml_id
            leader_db_id,               // leader_character_id
            allied_player_db_id,        // allied_player_id
            religion,                   // religion
        ));
    }

    // Deduplicate (last-wins strategy)
    // Primary key: (tribe_id, match_id)
    let unique_tribes = deduplicate_rows_last_wins(
        tribes,
        |(tribe_id, match_id, ..)| (tribe_id.clone(), *match_id)
    );

    let count = unique_tribes.len();

    // Bulk insert deduplicated rows
    let mut app = conn.appender("tribes")?;
    for (tribe_id, match_id, xml_id, leader_db_id, allied_player_db_id, religion) in unique_tribes {
        app.append_row(params![
            tribe_id, match_id, xml_id, leader_db_id, allied_player_db_id, religion
        ])?;
    }

    // Flush appender to commit all rows
    drop(app);

    log::info!("Parsed {} tribes", count);
    Ok(count)
}
