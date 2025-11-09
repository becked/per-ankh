// Tiles inserter - bulk insertion to database (Pass 1: core data only)

use crate::parser::game_data::TileData;
use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert tiles (Pass 1: core data only, no owner_city_id which is set in Pass 2b)
pub fn insert_tiles_core(
    conn: &Connection,
    tiles: &[TileData],
    id_mapper: &mut IdMapper,
) -> Result<()> {
    // Collect rows for bulk insertion
    let mut rows = Vec::new();
    for tile in tiles {
        let db_id = id_mapper.map_tile(tile.xml_id);

        // Map owner player XML ID to DB ID
        let owner_player_db_id = match tile.owner_player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        // owner_city_id is NOT set here - it will be populated in Pass 2b after cities are created
        let owner_city_db_id: Option<i64> = None;

        // Collect row data - must match schema column order exactly
        rows.push((
            db_id,                          // tile_id
            id_mapper.match_id,             // match_id
            tile.xml_id,                    // xml_id
            tile.x,                         // x
            tile.y,                         // y
            tile.terrain.clone(),           // terrain
            tile.height.clone(),            // height
            tile.vegetation.clone(),        // vegetation
            tile.river_w,                   // river_w
            tile.river_sw,                  // river_sw
            tile.river_se,                  // river_se
            tile.resource.clone(),          // resource
            tile.improvement.clone(),       // improvement
            tile.improvement_pillaged,      // improvement_pillaged
            tile.improvement_disabled,      // improvement_disabled
            tile.improvement_turns_left,    // improvement_turns_left
            tile.improvement_develop_turns, // improvement_develop_turns
            tile.specialist.clone(),        // specialist
            tile.has_road,                  // has_road
            owner_player_db_id,             // owner_player_id
            owner_city_db_id,               // owner_city_id (NULL for now, set in Pass 2b)
            tile.is_city_site,              // is_city_site
            tile.tribe_site.clone(),        // tribe_site
            tile.religion.clone(),          // religion
            tile.init_seed,                 // init_seed
            tile.turn_seed,                 // turn_seed
        ));
    }

    let initial_tile_count = rows.len();

    // Deduplicate (last-wins strategy)
    // We need to deduplicate by BOTH constraints:
    // 1. Primary key: (tile_id, match_id)
    // 2. Unique index: (match_id, xml_id)

    // First pass: deduplicate by PRIMARY KEY (tile_id, match_id)
    let after_pk_dedup = deduplicate_rows_last_wins(
        rows,
        |(tile_id, match_id, ..)| (*tile_id, *match_id)
    );

    // Second pass: deduplicate by UNIQUE INDEX (match_id, xml_id)
    let unique_tiles = deduplicate_rows_last_wins(
        after_pk_dedup,
        |(_, match_id, xml_id, ..)| (*match_id, *xml_id)
    );

    let tile_duplicates_removed = initial_tile_count - unique_tiles.len();
    if tile_duplicates_removed > 0 {
        log::warn!("Removed {} duplicate tiles during insert_tiles_core (had {}, now {})",
            tile_duplicates_removed, initial_tile_count, unique_tiles.len());
    }

    // Bulk insert deduplicated rows
    let mut app = conn.appender("tiles")?;
    for (db_id, match_id, xml_id, x, y, terrain, height, vegetation, river_w, river_sw, river_se,
         resource, improvement, improvement_pillaged, improvement_disabled, improvement_turns_left,
         improvement_develop_turns, specialist, has_road, owner_player_db_id, owner_city_db_id,
         is_city_site, tribe_site, religion, init_seed, turn_seed) in unique_tiles
    {
        app.append_row(params![
            db_id, match_id, xml_id, x, y, terrain, height, vegetation, river_w, river_sw, river_se,
            resource, improvement, improvement_pillaged, improvement_disabled, improvement_turns_left,
            improvement_develop_turns, specialist, has_road, owner_player_db_id, owner_city_db_id,
            is_city_site, tribe_site, religion, init_seed, turn_seed
        ])?;
    }

    // Flush appender to commit all rows
    drop(app);

    log::info!("Inserted {} tiles (core data only)", tiles.len());
    Ok(())
}
