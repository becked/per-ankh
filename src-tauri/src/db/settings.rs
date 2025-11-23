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
}
