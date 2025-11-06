// Religion entity parser

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};

/// Parse all religions from the XML document
pub fn parse_religions(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

    // Find all Religion elements as direct children of Root
    for religion_node in root.children().filter(|n| n.has_tag_name("Religion")) {
        let xml_id = religion_node.req_attr("ID")?.parse::<i32>()?;
        let db_id = id_mapper.map_religion(xml_id);

        // Required field
        let religion_name = religion_node.req_child_text("ReligionName")?;

        // Optional fields
        let founded_turn = religion_node
            .opt_child_text("FoundedTurn")
            .and_then(|s| s.parse::<i32>().ok());

        let founder_player_xml_id = religion_node
            .opt_child_text("FounderPlayer")
            .and_then(|s| s.parse::<i32>().ok());
        let founder_player_db_id = match founder_player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        let head_xml_id = religion_node
            .opt_child_text("Head")
            .and_then(|s| s.parse::<i32>().ok());
        let head_db_id = match head_xml_id {
            Some(id) => Some(id_mapper.get_character(id)?),
            None => None,
        };

        let holy_city_xml_id = religion_node
            .opt_child_text("HolyCity")
            .and_then(|s| s.parse::<i32>().ok());
        let holy_city_db_id = match holy_city_xml_id {
            Some(id) => Some(id_mapper.get_city(id)?),
            None => None,
        };

        // Insert religion using UPSERT
        conn.execute(
            "INSERT INTO religions (
                religion_id, match_id, xml_id,
                religion_name, founded_turn, founder_player_id,
                head_character_id, holy_city_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (match_id, xml_id) DO UPDATE SET
                religion_id = excluded.religion_id,
                religion_name = excluded.religion_name,
                founded_turn = excluded.founded_turn,
                founder_player_id = excluded.founder_player_id,
                head_character_id = excluded.head_character_id,
                holy_city_id = excluded.holy_city_id",
            params![
                db_id,
                id_mapper.match_id,
                xml_id,
                religion_name,
                founded_turn,
                founder_player_db_id,
                head_db_id,
                holy_city_db_id
            ],
        )?;

        count += 1;
    }

    log::info!("Parsed {} religions", count);
    Ok(count)
}
