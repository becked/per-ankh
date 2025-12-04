// Tiles parser - pure parsing without database dependency

use crate::parser::game_data::TileData;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;

/// Parse tiles to structs (no DB dependency)
/// Returns (tiles, map_width) tuple - map_width needed for coordinate calculation
pub fn parse_tiles_struct(doc: &XmlDocument) -> Result<Vec<TileData>> {
    let root = doc.root_element();
    let mut tiles = Vec::new();

    // Get map dimensions from root attributes (needed for coordinate calculation)
    let map_width = root.req_attr("MapWidth")?.parse::<i32>()?;

    // Find all Tile elements as direct children of Root
    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        let xml_id = tile_node.req_attr("ID")?.parse::<i32>()?;

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

        // Specialists
        let specialist = tile_node.opt_child_text("Specialist").map(|s| s.to_string());

        // Infrastructure - Road element presence indicates a road exists
        let has_road = tile_node.children().any(|n| n.has_tag_name("Road"));

        // Parse ownership history to derive current owner
        // Note: Ownership history itself is NOT inserted here - it will be inserted in Pass 2c
        let mut owner_player_xml_id = None;
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

            // Set current owner from latest history entry (filter out negative values)
            if let Some(owner_xml_id) = latest_owner_xml_id {
                if owner_xml_id >= 0 {
                    owner_player_xml_id = Some(owner_xml_id);
                }
            }
        }

        // Sites
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

        tiles.push(TileData {
            xml_id,
            x,
            y,
            terrain,
            height,
            vegetation,
            river_w,
            river_sw,
            river_se,
            resource,
            improvement,
            improvement_pillaged,
            improvement_disabled,
            improvement_turns_left,
            specialist,
            has_road,
            owner_player_xml_id,
            tribe_site,
            religion,
            init_seed,
            turn_seed,
        });
    }

    Ok(tiles)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_tiles_struct_basic() {
        let xml = r#"<Root GameId="test-123" MapWidth="10">
            <Tile ID="0">
                <Terrain>TERRAIN_PLAINS</Terrain>
                <Height>HEIGHT_FLAT</Height>
                <Vegetation>VEGETATION_GRASS</Vegetation>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let tiles = parse_tiles_struct(&doc).unwrap();

        assert_eq!(tiles.len(), 1);
        assert_eq!(tiles[0].xml_id, 0);
        assert_eq!(tiles[0].x, 0);
        assert_eq!(tiles[0].y, 0);
        assert_eq!(tiles[0].terrain, Some("TERRAIN_PLAINS".to_string()));
    }

    #[test]
    fn test_parse_tiles_struct_coordinates() {
        // Map width = 10, so tile ID 23 = x=3, y=2 (23 = 2*10 + 3)
        let xml = r#"<Root GameId="test-123" MapWidth="10">
            <Tile ID="23">
                <Terrain>TERRAIN_DESERT</Terrain>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let tiles = parse_tiles_struct(&doc).unwrap();

        assert_eq!(tiles.len(), 1);
        assert_eq!(tiles[0].xml_id, 23);
        assert_eq!(tiles[0].x, 3);
        assert_eq!(tiles[0].y, 2);
    }

    #[test]
    fn test_parse_tiles_struct_rivers_and_improvements() {
        let xml = r#"<Root GameId="test-123" MapWidth="10">
            <Tile ID="0">
                <RiverW>true</RiverW>
                <RiverSW>false</RiverSW>
                <RiverSE>true</RiverSE>
                <Improvement>IMPROVEMENT_FARM</Improvement>
                <ImprovementPillaged>false</ImprovementPillaged>
                <Road />
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let tiles = parse_tiles_struct(&doc).unwrap();

        assert_eq!(tiles.len(), 1);
        assert_eq!(tiles[0].river_w, true);
        assert_eq!(tiles[0].river_sw, false);
        assert_eq!(tiles[0].river_se, true);
        assert_eq!(tiles[0].improvement, Some("IMPROVEMENT_FARM".to_string()));
        assert_eq!(tiles[0].improvement_pillaged, false);
        assert_eq!(tiles[0].has_road, true);
    }

    #[test]
    fn test_parse_tiles_struct_no_road() {
        let xml = r#"<Root GameId="test-123" MapWidth="10">
            <Tile ID="0">
                <Terrain>TERRAIN_PLAINS</Terrain>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let tiles = parse_tiles_struct(&doc).unwrap();

        assert_eq!(tiles.len(), 1);
        assert_eq!(tiles[0].has_road, false);
    }
}
