// Map, city, improvement, and unit queries

use super::get_city_religions;
use crate::types::{
    CityInfo, CityStatistics, ImprovementData, ImprovementInfo, MapTile, PlayerUnitProduced,
};
use duckdb::Connection;

/// Get all map tiles for the current (final) state of a match.
///
/// Returns tile data with terrain, resources, improvements, ownership, and religions.
pub fn get_map_tiles(conn: &Connection, match_id: i64) -> duckdb::Result<Vec<MapTile>> {
    // Step 1: Query all religions by city with founder nations
    let city_religions = get_city_religions(conn, match_id)?;

    // Step 2: Query base tile data (without religion, but with owner_city_id)
    // Also join with cities on tile_id to detect city center tiles
    let mut stmt = conn.prepare(
        "SELECT t.x, t.y, t.terrain, t.height, t.vegetation,
                t.resource, t.improvement, t.improvement_pillaged, t.has_road,
                t.specialist, t.tribe_site,
                t.river_w, t.river_sw, t.river_se,
                p.nation, c.city_name, t.owner_city_id,
                city_center.city_id IS NOT NULL as is_city_center,
                COALESCE(city_center.is_capital, false) as is_capital
         FROM tiles t
         LEFT JOIN players p ON t.owner_player_id = p.player_id AND t.match_id = p.match_id
         LEFT JOIN cities c ON t.owner_city_id = c.city_id AND t.match_id = c.match_id
         LEFT JOIN cities city_center ON t.tile_id = city_center.tile_id AND t.match_id = city_center.match_id
         WHERE t.match_id = ?
         ORDER BY t.y, t.x",
    )?;

    let tiles = stmt
        .query_map([match_id], |row| {
            let owner_city_id: Option<i64> = row.get(16)?;
            Ok(MapTile {
                x: row.get(0)?,
                y: row.get(1)?,
                terrain: row.get(2)?,
                height: row.get(3)?,
                vegetation: row.get(4)?,
                resource: row.get(5)?,
                improvement: row.get(6)?,
                improvement_pillaged: row.get::<_, Option<bool>>(7)?.unwrap_or(false),
                has_road: row.get::<_, Option<bool>>(8)?.unwrap_or(false),
                specialist: row.get(9)?,
                tribe_site: row.get(10)?,
                religions: Vec::new(), // Populated below
                river_w: row.get::<_, Option<bool>>(11)?.unwrap_or(false),
                river_sw: row.get::<_, Option<bool>>(12)?.unwrap_or(false),
                river_se: row.get::<_, Option<bool>>(13)?.unwrap_or(false),
                owner_nation: row.get(14)?,
                owner_city: row.get(15)?,
                is_city_center: row.get::<_, Option<bool>>(17)?.unwrap_or(false),
                is_capital: row.get::<_, Option<bool>>(18)?.unwrap_or(false),
                owner_city_id,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    // Step 3: Populate religions from HashMap
    let tiles_with_religions: Vec<MapTile> = tiles
        .into_iter()
        .map(|mut tile| {
            if let Some(city_id) = tile.owner_city_id {
                if let Some(religions) = city_religions.get(&city_id) {
                    tile.religions = religions.clone();
                }
            }
            tile
        })
        .collect();

    Ok(tiles_with_religions)
}

/// Get map tiles at a specific turn for historical visualization.
///
/// Returns tile data with ownership state reconstructed from tile_ownership_history.
/// Improvements, roads, and religions are only shown if the tile was owned at the specified turn.
pub fn get_map_tiles_at_turn(
    conn: &Connection,
    match_id: i64,
    turn: i32,
) -> duckdb::Result<Vec<MapTile>> {
    // Step 1: Query all religions by city with founder nations
    // Filter by: religion must be founded by this turn AND city acquired it by this turn
    let mut religion_stmt = conn.prepare(
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
             AND se.occurred_turn <= ?
         WHERE cr.match_id = ?
           AND (r.founded_turn IS NULL OR r.founded_turn <= ?)
           AND (cr.acquired_turn IS NULL OR cr.acquired_turn <= ?)
         ORDER BY
             cr.city_id,
             CASE WHEN cr.religion = owner.state_religion AND se.occurred_turn IS NOT NULL THEN 0 ELSE 1 END,
             se.occurred_turn NULLS LAST,
             cr.acquired_turn NULLS FIRST,
             cr.religion",
    )?;

    let mut city_religions: std::collections::HashMap<i64, Vec<crate::types::ReligionInfo>> =
        std::collections::HashMap::new();

    let religion_rows =
        religion_stmt.query_map([turn as i64, match_id, turn as i64, turn as i64], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;

    for row in religion_rows {
        let (city_id, religion_name, founder_nation) = row?;
        city_religions
            .entry(city_id)
            .or_default()
            .push(crate::types::ReligionInfo {
                religion_name,
                founder_nation,
            });
    }

    // Step 2: Query tile data with ownership at specific turn
    // - Ownership comes from tile_ownership_history (latest record at or before turn)
    // - Improvements/roads only shown if tile was owned at that turn
    // - Resources, terrain, rivers are always shown (exist from game start)
    // - City center/capital status only shown if city existed at this turn
    let mut stmt = conn.prepare(
        "WITH ownership_at_turn AS (
            SELECT tile_id, owner_player_id
            FROM (
                SELECT tile_id, owner_player_id,
                       ROW_NUMBER() OVER (PARTITION BY tile_id ORDER BY turn DESC) as rn
                FROM tile_ownership_history
                WHERE match_id = ? AND turn <= ?
            )
            WHERE rn = 1
        )
        SELECT t.x, t.y, t.terrain, t.height, t.vegetation,
               t.resource,
               -- Only show improvement if tile was owned at this turn
               CASE WHEN oh.owner_player_id IS NOT NULL THEN t.improvement ELSE NULL END,
               CASE WHEN oh.owner_player_id IS NOT NULL THEN t.improvement_pillaged ELSE false END,
               CASE WHEN oh.owner_player_id IS NOT NULL THEN t.has_road ELSE false END,
               CASE WHEN oh.owner_player_id IS NOT NULL THEN t.specialist ELSE NULL END,
               t.tribe_site,
               t.river_w, t.river_sw, t.river_se,
               p.nation, c.city_name,
               -- Return city_id only if tile was owned at this turn (for religion lookup)
               CASE WHEN oh.owner_player_id IS NOT NULL THEN t.owner_city_id ELSE NULL END as owner_city_id,
               city_center.city_id IS NOT NULL as is_city_center,
               COALESCE(city_center.is_capital, false) as is_capital
        FROM tiles t
        LEFT JOIN ownership_at_turn oh ON t.tile_id = oh.tile_id
        LEFT JOIN players p ON oh.owner_player_id = p.player_id AND p.match_id = ?
        LEFT JOIN cities c ON t.owner_city_id = c.city_id AND c.match_id = ? AND c.founded_turn <= ?
        LEFT JOIN cities city_center ON t.tile_id = city_center.tile_id AND city_center.match_id = ? AND city_center.founded_turn <= ?
        WHERE t.match_id = ?
        ORDER BY t.y, t.x",
    )?;

    let tiles = stmt
        .query_map(
            [
                match_id,
                turn as i64,
                match_id,
                match_id,
                turn as i64,
                match_id,
                turn as i64,
                match_id,
            ],
            |row| {
                let owner_city_id: Option<i64> = row.get(16)?;
                Ok(MapTile {
                    x: row.get(0)?,
                    y: row.get(1)?,
                    terrain: row.get(2)?,
                    height: row.get(3)?,
                    vegetation: row.get(4)?,
                    resource: row.get(5)?,
                    improvement: row.get(6)?,
                    improvement_pillaged: row.get::<_, Option<bool>>(7)?.unwrap_or(false),
                    has_road: row.get::<_, Option<bool>>(8)?.unwrap_or(false),
                    specialist: row.get(9)?,
                    tribe_site: row.get(10)?,
                    religions: Vec::new(), // Populated below
                    river_w: row.get::<_, Option<bool>>(11)?.unwrap_or(false),
                    river_sw: row.get::<_, Option<bool>>(12)?.unwrap_or(false),
                    river_se: row.get::<_, Option<bool>>(13)?.unwrap_or(false),
                    owner_nation: row.get(14)?,
                    owner_city: row.get(15)?,
                    is_city_center: row.get::<_, Option<bool>>(17)?.unwrap_or(false),
                    is_capital: row.get::<_, Option<bool>>(18)?.unwrap_or(false),
                    owner_city_id,
                })
            },
        )?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    // Step 3: Populate religions from HashMap (only if tile was owned at this turn)
    let tiles_with_religions: Vec<MapTile> = tiles
        .into_iter()
        .map(|mut tile| {
            if let Some(city_id) = tile.owner_city_id {
                if let Some(religions) = city_religions.get(&city_id) {
                    tile.religions = religions.clone();
                }
            }
            tile
        })
        .collect();

    Ok(tiles_with_religions)
}

/// Get city statistics for all cities in a match.
pub fn get_city_statistics(conn: &Connection, match_id: i64) -> duckdb::Result<CityStatistics> {
    let mut stmt = conn.prepare(
        "SELECT
            c.city_id,
            c.city_name,
            p.nation as owner_nation,
            c.family,
            c.founded_turn,
            c.is_capital,
            c.citizens,
            gov.first_name as governor_name,
            cc.culture_level,
            c.growth_count,
            c.unit_production_count,
            c.specialist_count,
            c.buy_tile_count,
            c.hurry_civics_count,
            c.hurry_money_count,
            c.hurry_training_count,
            c.hurry_population_count
         FROM cities c
         LEFT JOIN players p ON c.player_id = p.player_id AND c.match_id = p.match_id
         LEFT JOIN characters gov ON c.governor_id = gov.character_id AND c.match_id = gov.match_id
         LEFT JOIN city_culture cc ON c.city_id = cc.city_id AND c.match_id = cc.match_id
             AND cc.team_id = COALESCE(p.team_id, p.xml_id)
         WHERE c.match_id = ?
         ORDER BY c.city_name",
    )?;

    let cities = stmt
        .query_map([match_id], |row| {
            Ok(CityInfo {
                city_id: row.get(0)?,
                city_name: row.get(1)?,
                owner_nation: row.get(2)?,
                family: row.get(3)?,
                founded_turn: row.get(4)?,
                is_capital: row.get(5)?,
                citizens: row.get(6)?,
                governor_name: row.get(7)?,
                culture_level: row.get(8)?,
                growth_count: row.get(9)?,
                unit_production_count: row.get(10)?,
                specialist_count: row.get(11)?,
                buy_tile_count: row.get(12)?,
                hurry_civics_count: row.get(13)?,
                hurry_money_count: row.get(14)?,
                hurry_training_count: row.get(15)?,
                hurry_population_count: row.get(16)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(CityStatistics { cities })
}

/// Get all improvements for a match with nation, city, specialist, and resource info.
pub fn get_improvement_data(conn: &Connection, match_id: i64) -> duckdb::Result<ImprovementData> {
    let mut stmt = conn.prepare(
        "SELECT
            p.nation,
            c.city_name,
            t.improvement,
            t.specialist,
            t.resource
         FROM tiles t
         LEFT JOIN cities c ON t.owner_city_id = c.city_id AND t.match_id = c.match_id
         LEFT JOIN players p ON c.player_id = p.player_id AND c.match_id = p.match_id
         WHERE t.match_id = ?
           AND t.improvement IS NOT NULL
         ORDER BY p.nation, c.city_name, t.improvement",
    )?;

    let improvements = stmt
        .query_map([match_id], |row| {
            Ok(ImprovementInfo {
                nation: row.get(0)?,
                city_name: row.get(1)?,
                improvement: row.get(2)?,
                specialist: row.get(3)?,
                resource: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(ImprovementData { improvements })
}

/// Get units produced for all players in a match.
pub fn get_units_produced(
    conn: &Connection,
    match_id: i64,
) -> duckdb::Result<Vec<PlayerUnitProduced>> {
    let mut stmt = conn.prepare(
        "SELECT
            u.player_id,
            p.player_name,
            p.nation,
            u.unit_type,
            u.count
         FROM player_units_produced u
         JOIN players p ON u.player_id = p.player_id AND u.match_id = p.match_id
         WHERE u.match_id = ?
         ORDER BY p.nation, u.count DESC, u.unit_type",
    )?;

    let units = stmt
        .query_map([match_id], |row| {
            Ok(PlayerUnitProduced {
                player_id: row.get(0)?,
                player_name: row.get(1)?,
                nation: row.get(2)?,
                unit_type: row.get(3)?,
                count: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(units)
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

    fn insert_tile(
        conn: &Connection,
        tile_id: i32,
        match_id: i64,
        x: i32,
        y: i32,
        owner_player_id: Option<i32>,
        owner_city_id: Option<i32>,
    ) {
        conn.execute(
            "INSERT INTO tiles (tile_id, match_id, x, y, owner_player_id, owner_city_id, terrain)
             VALUES (?, ?, ?, ?, ?, ?, 'TERRAIN_TEMPERATE')",
            duckdb::params![tile_id, match_id, x, y, owner_player_id, owner_city_id],
        )
        .unwrap();
    }

    fn insert_city(
        conn: &Connection,
        city_id: i32,
        match_id: i64,
        name: &str,
        player_id: i32,
        tile_id: i32,
        founded_turn: i32,
    ) {
        conn.execute(
            "INSERT INTO cities (city_id, match_id, city_name, player_id, tile_id, founded_turn)
             VALUES (?, ?, ?, ?, ?, ?)",
            duckdb::params![city_id, match_id, name, player_id, tile_id, founded_turn],
        )
        .unwrap();
    }

    fn insert_tile_ownership(
        conn: &Connection,
        tile_id: i32,
        match_id: i64,
        turn: i32,
        owner_player_id: Option<i32>,
    ) {
        conn.execute(
            "INSERT INTO tile_ownership_history (tile_id, match_id, turn, owner_player_id)
             VALUES (?, ?, ?, ?)",
            duckdb::params![tile_id, match_id, turn, owner_player_id],
        )
        .unwrap();
    }

    // ---- Tier 1: Contract tests ----

    #[test]
    fn test_get_map_tiles_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        let tiles = get_map_tiles(&conn, 1).unwrap();
        assert!(tiles.is_empty());
    }

    #[test]
    fn test_get_map_tiles_returns_data() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");
        insert_tile(&conn, 100, 1, 5, 10, Some(1), None);

        let tiles = get_map_tiles(&conn, 1).unwrap();
        assert_eq!(tiles.len(), 1);
        assert_eq!(tiles[0].x, 5);
        assert_eq!(tiles[0].y, 10);
        assert_eq!(tiles[0].terrain, Some("TERRAIN_TEMPERATE".to_string()));
        assert_eq!(tiles[0].owner_nation, Some("NATION_ROME".to_string()));
    }

    #[test]
    fn test_get_map_tiles_at_turn_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        let tiles = get_map_tiles_at_turn(&conn, 1, 5).unwrap();
        assert!(tiles.is_empty());
    }

    #[test]
    fn test_get_city_statistics_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        let stats = get_city_statistics(&conn, 1).unwrap();
        assert!(stats.cities.is_empty());
    }

    #[test]
    fn test_get_city_statistics_with_data() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");
        insert_tile(&conn, 100, 1, 5, 5, Some(1), Some(10));
        insert_city(&conn, 10, 1, "Roma", 1, 100, 1);

        let stats = get_city_statistics(&conn, 1).unwrap();
        assert_eq!(stats.cities.len(), 1);
        assert_eq!(stats.cities[0].city_name, "Roma");
        assert_eq!(stats.cities[0].owner_nation, Some("NATION_ROME".to_string()));
        assert_eq!(stats.cities[0].founded_turn, 1);
    }

    #[test]
    fn test_get_improvement_data_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        let data = get_improvement_data(&conn, 1).unwrap();
        assert!(data.improvements.is_empty());
    }

    #[test]
    fn test_get_improvement_data_filters_null() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        // Tile without improvement
        insert_tile(&conn, 100, 1, 5, 5, Some(1), None);
        // Tile with improvement
        conn.execute(
            "INSERT INTO tiles (tile_id, match_id, x, y, improvement, owner_player_id)
             VALUES (101, 1, 6, 5, 'IMPROVEMENT_FARM', 1)",
            [],
        )
        .unwrap();

        let data = get_improvement_data(&conn, 1).unwrap();
        // Only the tile with improvement should be returned
        assert_eq!(data.improvements.len(), 1);
        assert_eq!(data.improvements[0].improvement, "IMPROVEMENT_FARM");
    }

    #[test]
    fn test_get_units_produced_empty() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 10);
        let units = get_units_produced(&conn, 1).unwrap();
        assert!(units.is_empty());
    }

    #[test]
    fn test_get_units_produced_with_data() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");
        conn.execute(
            "INSERT INTO player_units_produced (player_id, match_id, unit_type, count)
             VALUES (1, 1, 'UNIT_WARRIOR', 5)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO player_units_produced (player_id, match_id, unit_type, count)
             VALUES (1, 1, 'UNIT_ARCHER', 3)",
            [],
        )
        .unwrap();

        let units = get_units_produced(&conn, 1).unwrap();
        assert_eq!(units.len(), 2);
        // Sorted by count DESC
        assert_eq!(units[0].unit_type, "UNIT_WARRIOR");
        assert_eq!(units[0].count, 5);
        assert_eq!(units[1].unit_type, "UNIT_ARCHER");
        assert_eq!(units[1].count, 3);
    }

    // ---- Tier 2: Synthetic fixture tests ----

    #[test]
    fn test_map_tiles_at_turn_ownership_reconstruction() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 20);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");
        insert_player(&conn, 2, 1, "Greece", "NATION_GREECE");
        insert_tile(&conn, 100, 1, 5, 5, Some(2), None);

        // Tile owned by Rome at turn 3, then transferred to Greece at turn 8
        insert_tile_ownership(&conn, 100, 1, 3, Some(1));
        insert_tile_ownership(&conn, 100, 1, 8, Some(2));

        // At turn 5: should be owned by Rome (latest ownership <= 5 is turn 3)
        let tiles_t5 = get_map_tiles_at_turn(&conn, 1, 5).unwrap();
        assert_eq!(tiles_t5.len(), 1);
        assert_eq!(tiles_t5[0].owner_nation, Some("NATION_ROME".to_string()));

        // At turn 10: should be owned by Greece (latest ownership <= 10 is turn 8)
        let tiles_t10 = get_map_tiles_at_turn(&conn, 1, 10).unwrap();
        assert_eq!(tiles_t10.len(), 1);
        assert_eq!(tiles_t10[0].owner_nation, Some("NATION_GREECE".to_string()));
    }

    #[test]
    fn test_map_tiles_at_turn_hides_improvements_for_unowned() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 20);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");

        // Tile with improvement in current state
        conn.execute(
            "INSERT INTO tiles (tile_id, match_id, x, y, improvement, has_road, owner_player_id, terrain)
             VALUES (100, 1, 5, 5, 'IMPROVEMENT_FARM', true, 1, 'TERRAIN_TEMPERATE')",
            [],
        )
        .unwrap();

        // Tile only became owned at turn 10
        insert_tile_ownership(&conn, 100, 1, 10, Some(1));

        // At turn 5: tile unowned → improvement and road should be hidden
        let tiles_t5 = get_map_tiles_at_turn(&conn, 1, 5).unwrap();
        assert_eq!(tiles_t5.len(), 1);
        assert!(tiles_t5[0].improvement.is_none());
        assert!(!tiles_t5[0].has_road);
        assert!(tiles_t5[0].owner_nation.is_none());

        // At turn 15: tile owned → improvement and road visible
        let tiles_t15 = get_map_tiles_at_turn(&conn, 1, 15).unwrap();
        assert_eq!(tiles_t15.len(), 1);
        assert_eq!(tiles_t15[0].improvement, Some("IMPROVEMENT_FARM".to_string()));
        assert!(tiles_t15[0].has_road);
        assert_eq!(tiles_t15[0].owner_nation, Some("NATION_ROME".to_string()));
    }

    #[test]
    fn test_map_tiles_religions_populated() {
        let conn = setup_test_db();
        insert_match(&conn, 1, 50);
        insert_player(&conn, 1, 1, "Rome", "NATION_ROME");
        insert_tile(&conn, 100, 1, 5, 5, Some(1), Some(10));
        insert_city(&conn, 10, 1, "Roma", 1, 100, 1);

        // Set up religion
        conn.execute(
            "INSERT INTO religions (religion_id, match_id, religion_name, founder_player_id, founded_turn)
             VALUES (1, 1, 'RELIGION_ZOROASTRIANISM', 1, 5)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO city_religions (city_id, match_id, religion, acquired_turn)
             VALUES (10, 1, 'RELIGION_ZOROASTRIANISM', 5)",
            [],
        )
        .unwrap();

        let tiles = get_map_tiles(&conn, 1).unwrap();
        assert_eq!(tiles.len(), 1);
        assert_eq!(tiles[0].religions.len(), 1);
        assert_eq!(tiles[0].religions[0].religion_name, "RELIGION_ZOROASTRIANISM");
        assert_eq!(tiles[0].religions[0].founder_nation, Some("NATION_ROME".to_string()));
    }

    // ---- Tier 3: Real save invariant tests ----

    #[test]
    #[ignore]
    fn test_real_save_map_tiles_invariants() {
        let fixture = match super::super::test_fixtures::get_imported_fixture() {
            Some(f) => f,
            None => return,
        };
        let conn = Connection::open(&fixture.db_path).unwrap();

        let tiles = get_map_tiles(&conn, fixture.match_id).unwrap();
        assert!(!tiles.is_empty(), "Should have map tiles");
        // All tiles should have valid coordinates
        for tile in &tiles {
            assert!(tile.x >= 0);
            assert!(tile.y >= 0);
        }
    }

    #[test]
    #[ignore]
    fn test_real_save_map_tiles_at_turn_count() {
        let fixture = match super::super::test_fixtures::get_imported_fixture() {
            Some(f) => f,
            None => return,
        };
        let conn = Connection::open(&fixture.db_path).unwrap();

        let current_tiles = get_map_tiles(&conn, fixture.match_id).unwrap();
        let turn1_tiles = get_map_tiles_at_turn(&conn, fixture.match_id, 1).unwrap();

        // All tiles exist from game start — counts should match
        assert_eq!(
            current_tiles.len(),
            turn1_tiles.len(),
            "Tile count should be same at turn 1 as current state"
        );
    }
}
