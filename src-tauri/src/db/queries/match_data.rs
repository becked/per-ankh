// Match detail, events, laws, and tech queries

use crate::types::{
    EventLog, GameDetails, PlayerInfo, PlayerLaw, PlayerTech, StoryEvent,
};
use duckdb::Connection;

/// Get detailed information about a specific match including players.
pub fn get_game_details(conn: &Connection, match_id: i64) -> duckdb::Result<GameDetails> {
    // Get match details with winner and save owner information via LEFT JOINs
    let mut stmt = conn.prepare(
        "SELECT m.match_id, m.game_name, CAST(m.save_date AS VARCHAR) as save_date,
                m.total_turns, m.map_size, m.map_width, m.map_height, m.map_class,
                m.game_mode, m.opponent_level, m.victory_conditions, m.enabled_mods, m.enabled_dlc,
                m.winner_player_id,
                wp.player_name as winner_name,
                wp.nation as winner_civilization,
                m.winner_victory_type,
                so.difficulty as save_owner_difficulty
         FROM matches m
         LEFT JOIN players wp ON m.match_id = wp.match_id AND m.winner_player_id = wp.player_id
         LEFT JOIN players so ON m.match_id = so.match_id AND so.is_save_owner = TRUE
         WHERE m.match_id = ?",
    )?;

    let game_details = stmt.query_row([match_id], |row| {
        Ok(GameDetails {
            match_id: row.get(0)?,
            game_name: row.get(1)?,
            save_date: row.get(2)?,
            total_turns: row.get(3)?,
            map_size: row.get(4)?,
            map_width: row.get(5)?,
            map_height: row.get(6)?,
            map_class: row.get(7)?,
            game_mode: row.get(8)?,
            opponent_level: row.get(9)?,
            difficulty: row.get(17)?,
            victory_conditions: row.get(10)?,
            enabled_mods: row.get(11)?,
            enabled_dlc: row.get(12)?,
            winner_player_id: row.get(13)?,
            winner_name: row.get(14)?,
            winner_civilization: row.get(15)?,
            winner_victory_type: row.get(16)?,
            players: Vec::new(), // Will be filled below
        })
    })?;

    // Get players for this match
    let mut players_stmt = conn.prepare(
        "SELECT player_name, nation, is_human, legitimacy, state_religion
         FROM players
         WHERE match_id = ?
         ORDER BY player_name",
    )?;

    let players = players_stmt
        .query_map([match_id], |row| {
            Ok(PlayerInfo {
                player_name: row.get(0)?,
                nation: row.get(1)?,
                is_human: row.get(2)?,
                legitimacy: row.get(3)?,
                state_religion: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(GameDetails {
        players,
        ..game_details
    })
}

/// Get current laws for all players in a match.
///
/// Returns each player's active laws with actual adoption turns from event_logs.
pub fn get_current_laws(conn: &Connection, match_id: i64) -> duckdb::Result<Vec<PlayerLaw>> {
    // Get the actual adoption turn from event_logs (LAW_ADOPTED events)
    // The laws table only stores placeholder values for adopted_turn
    let mut stmt = conn.prepare(
        "WITH law_adoptions AS (
            -- Extract law adoption events with the law name from description
            SELECT
                e.player_id,
                e.turn,
                regexp_extract(e.description, 'LAW_[A-Z_]+', 0) as law_name
            FROM event_logs e
            WHERE e.match_id = ?
            AND e.log_type = 'LAW_ADOPTED'
            AND e.description IS NOT NULL
         ),
         latest_adoptions AS (
            -- Get the most recent adoption turn for each player+law combination
            SELECT
                player_id,
                law_name,
                MAX(turn) as adopted_turn
            FROM law_adoptions
            GROUP BY player_id, law_name
         )
         SELECT
            l.player_id,
            p.player_name,
            p.nation,
            l.law_category,
            l.law,
            COALESCE(la.adopted_turn, 0) as adopted_turn,
            l.change_count
         FROM laws l
         JOIN players p ON l.player_id = p.player_id AND l.match_id = p.match_id
         LEFT JOIN latest_adoptions la ON l.player_id = la.player_id AND l.law = la.law_name
         WHERE l.match_id = ?
         ORDER BY p.nation, l.law_category",
    )?;

    let laws = stmt
        .query_map([match_id, match_id], |row| {
            Ok(PlayerLaw {
                player_id: row.get(0)?,
                player_name: row.get(1)?,
                nation: row.get(2)?,
                law_category: row.get(3)?,
                law: row.get(4)?,
                adopted_turn: row.get(5)?,
                change_count: row.get(6)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(laws)
}

/// Get completed techs for all players in a match.
///
/// Returns each player's completed technologies with discovery turn from event_logs.
pub fn get_completed_techs(conn: &Connection, match_id: i64) -> duckdb::Result<Vec<PlayerTech>> {
    // Get completed techs from event_logs (TECH_DISCOVERED events)
    // This gives us accurate turn numbers unlike the technologies_completed table
    let mut stmt = conn.prepare(
        "SELECT
            e.player_id,
            p.player_name,
            p.nation,
            e.data1 as tech,
            e.turn as completed_turn
         FROM event_logs e
         JOIN players p ON e.player_id = p.player_id AND e.match_id = p.match_id
         WHERE e.match_id = ?
           AND e.log_type = 'TECH_DISCOVERED'
           AND e.data1 IS NOT NULL
         ORDER BY p.nation, e.turn, e.data1",
    )?;

    let techs = stmt
        .query_map([match_id], |row| {
            Ok(PlayerTech {
                player_id: row.get(0)?,
                player_name: row.get(1)?,
                nation: row.get(2)?,
                tech: row.get(3)?,
                completed_turn: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(techs)
}

/// Get story events for a match.
pub fn get_story_events(conn: &Connection, match_id: i64) -> duckdb::Result<Vec<StoryEvent>> {
    let mut stmt = conn.prepare(
        "SELECT
            se.event_id,
            se.event_type,
            p.player_name,
            se.occurred_turn,
            c.first_name as character_name,
            ci.city_name
         FROM story_events se
         JOIN players p ON se.player_id = p.player_id AND se.match_id = p.match_id
         LEFT JOIN characters c ON se.primary_character_id = c.character_id AND se.match_id = c.match_id
         LEFT JOIN cities ci ON se.city_id = ci.city_id AND se.match_id = ci.match_id
         WHERE se.match_id = ?
         ORDER BY se.occurred_turn DESC, se.event_id DESC
         LIMIT 100",
    )?;

    let events = stmt
        .query_map([match_id], |row| {
            Ok(StoryEvent {
                event_id: row.get(0)?,
                event_type: row.get(1)?,
                player_name: row.get(2)?,
                occurred_turn: row.get(3)?,
                primary_character_name: row.get(4)?,
                city_name: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(events)
}

/// Get event logs for a match, deduplicated by stripping markup tags.
pub fn get_event_logs(conn: &Connection, match_id: i64) -> duckdb::Result<Vec<EventLog>> {
    // Strip markup tags from description for grouping to properly deduplicate
    // events that differ only in player-specific markup (e.g., link IDs)
    let mut stmt = conn.prepare(
        "SELECT
            MIN(el.log_id) as log_id,
            el.log_type,
            el.turn,
            CASE
                WHEN COUNT(*) > 1 THEN NULL
                ELSE COALESCE(MAX(p.player_name), 'Player')
            END as player_name,
            MIN(el.description) as description
         FROM event_logs el
         LEFT JOIN players p ON el.player_id = p.player_id AND el.match_id = p.match_id
         WHERE el.match_id = ?
         GROUP BY el.turn, el.log_type, regexp_replace(el.description, '<[^>]*>', '', 'g')
         ORDER BY el.turn DESC, MIN(el.log_id) DESC",
    )?;

    let logs = stmt
        .query_map([match_id], |row| {
            Ok(EventLog {
                log_id: row.get(0)?,
                log_type: row.get(1)?,
                turn: row.get(2)?,
                player_name: row.get(3)?,
                description: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(logs)
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
            duckdb::params![player_id, match_id, name, name.to_lowercase(), nation, is_human, is_save_owner],
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
    fn test_get_game_details_returns_match() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        conn.execute(
            "UPDATE matches SET game_name = 'Test Campaign' WHERE match_id = 1",
            [],
        )
        .unwrap();
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME", true, true);
        insert_player(&conn, 2, 1, "Greece", "NATION_GREECE", false, false);

        let details = get_game_details(&conn, 1).unwrap();
        assert_eq!(details.match_id, 1);
        assert_eq!(details.game_name, Some("Test Campaign".to_string()));
        assert_eq!(details.total_turns, 50);
        assert_eq!(details.players.len(), 2);
        assert!(details.players.iter().any(|p| p.is_human));
    }

    #[test]
    fn test_get_current_laws_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        let laws = get_current_laws(&conn, 1).unwrap();
        assert!(laws.is_empty());
    }

    #[test]
    fn test_get_current_laws_with_data() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME", true, true);
        conn.execute(
            "INSERT INTO laws (player_id, match_id, law_category, law, adopted_turn, change_count)
             VALUES (1, 1, 'LAWCLASS_SLAVERY_FREEDOM', 'LAW_SLAVERY', 10, 1)",
            [],
        )
        .unwrap();

        let laws = get_current_laws(&conn, 1).unwrap();
        assert_eq!(laws.len(), 1);
        assert_eq!(laws[0].law, "LAW_SLAVERY");
        assert_eq!(laws[0].law_category, "LAWCLASS_SLAVERY_FREEDOM");
        assert_eq!(laws[0].player_name, "Rome");
    }

    #[test]
    fn test_get_completed_techs_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        let techs = get_completed_techs(&conn, 1).unwrap();
        assert!(techs.is_empty());
    }

    #[test]
    fn test_get_completed_techs_from_event_logs() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME", true, true);
        insert_event_log(
            &conn,
            1,
            1,
            15,
            "TECH_DISCOVERED",
            1,
            "Discovered Trapping",
            Some("TECH_TRAPPING"),
        );

        let techs = get_completed_techs(&conn, 1).unwrap();
        assert_eq!(techs.len(), 1);
        assert_eq!(techs[0].tech, "TECH_TRAPPING");
        assert_eq!(techs[0].completed_turn, 15);
        assert_eq!(techs[0].player_name, "Rome");
    }

    #[test]
    fn test_get_story_events_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        let events = get_story_events(&conn, 1).unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn test_get_event_logs_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        let logs = get_event_logs(&conn, 1).unwrap();
        assert!(logs.is_empty());
    }

    // ---- Tier 2: Synthetic fixture tests ----

    #[test]
    fn test_get_current_laws_adoption_turn_from_events() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME", true, true);

        // Laws table has placeholder adopted_turn=0
        conn.execute(
            "INSERT INTO laws (player_id, match_id, law_category, law, adopted_turn, change_count)
             VALUES (1, 1, 'LAWCLASS_SLAVERY_FREEDOM', 'LAW_SLAVERY', 0, 1)",
            [],
        )
        .unwrap();

        // Event log has the real adoption turn
        insert_event_log(
            &conn,
            1,
            1,
            25,
            "LAW_ADOPTED",
            1,
            "Adopted <link=HELP_LINK,HELP_LAW,LAW_SLAVERY>Slavery</link>",
            None,
        );

        let laws = get_current_laws(&conn, 1).unwrap();
        assert_eq!(laws.len(), 1);
        // Should use turn from event_logs (25), not from laws table (0)
        assert_eq!(laws[0].adopted_turn, 25);
    }

    #[test]
    fn test_get_story_events_limit_100() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 200);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME", true, true);

        // Insert 110 story events
        for i in 1..=110 {
            conn.execute(
                "INSERT INTO story_events (event_id, match_id, event_type, player_id, occurred_turn)
                 VALUES (?, 1, 'EVENTSTORY_TEST', 1, ?)",
                duckdb::params![i, i],
            )
            .unwrap();
        }

        let events = get_story_events(&conn, 1).unwrap();
        assert_eq!(events.len(), 100);
        // Should be the most recent 100 (ordered DESC)
        assert_eq!(events[0].occurred_turn, 110);
        assert_eq!(events[99].occurred_turn, 11);
    }

    #[test]
    fn test_get_event_logs_deduplication() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME", true, true);
        insert_player(&conn, 2, 1, "Greece", "NATION_GREECE", false, false);

        // Two event logs with same turn/type and identical content after markup stripping.
        // Only the markup tags differ (different link IDs), but the text is the same.
        insert_event_log(
            &conn,
            1,
            1,
            10,
            "DIPLOMATIC_EVENT",
            1,
            "Peace declared between <link=PLAYER_1_ID>nations</link>",
            None,
        );
        insert_event_log(
            &conn,
            2,
            1,
            10,
            "DIPLOMATIC_EVENT",
            2,
            "Peace declared between <link=PLAYER_2_ID>nations</link>",
            None,
        );

        let logs = get_event_logs(&conn, 1).unwrap();
        // After stripping markup, both become "Peace declared between nations" → deduplicated
        assert_eq!(logs.len(), 1);
        // player_name should be NULL since COUNT > 1
        assert!(logs[0].player_name.is_none());
    }

    // ---- Tier 3: Real save invariant tests ----

    #[test]
    #[ignore]
    fn test_real_save_game_details_invariants() {
        let fixture = match super::super::test_fixtures::get_imported_fixture() {
            Some(f) => f,
            None => return,
        };
        let conn = Connection::open(&fixture.db_path).unwrap();

        let details = get_game_details(&conn, fixture.match_id).unwrap();
        assert!(!details.players.is_empty(), "Should have players");
        assert!(
            details.players.iter().any(|p| p.is_human),
            "At least one player should be human"
        );
        assert!(details.total_turns > 0);
    }
}
