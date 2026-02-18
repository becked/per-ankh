// Player history timeline queries (player loop pattern)

use super::{get_match_players, PlayerRow};
use crate::types::{
    LawAdoptionDataPoint, LawAdoptionHistory, PlayerHistory, PlayerHistoryPoint,
    TechDiscoveryDataPoint, TechDiscoveryHistory, YieldDataPoint, YieldHistory,
};
use duckdb::Connection;

/// Get player history (victory points, military power, legitimacy) with forward-fill.
///
/// Generates a complete turn sequence and fills gaps using DuckDB LAST_VALUE window function.
pub fn get_player_history(
    conn: &Connection,
    match_id: i64,
) -> duckdb::Result<Vec<PlayerHistory>> {
    // Get total turns for this match to generate complete turn sequence
    let total_turns: i32 = conn.query_row(
        "SELECT total_turns FROM matches WHERE match_id = ?",
        [match_id],
        |row| row.get(0),
    )?;

    let players = get_match_players(conn, match_id)?;
    let mut result = Vec::new();

    for PlayerRow {
        player_id,
        player_name,
        nation,
    } in players
    {
        // Query with forward-fill using DuckDB window functions.
        // Generates complete turn sequence and fills gaps with LAST_VALUE.
        let mut history_stmt = conn.prepare(
            "WITH turns AS (
                SELECT UNNEST(RANGE(1, ? + 1)) AS turn
            ),
            sparse_data AS (
                SELECT
                    t.turn,
                    ph.points,
                    mh.military_power,
                    lh.legitimacy
                FROM turns t
                LEFT JOIN points_history ph
                    ON ph.match_id = ? AND ph.player_id = ? AND ph.turn = t.turn
                LEFT JOIN military_history mh
                    ON mh.match_id = ? AND mh.player_id = ? AND mh.turn = t.turn
                LEFT JOIN legitimacy_history lh
                    ON lh.match_id = ? AND lh.player_id = ? AND lh.turn = t.turn
            )
            SELECT
                turn,
                LAST_VALUE(points IGNORE NULLS) OVER (
                    ORDER BY turn ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS points,
                LAST_VALUE(military_power IGNORE NULLS) OVER (
                    ORDER BY turn ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS military_power,
                LAST_VALUE(legitimacy IGNORE NULLS) OVER (
                    ORDER BY turn ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS legitimacy
            FROM sparse_data
            ORDER BY turn",
        )?;

        let history: Vec<PlayerHistoryPoint> = history_stmt
            .query_map(
                [
                    total_turns,
                    match_id as i32,
                    player_id,
                    match_id as i32,
                    player_id,
                    match_id as i32,
                    player_id,
                ],
                |row| {
                    Ok(PlayerHistoryPoint {
                        turn: row.get(0)?,
                        points: row.get(1)?,
                        military_power: row.get(2)?,
                        legitimacy: row.get(3)?,
                    })
                },
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        result.push(PlayerHistory {
            player_id,
            player_name,
            nation,
            history,
        });
    }

    Ok(result)
}

/// Get yield history for specific yield types with forward-fill.
///
/// Prefers yield_total_history (accurate cumulative totals) when available,
/// falls back to yield_history (rate-based) for older saves.
pub fn get_yield_history(
    conn: &Connection,
    match_id: i64,
    yield_types: &[String],
) -> duckdb::Result<Vec<YieldHistory>> {
    // Get total turns for this match to generate complete turn sequence
    let total_turns: i32 = conn.query_row(
        "SELECT total_turns FROM matches WHERE match_id = ?",
        [match_id],
        |row| row.get(0),
    )?;

    let players = get_match_players(conn, match_id)?;
    let mut result = Vec::new();

    for PlayerRow {
        player_id,
        player_name,
        nation,
    } in players
    {
        for yield_type in yield_types {
            // Query with forward-fill using DuckDB window functions.
            // Prefers yield_total_history (accurate totals) when available,
            // falls back to yield_history (rate-based) for older saves.
            let mut yield_stmt = conn.prepare(
                "WITH turns AS (
                    SELECT UNNEST(RANGE(1, ? + 1)) AS turn
                ),
                source_data AS (
                    SELECT
                        t.turn,
                        COALESCE(tot.amount, rate.amount) AS amount
                    FROM turns t
                    LEFT JOIN yield_total_history tot
                        ON tot.match_id = ? AND tot.player_id = ? AND tot.yield_type = ? AND tot.turn = t.turn
                    LEFT JOIN yield_history rate
                        ON rate.match_id = ? AND rate.player_id = ? AND rate.yield_type = ? AND rate.turn = t.turn
                )
                SELECT
                    turn,
                    LAST_VALUE(amount / 10.0 IGNORE NULLS) OVER (
                        ORDER BY turn ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) AS display_amount
                FROM source_data
                ORDER BY turn",
            )?;

            let params: [&dyn duckdb::ToSql; 7] = [
                &total_turns,
                &match_id,
                &(player_id as i64),
                &yield_type.as_str(),
                &match_id,
                &(player_id as i64),
                &yield_type.as_str(),
            ];
            let data: Vec<YieldDataPoint> = yield_stmt
                .query_map(&params[..], |row| {
                    Ok(YieldDataPoint {
                        turn: row.get(0)?,
                        amount: row.get(1)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;

            result.push(YieldHistory {
                player_id,
                player_name: player_name.clone(),
                nation: nation.clone(),
                yield_type: yield_type.clone(),
                data,
            });
        }
    }

    Ok(result)
}

/// Get cumulative law adoption history for all players in a match.
///
/// Returns law adoption events with running cumulative law class count.
pub fn get_law_adoption_history(
    conn: &Connection,
    match_id: i64,
) -> duckdb::Result<Vec<LawAdoptionHistory>> {
    // Get the final turn number for this match
    let final_turn: i32 = conn.query_row(
        "SELECT total_turns FROM matches WHERE match_id = ?",
        [match_id],
        |row| row.get(0),
    )?;

    let players = get_match_players(conn, match_id)?;
    let mut result = Vec::new();

    for PlayerRow {
        player_id,
        player_name,
        nation,
    } in players
    {
        // Get ALL law adoption events with their names and running cumulative law class count.
        // This includes switches within the same class (which don't change the count).
        //
        // Note: data1 is NULL because law names (strings) can't be parsed as integers.
        // Instead, we extract the law name from the description field using regex.
        // Description format: "Adopted <link=HELP_LINK,HELP_LAW,LAW_XXX>Name</link>"
        let mut law_stmt = conn.prepare(
            "WITH law_mapping AS (
                -- Build a mapping of law -> law_category from all imported games
                SELECT DISTINCT law, law_category FROM laws
             ),
             all_law_events AS (
                -- Extract all law adoption events with law names
                SELECT
                    e.turn,
                    regexp_extract(e.description, 'HELP_LAW,([A-Z_]+)', 1) as law_name,
                    e.log_id
                FROM event_logs e
                WHERE e.match_id = ?
                  AND e.player_id = ?
                  AND e.log_type = 'LAW_ADOPTED'
                  AND e.description IS NOT NULL
             ),
             events_with_class AS (
                -- Join with law mapping to get law classes
                SELECT
                    ale.turn,
                    ale.law_name,
                    m.law_category,
                    ale.log_id
                FROM all_law_events ale
                JOIN law_mapping m ON ale.law_name = m.law
                WHERE ale.law_name IS NOT NULL
             ),
             first_class_adoption AS (
                -- For each law class, find the first turn it was adopted
                SELECT law_category, MIN(turn) as first_turn
                FROM events_with_class
                GROUP BY law_category
             ),
             events_with_cumulative AS (
                -- For each event, calculate cumulative law classes up to and including that turn
                SELECT
                    e.turn,
                    e.law_name,
                    e.log_id,
                    (SELECT COUNT(*) FROM first_class_adoption f WHERE f.first_turn <= e.turn) as cumulative_law_classes
                FROM events_with_class e
             )
             SELECT turn, cumulative_law_classes, law_name
             FROM events_with_cumulative
             ORDER BY turn, log_id",
        )?;

        let mut data: Vec<LawAdoptionDataPoint> = law_stmt
            .query_map([match_id, player_id as i64], |row| {
                Ok(LawAdoptionDataPoint {
                    turn: row.get(0)?,
                    law_count: row.get(1)?,
                    law_name: row.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        // Prepend a starting point at turn 0 with 0 laws so the line starts from the origin
        data.insert(
            0,
            LawAdoptionDataPoint {
                turn: 0,
                law_count: 0,
                law_name: None,
            },
        );

        // Append an ending point at the final turn to extend the line to the end of the chart
        if let Some(last_point) = data.last() {
            if last_point.turn < final_turn {
                data.push(LawAdoptionDataPoint {
                    turn: final_turn,
                    law_count: last_point.law_count,
                    law_name: None,
                });
            }
        }

        result.push(LawAdoptionHistory {
            player_id,
            player_name,
            nation,
            data,
        });
    }

    Ok(result)
}

/// Get cumulative tech discovery history for all players in a match.
///
/// Returns tech discovery events with running cumulative count.
pub fn get_tech_discovery_history(
    conn: &Connection,
    match_id: i64,
) -> duckdb::Result<Vec<TechDiscoveryHistory>> {
    // Get the final turn number for this match
    let final_turn: i32 = conn.query_row(
        "SELECT total_turns FROM matches WHERE match_id = ?",
        [match_id],
        |row| row.get(0),
    )?;

    let players = get_match_players(conn, match_id)?;
    let mut result = Vec::new();

    for PlayerRow {
        player_id,
        player_name,
        nation,
    } in players
    {
        // Get tech discoveries from event_logs (TECH_DISCOVERED events)
        // data1 contains the tech name for these events
        let mut tech_stmt = conn.prepare(
            "WITH tech_discoveries AS (
                SELECT
                    turn,
                    data1 as tech_name,
                    ROW_NUMBER() OVER (ORDER BY turn, log_id) as cumulative_count
                FROM event_logs
                WHERE match_id = ?
                  AND player_id = ?
                  AND log_type = 'TECH_DISCOVERED'
                  AND data1 IS NOT NULL
             )
             SELECT turn, cumulative_count, tech_name
             FROM tech_discoveries
             ORDER BY turn, cumulative_count",
        )?;

        let mut data: Vec<TechDiscoveryDataPoint> = tech_stmt
            .query_map([match_id, player_id as i64], |row| {
                Ok(TechDiscoveryDataPoint {
                    turn: row.get(0)?,
                    tech_count: row.get(1)?,
                    tech_name: row.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        // Prepend a starting point at turn 0 with 0 techs
        data.insert(
            0,
            TechDiscoveryDataPoint {
                turn: 0,
                tech_count: 0,
                tech_name: None,
            },
        );

        // Append an ending point at the final turn to extend the line
        if let Some(last_point) = data.last() {
            if last_point.turn < final_turn {
                data.push(TechDiscoveryDataPoint {
                    turn: final_turn,
                    tech_count: last_point.tech_count,
                    tech_name: None,
                });
            }
        }

        result.push(TechDiscoveryHistory {
            player_id,
            player_name,
            nation,
            data,
        });
    }

    Ok(result)
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
    ) {
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, is_human, is_save_owner)
             VALUES (?, ?, ?, ?, ?, true, true)",
            duckdb::params![player_id, match_id, name, name.to_lowercase(), nation],
        )
        .unwrap();
    }

    fn insert_points_history(conn: &Connection, match_id: i64, player_id: i32, turn: i32, points: i32) {
        conn.execute(
            "INSERT INTO points_history (player_id, match_id, turn, points) VALUES (?, ?, ?, ?)",
            duckdb::params![player_id, match_id, turn, points],
        )
        .unwrap();
    }

    fn insert_yield_total_history(
        conn: &Connection,
        match_id: i64,
        player_id: i32,
        yield_type: &str,
        turn: i32,
        amount: i32,
    ) {
        conn.execute(
            "INSERT INTO yield_total_history (player_id, match_id, turn, yield_type, amount) VALUES (?, ?, ?, ?, ?)",
            duckdb::params![player_id, match_id, turn, yield_type, amount],
        )
        .unwrap();
    }

    fn insert_yield_history(
        conn: &Connection,
        match_id: i64,
        player_id: i32,
        yield_type: &str,
        turn: i32,
        amount: i32,
    ) {
        conn.execute(
            "INSERT INTO yield_history (player_id, match_id, turn, yield_type, amount) VALUES (?, ?, ?, ?, ?)",
            duckdb::params![player_id, match_id, turn, yield_type, amount],
        )
        .unwrap();
    }

    fn insert_event_log(
        conn: &Connection,
        log_id: i32,
        match_id: i64,
        turn: i32,
        log_type: &str,
        player_id: i32,
        description: &str,
        data1: Option<&str>,
    ) {
        conn.execute(
            "INSERT INTO event_logs (log_id, match_id, turn, log_type, player_id, description, data1)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            duckdb::params![log_id, match_id, turn, log_type, player_id, description, data1],
        )
        .unwrap();
    }

    // ---- Tier 1: Contract tests ----

    #[test]
    fn test_get_player_history_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        let history = get_player_history(&conn, 1).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].history.len(), 10);
        // All values should be None since no data inserted
        assert!(history[0].history.iter().all(|h| h.points.is_none()));
    }

    #[test]
    fn test_get_player_history_with_data() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 5);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");
        insert_points_history(&conn, 1, 1, 1, 100);
        insert_points_history(&conn, 1, 1, 3, 200);

        let history = get_player_history(&conn, 1).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].history.len(), 5);
        assert_eq!(history[0].history[0].points, Some(100)); // turn 1
    }

    #[test]
    fn test_get_yield_history_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 5);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        let yields = get_yield_history(&conn, 1, &["YIELD_FOOD".to_string()]).unwrap();
        assert_eq!(yields.len(), 1);
        assert_eq!(yields[0].yield_type, "YIELD_FOOD");
        assert_eq!(yields[0].data.len(), 5);
        assert!(yields[0].data.iter().all(|d| d.amount.is_none()));
    }

    #[test]
    fn test_get_law_adoption_history_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        let history = get_law_adoption_history(&conn, 1).unwrap();
        assert_eq!(history.len(), 1);
        // Should have synthetic start (turn=0, count=0) and end point (turn=10, count=0)
        assert!(history[0].data.len() >= 1);
        assert_eq!(history[0].data[0].turn, 0);
        assert_eq!(history[0].data[0].law_count, 0);
    }

    #[test]
    fn test_get_tech_discovery_history_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        let history = get_tech_discovery_history(&conn, 1).unwrap();
        assert_eq!(history.len(), 1);
        // Should have synthetic start point
        assert!(history[0].data.len() >= 1);
        assert_eq!(history[0].data[0].turn, 0);
        assert_eq!(history[0].data[0].tech_count, 0);
    }

    // ---- Tier 2: Synthetic fixture tests ----

    #[test]
    fn test_player_history_forward_fill() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        // Sparse data: turns 1, 5, 10
        insert_points_history(&conn, 1, 1, 1, 100);
        insert_points_history(&conn, 1, 1, 5, 500);
        insert_points_history(&conn, 1, 1, 10, 1000);

        let history = get_player_history(&conn, 1).unwrap();
        let h = &history[0].history;
        assert_eq!(h.len(), 10);

        // Turn 1: actual data
        assert_eq!(h[0].points, Some(100));
        // Turns 2-4: forward-filled from turn 1
        assert_eq!(h[1].points, Some(100));
        assert_eq!(h[3].points, Some(100));
        // Turn 5: actual data
        assert_eq!(h[4].points, Some(500));
        // Turns 6-9: forward-filled from turn 5
        assert_eq!(h[5].points, Some(500));
        assert_eq!(h[8].points, Some(500));
        // Turn 10: actual data
        assert_eq!(h[9].points, Some(1000));
    }

    #[test]
    fn test_player_history_leading_nulls() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 5);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        // No data until turn 3
        insert_points_history(&conn, 1, 1, 3, 300);

        let history = get_player_history(&conn, 1).unwrap();
        let h = &history[0].history;

        // Turns 1-2: should be None (no data to carry forward)
        assert!(h[0].points.is_none());
        assert!(h[1].points.is_none());
        // Turn 3+: should have values
        assert_eq!(h[2].points, Some(300));
        assert_eq!(h[3].points, Some(300));
        assert_eq!(h[4].points, Some(300));
    }

    #[test]
    fn test_player_history_complete_turn_sequence() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 7);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");
        insert_points_history(&conn, 1, 1, 1, 10);

        let history = get_player_history(&conn, 1).unwrap();
        let h = &history[0].history;

        // Should have exactly total_turns entries
        assert_eq!(h.len(), 7);
        // Turns should be sequential 1..=7
        for (i, point) in h.iter().enumerate() {
            assert_eq!(point.turn, (i + 1) as i32);
        }
    }

    #[test]
    fn test_yield_history_prefers_total_over_rate() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 5);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        // Both tables have data for same turn — total should win
        insert_yield_total_history(&conn, 1, 1, "YIELD_FOOD", 3, 1000); // 1000/10 = 100.0
        insert_yield_history(&conn, 1, 1, "YIELD_FOOD", 3, 500); // 500/10 = 50.0

        let yields = get_yield_history(&conn, 1, &["YIELD_FOOD".to_string()]).unwrap();
        let data = &yields[0].data;

        // Turn 3 should use yield_total_history value (1000/10 = 100.0)
        assert_eq!(data[2].amount, Some(100.0));
    }

    #[test]
    fn test_yield_history_falls_back_to_rate() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 5);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        // Only yield_history has data (no yield_total_history)
        insert_yield_history(&conn, 1, 1, "YIELD_FOOD", 2, 500); // 500/10 = 50.0

        let yields = get_yield_history(&conn, 1, &["YIELD_FOOD".to_string()]).unwrap();
        let data = &yields[0].data;

        // Should fall back to yield_history value
        assert_eq!(data[1].amount, Some(50.0));
    }

    #[test]
    fn test_yield_history_divides_by_10() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 3);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");
        insert_yield_total_history(&conn, 1, 1, "YIELD_CIVICS", 1, 150);

        let yields = get_yield_history(&conn, 1, &["YIELD_CIVICS".to_string()]).unwrap();
        // 150 / 10.0 = 15.0
        assert_eq!(yields[0].data[0].amount, Some(15.0));
    }

    #[test]
    fn test_law_adoption_cumulative_counting() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        // Insert law mappings (laws table used for category lookup)
        conn.execute(
            "INSERT INTO laws (player_id, match_id, law_category, law, adopted_turn, change_count)
             VALUES (1, 1, 'LAWCLASS_SLAVERY_FREEDOM', 'LAW_SLAVERY', 5, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO laws (player_id, match_id, law_category, law, adopted_turn, change_count)
             VALUES (1, 1, 'LAWCLASS_LABOR', 'LAW_SERFDOM', 10, 1)",
            [],
        )
        .unwrap();

        // Insert adoption events
        insert_event_log(
            &conn,
            1,
            1,
            5,
            "LAW_ADOPTED",
            1,
            "Adopted <link=HELP_LINK,HELP_LAW,LAW_SLAVERY>Slavery</link>",
            None,
        );
        insert_event_log(
            &conn,
            2,
            1,
            10,
            "LAW_ADOPTED",
            1,
            "Adopted <link=HELP_LINK,HELP_LAW,LAW_SERFDOM>Serfdom</link>",
            None,
        );

        let history = get_law_adoption_history(&conn, 1).unwrap();
        let data = &history[0].data;

        // First point: synthetic start
        assert_eq!(data[0].turn, 0);
        assert_eq!(data[0].law_count, 0);
        // After first law (turn 5): 1 class adopted
        let turn5 = data.iter().find(|d| d.turn == 5).unwrap();
        assert_eq!(turn5.law_count, 1);
        // After second law (turn 10): 2 classes adopted
        let turn10 = data.iter().find(|d| d.turn == 10).unwrap();
        assert_eq!(turn10.law_count, 2);
    }

    #[test]
    fn test_law_adoption_class_switch_no_increment() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        // Two laws in same category
        conn.execute(
            "INSERT INTO laws (player_id, match_id, law_category, law, adopted_turn, change_count)
             VALUES (1, 1, 'LAWCLASS_SLAVERY_FREEDOM', 'LAW_SLAVERY', 5, 2)",
            [],
        )
        .unwrap();

        // Also insert the alternative law so the mapping exists
        conn.execute(
            "INSERT INTO laws (player_id, match_id, law_category, law, adopted_turn, change_count)
             VALUES (2, 1, 'LAWCLASS_SLAVERY_FREEDOM', 'LAW_FREEDOM', 10, 1)",
            [],
        )
        .unwrap();
        // Need a player 2 for the second law to exist
        conn.execute(
            "INSERT INTO players (player_id, match_id, player_name, player_name_normalized, nation, is_human, is_save_owner)
             VALUES (2, 1, 'AI', 'ai', 'NATION_GREECE', false, false)",
            [],
        )
        .unwrap();

        // First: adopt Slavery at turn 5
        insert_event_log(
            &conn,
            1,
            1,
            5,
            "LAW_ADOPTED",
            1,
            "Adopted <link=HELP_LINK,HELP_LAW,LAW_SLAVERY>Slavery</link>",
            None,
        );
        // Then: switch to Freedom at turn 15 (same class)
        insert_event_log(
            &conn,
            2,
            1,
            15,
            "LAW_ADOPTED",
            1,
            "Adopted <link=HELP_LINK,HELP_LAW,LAW_FREEDOM>Freedom</link>",
            None,
        );

        let history = get_law_adoption_history(&conn, 1).unwrap();
        // Find Rome's data (player 1)
        let rome = history.iter().find(|h| h.player_id == 1).unwrap();
        let data = &rome.data;

        // After turn 5: 1 class
        let turn5 = data.iter().find(|d| d.turn == 5).unwrap();
        assert_eq!(turn5.law_count, 1);
        // After turn 15: still 1 class (switch within same class)
        let turn15 = data.iter().find(|d| d.turn == 15).unwrap();
        assert_eq!(turn15.law_count, 1);
    }

    #[test]
    fn test_law_adoption_synthetic_endpoints() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 100);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        conn.execute(
            "INSERT INTO laws (player_id, match_id, law_category, law, adopted_turn, change_count)
             VALUES (1, 1, 'LAWCLASS_SLAVERY_FREEDOM', 'LAW_SLAVERY', 20, 1)",
            [],
        )
        .unwrap();
        insert_event_log(
            &conn,
            1,
            1,
            20,
            "LAW_ADOPTED",
            1,
            "Adopted <link=HELP_LINK,HELP_LAW,LAW_SLAVERY>Slavery</link>",
            None,
        );

        let history = get_law_adoption_history(&conn, 1).unwrap();
        let data = &history[0].data;

        // First point: turn 0, count 0
        assert_eq!(data.first().unwrap().turn, 0);
        assert_eq!(data.first().unwrap().law_count, 0);
        // Last point: turn 100 (final_turn), extends the line
        assert_eq!(data.last().unwrap().turn, 100);
        assert_eq!(data.last().unwrap().law_count, 1);
    }

    #[test]
    fn test_tech_discovery_same_turn() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 20);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        // Two techs discovered on same turn
        insert_event_log(
            &conn,
            1,
            1,
            10,
            "TECH_DISCOVERED",
            1,
            "Discovered Trapping",
            Some("TECH_TRAPPING"),
        );
        insert_event_log(
            &conn,
            2,
            1,
            10,
            "TECH_DISCOVERED",
            1,
            "Discovered Pottery",
            Some("TECH_POTTERY"),
        );

        let history = get_tech_discovery_history(&conn, 1).unwrap();
        let data = &history[0].data;

        // Should have: start(0,0), two events at turn 10, end point at turn 20
        let turn10_events: Vec<_> = data.iter().filter(|d| d.turn == 10).collect();
        assert_eq!(turn10_events.len(), 2);
        assert_eq!(turn10_events[0].tech_count, 1);
        assert_eq!(turn10_events[1].tech_count, 2);
    }

    #[test]
    fn test_tech_discovery_synthetic_endpoints() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");
        insert_event_log(
            &conn,
            1,
            1,
            10,
            "TECH_DISCOVERED",
            1,
            "Discovered Trapping",
            Some("TECH_TRAPPING"),
        );

        let history = get_tech_discovery_history(&conn, 1).unwrap();
        let data = &history[0].data;

        // First: turn 0, count 0
        assert_eq!(data.first().unwrap().turn, 0);
        assert_eq!(data.first().unwrap().tech_count, 0);
        // Last: turn 50, extends line
        assert_eq!(data.last().unwrap().turn, 50);
        assert_eq!(data.last().unwrap().tech_count, 1);
    }

    // ---- Tier 3: Real save invariant tests ----

    #[test]
    #[ignore]
    fn test_real_save_player_history_invariants() {
        let fixture = match super::super::test_fixtures::get_imported_fixture() {
            Some(f) => f,
            None => return,
        };
        let conn = Connection::open(&fixture.db_path).unwrap();

        let total_turns: i32 = conn
            .query_row(
                "SELECT total_turns FROM matches WHERE match_id = ?",
                [fixture.match_id],
                |row| row.get(0),
            )
            .unwrap();

        let history = get_player_history(&conn, fixture.match_id).unwrap();
        assert!(!history.is_empty(), "Should have at least one player");

        for player in &history {
            assert_eq!(
                player.history.len(),
                total_turns as usize,
                "Player {} should have exactly {} history entries",
                player.player_name,
                total_turns
            );
            // Verify sequential turns
            for (i, point) in player.history.iter().enumerate() {
                assert_eq!(point.turn, (i + 1) as i32);
            }
        }
    }

    #[test]
    #[ignore]
    fn test_real_save_law_adoption_invariants() {
        let fixture = match super::super::test_fixtures::get_imported_fixture() {
            Some(f) => f,
            None => return,
        };
        let conn = Connection::open(&fixture.db_path).unwrap();

        let history = get_law_adoption_history(&conn, fixture.match_id).unwrap();
        for player in &history {
            assert!(!player.data.is_empty(), "{} should have data", player.player_name);
            // Starts at (0, 0)
            assert_eq!(player.data[0].turn, 0);
            assert_eq!(player.data[0].law_count, 0);
            // Monotonically non-decreasing
            for window in player.data.windows(2) {
                assert!(
                    window[1].law_count >= window[0].law_count,
                    "{}: law_count decreased from {} to {} at turn {}",
                    player.player_name,
                    window[0].law_count,
                    window[1].law_count,
                    window[1].turn
                );
            }
        }
    }

    #[test]
    #[ignore]
    fn test_real_save_tech_discovery_invariants() {
        let fixture = match super::super::test_fixtures::get_imported_fixture() {
            Some(f) => f,
            None => return,
        };
        let conn = Connection::open(&fixture.db_path).unwrap();

        let history = get_tech_discovery_history(&conn, fixture.match_id).unwrap();
        for player in &history {
            assert!(!player.data.is_empty(), "{} should have data", player.player_name);
            assert_eq!(player.data[0].turn, 0);
            assert_eq!(player.data[0].tech_count, 0);
            // Non-decreasing
            for window in player.data.windows(2) {
                assert!(
                    window[1].tech_count >= window[0].tech_count,
                    "{}: tech_count decreased at turn {}",
                    player.player_name,
                    window[1].turn
                );
            }
        }
    }
}
