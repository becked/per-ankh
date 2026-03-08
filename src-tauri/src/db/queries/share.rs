// Share game data assembly
//
// Collects output from all 12 game detail queries into a single SharedGameData
// blob for upload to the share API. If any query fails, the entire assembly
// aborts — never produces partial data.

use crate::types::SharedGameData;
use duckdb::Connection;

/// Yield types to include in shared data. Must match the YIELD_TYPES
/// constant in src/routes/game/[id]/+page.svelte.
const SHARE_YIELD_TYPES: &[&str] = &[
    "YIELD_SCIENCE",
    "YIELD_CIVICS",
    "YIELD_TRAINING",
    "YIELD_GROWTH",
    "YIELD_CULTURE",
    "YIELD_HAPPINESS",
    "YIELD_ORDERS",
    "YIELD_FOOD",
    "YIELD_MONEY",
    "YIELD_DISCONTENT",
    "YIELD_IRON",
    "YIELD_STONE",
    "YIELD_WOOD",
    "YIELD_MAINTENANCE",
];

/// Assemble all 12 game detail queries into a single SharedGameData blob.
///
/// Each query is called sequentially with `?` propagation. If any fails,
/// the function returns an error immediately — never partial data.
pub fn assemble_shared_game_data(
    conn: &Connection,
    match_id: i64,
    app_version: &str,
) -> anyhow::Result<SharedGameData> {
    use anyhow::Context;

    let game_details = super::match_data::get_game_details(conn, match_id)
        .context("Failed to query game details")?;

    let player_history = super::history::get_player_history(conn, match_id)
        .context("Failed to query player history")?;

    let yield_types: Vec<String> = SHARE_YIELD_TYPES.iter().map(|s| s.to_string()).collect();
    let yield_history = super::history::get_yield_history(conn, match_id, &yield_types)
        .context("Failed to query yield history")?;

    let event_logs = super::match_data::get_event_logs(conn, match_id)
        .context("Failed to query event logs")?;

    let law_adoption_history = super::history::get_law_adoption_history(conn, match_id)
        .context("Failed to query law adoption history")?;

    let current_laws = super::match_data::get_current_laws(conn, match_id)
        .context("Failed to query current laws")?;

    let tech_discovery_history = super::history::get_tech_discovery_history(conn, match_id)
        .context("Failed to query tech discovery history")?;

    let completed_techs = super::match_data::get_completed_techs(conn, match_id)
        .context("Failed to query completed techs")?;

    let units_produced = super::map::get_units_produced(conn, match_id)
        .context("Failed to query units produced")?;

    let city_statistics = super::map::get_city_statistics(conn, match_id)
        .context("Failed to query city statistics")?;

    let improvement_data = super::map::get_improvement_data(conn, match_id)
        .context("Failed to query improvement data")?;

    let map_tiles = super::map::get_map_tiles(conn, match_id)
        .context("Failed to query map tiles")?;

    let game_religions = super::match_data::get_game_religions(conn, match_id)
        .context("Failed to query game religions")?;

    let player_wonders = super::match_data::get_player_wonders(conn, match_id)
        .context("Failed to query player wonders")?;

    Ok(SharedGameData {
        version: 1,
        created_at: chrono::Utc::now().to_rfc3339(),
        app_version: app_version.to_string(),
        game_details,
        player_history,
        yield_history,
        event_logs,
        law_adoption_history,
        current_laws,
        tech_discovery_history,
        completed_techs,
        units_produced,
        city_statistics,
        improvement_data,
        map_tiles,
        game_religions,
        player_wonders,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::queries::test_fixtures;
    use crate::db::schema::create_schema;
    use duckdb::Connection;
    use tempfile::tempdir;

    fn setup_empty_db() -> Connection {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = Connection::open(&db_path).unwrap();
        create_schema(&conn).unwrap();
        std::mem::forget(dir);
        conn
    }

    #[test]
    fn test_assembly_with_nonexistent_match_returns_error() {
        let conn = setup_empty_db();
        // Insert a match but with a different ID
        conn.execute(
            "INSERT INTO matches (match_id, game_id, file_name, file_hash, total_turns) VALUES (1, 'g1', 'f.zip', 'h1', 10)",
            [],
        ).unwrap();

        let result = assemble_shared_game_data(&conn, 999, "0.1.0");
        assert!(result.is_err(), "Assembly with nonexistent match_id should fail");
    }

    #[test]
    fn test_assembly_with_real_fixture() {
        let fixture = match test_fixtures::get_imported_fixture() {
            Some(f) => f,
            None => {
                eprintln!("Skipping test: test fixture not available");
                return;
            }
        };

        let conn = Connection::open(&fixture.db_path).unwrap();
        let data = assemble_shared_game_data(&conn, fixture.match_id, "0.1.0")
            .expect("Assembly should succeed with real fixture");

        // Basic structural checks
        assert_eq!(data.version, 1);
        assert_eq!(data.app_version, "0.1.0");
        assert!(!data.created_at.is_empty());
        assert_eq!(data.game_details.match_id, fixture.match_id);
        assert!(data.game_details.total_turns > 0);

        // All arrays should have data from a real save
        assert!(!data.player_history.is_empty(), "Should have player history");
        assert!(!data.map_tiles.is_empty(), "Should have map tiles");
    }

    #[test]
    fn test_assembly_serializes_to_valid_json() {
        let fixture = match test_fixtures::get_imported_fixture() {
            Some(f) => f,
            None => {
                eprintln!("Skipping test: test fixture not available");
                return;
            }
        };

        let conn = Connection::open(&fixture.db_path).unwrap();
        let data = assemble_shared_game_data(&conn, fixture.match_id, "0.1.0").unwrap();

        // Serialize to JSON
        let json = serde_json::to_vec(&data).expect("Should serialize to JSON");
        assert!(!json.is_empty());

        // Check size is reasonable (test fixture is a single save, should be < 5 MB)
        let size_mb = json.len() as f64 / (1024.0 * 1024.0);
        assert!(size_mb < 5.0, "JSON size should be < 5 MB, was {:.2} MB", size_mb);

        // Verify it has all 16 top-level fields
        let parsed: serde_json::Value = serde_json::from_slice(&json).unwrap();
        assert!(parsed.get("version").is_some());
        assert!(parsed.get("created_at").is_some());
        assert!(parsed.get("app_version").is_some());
        assert!(parsed.get("game_details").is_some());
        assert!(parsed.get("player_history").is_some());
        assert!(parsed.get("yield_history").is_some());
        assert!(parsed.get("event_logs").is_some());
        assert!(parsed.get("law_adoption_history").is_some());
        assert!(parsed.get("current_laws").is_some());
        assert!(parsed.get("tech_discovery_history").is_some());
        assert!(parsed.get("completed_techs").is_some());
        assert!(parsed.get("units_produced").is_some());
        assert!(parsed.get("city_statistics").is_some());
        assert!(parsed.get("improvement_data").is_some());
        assert!(parsed.get("map_tiles").is_some());
        assert!(parsed.get("game_religions").is_some());
        assert!(parsed.get("player_wonders").is_some());
    }

    #[test]
    fn test_assembly_gzip_compression() {
        let fixture = match test_fixtures::get_imported_fixture() {
            Some(f) => f,
            None => {
                eprintln!("Skipping test: test fixture not available");
                return;
            }
        };

        let conn = Connection::open(&fixture.db_path).unwrap();
        let data = assemble_shared_game_data(&conn, fixture.match_id, "0.1.0").unwrap();

        let json = serde_json::to_vec(&data).unwrap();

        // Gzip compress
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use std::io::Write;

        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&json).unwrap();
        let compressed = encoder.finish().unwrap();

        let json_size = json.len();
        let compressed_size = compressed.len();
        let ratio = compressed_size as f64 / json_size as f64;

        // Gzip should achieve significant compression on JSON data
        assert!(
            ratio < 0.5,
            "Gzip should compress JSON by at least 50%, got {:.1}% ratio ({} -> {} bytes)",
            ratio * 100.0,
            json_size,
            compressed_size
        );

        // Compressed size should be well under the 5 MB upload limit
        let compressed_mb = compressed_size as f64 / (1024.0 * 1024.0);
        assert!(
            compressed_mb < 5.0,
            "Compressed size should be < 5 MB, was {:.2} MB",
            compressed_mb
        );
    }
}
