// Event parsers - story events, event logs, and memory data
//
// This module parses three types of event data:
// 1. Story events (from EventStoryTurn-like elements in Players, Characters, Cities)
// 2. Event logs (from PermanentLogList/LogData in Players)
// 3. Memory data (from MemoryList/MemoryData in Players)

use crate::parser::game_data::{EventLog, EventStory, MemoryData};
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::Result;

/// Parse all events from XML document (called after entity parsing)
///
/// This function returns all three event types together since they're all parsed from
/// the same traversal of the XML document.
pub fn parse_events_struct(doc: &XmlDocument) -> Result<(Vec<EventStory>, Vec<EventLog>, Vec<MemoryData>)> {
    let root = doc.root_element();

    let mut event_stories = Vec::new();
    let mut event_logs = Vec::new();
    let mut memory_data = Vec::new();

    // Parse player-level events
    for player_node in root.children().filter(|n| n.has_tag_name("Player")) {
        let player_id: i32 = player_node.req_attr("ID")?.parse()?;

        // Parse story events from various EventStoryTurn-like elements
        event_stories.extend(parse_player_story_events(&player_node, player_id)?);

        // Parse event logs from PermanentLogList
        event_logs.extend(parse_player_event_logs(&player_node, player_id)?);

        // Parse memory data from MemoryList
        memory_data.extend(parse_player_memories(&player_node, player_id)?);
    }

    // Parse character-level story events
    for char_node in root.children().filter(|n| n.has_tag_name("Character")) {
        let char_id: i32 = char_node.req_attr("ID")?.parse()?;
        let player_id: Option<i32> = char_node
            .opt_attr("player")
            .and_then(|s| s.parse().ok());

        if let Some(pid) = player_id {
            event_stories.extend(parse_character_story_events(&char_node, char_id, pid)?);
        }
    }

    // Parse city-level story events
    for city_node in root.children().filter(|n| n.has_tag_name("City")) {
        let city_id: i32 = city_node.req_attr("ID")?.parse()?;
        let player_id: Option<i32> = city_node
            .opt_attr("player")
            .and_then(|s| s.parse().ok());

        if let Some(pid) = player_id {
            event_stories.extend(parse_city_story_events(&city_node, city_id, pid)?);
        }
    }

    Ok((event_stories, event_logs, memory_data))
}

/// Parse player-level story events from multiple EventStoryTurn-like elements
fn parse_player_story_events(player_node: &roxmltree::Node, player_id: i32) -> Result<Vec<EventStory>> {
    let mut stories = Vec::new();

    // List of event story element names to parse
    let event_story_elements = [
        "AllEventStoryTurn",
        "FamilyEventStoryTurn",
        "ReligionEventStoryTurn",
        "TribeEventStoryTurn",
        "PlayerEventStoryTurn",
    ];

    for element_name in &event_story_elements {
        if let Some(event_node) = player_node.children().find(|n| n.has_tag_name(*element_name)) {
            for event_elem in event_node.children().filter(|n| n.is_element()) {
                let event_type = event_elem.tag_name().name().to_string();
                let occurred_turn: i32 = event_elem
                    .text()
                    .unwrap_or("0")
                    .parse()
                    .unwrap_or(0);

                stories.push(EventStory {
                    event_type,
                    player_xml_id: player_id,
                    occurred_turn,
                    primary_character_xml_id: None,
                    city_xml_id: None,
                });
            }
        }
    }

    Ok(stories)
}

/// Parse character-level story events from EventStoryTurn
fn parse_character_story_events(
    char_node: &roxmltree::Node,
    char_id: i32,
    player_id: i32,
) -> Result<Vec<EventStory>> {
    let mut stories = Vec::new();

    if let Some(event_node) = char_node.children().find(|n| n.has_tag_name("EventStoryTurn")) {
        for event_elem in event_node.children().filter(|n| n.is_element()) {
            let event_type = event_elem.tag_name().name().to_string();
            let occurred_turn: i32 = event_elem
                .text()
                .unwrap_or("0")
                .parse()
                .unwrap_or(0);

            stories.push(EventStory {
                event_type,
                player_xml_id: player_id,
                occurred_turn,
                primary_character_xml_id: Some(char_id),
                city_xml_id: None,
            });
        }
    }

    Ok(stories)
}

/// Parse city-level story events from EventStoryTurn
fn parse_city_story_events(
    city_node: &roxmltree::Node,
    city_id: i32,
    player_id: i32,
) -> Result<Vec<EventStory>> {
    let mut stories = Vec::new();

    if let Some(event_node) = city_node.children().find(|n| n.has_tag_name("EventStoryTurn")) {
        for event_elem in event_node.children().filter(|n| n.is_element()) {
            let event_type = event_elem.tag_name().name().to_string();
            let occurred_turn: i32 = event_elem
                .text()
                .unwrap_or("0")
                .parse()
                .unwrap_or(0);

            stories.push(EventStory {
                event_type,
                player_xml_id: player_id,
                occurred_turn,
                primary_character_xml_id: None,
                city_xml_id: Some(city_id),
            });
        }
    }

    Ok(stories)
}

