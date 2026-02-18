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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::create_schema;
    use duckdb::Connection;
    use tempfile::tempdir;

    fn setup_test_db() -> Connection {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();
        std::mem::forget(dir);
        conn
    }

    fn insert_match(conn: &Connection, match_id: i64, total_turns: i32) {
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns)
             VALUES (?, ?, 'test.zip', ?, ?)",
            duckdb::params![
                match_id,
                format!("game_{}", match_id),
                format!("hash_{}", match_id),
                total_turns
            ],
        )
        .unwrap();
    }

    fn insert_player(
        conn: &Connection,
        player_id: i32,
        match_id: i64,
        name: &str,
        nation: &str,
        is_human: bool,
        is_save_owner: bool,
    ) {
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, is_human, is_save_owner)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            duckdb::params![player_id, match_id, name, name.to_lowercase(), nation, is_human, is_save_owner],
        )
        .unwrap();
    }

    fn insert_player_with_online_id(
        conn: &Connection,
        player_id: i32,
        match_id: i64,
        name: &str,
        nation: &str,
        online_id: &str,
    ) {
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, is_human, is_save_owner, online_id)
             VALUES (?, ?, ?, ?, ?, true, false, ?)",
            duckdb::params![player_id, match_id, name, name.to_lowercase(), nation, online_id],
        )
        .unwrap();
    }

    // ---- Tier 1: Contract tests ----

    #[test]
    fn test_get_nation_dynasty_data_empty() {
        let conn = setup_test_db();
        let data = get_nation_dynasty_data(&conn).unwrap();
        assert!(data.is_empty());
    }

    #[test]
    fn test_get_nation_dynasty_data_groups() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        insert_player(&conn, 1, 1, "Player1", "NATION_ROME", true, true);
        conn.execute(
            "UPDATE players SET dynasty = 'DYNASTY_JULIUS' WHERE player_id = 1 AND match_id = 1",
            [],
        )
        .unwrap();
        insert_player(&conn, 2, 1, "Player2", "NATION_ROME", false, false);
        conn.execute(
            "UPDATE players SET dynasty = 'DYNASTY_JULIUS' WHERE player_id = 2 AND match_id = 1",
            [],
        )
        .unwrap();
        insert_player(&conn, 3, 1, "Player3", "NATION_GREECE", false, false);

        let data = get_nation_dynasty_data(&conn).unwrap();
        assert_eq!(data.len(), 2); // ROME/JULIUS + GREECE/NULL
        // Ordered by nation, dynasty
        assert_eq!(data[0].nation, Some("NATION_GREECE".to_string()));
        assert_eq!(data[0].count, 1);
        assert_eq!(data[1].nation, Some("NATION_ROME".to_string()));
        assert_eq!(data[1].dynasty, Some("DYNASTY_JULIUS".to_string()));
        assert_eq!(data[1].count, 2);
    }

    #[test]
    fn test_get_player_debug_data_returns_all() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        insert_match(&conn, 2, 20);
        insert_player(&conn, 1, 1, "Alpha", "NATION_ROME", true, true);
        insert_player(&conn, 1, 2, "Beta", "NATION_GREECE", true, true);

        let data = get_player_debug_data(&conn).unwrap();
        assert_eq!(data.len(), 2);
        assert_eq!(data[0].match_id, 1);
        assert_eq!(data[0].player_name, "Alpha");
        assert_eq!(data[1].match_id, 2);
        assert_eq!(data[1].player_name, "Beta");
    }

    #[test]
    fn test_get_match_debug_data_returns_all() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        insert_match(&conn, 2, 20);

        let data = get_match_debug_data(&conn).unwrap();
        assert_eq!(data.len(), 2);
        assert_eq!(data[0].match_id, 1);
        assert_eq!(data[0].game_id, "game_1");
        assert_eq!(data[1].match_id, 2);
    }

    #[test]
    fn test_debug_event_log_player_ids_formatted() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME", true, true);
        conn.execute(
            "INSERT INTO event_logs (log_id, match_id, turn, log_type, player_id, description)
             VALUES (1, 1, 5, 'TECH_DISCOVERED', 1, 'Discovered something')",
            [],
        )
        .unwrap();

        let result = debug_event_log_player_ids(&conn, 1).unwrap();
        assert!(result.contains("=== Debug for match_id 1 ==="));
        assert!(result.contains("Player IDs in event_logs"));
        assert!(result.contains("Rome"));
    }

    #[test]
    fn test_get_known_online_ids_empty() {
        let conn = setup_test_db();
        let data = get_known_online_ids(&conn).unwrap();
        assert!(data.is_empty());
    }

    // ---- Tier 2: Synthetic fixture tests ----

    #[test]
    fn test_get_known_online_ids_requires_default_collection() {
        let conn = setup_test_db();
        // Default collection (id=1) already created by schema

        // Create a non-default collection
        conn.execute(
            "INSERT INTO collections (collection_id, name, is_default) VALUES (2, 'Challenge', false)",
            [],
        )
        .unwrap();

        // Match in default collection with online_id
        insert_match(&conn, 1, 10);
        insert_player_with_online_id(&conn, 1, 1, "Rome", "NATION_ROME", "ONLINE_123");

        // Match in non-default collection with online_id
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns, collection_id)
             VALUES (2, 'game_2', 'test2.zip', 'hash_2', 10, 2)",
            [],
        )
        .unwrap();
        insert_player_with_online_id(&conn, 1, 2, "Greece", "NATION_GREECE", "ONLINE_456");

        let data = get_known_online_ids(&conn).unwrap();
        // Only ONLINE_123 from default collection should appear
        assert_eq!(data.len(), 1);
        assert_eq!(data[0].online_id, "ONLINE_123");
    }

    #[test]
    fn test_get_known_online_ids_splits_names() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        insert_match(&conn, 2, 10);

        // Same online_id, different player names across matches
        insert_player_with_online_id(&conn, 1, 1, "Emperor Marcus", "NATION_ROME", "STEAM_42");
        insert_player_with_online_id(&conn, 1, 2, "King Marcus", "NATION_ROME", "STEAM_42");

        let data = get_known_online_ids(&conn).unwrap();
        assert_eq!(data.len(), 1);
        assert_eq!(data[0].online_id, "STEAM_42");
        assert_eq!(data[0].save_count, 2);
        // player_names should contain both distinct names
        assert_eq!(data[0].player_names.len(), 2);
        assert!(data[0].player_names.contains(&"Emperor Marcus".to_string()));
        assert!(data[0].player_names.contains(&"King Marcus".to_string()));
    }
}
