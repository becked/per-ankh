// Tile entity parser

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};

/// Parse all tiles from the XML document (Pass 1: Core data only, no ownership history)
pub fn parse_tiles(doc: &XmlDocument, conn: &Connection, id_mapper: &mut IdMapper) -> Result<usize> {
    let root = doc.root_element();
    let mut count = 0;

    // Create appender ONCE before loop
    let mut app = conn.appender("tiles")?;

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
        let terrain = tile_node.opt_child_text("Terrain");
        let height = tile_node.opt_child_text("Height");
        let vegetation = tile_node.opt_child_text("Vegetation");

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
        let resource = tile_node.opt_child_text("Resource");

        // Improvements
        let improvement = tile_node.opt_child_text("Improvement");
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
        let specialist = tile_node.opt_child_text("Specialist");

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
        let tribe_site = tile_node.opt_child_text("TribeSite");

        // Religion
        let religion = tile_node.opt_child_text("Religion");

        // Seeds
        let init_seed = tile_node
            .opt_child_text("InitSeed")
            .and_then(|s| s.parse::<i64>().ok());
        let turn_seed = tile_node
            .opt_child_text("TurnSeed")
            .and_then(|s| s.parse::<i64>().ok());

        // Bulk append - must match schema column order exactly
        app.append_row(params![
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
        ])?;

        count += 1;
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

    let total_count = updates.len();

    // Second pass: batch UPDATE in chunks of 500 for optimal performance
    const BATCH_SIZE: usize = 500;
    for chunk in updates.chunks(BATCH_SIZE) {
        // Build CASE statement for batch UPDATE
        let mut sql = String::from("UPDATE tiles SET owner_city_id = CASE tile_id ");
        let mut tile_ids_for_where = Vec::new();

        for (tile_id, city_id) in chunk {
            sql.push_str(&format!("WHEN {} THEN {} ", tile_id, city_id));
            tile_ids_for_where.push(tile_id.to_string());
        }

        sql.push_str("END WHERE tile_id IN (");
        sql.push_str(&tile_ids_for_where.join(", "));
        sql.push_str(&format!(") AND match_id = {}", id_mapper.match_id));

        conn.execute(&sql, [])?;
    }

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
    let mut count = 0;

    // Create appender for ownership history
    let mut ownership_app = conn.appender("tile_ownership_history")?;

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

                                ownership_app.append_row(params![
                                    tile_db_id,         // tile_id
                                    id_mapper.match_id, // match_id
                                    turn,               // turn
                                    owner_db_id,        // owner_player_id (NULL if -1)
                                ])?;
                                count += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    // Explicitly drop appender to ensure data is flushed
    drop(ownership_app);

    log::info!("Parsed {} tile ownership history records", count);
    Ok(count)
}
