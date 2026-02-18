// Match detail, events, laws, and tech queries

use crate::types::{
    EventLog, GameDetails, PlayerInfo, PlayerLaw, PlayerTech, StoryEvent,
};
use duckdb::Connection;

/// Get detailed information about a specific match including players.
pub fn get_game_details(conn: &Connection, match_id: i64) -> duckdb::Result<GameDetails> {
    // Get match details with winner and save owner information via LEFT JOINs
    let mut stmt = conn.prepare(
        "SELECT m.match_id, m.game_name, CAST(m.save_date AS VARCHAR) as save_date,
                m.total_turns, m.map_size, m.map_width, m.map_height, m.map_class,
                m.game_mode, m.opponent_level, m.victory_conditions, m.enabled_mods, m.enabled_dlc,
                m.winner_player_id,
                wp.player_name as winner_name,
                wp.nation as winner_civilization,
                m.winner_victory_type,
                so.difficulty as save_owner_difficulty
         FROM matches m
         LEFT JOIN players wp ON m.match_id = wp.match_id AND m.winner_player_id = wp.player_id
         LEFT JOIN players so ON m.match_id = so.match_id AND so.is_save_owner = TRUE
         WHERE m.match_id = ?",
    )?;

    let game_details = stmt.query_row([match_id], |row| {
        Ok(GameDetails {
            match_id: row.get(0)?,
            game_name: row.get(1)?,
            save_date: row.get(2)?,
            total_turns: row.get(3)?,
            map_size: row.get(4)?,
            map_width: row.get(5)?,
            map_height: row.get(6)?,
            map_class: row.get(7)?,
            game_mode: row.get(8)?,
            opponent_level: row.get(9)?,
            difficulty: row.get(17)?,
            victory_conditions: row.get(10)?,
            enabled_mods: row.get(11)?,
            enabled_dlc: row.get(12)?,
            winner_player_id: row.get(13)?,
            winner_name: row.get(14)?,
            winner_civilization: row.get(15)?,
            winner_victory_type: row.get(16)?,
            players: Vec::new(), // Will be filled below
        })
    })?;

    // Get players for this match
    let mut players_stmt = conn.prepare(
        "SELECT player_name, nation, is_human, legitimacy, state_religion
         FROM players
         WHERE match_id = ?
         ORDER BY player_name",
    )?;

    let players = players_stmt
        .query_map([match_id], |row| {
            Ok(PlayerInfo {
                player_name: row.get(0)?,
                nation: row.get(1)?,
                is_human: row.get(2)?,
                legitimacy: row.get(3)?,
                state_religion: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(GameDetails {
        players,
        ..game_details
    })
}

/// Get current laws for all players in a match.
///
/// Returns each player's active laws with actual adoption turns from event_logs.
pub fn get_current_laws(conn: &Connection, match_id: i64) -> duckdb::Result<Vec<PlayerLaw>> {
    // Get the actual adoption turn from event_logs (LAW_ADOPTED events)
    // The laws table only stores placeholder values for adopted_turn
    let mut stmt = conn.prepare(
        "WITH law_adoptions AS (
            -- Extract law adoption events with the law name from description
            SELECT
                e.player_id,
                e.turn,
                regexp_extract(e.description, 'LAW_[A-Z_]+', 0) as law_name
            FROM event_logs e
            WHERE e.match_id = ?
            AND e.log_type = 'LAW_ADOPTED'
            AND e.description IS NOT NULL
         ),
         latest_adoptions AS (
            -- Get the most recent adoption turn for each player+law combination
            SELECT
                player_id,
                law_name,
                MAX(turn) as adopted_turn
            FROM law_adoptions
            GROUP BY player_id, law_name
         )
         SELECT
            l.player_id,
            p.player_name,
            p.nation,
            l.law_category,
            l.law,
            COALESCE(la.adopted_turn, 0) as adopted_turn,
            l.change_count
         FROM laws l
         JOIN players p ON l.player_id = p.player_id AND l.match_id = p.match_id
         LEFT JOIN latest_adoptions la ON l.player_id = la.player_id AND l.law = la.law_name
         WHERE l.match_id = ?
         ORDER BY p.nation, l.law_category",
    )?;

    let laws = stmt
        .query_map([match_id, match_id], |row| {
            Ok(PlayerLaw {
                player_id: row.get(0)?,
                player_name: row.get(1)?,
                nation: row.get(2)?,
                law_category: row.get(3)?,
                law: row.get(4)?,
                adopted_turn: row.get(5)?,
                change_count: row.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(laws)
}

/// Get completed techs for all players in a match.
///
/// Returns each player's completed technologies with discovery turn from event_logs.
pub fn get_completed_techs(conn: &Connection, match_id: i64) -> duckdb::Result<Vec<PlayerTech>> {
    // Get completed techs from event_logs (TECH_DISCOVERED events)
    // This gives us accurate turn numbers unlike the technologies_completed table
    let mut stmt = conn.prepare(
        "SELECT
            e.player_id,
            p.player_name,
            p.nation,
            e.data1 as tech,
            e.turn as completed_turn
         FROM event_logs e
         JOIN players p ON e.player_id = p.player_id AND e.match_id = p.match_id
         WHERE e.match_id = ?
           AND e.log_type = 'TECH_DISCOVERED'
           AND e.data1 IS NOT NULL
         ORDER BY p.nation, e.turn, e.data1",
    )?;

    let techs = stmt
        .query_map([match_id], |row| {
            Ok(PlayerTech {
                player_id: row.get(0)?,
                player_name: row.get(1)?,
                nation: row.get(2)?,
                tech: row.get(3)?,
                completed_turn: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(techs)
}

/// Get story events for a match.
pub fn get_story_events(conn: &Connection, match_id: i64) -> duckdb::Result<Vec<StoryEvent>> {
    let mut stmt = conn.prepare(
        "SELECT
            se.event_id,
            se.event_type,
            p.player_name,
            se.occurred_turn,
            c.first_name as character_name,
            ci.city_name
         FROM story_events se
         JOIN players p ON se.player_id = p.player_id AND se.match_id = p.match_id
         LEFT JOIN characters c ON se.primary_character_id = c.character_id AND se.match_id = c.match_id
         LEFT JOIN cities ci ON se.city_id = ci.city_id AND se.match_id = ci.match_id
         WHERE se.match_id = ?
         ORDER BY se.occurred_turn DESC, se.event_id DESC
         LIMIT 100",
    )?;

    let events = stmt
        .query_map([match_id], |row| {
            Ok(StoryEvent {
                event_id: row.get(0)?,
                event_type: row.get(1)?,
                player_name: row.get(2)?,
                occurred_turn: row.get(3)?,
                primary_character_name: row.get(4)?,
                city_name: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(events)
}

/// Get event logs for a match, deduplicated by stripping markup tags.
pub fn get_event_logs(conn: &Connection, match_id: i64) -> duckdb::Result<Vec<EventLog>> {
    // Strip markup tags from description for grouping to properly deduplicate
    // events that differ only in player-specific markup (e.g., link IDs)
    let mut stmt = conn.prepare(
        "SELECT
            MIN(el.log_id) as log_id,
            el.log_type,
            el.turn,
            CASE
                WHEN COUNT(*) > 1 THEN NULL
                ELSE COALESCE(MAX(p.player_name), 'Player')
            END as player_name,
            MIN(el.description) as description
         FROM event_logs el
         LEFT JOIN players p ON el.player_id = p.player_id AND el.match_id = p.match_id
         WHERE el.match_id = ?
         GROUP BY el.turn, el.log_type, regexp_replace(el.description, '<[^>]*>', '', 'g')
         ORDER BY el.turn DESC, MIN(el.log_id) DESC",
    )?;

    let logs = stmt
        .query_map([match_id], |row| {
            Ok(EventLog {
                log_id: row.get(0)?,
                log_type: row.get(1)?,
                turn: row.get(2)?,
                player_name: row.get(3)?,
                description: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(logs)
}
