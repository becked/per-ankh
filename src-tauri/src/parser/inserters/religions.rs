// Religion entity inserter - DB insertion logic

use crate::parser::game_data::ReligionData;
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert religions using Appender
pub fn insert_religions(
    conn: &Connection,
    religions: &[ReligionData],
    id_mapper: &mut IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for religion in religions {
        let db_id = id_mapper.map_religion_by_name(&religion.religion_name);

        // Map XML IDs to database IDs
        let head_db_id = religion
            .head_character_xml_id
            .and_then(|id| id_mapper.get_character(id).ok());

        let holy_city_db_id = religion
            .holy_city_xml_id
            .and_then(|id| id_mapper.get_city(id).ok());

        let founder_player_db_id = religion
            .founder_player_xml_id
            .and_then(|id| id_mapper.get_player(id).ok());

        // Column order: religion_id, match_id, xml_id (NULL), religion_name,
        //               founded_turn, founder_player_id, head_character_id, holy_city_id
        rows.push((
            db_id,
            id_mapper.match_id,
            None::<i32>, // xml_id is NULL for religions
            religion.religion_name.clone(),
            religion.founded_turn,
            founder_player_db_id,
            head_db_id,
            holy_city_db_id,
        ));
    }

    // Deduplicate (last-wins strategy)
    let unique_rows = deduplicate_rows_last_wins(rows, |(religion_id, match_id, ..)| {
        (*religion_id, *match_id)
    });

    // Bulk insert
    let mut app = conn.appender("religions")?;
    for (
        db_id,
        match_id,
        xml_id,
        religion_name,
        founded_turn,
        founder_player_db_id,
        head_db_id,
        holy_city_db_id,
    ) in unique_rows
    {
        app.append_row(params![
            db_id,
            match_id,
            xml_id,
            religion_name,
            founded_turn,
            founder_player_db_id,
            head_db_id,
            holy_city_db_id
        ])?;
    }

    app.flush()?;
    Ok(())
}
