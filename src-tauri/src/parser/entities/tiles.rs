// Tile entity parser

use crate::parser::id_mapper::IdMapper;
use crate::parser::utils::deduplicate_rows_last_wins;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};

/// Parse all tiles from the XML document (Pass 1: Core data only, no ownership history)
pub fn parse_tiles(doc: &XmlDocument, conn: &Connection, id_mapper: &mut IdMapper) -> Result<usize> {
    let root = doc.root_element();

    // DIAGNOSTIC: Check if there's any existing data for this match_id before we start
    let existing_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tiles WHERE match_id = ?",
        [id_mapper.match_id],
        |row| row.get(0),
    )?;
    if existing_count > 0 {
        log::error!("CRITICAL: Found {} existing tiles for match_id {} BEFORE parse_tiles! Transaction rollback may have failed!",
            existing_count, id_mapper.match_id);
    }

    // Collect all tile rows first
    let mut tiles = Vec::new();

    // Get map dimensions from root attributes
    let map_width = root.req_attr("MapWidth")?.parse::<i32>()?;

    // Find all Tile elements as direct children of Root
    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        let xml_id = tile_node.req_attr("ID")?.parse::<i32>()?;
        let db_id = id_mapper.map_tile(xml_id);

        // Calculate coordinates from tile ID and map width
        // Tiles are indexed sequentially: tile_id = y * map_width + x
        let x = xml_id % map_width;
        let y = xml_id / map_width;

        // Terrain
        let terrain = tile_node.opt_child_text("Terrain").map(|s| s.to_string());
        let height = tile_node.opt_child_text("Height").map(|s| s.to_string());
        let vegetation = tile_node.opt_child_text("Vegetation").map(|s| s.to_string());

        // Rivers (boolean flags for hex directions)
        let river_w = tile_node
            .opt_child_text("RiverW")
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);
        let river_sw = tile_node
            .opt_child_text("RiverSW")
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);
        let river_se = tile_node
            .opt_child_text("RiverSE")
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);

        // Resources
        let resource = tile_node.opt_child_text("Resource").map(|s| s.to_string());

        // Improvements
        let improvement = tile_node.opt_child_text("Improvement").map(|s| s.to_string());
        let improvement_pillaged = tile_node
            .opt_child_text("ImprovementPillaged")
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);
        let improvement_disabled = tile_node
            .opt_child_text("ImprovementDisabled")
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);
        let improvement_turns_left = tile_node
            .opt_child_text("ImprovementTurnsLeft")
            .and_then(|s| s.parse::<i32>().ok());
        let improvement_develop_turns = tile_node
            .opt_child_text("ImprovementDevelopTurns")
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(0);

        // Specialists
        let specialist = tile_node.opt_child_text("Specialist").map(|s| s.to_string());

        // Infrastructure
        let has_road = tile_node
            .opt_child_text("HasRoad")
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);

        // City ownership (which city's territory this tile belongs to)
        // NOTE: owner_city_id is NOT set here because cities haven't been parsed yet.
        // It will be populated in a second pass after cities are created (see import.rs).
        let owner_city_db_id: Option<i32> = None;

        // Parse ownership history to derive current owner
        // NOTE: Ownership history is NOT inserted here - it will be inserted in a separate pass
        // after cities are created and tile city ownership is set (see parse_tile_ownership_history).
        let mut owner_player_db_id = None;
        if let Some(history_node) = tile_node.children().find(|n| n.has_tag_name("OwnerHistory")) {
            let mut max_turn = -1;
            let mut latest_owner_xml_id = None;

            // Find the latest ownership change to set current owner
            for turn_node in history_node.children() {
                if let Some(tag_name) = turn_node.tag_name().name().strip_prefix('T') {
                    if let Ok(turn) = tag_name.parse::<i32>() {
                        if let Some(text) = turn_node.text() {
                            if let Ok(owner_xml_id) = text.parse::<i32>() {
                                // Track latest ownership change
                                if turn > max_turn {
                                    max_turn = turn;
                                    latest_owner_xml_id = Some(owner_xml_id);
                                }
                            }
                        }
                    }
                }
            }

            // Set current owner from latest history entry
            if let Some(owner_xml_id) = latest_owner_xml_id {
                if owner_xml_id >= 0 {
                    owner_player_db_id = Some(id_mapper.get_player(owner_xml_id)?);
                }
            }
        }

        // Sites
        let is_city_site = tile_node
            .opt_child_text("IsCitySite")
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);
        let tribe_site = tile_node.opt_child_text("TribeSite").map(|s| s.to_string());

        // Religion
        let religion = tile_node.opt_child_text("Religion").map(|s| s.to_string());

        // Seeds
        let init_seed = tile_node
            .opt_child_text("InitSeed")
            .and_then(|s| s.parse::<i64>().ok());
        let turn_seed = tile_node
            .opt_child_text("TurnSeed")
            .and_then(|s| s.parse::<i64>().ok());

        // Collect row data - must match schema column order exactly
        tiles.push((
            db_id,                      // tile_id
            id_mapper.match_id,         // match_id
            xml_id,                     // xml_id
            x,                          // x
            y,                          // y
            terrain,                    // terrain
            height,                     // height
            vegetation,                 // vegetation
            river_w,                    // river_w
            river_sw,                   // river_sw
            river_se,                   // river_se
            resource,                   // resource
            improvement,                // improvement
            improvement_pillaged,       // improvement_pillaged
            improvement_disabled,       // improvement_disabled
            improvement_turns_left,     // improvement_turns_left
            improvement_develop_turns,  // improvement_develop_turns
            specialist,                 // specialist
            has_road,                   // has_road
            owner_player_db_id,         // owner_player_id
            owner_city_db_id,           // owner_city_id
            is_city_site,               // is_city_site
            tribe_site,                 // tribe_site
            religion,                   // religion
            init_seed,                  // init_seed
            turn_seed,                  // turn_seed
        ));
    }

    // Deduplicate (last-wins strategy)
    // We need to deduplicate by BOTH constraints:
    // 1. Primary key: (tile_id, match_id)
    // 2. Unique index: (match_id, xml_id)
    let initial_tile_count = tiles.len();

    // First pass: deduplicate by PRIMARY KEY (tile_id, match_id)
    let after_pk_dedup = deduplicate_rows_last_wins(
        tiles,
        |(tile_id, match_id, ..)| (*tile_id, *match_id)
    );

    // Second pass: deduplicate by UNIQUE INDEX (match_id, xml_id)
    let unique_tiles = deduplicate_rows_last_wins(
        after_pk_dedup,
        |(_, match_id, xml_id, ..)| (*match_id, *xml_id)
    );

    let count = unique_tiles.len();
    let tile_duplicates_removed = initial_tile_count - count;
    if tile_duplicates_removed > 0 {
        log::warn!("Removed {} duplicate tiles during parse_tiles (had {}, now {})",
            tile_duplicates_removed, initial_tile_count, count);
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

    // Explicitly drop appender to ensure data is flushed
    drop(app);

    log::info!("Parsed {} tiles (core data only)", count);
    Ok(count)
}

