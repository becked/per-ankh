// Tile extended data parsers
//
// Parses tile-specific nested data from Tile XML nodes:
// - Tile visibility (RevealedTurn, RevealedOwner)
// - Tile change history (TerrainHistory, VegetationHistory)
//
// Note: OwnerHistory is handled by tiles.rs -> tile_ownership_history

use crate::parser::game_data::{TileChange, TileVisibility};
use crate::parser::xml_loader::XmlDocument;
use crate::parser::{ParseError, Result};
use roxmltree::Node;

/// Parse tile visibility data from all Tile elements
///
/// Extracts RevealedTurn and RevealedOwner data tracking when each team
/// revealed tiles and what owner they saw.
pub fn parse_tile_visibility_struct(doc: &XmlDocument) -> Result<Vec<TileVisibility>> {
    let root = doc.root_element();
    let mut visibility_records = Vec::new();

    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        let tile_xml_id: i32 = tile_node
            .attribute("ID")
            .ok_or_else(|| ParseError::MissingAttribute("Tile.ID".to_string()))?
            .parse()
            .map_err(|_| ParseError::InvalidFormat("Tile.ID must be integer".to_string()))?;

        visibility_records.extend(parse_tile_visibility_for_tile(&tile_node, tile_xml_id)?);
    }

    Ok(visibility_records)
}

