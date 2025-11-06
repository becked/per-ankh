// Time-series data parsers for historical turn-by-turn data
//
// This module handles parsing of sparse time-series data from:
// - Game level: YieldPriceHistory
// - Player level: MilitaryPowerHistory, PointsHistory, LegitimacyHistory,
//                 YieldRateHistory, FamilyOpinionHistory, ReligionOpinionHistory
//
// XML Format (sparse):
// ```xml
// <MilitaryPowerHistory>
//   <T2>40</T2>
//   <T5>55</T5>
//   <T18>120</T18>
// </MilitaryPowerHistory>
// ```
//
// Each element is named <TX> where X is the turn number, and the text content
// is the value for that turn. Only turns with data are stored (sparse format).

use crate::parser::id_mapper::IdMapper;
use crate::parser::xml_loader::XmlNodeExt;
use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};
use roxmltree::Node;

/// Parse sparse time-series data from a parent element
///
/// # Arguments
/// * `parent_node` - The parent node to search for the history element
/// * `element_name` - Name of the history element (e.g., "MilitaryPowerHistory")
///
/// # Returns
/// Vector of (turn, value) tuples in the order they appear in XML
///
/// # XML Example
/// ```xml
/// <Player ID="0">
///   <MilitaryPowerHistory>
///     <T2>40</T2>
///     <T3>40</T3>
///     <T5>55</T5>
///   </MilitaryPowerHistory>
/// </Player>
/// ```
fn parse_sparse_history(parent_node: &Node, element_name: &str) -> Result<Vec<(i32, i32)>> {
    let mut data = Vec::new();

    if let Some(history_node) = parent_node
        .children()
        .find(|n| n.has_tag_name(element_name))
    {
        for turn_node in history_node.children().filter(|n| n.is_element()) {
            let turn_tag = turn_node.tag_name().name(); // "T45"
            if !turn_tag.starts_with('T') {
                continue;
            }

            let turn: i32 = turn_tag[1..]
                .parse()
                .map_err(|_| ParseError::InvalidFormat(format!("Invalid turn tag: {}", turn_tag)))?;

            let value: i32 = turn_node
                .text()
                .ok_or_else(|| {
                    ParseError::MissingElement(format!("{}.<{}>", element_name, turn_tag))
                })?
                .parse()
                .map_err(|_| ParseError::InvalidFormat(format!("Invalid integer in {}", turn_tag)))?;

            data.push((turn, value));
        }
    }

    Ok(data)
}

/// Parse sparse time-series data with nested type categories
///
/// # Arguments
/// * `parent_node` - The parent node to search for the history element
/// * `element_name` - Name of the history element (e.g., "YieldRateHistory")
///
/// # Returns
/// Vector of (type_name, turn, value) tuples
///
/// # XML Example
/// ```xml
/// <YieldRateHistory>
///   <YIELD_GROWTH>
///     <T2>10</T2>
///     <T5>15</T5>
///   </YIELD_GROWTH>
///   <YIELD_CIVICS>
///     <T2>5</T2>
///   </YIELD_CIVICS>
/// </YieldRateHistory>
/// ```
fn parse_sparse_history_by_type(
    parent_node: &Node,
    element_name: &str,
) -> Result<Vec<(String, i32, i32)>> {
    let mut data = Vec::new();

    if let Some(history_node) = parent_node
        .children()
        .find(|n| n.has_tag_name(element_name))
    {
        // Iterate over type categories (YIELD_GROWTH, etc.)
        for type_node in history_node.children().filter(|n| n.is_element()) {
            let type_name = type_node.tag_name().name().to_string();

            // Iterate over turn elements (T2, T45, etc.)
            for turn_node in type_node.children().filter(|n| n.is_element()) {
                let turn_tag = turn_node.tag_name().name();
                if !turn_tag.starts_with('T') {
                    continue; // Skip non-turn elements
                }

                let turn: i32 = turn_tag[1..].parse().map_err(|_| {
                    ParseError::InvalidFormat(format!("Invalid turn tag: {}", turn_tag))
                })?;

                let value: i32 = turn_node
                    .text()
                    .ok_or_else(|| {
                        ParseError::MissingElement(format!("{}.{}", element_name, turn_tag))
                    })?
                    .parse()
                    .map_err(|_| {
                        ParseError::InvalidFormat(format!("Invalid integer in {}", turn_tag))
                    })?;

                data.push((type_name.clone(), turn, value));
            }
        }
    }

    Ok(data)
}

