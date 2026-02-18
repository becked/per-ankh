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
