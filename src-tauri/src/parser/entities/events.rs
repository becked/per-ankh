// Event story parsers
//
// This module handles parsing of story events from multiple sources:
// - Player-level: AllEventStoryTurn, FamilyEventStoryTurn, ReligionEventStoryTurn, etc.
// - Character-level: EventStoryTurn
// - City-level: EventStoryTurn
//
// XML Structure (Player):
// ```xml
// <Player ID="0">
//   <AllEventStoryTurn>
//     <EVENTSTORY_CULTURE_PAID_FUNCTION>14</EVENTSTORY_CULTURE_PAID_FUNCTION>
//   </AllEventStoryTurn>
//   <FamilyEventStoryTurn>
//     <FAMILY_BARCID.EVENTSTORY_MARRIAGE_OFFER>10</FAMILY_BARCID.EVENTSTORY_MARRIAGE_OFFER>
//   </FamilyEventStoryTurn>
// </Player>
// ```
//
// XML Structure (Character/City):
// ```xml
// <Character ID="5">
//   <EventStoryTurn>
//     <EVENTSTORY_CHARACTER_EVENT>12</EVENTSTORY_CHARACTER_EVENT>
//   </EventStoryTurn>
// </Character>
// ```

use crate::parser::{ParseError, Result};
use duckdb::{params, Connection};
use roxmltree::Node;

/// Parse event stories from a node containing EventStoryTurn-like elements
///
/// This helper function parses any element containing <TX> format event data.
/// Each element name is the event type, and the text is the turn it occurred.
///
/// # Schema
/// ```sql
/// CREATE TABLE story_events (
///     event_id BIGINT NOT NULL PRIMARY KEY,
///     match_id BIGINT NOT NULL,
///     event_type VARCHAR NOT NULL,
///     player_id INTEGER NOT NULL,
///     occurred_turn INTEGER NOT NULL,
///     primary_character_id INTEGER,
///     secondary_character_id INTEGER,
///     city_id INTEGER,
///     event_text VARCHAR
/// );
/// ```
fn parse_event_turn_element(
    event_node: &Node,
    conn: &Connection,
    match_id: i64,
    player_id: i64,
    primary_character_id: Option<i64>,
    city_id: Option<i64>,
    next_event_id: &mut i64,
) -> Result<usize> {
    let mut count = 0;

    for event_elem in event_node.children().filter(|n| n.is_element()) {
        let event_type = event_elem.tag_name().name();
        let occurred_turn: i32 = event_elem
            .text()
            .ok_or_else(|| {
                ParseError::MissingElement(format!("Event {} turn value", event_type))
            })?
            .parse()
            .map_err(|_| ParseError::InvalidFormat(format!("Invalid turn in {}", event_type)))?;

        let event_id = *next_event_id;
        *next_event_id += 1;

        conn.execute(
            "INSERT INTO story_events
             (event_id, match_id, event_type, player_id, occurred_turn,
              primary_character_id, secondary_character_id, city_id, event_text)
             VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)",
            params![
                event_id,
                match_id,
                event_type,
                player_id,
                occurred_turn,
                primary_character_id,
                city_id
            ],
        )?;

        count += 1;
    }

    Ok(count)
}

