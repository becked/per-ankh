// Game listing and statistics queries (collection-filtered)

use crate::types::{GameInfo, GameStatistics, NationStats, SaveDateEntry};
use duckdb::Connection;

/// Get game statistics with nation play counts.
/// Optionally filters by collection_id (None = all games).
pub fn get_game_statistics(
    conn: &Connection,
    collection_id: Option<i32>,
) -> duckdb::Result<GameStatistics> {
    let total_games: i64 = match collection_id {
        Some(cid) => conn.query_row(
            "SELECT COUNT(*) FROM matches WHERE collection_id = ?",
            [cid],
            |row| row.get(0),
        )?,
        None => conn.query_row("SELECT COUNT(*) FROM matches", [], |row| row.get(0))?,
    };

    // Count games per save owner's nation
    // Prefer is_save_owner, fall back to first human player
    let base_query = "SELECT COALESCE(so.nation, fh.nation) as nation, COUNT(*) as games_played
             FROM matches m
             LEFT JOIN (
                 SELECT match_id, nation FROM players WHERE is_save_owner = TRUE
             ) so ON m.match_id = so.match_id
             LEFT JOIN (
                 SELECT match_id, nation,
                        ROW_NUMBER() OVER (PARTITION BY match_id ORDER BY player_id) as rn
                 FROM players WHERE is_human = TRUE
             ) fh ON m.match_id = fh.match_id AND fh.rn = 1
             WHERE COALESCE(so.nation, fh.nation) IS NOT NULL";

    let query = match collection_id {
        Some(_) => format!(
            "{} AND m.collection_id = ? GROUP BY COALESCE(so.nation, fh.nation) ORDER BY games_played DESC",
            base_query
        ),
        None => format!(
            "{} GROUP BY COALESCE(so.nation, fh.nation) ORDER BY games_played DESC",
            base_query
        ),
    };

    let mut stmt = conn.prepare(&query)?;

    let nations = match collection_id {
        Some(cid) => stmt
            .query_map([cid], |row| {
                Ok(NationStats {
                    nation: row.get(0)?,
                    games_played: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?,
        None => stmt
            .query_map([], |row| {
                Ok(NationStats {
                    nation: row.get(0)?,
                    games_played: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?,
    };

    Ok(GameStatistics {
        total_games,
        nations,
    })
}

/// Get save dates with nation info for calendar chart.
/// Optionally filters by collection_id (None = all games).
pub fn get_save_dates(
    conn: &Connection,
    collection_id: Option<i32>,
) -> duckdb::Result<Vec<SaveDateEntry>> {
    let base_query = "SELECT STRFTIME(m.save_date, '%Y-%m-%d') as date, p.nation
         FROM matches m
         LEFT JOIN players p ON m.match_id = p.match_id AND p.is_save_owner = TRUE
         WHERE m.save_date IS NOT NULL";

    let query = match collection_id {
        Some(_) => format!(
            "{} AND m.collection_id = ? ORDER BY m.save_date",
            base_query
        ),
        None => format!("{} ORDER BY m.save_date", base_query),
    };

    let mut stmt = conn.prepare(&query)?;

    let entries = match collection_id {
        Some(cid) => stmt
            .query_map([cid], |row| {
                Ok(SaveDateEntry {
                    date: row.get(0)?,
                    nation: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?,
        None => stmt
            .query_map([], |row| {
                Ok(SaveDateEntry {
                    date: row.get(0)?,
                    nation: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?,
    };

    Ok(entries)
}

/// Get list of all games with basic info, sorted by save date (newest first).
/// Optionally filters by collection_id (None = all games).
pub fn get_games_list(
    conn: &Connection,
    collection_id: Option<i32>,
) -> duckdb::Result<Vec<GameInfo>> {
    // Join with save owner player (is_save_owner = TRUE) to get their nation and player_id
    // Falls back to first human player's nation when save owner is unknown
    let base_query = "SELECT m.match_id, m.game_name, CAST(m.save_date AS VARCHAR) as save_date,
                    m.total_turns,
                    COALESCE(so.nation, fh.nation) as nation,
                    CASE
                        WHEN m.winner_player_id IS NULL THEN NULL
                        WHEN so.player_id IS NOT NULL AND m.winner_player_id = so.player_id THEN TRUE
                        WHEN so.player_id IS NOT NULL THEN FALSE
                        ELSE NULL
                    END as save_owner_won,
                    m.collection_id
             FROM matches m
             LEFT JOIN (
                 SELECT match_id, nation, player_id
                 FROM players WHERE is_save_owner = TRUE
             ) so ON m.match_id = so.match_id
             LEFT JOIN (
                 SELECT match_id, nation, player_id,
                        ROW_NUMBER() OVER (PARTITION BY match_id ORDER BY player_id) as rn
                 FROM players WHERE is_human = TRUE
             ) fh ON m.match_id = fh.match_id AND fh.rn = 1";

    let query = match collection_id {
        Some(_) => format!(
            "{} WHERE m.collection_id = ? ORDER BY m.save_date DESC",
            base_query
        ),
        None => format!("{} ORDER BY m.save_date DESC", base_query),
    };

    let mut stmt = conn.prepare(&query)?;

    let games = match collection_id {
        Some(cid) => stmt
            .query_map([cid], |row| {
                Ok(GameInfo {
                    match_id: row.get(0)?,
                    game_name: row.get(1)?,
                    save_date: row.get(2)?,
                    turn_year: None,
                    total_turns: row.get(3)?,
                    save_owner_nation: row.get(4)?,
                    save_owner_won: row.get(5)?,
                    collection_id: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?,
        None => stmt
            .query_map([], |row| {
                Ok(GameInfo {
                    match_id: row.get(0)?,
                    game_name: row.get(1)?,
                    save_date: row.get(2)?,
                    turn_year: None,
                    total_turns: row.get(3)?,
                    save_owner_nation: row.get(4)?,
                    save_owner_won: row.get(5)?,
                    collection_id: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?,
    };

    Ok(games)
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

    fn insert_match_with_date(conn: &Connection, match_id: i64, total_turns: i32, save_date: &str) {
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns, save_date)
             VALUES (?, ?, 'test.zip', ?, ?, ?::TIMESTAMP)",
            duckdb::params![
                match_id,
                format!("game_{}", match_id),
                format!("hash_{}", match_id),
                total_turns,
                save_date
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

    // ---- Tier 1: Contract tests ----

    #[test]
    fn test_get_game_statistics_empty() {
        let conn = setup_test_db();
        let stats = get_game_statistics(&conn, None).unwrap();
        assert_eq!(stats.total_games, 0);
        assert!(stats.nations.is_empty());
    }

    #[test]
    fn test_get_game_statistics_counts_nations() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        insert_player(&conn, 1, 1, "Rome Player", "NATION_ROME", true, true);
        insert_match(&conn, 2, 60);
        insert_player(&conn, 1, 2, "Greece Player", "NATION_GREECE", true, true);

        let stats = get_game_statistics(&conn, None).unwrap();
        assert_eq!(stats.total_games, 2);
        assert_eq!(stats.nations.len(), 2);
        // Sorted by games_played DESC — both have 1 so alphabetical by nation
    }

    #[test]
    fn test_get_save_dates_empty() {
        let conn = setup_test_db();
        let dates = get_save_dates(&conn, None).unwrap();
        assert!(dates.is_empty());
    }

    #[test]
    fn test_get_save_dates_formats_correctly() {
        let conn = setup_test_db();
        insert_match_with_date(&conn, 1, 50, "2025-07-28 16:15:39");
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME", true, true);

        let dates = get_save_dates(&conn, None).unwrap();
        assert_eq!(dates.len(), 1);
        assert_eq!(dates[0].date, "2025-07-28");
        assert_eq!(dates[0].nation, Some("NATION_ROME".to_string()));
    }

    #[test]
    fn test_get_games_list_empty() {
        let conn = setup_test_db();
        let games = get_games_list(&conn, None).unwrap();
        assert!(games.is_empty());
    }

    #[test]
    fn test_get_games_list_returns_data() {
        let conn = setup_test_db();
        insert_match_with_date(&conn, 1, 50, "2025-07-28 16:15:39");
        conn.execute(
            "UPDATE matches SET game_name = 'Carthage Campaign' WHERE match_id = 1",
            [],
        )
        .unwrap();
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME", true, true);

        let games = get_games_list(&conn, None).unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].match_id, 1);
        assert_eq!(games[0].game_name, Some("Carthage Campaign".to_string()));
        assert_eq!(games[0].total_turns, Some(50));
        assert_eq!(games[0].save_owner_nation, Some("NATION_ROME".to_string()));
    }

    // ---- Tier 2: Synthetic fixture tests ----

    #[test]
    fn test_get_game_statistics_fallback_to_first_human() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        // No save_owner — both are human, should pick first by player_id
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME", true, false);
        insert_player(&conn, 2, 1, "Greece", "NATION_GREECE", true, false);

        let stats = get_game_statistics(&conn, None).unwrap();
        assert_eq!(stats.total_games, 1);
        assert_eq!(stats.nations.len(), 1);
        // Should fall back to player_id=1 (ROME) via ROW_NUMBER
        assert_eq!(stats.nations[0].nation, "NATION_ROME");
    }

    #[test]
    fn test_get_game_statistics_collection_filter() {
        let conn = setup_test_db();
        // Match in default collection (1)
        insert_match(&conn, 1, 50);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME", true, true);

        // Match in different collection
        conn.execute(
            "INSERT INTO collections (collection_id, name, is_default) VALUES (2, 'Challenge', false)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns, collection_id)
             VALUES (2, 'game_2', 'test2.zip', 'hash_2', 60, 2)",
            [],
        )
        .unwrap();
        insert_player(&conn, 1, 2, "Greece", "NATION_GREECE", true, true);

        // All games
        let all = get_game_statistics(&conn, None).unwrap();
        assert_eq!(all.total_games, 2);

        // Filtered to collection 1
        let filtered = get_game_statistics(&conn, Some(1)).unwrap();
        assert_eq!(filtered.total_games, 1);
        assert_eq!(filtered.nations[0].nation, "NATION_ROME");

        // Filtered to collection 2
        let filtered = get_game_statistics(&conn, Some(2)).unwrap();
        assert_eq!(filtered.total_games, 1);
        assert_eq!(filtered.nations[0].nation, "NATION_GREECE");
    }

    #[test]
    fn test_get_games_list_save_owner_won() {
        let conn = setup_test_db();

        // Case 1: Save owner won
        insert_match(&conn, 1, 50);
        conn.execute(
            "UPDATE matches SET winner_player_id = 1 WHERE match_id = 1",
            [],
        )
        .unwrap();
        insert_player(&conn, 1, 1, "Winner", "NATION_ROME", true, true);

        // Case 2: Save owner lost (someone else won)
        insert_match(&conn, 2, 60);
        conn.execute(
            "UPDATE matches SET winner_player_id = 2 WHERE match_id = 2",
            [],
        )
        .unwrap();
        insert_player(&conn, 1, 2, "Loser", "NATION_GREECE", true, true);
        insert_player(&conn, 2, 2, "AI Winner", "NATION_ROME", false, false);

        // Case 3: No winner
        insert_match(&conn, 3, 30);
        insert_player(&conn, 1, 3, "Ongoing", "NATION_EGYPT", true, true);

        let games = get_games_list(&conn, None).unwrap();
        assert_eq!(games.len(), 3);

        // Find each game by match_id
        let won = games.iter().find(|g| g.match_id == 1).unwrap();
        assert_eq!(won.save_owner_won, Some(true));

        let lost = games.iter().find(|g| g.match_id == 2).unwrap();
        assert_eq!(lost.save_owner_won, Some(false));

        let ongoing = games.iter().find(|g| g.match_id == 3).unwrap();
        assert_eq!(ongoing.save_owner_won, None);
    }

    // ---- Tier 3: Real save invariant tests ----

    #[test]
    #[ignore]
    fn test_real_save_game_statistics_invariants() {
        let fixture = match super::super::test_fixtures::get_imported_fixture() {
            Some(f) => f,
            None => return,
        };
        let conn = Connection::open(&fixture.db_path).unwrap();

        let stats = get_game_statistics(&conn, None).unwrap();
        assert!(stats.total_games >= 1);
        assert!(!stats.nations.is_empty());
        // Sum of per-nation counts should equal total
        let sum: i64 = stats.nations.iter().map(|n| n.games_played).sum();
        assert_eq!(sum, stats.total_games);
    }

    #[test]
    #[ignore]
    fn test_real_save_games_list_invariants() {
        let fixture = match super::super::test_fixtures::get_imported_fixture() {
            Some(f) => f,
            None => return,
        };
        let conn = Connection::open(&fixture.db_path).unwrap();

        let games = get_games_list(&conn, None).unwrap();
        assert!(!games.is_empty());
        for game in &games {
            assert!(game.match_id > 0);
            assert!(game.total_turns.unwrap_or(0) > 0);
        }
    }
}
