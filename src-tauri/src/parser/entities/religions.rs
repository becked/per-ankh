// Religion entity parser

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};
use std::collections::HashMap;

/// Parse all religions from the XML document
///
/// Note: Religions are not exported as individual elements in Old World saves.
/// Instead, they appear in aggregate containers under the Root element:
/// - ReligionFounded: Maps religion names to founding turn
/// - ReligionHeadID: Maps religion names to current head character ID
/// - ReligionHolyCity: Maps religion names to holy city ID
/// - ReligionFounder: Maps religion names to founding player ID
pub fn parse_religions(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

    // Religion containers are inside the Game element
    let game_node = match root.children().find(|n| n.has_tag_name("Game")) {
        Some(node) => node,
        None => {
            log::warn!("Game element not found in XML");
            return Ok(0);
        }
    };

    // Collect all religion names and their data from various containers
    let mut religions: HashMap<String, ReligionData> = HashMap::new();

    // Parse ReligionFounded container
    if let Some(founded_node) = game_node.children().find(|n| n.has_tag_name("ReligionFounded")) {
        for child in founded_node.children().filter(|n| n.is_element()) {
            let religion_name = child.tag_name().name();
            let founded_turn = child.text().and_then(|s| s.parse::<i32>().ok());
            religions
                .entry(religion_name.to_string())
                .or_default()
                .founded_turn = founded_turn;
        }
    }

    // Parse ReligionHeadID container
    if let Some(head_node) = game_node.children().find(|n| n.has_tag_name("ReligionHeadID")) {
        for child in head_node.children().filter(|n| n.is_element()) {
            let religion_name = child.tag_name().name();
            let head_id = child.text().and_then(|s| s.parse::<i32>().ok());
            religions
                .entry(religion_name.to_string())
                .or_default()
                .head_character_xml_id = head_id;
        }
    }

    // Parse ReligionHolyCity container
    if let Some(holy_city_node) = game_node.children().find(|n| n.has_tag_name("ReligionHolyCity")) {
        for child in holy_city_node.children().filter(|n| n.is_element()) {
            let religion_name = child.tag_name().name();
            let city_id = child.text().and_then(|s| s.parse::<i32>().ok());
            religions
                .entry(religion_name.to_string())
                .or_default()
                .holy_city_xml_id = city_id;
        }
    }

    // Parse ReligionFounder container
    if let Some(founder_node) = game_node.children().find(|n| n.has_tag_name("ReligionFounder")) {
        for child in founder_node.children().filter(|n| n.is_element()) {
            let religion_name = child.tag_name().name();
            let founder_id = child.text().and_then(|s| s.parse::<i32>().ok());
            religions
                .entry(religion_name.to_string())
                .or_default()
                .founder_player_xml_id = founder_id;
        }
    }

    // Insert all religions into database
    for (religion_name, data) in religions {
        let db_id = id_mapper.map_religion_by_name(&religion_name);

        // Map XML IDs to database IDs
        let head_db_id = data
            .head_character_xml_id
            .and_then(|id| id_mapper.get_character(id).ok());

        let holy_city_db_id = data
            .holy_city_xml_id
            .and_then(|id| id_mapper.get_city(id).ok());

        let founder_player_db_id = data
            .founder_player_xml_id
            .and_then(|id| id_mapper.get_player(id).ok());

        // Insert religion using UPSERT (on religion_id, the primary key)
        conn.execute(
            "INSERT INTO religions (
                religion_id, match_id, xml_id,
                religion_name, founded_turn, founder_player_id,
                head_character_id, holy_city_id
            )
            VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
            ON CONFLICT (religion_id) DO UPDATE SET
                match_id = excluded.match_id,
                religion_name = excluded.religion_name,
                founded_turn = excluded.founded_turn,
                founder_player_id = excluded.founder_player_id,
                head_character_id = excluded.head_character_id,
                holy_city_id = excluded.holy_city_id",
            params![
                db_id,
                id_mapper.match_id,
                religion_name,
                data.founded_turn,
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

#[derive(Default)]
struct ReligionData {
    founded_turn: Option<i32>,
    head_character_xml_id: Option<i32>,
    holy_city_xml_id: Option<i32>,
    founder_player_xml_id: Option<i32>,
}
