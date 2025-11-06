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

/// Parse player memory data from MemoryList/MemoryData
///
/// # XML Structure
/// ```xml
/// <Player ID="0">
///   <MemoryList>
///     <MemoryData>
///       <Type>MEMORYPLAYER_ATTACKED_CITY</Type>
///       <Player>1</Player>
///       <Turn>30</Turn>
///     </MemoryData>
///     <MemoryData>
///       <Type>MEMORYFAMILY_FOUNDED_CITY</Type>
///       <Family>FAMILY_DIDONIAN</Family>
///       <Turn>21</Turn>
///     </MemoryData>
///     <MemoryData>
///       <Type>MEMORYCHARACTER_UPGRADED_RECENTLY</Type>
///       <CharacterID>12</CharacterID>
///       <Turn>38</Turn>
///     </MemoryData>
///   </MemoryList>
/// </Player>
/// ```
///
/// # Schema
/// ```sql
/// CREATE TABLE memory_data (
///     memory_id BIGINT NOT NULL PRIMARY KEY,
///     player_id INTEGER NOT NULL,
///     match_id BIGINT NOT NULL,
///     memory_type VARCHAR NOT NULL,
///     turn INTEGER NOT NULL,
///     target_player_id INTEGER,
///     target_character_id INTEGER,
///     target_family VARCHAR,
///     target_tribe VARCHAR,
///     target_religion VARCHAR
/// );
/// ```
pub fn parse_player_memories(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
    next_memory_id: &mut i64,
) -> Result<usize> {
    let mut count = 0;

    // Try 2025 format first (unified MemoryList)
    if let Some(memory_list_node) = player_node
        .children()
        .find(|n| n.has_tag_name("MemoryList"))
    {
        // Iterate over MemoryData elements
        for memory_node in memory_list_node
            .children()
            .filter(|n| n.has_tag_name("MemoryData"))
        {
            // Extract required fields
            let memory_type = memory_node
                .children()
                .find(|n| n.has_tag_name("Type"))
                .and_then(|n| n.text())
                .ok_or_else(|| ParseError::MissingElement("MemoryData.Type".to_string()))?;

            let turn: i32 = memory_node
                .children()
                .find(|n| n.has_tag_name("Turn"))
                .and_then(|n| n.text())
                .ok_or_else(|| ParseError::MissingElement("MemoryData.Turn".to_string()))?
                .parse()
                .map_err(|_| {
                    ParseError::InvalidFormat("MemoryData.Turn must be integer".to_string())
                })?;

            // Extract optional target fields (only one will be present based on memory type)
            let target_player_id = memory_node
                .children()
                .find(|n| n.has_tag_name("Player"))
                .and_then(|n| n.text())
                .and_then(|t| t.parse::<i32>().ok());

            let target_character_id = memory_node
                .children()
                .find(|n| n.has_tag_name("CharacterID"))
                .and_then(|n| n.text())
                .and_then(|t| t.parse::<i32>().ok());

            let target_family = memory_node
                .children()
                .find(|n| n.has_tag_name("Family"))
                .and_then(|n| n.text());

            let target_tribe = memory_node
                .children()
                .find(|n| n.has_tag_name("Tribe"))
                .and_then(|n| n.text());

            let target_religion = memory_node
                .children()
                .find(|n| n.has_tag_name("Religion"))
                .and_then(|n| n.text());

            let memory_id = *next_memory_id;
            *next_memory_id += 1;

            conn.execute(
                "INSERT INTO memory_data
                 (memory_id, player_id, match_id, memory_type, turn,
                  target_player_id, target_character_id, target_family, target_tribe, target_religion)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    memory_id,
                    player_id,
                    match_id,
                    memory_type,
                    turn,
                    target_player_id,
                    target_character_id,
                    target_family,
                    target_tribe,
                    target_religion
                ],
            )?;

            count += 1;
        }
    }

    // Fall back to 2024 format (separate Memory*List elements)
    if count == 0 {
        count += parse_legacy_memory_lists(player_node, conn, player_id, match_id, next_memory_id)?;
    }

    Ok(count)
}

/// Parse legacy 2024 format with separate Memory*List elements
fn parse_legacy_memory_lists(
    player_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
    next_memory_id: &mut i64,
) -> Result<usize> {
    let mut count = 0;

    // List of legacy list types to check
    let legacy_lists = [
        "MemoryPlayerList",
        "MemoryFamilyList",
        "MemoryCharacterList",
        "MemoryTribeList",
        "MemoryReligionList",
    ];

    for list_name in &legacy_lists {
        if let Some(list_node) = player_node.children().find(|n| n.has_tag_name(*list_name)) {
            // Determine child element name (e.g., MemoryPlayerData)
            let data_element_name = list_name.replace("List", "Data");

            for memory_node in list_node
                .children()
                .filter(|n| n.has_tag_name(data_element_name.as_str()))
            {
                count += parse_legacy_memory_data(
                    &memory_node,
                    conn,
                    player_id,
                    match_id,
                    next_memory_id,
                )?;
            }
        }
    }

    Ok(count)
}

