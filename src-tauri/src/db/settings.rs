// User settings management for save owner identification
//
// This module provides functions to get/set user settings stored in the
// user_settings table. Currently used for primary user OnlineID tracking.

use duckdb::Connection;

const PRIMARY_USER_ONLINE_ID_KEY: &str = "primary_user_online_id";

/// Get the configured primary user OnlineID
///
/// Returns None if not configured yet.
pub fn get_primary_user_online_id(conn: &Connection) -> duckdb::Result<Option<String>> {
    let result = conn.query_row(
        "SELECT value FROM user_settings WHERE key = ?",
        [PRIMARY_USER_ONLINE_ID_KEY],
        |row| row.get(0),
    );

    match result {
        Ok(value) => Ok(value),
        Err(duckdb::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Set the primary user OnlineID
///
/// Uses INSERT ... ON CONFLICT to upsert the value.
pub fn set_primary_user_online_id(conn: &Connection, online_id: &str) -> duckdb::Result<()> {
    conn.execute(
        "INSERT INTO user_settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [PRIMARY_USER_ONLINE_ID_KEY, online_id],
    )?;
    Ok(())
}

/// Reprocess save owners for all existing matches based on current primary user OnlineID
///
/// This should be called after changing the primary user OnlineID to fix
/// save owner assignments for previously imported multiplayer games.
///
/// Logic:
/// - Single-player matches (1 human): human is always save owner
/// - Multiplayer matches (2+ humans): match by primary user OnlineID
pub fn reprocess_save_owners(conn: &Connection) -> duckdb::Result<usize> {
    let primary_online_id = get_primary_user_online_id(conn)?;

    // Step 1: Clear all save owner flags
    conn.execute("UPDATE players SET is_save_owner = FALSE", [])?;

    // Step 2: For single-player matches (exactly 1 human), set that human as save owner
    conn.execute(
        "UPDATE players SET is_save_owner = TRUE
         WHERE (match_id, player_id) IN (
             SELECT match_id, player_id FROM (
                 SELECT match_id, player_id,
                        COUNT(*) OVER (PARTITION BY match_id) as human_count
                 FROM players WHERE is_human = TRUE
             ) WHERE human_count = 1
         )",
        [],
    )?;

    // Step 3: For multiplayer matches, set save owner by matching OnlineID
    let multiplayer_updated = if let Some(ref online_id) = primary_online_id {
        conn.execute(
            "UPDATE players SET is_save_owner = TRUE
             WHERE online_id = ?
             AND match_id IN (
                 SELECT match_id FROM players
                 WHERE is_human = TRUE
                 GROUP BY match_id
                 HAVING COUNT(*) > 1
             )",
            [online_id],
        )?
    } else {
        0
    };

    log::info!(
        "Reprocessed save owners (primary_online_id={:?}, multiplayer_updated={})",
        primary_online_id,
        multiplayer_updated
    );

    Ok(multiplayer_updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::create_schema;
    use tempfile::tempdir;

    fn setup_test_db() -> Connection {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();
        // Leak the tempdir so it doesn't get cleaned up while conn is in use
        std::mem::forget(dir);
        conn
    }

    #[test]
    fn test_get_primary_user_online_id_returns_none_when_not_set() {
        let conn = setup_test_db();
        let result = get_primary_user_online_id(&conn).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_set_and_get_primary_user_online_id() {
        let conn = setup_test_db();

        // Set the value
        set_primary_user_online_id(&conn, "12345").unwrap();

        // Get it back
        let result = get_primary_user_online_id(&conn).unwrap();
        assert_eq!(result, Some("12345".to_string()));
    }

    #[test]
    fn test_update_primary_user_online_id() {
        let conn = setup_test_db();

        // Set initial value
        set_primary_user_online_id(&conn, "12345").unwrap();
        assert_eq!(
            get_primary_user_online_id(&conn).unwrap(),
            Some("12345".to_string())
        );

        // Update to new value
        set_primary_user_online_id(&conn, "67890").unwrap();
        assert_eq!(
            get_primary_user_online_id(&conn).unwrap(),
            Some("67890".to_string())
        );
    }

    #[test]
    fn test_reprocess_save_owners_single_player() {
        let conn = setup_test_db();

        // Insert test match
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns) VALUES (1, 'test', 'test.zip', 'abc123', 100)",
            [],
        ).unwrap();

        // Insert single human player (single-player game)
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, is_human, is_save_owner) VALUES (1, 1, 'Human', 'human', 'NATION_ROME', TRUE, FALSE)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, is_human, is_save_owner) VALUES (2, 1, 'AI', 'ai', 'NATION_EGYPT', FALSE, FALSE)",
            [],
        ).unwrap();

        // Run reprocess
        reprocess_save_owners(&conn).unwrap();

        // Human should now be save owner
        let is_owner: bool = conn.query_row(
            "SELECT is_save_owner FROM players WHERE player_id = 1 AND match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(is_owner, "Single human player should be marked as save owner");

        // AI should not be save owner
        let ai_owner: bool = conn.query_row(
            "SELECT is_save_owner FROM players WHERE player_id = 2 AND match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(!ai_owner, "AI player should not be save owner");
    }

    #[test]
    fn test_reprocess_save_owners_multiplayer() {
        let conn = setup_test_db();

        // Insert test match
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns) VALUES (1, 'test', 'test.zip', 'abc123', 100)",
            [],
        ).unwrap();

        // Insert two human players (multiplayer game)
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, is_human, is_save_owner, online_id) VALUES (1, 1, 'PlayerA', 'playera', 'NATION_ROME', TRUE, FALSE, 'AAA')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, is_human, is_save_owner, online_id) VALUES (2, 1, 'PlayerB', 'playerb', 'NATION_EGYPT', TRUE, FALSE, 'BBB')",
            [],
        ).unwrap();

        // Set primary user to PlayerB's OnlineID
        set_primary_user_online_id(&conn, "BBB").unwrap();

        // Run reprocess
        reprocess_save_owners(&conn).unwrap();

        // PlayerA should NOT be save owner
        let a_owner: bool = conn.query_row(
            "SELECT is_save_owner FROM players WHERE player_id = 1 AND match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(!a_owner, "PlayerA should NOT be save owner");

        // PlayerB SHOULD be save owner (matches primary OnlineID)
        let b_owner: bool = conn.query_row(
            "SELECT is_save_owner FROM players WHERE player_id = 2 AND match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(b_owner, "PlayerB should be save owner (matches primary OnlineID)");
    }

    #[test]
    fn test_reprocess_save_owners_changes_with_new_online_id() {
        let conn = setup_test_db();

        // Insert test match
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns) VALUES (1, 'test', 'test.zip', 'abc123', 100)",
            [],
        ).unwrap();

        // Insert two human players
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, is_human, is_save_owner, online_id) VALUES (1, 1, 'PlayerA', 'playera', 'NATION_ROME', TRUE, FALSE, 'AAA')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, is_human, is_save_owner, online_id) VALUES (2, 1, 'PlayerB', 'playerb', 'NATION_EGYPT', TRUE, FALSE, 'BBB')",
            [],
        ).unwrap();

        // Initially set to PlayerA
        set_primary_user_online_id(&conn, "AAA").unwrap();
        reprocess_save_owners(&conn).unwrap();

        let a_owner: bool = conn.query_row(
            "SELECT is_save_owner FROM players WHERE player_id = 1 AND match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(a_owner, "PlayerA should be save owner initially");

        // Now change to PlayerB
        set_primary_user_online_id(&conn, "BBB").unwrap();
        reprocess_save_owners(&conn).unwrap();

        let a_owner: bool = conn.query_row(
            "SELECT is_save_owner FROM players WHERE player_id = 1 AND match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(!a_owner, "PlayerA should NO LONGER be save owner");

        let b_owner: bool = conn.query_row(
            "SELECT is_save_owner FROM players WHERE player_id = 2 AND match_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(b_owner, "PlayerB should NOW be save owner");
    }
}
