// Tile extended data inserters
//
// Inserts tile visibility and change history data into the database

use crate::parser::game_data::{TileChange, TileVisibility};
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert tile visibility records
///
/// Uses last-wins deduplication since visibility can update when tiles are re-explored
pub fn insert_tile_visibility(
    conn: &Connection,
    visibility: &[TileVisibility],
    id_mapper: &IdMapper,
) -> Result<()> {
    if visibility.is_empty() {
        return Ok(());
    }

    let mut rows = Vec::new();

    for record in visibility {
        let tile_db_id = id_mapper.get_tile(record.tile_xml_id)?;

        // Map visible owner XML ID to DB ID if present
        let visible_owner_db_id = if let Some(owner_xml_id) = record.visible_owner_player_xml_id {
            Some(id_mapper.get_player(owner_xml_id)?)
        } else {
            None
        };

        rows.push((
            tile_db_id,
            id_mapper.match_id,
            record.team_id,
            record.revealed_turn,
            visible_owner_db_id,
        ));
    }

    // Deduplicate: last wins (tile can be re-explored)
    let unique_rows = deduplicate_rows_last_wins(rows, |(tile_id, match_id, team_id, ..)| {
        (*tile_id, *match_id, *team_id)
    });

    // Bulk insert
    let mut app = conn.appender("tile_visibility")?;
    for (tile_db_id, match_id, team_id, revealed_turn, visible_owner_db_id) in unique_rows {
        app.append_row(params![
            tile_db_id,
            match_id,
            team_id,
            revealed_turn,
            None::<i32>, // last_seen_turn (not in current data)
            None::<String>, // visible_terrain (not in current data)
            None::<String>, // visible_height (not in current data)
            None::<String>, // visible_vegetation (not in current data)
            None::<String>, // visible_improvement (not in current data)
            visible_owner_db_id,
        ])?;
    }

    drop(app);
    Ok(())
}

/// Insert tile change history records
///
/// Tracks terrain and vegetation changes over time.
/// Uses a generated change_id sequence for unique IDs.
pub fn insert_tile_changes(
    conn: &Connection,
    changes: &[TileChange],
    id_mapper: &IdMapper,
) -> Result<()> {
    if changes.is_empty() {
        return Ok(());
    }

    let mut rows = Vec::new();

    for (idx, change) in changes.iter().enumerate() {
        let tile_db_id = id_mapper.get_tile(change.tile_xml_id)?;

        // Generate unique change_id based on match and index
        let change_id = (id_mapper.match_id * 1_000_000) + idx as i64;

        rows.push((
            change_id,
            tile_db_id,
            id_mapper.match_id,
            change.turn,
            change.change_type.clone(),
            change.new_value.clone(),
        ));
    }

    // No deduplication needed - each change is unique by design

    // Bulk insert
    let mut app = conn.appender("tile_changes")?;
    for (change_id, tile_db_id, match_id, turn, change_type, new_value) in rows {
        app.append_row(params![
            change_id,
            tile_db_id,
            match_id,
            turn,
            change_type,
            None::<String>, // old_value (not tracked in sparse format)
            new_value,
        ])?;
    }

    drop(app);
    Ok(())
}
