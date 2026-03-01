// App-level state that survives database resets.
//
// The app_state and shared_games tables are defined in docs/app_state.sql
// (NOT in docs/schema.sql), so they are not dropped by drop_all_schema_objects().
// This means API keys and share tracking persist across "Reset Database" operations.
//
// These tables ARE lost when the .db file is deleted (crash recovery / schema upgrade),
// which is acceptable: cloud shares still work, the API key is regenerated on next launch.

use anyhow::Context;
use duckdb::Connection;

/// Ensure app state tables exist. Idempotent (uses CREATE TABLE IF NOT EXISTS).
/// Called during app startup after ensure_schema_ready().
pub fn ensure_app_state_tables(conn: &Connection) -> anyhow::Result<()> {
    let sql = include_str!("../../../docs/app_state.sql");
    conn.execute_batch(sql)
        .context("Failed to create app state tables")?;
    log::info!("App state tables initialized");
    Ok(())
}

/// Get the app installation key, creating one if it doesn't exist.
/// The key is a UUID v4 stored in the app_state table.
pub fn get_or_create_app_key(conn: &Connection) -> anyhow::Result<String> {
    // Try to read existing key
    let result = conn.query_row(
        "SELECT value FROM app_state WHERE key = 'app_key'",
        [],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(key) => Ok(key),
        Err(duckdb::Error::QueryReturnedNoRows) => {
            // Generate and store new key
            let key = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO app_state (key, value) VALUES ('app_key', ?)",
                [&key],
            )
            .context("Failed to store app key")?;
            log::info!("Generated new app key");
            Ok(key)
        }
        Err(e) => Err(e).context("Failed to read app key"),
    }
}

/// Share info returned to the frontend. Does NOT include delete_token.
#[derive(serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct ShareInfo {
    pub share_id: String,
    pub share_url: String,
    pub shared_at: String,
}

/// Get share info for a match, if it has been shared.
pub fn get_share_info(conn: &Connection, match_id: i64) -> duckdb::Result<Option<ShareInfo>> {
    let result = conn.query_row(
        "SELECT share_id, share_url, CAST(shared_at AS VARCHAR) FROM shared_games WHERE match_id = ?",
        [match_id],
        |row| {
            Ok(ShareInfo {
                share_id: row.get(0)?,
                share_url: row.get(1)?,
                shared_at: row.get(2)?,
            })
        },
    );

    match result {
        Ok(info) => Ok(Some(info)),
        Err(duckdb::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Save share info after a successful upload.
pub fn save_share_info(
    conn: &Connection,
    match_id: i64,
    share_id: &str,
    share_url: &str,
    delete_token: &str,
) -> duckdb::Result<()> {
    conn.execute(
        "INSERT INTO shared_games (match_id, share_id, share_url, delete_token) VALUES (?, ?, ?, ?)",
        duckdb::params![match_id, share_id, share_url, delete_token],
    )?;
    Ok(())
}

/// Get the delete token for a shared match. Used internally by the delete command.
pub fn get_delete_token(conn: &Connection, match_id: i64) -> duckdb::Result<Option<(String, String)>> {
    let result = conn.query_row(
        "SELECT share_id, delete_token FROM shared_games WHERE match_id = ?",
        [match_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    );

    match result {
        Ok(pair) => Ok(Some(pair)),
        Err(duckdb::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Delete local share tracking for a match.
pub fn delete_share_info(conn: &Connection, match_id: i64) -> duckdb::Result<()> {
    conn.execute(
        "DELETE FROM shared_games WHERE match_id = ?",
        [match_id],
    )?;
    Ok(())
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
        ensure_app_state_tables(&conn).unwrap();
        // Leak the tempdir so it doesn't get cleaned up while conn is in use
        std::mem::forget(dir);
        conn
    }

    #[test]
    fn test_ensure_app_state_tables_is_idempotent() {
        let conn = setup_test_db();
        // Call again — should not error
        ensure_app_state_tables(&conn).unwrap();
    }

    #[test]
    fn test_get_or_create_app_key_creates_on_first_call() {
        let conn = setup_test_db();
        let key = get_or_create_app_key(&conn).unwrap();
        assert!(!key.is_empty());
        // Should be a valid UUID
        assert!(uuid::Uuid::parse_str(&key).is_ok());
    }

    #[test]
    fn test_get_or_create_app_key_returns_same_key() {
        let conn = setup_test_db();
        let key1 = get_or_create_app_key(&conn).unwrap();
        let key2 = get_or_create_app_key(&conn).unwrap();
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_app_state_survives_schema_reset() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();
        ensure_app_state_tables(&conn).unwrap();

        // Store data in app state tables
        let key = get_or_create_app_key(&conn).unwrap();
        save_share_info(&conn, 42, "test_share_id_12345", "https://example.com/share/test", "delete_token_123")
            .unwrap();

        // Simulate database reset (only drops schema.sql tables)
        crate::db::schema::drop_all_schema_objects(&conn).unwrap();
        create_schema(&conn).unwrap();

        // App state tables should still exist with data
        let key_after = get_or_create_app_key(&conn).unwrap();
        assert_eq!(key, key_after, "App key should survive schema reset");

        let share = get_share_info(&conn, 42).unwrap();
        assert!(share.is_some(), "Share info should survive schema reset");
        assert_eq!(share.unwrap().share_id, "test_share_id_12345");

        std::mem::forget(dir);
    }

    #[test]
    fn test_share_info_round_trip() {
        let conn = setup_test_db();

        // Initially not shared
        let info = get_share_info(&conn, 1).unwrap();
        assert!(info.is_none());

        // Save share info
        save_share_info(&conn, 1, "abc123", "https://per-ankh.app/share/abc123", "del_token")
            .unwrap();

        // Now it should be found
        let info = get_share_info(&conn, 1).unwrap().unwrap();
        assert_eq!(info.share_id, "abc123");
        assert_eq!(info.share_url, "https://per-ankh.app/share/abc123");

        // Delete token should be accessible internally
        let (share_id, token) = get_delete_token(&conn, 1).unwrap().unwrap();
        assert_eq!(share_id, "abc123");
        assert_eq!(token, "del_token");
    }

    #[test]
    fn test_delete_share_info() {
        let conn = setup_test_db();
        save_share_info(&conn, 1, "abc123", "https://example.com", "tok").unwrap();

        delete_share_info(&conn, 1).unwrap();

        let info = get_share_info(&conn, 1).unwrap();
        assert!(info.is_none());
    }

    #[test]
    fn test_duplicate_match_id_fails() {
        let conn = setup_test_db();
        save_share_info(&conn, 1, "abc123", "https://example.com", "tok1").unwrap();

        let result = save_share_info(&conn, 1, "def456", "https://example.com/2", "tok2");
        assert!(result.is_err(), "Duplicate match_id should fail");
    }
}
