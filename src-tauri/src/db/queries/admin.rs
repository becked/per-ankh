// Debug and admin queries

use crate::types::{KnownOnlineId, MatchDebugRow, NationDynastyRow, PlayerDebugRow};
use duckdb::Connection;

/// Get all unique combinations of nation and dynasty values.
pub fn get_nation_dynasty_data(conn: &Connection) -> duckdb::Result<Vec<NationDynastyRow>> {
    let mut stmt = conn.prepare(
        "SELECT nation, dynasty, COUNT(*) as count
         FROM players
         GROUP BY nation, dynasty
         ORDER BY nation, dynasty",
    )?;

    let rows = stmt
        .query_map([], |row| {
            Ok(NationDynastyRow {
                nation: row.get(0)?,
                dynasty: row.get(1)?,
                count: row.get(2)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(rows)
}

/// Get all players with debug info.
pub fn get_player_debug_data(conn: &Connection) -> duckdb::Result<Vec<PlayerDebugRow>> {
    let mut stmt = conn.prepare(
        "SELECT match_id, player_name, nation, dynasty, is_human
         FROM players
         ORDER BY match_id, player_name",
    )?;

    let rows = stmt
        .query_map([], |row| {
            Ok(PlayerDebugRow {
                match_id: row.get(0)?,
                player_name: row.get(1)?,
                nation: row.get(2)?,
                dynasty: row.get(3)?,
                is_human: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(rows)
}

/// Get all matches with debug info.
pub fn get_match_debug_data(conn: &Connection) -> duckdb::Result<Vec<MatchDebugRow>> {
    let mut stmt = conn.prepare(
        "SELECT match_id, game_id, game_name, file_name
         FROM matches
         ORDER BY match_id",
    )?;

    let rows = stmt
        .query_map([], |row| {
            Ok(MatchDebugRow {
                match_id: row.get(0)?,
                game_id: row.get(1)?,
                game_name: row.get(2)?,
                file_name: row.get(3)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(rows)
}

/// Debug command to investigate player_id mismatch in event_logs.
///
/// Returns a formatted string with event_log player_ids, players table entries,
/// and a sample of recent event logs.
pub fn debug_event_log_player_ids(conn: &Connection, match_id: i64) -> duckdb::Result<String> {
    // Get distinct player_ids from event_logs
    let mut stmt = conn.prepare(
        "SELECT DISTINCT player_id FROM event_logs WHERE match_id = ? ORDER BY player_id",
    )?;
    let event_log_ids: Vec<Option<i64>> = stmt
        .query_map([match_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;

    // Get player_ids from players table
    let mut stmt = conn.prepare(
        "SELECT player_id, player_name FROM players WHERE match_id = ? ORDER BY player_id",
    )?;
    let players: Vec<(i64, String)> = stmt
        .query_map([match_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;

    // Get a sample of event_logs with their player_ids
    let mut stmt = conn.prepare(
        "SELECT log_id, turn, log_type, player_id, description
         FROM event_logs
         WHERE match_id = ?
         ORDER BY turn DESC
         LIMIT 10",
    )?;
    let sample_logs: Vec<(i64, i32, String, Option<i64>, Option<String>)> = stmt
        .query_map([match_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut result = format!("=== Debug for match_id {} ===\n\n", match_id);

    result.push_str("Player IDs in event_logs:\n");
    for id in &event_log_ids {
        result.push_str(&format!("  {:?}\n", id));
    }

    result.push_str("\nPlayers in players table:\n");
    for (id, name) in &players {
        result.push_str(&format!("  {} - {}\n", id, name));
    }

    result.push_str("\nSample event logs (last 10):\n");
    for (log_id, turn, log_type, player_id, desc) in &sample_logs {
        result.push_str(&format!(
            "  log_id={}, turn={}, type={}, player_id={:?}, desc={}\n",
            log_id,
            turn,
            log_type,
            player_id,
            desc.as_ref()
                .map(|s| &s[..s.len().min(50)])
                .unwrap_or("None")
        ));
    }

    Ok(result)
}

/// Get all known OnlineIDs with player names and save counts.
///
/// Only counts saves in the default collection to prevent challenge games from
/// polluting Primary User detection.
pub fn get_known_online_ids(conn: &Connection) -> duckdb::Result<Vec<KnownOnlineId>> {
    // Use string_agg to get comma-separated player names, then split in Rust
    // DuckDB's list() returns a native list type that's harder to deserialize
    // Only count saves in the default collection for Primary User detection
    let mut stmt = conn.prepare(
        "SELECT p.online_id,
                string_agg(DISTINCT p.player_name, '|||' ORDER BY p.player_name) as player_names,
                COUNT(*) as save_count
         FROM players p
         JOIN matches m ON p.match_id = m.match_id
         JOIN collections c ON m.collection_id = c.collection_id
         WHERE p.online_id IS NOT NULL
           AND p.online_id != ''
           AND c.is_default = TRUE
         GROUP BY p.online_id
         ORDER BY save_count DESC",
    )?;

    let results = stmt
        .query_map([], |row| {
            let names_str: String = row.get(1)?;
            let player_names: Vec<String> = names_str
                .split("|||")
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect();
            Ok(KnownOnlineId {
                online_id: row.get(0)?,
                player_names,
                save_count: row.get(2)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(results)
}