/// Parse game-level yield price history from <Game> element
///
/// # XML Structure
/// ```xml
/// <Game>
///   <YieldPriceHistory>
///     <YIELD_GROWTH>
///       <T2>0</T2>
///       <T5>0</T5>
///       <T18>50</T18>
///     </YIELD_GROWTH>
///     <YIELD_CIVICS>
///       <T2>0</T2>
///     </YIELD_CIVICS>
///   </YieldPriceHistory>
/// </Game>
/// ```
///
/// # Schema
/// ```sql
/// CREATE TABLE yield_prices (
///     match_id BIGINT NOT NULL,
///     turn INTEGER NOT NULL,
///     yield_type VARCHAR NOT NULL,
///     price INTEGER NOT NULL,
///     PRIMARY KEY (match_id, turn, yield_type)
/// );
/// ```
pub fn parse_game_yield_prices(
    game_node: &Node,
    conn: &Connection,
    match_id: i64,
) -> Result<usize> {
    let data = parse_sparse_history_by_type(game_node, "YieldPriceHistory")?;

    if data.is_empty() {
        return Ok(0);
    }

    // Batch insert using prepared statement
    let mut stmt = conn.prepare(
        "INSERT INTO yield_prices (match_id, turn, yield_type, price)
         VALUES (?, ?, ?, ?)",
    )?;

    let mut count = 0;
    for (yield_type, turn, price) in &data {
        stmt.execute(params![match_id, turn, yield_type, price])?;
        count += 1;
    }

    Ok(count)
}

/// Parse player military power history
///
/// # XML Structure
/// ```xml
/// <Player ID="0">
///   <MilitaryPowerHistory>
///     <T2>40</T2>
///     <T3>40</T3>
///     <T5>55</T5>
///   </MilitaryPowerHistory>
/// </Player>
/// ```
pub fn parse_military_power_history(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    let data = parse_sparse_history(player_node, "MilitaryPowerHistory")?;

    if data.is_empty() {
        return Ok(0);
    }

    let mut stmt = conn.prepare(
        "INSERT INTO military_history (player_id, match_id, turn, military_power)
         VALUES (?, ?, ?, ?)",
    )?;

    let mut count = 0;
    for (turn, military_power) in &data {
        stmt.execute(params![player_id, match_id, turn, military_power])?;
        count += 1;
    }

    Ok(count)
}

/// Parse player points history
///
/// # XML Structure
/// ```xml
/// <Player ID="0">
///   <PointsHistory>
///     <T2>100</T2>
///     <T3>105</T3>
///   </PointsHistory>
/// </Player>
/// ```
pub fn parse_points_history(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    let data = parse_sparse_history(player_node, "PointsHistory")?;

    if data.is_empty() {
        return Ok(0);
    }

    let mut stmt = conn.prepare(
        "INSERT INTO points_history (player_id, match_id, turn, points)
         VALUES (?, ?, ?, ?)",
    )?;

    let mut count = 0;
    for (turn, points) in &data {
        stmt.execute(params![player_id, match_id, turn, points])?;
        count += 1;
    }

    Ok(count)
}

/// Parse player legitimacy history
///
/// # XML Structure
/// ```xml
/// <Player ID="0">
///   <LegitimacyHistory>
///     <T2>95</T2>
///     <T5>100</T5>
///   </LegitimacyHistory>
/// </Player>
/// ```
pub fn parse_legitimacy_history(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    let data = parse_sparse_history(player_node, "LegitimacyHistory")?;

    if data.is_empty() {
        return Ok(0);
    }

    let mut stmt = conn.prepare(
        "INSERT INTO legitimacy_history (player_id, match_id, turn, legitimacy)
         VALUES (?, ?, ?, ?)",
    )?;

    let mut count = 0;
    for (turn, legitimacy) in &data {
        stmt.execute(params![player_id, match_id, turn, legitimacy])?;
        count += 1;
    }

    Ok(count)
}

/// Parse player yield rate history (per-yield type)
///
/// # XML Structure
/// ```xml
/// <Player ID="0">
///   <YieldRateHistory>
///     <YIELD_GROWTH>
///       <T2>10</T2>
///       <T5>15</T5>
///     </YIELD_GROWTH>
///     <YIELD_CIVICS>
///       <T2>5</T2>
///     </YIELD_CIVICS>
///   </YieldRateHistory>
/// </Player>
/// ```
pub fn parse_yield_rate_history(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    let data = parse_sparse_history_by_type(player_node, "YieldRateHistory")?;

    if data.is_empty() {
        return Ok(0);
    }

    let mut stmt = conn.prepare(
        "INSERT INTO yield_history (player_id, match_id, turn, yield_type, amount)
         VALUES (?, ?, ?, ?, ?)",
    )?;

    let mut count = 0;
    for (yield_type, turn, amount) in &data {
        stmt.execute(params![player_id, match_id, turn, yield_type, amount])?;
        count += 1;
    }

    Ok(count)
}

