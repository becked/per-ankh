// Family entity parser

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};

/// Parse all families from the XML document
pub fn parse_families(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &mut IdMapper,
) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

    // Find all Family elements as direct children of Root
    for family_node in root.children().filter(|n| n.has_tag_name("Family")) {
        let xml_id = family_node.req_attr("ID")?.parse::<i32>()?;
        let db_id = id_mapper.map_family(xml_id);

        // Required fields
        let player_xml_id = family_node
            .req_child_text("Player")?
            .parse::<i32>()?;
        let player_db_id = id_mapper.get_player(player_xml_id)?;

        let family_name = family_node.req_child_text("FamilyName")?;
        let family_class = family_node.req_child_text("FamilyClass")?;

        // Optional fields
        let head_xml_id = family_node
            .opt_child_text("Head")
            .and_then(|s| s.parse::<i32>().ok());
        let head_db_id = match head_xml_id {
            Some(id) => Some(id_mapper.get_character(id)?),
            None => None,
        };

        let seat_city_xml_id = family_node
            .opt_child_text("SeatCity")
            .and_then(|s| s.parse::<i32>().ok());
        let seat_city_db_id = match seat_city_xml_id {
            Some(id) => Some(id_mapper.get_city(id)?),
            None => None,
        };

        let turns_without_leader = family_node
            .opt_child_text("TurnsWithoutLeader")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        // Insert family using UPSERT
        conn.execute(
            "INSERT INTO families (
                family_id, match_id, xml_id, player_id,
                family_name, family_class,
                head_character_id, seat_city_id, turns_without_leader
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (match_id, xml_id) DO UPDATE SET
                family_id = excluded.family_id,
                player_id = excluded.player_id,
                family_name = excluded.family_name,
                family_class = excluded.family_class,
                head_character_id = excluded.head_character_id,
                seat_city_id = excluded.seat_city_id,
                turns_without_leader = excluded.turns_without_leader",
            params![
                db_id,
                id_mapper.match_id,
                xml_id,
                player_db_id,
                family_name,
                family_class,
                head_db_id,
                seat_city_db_id,
                turns_without_leader
            ],
        )?;

        count += 1;
    }

    log::info!("Parsed {} families", count);
    Ok(count)
}