/// Parse player-level event stories
///
/// Handles multiple event story categories:
/// - AllEventStoryTurn: General player events
/// - FamilyEventStoryTurn: Family-related events
/// - ReligionEventStoryTurn: Religion-related events
/// - TribeEventStoryTurn: Tribe interaction events
/// - PlayerEventStoryTurn: Player-specific events
pub fn parse_player_events(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
    next_event_id: &mut i64,
) -> Result<usize> {
    let mut total = 0;

    // Parse AllEventStoryTurn
    if let Some(event_node) = player_node
        .children()
        .find(|n| n.has_tag_name("AllEventStoryTurn"))
    {
        total += parse_event_turn_element(
            &event_node,
            conn,
            match_id,
            player_id,
            None,
            None,
            next_event_id,
        )?;
    }

    // Parse FamilyEventStoryTurn
    if let Some(event_node) = player_node
        .children()
        .find(|n| n.has_tag_name("FamilyEventStoryTurn"))
    {
        total += parse_event_turn_element(
            &event_node,
            conn,
            match_id,
            player_id,
            None,
            None,
            next_event_id,
        )?;
    }

    // Parse ReligionEventStoryTurn
    if let Some(event_node) = player_node
        .children()
        .find(|n| n.has_tag_name("ReligionEventStoryTurn"))
    {
        total += parse_event_turn_element(
            &event_node,
            conn,
            match_id,
            player_id,
            None,
            None,
            next_event_id,
        )?;
    }

    // Parse TribeEventStoryTurn
    if let Some(event_node) = player_node
        .children()
        .find(|n| n.has_tag_name("TribeEventStoryTurn"))
    {
        total += parse_event_turn_element(
            &event_node,
            conn,
            match_id,
            player_id,
            None,
            None,
            next_event_id,
        )?;
    }

    // Parse PlayerEventStoryTurn
    if let Some(event_node) = player_node
        .children()
        .find(|n| n.has_tag_name("PlayerEventStoryTurn"))
    {
        total += parse_event_turn_element(
            &event_node,
            conn,
            match_id,
            player_id,
            None,
            None,
            next_event_id,
        )?;
    }

    Ok(total)
}

/// Parse character-level event stories
pub fn parse_character_events(
    character_node: &Node,
    conn: &Connection,
    character_id: i64,
    player_id: i64,
    match_id: i64,
    next_event_id: &mut i64,
) -> Result<usize> {
    if let Some(event_node) = character_node
        .children()
        .find(|n| n.has_tag_name("EventStoryTurn"))
    {
        parse_event_turn_element(
            &event_node,
            conn,
            match_id,
            player_id,
            Some(character_id),
            None,
            next_event_id,
        )
    } else {
        Ok(0)
    }
}

/// Parse city-level event stories
pub fn parse_city_events(
    city_node: &Node,
    conn: &Connection,
    city_id: i64,
    player_id: i64,
    match_id: i64,
    next_event_id: &mut i64,
) -> Result<usize> {
    if let Some(event_node) = city_node
        .children()
        .find(|n| n.has_tag_name("EventStoryTurn"))
    {
        parse_event_turn_element(
            &event_node,
            conn,
            match_id,
            player_id,
            None,
            Some(city_id),
            next_event_id,
        )
    } else {
        Ok(0)
    }
}