/// Parse player family opinion history (per-family)
///
/// # XML Structure
/// ```xml
/// <Player ID="0">
///   <FamilyOpinionHistory>
///     <FAMILY_BARCID>
///       <T2>0</T2>
///       <T5>10</T5>
///     </FAMILY_BARCID>
///     <FAMILY_HANNU>
///       <T2>-5</T2>
///     </FAMILY_HANNU>
///   </FamilyOpinionHistory>
/// </Player>
/// ```
pub fn parse_family_opinion_history(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    let data = parse_sparse_history_by_type(player_node, "FamilyOpinionHistory")?;

    if data.is_empty() {
        return Ok(0);
    }

    let mut stmt = conn.prepare(
        "INSERT INTO family_opinion_history (player_id, match_id, family_name, turn, opinion)
         VALUES (?, ?, ?, ?, ?)",
    )?;

    let mut count = 0;
    for (family_name, turn, opinion) in &data {
        stmt.execute(params![player_id, match_id, family_name, turn, opinion])?;
        count += 1;
    }

    Ok(count)
}

/// Parse player religion opinion history (per-religion)
///
/// # XML Structure
/// ```xml
/// <Player ID="0">
///   <ReligionOpinionHistory>
///     <RELIGION_JUDAISM>
///       <T2>0</T2>
///       <T5>15</T5>
///     </RELIGION_JUDAISM>
///     <RELIGION_ZOROASTRIANISM>
///       <T2>-10</T2>
///     </RELIGION_ZOROASTRIANISM>
///   </ReligionOpinionHistory>
/// </Player>
/// ```
pub fn parse_religion_opinion_history(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<usize> {
    let data = parse_sparse_history_by_type(player_node, "ReligionOpinionHistory")?;

    if data.is_empty() {
        return Ok(0);
    }

    let mut stmt = conn.prepare(
        "INSERT INTO religion_opinion_history (player_id, match_id, religion_name, turn, opinion)
         VALUES (?, ?, ?, ?, ?)",
    )?;

    let mut count = 0;
    for (religion_name, turn, opinion) in &data {
        stmt.execute(params![player_id, match_id, religion_name, turn, opinion])?;
        count += 1;
    }

    Ok(count)
}

/// Parse all player-level time-series data
///
/// This is a convenience function that calls all player-level time-series parsers
/// for a single player node.
pub fn parse_player_timeseries(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
) -> Result<(usize, usize, usize, usize, usize, usize)> {
    let military_count = parse_military_power_history(player_node, conn, player_id, match_id)?;
    let points_count = parse_points_history(player_node, conn, player_id, match_id)?;
    let legitimacy_count = parse_legitimacy_history(player_node, conn, player_id, match_id)?;
    let yield_count = parse_yield_rate_history(player_node, conn, player_id, match_id)?;
    let family_opinion_count =
        parse_family_opinion_history(player_node, conn, player_id, match_id)?;
    let religion_opinion_count =
        parse_religion_opinion_history(player_node, conn, player_id, match_id)?;

    Ok((
        military_count,
        points_count,
        legitimacy_count,
        yield_count,
        family_opinion_count,
        religion_opinion_count,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use roxmltree::Document;

    #[test]
    fn test_parse_sparse_history() {
        let xml = r#"
            <Player ID="0">
                <MilitaryPowerHistory>
                    <T2>40</T2>
                    <T5>55</T5>
                    <T18>120</T18>
                </MilitaryPowerHistory>
            </Player>
        "#;

        let doc = Document::parse(xml).unwrap();
        let player_node = doc.root_element();

        let data = parse_sparse_history(&player_node, "MilitaryPowerHistory").unwrap();
        assert_eq!(data.len(), 3);
        assert_eq!(data[0], (2, 40));
        assert_eq!(data[1], (5, 55));
        assert_eq!(data[2], (18, 120));
    }

    #[test]
    fn test_parse_sparse_history_by_type() {
        let xml = r#"
            <Player ID="0">
                <YieldRateHistory>
                    <YIELD_GROWTH>
                        <T2>10</T2>
                        <T5>15</T5>
                    </YIELD_GROWTH>
                    <YIELD_CIVICS>
                        <T2>5</T2>
                    </YIELD_CIVICS>
                </YieldRateHistory>
            </Player>
        "#;

        let doc = Document::parse(xml).unwrap();
        let player_node = doc.root_element();

        let data = parse_sparse_history_by_type(&player_node, "YieldRateHistory").unwrap();
        assert_eq!(data.len(), 3);
        assert_eq!(data[0], ("YIELD_GROWTH".to_string(), 2, 10));
        assert_eq!(data[1], ("YIELD_GROWTH".to_string(), 5, 15));
        assert_eq!(data[2], ("YIELD_CIVICS".to_string(), 2, 5));
    }

    #[test]
    fn test_parse_sparse_history_missing_element() {
        let xml = r#"
            <Player ID="0">
                <YieldStockpile>
                    <YIELD_CIVICS>100</YIELD_CIVICS>
                </YieldStockpile>
            </Player>
        "#;

        let doc = Document::parse(xml).unwrap();
        let player_node = doc.root_element();

        let data = parse_sparse_history(&player_node, "MilitaryPowerHistory").unwrap();
        assert_eq!(data.len(), 0); // Should return empty vector, not error
    }
}
