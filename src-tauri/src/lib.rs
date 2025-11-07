// Old World Save Game Parser
//
// Modules:
// - db: Database connection and schema management
// - parser: ZIP extraction, XML parsing, ID mapping

pub mod db;
pub mod parser;

use anyhow::Context;
use parser::ImportResult;
use serde::Serialize;
use tauri::Manager;
use ts_rs::TS;

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct NationStats {
    pub nation: String,
    #[ts(type = "number")]
    pub games_played: i64,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct GameStatistics {
    #[ts(type = "number")]
    pub total_games: i64,
    pub nations: Vec<NationStats>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct GameInfo {
    #[ts(type = "number")]
    pub match_id: i64,
    pub game_name: Option<String>,
    pub save_date: Option<String>,
    pub turn_year: Option<i32>,
    pub human_nation: Option<String>,
    pub total_turns: Option<i32>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerInfo {
    pub player_name: String,
    pub nation: Option<String>,
    pub is_human: bool,
    pub legitimacy: Option<i32>,
    pub state_religion: Option<String>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct GameDetails {
    #[ts(type = "number")]
    pub match_id: i64,
    pub game_name: Option<String>,
    pub save_date: Option<String>,
    pub total_turns: i32,
    pub map_size: Option<String>,
    pub map_width: Option<i32>,
    pub map_height: Option<i32>,
    pub game_mode: Option<String>,
    pub opponent_level: Option<String>,
    pub players: Vec<PlayerInfo>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerHistoryPoint {
    pub turn: i32,
    pub points: Option<i32>,
    pub military_power: Option<i32>,
    pub legitimacy: Option<i32>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct PlayerHistory {
    pub player_id: i32,
    pub player_name: String,
    pub nation: Option<String>,
    pub history: Vec<PlayerHistoryPoint>,
}

// Initialize logging
fn init_logging() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .init();
}

/// Tauri command to import a save file
///
/// # Arguments
/// * `file_path` - Path to the ZIP save file
/// * `pool` - Database connection pool from Tauri state
///
/// # Returns
/// ImportResult with success status and match_id
#[tauri::command]
async fn import_save_file_cmd(
    file_path: String,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<ImportResult, String> {
    // Import save file using pooled connection
    pool.with_connection(|conn| parser::import_save_file(&file_path, conn))
        .context("Import failed")
        .map_err(|e| e.to_string())
}

/// Tauri command to get game statistics
///
/// Returns total number of games and nation play counts
#[tauri::command]
async fn get_game_statistics(pool: tauri::State<'_, db::connection::DbPool>) -> Result<GameStatistics, String> {
    pool.with_connection(|conn| {
        // Get total games count
        let total_games: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT match_id) FROM players",
                [],
                |row| row.get(0),
            )?;

        // Get nation statistics
        let mut stmt = conn
            .prepare("SELECT nation, COUNT(DISTINCT match_id) as games_played FROM players WHERE nation IS NOT NULL GROUP BY nation ORDER BY games_played DESC")?;

        let nations = stmt
            .query_map([], |row| {
                Ok(NationStats {
                    nation: row.get(0)?,
                    games_played: row.get(1)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(GameStatistics {
            total_games,
            nations,
        })
    })
    .context("Failed to get game statistics")
    .map_err(|e| e.to_string())
}

/// Tauri command to get list of all games
///
/// Returns list of games with basic info sorted by save date (newest first)
#[tauri::command]
async fn get_games_list(pool: tauri::State<'_, db::connection::DbPool>) -> Result<Vec<GameInfo>, String> {
    pool.with_connection(|conn| {
        // Get all games ordered by save_date (newest first)
        // Join with players to get the first player's nation (usually the human player)
        // Prioritize players with names, but fall back to any player if none have names
        let mut stmt = conn
            .prepare(
                "SELECT m.match_id, m.game_name, CAST(m.save_date AS VARCHAR) as save_date,
                        m.total_turns, p.nation
                 FROM matches m
                 LEFT JOIN (
                     SELECT match_id, nation,
                            ROW_NUMBER() OVER (
                                PARTITION BY match_id
                                ORDER BY
                                    CASE WHEN player_name IS NOT NULL AND LENGTH(player_name) > 0
                                         THEN 0 ELSE 1 END,
                                    player_name
                            ) as rn
                     FROM players
                 ) p ON m.match_id = p.match_id AND p.rn = 1
                 ORDER BY m.save_date DESC"
            )?;

        let games = stmt
            .query_map([], |row| {
                Ok(GameInfo {
                    match_id: row.get(0)?,
                    game_name: row.get(1)?,
                    save_date: row.get(2)?,
                    turn_year: None,
                    total_turns: row.get(3)?,
                    human_nation: row.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(games)
    })
    .context("Failed to get games list")
    .map_err(|e| e.to_string())
}

/// Tauri command to get detailed information about a specific game
///
/// Returns game details including match info, map info, and player list
#[tauri::command]
async fn get_game_details(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<GameDetails, String> {
    pool.with_connection(|conn| {
        // Get match details
        let mut stmt = conn
            .prepare(
                "SELECT match_id, game_name, CAST(save_date AS VARCHAR) as save_date,
                        total_turns, map_size, map_width, map_height, game_mode, opponent_level
                 FROM matches
                 WHERE match_id = ?"
            )?;

        let game_details = stmt
            .query_row([match_id], |row| {
                Ok(GameDetails {
                    match_id: row.get(0)?,
                    game_name: row.get(1)?,
                    save_date: row.get(2)?,
                    total_turns: row.get(3)?,
                    map_size: row.get(4)?,
                    map_width: row.get(5)?,
                    map_height: row.get(6)?,
                    game_mode: row.get(7)?,
                    opponent_level: row.get(8)?,
                    players: Vec::new(), // Will be filled below
                })
            })?;

        // Get players for this match
        let mut players_stmt = conn
            .prepare(
                "SELECT player_name, nation, is_human, legitimacy, state_religion
                 FROM players
                 WHERE match_id = ?
                 ORDER BY player_name"
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
    })
    .context("Failed to get game details")
    .map_err(|e| e.to_string())
}

/// Tauri command to get player history data for charts
///
/// Returns time-series data for victory points, military power, and legitimacy
#[tauri::command]
async fn get_player_history(
    match_id: i64,
    pool: tauri::State<'_, db::connection::DbPool>,
) -> Result<Vec<PlayerHistory>, String> {
    pool.with_connection(|conn| {
        // Get all players for this match
        let mut players_stmt = conn
            .prepare(
                "SELECT player_id, player_name, nation
                 FROM players
                 WHERE match_id = ?
                 ORDER BY player_name"
            )?;

        let players: Vec<(i32, String, Option<String>)> = players_stmt
            .query_map([match_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut result = Vec::new();

        for (player_id, player_name, nation) in players {
            // Query combined history data using LEFT JOINs to handle sparse data
            let mut history_stmt = conn
                .prepare(
                    "SELECT DISTINCT
                        COALESCE(ph.turn, mh.turn, lh.turn) as turn,
                        ph.points,
                        mh.military_power,
                        lh.legitimacy
                     FROM (SELECT DISTINCT turn FROM points_history WHERE match_id = ? AND player_id = ?
                           UNION SELECT DISTINCT turn FROM military_history WHERE match_id = ? AND player_id = ?
                           UNION SELECT DISTINCT turn FROM legitimacy_history WHERE match_id = ? AND player_id = ?) turns
                     LEFT JOIN points_history ph ON ph.match_id = ? AND ph.player_id = ? AND ph.turn = turns.turn
                     LEFT JOIN military_history mh ON mh.match_id = ? AND mh.player_id = ? AND mh.turn = turns.turn
                     LEFT JOIN legitimacy_history lh ON lh.match_id = ? AND lh.player_id = ? AND lh.turn = turns.turn
                     ORDER BY turn"
                )?;

            let history: Vec<PlayerHistoryPoint> = history_stmt
                .query_map(
                    [match_id, player_id as i64, match_id, player_id as i64, match_id, player_id as i64,
                     match_id, player_id as i64, match_id, player_id as i64, match_id, player_id as i64],
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

            // Include nation for player color lookup
            result.push(PlayerHistory {
                player_id,
                player_name,
                nation,
                history,
            });
        }

        Ok(result)
    })
    .context("Failed to get player history")
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            import_save_file_cmd,
            get_game_statistics,
            get_games_list,
            get_game_details,
            get_player_history
        ]);

    builder
        .setup(|app| {
            // Initialize database connection pool
            let db_path = db::connection::get_db_path(app.handle())
                .context("Failed to get database path")
                .map_err(|e| e.to_string())?;

            // Ensure schema is ready
            db::ensure_schema_ready(&db_path)
                .context("Failed to initialize schema")
                .map_err(|e| e.to_string())?;

            // Create connection pool
            let pool = db::connection::DbPool::new(&db_path)
                .context("Failed to create connection pool")
                .map_err(|e| e.to_string())?;

            // Clean up stale locks
            pool.with_connection(|conn| db::connection::cleanup_stale_locks(conn))
                .context("Failed to cleanup stale locks")
                .map_err(|e| e.to_string())?;

            // Store pool in Tauri state
            app.handle().manage(pool);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
