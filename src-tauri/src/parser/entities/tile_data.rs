// Tile extended data parsers
//
// This module handles parsing of tile-specific nested data:
// - Tile visibility (RevealedTurn, RevealedOwner) -> tile_visibility table
// - Tile history (OwnerHistory, TerrainHistory, etc.) -> tile_changes table
//
// XML Structure:
// ```xml
// <Tile ID="0" X="10" Y="5">
//   <RevealedTurn>
//     <TEAM_0>2</TEAM_0>
//     <TEAM_1>5</TEAM_1>
//   </RevealedTurn>
//   <RevealedOwner>
//     <TEAM_0>0</TEAM_0>
//   </RevealedOwner>
//   <OwnerHistory>
//     <T10>0</T10>
//     <T25>1</T25>
//   </OwnerHistory>
//   <TerrainHistory>
//     <T5>TERRAIN_TEMPERATE</T5>
//   </TerrainHistory>
//   <VegetationHistory>
//     <T15>VEGETATION_TREES</T15>
//   </VegetationHistory>
// </Tile>
// ```

use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};
use roxmltree::Node;

/// Parse tile visibility data (RevealedTurn, RevealedOwner)
///
/// Tracks when each team revealed this tile and what owner they saw.
///
/// # Schema
/// ```sql
/// CREATE TABLE tile_visibility (
///     tile_id INTEGER NOT NULL,
///     match_id BIGINT NOT NULL,
///     team_id INTEGER NOT NULL,
///     revealed_turn INTEGER,
///     visible_owner_player_id INTEGER,
///     PRIMARY KEY (tile_id, match_id, team_id)
/// );
/// ```
pub fn parse_tile_visibility(
    tile_node: &Node,
    conn: &Connection,
    tile_id: i64,
    match_id: i64,
) -> Result<usize> {
    let mut count = 0;

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

    // Insert visibility records for each team
    for (team_id, revealed_turn) in revealed_turns {
        let visible_owner = revealed_owners.get(&team_id).copied();

        conn.execute(
            "INSERT INTO tile_visibility
             (tile_id, match_id, team_id, revealed_turn, last_seen_turn,
              visible_terrain, visible_height, visible_vegetation,
              visible_improvement, visible_owner_player_id)
             VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)
             ON CONFLICT (tile_id, match_id, team_id)
             DO UPDATE SET
                 revealed_turn = excluded.revealed_turn,
                 visible_owner_player_id = excluded.visible_owner_player_id",
            params![tile_id, match_id, team_id, revealed_turn, visible_owner],
        )?;
        count += 1;
    }

    Ok(count)
}

