// Tribe entity parser

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};

/// Parse all tribes from the XML document
pub fn parse_tribes(doc: &XmlDocument, conn: &Connection, id_mapper: &mut IdMapper) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

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

        let religion = tribe_node.opt_child_text("Religion");

        // Insert tribe using UPSERT
        // Tribes use (tribe_id, match_id) as PRIMARY KEY, not (match_id, xml_id)
        conn.execute(
            "INSERT INTO tribes (
                tribe_id, match_id, xml_id,
                leader_character_id, allied_player_id, religion
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (tribe_id, match_id) DO UPDATE SET
                xml_id = excluded.xml_id,
                leader_character_id = excluded.leader_character_id,
                allied_player_id = excluded.allied_player_id,
                religion = excluded.religion",
            params![
                tribe_id,
                id_mapper.match_id,
                xml_id,
                leader_db_id,
                allied_player_db_id,
                religion
            ],
        )?;

        count += 1;
    }

    log::info!("Parsed {} tribes", count);
    Ok(count)
}
