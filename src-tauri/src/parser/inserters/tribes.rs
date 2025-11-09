// Tribe entity inserter - DB insertion logic

use crate::parser::game_data::TribeData;
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert tribes using Appender
pub fn insert_tribes(
    conn: &Connection,
    tribes: &[TribeData],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for tribe in tribes {
        // Map character and player IDs (ignore errors - leader might not exist yet)
        let leader_db_id = tribe
            .leader_character_xml_id
            .and_then(|id| id_mapper.get_character(id).ok());

        let allied_player_db_id = tribe
            .allied_player_xml_id
            .and_then(|id| id_mapper.get_player(id).ok());

        // Column order: tribe_id, match_id, xml_id (NULL), leader_character_id,
        //               allied_player_id, religion
        rows.push((
            tribe.tribe_id.clone(),
            id_mapper.match_id,
            None::<i32>, // xml_id is NULL for tribes
            leader_db_id,
            allied_player_db_id,
            tribe.religion.clone(),
        ));
    }

    // Deduplicate (last-wins strategy)
    let unique_rows = deduplicate_rows_last_wins(rows, |(tribe_id, match_id, ..)| {
        (tribe_id.clone(), *match_id)
    });

    // Bulk insert
    let mut app = conn.appender("tribes")?;
    for (tribe_id, match_id, xml_id, leader_db_id, allied_player_db_id, religion) in unique_rows {
        app.append_row(params![
            tribe_id,
            match_id,
            xml_id,
            leader_db_id,
            allied_player_db_id,
            religion
        ])?;
    }

    drop(app);
    Ok(())
}