/// Parse visibility data for a single tile
fn parse_tile_visibility_for_tile(
    tile_node: &Node,
    tile_xml_id: i32,
) -> Result<Vec<TileVisibility>> {
    let mut records = Vec::new();

    // Parse RevealedTurn element
    let revealed_turns = if let Some(revealed_node) = tile_node
        .children()
        .find(|n| n.has_tag_name("RevealedTurn"))
    {
        revealed_node
            .children()
            .filter(|n| n.is_element())
            .filter_map(|team_node| {
                let team_tag = team_node.tag_name().name(); // "TEAM_0"
                let team_id: i32 = team_tag.strip_prefix("TEAM_")?.parse().ok()?;
                let revealed_turn: i32 = team_node.text()?.parse().ok()?;
                Some((team_id, revealed_turn))
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    // Parse RevealedOwner element
    let revealed_owners = if let Some(owner_node) = tile_node
        .children()
        .find(|n| n.has_tag_name("RevealedOwner"))
    {
        owner_node
            .children()
            .filter(|n| n.is_element())
            .filter_map(|team_node| {
                let team_tag = team_node.tag_name().name(); // "TEAM_0"
                let team_id: i32 = team_tag.strip_prefix("TEAM_")?.parse().ok()?;
                let owner_id: i32 = team_node.text()?.parse().ok()?;
                Some((team_id, owner_id))
            })
            .collect::<std::collections::HashMap<i32, i32>>()
    } else {
        std::collections::HashMap::new()
    };

    // Create visibility records for each team
    for (team_id, revealed_turn) in revealed_turns {
        let visible_owner = revealed_owners.get(&team_id).copied();

        records.push(TileVisibility {
            tile_xml_id,
            team_id,
            revealed_turn,
            visible_owner_player_xml_id: visible_owner,
        });
    }

    Ok(records)
}

/// Parse tile change history from all Tile elements
///
/// Extracts TerrainHistory and VegetationHistory tracking changes to
/// tile properties over time using sparse <TX> format.
pub fn parse_tile_changes_struct(doc: &XmlDocument) -> Result<Vec<TileChange>> {
    let root = doc.root_element();
    let mut changes = Vec::new();

    for tile_node in root.children().filter(|n| n.has_tag_name("Tile")) {
        let tile_xml_id: i32 = tile_node
            .attribute("ID")
            .ok_or_else(|| ParseError::MissingAttribute("Tile.ID".to_string()))?
            .parse()
            .map_err(|_| ParseError::InvalidFormat("Tile.ID must be integer".to_string()))?;

        changes.extend(parse_tile_changes_for_tile(&tile_node, tile_xml_id)?);
    }

    Ok(changes)
}

/// Parse change history for a single tile
fn parse_tile_changes_for_tile(tile_node: &Node, tile_xml_id: i32) -> Result<Vec<TileChange>> {
    let mut changes = Vec::new();

    // Parse TerrainHistory
    if let Some(terrain_history) = tile_node
        .children()
        .find(|n| n.has_tag_name("TerrainHistory"))
    {
        for turn_node in terrain_history.children().filter(|n| n.is_element()) {
            let turn_tag = turn_node.tag_name().name();
            if let Some(turn_str) = turn_tag.strip_prefix('T') {
                let turn: i32 = turn_str.parse().map_err(|_| {
                    ParseError::InvalidFormat(format!("Invalid turn tag: {}", turn_tag))
                })?;

                let new_terrain = turn_node
                    .text()
                    .ok_or_else(|| {
                        ParseError::MissingElement(format!("TerrainHistory.{}", turn_tag))
                    })?
                    .to_string();

                changes.push(TileChange {
                    tile_xml_id,
                    turn,
                    change_type: "terrain".to_string(),
                    new_value: new_terrain,
                });
            }
        }
    }

    // Parse VegetationHistory
    if let Some(vegetation_history) = tile_node
        .children()
        .find(|n| n.has_tag_name("VegetationHistory"))
    {
        for turn_node in vegetation_history.children().filter(|n| n.is_element()) {
            let turn_tag = turn_node.tag_name().name();
            if let Some(turn_str) = turn_tag.strip_prefix('T') {
                let turn: i32 = turn_str.parse().map_err(|_| {
                    ParseError::InvalidFormat(format!("Invalid turn tag: {}", turn_tag))
                })?;

                let new_vegetation = turn_node
                    .text()
                    .ok_or_else(|| {
                        ParseError::MissingElement(format!("VegetationHistory.{}", turn_tag))
                    })?
                    .to_string();

                changes.push(TileChange {
                    tile_xml_id,
                    turn,
                    change_type: "vegetation".to_string(),
                    new_value: new_vegetation,
                });
            }
        }
    }

    Ok(changes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_tile_visibility_basic() {
        let xml = r#"<Root>
            <Tile ID="0">
                <RevealedTurn>
                    <TEAM_0>2</TEAM_0>
                    <TEAM_1>5</TEAM_1>
                </RevealedTurn>
                <RevealedOwner>
                    <TEAM_0>0</TEAM_0>
                </RevealedOwner>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let visibility = parse_tile_visibility_struct(&doc).unwrap();

        assert_eq!(visibility.len(), 2);
        assert_eq!(visibility[0].tile_xml_id, 0);
        assert_eq!(visibility[0].team_id, 0);
        assert_eq!(visibility[0].revealed_turn, 2);
        assert_eq!(visibility[0].visible_owner_player_xml_id, Some(0));

        assert_eq!(visibility[1].team_id, 1);
        assert_eq!(visibility[1].revealed_turn, 5);
        assert_eq!(visibility[1].visible_owner_player_xml_id, None);
    }

    #[test]
    fn test_parse_tile_visibility_empty() {
        let xml = r#"<Root>
            <Tile ID="0">
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let visibility = parse_tile_visibility_struct(&doc).unwrap();

        assert_eq!(visibility.len(), 0);
    }

    #[test]
    fn test_parse_tile_changes_basic() {
        let xml = r#"<Root>
            <Tile ID="0">
                <TerrainHistory>
                    <T5>TERRAIN_TEMPERATE</T5>
                    <T10>TERRAIN_ARID</T10>
                </TerrainHistory>
                <VegetationHistory>
                    <T15>VEGETATION_TREES</T15>
                </VegetationHistory>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let changes = parse_tile_changes_struct(&doc).unwrap();

        assert_eq!(changes.len(), 3);

        // First terrain change
        assert_eq!(changes[0].tile_xml_id, 0);
        assert_eq!(changes[0].turn, 5);
        assert_eq!(changes[0].change_type, "terrain");
        assert_eq!(changes[0].new_value, "TERRAIN_TEMPERATE");

        // Second terrain change
        assert_eq!(changes[1].turn, 10);
        assert_eq!(changes[1].change_type, "terrain");
        assert_eq!(changes[1].new_value, "TERRAIN_ARID");

        // Vegetation change
        assert_eq!(changes[2].turn, 15);
        assert_eq!(changes[2].change_type, "vegetation");
        assert_eq!(changes[2].new_value, "VEGETATION_TREES");
    }

    #[test]
    fn test_parse_tile_changes_empty() {
        let xml = r#"<Root>
            <Tile ID="0">
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let changes = parse_tile_changes_struct(&doc).unwrap();

        assert_eq!(changes.len(), 0);
    }

    #[test]
    fn test_parse_multiple_tiles() {
        let xml = r#"<Root>
            <Tile ID="0">
                <RevealedTurn>
                    <TEAM_0>1</TEAM_0>
                </RevealedTurn>
            </Tile>
            <Tile ID="1">
                <RevealedTurn>
                    <TEAM_0>2</TEAM_0>
                </RevealedTurn>
            </Tile>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let visibility = parse_tile_visibility_struct(&doc).unwrap();

        assert_eq!(visibility.len(), 2);
        assert_eq!(visibility[0].tile_xml_id, 0);
        assert_eq!(visibility[1].tile_xml_id, 1);
    }
}
