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