/// Update tile city ownership (Pass 2 - called after cities are parsed)
///
/// This function must be called AFTER cities have been inserted into the database.
/// It populates the owner_city_id field in the tiles table by parsing the CityTerritory
/// elements from the XML.
///
/// Uses batched UPDATEs for better performance (5-10x faster than individual UPDATEs).
pub fn update_tile_city_ownership(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &IdMapper,
) -> Result<usize> {
    // Diagnostic: Check for duplicate tiles in database
    log::info!("Running duplicate check for match_id {}", id_mapper.match_id);

    let total_tiles: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tiles WHERE match_id = ?",
        [id_mapper.match_id],
        |row| row.get(0),
    )?;

    log::info!("Total tiles in database for this match: {}", total_tiles);

    let duplicate_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM (
            SELECT tile_id, COUNT(*) as cnt
            FROM tiles
            WHERE match_id = ?
            GROUP BY tile_id
            HAVING COUNT(*) > 1
        )",
        [id_mapper.match_id],
        |row| row.get(0),
    )?;

    log::info!("Duplicate tile_ids found: {}", duplicate_count);

    if duplicate_count > 0 {
        log::error!("CRITICAL: Found {} duplicate tile_id values in tiles table before UPDATE!", duplicate_count);

        // Get details of duplicates
        let mut stmt = conn.prepare(
            "SELECT tile_id, COUNT(*) as cnt
             FROM tiles
             WHERE match_id = ?
             GROUP BY tile_id
             HAVING COUNT(*) > 1
             LIMIT 10"
        )?;
        let duplicates: Vec<(i32, i64)> = stmt.query_map([id_mapper.match_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?.collect::<std::result::Result<Vec<_>, _>>()?;

        for (tile_id, count) in duplicates {
            log::error!("  Duplicate tile_id {} appears {} times", tile_id, count);
        }

        return Err(ParseError::InvalidFormat(
            format!("Database has {} duplicate tiles for match_id {}", duplicate_count, id_mapper.match_id)
        ));
    }

    let root = doc.root_element();

    // First pass: collect all tile-city ownership mappings
    let mut updates = Vec::new();
    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        if let Some(city_territory_str) = tile_node.opt_child_text("CityTerritory") {
            if let Ok(city_xml_id) = city_territory_str.parse::<i32>() {
                let tile_xml_id = tile_node.req_attr("ID")?.parse::<i32>()?;
                let tile_db_id = id_mapper.get_tile(tile_xml_id)?;
                let city_db_id = id_mapper.get_city(city_xml_id)?;
                updates.push((tile_db_id, city_db_id));
            }
        }
    }

    log::info!("Collected {} tile ownership mappings from XML", updates.len());

    // Deduplicate by tile_id (last-wins strategy)
    // This handles duplicate Tile elements in XML with the same ID
    let initial_count = updates.len();
    let unique_updates = deduplicate_rows_last_wins(
        updates,
        |(tile_id, _)| *tile_id
    );

    let total_count = unique_updates.len();
    let duplicates_removed = initial_count - total_count;

    log::info!("After deduplication: {} unique tile ownership mappings ({} duplicates removed)",
        total_count, duplicates_removed);

    // Verify uniqueness
    use std::collections::HashSet;
    let mut seen = HashSet::new();
    for (tile_id, _) in &unique_updates {
        if !seen.insert(tile_id) {
            log::error!("CRITICAL: Deduplication failed! tile_id {} appears multiple times in unique_updates!", tile_id);
            return Err(ParseError::InvalidFormat(
                format!("Deduplication failed for tile_id {}", tile_id)
            ));
        }
    }
    log::info!("Uniqueness verified: all tile_ids are unique in update list");

    // Second pass: UPDATE tiles with owner_city_id using INSERT ON CONFLICT (UPSERT)
    // This approach uses INSERT code path instead of UPDATE path, avoiding DuckDB MVCC bugs
    // that affected UPDATE FROM and CASE UPDATE approaches with composite PRIMARY KEYs.
    // Achieves 8-12x speedup in release mode via bulk Appender + single query execution.
    let start = std::time::Instant::now();

    // Create temporary table for bulk updates
    conn.execute(
        "CREATE TEMP TABLE tile_ownership_updates (tile_id INTEGER, owner_city_id INTEGER)",
        []
    )?;

    // Bulk insert using DuckDB Appender (10-20x faster than individual INSERTs)
    let mut app = conn.appender("tile_ownership_updates")?;
    for (tile_id, city_id) in &unique_updates {
        app.append_row(params![*tile_id, *city_id])?;
    }
    drop(app); // Flush data

    // UPSERT: Insert with ON CONFLICT to update owner_city_id
    // Uses composite PRIMARY KEY (tile_id, match_id) for conflict detection
    conn.execute(
        "INSERT INTO tiles (tile_id, match_id, owner_city_id)
         SELECT u.tile_id, ?, u.owner_city_id
         FROM tile_ownership_updates u
         ON CONFLICT (tile_id, match_id)
         DO UPDATE SET owner_city_id = EXCLUDED.owner_city_id",
        params![id_mapper.match_id]
    )?;

    // Cleanup temporary table
    conn.execute("DROP TABLE tile_ownership_updates", [])?;

    log::debug!("Tile ownership update took {:?}", start.elapsed());

    log::info!("Updated {} tiles with city ownership", total_count);
    Ok(total_count)
}