/// Parse player log events from PermanentLogList/LogData
///
/// # XML Structure
/// ```xml
/// <Player ID="0">
///   <PermanentLogList>
///     <LogData>
///       <Text>Discovered &lt;color=#e3c08c&gt;Ironworking&lt;/color&gt;</Text>
///       <Type>TECH_DISCOVERED</Type>
///       <Data1>TECH_IRONWORKING</Data1>
///       <Data2>None</Data2>
///       <Data3>None</Data3>
///       <Turn>1</Turn>
///       <TeamTurn>0</TeamTurn>
///     </LogData>
///   </PermanentLogList>
/// </Player>
/// ```
///
/// # Schema
/// ```sql
/// CREATE TABLE event_logs (
///     log_id BIGINT NOT NULL PRIMARY KEY,
///     match_id BIGINT NOT NULL,
///     turn INTEGER NOT NULL,
///     log_type VARCHAR NOT NULL,
///     player_id INTEGER,
///     description VARCHAR,
///     data1 INTEGER,
///     data2 INTEGER,
///     data3 INTEGER,
///     is_permanent BOOLEAN DEFAULT false
/// );
/// ```
pub fn parse_player_log_events(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
    next_log_id: &mut i64,
) -> Result<usize> {
    let mut count = 0;

    // Find PermanentLogList element
    let log_list_node = match player_node
        .children()
        .find(|n| n.has_tag_name("PermanentLogList"))
    {
        Some(node) => node,
        None => return Ok(0), // No logs for this player
    };

    // Iterate over LogData elements
    for log_node in log_list_node.children().filter(|n| n.has_tag_name("LogData")) {
        // Extract fields (all optional except Type and Turn)
        let log_type = log_node
            .children()
            .find(|n| n.has_tag_name("Type"))
            .and_then(|n| n.text())
            .ok_or_else(|| ParseError::MissingElement("LogData.Type".to_string()))?;

        let turn: i32 = log_node
            .children()
            .find(|n| n.has_tag_name("Turn"))
            .and_then(|n| n.text())
            .ok_or_else(|| ParseError::MissingElement("LogData.Turn".to_string()))?
            .parse()
            .map_err(|_| ParseError::InvalidFormat("LogData.Turn must be integer".to_string()))?;

        let description = log_node
            .children()
            .find(|n| n.has_tag_name("Text"))
            .and_then(|n| n.text());

        // Parse data fields as integers, treating "None" as NULL
        let data1 = log_node
            .children()
            .find(|n| n.has_tag_name("Data1"))
            .and_then(|n| n.text())
            .filter(|t| *t != "None")
            .and_then(|t| t.parse::<i32>().ok());

        let data2 = log_node
            .children()
            .find(|n| n.has_tag_name("Data2"))
            .and_then(|n| n.text())
            .filter(|t| *t != "None")
            .and_then(|t| t.parse::<i32>().ok());

        let data3 = log_node
            .children()
            .find(|n| n.has_tag_name("Data3"))
            .and_then(|n| n.text())
            .filter(|t| *t != "None")
            .and_then(|t| t.parse::<i32>().ok());

        let log_id = *next_log_id;
        *next_log_id += 1;

        conn.execute(
            "INSERT INTO event_logs
             (log_id, match_id, turn, log_type, player_id, description, data1, data2, data3, is_permanent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true)",
            params![
                log_id,
                match_id,
                turn,
                log_type,
                player_id,
                description,
                data1,
                data2,
                data3
            ],
        )?;

        count += 1;
    }

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use roxmltree::Document;

    #[test]
    fn test_parse_player_events_structure() {
        let xml = r#"
            <Player ID="0">
                <AllEventStoryTurn>
                    <EVENTSTORY_CULTURE_PAID_FUNCTION>14</EVENTSTORY_CULTURE_PAID_FUNCTION>
                </AllEventStoryTurn>
                <FamilyEventStoryTurn>
                    <FAMILY_BARCID.EVENTSTORY_MARRIAGE_OFFER>10</FAMILY_BARCID.EVENTSTORY_MARRIAGE_OFFER>
                </FamilyEventStoryTurn>
            </Player>
        "#;

        let doc = Document::parse(xml).unwrap();
        let player_node = doc.root_element();

        let all_events = player_node
            .children()
            .find(|n| n.has_tag_name("AllEventStoryTurn"))
            .unwrap();
        assert_eq!(all_events.children().filter(|n| n.is_element()).count(), 1);

        let family_events = player_node
            .children()
            .find(|n| n.has_tag_name("FamilyEventStoryTurn"))
            .unwrap();
        assert_eq!(
            family_events.children().filter(|n| n.is_element()).count(),
            1
        );
    }

    #[test]
    fn test_parse_character_events_structure() {
        let xml = r#"
            <Character ID="5">
                <EventStoryTurn>
                    <EVENTSTORY_CHARACTER_EVENT>12</EVENTSTORY_CHARACTER_EVENT>
                </EventStoryTurn>
            </Character>
        "#;

        let doc = Document::parse(xml).unwrap();
        let char_node = doc.root_element();

        let events = char_node
            .children()
            .find(|n| n.has_tag_name("EventStoryTurn"))
            .unwrap();
        assert_eq!(events.children().filter(|n| n.is_element()).count(), 1);
    }
}
