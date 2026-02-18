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