/// Parse player event logs from PermanentLogList/LogData
fn parse_player_event_logs(player_node: &roxmltree::Node, player_id: i32) -> Result<Vec<EventLog>> {
    let mut logs = Vec::new();

    if let Some(log_list_node) = player_node.children().find(|n| n.has_tag_name("PermanentLogList")) {
        for log_node in log_list_node.children().filter(|n| n.has_tag_name("LogData")) {
            let log_type = log_node
                .children()
                .find(|n| n.has_tag_name("Type"))
                .and_then(|n| n.text())
                .unwrap_or("")
                .to_string();

            let turn: i32 = log_node
                .children()
                .find(|n| n.has_tag_name("Turn"))
                .and_then(|n| n.text())
                .and_then(|t| t.parse().ok())
                .unwrap_or(0);

            let description = log_node
                .children()
                .find(|n| n.has_tag_name("Text"))
                .and_then(|n| n.text())
                .map(String::from);

            let data1 = log_node
                .children()
                .find(|n| n.has_tag_name("Data1"))
                .and_then(|n| n.text())
                .filter(|t| *t != "None" && !t.is_empty())
                .map(String::from);

            let data2 = log_node
                .children()
                .find(|n| n.has_tag_name("Data2"))
                .and_then(|n| n.text())
                .filter(|t| *t != "None" && !t.is_empty())
                .map(String::from);

            let data3 = log_node
                .children()
                .find(|n| n.has_tag_name("Data3"))
                .and_then(|n| n.text())
                .filter(|t| *t != "None" && !t.is_empty())
                .map(String::from);

            logs.push(EventLog {
                player_xml_id: player_id,
                log_type,
                turn,
                description,
                data1,
                data2,
                data3,
            });
        }
    }

    Ok(logs)
}

/// Parse player memory data from MemoryList/MemoryData
fn parse_player_memories(player_node: &roxmltree::Node, player_id: i32) -> Result<Vec<MemoryData>> {
    let mut memories = Vec::new();

    // Try 2025 format first (unified MemoryList)
    if let Some(memory_list_node) = player_node.children().find(|n| n.has_tag_name("MemoryList")) {
        for memory_node in memory_list_node.children().filter(|n| n.has_tag_name("MemoryData")) {
            if let Some(memory) = parse_memory_data(&memory_node, player_id)? {
                memories.push(memory);
            }
        }
    }

    // Fall back to 2024 format (separate Memory*List elements) if no memories found
    if memories.is_empty() {
        memories.extend(parse_legacy_memory_lists(player_node, player_id)?);
    }

    Ok(memories)
}

/// Parse a single MemoryData element
fn parse_memory_data(memory_node: &roxmltree::Node, player_id: i32) -> Result<Option<MemoryData>> {
    let memory_type = match memory_node.children().find(|n| n.has_tag_name("Type")).and_then(|n| n.text()) {
        Some(t) => t.to_string(),
        None => return Ok(None), // Skip malformed memory data
    };

    let turn: i32 = memory_node
        .children()
        .find(|n| n.has_tag_name("Turn"))
        .and_then(|n| n.text())
        .and_then(|t| t.parse().ok())
        .unwrap_or(0);

    let target_player_xml_id = memory_node
        .children()
        .find(|n| n.has_tag_name("Player"))
        .and_then(|n| n.text())
        .and_then(|t| t.parse().ok());

    let target_character_xml_id = memory_node
        .children()
        .find(|n| n.has_tag_name("CharacterID"))
        .and_then(|n| n.text())
        .and_then(|t| t.parse().ok());

    let target_family = memory_node
        .children()
        .find(|n| n.has_tag_name("Family"))
        .and_then(|n| n.text())
        .map(String::from);

    let target_tribe = memory_node
        .children()
        .find(|n| n.has_tag_name("Tribe"))
        .and_then(|n| n.text())
        .map(String::from);

    let target_religion = memory_node
        .children()
        .find(|n| n.has_tag_name("Religion"))
        .and_then(|n| n.text())
        .map(String::from);

    Ok(Some(MemoryData {
        player_xml_id: player_id,
        memory_type,
        turn,
        target_player_xml_id,
        target_character_xml_id,
        target_family,
        target_tribe,
        target_religion,
    }))
}