/// Parse tile ownership history (Pass 3 - called after tile city ownership is updated)
///
/// This function must be called AFTER tiles have been fully populated with city ownership.
/// It inserts records into the tile_ownership_history table.
pub fn parse_tile_ownership_history(
    doc: &XmlDocument,
    conn: &Connection,
    id_mapper: &IdMapper,
) -> Result<usize> {
    let root = doc.root_element();

    // Collect all ownership history records first
    let mut history_records = Vec::new();

    // Find all Tile elements with OwnerHistory
    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        let tile_xml_id = tile_node.req_attr("ID")?.parse::<i32>()?;
        let tile_db_id = id_mapper.get_tile(tile_xml_id)?;

        if let Some(history_node) = tile_node.children().find(|n| n.has_tag_name("OwnerHistory")) {
            // Parse all ownership changes
            for turn_node in history_node.children() {
                if let Some(tag_name) = turn_node.tag_name().name().strip_prefix('T') {
                    if let Ok(turn) = tag_name.parse::<i32>() {
                        if let Some(text) = turn_node.text() {
                            if let Ok(owner_xml_id) = text.parse::<i32>() {
                                // Insert into ownership history (-1 means unowned)
                                let owner_db_id = if owner_xml_id >= 0 {
                                    Some(id_mapper.get_player(owner_xml_id)?)
                                } else {
                                    None
                                };

                                history_records.push((
                                    tile_db_id,         // tile_id
                                    id_mapper.match_id, // match_id
                                    turn,               // turn
                                    owner_db_id,        // owner_player_id (NULL if -1)
                                ));
                            }
                        }
                    }
                }
            }
        }
    }

    // Deduplicate by primary key (tile_id, match_id, turn)
    let unique_records = deduplicate_rows_last_wins(
        history_records,
        |(tile_id, match_id, turn, _)| (*tile_id, *match_id, *turn)
    );

    let count = unique_records.len();

    // Bulk insert deduplicated records
    let mut ownership_app = conn.appender("tile_ownership_history")?;
    for (tile_db_id, match_id, turn, owner_db_id) in unique_records {
        ownership_app.append_row(params![tile_db_id, match_id, turn, owner_db_id])?;
    }

    // Explicitly drop appender to ensure data is flushed
    drop(ownership_app);

    log::info!("Parsed {} tile ownership history records", count);
    Ok(count)
}
