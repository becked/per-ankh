// Collections management for organizing matches
//
// Allows users to organize matches into collections (e.g., "Personal", "Challenge Games")
// to filter stats and prevent player name pollution in Primary User detection.

use duckdb::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct Collection {
    pub collection_id: i32,
    pub name: String,
    pub is_default: bool,
    #[ts(type = "number")]
    pub match_count: i64,
}

/// Get all collections with their match counts
pub fn get_collections(conn: &Connection) -> duckdb::Result<Vec<Collection>> {
    let mut stmt = conn.prepare(
        "SELECT c.collection_id, c.name, c.is_default, COUNT(m.match_id) as match_count
         FROM collections c
         LEFT JOIN matches m ON c.collection_id = m.collection_id
         GROUP BY c.collection_id, c.name, c.is_default
         ORDER BY c.collection_id"
    )?;

    let results = stmt
        .query_map([], |row| {
            Ok(Collection {
                collection_id: row.get(0)?,
                name: row.get(1)?,
                is_default: row.get(2)?,
                match_count: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(results)
}

/// Create a new collection with the given name
pub fn create_collection(conn: &Connection, name: &str) -> duckdb::Result<Collection> {
    conn.execute(
        "INSERT INTO collections (name, is_default) VALUES (?, FALSE)",
        [name],
    )?;

    conn.query_row(
        "SELECT collection_id, name, is_default, 0 as match_count
         FROM collections WHERE name = ?",
        [name],
        |row| {
            Ok(Collection {
                collection_id: row.get(0)?,
                name: row.get(1)?,
                is_default: row.get(2)?,
                match_count: 0,
            })
        },
    )
}

/// Rename an existing collection
pub fn rename_collection(conn: &Connection, collection_id: i32, name: &str) -> duckdb::Result<()> {
    conn.execute(
        "UPDATE collections SET name = ? WHERE collection_id = ?",
        duckdb::params![name, collection_id],
    )?;
    Ok(())
}

/// Delete a collection, moving its matches to the default collection
///
/// The default collection cannot be deleted.
pub fn delete_collection(conn: &Connection, collection_id: i32) -> duckdb::Result<()> {
    // Get default collection ID
    let default_id: i32 = conn.query_row(
        "SELECT collection_id FROM collections WHERE is_default = TRUE",
        [],
        |row| row.get(0),
    )?;

    // Move matches to default collection before deleting
    conn.execute(
        "UPDATE matches SET collection_id = ? WHERE collection_id = ?",
        duckdb::params![default_id, collection_id],
    )?;

    // Delete the collection (only if not default - the WHERE clause prevents deleting default)
    conn.execute(
        "DELETE FROM collections WHERE collection_id = ? AND is_default = FALSE",
        [collection_id],
    )?;
    Ok(())
}

/// Set a collection as the default
///
/// Only one collection can be the default at a time.
pub fn set_default_collection(conn: &Connection, collection_id: i32) -> duckdb::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE collections SET is_default = FALSE", [])?;
    tx.execute(
        "UPDATE collections SET is_default = TRUE WHERE collection_id = ?",
        [collection_id],
    )?;
    tx.commit()
}

/// Move specific matches to a collection
///
/// Returns the number of matches moved.
pub fn move_matches_to_collection(
    conn: &Connection,
    match_ids: &[i64],
    collection_id: i32,
) -> duckdb::Result<usize> {
    if match_ids.is_empty() {
        return Ok(0);
    }

    // Build IN clause with integer values - safe since these are i64 values, no injection risk
    let ids_str: String = match_ids
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(", ");

    // NOTE: ids_str contains only numeric values from i64::to_string(), not user input,
    // making this format! safe from SQL injection
    let query = format!(
        "UPDATE matches SET collection_id = ? WHERE match_id IN ({})",
        ids_str
    );

    let count = conn.execute(&query, duckdb::params![collection_id])?;

    Ok(count)
}

/// Move matches by game name pattern to a collection
///
/// Uses SQL LIKE pattern matching (% for wildcard).
/// Returns the number of matches moved.
pub fn move_matches_by_game_name(
    conn: &Connection,
    pattern: &str,
    collection_id: i32,
) -> duckdb::Result<usize> {
    let count = conn.execute(
        "UPDATE matches SET collection_id = ? WHERE game_name LIKE ?",
        duckdb::params![collection_id, pattern],
    )?;

    Ok(count)
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
    fn test_get_collections_returns_default() {
        let conn = setup_test_db();
        let collections = get_collections(&conn).unwrap();

        assert_eq!(collections.len(), 1);
        assert_eq!(collections[0].name, "Personal");
        assert!(collections[0].is_default);
        assert_eq!(collections[0].match_count, 0);
    }

    #[test]
    fn test_create_collection() {
        let conn = setup_test_db();
        let collection = create_collection(&conn, "Challenge Games").unwrap();

        assert_eq!(collection.name, "Challenge Games");
        assert!(!collection.is_default);
        assert_eq!(collection.match_count, 0);

        let all = get_collections(&conn).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_rename_collection() {
        let conn = setup_test_db();

        // Create a collection
        let collection = create_collection(&conn, "Old Name").unwrap();

        // Rename it
        rename_collection(&conn, collection.collection_id, "New Name").unwrap();

        // Verify the rename
        let all = get_collections(&conn).unwrap();
        let renamed = all.iter().find(|c| c.collection_id == collection.collection_id).unwrap();
        assert_eq!(renamed.name, "New Name");
    }

    #[test]
    fn test_delete_collection_moves_matches_to_default() {
        let conn = setup_test_db();

        // Create a new collection
        let challenge = create_collection(&conn, "Challenge").unwrap();

        // Insert a match in the challenge collection
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns, collection_id)
             VALUES (1, 'test', 'test.zip', 'abc', 100, ?)",
            [challenge.collection_id],
        )
        .unwrap();

        // Delete the collection
        delete_collection(&conn, challenge.collection_id).unwrap();

        // Match should be moved to default collection (id=1)
        let collection_id: i32 = conn
            .query_row(
                "SELECT collection_id FROM matches WHERE match_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(collection_id, 1);

        // Collection should be deleted
        let collections = get_collections(&conn).unwrap();
        assert_eq!(collections.len(), 1);
        assert_eq!(collections[0].name, "Personal");
    }

    #[test]
    fn test_cannot_delete_default_collection() {
        let conn = setup_test_db();

        // Try to delete the default collection - should do nothing
        delete_collection(&conn, 1).unwrap();

        // Default collection should still exist
        let collections = get_collections(&conn).unwrap();
        assert_eq!(collections.len(), 1);
        assert!(collections[0].is_default);
    }

    #[test]
    fn test_set_default_collection() {
        let conn = setup_test_db();

        // Create a new collection
        let new_collection = create_collection(&conn, "New Default").unwrap();

        // Set it as default
        set_default_collection(&conn, new_collection.collection_id).unwrap();

        // Verify
        let collections = get_collections(&conn).unwrap();
        let old_default = collections.iter().find(|c| c.name == "Personal").unwrap();
        let new_default = collections.iter().find(|c| c.name == "New Default").unwrap();

        assert!(!old_default.is_default);
        assert!(new_default.is_default);
    }

    #[test]
    fn test_move_matches_to_collection() {
        let conn = setup_test_db();

        // Create a collection
        let challenge = create_collection(&conn, "Challenge").unwrap();

        // Insert some matches in the default collection
        for i in 1..=3 {
            conn.execute(
                "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns)
                 VALUES (?, ?, ?, ?, 100)",
                duckdb::params![i, format!("game{}", i), format!("file{}.zip", i), format!("hash{}", i)],
            )
            .unwrap();
        }

        // Move matches 1 and 2 to the challenge collection
        let moved = move_matches_to_collection(&conn, &[1, 2], challenge.collection_id).unwrap();
        assert_eq!(moved, 2);

        // Verify match 1 and 2 are in challenge collection
        let c1: i32 = conn.query_row("SELECT collection_id FROM matches WHERE match_id = 1", [], |r| r.get(0)).unwrap();
        let c2: i32 = conn.query_row("SELECT collection_id FROM matches WHERE match_id = 2", [], |r| r.get(0)).unwrap();
        let c3: i32 = conn.query_row("SELECT collection_id FROM matches WHERE match_id = 3", [], |r| r.get(0)).unwrap();

        assert_eq!(c1, challenge.collection_id);
        assert_eq!(c2, challenge.collection_id);
        assert_eq!(c3, 1); // Still in default
    }

    #[test]
    fn test_move_matches_by_game_name() {
        let conn = setup_test_db();

        // Create challenge collection
        let challenge = create_collection(&conn, "Challenge").unwrap();

        // Insert matches with different names
        conn.execute(
            "INSERT INTO matches (match_id, game_id, game_name, file_name, file_hash, total_turns)
             VALUES (1, 'g1', 'Challenge Map 24', 'a.zip', 'a', 100)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO matches (match_id, game_id, game_name, file_name, file_hash, total_turns)
             VALUES (2, 'g2', 'Challenge Map 25', 'b.zip', 'b', 100)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO matches (match_id, game_id, game_name, file_name, file_hash, total_turns)
             VALUES (3, 'g3', 'My Normal Game', 'c.zip', 'c', 100)",
            [],
        )
        .unwrap();

        // Move challenge maps using pattern
        let moved = move_matches_by_game_name(&conn, "Challenge Map%", challenge.collection_id).unwrap();
        assert_eq!(moved, 2);

        // Verify
        let challenge_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM matches WHERE collection_id = ?",
                [challenge.collection_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(challenge_count, 2);
    }

    #[test]
    fn test_match_count_reflects_actual_matches() {
        let conn = setup_test_db();

        // Create challenge collection
        let challenge = create_collection(&conn, "Challenge").unwrap();

        // Insert matches - 2 in default, 1 in challenge
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns, collection_id)
             VALUES (1, 'g1', 'a.zip', 'a', 100, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns, collection_id)
             VALUES (2, 'g2', 'b.zip', 'b', 100, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns, collection_id)
             VALUES (3, 'g3', 'c.zip', 'c', 100, ?)",
            [challenge.collection_id],
        )
        .unwrap();

        // Check match counts
        let collections = get_collections(&conn).unwrap();
        let personal = collections.iter().find(|c| c.name == "Personal").unwrap();
        let challenge = collections.iter().find(|c| c.name == "Challenge").unwrap();

        assert_eq!(personal.match_count, 2);
        assert_eq!(challenge.match_count, 1);
    }
}
