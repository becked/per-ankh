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