/// Parse legacy 2024 format with separate Memory*List elements
fn parse_legacy_memory_lists(player_node: &roxmltree::Node, player_id: i32) -> Result<Vec<MemoryData>> {
    let mut memories = Vec::new();

    let legacy_lists = [
        ("MemoryPlayerList", "MemoryPlayerData"),
        ("MemoryFamilyList", "MemoryFamilyData"),
        ("MemoryCharacterList", "MemoryCharacterData"),
        ("MemoryTribeList", "MemoryTribeData"),
        ("MemoryReligionList", "MemoryReligionData"),
    ];

    for (list_name, data_element_name) in &legacy_lists {
        if let Some(list_node) = player_node.children().find(|n| n.has_tag_name(*list_name)) {
            for memory_node in list_node.children().filter(|n| n.has_tag_name(*data_element_name)) {
                if let Some(memory) = parse_memory_data(&memory_node, player_id)? {
                    memories.push(memory);
                }
            }
        }
    }

    Ok(memories)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::xml_loader::parse_xml;

    #[test]
    fn test_parse_player_story_events() {
        let xml = r#"<Root>
            <Player ID="0">
                <AllEventStoryTurn>
                    <EVENTSTORY_CULTURE_PAID_FUNCTION>14</EVENTSTORY_CULTURE_PAID_FUNCTION>
                </AllEventStoryTurn>
                <FamilyEventStoryTurn>
                    <FAMILY_BARCID_EVENTSTORY_MARRIAGE_OFFER>10</FAMILY_BARCID_EVENTSTORY_MARRIAGE_OFFER>
                </FamilyEventStoryTurn>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let (stories, _, _) = parse_events_struct(&doc).unwrap();

        assert_eq!(stories.len(), 2);
        assert_eq!(stories[0].event_type, "EVENTSTORY_CULTURE_PAID_FUNCTION");
        assert_eq!(stories[0].player_xml_id, 0);
        assert_eq!(stories[0].occurred_turn, 14);
        assert_eq!(stories[0].primary_character_xml_id, None);
        assert_eq!(stories[0].city_xml_id, None);
    }

    #[test]
    fn test_parse_character_story_events() {
        let xml = r#"<Root>
            <Character ID="5" player="0">
                <EventStoryTurn>
                    <EVENTSTORY_CHARACTER_EVENT>12</EVENTSTORY_CHARACTER_EVENT>
                </EventStoryTurn>
            </Character>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let (stories, _, _) = parse_events_struct(&doc).unwrap();

        assert_eq!(stories.len(), 1);
        assert_eq!(stories[0].event_type, "EVENTSTORY_CHARACTER_EVENT");
        assert_eq!(stories[0].player_xml_id, 0);
        assert_eq!(stories[0].primary_character_xml_id, Some(5));
        assert_eq!(stories[0].city_xml_id, None);
    }

    #[test]
    fn test_parse_event_logs() {
        let xml = r#"<Root>
            <Player ID="0">
                <PermanentLogList>
                    <LogData>
                        <Text>Discovered &lt;color=#e3c08c&gt;Ironworking&lt;/color&gt;</Text>
                        <Type>TECH_DISCOVERED</Type>
                        <Data1>TECH_IRONWORKING</Data1>
                        <Data2>None</Data2>
                        <Data3>None</Data3>
                        <Turn>1</Turn>
                    </LogData>
                </PermanentLogList>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let (_, logs, _) = parse_events_struct(&doc).unwrap();

        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].log_type, "TECH_DISCOVERED");
        assert_eq!(logs[0].player_xml_id, 0);
        assert_eq!(logs[0].turn, 1);
        assert!(logs[0].description.is_some());
        assert_eq!(logs[0].data2, None);
    }

    #[test]
    fn test_parse_memory_data() {
        let xml = r#"<Root>
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
                </MemoryList>
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let (_, _, memories) = parse_events_struct(&doc).unwrap();

        assert_eq!(memories.len(), 3);

        // Check player memory
        assert_eq!(memories[0].memory_type, "MEMORYPLAYER_ATTACKED_CITY");
        assert_eq!(memories[0].target_player_xml_id, Some(1));
        assert_eq!(memories[0].turn, 30);

        // Check family memory
        assert_eq!(memories[1].memory_type, "MEMORYFAMILY_FOUNDED_CITY");
        assert_eq!(memories[1].target_family, Some("FAMILY_DIDONIAN".to_string()));

        // Check character memory
        assert_eq!(memories[2].memory_type, "MEMORYCHARACTER_UPGRADED_RECENTLY");
        assert_eq!(memories[2].target_character_xml_id, Some(12));
    }

    #[test]
    fn test_parse_events_empty() {
        let xml = r#"<Root>
            <Player ID="0">
            </Player>
        </Root>"#;

        let doc = parse_xml(xml.to_string()).unwrap();
        let (stories, logs, memories) = parse_events_struct(&doc).unwrap();

        assert_eq!(stories.len(), 0);
        assert_eq!(logs.len(), 0);
        assert_eq!(memories.len(), 0);
    }
}