/// Parse a single legacy Memory*Data element
fn parse_legacy_memory_data(
    memory_node: &Node,
    conn: &Connection,
    player_id: i64,
    match_id: i64,
    next_memory_id: &mut i64,
) -> Result<usize> {
    // Extract Type and Turn (required)
    let memory_type = memory_node
        .children()
        .find(|n| n.has_tag_name("Type"))
        .and_then(|n| n.text())
        .ok_or_else(|| ParseError::MissingElement("Memory*Data.Type".to_string()))?;

    let turn: i32 = memory_node
        .children()
        .find(|n| n.has_tag_name("Turn"))
        .and_then(|n| n.text())
        .ok_or_else(|| ParseError::MissingElement("Memory*Data.Turn".to_string()))?
        .parse()
        .map_err(|_| {
            ParseError::InvalidFormat("Memory*Data.Turn must be integer".to_string())
        })?;

    // Extract optional targets (one will be present)
    // YAGNI: Store numeric IDs as strings rather than mapping to names
    let target_player_id = memory_node
        .children()
        .find(|n| n.has_tag_name("Player"))
        .and_then(|n| n.text())
        .and_then(|t| t.parse::<i32>().ok());

    let target_character_id = memory_node
        .children()
        .find(|n| n.has_tag_name("CharacterID"))
        .and_then(|n| n.text())
        .and_then(|t| t.parse::<i32>().ok());

    let target_family = memory_node
        .children()
        .find(|n| n.has_tag_name("Family"))
        .and_then(|n| n.text());

    let target_tribe = memory_node
        .children()
        .find(|n| n.has_tag_name("Tribe"))
        .and_then(|n| n.text());

    let target_religion = memory_node
        .children()
        .find(|n| n.has_tag_name("Religion"))
        .and_then(|n| n.text());

    let memory_id = *next_memory_id;
    *next_memory_id += 1;

    conn.execute(
        "INSERT INTO memory_data
         (memory_id, player_id, match_id, memory_type, turn,
          target_player_id, target_character_id, target_family, target_tribe, target_religion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            memory_id,
            player_id,
            match_id,
            memory_type,
            turn,
            target_player_id,
            target_character_id,
            target_family,
            target_tribe,
            target_religion
        ],
    )?;

    Ok(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use roxmltree::Document;

    #[test]
    fn test_parse_player_memories_structure() {
        let xml = r#"
            <Player ID="0">
                <MemoryList>
                    <MemoryData>
                        <Type>MEMORYPLAYER_ATTACKED_CITY</Type>
                        <Player>1</Player>
                        <Turn>30</Turn>
                    </MemoryData>
                    <MemoryData>
                        <Type>MEMORYFAMILY_FOUNDED_CITY</Type>
                        <Family>FAMILY_DIDONIAN</Family>
                        <Turn>21</Turn>
                    </MemoryData>
                    <MemoryData>
                        <Type>MEMORYCHARACTER_UPGRADED_RECENTLY</Type>
                        <CharacterID>12</CharacterID>
                        <Turn>38</Turn>
                    </MemoryData>
                    <MemoryData>
                        <Type>MEMORYTRIBE_ATTACKED_UNIT</Type>
                        <Tribe>TRIBE_NUMIDIANS</Tribe>
                        <Turn>20</Turn>
                    </MemoryData>
                    <MemoryData>
                        <Type>MEMORYRELIGION_SPREAD_RELIGION</Type>
                        <Religion>RELIGION_MANICHAEISM</Religion>
                        <Turn>132</Turn>
                    </MemoryData>
                </MemoryList>
            </Player>
        "#;

        let doc = Document::parse(xml).unwrap();
        let player_node = doc.root_element();

        let memory_list = player_node
            .children()
            .find(|n| n.has_tag_name("MemoryList"))
            .unwrap();

        let memories: Vec<_> = memory_list
            .children()
            .filter(|n| n.has_tag_name("MemoryData"))
            .collect();

        assert_eq!(memories.len(), 5);

        // Verify different target types
        let first_memory = memories[0];
        assert_eq!(
            first_memory.children().find(|n| n.has_tag_name("Type")).unwrap().text().unwrap(),
            "MEMORYPLAYER_ATTACKED_CITY"
        );
        assert!(first_memory.children().any(|n| n.has_tag_name("Player")));

        let family_memory = memories[1];
        assert!(family_memory.children().any(|n| n.has_tag_name("Family")));

        let char_memory = memories[2];
        assert!(char_memory.children().any(|n| n.has_tag_name("CharacterID")));

        let tribe_memory = memories[3];
        assert!(tribe_memory.children().any(|n| n.has_tag_name("Tribe")));

        let religion_memory = memories[4];
        assert!(religion_memory.children().any(|n| n.has_tag_name("Religion")));
    }

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
