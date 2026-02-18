// Query functions for Tauri commands
//
// Organized by domain, following the pattern established in db/collections.rs:
// pure functions taking &Connection, returning duckdb::Result<T>.

pub mod admin;
pub mod games;
pub mod history;
pub mod map;
pub mod match_data;

use crate::types::ReligionInfo;
use duckdb::Connection;
use std::collections::HashMap;

/// Internal player row used by history queries that iterate over players
pub struct PlayerRow {
    pub player_id: i32,
    pub player_name: String,
    pub nation: Option<String>,
}

/// Get all players for a match, ordered by name.
/// Shared by player_history, yield_history, law_adoption_history, tech_discovery_history.
pub fn get_match_players(conn: &Connection, match_id: i64) -> duckdb::Result<Vec<PlayerRow>> {
    let mut stmt = conn.prepare(
        "SELECT player_id, player_name, nation
         FROM players
         WHERE match_id = ?
         ORDER BY player_name",
    )?;

    let rows = stmt
        .query_map([match_id], |row| {
            Ok(PlayerRow {
                player_id: row.get(0)?,
                player_name: row.get(1)?,
                nation: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

/// Get religions grouped by city for a match.
/// Shared by get_map_tiles and get_map_tiles_at_turn.
///
/// Religions are ordered within each city by:
/// 1. State religion first
/// 2. Adoption event turn
/// 3. Acquired turn
/// 4. Alphabetically
pub fn get_city_religions(
    conn: &Connection,
    match_id: i64,
) -> duckdb::Result<HashMap<i64, Vec<ReligionInfo>>> {
    let mut stmt = conn.prepare(
        "SELECT cr.city_id, cr.religion, founder.nation as founder_nation
         FROM city_religions cr
         JOIN religions r ON cr.religion = r.religion_name AND cr.match_id = r.match_id
         LEFT JOIN players founder ON r.founder_player_id = founder.player_id AND r.match_id = founder.match_id
         JOIN cities c ON cr.city_id = c.city_id AND cr.match_id = c.match_id
         LEFT JOIN players owner ON c.player_id = owner.player_id AND c.match_id = owner.match_id
         LEFT JOIN story_events se
             ON se.player_id = owner.player_id
             AND se.match_id = cr.match_id
             AND se.event_type = cr.religion || '.EVENTSTORY_ADOPT_RELIGION'
         WHERE cr.match_id = ?
         ORDER BY
             cr.city_id,
             CASE WHEN cr.religion = owner.state_religion THEN 0 ELSE 1 END,
             se.occurred_turn NULLS LAST,
             cr.acquired_turn NULLS FIRST,
             cr.religion",
    )?;

    let mut city_religions: HashMap<i64, Vec<ReligionInfo>> = HashMap::new();

    let rows = stmt.query_map([match_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;

    for row in rows {
        let (city_id, religion_name, founder_nation) = row?;
        city_religions
            .entry(city_id)
            .or_default()
            .push(ReligionInfo {
                religion_name,
                founder_nation,
            });
    }

    Ok(city_religions)
}

#[cfg(test)]
pub(crate) mod test_fixtures {
    use std::sync::OnceLock;

    pub(crate) struct ImportedFixture {
        pub db_path: std::path::PathBuf,
        pub match_id: i64,
        _dir: tempfile::TempDir,
    }

    // Safety: Only stores PathBuf and TempDir (both Send+Sync).
    // Connection is NOT stored — each test opens its own.
    unsafe impl Send for ImportedFixture {}
    unsafe impl Sync for ImportedFixture {}

    static IMPORTED: OnceLock<Option<ImportedFixture>> = OnceLock::new();

    /// Get a shared imported save file fixture. Returns None if the test file is missing.
    /// Each test should open its own Connection to fixture.db_path for thread safety.
    pub(crate) fn get_imported_fixture() -> Option<&'static ImportedFixture> {
        IMPORTED
            .get_or_init(|| {
                let test_file =
                    "../test-data/saves/OW-Carthage-Year39-2025-11-04-21-38-46.zip";
                if !std::path::Path::new(test_file).exists() {
                    eprintln!("Test file not found, skipping real-save tests");
                    return None;
                }
                let dir = tempfile::tempdir().unwrap();
                let db_path = dir.path().join("test.db");
                let conn = crate::db::connection::get_connection(&db_path).unwrap();
                crate::db::ensure_schema_ready(&conn).unwrap();
                let result = crate::parser::import_save_file(
                    test_file, &conn, None, None, None, None, None,
                );
                match result {
                    Ok(r) if r.success => {
                        let match_id = r.match_id.unwrap();
                        drop(conn);
                        Some(ImportedFixture {
                            db_path,
                            match_id,
                            _dir: dir,
                        })
                    }
                    Ok(r) => {
                        eprintln!("Import failed: {:?}", r.error);
                        None
                    }
                    Err(e) => {
                        eprintln!("Import error: {:?}", e);
                        None
                    }
                }
            })
            .as_ref()
    }
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
            duckdb::params![
                player_id,
                match_id,
                name,
                name.to_lowercase(),
                nation,
                is_human,
                is_save_owner
            ],
        )
        .unwrap();
    }

    // ---- Tier 1: Contract tests ----

    #[test]
    fn test_get_match_players_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        let players = get_match_players(&conn, 1).unwrap();
        assert!(players.is_empty());
    }

    #[test]
    fn test_get_match_players_returns_ordered() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        // Insert in reverse alphabetical order
        insert_player(&conn, 2, 1, "Zenobia", "NATION_EGYPT", false, false);
        insert_player(&conn, 1, 1, "Alexander", "NATION_GREECE", true, true);

        let players = get_match_players(&conn, 1).unwrap();
        assert_eq!(players.len(), 2);
        // Should be alphabetically ordered
        assert_eq!(players[0].player_name, "Alexander");
        assert_eq!(players[0].player_id, 1);
        assert_eq!(players[0].nation, Some("NATION_GREECE".to_string()));
        assert_eq!(players[1].player_name, "Zenobia");
    }

    #[test]
    fn test_get_city_religions_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        let religions = get_city_religions(&conn, 1).unwrap();
        assert!(religions.is_empty());
    }

    // ---- Tier 2: Synthetic fixture tests ----

    #[test]
    fn test_get_city_religions_groups_by_city() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME", true, true);

        // Create a city on a tile
        conn.execute(
            "INSERT INTO tiles (tile_id, match_id, x, y, owner_player_id, owner_city_id)
             VALUES (100, 1, 5, 5, 1, 10)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO cities (city_id, match_id, city_name, player_id, tile_id, founded_turn)
             VALUES (10, 1, 'Roma', 1, 100, 1)",
            [],
        )
        .unwrap();

        // Create two religions
        conn.execute(
            "INSERT INTO religions (religion_id, match_id, religion_name, founder_player_id, founded_turn)
             VALUES (1, 1, 'RELIGION_ZOROASTRIANISM', 1, 5)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO religions (religion_id, match_id, religion_name, founder_player_id, founded_turn)
             VALUES (2, 1, 'RELIGION_JUDAISM', 1, 10)",
            [],
        )
        .unwrap();

        // Assign both religions to the city
        conn.execute(
            "INSERT INTO city_religions (city_id, match_id, religion, acquired_turn)
             VALUES (10, 1, 'RELIGION_ZOROASTRIANISM', 5)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO city_religions (city_id, match_id, religion, acquired_turn)
             VALUES (10, 1, 'RELIGION_JUDAISM', 10)",
            [],
        )
        .unwrap();

        // Set state religion so we can verify ordering
        conn.execute(
            "UPDATE players SET state_religion = 'RELIGION_JUDAISM' WHERE player_id = 1 AND match_id = 1",
            [],
        )
        .unwrap();

        let religions = get_city_religions(&conn, 1).unwrap();
        assert_eq!(religions.len(), 1, "Should have 1 city");

        let city_10 = religions.get(&10).unwrap();
        assert_eq!(city_10.len(), 2, "City should have 2 religions");
        // State religion (Judaism) should sort first
        assert_eq!(city_10[0].religion_name, "RELIGION_JUDAISM");
        assert_eq!(city_10[0].founder_nation, Some("NATION_ROME".to_string()));
        assert_eq!(city_10[1].religion_name, "RELIGION_ZOROASTRIANISM");
    }
}
