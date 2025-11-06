// Tile entity parser

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};

/// Parse all tiles from the XML document
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

        // Ownership (filter out -1 for unowned tiles)
        let owner_player_xml_id = tile_node
            .opt_child_text("OwnerPlayer")
            .and_then(|s| s.parse::<i32>().ok())
            .filter(|&id| id >= 0);
        let owner_player_db_id = match owner_player_xml_id {
            Some(id) => Some(id_mapper.get_player(id)?),
            None => None,
        };

        let owner_city_xml_id = tile_node
            .opt_child_text("OwnerCity")
            .and_then(|s| s.parse::<i32>().ok());
        let owner_city_db_id = match owner_city_xml_id {
            Some(id) => {
                // City might not be parsed yet, so we use map instead of get
                Some(id_mapper.map_city(id))
            }
            None => None,
        };

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

    log::info!("Parsed {} tiles", count);
    Ok(count)
}