/// Parse tile history data (OwnerHistory, TerrainHistory, VegetationHistory)
///
/// Tracks changes to tile properties over time using sparse <TX> format.
///
/// # Schema
/// ```sql
/// CREATE TABLE tile_changes (
///     change_id BIGINT NOT NULL PRIMARY KEY,
///     tile_id INTEGER NOT NULL,
///     match_id BIGINT NOT NULL,
///     turn INTEGER NOT NULL,
///     change_type VARCHAR NOT NULL,
///     old_value VARCHAR,
///     new_value VARCHAR
/// );
/// ```
pub fn parse_tile_history(
    tile_node: &Node,
    conn: &Connection,
    tile_id: i64,
    match_id: i64,
    next_change_id: &mut i64,
) -> Result<usize> {
    let mut count = 0;

    // Parse OwnerHistory
    if let Some(owner_history) = tile_node
        .children()
        .find(|n| n.has_tag_name("OwnerHistory"))
    {
        for turn_node in owner_history.children().filter(|n| n.is_element()) {
            let turn_tag = turn_node.tag_name().name();
            if let Some(turn_str) = turn_tag.strip_prefix('T') {
                let turn: i32 = turn_str.parse().map_err(|_| {
                    ParseError::InvalidFormat(format!("Invalid turn tag: {}", turn_tag))
                })?;

                let new_owner = turn_node
                    .text()
                    .ok_or_else(|| ParseError::MissingElement(format!("OwnerHistory.{}", turn_tag)))?;

                let change_id = *next_change_id;
                *next_change_id += 1;

                conn.execute(
                    "INSERT INTO tile_changes
                     (change_id, tile_id, match_id, turn, change_type, old_value, new_value)
                     VALUES (?, ?, ?, ?, 'owner', NULL, ?)",
                    params![change_id, tile_id, match_id, turn, new_owner],
                )?;
                count += 1;
            }
        }
    }

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

                let new_terrain = turn_node.text().ok_or_else(|| {
                    ParseError::MissingElement(format!("TerrainHistory.{}", turn_tag))
                })?;

                let change_id = *next_change_id;
                *next_change_id += 1;

                conn.execute(
                    "INSERT INTO tile_changes
                     (change_id, tile_id, match_id, turn, change_type, old_value, new_value)
                     VALUES (?, ?, ?, ?, 'terrain', NULL, ?)",
                    params![change_id, tile_id, match_id, turn, new_terrain],
                )?;
                count += 1;
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

                let new_vegetation = turn_node.text().ok_or_else(|| {
                    ParseError::MissingElement(format!("VegetationHistory.{}", turn_tag))
                })?;

                let change_id = *next_change_id;
                *next_change_id += 1;

                conn.execute(
                    "INSERT INTO tile_changes
                     (change_id, tile_id, match_id, turn, change_type, old_value, new_value)
                     VALUES (?, ?, ?, ?, 'vegetation', NULL, ?)",
                    params![change_id, tile_id, match_id, turn, new_vegetation],
                )?;
                count += 1;
            }
        }
    }

    Ok(count)
}

/// Parse all tile extended data for a single tile
///
/// This is a convenience function that calls all tile data parsers.
pub fn parse_tile_extended_data(
    tile_node: &Node,
    conn: &Connection,
    tile_id: i64,
    match_id: i64,
    next_change_id: &mut i64,
) -> Result<(usize, usize)> {
    let visibility_count = parse_tile_visibility(tile_node, conn, tile_id, match_id)?;
    let history_count = parse_tile_history(tile_node, conn, tile_id, match_id, next_change_id)?;

    Ok((visibility_count, history_count))
}

#[cfg(test)]
mod tests {
    use super::*;
    use roxmltree::Document;

    #[test]
    fn test_parse_tile_visibility_structure() {
        let xml = r#"
            <Tile ID="0">
                <RevealedTurn>
                    <TEAM_0>2</TEAM_0>
                    <TEAM_1>5</TEAM_1>
                </RevealedTurn>
                <RevealedOwner>
                    <TEAM_0>0</TEAM_0>
                </RevealedOwner>
            </Tile>
        "#;

        let doc = Document::parse(xml).unwrap();
        let tile_node = doc.root_element();

        let revealed = tile_node
            .children()
            .find(|n| n.has_tag_name("RevealedTurn"))
            .unwrap();
        assert_eq!(revealed.children().filter(|n| n.is_element()).count(), 2);
    }

    #[test]
    fn test_parse_tile_history_structure() {
        let xml = r#"
            <Tile ID="0">
                <OwnerHistory>
                    <T10>0</T10>
                    <T25>1</T25>
                </OwnerHistory>
                <TerrainHistory>
                    <T5>TERRAIN_TEMPERATE</T5>
                </TerrainHistory>
            </Tile>
        "#;

        let doc = Document::parse(xml).unwrap();
        let tile_node = doc.root_element();

        let owner_history = tile_node
            .children()
            .find(|n| n.has_tag_name("OwnerHistory"))
            .unwrap();
        assert_eq!(
            owner_history.children().filter(|n| n.is_element()).count(),
            2
        );

        let terrain_history = tile_node
            .children()
            .find(|n| n.has_tag_name("TerrainHistory"))
            .unwrap();
        assert_eq!(
            terrain_history.children().filter(|n| n.is_element()).count(),
            1
        );
    }
}
