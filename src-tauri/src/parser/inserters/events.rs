// Event inserters - story events, event logs, and memory data

use crate::parser::game_data::{EventLog, EventStory, MemoryData};
use crate::parser::id_mapper::IdMapper;
use crate::parser::Result;
use duckdb::{params, Connection};

/// Insert story events into database
pub fn insert_event_stories(
    conn: &Connection,
    events: &[EventStory],
    id_mapper: &IdMapper,
) -> Result<()> {
    if events.is_empty() {
        return Ok(());
    }

    let mut app = conn.appender("story_events")?;
    let mut event_id: i64 = 1; // Auto-increment starting from 1

    for event in events {
        let player_id = id_mapper.get_player(event.player_xml_id)?;
        let character_id = event
            .primary_character_xml_id
            .map(|xml_id| id_mapper.get_character(xml_id))
            .transpose()?;
        let city_id = event
            .city_xml_id
            .map(|xml_id| id_mapper.get_city(xml_id))
            .transpose()?;

        app.append_row(params![
            event_id,
            id_mapper.match_id,
            &event.event_type,
            player_id,
            event.occurred_turn,
            character_id,
            None::<i64>,      // secondary_character_id (not used)
            city_id,
            None::<String>,   // event_text (not used)
        ])?;

        event_id += 1;
    }

    drop(app);
    Ok(())
}

/// Insert event logs into database
pub fn insert_event_logs(
    conn: &Connection,
    logs: &[EventLog],
    id_mapper: &IdMapper,
) -> Result<()> {
    if logs.is_empty() {
        return Ok(());
    }

    let mut app = conn.appender("event_logs")?;
    let mut log_id: i64 = 1; // Auto-increment starting from 1

    for log in logs {
        let player_id = id_mapper.get_player(log.player_xml_id)?;

        app.append_row(params![
            log_id,
            id_mapper.match_id,
            log.turn,
            &log.log_type,
            player_id,
            log.description.as_deref(),
            log.data1,
            log.data2,
            log.data3,
            true, // is_permanent
        ])?;

        log_id += 1;
    }

    drop(app);
    Ok(())
}

/// Insert memory data into database
pub fn insert_memory_data(
    conn: &Connection,
    memories: &[MemoryData],
    id_mapper: &IdMapper,
) -> Result<()> {
    if memories.is_empty() {
        return Ok(());
    }

    let mut app = conn.appender("memory_data")?;
    let mut memory_id: i64 = 1; // Auto-increment starting from 1

    for memory in memories {
        let player_id = id_mapper.get_player(memory.player_xml_id)?;
        let target_player_id = memory
            .target_player_xml_id
            .map(|xml_id| id_mapper.get_player(xml_id))
            .transpose()?;
        let target_character_id = memory
            .target_character_xml_id
            .map(|xml_id| id_mapper.get_character(xml_id))
            .transpose()?;

        app.append_row(params![
            memory_id,
            player_id,
            id_mapper.match_id,
            &memory.memory_type,
            memory.turn,
            target_player_id,
            target_character_id,
            memory.target_family.as_deref(),
            memory.target_tribe.as_deref(),
            memory.target_religion.as_deref(),
        ])?;

        memory_id += 1;
    }

    drop(app);
    Ok(())
}
