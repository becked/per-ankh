// Unit production aggregate data inserters - DB insertion logic

use crate::parser::game_data::{CityUnitProduction, PlayerUnitProduction};
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert player-level unit production using Appender
pub fn insert_player_units_produced(
    conn: &Connection,
    records: &[PlayerUnitProduction],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for record in records {
        let player_db_id = id_mapper.get_player(record.player_xml_id)?;

        // Column order: player_id, match_id, unit_type, count
        rows.push((
            player_db_id,
            id_mapper.match_id,
            record.unit_type.clone(),
            record.count,
        ));
    }

    // Deduplicate by (player_id, match_id, unit_type)
    let unique_rows =
        deduplicate_rows_last_wins(rows, |(player_id, match_id, unit_type, _count)| {
            (*player_id, *match_id, unit_type.clone())
        });

    // Bulk insert
    let mut app = conn.appender("player_units_produced")?;
    for (player_db_id, match_id, unit_type, count) in unique_rows {
        app.append_row(params![player_db_id, match_id, unit_type, count])?;
    }

    drop(app);
    Ok(())
}

/// Insert city-level unit production using Appender
pub fn insert_city_units_produced(
    conn: &Connection,
    records: &[CityUnitProduction],
    id_mapper: &IdMapper,
) -> Result<()> {
    let mut rows = Vec::new();

    for record in records {
        let city_db_id = id_mapper.get_city(record.city_xml_id)?;

        // Column order: city_id, match_id, unit_type, count
        rows.push((
            city_db_id,
            id_mapper.match_id,
            record.unit_type.clone(),
            record.count,
        ));
    }

    // Deduplicate by (city_id, match_id, unit_type)
    let unique_rows =
        deduplicate_rows_last_wins(rows, |(city_id, match_id, unit_type, _count)| {
            (*city_id, *match_id, unit_type.clone())
        });

    // Bulk insert
    let mut app = conn.appender("city_units_produced")?;
    for (city_db_id, match_id, unit_type, count) in unique_rows {
        app.append_row(params![city_db_id, match_id, unit_type, count])?;
    }

    drop(app);
    Ok(())
}
